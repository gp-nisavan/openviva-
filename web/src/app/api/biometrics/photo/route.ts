import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import {
  getStudentBiometrics,
  validateInstructorSession,
  validateStudentSession,
} from "@/lib/db";

const SAFE_ID_REGEX = /^[a-zA-Z0-9_\-]{1,64}$/;

function getStorageBaseDir(): string {
  const parentStorage = path.resolve(process.cwd(), "..", "storage");
  const localStorage = path.resolve(process.cwd(), "storage");
  if (fs.existsSync(parentStorage)) return parentStorage;
  if (fs.existsSync(localStorage)) return localStorage;
  return parentStorage;
}

function generateSvgPlaceholder(
  title: string,
  subtitle: string,
  isKeyframe: boolean = false
): string {
  const bgColor = isKeyframe ? "#09090b" : "#18181b";
  const borderColor = isKeyframe ? "#3f3f46" : "#27272a";
  const iconColor = isKeyframe ? "#a1a1aa" : "#71717a";

  return `<svg xmlns="http://www.w3.org/2000/svg" width="480" height="360" viewBox="0 0 480 360" fill="none">
    <rect width="480" height="360" rx="16" fill="${bgColor}"/>
    <rect x="0.5" y="0.5" width="479" height="359" rx="15.5" stroke="${borderColor}"/>
    ${
      isKeyframe
        ? `
      <circle cx="240" cy="150" r="50" stroke="${iconColor}" stroke-width="3" stroke-dasharray="6 4"/>
      <circle cx="240" cy="150" r="28" fill="${borderColor}"/>
      <circle cx="240" cy="150" r="12" fill="${iconColor}"/>
      <circle cx="40" cy="36" r="6" fill="#ef4444"/>
      <text x="54" y="40" fill="#f87171" font-family="monospace" font-size="11" font-weight="bold" letter-spacing="1">LIVE EXAM FEED</text>
    `
        : `
      <circle cx="240" cy="130" r="40" fill="${borderColor}"/>
      <path d="M160 230 C160 185, 320 185, 320 230 Z" fill="${borderColor}"/>
      <rect x="28" y="24" width="130" height="24" rx="12" fill="#27272a"/>
      <text x="40" y="40" fill="#a1a1aa" font-family="monospace" font-size="10" font-weight="bold" letter-spacing="0.5">ENROLLED ID</text>
    `
    }
    <text x="240" y="260" text-anchor="middle" fill="#f4f4f5" font-family="sans-serif" font-size="14" font-weight="600">${title}</text>
    <text x="240" y="284" text-anchor="middle" fill="#71717a" font-family="monospace" font-size="11">${subtitle}</text>
  </svg>`;
}

/**
 * Authenticates request and enforces strict authorization.
 * Candidates can ONLY read their own photos.
 * Instructors (TA, Professor, Admin) can read any candidate's photo.
 */
