import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";
import { validateStudentSession, getStudentBiometrics, upsertStudentBiometrics } from "@/lib/db";
import {
  extractFaceWithTelemetry,
  calculateCosineSimilarity,
  BIOMETRIC_SIMILARITY_THRESHOLD,
  FaceDetectionError,
  SpoofDetectionError,
  BiometricExtractionError,
} from "@/lib/biometrics";

function getStorageBaseDir(): string {
  const parentStorage = path.resolve(process.cwd(), "..", "storage");
  const localStorage = path.resolve(process.cwd(), "storage");
  if (fs.existsSync(parentStorage)) return parentStorage;
  if (fs.existsSync(localStorage)) return localStorage;
  return parentStorage;
}

// Calibrated ArcFace 512-d Angular Margin Threshold (62% similarity)
export const BIOMETRIC_MATCH_THRESHOLD = BIOMETRIC_SIMILARITY_THRESHOLD;

export async function POST(req: NextRequest) {
  try {
    // 1. Authenticate candidate session
    const authHeader = req.headers.get("authorization");
    let token = authHeader ? authHeader.replace(/^Bearer\s+/i, "") : null;

    if (!token) {
      token =
        req.cookies?.get("openviva_student_session")?.value ||
        req.cookies?.get("openviva_student_temp")?.value ||
        null;
    }

    if (!token) {
      return NextResponse.json(
        { verified: false, error: "Unauthorized: Missing authentication token." },
        { status: 401 }
      );
    }

    const sessionData = await validateStudentSession(token);
    if (!sessionData || !sessionData.student) {
      return NextResponse.json(
        { verified: false, error: "Unauthorized: Invalid or expired session." },
        { status: 401 }
      );
    }

    const { student } = sessionData;
    const normalizedReg = student.regNo.toLowerCase();

    // 2. Parse request body
    const body = await req.json().catch(() => ({}));
    const { liveFrameBase64 } = body;

    if (!liveFrameBase64 || typeof liveFrameBase64 !== "string") {
      return NextResponse.json(
        { verified: false, error: "Missing live camera frame snapshot ('liveFrameBase64')." },
        { status: 400 }
      );
    }

    // 3. Fetch candidate's sealed ground truth reference
    const record = await getStudentBiometrics(normalizedReg);
    if (!record || !record.faceEmbedding) {
      return NextResponse.json(
        {
          verified: false,
          error: "Biometric ground truth is not sealed. Please complete initial enrollment first.",
        },
        { status: 400 }
      );
    }

    // 4. Extract 512-dim ArcFace embedding & full detection/liveness telemetry
    const base64Data = liveFrameBase64.replace(/^data:image\/\w+;base64,/, "");
    const probeImageBuffer = Buffer.from(base64Data, "base64");
    if (probeImageBuffer.length < 100) {
      return NextResponse.json(
        { verified: false, error: "Invalid or corrupted camera snapshot image buffer." },
        { status: 400 }
      );
    }

    let liveEmbedding: Buffer;
    let telemetry: any;

    try {
      const extracted = await extractFaceWithTelemetry(probeImageBuffer);
      liveEmbedding = extracted.embedding;
      telemetry = extracted.telemetry;
    } catch (faceErr: any) {
      if (faceErr instanceof FaceDetectionError) {
        return NextResponse.json(
          {
            verified: false,
            reason: faceErr.code,
            error: faceErr.message,
            message: faceErr.code === "NO_FACE_DETECTED"
              ? "No human face found in camera frame. Please position your face clearly in the center."
              : "Multiple individuals detected in frame. Only one candidate permitted during verification.",
          },
          { status: 400 }
        );
      }
      if (faceErr instanceof SpoofDetectionError) {
        return NextResponse.json(
          {
            verified: false,
            reason: "SPOOF_PHOTO_DETECTED",
            error: faceErr.message,
            message: `Presentation attack detected (${faceErr.spoofType || "PHOTO_ATTACK"}). Passive liveness confidence: ${((faceErr.livenessScore || 0) * 100).toFixed(1)}%. Real human candidate required.`,
            livenessScore: faceErr.livenessScore,
            spoofType: faceErr.spoofType,
            spoofProbabilities: faceErr.spoofProbabilities,
          },
          { status: 400 }
        );
      }
      if (faceErr instanceof BiometricExtractionError) {
        return NextResponse.json(
          {
            verified: false,
            reason: faceErr.code,
            error: faceErr.message,
            message: faceErr.message,
          },
          { status: 400 }
        );
      }
      throw faceErr;
    }

    // 5. Compute Cosine Similarity against enrolled reference
    const referenceEmbedding = Buffer.isBuffer(record.faceEmbedding)
      ? record.faceEmbedding
      : Buffer.from(record.faceEmbedding as any);

    const similarity = calculateCosineSimilarity(referenceEmbedding, liveEmbedding);
    const isVerified = similarity >= BIOMETRIC_MATCH_THRESHOLD;

    // 6. Update verification status in SQLite
    await upsertStudentBiometrics({
      regNo: normalizedReg,
      studentName: student.studentName,
      verificationStatus: isVerified ? "AUTHENTICATED" : "FLAGGED",
      lastFaceSimilarity: parseFloat(similarity.toFixed(4)),
      lastLivenessScore: telemetry?.livenessScore ? parseFloat(telemetry.livenessScore.toFixed(4)) : (isVerified ? 0.99 : 0.0),
    });

    // 7. Persist live chamber entry keyframe
    if (isVerified) {
      try {
        const storageDir = getStorageBaseDir();
        const facesDir = path.join(storageDir, "biometrics", "faces");
        const keyframesDir = path.join(storageDir, "biometrics", "keyframes");
        fs.mkdirSync(facesDir, { recursive: true });
        fs.mkdirSync(keyframesDir, { recursive: true });

        // Subtask 3.1: Strict Path Sanitization & Canonical Boundary Containment for candidate keyframe
        const rawReg = normalizedReg.trim();
        if (/^[a-zA-Z0-9_\-]{1,64}$/.test(rawReg)) {
          const cleanReg = path.basename(rawReg);
          const candidateKeyframePath = path.resolve(facesDir, `${cleanReg}_keyframe.jpg`);
          const facesRoot = facesDir.endsWith(path.sep) ? facesDir : facesDir + path.sep;
          if (candidateKeyframePath.startsWith(facesRoot)) {
            fs.writeFileSync(candidateKeyframePath, probeImageBuffer);
          } else {
            console.warn(`[SECURITY ALERT] Boundary escape blocked for candidate keyframe: ${rawReg}`);
          }
        }

        // Subtask 3.1: Strict Path Sanitization & Canonical Boundary Containment for session keyframe
        if (body.sessionId && typeof body.sessionId === "string") {
          const rawSessionId = body.sessionId.trim();
          if (/^[a-zA-Z0-9_\-]{1,64}$/.test(rawSessionId)) {
            const cleanSessionId = path.basename(rawSessionId);
            const sessionKeyframePath = path.resolve(keyframesDir, `${cleanSessionId}.jpg`);
            const keyframesRoot = keyframesDir.endsWith(path.sep) ? keyframesDir : keyframesDir + path.sep;
            if (sessionKeyframePath.startsWith(keyframesRoot)) {
              fs.writeFileSync(sessionKeyframePath, probeImageBuffer);
            } else {
              console.warn(`[SECURITY ALERT] Boundary escape blocked for sessionId: ${rawSessionId}`);
            }
          } else {
            console.warn(`[SECURITY ALERT] Invalid sessionId rejected by path traversal filter: ${rawSessionId}`);
          }
        }
      } catch (saveErr) {
        console.warn("Failed to persist live biometric keyframe:", saveErr);
      }
    }

    if (isVerified) {
      return NextResponse.json({
        verified: true,
        similarity: parseFloat(similarity.toFixed(4)),
        threshold: BIOMETRIC_MATCH_THRESHOLD,
        studentName: student.studentName,
        regNo: student.regNo,
        telemetry,
        message: "Identity verified successfully. Chamber admission authorized.",
      });
    } else {
      return NextResponse.json({
        verified: false,
        similarity: parseFloat(similarity.toFixed(4)),
        threshold: BIOMETRIC_MATCH_THRESHOLD,
        studentName: student.studentName,
        regNo: student.regNo,
        telemetry,
        message: `Facial match score (${(similarity * 100).toFixed(1)}%) is below authorization threshold (${(BIOMETRIC_MATCH_THRESHOLD * 100).toFixed(0)}%). Access denied.`,
      });
    }
  } catch (err: any) {
    console.error("POST /api/auth/verify-gate error:", err);
    return NextResponse.json(
      { verified: false, error: err.message || "Failed to process biometric verification." },
      { status: 500 }
    );
  }
}
