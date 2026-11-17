import { NextRequest, NextResponse } from "next/server";
import * as path from "path";
import * as fs from "fs";
import {
  validateStudentSession,
  getBiometricsFacesDir,
  getBiometricsVoicesDir,
  upsertStudentBiometrics,
} from "@/lib/db";
import {
  extractBiometrics,
  FaceDetectionError,
  SpoofDetectionError,
  BiometricExtractionError,
  FACE_EMBEDDING_BYTES,
  VOICE_EMBEDDING_BYTES,
} from "@/lib/biometrics";

export async function POST(req: NextRequest) {
  let tempFacePath: string | null = null;
  let tempVoicePath: string | null = null;

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
        { success: false, error: "Unauthorized: Missing authentication token." },
        { status: 401 }
      );
    }

    const sessionData = await validateStudentSession(token);
    if (!sessionData || !sessionData.student) {
      return NextResponse.json(
        { success: false, error: "Unauthorized: Invalid or expired session." },
        { status: 401 }
      );
    }

    const { student } = sessionData;
    const normalizedReg = student.regNo.toLowerCase();

    // 2. Parse request payload (supports both multipart/form-data and application/json)
    const contentType = req.headers.get("content-type") || "";
    let faceImageBase64: string | null = null;
    let voiceAudioBuffer: Buffer | null = null;
    let studentName: string = student.studentName;

    if (contentType.includes("multipart/form-data")) {
      const formData = await req.formData();
      faceImageBase64 = formData.get("faceImageBase64") as string | null;
      const voiceFile = formData.get("voiceAudio") as File | null;
      const nameInput = formData.get("studentName") as string | null;
      if (nameInput) studentName = nameInput;

      if (voiceFile) {
        const ab = await voiceFile.arrayBuffer();
        voiceAudioBuffer = Buffer.from(ab);
      }
    } else {
      const body = await req.json().catch(() => ({}));
      faceImageBase64 = body.faceImageBase64 || null;
      if (body.studentName) studentName = body.studentName;

      if (body.voiceAudioBase64 && typeof body.voiceAudioBase64 === "string") {
        const voiceB64 = body.voiceAudioBase64.replace(/^data:audio\/\w+;base64,/, "");
        voiceAudioBuffer = Buffer.from(voiceB64, "base64");
      }
    }

    if (!faceImageBase64 || typeof faceImageBase64 !== "string") {
      return NextResponse.json(
        { success: false, error: "Missing required face portrait capture ('faceImageBase64')." },
        { status: 400 }
      );
    }

    if (!voiceAudioBuffer || voiceAudioBuffer.length === 0) {
      return NextResponse.json(
        { success: false, error: "Missing required voice audio recording ('voiceAudio')." },
        { status: 400 }
      );
    }

    // 3. Decode probe face portrait
    const faceBase64Data = faceImageBase64.replace(/^data:image\/\w+;base64,/, "");
    const faceImageBuffer = Buffer.from(faceBase64Data, "base64");
    if (faceImageBuffer.length < 100) {
      return NextResponse.json(
        { success: false, error: "Invalid or corrupted face portrait image buffer." },
        { status: 400 }
      );
    }

    if (voiceAudioBuffer.length < 100) {
      return NextResponse.json(
        { success: false, error: "Invalid or corrupted voice audio recording buffer." },
        { status: 400 }
      );
    }

    // 4. Stage temporarily for pre-validation (prevents corrupting sealed storage if validation fails)
    const facesDir = getBiometricsFacesDir();
    const voicesDir = getBiometricsVoicesDir();
    const stagingId = `${normalizedReg}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

    tempFacePath = path.join(facesDir, `temp_enroll_${stagingId}.jpg`);
    tempVoicePath = path.join(voicesDir, `temp_enroll_${stagingId}.wav`);

    fs.writeFileSync(tempFacePath, faceImageBuffer);
    fs.writeFileSync(tempVoicePath, voiceAudioBuffer);

    // 5. Extract 512-dim ArcFace facial vector (2,048 bytes) and 192-dim acoustic voice vector (768 bytes)
    let faceEmbedding: Buffer;
    let voiceEmbedding: Buffer;
    let telemetry: any;

    try {
      const extracted = await extractBiometrics(tempFacePath, tempVoicePath);
      faceEmbedding = extracted.faceEmbedding;
      voiceEmbedding = extracted.voiceEmbedding;
      telemetry = extracted.telemetry;
    } catch (bioErr: any) {
      if (bioErr instanceof FaceDetectionError) {
        return NextResponse.json(
          {
            success: false,
            reason: bioErr.code,
            error: bioErr.message,
            message:
              bioErr.code === "NO_FACE_DETECTED"
                ? "No human face found in enrollment portrait. Please ensure clear lighting and position your face in the center."
                : "Multiple individuals detected in portrait. Enrollment requires an isolated single-person portrait.",
          },
          { status: 400 }
        );
      }
      if (bioErr instanceof SpoofDetectionError) {
        return NextResponse.json(
          {
            success: false,
            reason: "SPOOF_PHOTO_DETECTED",
            error: bioErr.message,
            message: `Enrollment rejected: Presentation attack detected (${bioErr.spoofType || "PHOTO_ATTACK"}). Passive liveness confidence: ${((bioErr.livenessScore || 0) * 100).toFixed(1)}%. Real human presence required.`,
            livenessScore: bioErr.livenessScore,
            spoofType: bioErr.spoofType,
            spoofProbabilities: bioErr.spoofProbabilities,
          },
          { status: 400 }
        );
      }
      if (bioErr instanceof BiometricExtractionError) {
        return NextResponse.json(
          {
            success: false,
            reason: bioErr.code,
            error: bioErr.message,
            message: bioErr.message,
          },
          { status: 400 }
        );
      }
      throw bioErr;
    }

    // Double-check byte vector contract integrity
    if (faceEmbedding.length !== FACE_EMBEDDING_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `Face embedding vector dimension mismatch: expected ${FACE_EMBEDDING_BYTES} bytes, got ${faceEmbedding.length}`,
        },
        { status: 500 }
      );
    }
    if (voiceEmbedding.length !== VOICE_EMBEDDING_BYTES) {
      return NextResponse.json(
        {
          success: false,
          error: `Voice embedding vector dimension mismatch: expected ${VOICE_EMBEDDING_BYTES} bytes, got ${voiceEmbedding.length}`,
        },
        { status: 500 }
      );
    }

    // 6. Seal verified biometric media to permanent candidate storage
    const faceFileName = `${normalizedReg}.jpg`;
    const faceFilePath = path.join(facesDir, faceFileName);
    fs.writeFileSync(faceFilePath, faceImageBuffer);

    const voiceFileName = `${normalizedReg}.wav`;
    const voiceFilePath = path.join(voicesDir, voiceFileName);
    fs.writeFileSync(voiceFilePath, voiceAudioBuffer);

    // 7. Commit sealed ground truth to SQLite student_biometrics
    const nowIso = new Date().toISOString();
    const ip = req.headers.get("x-forwarded-for") || "127.0.0.1";
    const userAgent = req.headers.get("user-agent") || "OpenViva Browser Client";

    await upsertStudentBiometrics({
      regNo: normalizedReg,
      studentName,
      faceImagePath: path.relative(process.cwd(), faceFilePath),
      faceEmbedding,
      faceEnrolledAt: nowIso,
      voiceSamplePath: path.relative(process.cwd(), voiceFilePath),
      voiceEmbedding,
      voiceEnrolledAt: nowIso,
      enrolledIpAddress: ip,
      enrolledUserAgent: userAgent,
      verificationStatus: "AUTHENTICATED",
    });

    return NextResponse.json({
      success: true,
      message: "Biometric identity ground truth sealed successfully with 512-d ArcFace and 192-d voice embeddings.",
      biometrics: {
        regNo: normalizedReg,
        studentName,
        faceImagePath: path.relative(process.cwd(), faceFilePath),
        faceEmbeddingBytes: faceEmbedding.length,
        voiceAudioPath: path.relative(process.cwd(), voiceFilePath),
        voiceEmbeddingBytes: voiceEmbedding.length,
        enrolledAt: nowIso,
        verificationStatus: "AUTHENTICATED",
        telemetry,
      },
    });
  } catch (err: any) {
    console.error("POST /api/auth/enroll-biometrics error:", err);
    return NextResponse.json(
      { success: false, error: err.message || "Failed to seal biometric ground truth." },
      { status: 500 }
    );
  } finally {
    // 8. Safely remove staging files
    if (tempFacePath && fs.existsSync(tempFacePath)) {
      try {
        fs.unlinkSync(tempFacePath);
      } catch (unlinkErr) {
        console.debug("[enroll-biometrics] Temp face unlink warning:", unlinkErr);
      }
    }
    if (tempVoicePath && fs.existsSync(tempVoicePath)) {
      try {
        fs.unlinkSync(tempVoicePath);
      } catch (unlinkErr) {
        console.debug("[enroll-biometrics] Temp voice unlink warning:", unlinkErr);
      }
    }
  }
}
