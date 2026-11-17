import { NextRequest, NextResponse } from "next/server";
import {
  getInstructorById,
  deleteInstructor,
  validateInstructorSession,
  recordStaffAuditLog,
} from "@/lib/db";

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers.get("x-real-ip") || "127.0.0.1";
}

export async function DELETE(
  req: NextRequest,
  context: { params: Promise<{ id: string }> | { id: string } }
) {
  const clientIp = getClientIp(req);
  const resolvedParams = await context.params;
  const targetId = resolvedParams.id;

  if (!targetId || !targetId.trim()) {
    return NextResponse.json({ error: "Missing instructor ID." }, { status: 400 });
  }

  // 1. Authenticate caller session
  const authHeader = req.headers.get("authorization");
  const cookieToken = req.cookies.get("openviva_session")?.value;
  const token = authHeader?.replace(/^Bearer\s+/i, "") || cookieToken;

  if (!token) {
    return NextResponse.json({ error: "Unauthorized. Authentication token required." }, { status: 401 });
  }

  let callerSession: any = null;
  try {
    callerSession = await validateInstructorSession(token);
  } catch (err) {
    console.error("Session verification failed:", err);
  }

  if (!callerSession) {
    return NextResponse.json({ error: "Invalid or expired session." }, { status: 401 });
  }

  // 2. Enforce Role Boundary: Only PROFESSOR or ADMIN can revoke staff
  if (callerSession.role !== "PROFESSOR" && callerSession.role !== "ADMIN") {
    await recordStaffAuditLog({
      eventType: "STAFF_REVOKE_REJECTED",
      actorId: callerSession.id,
      actorUsername: callerSession.username,
      actorRole: callerSession.role,
      targetUserId: targetId,
      ipAddress: clientIp,
      details: {
        reason: "Unauthorized role attempt. TAs cannot revoke staff.",
      },
    });

    return NextResponse.json(
      { error: "Forbidden. Only Professors and Administrators can revoke staff credentials." },
      { status: 403 }
    );
  }

  // 3. Find target instructor in SQLite database
  const target = await getInstructorById(targetId);
  if (!target) {
    return NextResponse.json({ error: "Staff member not found." }, { status: 404 });
  }

  // 4. Invariant: Prevent accidental self-revocation (Lead Professor lockout protection)
  if (target.id === callerSession.id || target.username.toLowerCase() === callerSession.username.toLowerCase()) {
    return NextResponse.json(
      { error: "Safety Invariant: You cannot revoke your own active staff account." },
      { status: 400 }
    );
  }

  // 5. Invariant: Revoking another Professor or Admin requires root institutional admin key
  if (target.role === "PROFESSOR" || target.role === "ADMIN") {
    const configuredKey = process.env.INITIAL_ADMIN_KEY?.trim();
    let providedKey = (req.headers.get("x-admin-key") || "").trim();
    if (!providedKey) {
      try {
        const body = await req.json().catch(() => ({}));
        providedKey = (body.adminKey || body.admin_key || "").trim();
      } catch {
        // ignore
      }
    }

    const isKeyAuthorized = Boolean(configuredKey && providedKey && configuredKey === providedKey);
    if (!isKeyAuthorized) {
      await recordStaffAuditLog({
        eventType: "STAFF_REVOKE_REJECTED",
        actorId: callerSession.id,
        actorUsername: callerSession.username,
        actorRole: callerSession.role,
        targetUserId: target.id,
        targetUsername: target.username,
        targetRole: target.role,
        ipAddress: clientIp,
        details: {
          reason: "Attempted to revoke faculty/admin without INITIAL_ADMIN_KEY.",
        },
      });

      return NextResponse.json(
        { error: "Forbidden. Revoking a faculty member or administrator requires the institutional bootstrap key." },
        { status: 403 }
      );
    }
  }

  // 6. Execute atomic revocation: Purge session tokens and delete instructor from SQLite
  await deleteInstructor(target.id);

  // 7. Audit Logging
  await recordStaffAuditLog({
    eventType: "STAFF_REVOKED",
    actorId: callerSession.id,
    actorUsername: callerSession.username,
    actorRole: callerSession.role,
    targetUserId: target.id,
    targetUsername: target.username,
    targetRole: target.role,
    ipAddress: clientIp,
    details: {
      revokedRole: target.role,
      revokedDepartment: target.department || null,
      timestamp: new Date().toISOString(),
    },
  });

  return NextResponse.json({
    success: true,
    message: `Teaching Assistant @${target.username} has been revoked and all active sessions purged.`,
  });
}
