
const path = require('path');
const fs = require('fs');

console.log("=" .repeat(80));
console.log("TASK 3.2 EMPIRICAL & EDGE-CASE TEST SUITE: VERIFY-GATE ROUTE (NEXT.JS/TS)");
console.log("Tasks 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 3.1 & 3.2 Integrated System Execution");
console.log("=" .repeat(80));

const {
  POST,
  BIOMETRIC_MATCH_THRESHOLD
} = require('/home/savan/openviva/web/dist_test/verify_gate_route.js');

const db = require('/home/savan/openviva/web/dist_test/db.js');

const testResults = [];

function recordTest(name, passed, details = "") {
  const status = passed ? "PASS" : "FAIL";
  testResults.push({ name, passed, details });
  console.log(`[${status}] ${name}`);
  if (details) {
    console.log(`       Details: ${details}`);
  }
}

// Mock NextRequest generator
function createMockRequest(body, cookies = {}, headers = {}) {
  return {
    headers: {
      get: (h) => headers[h.toLowerCase()] || headers[h] || null
    },
    cookies: {
      get: (c) => cookies[c] ? { value: cookies[c] } : null
    },
    json: async () => body
  };
}

async function runTests() {
  const reg1Path = "/home/savan/openviva/storage/biometrics/faces/reg1.jpg";
  const reg1KeyframePath = "/home/savan/openviva/storage/biometrics/faces/reg1_keyframe.jpg";
  const reg9Path = "/home/savan/openviva/storage/biometrics/faces/reg9.jpg";
  const blackPath = "/tmp/edge_cases_bio/black.jpg";
  const multiPath = "/home/savan/openviva/storage/biometrics/faces/reg7.jpg";

  // Create active student session in database for reg1 (student 1)
  const tokenReg1 = "test_verify_gate_token_" + Date.now();
  await db.createStudentSession("reg1", tokenReg1, 3600);

  // =========================================================================
  // TEST 1: THRESHOLD CALIBRATION
  // =========================================================================
  console.log("\n--- TEST 1: Threshold Calibration ---");
  recordTest("Threshold 1.1: BIOMETRIC_MATCH_THRESHOLD === 0.62", BIOMETRIC_MATCH_THRESHOLD === 0.62,
             `Configured Threshold: ${BIOMETRIC_MATCH_THRESHOLD} (Calibrated for ArcFace 512-d)`);

  // =========================================================================
  // TEST 2: GENUINE CANDIDATE VERIFICATION (END-TO-END)
  // =========================================================================
  console.log("\n--- TEST 2: Genuine Candidate Chamber Entry ---");
  const liveBase64 = "data:image/jpeg;base64," + fs.readFileSync(reg1KeyframePath).toString("base64");
  const reqGenuine = createMockRequest(
    { liveFrameBase64: liveBase64, sessionId: "sess_unit_test_3_2" },
    { openviva_student_session: tokenReg1 }
  );

  const resGenuine = await POST(reqGenuine);
  const dataGenuine = await resGenuine.json();

  const isGenVerified = dataGenuine.verified === true;
  const isSimOk = dataGenuine.similarity >= 0.62;
  const hasTelemetry = dataGenuine.telemetry && 
                       dataGenuine.telemetry.isLive === true && 
                       dataGenuine.telemetry.livenessScore >= 0.80 &&
                       dataGenuine.telemetry.embeddingModel === "MobileFaceNet-ArcFace-512" &&
                       Array.isArray(dataGenuine.telemetry.faceBox);

  recordTest("Genuine 2.1: Candidate Chamber Admission Authorized", isGenVerified && isSimOk && hasTelemetry,
             `Status: ${resGenuine.status} | Verified: ${dataGenuine.verified} | Similarity: ${dataGenuine.similarity} (>= 0.62) | Live: ${dataGenuine.telemetry?.livenessScore}`);

  // Check keyframe persistence
  const savedKeyframe = "/home/savan/openviva/storage/biometrics/keyframes/sess_unit_test_3_2.jpg";
  const keyframeExists = fs.existsSync(savedKeyframe);
  recordTest("Genuine 2.2: Chamber Entry Keyframe Persisted to Disk", keyframeExists,
             `Path: ${savedKeyframe} (Size: ${keyframeExists ? fs.statSync(savedKeyframe).size : 0} bytes)`);

  // Check SQLite record status updated
  const bioRecord = await db.getStudentBiometrics("reg1");
  const isDbAuth = bioRecord && bioRecord.verificationStatus === "AUTHENTICATED";
  recordTest("Genuine 2.3: SQLite Biometrics Updated to AUTHENTICATED", isDbAuth,
             `DB Status: ${bioRecord?.verificationStatus}`);

  // =========================================================================
  // TEST 3: IMPOSTOR CANDIDATE REJECTION
  // =========================================================================
  console.log("\n--- TEST 3: Impostor Rejection ---");
  const impostorBase64 = "data:image/jpeg;base64," + fs.readFileSync(reg9Path).toString("base64");
  const reqImpostor = createMockRequest(
    { liveFrameBase64: impostorBase64 },
    { openviva_student_session: tokenReg1 }
  );

  const resImpostor = await POST(reqImpostor);
  const dataImpostor = await resImpostor.json();

  const isImpRejected = dataImpostor.verified === false;
  const isImpLow = dataImpostor.similarity < 0.35;
  recordTest("Impostor 3.1: Access Denied for Mismatched Face (reg9 vs reg1)", isImpRejected && isImpLow,
             `Status: ${resImpostor.status} | Verified: ${dataImpostor.verified} | Similarity: ${dataImpostor.similarity} (< 0.62)`);

  // Check SQLite status updated to FLAGGED
  const bioFlagged = await db.getStudentBiometrics("reg1");
  const isDbFlagged = bioFlagged && bioFlagged.verificationStatus === "FLAGGED";
  recordTest("Impostor 3.2: SQLite Biometrics Updated to FLAGGED", isDbFlagged,
             `DB Status: ${bioFlagged?.verificationStatus}`);

  // Reset status back to AUTHENTICATED for reg1
  await db.upsertStudentBiometrics({ regNo: "reg1", studentName: "Student One", verificationStatus: "AUTHENTICATED" });

  // =========================================================================
  // TEST 4: ANOMALIES & PRESENTATION ATTACK GATES (FAIL-CLOSED HTTP 400)
  // =========================================================================
  console.log("\n--- TEST 4: Security Gates & Fail-Closed Anomalies ---");

  // 4.1 Zero face in camera frame -> HTTP 400 NO_FACE_DETECTED
  const blackBase64 = "data:image/jpeg;base64," + fs.readFileSync(blackPath).toString("base64");
  const reqZero = createMockRequest({ liveFrameBase64: blackBase64 }, { openviva_student_session: tokenReg1 });
  const resZero = await POST(reqZero);
  const dataZero = await resZero.json();

  const isZeroOk = resZero.status === 400 && dataZero.verified === false && dataZero.reason === "NO_FACE_DETECTED";
  recordTest("Security 4.1: Zero Face Returns HTTP 400 (NO_FACE_DETECTED)", isZeroOk,
             `Status: ${resZero.status} | Reason: ${dataZero.reason} | Message: ${dataZero.message}`);

  // 4.2 Multi-person in camera frame -> HTTP 400 MULTIPLE_FACES_DETECTED
  const multiBase64 = "data:image/jpeg;base64," + fs.readFileSync(multiPath).toString("base64");
  const reqMulti = createMockRequest({ liveFrameBase64: multiBase64 }, { openviva_student_session: tokenReg1 });
  const resMulti = await POST(reqMulti);
  const dataMulti = await resMulti.json();

  const isMultiOk = resMulti.status === 400 && dataMulti.verified === false && dataMulti.reason === "MULTIPLE_FACES_DETECTED";
  recordTest("Security 4.2: Multi-Person Returns HTTP 400 (MULTIPLE_FACES_DETECTED)", isMultiOk,
             `Status: ${resMulti.status} | Reason: ${dataMulti.reason} | Message: ${dataMulti.message}`);

  // =========================================================================
  // TEST 5: AUTHENTICATION TOKEN VALIDATIONS
  // =========================================================================
  console.log("\n--- TEST 5: Session & Token Authentication ---");

  // 5.1 Missing token -> HTTP 401
  const reqNoAuth = createMockRequest({ liveFrameBase64: liveBase64 });
  const resNoAuth = await POST(reqNoAuth);
  recordTest("Auth 5.1: Missing Session Cookie/Header Returns HTTP 401", resNoAuth.status === 401,
             `Status: ${resNoAuth.status}`);

  // 5.2 Invalid token -> HTTP 401
  const reqBadAuth = createMockRequest({ liveFrameBase64: liveBase64 }, { openviva_student_session: "invalid_token_999" });
  const resBadAuth = await POST(reqBadAuth);
  recordTest("Auth 5.2: Invalid Session Token Returns HTTP 401", resBadAuth.status === 401,
             `Status: ${resBadAuth.status}`);

  // 5.3 Missing live frame body -> HTTP 400
  const reqNoFrame = createMockRequest({}, { openviva_student_session: tokenReg1 });
  const resNoFrame = await POST(reqNoFrame);
  recordTest("Auth 5.3: Missing Live Frame Snapshot Returns HTTP 400", resNoFrame.status === 400,
             `Status: ${resNoFrame.status}`);

  // =========================================================================
  // TEST 6: END-TO-END EXECUTION LATENCY BENCHMARK
  // =========================================================================
  console.log("\n--- TEST 6: Complete Route Execution Latency ---");
  const latencies = [];
  for (let i = 0; i < 5; i++) {
    const t0 = process.hrtime.bigint();
    const reqBench = createMockRequest({ liveFrameBase64: liveBase64 }, { openviva_student_session: tokenReg1 });
    await POST(reqBench);
    const t1 = process.hrtime.bigint();
    latencies.push(Number(t1 - t0) / 1e6);
  }
  latencies.sort((a, b) => a - b);
  const medLat = latencies[Math.floor(latencies.length / 2)];
  recordTest("Latency 6.1: Full Route Latency (DB + Neural + Keyframe + Response)", medLat <= 350.0,
             `Median: ${medLat.toFixed(2)}ms | Min: ${latencies[0].toFixed(2)}ms (Web API SLA: <= 350.0ms)`);

  // =========================================================================
  // MASTER SUMMARY
  // =========================================================================
  const totalPassed = testResults.filter(t => t.passed).length;
  const totalTests = testResults.length;
  console.log("\n" + "=" .repeat(80));
  console.log(`TASK 3.2 EMPIRICAL RESULTS: ${totalPassed}/${totalTests} TESTS PASSED (${((totalPassed / totalTests) * 100).toFixed(1)}%)`);
  console.log("=" .repeat(80));

  if (totalPassed === totalTests) {
    console.log("ALL TASK 3.2 VERIFY-GATE ROUTE CHECKS VERIFIED SUCCESSFULLY.");
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
