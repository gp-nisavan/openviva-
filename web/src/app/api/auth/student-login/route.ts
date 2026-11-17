import { NextRequest, NextResponse } from "next/server";
import { getStudentByRegNo, createStudentSession, getStudentBiometrics } from "@/lib/db";
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
  const rateLimitKey = `auth_student_login:${clientIp}`;
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
    const regNo = body.regNo || body.reg_no;
    const password = body.password;

    if (!regNo || typeof regNo !== "string" || !regNo.trim()) {
      return NextResponse.json(
        { error: "Registration number is required." },
        { status: 400, headers: rateLimitHeaders }
      );
    }
    if (!password) {
      return NextResponse.json(
        { error: "Password is required." },
        { status: 400, headers: rateLimitHeaders }
      );
    }

    const normalizedReg = regNo.trim().toLowerCase();
    const student = await getStudentByRegNo(normalizedReg);

    if (!student || !student.isActive) {
      return NextResponse.json(
        { error: "Invalid registration number or password." },
        { status: 401, headers: rateLimitHeaders }
      );
    }

    const isValid = verifyPassword(password, student.passwordHash, student.salt);
    if (!isValid) {
      return NextResponse.json(
        { error: "Invalid registration number or password." },
        { status: 401, headers: rateLimitHeaders }
      );
    }

    // Check biometrics status
    const biometrics = await getStudentBiometrics(normalizedReg);
    const biometricsEnrolled = !!(biometrics && (biometrics.faceImagePath || biometrics.faceEnrolledAt));

    // Check if mandatory first-login password change is required
    if (student.mustChangePassword) {
      // Issue short-lived temporary token strictly for completing password reset / enrollment
      const tempToken = await createStudentSession(normalizedReg, true, 2); // 2 hours

      const res = NextResponse.json(
        {
          success: true,
          mustChangePassword: true,
          tempToken,
          student: {
            regNo: student.regNo,
            studentName: student.studentName,
            department: student.department,
            cohort: student.cohort,
          },
          biometricsEnrolled,
          message: "Mandatory password change and enrollment required on first login.",
        },
        { headers: rateLimitHeaders }
      );

      res.cookies.set("openviva_student_temp", tempToken, {
        httpOnly: true,
        secure: req.nextUrl.protocol === "https:",
        sameSite: "lax",
        path: "/",
        maxAge: 2 * 60 * 60,
      });

      return res;
    }

    // Authenticated regular session (7 days validity)
    const token = await createStudentSession(normalizedReg, false, 24 * 7);

    const res = NextResponse.json(
      {
        success: true,
        mustChangePassword: false,
        token,
        student: {
          regNo: student.regNo,
          studentName: student.studentName,
          department: student.department,
          cohort: student.cohort,
        },
        biometricsEnrolled,
      },
      { headers: rateLimitHeaders }
    );

    res.cookies.set("openviva_student_session", token, {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return res;
  } catch (err: any) {
    console.error("POST /api/auth/student-login error:", err);
    return NextResponse.json(
      { error: err.message || "Student authentication failed." },
      { status: 500, headers: rateLimitHeaders }
    );
  }
}
