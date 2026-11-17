import { NextRequest, NextResponse } from "next/server";
import { validateInstructorSession, validateStudentSession } from "@/lib/db";
import { checkRateLimit, LeakyBucket, RateLimitResult } from "@/lib/rateLimit";

export type UserRole = "INSTRUCTOR" | "STUDENT" | "INTERNAL";

export interface ApiAuthContext {
  role: UserRole;
  userId: string;
  instructorId?: string;
  studentRegNo?: string;
  token?: string;
}

export interface ApiAuthOptions {
  allowedRoles?: UserRole[];
  rateLimit?: {
    enabled?: boolean;
    max?: number; // default 30 requests
    windowMs?: number; // default 60000ms = 1 minute
  };
}

/**
 * Universal Authentication & Rate Limiting Guard for Next.js API Routes.
 * Enforces role-based access control and sliding-window rate limiting.
 */
export async function authenticateApiRequest(
  req: NextRequest,
  options: ApiAuthOptions = {}
): Promise<
  | { success: true; auth: ApiAuthContext }
  | { success: false; response: NextResponse }
> {
  // 1. Extract Bearer token from Authorization header
  const authHeader = req.headers.get("authorization");
  const bearerMatch = authHeader?.match(/^Bearer\s+(.+)$/i);
  const bearerToken = bearerMatch ? bearerMatch[1].trim() : null;

  // 2. Check internal service key (strictly separated from WebRTC LiveKit secret)
  const internalSecret = req.headers.get("x-internal-secret");
  const envInternalKey = process.env.INTERNAL_SERVICE_KEY;
  const envAdminKey = process.env.INITIAL_ADMIN_KEY;
  const isInternalAuthorized = Boolean(
    (envInternalKey && ((internalSecret && internalSecret === envInternalKey) || (bearerToken && bearerToken === envInternalKey))) ||
    (envAdminKey && ((internalSecret && internalSecret === envAdminKey) || (bearerToken && bearerToken === envAdminKey)))
  );

  if (isInternalAuthorized) {
    const auth: ApiAuthContext = {
      role: "INTERNAL",
      userId: "internal_system",
    };
    return { success: true, auth };
  }

  // 3. Resolve session tokens to try
  const tokensToTry: string[] = [];
  if (bearerToken) {
    tokensToTry.push(bearerToken);
  } else {
    const instCookie = req.cookies.get("openviva_session")?.value;
    const studentCookie = req.cookies.get("openviva_student_session")?.value;
    const tempCookie = req.cookies.get("openviva_student_temp")?.value;
    if (instCookie) tokensToTry.push(instCookie);
    if (studentCookie) tokensToTry.push(studentCookie);
    if (tempCookie) tokensToTry.push(tempCookie);
  }

  if (tokensToTry.length === 0) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Unauthorized: Missing authentication credentials." },
        { status: 401 }
      ),
    };
  }

  // 4. Validate credentials
  let authContext: ApiAuthContext | null = null;

  for (const token of tokensToTry) {
    // Try instructor session
    try {
      const instructor = await validateInstructorSession(token);
      if (instructor) {
        authContext = {
          role: "INSTRUCTOR",
          userId: instructor.id,
          instructorId: instructor.id,
          token,
        };
        break;
      }
    } catch (err) {
      console.warn("Instructor session validation error:", err);
    }

    // Try student session
    try {
      const studentSession = await validateStudentSession(token);
      if (studentSession && studentSession.student) {
        authContext = {
          role: "STUDENT",
          userId: studentSession.student.regNo,
          studentRegNo: studentSession.student.regNo,
          token,
        };
        break;
      }
    } catch (err) {
      console.warn("Student session validation error:", err);
    }
  }

  if (!authContext) {
    return {
      success: false,
      response: NextResponse.json(
        { error: "Unauthorized: Invalid or expired session credentials." },
        { status: 401 }
      ),
    };
  }

  // 5. Role Authorization
  if (options.allowedRoles && options.allowedRoles.length > 0) {
    if (!options.allowedRoles.includes(authContext.role)) {
      return {
        success: false,
        response: NextResponse.json(
          { error: "Forbidden: Insufficient privileges to access this resource." },
          { status: 403 }
        ),
      };
    }
  }

  // 6. Rate Limiting (Default enabled for vLLM: 30 requests/minute)
  const rateLimitConfig = options.rateLimit;
  if (rateLimitConfig?.enabled !== false) {
    const max = rateLimitConfig?.max ?? 30;
    const windowMs = rateLimitConfig?.windowMs ?? 60000;
    const rateLimitKey = `${authContext.role}:${authContext.userId}`;

    const limitResult: RateLimitResult = LeakyBucket.check(rateLimitKey, max, windowMs);

    if (!limitResult.allowed) {
      return {
        success: false,
        response: NextResponse.json(
          {
            error: "Too many requests. GPU compute rate limit exceeded.",
            retryAfter: limitResult.retryAfter,
          },
          {
            status: 429,
            headers: {
              "Retry-After": String(limitResult.retryAfter),
              "X-RateLimit-Limit": String(limitResult.limit),
              "X-RateLimit-Remaining": "0",
              "X-RateLimit-Reset": String(limitResult.resetTime),
            },
          }
        ),
      };
    }
  }

  return { success: true, auth: authContext };
}
