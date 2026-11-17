import { NextRequest, NextResponse } from "next/server";
import {
  validateInstructorSession,
  getAllStudents,
  getDB,
} from "@/lib/db";

// GET /api/instructors/students
// Returns all enrolled students with credential state and biometric verification status
export async function GET(req: NextRequest) {
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

    const students = await getAllStudents();

    // Query biometrics status from SQLite
    const db = await getDB();
    const bioRes = db.exec(
      "SELECT reg_no, verification_status, face_enrolled_at, voice_enrolled_at FROM student_biometrics"
    );

    const bioMap = new Map<string, {
      verificationStatus: string;
      hasFace: boolean;
      hasVoice: boolean;
    }>();

    if (bioRes.length > 0 && bioRes[0].values) {
      for (const row of bioRes[0].values) {
        const reg = (row[0] as string || "").toLowerCase();
        bioMap.set(reg, {
          verificationStatus: (row[1] as string) || "PENDING",
          hasFace: Boolean(row[2]),
          hasVoice: Boolean(row[3]),
        });
      }
    }

    const enrichedStudents = students.map((s) => {
      const bio = bioMap.get(s.regNo.toLowerCase());
      return {
        regNo: s.regNo,
        studentName: s.studentName,
        department: s.department,
        cohort: s.cohort,
        mustChangePassword: s.mustChangePassword,
        isActive: s.isActive,
        createdAt: s.createdAt,
        updatedAt: s.updatedAt,
        verificationStatus: bio ? bio.verificationStatus : "NOT_ENROLLED",
        hasFace: bio ? bio.hasFace : false,
        hasVoice: bio ? bio.hasVoice : false,
      };
    });

    return NextResponse.json({
      success: true,
      students: enrichedStudents,
      total: enrichedStudents.length,
    });
  } catch (err: any) {
    console.error("GET /api/instructors/students error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to fetch student roster." },
      { status: 500 }
    );
  }
}
