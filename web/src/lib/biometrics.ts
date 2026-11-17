import * as path from "path";
import * as fs from "fs";

export const FACE_EMBEDDING_BYTES = 2048; // 512 float32 values
export const VOICE_EMBEDDING_BYTES = 768; // 192 float32 values
export const BIOMETRIC_SIMILARITY_THRESHOLD = 0.62; // Calibrated ArcFace 512-d threshold
export const BIOMETRIC_DAEMON_URL = process.env.BIOMETRIC_DAEMON_URL || "http://127.0.0.1:8002";

export class FaceDetectionError extends Error {
  public code: "NO_FACE_DETECTED" | "MULTIPLE_FACES_DETECTED" | "DETECTION_ERROR";
  constructor(message: string, code: "NO_FACE_DETECTED" | "MULTIPLE_FACES_DETECTED" | "DETECTION_ERROR" = "DETECTION_ERROR") {
    super(message);
    this.name = "FaceDetectionError";
    this.code = code;
  }
}

export class SpoofDetectionError extends Error {
  public code: "SPOOF_PHOTO_DETECTED";
  public livenessScore: number;
  public spoofType?: string | null;
  public spoofProbabilities?: Record<string, number>;

  constructor(
    message: string,
    livenessScore = 0.0,
    spoofType?: string | null,
    spoofProbabilities?: Record<string, number>
  ) {
    super(message);
    this.name = "SpoofDetectionError";
    this.code = "SPOOF_PHOTO_DETECTED";
    this.livenessScore = livenessScore;
    this.spoofType = spoofType;
    this.spoofProbabilities = spoofProbabilities;
  }
}

export class BiometricExtractionError extends Error {
  public code: string;
  constructor(message: string, code = "EXTRACTION_FAILURE") {
    super(message);
    this.name = "BiometricExtractionError";
    this.code = code;
  }
}

export interface FaceTelemetryData {
  faceDetected: boolean;
  detectionScore?: number;
  faceBox?: [number, number, number, number];
  landmarks?: [number, number][];
  facesCount?: number;
  isLive?: boolean;
  livenessScore?: number;
  spoofType?: string | null;
  spoofProbabilities?: {
    real: number;
    print_attack: number;
    replay_attack: number;
  };
  alignedSize?: [number, number];
  alignmentStatus?: string;
  illuminationStatus?: string;
  embeddingModel?: string;
  embeddingDim?: number;
  embeddingL2Norm?: number;
}

export interface BiometricEmbeddings {
  faceEmbedding: Buffer;  // 512 float32 = 2048 bytes
  voiceEmbedding: Buffer; // 192 float32 = 768 bytes
  telemetry?: FaceTelemetryData;
}

export interface FaceExtractionResult {
  embedding: Buffer;
  telemetry: FaceTelemetryData;
}

/**
 * Queries the persistent in-memory Biometric Daemon (Task 9.2).
 * Fails fast with typed BiometricExtractionError if daemon is unreachable.
 * STRICT ZERO-FALLBACK: No subprocess cold starts, no CPU-burning CLI execution.
 */
