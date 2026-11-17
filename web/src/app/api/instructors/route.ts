import { NextRequest, NextResponse } from "next/server";
import { getAllInstructors } from "@/lib/db";
import { authenticateApiRequest } from "@/lib/apiAuth";

export async function GET(req: NextRequest) {
  try {
    // 1. Enforce Authentication & Role Boundaries (Strictly restricted to Instructors & Internal Services)
    const authResult = await authenticateApiRequest(req, {
      allowedRoles: ["INSTRUCTOR", "INTERNAL"],
      rateLimit: {
        enabled: true,
        max: 60,
        windowMs: 60000,
      },
    });

    if (!authResult.success) {
      return authResult.response;
    }

    // 2. Fetch instructors directory
    const rawInstructors = await getAllInstructors();

    // 3. Strict projection: Ensure zero credential leaks (no password_hash, no salt)
    const instructors = rawInstructors.map((inst) => ({
      id: inst.id,
      username: inst.username,
      displayName: inst.displayName,
      role: inst.role,
      department: inst.department,
      createdAt: inst.createdAt,
    }));

    return NextResponse.json({ success: true, instructors });
  } catch (err: any) {
    console.error("GET /api/instructors error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to fetch instructors directory" },
      { status: 500 }
    );
  }
}
