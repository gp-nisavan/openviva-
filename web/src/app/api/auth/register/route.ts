import { NextRequest, NextResponse } from "next/server";
import {
  getInstructorByUsername,
  createInstructor,
  createInstructorSession,
  validateInstructorSession,
  recordStaffAuditLog,
} from "@/lib/db";
import { InstructorRole } from "@/types/database";
import { LeakyBucket } from "@/lib/rateLimit";

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers.get("x-real-ip") || "127.0.0.1";
}

export async function POST(req: NextRequest) {
  // Enforce sliding-window rate limit (Max 10 registrations/min per IP)
  const clientIp = getClientIp(req);
  const rateLimitKey = `auth_instructor_register:${clientIp}`;
  const rateLimit = LeakyBucket.check(rateLimitKey, 10, 60000);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        error: "Too many registration attempts. Please try again later.",
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

  try {
    const body = await req.json();
    const { username, displayName, password, role = "TA", department, adminKey } = body;

    if (!username || !username.trim()) {
      return NextResponse.json({ error: "Username is required." }, { status: 400 });
    }
    const cleanUser = username.trim().toLowerCase();
    if (cleanUser.length < 3) {
      return NextResponse.json({ error: "Username must be at least 3 characters." }, { status: 400 });
    }
    if (!/^[a-z0-9_.-]+$/.test(cleanUser)) {
      return NextResponse.json(
        { error: "Username can only contain letters, numbers, hyphens, and underscores." },
        { status: 400 }
      );
    }

    if (!displayName || !displayName.trim()) {
      return NextResponse.json({ error: "Display name is required." }, { status: 400 });
    }
    if (!password || password.length < 4) {
      return NextResponse.json({ error: "Password must be at least 4 characters." }, { status: 400 });
    }

    // --- 1. CALLER GATEKEEPING & AUTHENTICATION CHECK ---
    const configuredKey = process.env.INITIAL_ADMIN_KEY?.trim();
    const providedKey = (typeof adminKey === "string" ? adminKey : (body.admin_key || "")).trim();
    const isKeyAuthorized = Boolean(configuredKey && providedKey && configuredKey === providedKey);

    const authHeader = req.headers.get("authorization");
    const cookieToken = req.cookies.get("openviva_session")?.value;
    const token = authHeader?.replace(/^Bearer\s+/i, "") || cookieToken;

    let callerSession: any = null;
    if (token) {
      try {
        callerSession = await validateInstructorSession(token);
      } catch (err) {
        console.error("Session verification error:", err);
      }
    }

    const isSessionAuthorized = Boolean(
      callerSession && (callerSession.role === "PROFESSOR" || callerSession.role === "ADMIN")
    );

    // Reject unauthenticated requests or callers lacking staff provisioning authority
    if (!isKeyAuthorized && !isSessionAuthorized) {
      await recordStaffAuditLog({
        eventType: "STAFF_PROVISION_UNAUTHORIZED",
        actorId: callerSession?.id || null,
        actorUsername: callerSession?.username || null,
        actorRole: callerSession?.role || null,
        targetUsername: cleanUser,
        targetRole: role || "TA",
        ipAddress: clientIp,
        details: {
          reason: callerSession?.role === "TA" ? "TA caller forbidden" : "Unauthenticated caller lacking key",
        },
      });

      if (callerSession && callerSession.role === "TA") {
        return NextResponse.json(
          { error: "Forbidden. Teaching Assistants are not authorized to provision staff accounts." },
          { status: 403 }
        );
      }
      return NextResponse.json(
        {
          error:
            "Unauthorized. Staff registration requires an active Professor or Administrator session, or a valid institutional bootstrap key.",
        },
        { status: 401 }
      );
    }

    // --- 2. ROLE ELEVATION GOVERNANCE (Task 2.2) ---
    const normalizedRole = typeof role === "string" ? role.trim().toUpperCase() : "TA";
    let instructorRole: InstructorRole = "TA";

    if (normalizedRole === "ADMIN" || normalizedRole === "PROFESSOR") {
      // Elevating to PROFESSOR or ADMIN strictly requires the INITIAL_ADMIN_KEY (even if caller is Professor)
      // to prevent unilateral privilege escalation across institutional faculty.
      if (!isKeyAuthorized) {
        await recordStaffAuditLog({
          eventType: "STAFF_ELEVATION_REJECTED",
          actorId: callerSession?.id || null,
          actorUsername: callerSession?.username || null,
          actorRole: callerSession?.role || null,
          targetUsername: cleanUser,
          targetRole: normalizedRole,
          ipAddress: clientIp,
          details: {
            reason: "Attempted to provision Professor/Admin without valid INITIAL_ADMIN_KEY.",
          },
        });

        return NextResponse.json(
          {
            error:
              "Forbidden. Elevating an account to Professor or Administrator requires the institutional bootstrap key.",
          },
          { status: 403 }
        );
      }
      instructorRole = normalizedRole as InstructorRole;
    } else {
      instructorRole = "TA";
    }

    const existing = await getInstructorByUsername(cleanUser);
    if (existing) {
      return NextResponse.json({ error: `Username "${cleanUser}" is already taken.` }, { status: 409 });
    }

    const instructor = await createInstructor({
      username: cleanUser,
      displayName: displayName.trim(),
      password,
      role: instructorRole,
      department: department?.trim() || undefined,
    });

    const tokenCreated = await createInstructorSession(instructor.id, 7);

    // Record successful provisioning audit telemetry
    await recordStaffAuditLog({
      eventType: "STAFF_PROVISIONED",
      actorId: callerSession?.id || "BOOTSTRAP_KEY",
      actorUsername: callerSession?.username || "ROOT_ADMIN",
      actorRole: callerSession?.role || "ADMIN",
      targetUserId: instructor.id,
      targetUsername: instructor.username,
      targetRole: instructor.role,
      ipAddress: clientIp,
      details: {
        department: instructor.department,
        authorizedVia: callerSession ? "SESSION_DELEGATION" : "BOOTSTRAP_KEY",
      },
    });

    const res = NextResponse.json({
      success: true,
      instructor,
      token: tokenCreated,
    });

    // Only set session cookie if this was a fresh bootstrap registration (unauthenticated caller).
    // An active Professor or Admin creating a TA should not have their existing session cookie overwritten!
    if (!callerSession) {
      res.cookies.set("openviva_session", tokenCreated, {
        httpOnly: true,
        secure: req.nextUrl.protocol === "https:",
        sameSite: "lax",
        path: "/",
        maxAge: 7 * 24 * 60 * 60,
      });
    }

    return res;
  } catch (err: any) {
    console.error("POST /api/auth/register error:", err);
    return NextResponse.json({ error: err.message || "Registration failed." }, { status: 500 });
  }
}
