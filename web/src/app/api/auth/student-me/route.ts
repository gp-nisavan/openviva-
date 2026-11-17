import { NextRequest, NextResponse } from "next/server";
import { validateStudentSession, getStudentBiometrics } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    let token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : null;

    if (!token) {
      token =
        req.cookies?.get("openviva_student_session")?.value ||
        req.cookies?.get("openviva_student_temp")?.value ||
        null;
    }

    if (!token) {
      return NextResponse.json({ authenticated: false, student: null });
    }

    const sessionData = await validateStudentSession(token);
    if (!sessionData || !sessionData.student) {
      return NextResponse.json({ authenticated: false, student: null });
    }

    const { student, isTemp } = sessionData;
    const biometrics = await getStudentBiometrics(student.regNo);

    return NextResponse.json({
      authenticated: true,
      isTemp,
      token,
      student: {
        regNo: student.regNo,
        studentName: student.studentName,
        department: student.department,
        cohort: student.cohort,
        mustChangePassword: student.mustChangePassword,
      },
      biometricsEnrolled: !!biometrics,
      biometrics: biometrics
        ? {
            faceImagePath: biometrics.faceImagePath,
            faceEnrolledAt: biometrics.faceEnrolledAt,
            voiceSamplePath: biometrics.voiceSamplePath,
            voiceEnrolledAt: biometrics.voiceEnrolledAt,
            verificationStatus: biometrics.verificationStatus,
          }
        : null,
    });
  } catch (err: any) {
    console.error("GET /api/auth/student-me error:", err);
    return NextResponse.json(
      { authenticated: false, error: err.message },
      { status: 500 }
    );
  }
}
