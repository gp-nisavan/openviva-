import { NextRequest, NextResponse } from "next/server";
import fs from "fs";
import path from "path";
import { Readable } from "stream";
import { spawn } from "child_process";
import {
  getRecordingsDir,
  getRecordBySessionId,
  validateInstructorSession,
  validateStudentSession,
} from "@/lib/db";

const SAFE_ID_REGEX = /^[a-zA-Z0-9_\-]{1,128}$/;

/**
 * Checks whether the given filesystem path resolves strictly within
 * the authorized storage roots (recordingsDir or /dev/shm/savan_openviva).
 */
function isContained(filePath: string, allowedRoots: string[]): boolean {
  try {
    const resolved = path.resolve(filePath);
    return allowedRoots.some((root) => {
      const rel = path.relative(root, resolved);
      return !rel.startsWith("..") && !path.isAbsolute(rel);
    });
  } catch {
    return false;
  }
}

/**
 * Locates the optimal ffmpeg binary on the server.
 */
function getFfmpegPath(): string {
  const candidateFfmpeg = [
    "/home/savan/openviva/bin/ffmpeg",
    "/home/savan/.local/bin/ffmpeg",
    "ffmpeg",
  ];
  for (const fp of candidateFfmpeg) {
    try {
      if (fs.existsSync(fp)) return fp;
    } catch {}
  }
  return "ffmpeg";
}

/**
 * Background non-blocking transcoding of uncompressed WAV to compressed AAC M4A.
 * Enforces +faststart flag to move MOOV atom to beginning for instant browser scrubbing.
 */
function triggerBackgroundTranscode(wavPath: string, m4aPath: string) {
  try {
    const ffmpegBin = getFfmpegPath();
    const proc = spawn(
      ffmpegBin,
      ["-y", "-i", wavPath, "-c:a", "aac", "-b:a", "64k", "-movflags", "+faststart", m4aPath],
      { stdio: "ignore", detached: true }
    );
    proc.unref();
  } catch (err) {
    console.debug("[defense/audio] Background transcode spawn warning:", err);
  }
}

