import { NextRequest, NextResponse } from "next/server";
import {
  validateInstructorSession,
  getStudentByRegNo,
  resetStudentPasswordToDefault,
} from "@/lib/db";

// POST /api/instructors/reset-student-password
// Air-gapped password recovery protocol (Human in the loop):
// Authenticated Teaching Assistant or Professor resets student password back to initial reg_no
export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    let token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : null;

    if (!token) {
      token = req.cookies.get("openviva_session")?.value || null;
    }

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized. Teaching Assistant or Professor credentials required." },
        { status: 401 }
      );
    }

    const instructor = await validateInstructorSession(token);
    if (!instructor) {
      return NextResponse.json(
        { error: "Unauthorized. Invalid or expired instructor session." },
        { status: 401 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const rawRegNo = body.regNo || body.reg_no;
    if (!rawRegNo || typeof rawRegNo !== "string") {
      return NextResponse.json(
        { error: "Registration number ('regNo') is required." },
        { status: 400 }
      );
    }

    const normalizedReg = rawRegNo.trim().toLowerCase();
    const student = await getStudentByRegNo(normalizedReg);
    if (!student) {
      return NextResponse.json(
        { error: `Student with registration number '${rawRegNo}' not found in database.` },
        { status: 404 }
      );
    }

    // Perform atomic password reset with fresh cryptographic salt
    const resetSuccess = await resetStudentPasswordToDefault(normalizedReg);
    if (!resetSuccess) {
      return NextResponse.json(
        { error: `Failed to reset password for student '${normalizedReg}'.` },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      regNo: student.regNo,
      studentName: student.studentName,
      mustChangePassword: true,
      message: `Password for ${student.studentName} (${student.regNo}) has been successfully reset to default registration number. Mandatory password change enforced on next login.`,
      resetAt: new Date().toISOString(),
      resetBy: {
        instructorId: instructor.id,
        username: instructor.username,
        displayName: instructor.displayName,
        role: instructor.role,
      },
    });
  } catch (err: any) {
    console.error("POST /api/instructors/reset-student-password error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to reset student password." },
      { status: 500 }
    );
  }
}
