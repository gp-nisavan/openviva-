
const path = require('path');
const fs = require('fs');

console.log("=" .repeat(80));
console.log("TASK 3.1 EMPIRICAL & EDGE-CASE TEST SUITE: BACKEND GATEWAY BIOMETRICS (TS/JS)");
console.log("Tasks 1.1, 1.2, 2.1, 2.2, 2.3, 2.4 & 3.1 In Full Combination Across Real Candidate Instances");
console.log("=" .repeat(80));

// We compile/require biometrics.ts via ts-node or transpile using ts
// Let's check if ts-node is available, or use compiled JS / tsx
const {
  extractBiometrics,
  extractFaceOnlyEmbedding,
  extractFaceWithTelemetry,
  calculateCosineSimilarity,
  FaceDetectionError,
  SpoofDetectionError,
  BiometricExtractionError,
  BIOMETRIC_SIMILARITY_THRESHOLD,
  FACE_EMBEDDING_BYTES,
  VOICE_EMBEDDING_BYTES
} = require('/home/savan/openviva/web/dist_test/biometrics.js');

const testResults = [];

function recordTest(name, passed, details = "") {
  const status = passed ? "PASS" : "FAIL";
  testResults.push({ name, passed, details });
  console.log(`[${status}] ${name}`);
  if (details) {
    console.log(`       Details: ${details}`);
  }
}

