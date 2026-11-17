import { NextRequest, NextResponse } from "next/server";
import { validateInstructorSession, validateStudentSession } from "@/lib/db";
import { checkRateLimit } from "@/lib/rateLimit";

// Server-configured vLLM base endpoint (without trailing slash or completions)
const CONFIGURED_VLLM_URL = process.env.VLLM_API_URL
  ? process.env.VLLM_API_URL.replace(/\/chat\/completions\/?$/, "").replace(/\/$/, "")
  : "http://10.10.16.13:8000/v1";

const DEFAULT_MODEL = process.env.VLLM_MODEL || "thesven/Phi-3.5-mini-instruct-awq";

/**
 * Strict allowlist of authorized hostnames for local vLLM inference.
 * Completely blocks SSRF access to cloud metadata (169.254.x.x), internal LAN services,
 * Redis (6379), MinIO (9000), or arbitrary remote web servers.
 */
const ALLOWED_LLM_HOSTS = new Set([
  "127.0.0.1",
  "localhost",
  "10.10.16.13",
]);

/**
 * Validates whether a target endpoint URL is safe and authorized.
 */
function resolveSafeLlmEndpoint(userEndpoint?: string | null): { safeUrl: string; error?: string; status?: number } {
  // If omitted or null, safely default to server-configured vLLM URL
  if (userEndpoint === undefined || userEndpoint === null) {
    return { safeUrl: CONFIGURED_VLLM_URL };
  }

  // If explicitly passed as non-string, empty, or whitespace
  if (typeof userEndpoint !== "string" || !userEndpoint.trim()) {
    return {
      safeUrl: "",
      error: "Invalid endpoint: Specified endpoint parameter cannot be empty or whitespace.",
      status: 400,
    };
  }

  const raw = userEndpoint.trim();

  // 1. Detect and reject obfuscated / non-canonical IP formats in raw input
  // (e.g. 0177.0.0.1, 0x7f..., integer IPs like 2130706433, or leading zeros / wildcard / IPv6)
  const hostPartMatch = raw.match(/^https?:\/\/([^@\/?#]+)/i);
  if (hostPartMatch) {
    const rawHostWithPort = hostPartMatch[1];
    const rawHost = rawHostWithPort.split(":")[0];
    if (
      /^0x/i.test(rawHost) ||
      /^0\d/i.test(rawHost) ||
      /^\d+$/.test(rawHost) ||
      rawHost === "0.0.0.0" ||
      rawHost.startsWith("[")
    ) {
      return {
        safeUrl: "",
        error: "Access Denied: Obfuscated, non-canonical, or wildcard IP encodings are prohibited.",
        status: 403,
      };
    }
  }

  try {
    const parsed = new URL(raw);
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      return { safeUrl: "", error: "Invalid protocol: Only HTTP/HTTPS is permitted.", status: 403 };
    }

    // Explicitly reject userinfo (credentials in URL) to prevent parser confusion
    if (parsed.username || parsed.password) {
      return {
        safeUrl: "",
        error: "Access Denied: Embedded credentials (userinfo) in endpoint URL are not permitted.",
        status: 403,
      };
    }

    // Host must strictly match allowed hosts
    const hostname = parsed.hostname.toLowerCase();
    if (!ALLOWED_LLM_HOSTS.has(hostname)) {
      return {
        safeUrl: "",
        error: `Access Denied: Target host '${hostname}' is not an authorized vLLM inference host.`,
        status: 403,
      };
    }

    // Port must strictly be 8000
    const port = parsed.port;
    if (port !== "8000") {
      return {
        safeUrl: "",
        error: `Access Denied: Port '${port || "default"}' is not authorized. Only port 8000 is permitted.`,
        status: 403,
      };
    }

    // Ensure pathname strictly stays within standard vLLM API paths (/v1, /v1/chat, etc.)
    const cleanPath = parsed.pathname.replace(/\/$/, "");
    if (cleanPath && !cleanPath.startsWith("/v1") && cleanPath !== "") {
      return {
        safeUrl: "",
        error: `Access Denied: Unauthorized path '${cleanPath}'. Only standard /v1 endpoints are accessible.`,
        status: 403,
      };
    }

    return { safeUrl: `${parsed.protocol}//${hostname}:${port}${cleanPath || "/v1"}` };
  } catch {
    return { safeUrl: "", error: "Malformed endpoint URL format.", status: 400 };
  }
}

/**
 * Helper to authenticate the incoming request against active student or instructor session.
 */
async function authenticateRequest(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  let token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : null;
  if (!token) {
    token =
      req.cookies.get("openviva_session")?.value ||
      req.cookies.get("openviva_student_session")?.value ||
      null;
  }

  if (!token) {
    return null;
  }

  const [instructor, student] = await Promise.all([
    validateInstructorSession(token).catch(() => null),
    validateStudentSession(token).catch(() => null),
  ]);

  if (instructor) return { type: "instructor" as const, user: instructor };
  if (student) return { type: "student" as const, user: student };
  return null;
}

export async function GET(req: NextRequest) {
  // 1. Session Authentication Gate
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json(
      { error: "Unauthorized: Active session required to query LLM service." },
      { status: 401 }
    );
  }

  // Rate Limiting (Issue 16: Max 30 requests/min per user)
  const callerKey = auth.type === "student" ? `llm_user:${auth.user.student.regNo}` : `llm_user:${auth.user.id}`;
  const rateLimit = checkRateLimit(callerKey, 30, 60000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests to LLM service. Please try again later.", retryAfter: rateLimit.retryAfter },
      {
        status: 429,
        headers: {
          "Retry-After": `${rateLimit.retryAfter}`,
          "X-RateLimit-Limit": "30",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": `${Math.ceil(rateLimit.resetTime / 1000)}`,
        },
      }
    );
  }

  // 2. Safe Endpoint Resolution & SSRF Prevention
  const { searchParams } = new URL(req.url);
  const endpointParam = searchParams.has("endpoint") ? searchParams.get("endpoint") : undefined;
  const { safeUrl, error: ssrfError, status = 403 } = resolveSafeLlmEndpoint(endpointParam);

  if (ssrfError) {
    return NextResponse.json(
      { error: ssrfError, attempted: endpointParam },
      { status }
    );
  }

  try {
    const targetUrl = safeUrl.endsWith("/v1")
      ? `${safeUrl}/models`
      : `${safeUrl.replace(/\/models\/?$/, "")}/models`;

    const res = await fetch(targetUrl, {
      method: "GET",
      headers: { "Content-Type": "application/json" },
      signal: AbortSignal.timeout(5000),
    });

    if (!res.ok) {
      return NextResponse.json(
        { error: `LLM service returned status ${res.status}` },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json(data);
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Failed to connect to LLM server";
    return NextResponse.json(
      { error: message, endpoint: safeUrl },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  // 1. Session Authentication Gate
  const auth = await authenticateRequest(req);
  if (!auth) {
    return NextResponse.json(
      { error: "Unauthorized: Active session required to invoke LLM inference." },
      { status: 401 }
    );
  }

  // Rate Limiting (Issue 16: Max 30 requests/min per user)
  const callerKey = auth.type === "student" ? `llm_user:${auth.user.student.regNo}` : `llm_user:${auth.user.id}`;
  const rateLimit = checkRateLimit(callerKey, 30, 60000);
  if (!rateLimit.allowed) {
    return NextResponse.json(
      { error: "Too many requests to LLM service. Please try again later.", retryAfter: rateLimit.retryAfter },
      {
        status: 429,
        headers: {
          "Retry-After": `${rateLimit.retryAfter}`,
          "X-RateLimit-Limit": "30",
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": `${Math.ceil(rateLimit.resetTime / 1000)}`,
        },
      }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const {
      endpoint = undefined,
      model = DEFAULT_MODEL,
      messages = [],
      temperature = 0.7,
      max_tokens = 512,
      stream = false,
    } = body;

    // 2. Safe Endpoint Resolution & SSRF Prevention
    const { safeUrl, error: ssrfError, status = 403 } = resolveSafeLlmEndpoint(endpoint);
    if (ssrfError) {
      return NextResponse.json(
        { error: ssrfError, attempted: endpoint },
        { status }
      );
    }

    const baseV1 = safeUrl.endsWith("/v1") ? safeUrl : `${safeUrl}/v1`;
    const targetUrl = `${baseV1}/chat/completions`;

    const start = performance.now();
    const res = await fetch(targetUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: typeof model === "string" ? model.slice(0, 100) : DEFAULT_MODEL,
        messages: Array.isArray(messages) ? messages : [],
        temperature: Math.min(2.0, Math.max(0.0, Number(temperature) || 0.7)),
        max_tokens: Math.min(2048, Math.max(1, Number(max_tokens) || 512)),
        stream: false,
      }),
      signal: AbortSignal.timeout(60000),
    });

    const elapsedMs = Math.round(performance.now() - start);

    if (!res.ok) {
      const errorText = await res.text();
      return NextResponse.json(
        { error: `vLLM error (${res.status}): ${errorText}`, elapsedMs },
        { status: res.status }
      );
    }

    const data = await res.json();
    return NextResponse.json({ ...data, elapsedMs });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : "Unknown error during inference";
    return NextResponse.json(
      { error: `Inference failed: ${message}` },
      { status: 500 }
    );
  }
}
