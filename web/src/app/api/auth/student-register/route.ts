import { NextRequest, NextResponse } from "next/server";
import { registerStudent, createStudentSession } from "@/lib/db";
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
  const rateLimitKey = `auth_student_register:${clientIp}`;
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
    const { regNo, studentName, password, department = "Computer Science", cohort = "2026" } = body;

    if (!regNo || typeof regNo !== "string" || !regNo.trim()) {
      return NextResponse.json(
        { error: "Candidate Registration Number is required." },
        { status: 400 }
      );
    }

    const cleanReg = regNo.trim().toLowerCase();
    if (cleanReg.length < 2) {
      return NextResponse.json(
        { error: "Registration number must be at least 2 characters." },
        { status: 400 }
      );
    }

    if (!studentName || typeof studentName !== "string" || !studentName.trim()) {
      return NextResponse.json(
        { error: "Candidate Full Name is required." },
        { status: 400 }
      );
    }

    if (!password || typeof password !== "string" || password.length < 4) {
      return NextResponse.json(
        { error: "Password must be at least 4 characters." },
        { status: 400 }
      );
    }

    const student = await registerStudent(
      cleanReg,
      studentName.trim(),
      password,
      department?.trim() || "Computer Science",
      cohort?.trim() || "2026"
    );

    // Automatically issue authenticated candidate session (7-day validity)
    const token = await createStudentSession(cleanReg, false, 24 * 7);

    const res = NextResponse.json({
      success: true,
      token,
      student: {
        regNo: student.regNo,
        studentName: student.studentName,
        department: student.department,
        cohort: student.cohort,
      },
      message: "Candidate registered successfully. Please proceed with biometric enrollment.",
    });

    res.cookies.set("openviva_student_session", token, {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return res;
  } catch (err: any) {
    console.error("POST /api/auth/student-register error:", err);
    const status = err.message?.includes("already registered") ? 409 : 500;
    return NextResponse.json(
      { error: err.message || "Candidate registration failed." },
      { status }
    );
  }
}

