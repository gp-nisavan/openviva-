import { NextRequest, NextResponse } from "next/server";
import {
  validateStudentSession,
  updateStudentPassword,
  createStudentSession,
  deleteStudentSession,
  getStudentBiometrics,
} from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    // 1. Extract Bearer token, body token, or cookie
    const authHeader = req.headers.get("authorization");
    let token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : null;

    // 2. Parse request body
    const body = await req.json();
    const { newPassword, confirmPassword } = body;

    if (!token) {
      token =
        body.tempToken ||
        body.token ||
        req.cookies?.get("openviva_student_temp")?.value ||
        req.cookies?.get("openviva_student_session")?.value ||
        null;
    }

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized: Missing authentication token." },
        { status: 401 }
      );
    }

    // 3. Validate current session
    const sessionData = await validateStudentSession(token);
    if (!sessionData || !sessionData.student) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or expired session." },
        { status: 401 }
      );
    }

    const { student, isTemp } = sessionData;

    if (!newPassword || typeof newPassword !== "string") {
      return NextResponse.json(
        { error: "New password is required." },
        { status: 400 }
      );
    }

    // Enforce that new password cannot be the student's default registration ID
    if (newPassword.trim().toLowerCase() === student.regNo.toLowerCase()) {
      return NextResponse.json(
        { error: "New password cannot be identical to your registration ID." },
        { status: 400 }
      );
    }

    if (newPassword.length < 6) {
      return NextResponse.json(
        { error: "Password must be at least 6 characters long." },
        { status: 400 }
      );
    }

    if (confirmPassword !== undefined && newPassword !== confirmPassword) {
      return NextResponse.json(
        { error: "Passwords do not match." },
        { status: 400 }
      );
    }

    // 4. Update the password and flip must_change_password to 0
    await updateStudentPassword(student.regNo, newPassword);

    // 5. Upgrade temporary token to full session token if applicable
    let activeToken = token;
    if (isTemp) {
      await deleteStudentSession(token);
      activeToken = await createStudentSession(student.regNo, false, 24 * 7);
    }

    const biometrics = await getStudentBiometrics(student.regNo);
    const biometricsEnrolled = !!(biometrics && (biometrics.faceImagePath || biometrics.faceEnrolledAt));

    // 6. Build response and configure cookies
    const res = NextResponse.json({
      success: true,
      message: "Password updated successfully. Full session activated.",
      token: activeToken,
      student: {
        regNo: student.regNo,
        studentName: student.studentName,
        department: student.department,
        cohort: student.cohort,
      },
      biometricsEnrolled,
    });

    // Clear temporary cookie if present
    res.cookies.set("openviva_student_temp", "", {
      path: "/",
      maxAge: 0,
    });

    // Set full authenticated student session cookie (7 days)
    res.cookies.set("openviva_student_session", activeToken, {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 7 * 24 * 60 * 60,
    });

    return res;
  } catch (err: any) {
    console.error("POST /api/auth/student-change-password error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to update password." },
      { status: 500 }
    );
  }
}
