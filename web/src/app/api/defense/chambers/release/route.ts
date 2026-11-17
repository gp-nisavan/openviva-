import { NextRequest, NextResponse } from "next/server";
import { releaseChamber, heartbeatChamber, getActiveLocks } from "@/lib/chamberLocks";
import { validateStudentSession, validateInstructorSession } from "@/lib/db";

/**
 * Resolves authenticated candidate or examiner session.
 * Bearer token takes priority; falls back to session cookies.
 */
async function resolveAuthUser(req: NextRequest) {
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader ? authHeader.replace(/^Bearer\s+/i, "").trim() : null;

  if (bearerToken) {
    const studentSession = await validateStudentSession(bearerToken);
    if (studentSession?.student) {
      return { type: "CANDIDATE" as const, user: studentSession.student, isTemp: studentSession.isTemp };
    }
    const instructor = await validateInstructorSession(bearerToken);
    if (instructor) {
      return { type: "EXAMINER" as const, user: instructor };
    }
    return null;
  }

  const studentCookie = req.cookies.get("openviva_student_session")?.value;
  if (studentCookie) {
    const studentSession = await validateStudentSession(studentCookie);
    if (studentSession?.student) {
      return { type: "CANDIDATE" as const, user: studentSession.student, isTemp: studentSession.isTemp };
    }
  }

  const examinerCookie = req.cookies.get("openviva_session")?.value;
  if (examinerCookie) {
    const instructor = await validateInstructorSession(examinerCookie);
    if (instructor) {
      return { type: "EXAMINER" as const, user: instructor };
    }
  }

  return null;
}

export async function POST(req: NextRequest) {
  try {
    const auth = await resolveAuthUser(req);
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized: Active candidate or instructor session required." },
        { status: 401 }
      );
    }

    if (auth.type === "CANDIDATE" && auth.isTemp) {
      return NextResponse.json(
        { error: "Forbidden: Temporary setup token cannot manage chambers." },
        { status: 403 }
      );
    }

    const body = await req.json().catch(() => ({}));
    const roomName = body.roomName;
    const action = body.action || "release";

    if (!roomName || typeof roomName !== "string") {
      return NextResponse.json(
        { error: "roomName is required." },
        { status: 400 }
      );
    }

    const activeLocks = getActiveLocks();
    const currentLock = activeLocks.get(roomName);

    // 1. Candidate Authorization Check
    if (auth.type === "CANDIDATE") {
      const candidateReg = auth.user.regNo.toLowerCase();

      if (action === "heartbeat") {
        if (currentLock && currentLock.studentId.toLowerCase() !== candidateReg) {
          return NextResponse.json(
            { error: "Forbidden: Cannot send heartbeat for a chamber occupied by another candidate." },
            { status: 403 }
          );
        }
        heartbeatChamber(roomName, candidateReg);
        return NextResponse.json({ success: true, action: "heartbeat", roomName });
      }

      // Action: release
      if (currentLock && currentLock.studentId.toLowerCase() !== candidateReg) {
        return NextResponse.json(
          { error: "Forbidden: Cannot release a chamber occupied by another candidate." },
          { status: 403 }
        );
      }

      releaseChamber(roomName, candidateReg);
      return NextResponse.json({ success: true, action: "release", roomName });
    }

    // 2. Examiner Authorization (TA, PROFESSOR, ADMIN)
    // Instructors have administrative power to release any chamber or send heartbeats
    if (action === "heartbeat") {
      heartbeatChamber(roomName, body.studentId || currentLock?.studentId);
      return NextResponse.json({ success: true, action: "heartbeat", roomName });
    }

    releaseChamber(roomName);
    return NextResponse.json({
      success: true,
      action: "release",
      roomName,
      releasedBy: auth.user.username,
      role: auth.user.role,
    });
  } catch (err: any) {
    return NextResponse.json({ error: err.message }, { status: 400 });
  }
}