async function authorizePhotoAccess(
  req: NextRequest,
  requestedRegNo: string
): Promise<{ authorized: boolean; reason?: string; status?: number }> {
  const authHeader = req.headers.get("authorization");
  let token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : null;
  if (!token) {
    token =
      req.cookies.get("openviva_session")?.value ||
      req.cookies.get("openviva_student_session")?.value ||
      null;
  }

  if (!token) {
    return { authorized: false, reason: "Unauthorized: Missing session token.", status: 401 };
  }

  const [instructor, studentSession] = await Promise.all([
    validateInstructorSession(token).catch(() => null),
    validateStudentSession(token).catch(() => null),
  ]);

  // Examiner roles have administrative authorization to inspect all candidate media
  if (instructor) {
    return { authorized: true };
  }

  // Student roles can strictly access their own biometric portraits
  if (studentSession && studentSession.student) {
    if (studentSession.student.regNo.toLowerCase() === requestedRegNo.toLowerCase()) {
      return { authorized: true };
    }
    return {
      authorized: false,
      reason: "Forbidden: Candidates are not authorized to view peer biometric portraits.",
      status: 403,
    };
  }

  return { authorized: false, reason: "Unauthorized: Invalid or expired session credentials.", status: 401 };
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const regNo = searchParams.get("regNo");
    const type = searchParams.get("type") || "reference";
    const sessionId = searchParams.get("sessionId") || "";

    // 1. Validate parameter existence and format (Prevent directory traversal)
    if (!regNo || !SAFE_ID_REGEX.test(regNo.trim())) {
      return new NextResponse(
        generateSvgPlaceholder("Candidate ID Missing or Invalid", "Provide valid alphanumeric ?regNo=...", false),
        { status: 400, headers: { "Content-Type": "image/svg+xml" } }
      );
    }

    if (sessionId && !SAFE_ID_REGEX.test(sessionId.trim())) {
      return new NextResponse(
        generateSvgPlaceholder("Invalid Session ID", "Session ID contains invalid characters", true),
        { status: 400, headers: { "Content-Type": "image/svg+xml" } }
      );
    }

    const normalizedReg = regNo.trim().toLowerCase();
    const safeSessionId = sessionId ? sessionId.trim() : "";

    // 2. Enforce Session Authentication & Identity Ownership Check
    const authResult = await authorizePhotoAccess(req, normalizedReg);
    if (!authResult.authorized) {
      return new NextResponse(
        generateSvgPlaceholder("Access Denied", authResult.reason || "Unauthorized", false),
        {
          status: authResult.status || 401,
          headers: { "Content-Type": "image/svg+xml" },
        }
      );
    }

    const storageDir = getStorageBaseDir();
    const facesRoot = path.resolve(storageDir, "biometrics", "faces");
    const keyframesRoot = path.resolve(storageDir, "biometrics", "keyframes");

    if (type === "reference") {
      // 3. Locate Enrolled Reference Face
      const bio = await getStudentBiometrics(normalizedReg);
      const possiblePaths = [
        bio?.faceImagePath ? path.resolve(process.cwd(), bio.faceImagePath) : null,
        bio?.faceImagePath ? path.resolve(facesRoot, path.basename(bio.faceImagePath)) : null,
        path.join(facesRoot, `${normalizedReg}.jpg`),
        path.join(facesRoot, `${normalizedReg}.png`),
        path.join(facesRoot, `${normalizedReg}.jpeg`),
      ].filter(Boolean) as string[];

      for (const p of possiblePaths) {
        // Enforce path containment check
        const resolved = path.resolve(p);
        if (!resolved.startsWith(facesRoot) && !resolved.startsWith(path.resolve(storageDir))) {
          continue;
        }

        if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
          const fileBuffer = fs.readFileSync(resolved);
          const mime = resolved.endsWith(".png") ? "image/png" : "image/jpeg";
          return new NextResponse(fileBuffer, {
            headers: {
              "Content-Type": mime,
              "Cache-Control": "private, max-age=3600",
            },
          });
        }
      }

      // Return placeholder SVG if no photo enrolled
      const svg = generateSvgPlaceholder(
        `Candidate: ${normalizedReg.toUpperCase()}`,
        "No Ground-Truth Photo Enrolled",
        false
      );
      return new NextResponse(svg, { headers: { "Content-Type": "image/svg+xml" } });
    }

    // 4. Locate Chamber Keyframe Capture
    const keyframePaths = [
      safeSessionId ? path.join(keyframesRoot, `${safeSessionId}.jpg`) : null,
      safeSessionId ? path.join(keyframesRoot, `${safeSessionId}.png`) : null,
      safeSessionId ? path.join(keyframesRoot, `${safeSessionId}.jpeg`) : null,
      path.join(facesRoot, `${normalizedReg}_keyframe.jpg`),
      path.join(facesRoot, `${normalizedReg}_keyframe.png`),
      path.join(facesRoot, `${normalizedReg}_keyframe.jpeg`),
    ].filter(Boolean) as string[];

    for (const kp of keyframePaths) {
      const resolved = path.resolve(kp);
      if (
        !resolved.startsWith(keyframesRoot) &&
        !resolved.startsWith(facesRoot) &&
        !resolved.startsWith(path.resolve(storageDir))
      ) {
        continue;
      }

      if (fs.existsSync(resolved) && fs.statSync(resolved).isFile()) {
        const fileBuffer = fs.readFileSync(resolved);
        const mime = resolved.endsWith(".png") ? "image/png" : "image/jpeg";
        return new NextResponse(fileBuffer, {
          headers: {
            "Content-Type": mime,
            "Cache-Control": "private, max-age=3600",
          },
        });
      }
    }

    const keyframeSvg = generateSvgPlaceholder(
      `Live Keyframe: ${normalizedReg.toUpperCase()}`,
      safeSessionId ? `Session ${safeSessionId.slice(0, 8)}...` : "Oral Defense Chamber",
      true
    );
    return new NextResponse(keyframeSvg, { headers: { "Content-Type": "image/svg+xml" } });
  } catch (err: any) {
    console.error("Biometric photo error:", err);
    return new NextResponse(
      generateSvgPlaceholder("Service Error", "Failed to retrieve biometric media", false),
      { status: 500, headers: { "Content-Type": "image/svg+xml" } }
    );
  }
}
