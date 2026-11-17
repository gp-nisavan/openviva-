import { NextRequest, NextResponse } from "next/server";
import { deleteStudentSession } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    let token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : null;

    if (!token) {
      token =
        req.cookies?.get("openviva_student_session")?.value ||
        req.cookies?.get("openviva_student_temp")?.value ||
        null;
    }

    if (token) {
      await deleteStudentSession(token);
    }

    const res = NextResponse.json({ success: true, message: "Logged out successfully." });
    res.cookies.set("openviva_student_session", "", { path: "/", maxAge: 0 });
    res.cookies.set("openviva_student_temp", "", { path: "/", maxAge: 0 });
    return res;
  } catch (err: any) {
    console.error("POST /api/auth/student-logout error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to log out." },
      { status: 500 }
    );
  }
}

