import { NextRequest, NextResponse } from "next/server";
import { validateInstructorSession } from "@/lib/db";

export async function GET(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    let token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : null;

    if (!token) {
      token = req.cookies.get("openviva_session")?.value || null;
    }

    if (!token) {
      return NextResponse.json({ authenticated: false, instructor: null });
    }

    const instructor = await validateInstructorSession(token);
    if (!instructor) {
      return NextResponse.json({ authenticated: false, instructor: null });
    }

    return NextResponse.json({
      authenticated: true,
      instructor,
    });
  } catch (err: any) {
    console.error("GET /api/auth/me error:", err);
    return NextResponse.json({ authenticated: false, error: err.message }, { status: 500 });
  }
}
