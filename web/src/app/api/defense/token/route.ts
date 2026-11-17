import { NextRequest, NextResponse } from "next/server";
import { AccessToken } from "livekit-server-sdk";
import { claimChamber, getActiveLocks } from "@/lib/chamberLocks";
import { validateStudentSession, validateInstructorSession, getStudentBiometrics } from "@/lib/db";

const LIVEKIT_URL = process.env.LIVEKIT_URL || "http://10.10.16.13:7880";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

/**
 * Resolves the appropriate LiveKit gateway URL based on client origin and protocol.
 * Ensures HTTPS/domain requests connect to the secure wss gateway and LAN IP requests connect to :7880.
 */
function resolveLiveKitGateway(req: NextRequest): string {
  const host = (req.headers.get("host") || "").toLowerCase();
  const forwardedProto = (req.headers.get("x-forwarded-proto") || "").toLowerCase();
  const envUrl = process.env.LIVEKIT_URL;

  // 1. If accessed via HTTPS or iiitviva.online domain
  if (host.includes("iiitviva.online") || forwardedProto === "https") {
    return "wss://livekit.iiitviva.online";
  }

  // 2. If envUrl is valid and not pointing to the defunct shiksha proxy
  if (envUrl && !envUrl.includes("shiksha.iiit.ac.in")) {
    return envUrl;
  }

  // 3. Use client host address if accessing via intranet IP
  const hostWithoutPort = host.split(":")[0];
  if (hostWithoutPort && hostWithoutPort !== "localhost" && hostWithoutPort !== "127.0.0.1") {
    return `http://${hostWithoutPort}:7880`;
  }

  return "http://10.10.16.13:7880";
}

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

/**
 * Core handler for token minting and chamber locking.
 * Enforces session authentication, biometric gate clearance, and room collision guards.
 */
async function handleTokenGeneration(
  req: NextRequest,
  roomNameParam?: string,
  studentIdParam?: string,
  studentNameParam?: string,
  sessionIdParam?: string
) {
  try {
    if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
      console.error("[FATAL] LIVEKIT_API_KEY or LIVEKIT_API_SECRET is missing from environment variables.");
      return NextResponse.json(
        { error: "Server misconfiguration: LiveKit credentials are not configured in environment." },
        { status: 500 }
      );
    }

    const auth = await resolveAuthUser(req);
    if (!auth) {
      return NextResponse.json(
        { error: "Unauthorized: Active candidate or instructor session required." },
        { status: 401 }
      );
    }

    if (auth.type === "CANDIDATE" && auth.isTemp) {
      return NextResponse.json(
        { error: "Forbidden: Temporary setup token cannot be used to join defense chambers." },
        { status: 403 }
      );
    }

    const roomName = (roomNameParam || "stack2-chamber-01").trim();
    let identity: string;
    let name: string;

    if (auth.type === "CANDIDATE") {
      const candidateReg = auth.user.regNo.toLowerCase();

      // Guard: Candidate cannot claim chamber under another candidate's studentId
      if (studentIdParam && studentIdParam.trim().toLowerCase() !== candidateReg) {
        return NextResponse.json(
          { error: `Forbidden: Cannot claim chamber on behalf of another candidate ('${studentIdParam}').` },
          { status: 403 }
        );
      }

      identity = candidateReg;
      name = auth.user.studentName;

      // Check that candidate has completed biometric gate verification
      const biometrics = await getStudentBiometrics(candidateReg);
      if (!biometrics || biometrics.verificationStatus !== "AUTHENTICATED") {
        return NextResponse.json(
          {
            error: "Forbidden: Biometric gate verification required before entering chamber.",
            code: "BIOMETRIC_VERIFICATION_REQUIRED",
            verificationStatus: biometrics?.verificationStatus || "NOT_ENROLLED",
          },
          { status: 403 }
        );
      }

      // Check chamber lock collision
      const activeLocks = getActiveLocks();
      const existing = activeLocks.get(roomName);
      if (existing && existing.studentId.toLowerCase() !== candidateReg) {
        return NextResponse.json(
          {
            error: `Chamber '${roomName}' is currently occupied by candidate '${existing.studentId}'.`,
            code: "CHAMBER_OCCUPIED",
            occupiedBy: existing.studentId,
          },
          { status: 409 }
        );
      }

      // Claim chamber lock in memory
      claimChamber(roomName, candidateReg);
    } else {
      // Examiner / Instructor
      identity = `examiner_${auth.user.username.toLowerCase()}`;
      name = studentNameParam || `${auth.user.displayName} (${auth.user.role})`;
      // Examiners do not take ownership of the room lock; they join as proctors/observers
    }

    const metadataObj: Record<string, any> = {
      studentId: identity,
      roomName,
      role: auth.type,
    };
    if (sessionIdParam) {
      metadataObj.sessionId = sessionIdParam.trim();
    }

    const at = new AccessToken(LIVEKIT_API_KEY, LIVEKIT_API_SECRET, {
      identity,
      name,
      ttl: "2h",
      metadata: JSON.stringify(metadataObj),
    });

    at.addGrant({
      roomJoin: true,
      room: roomName,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    });

    const token = await at.toJwt();

    const effectiveGatewayUrl = resolveLiveKitGateway(req);

    return NextResponse.json({
      token,
      url: effectiveGatewayUrl,
      roomName,
      studentId: identity,
      sessionId: sessionIdParam || null,
    });
  } catch (error: any) {
    console.error("Token minting error:", error);
    return NextResponse.json(
      { error: error?.message || "Failed to generate token" },
      { status: 500 }
    );
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  return handleTokenGeneration(req, body.roomName, body.studentId, body.studentName, body.sessionId);
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const roomName = url.searchParams.get("room") || url.searchParams.get("roomName") || undefined;
  const studentId = url.searchParams.get("studentId") || undefined;
  const studentName = url.searchParams.get("studentName") || undefined;
  const sessionId = url.searchParams.get("sessionId") || undefined;
  return handleTokenGeneration(req, roomName, studentId, studentName, sessionId);
}