async function runTests() {
  const reg1Path = "/home/savan/openviva/storage/biometrics/faces/reg1.jpg";
  const reg1KeyframePath = "/home/savan/openviva/storage/biometrics/faces/reg1_keyframe.jpg";
  const reg9Path = "/home/savan/openviva/storage/biometrics/faces/reg9.jpg";
  const voicePath = "/home/savan/openviva/storage/biometrics/voice/reg1.wav";
  const blackPath = "/tmp/edge_cases_bio/black.jpg";
  const multiPath = "/home/savan/openviva/storage/biometrics/faces/reg7.jpg";

  // =========================================================================
  // TEST 1: CONSTANTS & PURGED SHA-512 FALLBACK SANITY
  // =========================================================================
  console.log("\n--- TEST 1: Constants & Clean Export Contracts ---");
  recordTest("Contract 1.1: FACE_EMBEDDING_BYTES === 2048", FACE_EMBEDDING_BYTES === 2048, `Value: ${FACE_EMBEDDING_BYTES}`);
  recordTest("Contract 1.2: VOICE_EMBEDDING_BYTES === 768", VOICE_EMBEDDING_BYTES === 768, `Value: ${VOICE_EMBEDDING_BYTES}`);
  recordTest("Contract 1.3: BIOMETRIC_SIMILARITY_THRESHOLD === 0.62", BIOMETRIC_SIMILARITY_THRESHOLD === 0.62, `Value: ${BIOMETRIC_SIMILARITY_THRESHOLD}`);

  // Inspect source code of biometrics.ts to mathematically guarantee zero sha512 fallback
  const sourceCode = fs.readFileSync("/home/savan/openviva/web/src/lib/biometrics.ts", "utf8");
  const hasSha512 = sourceCode.includes("sha512") || sourceCode.includes("createHash");
  recordTest("Verification 1.4: Complete Elimination of SHA-512 Mock Fallback", !hasSha512, 
             hasSha512 ? "FAIL: Found sha512 reference in source!" : "Verified zero sha512 or createHash references");

  // =========================================================================
  // TEST 2: FAIL-CLOSED EXCEPTION HANDLING (ZERO SHA-512 FALLBACK PROOF)
  // =========================================================================
  console.log("\n--- TEST 2: Fail-Closed Typed Error Handling ---");
  
  // 2.1 Zero-Face image MUST throw FaceDetectionError (not create fake hash vector)
  try {
    await extractFaceOnlyEmbedding(blackPath);
    recordTest("Fail-Closed 2.1: Zero-Face Image Throws FaceDetectionError", false, "Allowed zero-face image to generate embedding!");
  } catch (err) {
    const isFaceErr = err instanceof FaceDetectionError;
    const isCodeOk = err.code === "NO_FACE_DETECTED";
    recordTest("Fail-Closed 2.1: Zero-Face Image Throws FaceDetectionError", isFaceErr && isCodeOk, 
               `Caught: ${err.name} (code: ${err.code}) | Msg: ${err.message}`);
  }

  // 2.2 Multi-Person image MUST throw FaceDetectionError (MULTIPLE_FACES_DETECTED)
  try {
    await extractFaceOnlyEmbedding(multiPath);
    recordTest("Fail-Closed 2.2: Multi-Person Image Throws FaceDetectionError", false, "Allowed multi-person image to generate embedding!");
  } catch (err) {
    const isFaceErr = err instanceof FaceDetectionError;
    const isCodeOk = err.code === "MULTIPLE_FACES_DETECTED";
    recordTest("Fail-Closed 2.2: Multi-Person Image Throws FaceDetectionError", isFaceErr && isCodeOk,
               `Caught: ${err.name} (code: ${err.code}) | Msg: ${err.message}`);
  }

  // 2.3 Non-existent file MUST throw BiometricExtractionError (FILE_NOT_FOUND)
  try {
    await extractFaceOnlyEmbedding("/tmp/non_existent_image_12345.jpg");
    recordTest("Fail-Closed 2.3: Non-Existent File Throws Error", false, "Allowed non-existent file!");
  } catch (err) {
    recordTest("Fail-Closed 2.3: Non-Existent File Throws Error", err instanceof BiometricExtractionError,
               `Caught: ${err.name} (code: ${err.code})`);
  }

  // =========================================================================
  // TEST 3: REAL CANDIDATE EXTRACTION & RICH TELEMETRY SCHEMA
  // =========================================================================
  console.log("\n--- TEST 3: Real Candidate Extraction & Rich Telemetry ---");
  try {
    const { embedding, telemetry } = await extractFaceWithTelemetry(reg1Path);
    
    const embOk = Buffer.isBuffer(embedding) && embedding.length === 2048;
    const floats = new Float32Array(embedding.buffer, embedding.byteOffset, 512);
    let sumSq = 0;
    for (let i = 0; i < 512; i++) sumSq += floats[i] * floats[i];
    const norm = Math.sqrt(sumSq);
    const normOk = Math.abs(norm - 1.0) < 1e-4;

    const telemOk = (
      telemetry.faceDetected === true &&
      telemetry.isLive === true &&
      telemetry.livenessScore >= 0.80 &&
      telemetry.alignmentStatus === "UMEYAMA_ALIGNED_112X112" &&
      telemetry.illuminationStatus === "OPTIMAL_EQUALIZED" &&
      telemetry.embeddingModel === "MobileFaceNet-ArcFace-512" &&
      telemetry.embeddingDim === 512 &&
      Array.isArray(telemetry.landmarks) && telemetry.landmarks.length === 5 &&
      Array.isArray(telemetry.faceBox) && telemetry.faceBox.length === 4
    );

    recordTest("Extraction 3.1: 512-d ArcFace Buffer & Telemetry (reg1.jpg)", embOk && normOk && telemOk,
               `Bytes: ${embedding.length} | L2 Norm: ${norm.toFixed(4)} | Live: ${telemetry.livenessScore} | Model: ${telemetry.embeddingModel}`);
  } catch (err) {
    recordTest("Extraction 3.1: 512-d ArcFace Buffer & Telemetry (reg1.jpg)", false, String(err));
  }

  // 3.2 Buffer input support (raw buffer passed to extractFaceOnlyEmbedding)
  try {
    const rawJpg = fs.readFileSync(reg1KeyframePath);
    const bufEmb = await extractFaceOnlyEmbedding(rawJpg);
    recordTest("Extraction 3.2: Raw Memory Buffer Input Support", Buffer.isBuffer(bufEmb) && bufEmb.length === 2048,
               `Extracted from ${rawJpg.length} byte buffer -> ${bufEmb.length} byte embedding`);
  } catch (err) {
    recordTest("Extraction 3.2: Raw Memory Buffer Input Support", false, String(err));
  }

  // =========================================================================
  // TEST 4: MULTIMODAL EXTRACTION (FACE 2048B + VOICE 768B)
  // =========================================================================
  console.log("\n--- TEST 4: Multimodal Extraction (Face + Voice) ---");
  try {
    const multiBio = await extractBiometrics(reg1Path, voicePath);
    const fOk = Buffer.isBuffer(multiBio.faceEmbedding) && multiBio.faceEmbedding.length === 2048;
    const vOk = Buffer.isBuffer(multiBio.voiceEmbedding) && multiBio.voiceEmbedding.length === 768;
    const tOk = multiBio.telemetry && multiBio.telemetry.isLive === true;

    recordTest("Multimodal 4.1: Unified Face (2,048 B) + Voice (768 B) Embeddings", fOk && vOk && tOk,
               `Face: ${multiBio.faceEmbedding.length} B | Voice: ${multiBio.voiceEmbedding.length} B | Telemetry: Live=${multiBio.telemetry.isLive}`);
  } catch (err) {
    recordTest("Multimodal 4.1: Unified Face + Voice Embeddings", false, String(err));
  }

  // =========================================================================
  // TEST 5: COSINE SIMILARITY & BUFFER LENGTH ENFORCEMENT
  // =========================================================================
  console.log("\n--- TEST 5: Cosine Similarity Verification & Rejection ---");
  
  // 5.1 Invalid buffer lengths MUST throw
  try {
    const badBuf = Buffer.alloc(1024);
    const goodBuf = Buffer.alloc(2048);
    calculateCosineSimilarity(badBuf, goodBuf);
    recordTest("Similarity 5.1: Invalid Buffer Length Rejection", false, "Allowed non-2048 byte buffer!");
  } catch (err) {
    recordTest("Similarity 5.1: Invalid Buffer Length Rejection", true, `Rejected safely: ${err.message}`);
  }

  // 5.2 Genuine match verification
  const embA = await extractFaceOnlyEmbedding(reg1Path);
  const embB = await extractFaceOnlyEmbedding(reg1KeyframePath);
  const embImp = await extractFaceOnlyEmbedding(reg9Path);

  const simGenuine = calculateCosineSimilarity(embA, embB);
  const simImpostor = calculateCosineSimilarity(embA, embImp);

  const genOk = simGenuine >= 0.65 && simGenuine >= BIOMETRIC_SIMILARITY_THRESHOLD;
  const impOk = simImpostor < 0.35 && simImpostor < BIOMETRIC_SIMILARITY_THRESHOLD;
  const marginOk = (simGenuine - simImpostor) >= 0.50;

  recordTest("Similarity 5.2: Genuine Candidate Match (reg1 vs keyframe)", genOk,
             `Similarity: ${simGenuine.toFixed(4)} (Threshold: >= ${BIOMETRIC_SIMILARITY_THRESHOLD})`);
  recordTest("Similarity 5.3: Impostor Candidate Rejection (reg1 vs reg9)", impOk,
             `Similarity: ${simImpostor.toFixed(4)} (Threshold: < ${BIOMETRIC_SIMILARITY_THRESHOLD})`);
  recordTest("Similarity 5.4: Wide Separation Margin (> 0.50)", marginOk,
             `Margin: ${(simGenuine - simImpostor).toFixed(4)}`);

  // =========================================================================
  // TEST 6: LATENCY BENCHMARK (NODE -> PYTHON WRAPPER OVERHEAD)
  // =========================================================================
  console.log("\n--- TEST 6: End-to-End Latency via Node.js Wrapper ---");
  // Warmup
  await extractFaceOnlyEmbedding(reg1Path);

  const latencies = [];
  for (let i = 0; i < 5; i++) {
    const t0 = process.hrtime.bigint();
    await extractFaceOnlyEmbedding(reg1Path);
    const t1 = process.hrtime.bigint();
    latencies.push(Number(t1 - t0) / 1e6);
  }
  latencies.sort((a, b) => a - b);
  const medLat = latencies[Math.floor(latencies.length / 2)];
  recordTest("Latency 6.1: Node.js extractFaceOnlyEmbedding Overhead", medLat <= 350.0,
             `Median: ${medLat.toFixed(2)}ms | Min: ${latencies[0].toFixed(2)}ms (Subprocess Spawn SLA: <= 350.0ms)`);

  // =========================================================================
  // MASTER SUMMARY
  // =========================================================================
  const totalPassed = testResults.filter(t => t.passed).length;
  const totalTests = testResults.length;
  console.log("\n" + "=" .repeat(80));
  console.log(`TASK 3.1 EMPIRICAL RESULTS: ${totalPassed}/${totalTests} TESTS PASSED (${((totalPassed / totalTests) * 100).toFixed(1)}%)`);
  console.log("=" .repeat(80));

  if (totalPassed === totalTests) {
    console.log("ALL TASK 3.1 NODE.JS BACKEND GATEWAY CHECKS VERIFIED SUCCESSFULLY.");
    process.exit(0);
  } else {
    console.log("SOME TESTS FAILED.");
    process.exit(1);
  }
}

runTests().catch(err => {
  console.error("Unhandled test runner exception:", err);
  process.exit(1);
});