async function queryBiometricDaemon(endpoint: string, payload: Record<string, any>): Promise<any> {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 10000);
  let res: Response;
  try {
    res = await fetch(`${BIOMETRIC_DAEMON_URL}${endpoint}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
  } catch (err: any) {
    clearTimeout(timeoutId);
    throw new BiometricExtractionError(
      `Biometric daemon unreachable at ${BIOMETRIC_DAEMON_URL}: ${err?.message || err}. Ensure openviva-bio-daemon is running.`,
      "DAEMON_UNAVAILABLE"
    );
  } finally {
    clearTimeout(timeoutId);
  }

  let data: any;
  try {
    data = await res.json();
  } catch (parseErr: any) {
    throw new BiometricExtractionError(
      `Biometric daemon returned malformed response (HTTP ${res.status}): ${parseErr?.message || parseErr}`,
      "INVALID_RESPONSE"
    );
  }

  if (!data.success) {
    const errCode = data.error || "EXTRACTION_FAILURE";
    const errMsg = data.message || "Biometric feature extraction rejected";

    if (errCode === "NO_FACE_DETECTED") {
      throw new FaceDetectionError(errMsg, "NO_FACE_DETECTED");
    }
    if (errCode === "MULTIPLE_FACES_DETECTED") {
      throw new FaceDetectionError(errMsg, "MULTIPLE_FACES_DETECTED");
    }
    if (errCode === "SPOOF_PHOTO_DETECTED") {
      throw new SpoofDetectionError(
        errMsg,
        data.liveness_score || 0.0,
        data.spoof_type,
        data.spoof_probabilities
      );
    }
    throw new BiometricExtractionError(errMsg, errCode);
  }

  return data;
}

/**
 * Extracts 512-dim facial embedding (2048 bytes) and 192-dim acoustic voice embedding (768 bytes).
 * Zero cloud reliance: executes persistent in-memory SCRFD-500M + MiniFASNet-V2 + MobileFaceNet ArcFace.
 * Throws explicit typed errors on detection failures or spoof attempts. Zero fallbacks.
 */
export async function extractBiometrics(
  faceImagePath: string,
  voiceAudioPath: string
): Promise<BiometricEmbeddings> {
  if (!fs.existsSync(faceImagePath)) {
    throw new BiometricExtractionError(`Face image file does not exist: ${faceImagePath}`, "FILE_NOT_FOUND");
  }
  if (!fs.existsSync(voiceAudioPath)) {
    throw new BiometricExtractionError(`Voice audio file does not exist: ${voiceAudioPath}`, "FILE_NOT_FOUND");
  }

  const data = await queryBiometricDaemon("/extract-biometrics", {
    face_image_path: faceImagePath,
    voice_audio_path: voiceAudioPath,
  });

  if (!data.face_embedding_base64 || !data.voice_embedding_base64) {
    throw new BiometricExtractionError("Missing embedding vectors in daemon response", "INVALID_RESPONSE");
  }

  const faceBuf = Buffer.from(data.face_embedding_base64, "base64");
  const voiceBuf = Buffer.from(data.voice_embedding_base64, "base64");

  if (faceBuf.length !== FACE_EMBEDDING_BYTES) {
    throw new BiometricExtractionError(
      `Face embedding byte length mismatch: expected ${FACE_EMBEDDING_BYTES}, got ${faceBuf.length}`,
      "INVALID_EMBEDDING_LENGTH"
    );
  }
  if (voiceBuf.length !== VOICE_EMBEDDING_BYTES) {
    throw new BiometricExtractionError(
      `Voice embedding byte length mismatch: expected ${VOICE_EMBEDDING_BYTES}, got ${voiceBuf.length}`,
      "INVALID_EMBEDDING_LENGTH"
    );
  }

  const telemetry: FaceTelemetryData = {
    faceDetected: data.face_detected ?? true,
    detectionScore: data.detection_score,
    faceBox: data.face_box,
    landmarks: data.landmarks,
    facesCount: data.faces_count ?? 1,
    isLive: data.is_live ?? true,
    livenessScore: data.liveness_score,
    spoofType: data.spoof_type,
    spoofProbabilities: data.spoof_probabilities,
    alignedSize: data.aligned_size,
    alignmentStatus: data.alignment_status,
    illuminationStatus: data.illumination_status,
    embeddingModel: data.embedding_model,
    embeddingDim: data.embedding_dim,
    embeddingL2Norm: data.embedding_l2_norm,
  };

  return {
    faceEmbedding: faceBuf,
    voiceEmbedding: voiceBuf,
    telemetry,
  };
}

/**
 * Extracts 512-dim ArcFace embedding with rich telemetry from a face image.
 * Uses persistent in-memory daemon (<40ms inference). Zero subprocess cold-start fallbacks.
 */
export async function extractFaceWithTelemetry(
  faceInput: string | Buffer
): Promise<FaceExtractionResult> {
  let tempFilePath: string | null = null;
  let faceImagePath: string;

  if (Buffer.isBuffer(faceInput)) {
    const storageBase = path.resolve(process.cwd(), "storage", "biometrics", "faces");
    if (!fs.existsSync(storageBase)) {
      fs.mkdirSync(storageBase, { recursive: true });
    }
    tempFilePath = path.join(storageBase, `probe_${Date.now()}_${Math.random().toString(36).slice(2, 8)}.jpg`);
    fs.writeFileSync(tempFilePath, faceInput);
    faceImagePath = tempFilePath;
  } else {
    faceImagePath = faceInput;
  }

  try {
    if (!fs.existsSync(faceImagePath)) {
      throw new BiometricExtractionError(`Face image file does not exist: ${faceImagePath}`, "FILE_NOT_FOUND");
    }

    const data = await queryBiometricDaemon("/extract-face", {
      face_image_path: faceImagePath,
    });

    if (!data.face_embedding_base64) {
      throw new BiometricExtractionError("Missing face embedding in daemon response", "INVALID_RESPONSE");
    }

    const faceBuf = Buffer.from(data.face_embedding_base64, "base64");
    if (faceBuf.length !== FACE_EMBEDDING_BYTES) {
      throw new BiometricExtractionError(
        `Face embedding byte length mismatch: expected ${FACE_EMBEDDING_BYTES}, got ${faceBuf.length}`,
        "INVALID_EMBEDDING_LENGTH"
      );
    }

    const telemetry: FaceTelemetryData = {
      faceDetected: data.face_detected ?? true,
      detectionScore: data.detection_score,
      faceBox: data.face_box,
      landmarks: data.landmarks,
      facesCount: data.faces_count ?? 1,
      isLive: data.is_live ?? true,
      livenessScore: data.liveness_score,
      spoofType: data.spoof_type,
      spoofProbabilities: data.spoof_probabilities,
      alignedSize: data.aligned_size,
      alignmentStatus: data.alignment_status,
      illuminationStatus: data.illumination_status,
      embeddingModel: data.embedding_model,
      embeddingDim: data.embedding_dim,
      embeddingL2Norm: data.embedding_l2_norm,
    };

    return {
      embedding: faceBuf,
      telemetry,
    };
  } finally {
    if (tempFilePath && fs.existsSync(tempFilePath)) {
      try {
        fs.unlinkSync(tempFilePath);
      } catch (unlinkErr) {
        console.debug("[biometrics] Temp file unlink warning:", unlinkErr);
      }
    }
  }
}

/**
 * Extracts a 512-dim L2-normalized float32 facial embedding (2048 bytes) from a face image.
 * Convenience wrapper returning raw Buffer for backwards compatibility.
 */
export async function extractFaceOnlyEmbedding(faceInput: string | Buffer): Promise<Buffer> {
  const result = await extractFaceWithTelemetry(faceInput);
  return result.embedding;
}

/**
 * Calculates Cosine Similarity between two 512-dim L2-normalized float32 embedding buffers.
 * Returns a value between -1.0 and 1.0 (where >= 0.62 denotes a verified neural match).
 * Strictly requires both buffers to be exactly 2048 bytes (512 float32 values).
 */
export function calculateCosineSimilarity(bufA: Buffer | Uint8Array, bufB: Buffer | Uint8Array): number {
  if (bufA.length !== FACE_EMBEDDING_BYTES || bufB.length !== FACE_EMBEDDING_BYTES) {
    throw new Error(
      `Invalid buffer lengths for ArcFace 512-d similarity calculation: expected ${FACE_EMBEDDING_BYTES} bytes, got ${bufA.length} vs ${bufB.length}`
    );
  }

  const bA = Buffer.isBuffer(bufA) ? bufA : Buffer.from(bufA.buffer, bufA.byteOffset, bufA.byteLength);
  const bB = Buffer.isBuffer(bufB) ? bufB : Buffer.from(bufB.buffer, bufB.byteOffset, bufB.byteLength);

  let dotProduct = 0;
  let normA = 0;
  let normB = 0;

  for (let i = 0; i < 512; i++) {
    const valA = bA.readFloatLE(i * 4);
    const valB = bB.readFloatLE(i * 4);
    if (!isNaN(valA) && !isNaN(valB)) {
      dotProduct += valA * valB;
      normA += valA * valA;
      normB += valB * valB;
    }
  }

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  if (denom === 0) return 0;
  return Math.max(-1.0, Math.min(1.0, dotProduct / denom));
}
