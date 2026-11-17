import { NextRequest, NextResponse } from "next/server";
import { getInstructorByUsername, createInstructorSession } from "@/lib/db";
import { verifyPassword } from "@/lib/auth";
import { checkRateLimit, LeakyBucket } from "@/lib/rateLimit";

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers.get("x-real-ip") || "127.0.0.1";
}

export async function POST(req: NextRequest) {
  // 1. Enforce sliding-window LeakyBucket rate limit (Issue 16: Max 10 attempts/min per IP)
  const clientIp = getClientIp(req);
  const rateLimitKey = `auth_instructor_login:${clientIp}`;
  const rateLimit = LeakyBucket.check(rateLimitKey, 10, 60000);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "Too many login attempts. Please try again later.",
        retryAfter: rateLimit.retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": `${rateLimit.retryAfter}`,
          "X-RateLimit-Limit": `${rateLimit.limit}`,
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": `${Math.ceil(rateLimit.resetTime / 1000)}`,
        },
      }
    );
  }

  const rateLimitHeaders = {
    "X-RateLimit-Limit": `${rateLimit.limit}`,
    "X-RateLimit-Remaining": `${rateLimit.remaining}`,
    "X-RateLimit-Reset": `${Math.ceil(rateLimit.resetTime / 1000)}`,
  };

  try {
    const body = await req.json().catch(() => ({}));
    const { username, password } = body;

    if (!username || typeof username !== "string" || !username.trim()) {
      return NextResponse.json(
        { error: "Username is required." },
        { status: 400, headers: rateLimitHeaders }
      );
    }
    if (!password) {
      return NextResponse.json(
        { error: "Password is required." },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    const row = await getInstructorByUsername(username.trim());
    if (!row) {
      return NextResponse.json(
        { error: "Invalid username or password." },
        { status: 401, headers: rateLimitHeaders }
      );
    }

    const isValid = verifyPassword(password, row.password_hash, row.salt);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid username or password." },
        { status: 401, headers: rateLimitHeaders }
      );
    }

    const token = await createInstructorSession(row.id, 7);

    const instructor = {
      id: row.id,
      username: row.username,
      displayName: row.display_name,
      role: row.role,
      department: row.department || undefined,
      createdAt: row.created_at,
    };

    const res = NextResponse.json(
      {
        success: true,
        instructor,
        token,
      },
      { headers: rateLimitHeaders }
    );

    res.cookies.set("openviva_session", token, {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return res;
  } catch (err: any) {
    console.error("POST /api/auth/login error:", err);
    return NextResponse.json(
      { error: err.message || "Authentication failed." },
      { status: 500, headers: rateLimitHeaders }
    );
  }
}
