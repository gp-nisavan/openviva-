import { NextRequest, NextResponse } from "next/server";
import { deleteInstructorSession } from "@/lib/db";

export async function POST(req: NextRequest) {
  try {
    const authHeader = req.headers.get("authorization");
    let token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : null;

    if (!token) {
      token = req.cookies.get("openviva_session")?.value || null;
    }

    if (token) {
      await deleteInstructorSession(token);
    }

    const res = NextResponse.json({
      success: true,
      message: "Successfully logged out.",
    });

    res.cookies.set("openviva_session", "", {
      httpOnly: true,
      secure: req.nextUrl.protocol === "https:",
      sameSite: "lax",
      path: "/",
      maxAge: 0,
    });

    return res;
  } catch (err: any) {
    console.error("POST /api/auth/logout error:", err);
    return NextResponse.json({ error: err.message || "Logout failed." }, { status: 500 });
  }
}
