import { NextRequest, NextResponse } from "next/server";
import {
  getStudentByRegNo,
  getStudentBiometrics,
  upsertStudentBiometrics,
  createBiometricResetSession,
} from "@/lib/db";
import {
  extractFaceWithTelemetry,
  calculateCosineSimilarity,
  FaceDetectionError,
  SpoofDetectionError,
  BiometricExtractionError,
} from "@/lib/biometrics";
import { checkRateLimit, LeakyBucket } from "@/lib/rateLimit";

function getClientIp(req: NextRequest): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0].trim();
  }
  return req.headers.get("x-real-ip") || "127.0.0.1";
}

// Task 5.3: Biometric Face Password Reset Authorization Threshold (>= 65% match)
export const BIOMETRIC_FACE_RESET_THRESHOLD = 0.65;

export async function POST(req: NextRequest) {
  // 1. Enforce sliding-window LeakyBucket rate limit (Issue 16: Max 10 attempts/min per IP)
  const clientIp = getClientIp(req);
  const rateLimitKey = `auth_reset_face:${clientIp}`;
  const rateLimit = LeakyBucket.check(rateLimitKey, 10, 60000);

  if (!rateLimit.allowed) {
    return NextResponse.json(
      {
        success: false,
        verified: false,
        error: "Too many biometric reset attempts. Please try again later.",
        retryAfter: rateLimit.retryAfter,
      },
      {
        status: 429,
        headers: {
          "Retry-After": `${rateLimit.retryAfter}`,
          "X-RateLimit-Limit": `${rateLimit.limit}`,
          "X-RateLimit-Remaining": "0",
          "X-RateLimit-Reset": `${Math.ceil(rateLimit.resetTime / 1000)}`,
        },
      }
    );
  }

  try {
    const body = await req.json().catch(() => ({}));
    const rawReg = body.regNo || body.reg_no;
    const liveFrameBase64 = body.liveFrameBase64 || body.image || body.frame;

    // 1. Validate registration number
    if (!rawReg || typeof rawReg !== "string" || !rawReg.trim()) {
      return NextResponse.json(
        { success: false, verified: false, error: "Registration number ('regNo') is required." },
        { status: 400 }
      );
    }

    // 2. Validate live webcam snapshot
    if (!liveFrameBase64 || typeof liveFrameBase64 !== "string" || !liveFrameBase64.trim()) {
      return NextResponse.json(
        { success: false, verified: false, error: "Missing live camera portrait snapshot ('liveFrameBase64')." },
        { status: 400 }
      );
    }

    const normalizedReg = rawReg.trim().toLowerCase();

    // 3. Confirm student exists in roster
    const student = await getStudentByRegNo(normalizedReg);
    if (!student) {
      return NextResponse.json(
        { success: false, verified: false, error: `Candidate with registration '${rawReg}' not found in roster.` },
        { status: 404 }
      );
    }

    // 4. Retrieve candidate's enrolled ground-truth biometric record
    const biometrics = await getStudentBiometrics(normalizedReg);
    if (!biometrics || !biometrics.faceEmbedding) {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          error: "No biometric ground truth enrolled for this candidate. Please contact your supervising TA for manual credential recovery.",
        },
        { status: 400 }
      );
    }

    // 5. Decode image snapshot
    const base64Data = liveFrameBase64.replace(/^data:image\/\w+;base64,/, "");
    const probeImageBuffer = Buffer.from(base64Data, "base64");
    if (probeImageBuffer.length < 100) {
      return NextResponse.json(
        { success: false, verified: false, error: "Invalid or corrupted camera snapshot image buffer." },
        { status: 400 }
      );
    }

    // 6. Extract 512-dim facial embedding and evaluate passive anti-spoof liveness
    let liveEmbedding: Buffer;
    let telemetry: any;
    try {
      const extracted = await extractFaceWithTelemetry(probeImageBuffer);
      liveEmbedding = extracted.embedding;
      telemetry = extracted.telemetry;
    } catch (bioErr: any) {
      if (bioErr instanceof FaceDetectionError) {
        return NextResponse.json(
          {
            success: false,
            verified: false,
            error:
              bioErr.code === "NO_FACE_DETECTED"
                ? "No human face found in camera snapshot. Please look directly at the webcam."
                : "Multiple individuals detected. Password reset requires an isolated single-person portrait.",
            reason: bioErr.code,
          },
          { status: 400 }
        );
      }
      if (bioErr instanceof SpoofDetectionError) {
        return NextResponse.json(
          {
            success: false,
            verified: false,
            error: `Presentation attack rejected (${bioErr.spoofType || "PHOTO_ATTACK"}). Passive liveness confidence: ${((bioErr.livenessScore || 0) * 100).toFixed(1)}%. Real human presence required.`,
            reason: "SPOOF_PHOTO_DETECTED",
            livenessScore: bioErr.livenessScore,
            spoofType: bioErr.spoofType,
          },
          { status: 403 }
        );
      }
      if (bioErr instanceof BiometricExtractionError) {
        return NextResponse.json(
          { success: false, verified: false, error: bioErr.message, reason: bioErr.code },
          { status: 400 }
        );
      }
      throw bioErr;
    }

    // Strict passive anti-spoof check: must be classified as live with score >= 0.80
    if (telemetry && (telemetry.isLive === false || (telemetry.livenessScore !== undefined && telemetry.livenessScore < 0.80))) {
      return NextResponse.json(
        {
          success: false,
          verified: false,
          error: `Presentation attack rejected: Passive liveness confidence (${((telemetry.livenessScore || 0) * 100).toFixed(1)}%) is below security threshold (80.0%). Real human presence required.`,
          reason: "SPOOF_PHOTO_DETECTED",
          livenessScore: telemetry.livenessScore,
          spoofType: telemetry.spoofType || "SCREEN_REPLAY_ATTACK",
        },
        { status: 403 }
      );
    }

    // 7. Compute Cosine Similarity against enrolled ground-truth reference
    const referenceEmbedding = Buffer.isBuffer(biometrics.faceEmbedding)
      ? biometrics.faceEmbedding
      : Buffer.from(biometrics.faceEmbedding as any);

    const similarity = calculateCosineSimilarity(referenceEmbedding, liveEmbedding);
    const isVerified = similarity >= BIOMETRIC_FACE_RESET_THRESHOLD;

    // 8. Reject impostors or insufficient resemblance (similarity < 0.65)
    if (!isVerified) {
      await upsertStudentBiometrics({
        regNo: normalizedReg,
        studentName: student.studentName,
        verificationStatus: "FLAGGED",
      });

      return NextResponse.json(
        {
          success: false,
          verified: false,
          similarity: parseFloat(similarity.toFixed(4)),
          threshold: BIOMETRIC_FACE_RESET_THRESHOLD,
          error: `Facial verification rejected: Similarity score (${(similarity * 100).toFixed(1)}%) is below security threshold (${(BIOMETRIC_FACE_RESET_THRESHOLD * 100).toFixed(0)}%). Please adjust lighting or report to your supervising TA.`,
        },
        { status: 403 }
      );
    }

    // 9. Match verified: issue short-lived 5-minute temporary password reset token
    const tempToken = await createBiometricResetSession(normalizedReg);

    // Update biometric verification status to AUTHENTICATED
    await upsertStudentBiometrics({
      regNo: normalizedReg,
      studentName: student.studentName,
      verificationStatus: "AUTHENTICATED",
    });

    const res = NextResponse.json({
      success: true,
      verified: true,
      similarity: parseFloat(similarity.toFixed(4)),
      threshold: BIOMETRIC_FACE_RESET_THRESHOLD,
      tempToken,
      expiresInSeconds: 300,
      student: {
        regNo: student.regNo,
        studentName: student.studentName,
        department: student.department,
      },
    });

    // Set HTTP-only short-lived temp session cookie
    res.cookies.set("openviva_student_temp", tempToken, {
      path: "/",
      httpOnly: true,
      sameSite: "lax",
      maxAge: 300, // 5 minutes
    });

    return res;
  } catch (err: any) {
    console.error("POST /api/auth/reset-password-face error:", err);
    return NextResponse.json(
      { success: false, verified: false, error: err.message || "Failed to process biometric face reset." },
      { status: 500 }
    );
  }
}