export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");
    const chamberId = searchParams.get("chamberId");
    const filename = searchParams.get("filename");

    // 1. Validate parameter presence
    if (!sessionId && !chamberId && !filename) {
      return NextResponse.json(
        { error: "Parameter 'sessionId', 'chamberId', or 'filename' is required." },
        { status: 400 }
      );
    }

    // 2. Validate parameter format against directory traversal
    if (sessionId && !SAFE_ID_REGEX.test(sessionId.trim())) {
      return NextResponse.json(
        { error: "Invalid sessionId parameter. Only alphanumeric characters, hyphens, and underscores are permitted." },
        { status: 400 }
      );
    }

    if (chamberId && !SAFE_ID_REGEX.test(chamberId.trim())) {
      return NextResponse.json(
        { error: "Invalid chamberId parameter. Only alphanumeric characters, hyphens, and underscores are permitted." },
        { status: 400 }
      );
    }

    if (filename) {
      if (
        filename.includes("..") ||
        filename.includes("/") ||
        filename.includes("\\") ||
        filename.includes("\0") ||
        filename.includes("%00")
      ) {
        return NextResponse.json(
          { error: "Invalid filename parameter. Path traversal elements are prohibited." },
          { status: 400 }
        );
      }
      const baseFilename = path.basename(filename);
      const ext = path.extname(baseFilename).toLowerCase();
      if (![".wav", ".ogg", ".mp3", ".m4a", ".aac"].includes(ext)) {
        return NextResponse.json(
          { error: "Invalid filename parameter. Only supported audio extensions are allowed." },
          { status: 400 }
        );
      }
    }

    // 3. Authenticate Session (Bearer Token, HTTP Cookies, or Query Param for HTML media tags)
    const authHeader = req.headers.get("authorization");
    let token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : null;
    if (!token) {
      token =
        req.cookies.get("openviva_session")?.value ||
        req.cookies.get("openviva_student_session")?.value ||
        req.cookies.get("openviva_student_temp")?.value ||
        searchParams.get("token") ||
        null;
    }

    if (!token) {
      return NextResponse.json(
        { error: "Unauthorized: Missing authentication session token." },
        { status: 401 }
      );
    }

    const [instructor, studentSession] = await Promise.all([
      validateInstructorSession(token).catch(() => null),
      validateStudentSession(token).catch(() => null),
    ]);

    if (!instructor && !studentSession) {
      return NextResponse.json(
        { error: "Unauthorized: Invalid or expired session credentials." },
        { status: 401 }
      );
    }

    // 4. Enforce Session Ownership for Candidates
    const cleanSession = sessionId ? sessionId.trim() : null;
    let sessionRecord: any = null;

    if (cleanSession) {
      sessionRecord = await getRecordBySessionId(cleanSession);
    }

    if (studentSession && studentSession.student) {
      const candidateReg = studentSession.student.regNo.trim().toLowerCase();

      // Candidates can ONLY access audio associated with their own defense session
      if (!cleanSession) {
        return NextResponse.json(
          { error: "Forbidden: Candidates can only access defense audio via their own 'sessionId'." },
          { status: 403 }
        );
      }

      if (!sessionRecord) {
        return NextResponse.json(
          { error: `Defense session '${cleanSession}' not found.` },
          { status: 404 }
        );
      }

      const sessionStudentReg = (sessionRecord.studentId || "").trim().toLowerCase();
      if (sessionStudentReg !== candidateReg) {
        return NextResponse.json(
          { error: "Forbidden: Candidates are not authorized to access peer defense recordings." },
          { status: 403 }
        );
      }
    }

    // 5. Resolve candidate file paths strictly within allowed storage roots
    const recordingsDir = getRecordingsDir();
    const allowedRoots = [
      path.resolve(recordingsDir),
      "/dev/shm/savan_openviva",
    ];

    const candidatePaths: string[] = [];

    if (filename) {
      const sanitized = path.basename(filename);
      const m4aVariant = sanitized.replace(/\.wav$/i, ".m4a");
      if (m4aVariant !== sanitized) {
        candidatePaths.push(path.join(recordingsDir, m4aVariant));
      }
      candidatePaths.push(path.join(recordingsDir, sanitized));
    }

    if (cleanSession) {
      const cleanSessionSafe = cleanSession.replace(/[^a-zA-Z0-9_\-]/g, "_");

      if (sessionRecord && sessionRecord.recordingUrl) {
        const recUrl = sessionRecord.recordingUrl;
        if (recUrl.startsWith("/") && isContained(recUrl, allowedRoots)) {
          const m4aRecUrl = recUrl.replace(/\.wav$/i, ".m4a");
          if (m4aRecUrl !== recUrl && fs.existsSync(m4aRecUrl)) {
            candidatePaths.push(m4aRecUrl);
          }
          if (fs.existsSync(recUrl)) {
            candidatePaths.push(recUrl);
          }
        } else if (recUrl.includes("filename=")) {
          const m = recUrl.match(/filename=([^&]+)/);
          if (m && m[1]) {
            const parsedName = path.basename(m[1]);
            const m4aParsed = parsedName.replace(/\.wav$/i, ".m4a");
            if (m4aParsed !== parsedName) {
              candidatePaths.push(path.join(recordingsDir, m4aParsed));
            }
            candidatePaths.push(path.join(recordingsDir, parsedName));
          }
        }
      }

      // Prioritize compressed AAC (.m4a) formats for fast streaming and instant scrubbing (Issue 15)
      candidatePaths.push(path.join(recordingsDir, `${cleanSessionSafe}.m4a`));
      candidatePaths.push(path.join(recordingsDir, `${cleanSession}.m4a`));
      candidatePaths.push(path.join(recordingsDir, `${cleanSessionSafe}.mp3`));
      candidatePaths.push(path.join(recordingsDir, `${cleanSessionSafe}.ogg`));
      candidatePaths.push(path.join(recordingsDir, `${cleanSessionSafe}.wav`));
      candidatePaths.push(path.join(recordingsDir, `${cleanSession}.wav`));
    } else if (chamberId) {
      const cleanChamber = chamberId.trim().replace(/[^a-zA-Z0-9_\-]/g, "_");
      candidatePaths.push(path.join(recordingsDir, `${cleanChamber}.m4a`));
      candidatePaths.push(path.join(recordingsDir, `${cleanChamber}.wav`));
      candidatePaths.push(`/dev/shm/savan_openviva/shadow_raw_${cleanChamber}.m4a`);
      candidatePaths.push(`/dev/shm/savan_openviva/shadow_raw_${cleanChamber}.wav`);
      candidatePaths.push(`/dev/shm/savan_openviva/shadow_raw_stack2-chamber-01.m4a`);
      candidatePaths.push(`/dev/shm/savan_openviva/shadow_raw_stack2-chamber-01.wav`);
    }

    // Locate first existing valid file strictly within allowed storage roots
    let targetPath: string | null = null;
    let stat: fs.Stats | null = null;

    for (const p of candidatePaths) {
      try {
        if (p && isContained(p, allowedRoots) && fs.existsSync(p)) {
          const s = fs.statSync(p);
          if (s.isFile() && s.size > 0) {
            targetPath = p;
            stat = s;
            break;
          }
        }
      } catch (statErr) {
        console.debug("[defense/audio] Candidate path stat error:", statErr);
      }
    }

    if (!targetPath || !stat) {
      return NextResponse.json(
        { error: `Recording audio not found for sessionId '${cleanSession || ""}'` },
        { status: 404 }
      );
    }

    // Final root containment boundary check
    if (!isContained(targetPath, allowedRoots)) {
      return NextResponse.json(
        { error: "Access denied: Target file resides outside designated storage roots." },
        { status: 403 }
      );
    }

    // If targetPath is uncompressed WAV, trigger non-blocking background transcode to M4A for subsequent requests
    if (targetPath.endsWith(".wav")) {
      const targetM4a = targetPath.replace(/\.wav$/i, ".m4a");
      if (!fs.existsSync(targetM4a)) {
        triggerBackgroundTranscode(targetPath, targetM4a);
      }
    }

    const fileSize = stat.size;
    const rangeHeader = req.headers.get("range");

    // Determine MIME type with full audio codec coverage
    const ext = path.extname(targetPath).toLowerCase();
    let mimeType = "audio/wav";
    if (ext === ".m4a" || ext === ".mp4") {
      mimeType = "audio/mp4";
    } else if (ext === ".aac") {
      mimeType = "audio/aac";
    } else if (ext === ".mp3") {
      mimeType = "audio/mpeg";
    } else if (ext === ".ogg") {
      mimeType = "audio/ogg";
    } else if (ext === ".wav") {
      mimeType = "audio/wav";
    }

    // 6. Handle HTTP 206 Partial Content (Range: bytes=start-end)
    if (rangeHeader && rangeHeader.startsWith("bytes=")) {
      const rangeParts = rangeHeader.replace("bytes=", "").trim().split("-");
      if (rangeParts.length !== 2) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${fileSize}`,
          },
        });
      }
      const rawStart = rangeParts[0];
      const rawEnd = rangeParts[1];

      let start: number;
      let end: number;

      if (rawStart === "" && rawEnd !== "") {
        // Suffix range: bytes=-500 (last 500 bytes)
        const suffixLength = parseInt(rawEnd, 10);
        if (isNaN(suffixLength) || suffixLength <= 0) {
          return new NextResponse(null, {
            status: 416,
            headers: {
              "Content-Range": `bytes */${fileSize}`,
            },
          });
        }
        start = Math.max(0, fileSize - suffixLength);
        end = fileSize - 1;
      } else {
        start = parseInt(rawStart, 10);
        end = rawEnd ? parseInt(rawEnd, 10) : fileSize - 1;

        if (isNaN(start) || start < 0 || start >= fileSize || (rawEnd && isNaN(end))) {
          return new NextResponse(null, {
            status: 416,
            headers: {
              "Content-Range": `bytes */${fileSize}`,
            },
          });
        }
        end = Math.min(end, fileSize - 1);
      }

      if (start > end) {
        return new NextResponse(null, {
          status: 416,
          headers: {
            "Content-Range": `bytes */${fileSize}`,
          },
        });
      }

      const chunkSize = end - start + 1;
      const fileStream = fs.createReadStream(targetPath, { start, end });
      const webStream = Readable.toWeb(fileStream) as ReadableStream;

      return new NextResponse(webStream, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${fileSize}`,
          "Accept-Ranges": "bytes",
          "Content-Length": chunkSize.toString(),
          "Content-Type": mimeType,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // 7. Handle Full Stream (HTTP 200 OK)
    const fullStream = fs.createReadStream(targetPath);
    const webStream = Readable.toWeb(fullStream) as ReadableStream;

    return new NextResponse(webStream, {
      status: 200,
      headers: {
        "Accept-Ranges": "bytes",
        "Content-Length": fileSize.toString(),
        "Content-Type": mimeType,
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (err: any) {
    console.error("Audio streaming error:", err);
    return NextResponse.json(
      { error: `Internal audio streaming error: ${err.message}` },
      { status: 500 }
    );
  }
}
