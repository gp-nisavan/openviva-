"""
EMPIRICAL AND EDGE-CASE TEST SUITE FOR TASK 4.3 (EvaluationScorecard.tsx & Biometric HUD)
Integrated with Tasks 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 4.1, and 4.2
Executes on Node 10.10.16.13 against live Next.js PM2 server at http://localhost:3001/openviva
"""

import os
import sys
import time
import json
import base64
import sqlite3
import urllib.request
import urllib.error
import math
import numpy as np
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor

print("=" * 85)
print("TASK 4.3 EMPIRICAL TEST SUITE: TA EVALUATION BIOMETRIC HUD (EvaluationScorecard.tsx)")
print("Full-Stack Integrated Verification on Node 10.10.16.13:3001 (Tasks 1.1 -> 4.3)")
print("=" * 85)

DB_PATH = "/home/savan/openviva/storage/openviva.db"
BASE_URL = "http://localhost:3001/openviva"
FACES_DIR = "/home/savan/openviva/storage/biometrics/faces"
KEYFRAMES_DIR = "/home/savan/openviva/storage/biometrics/keyframes"
SCORECARD_PATH = "/home/savan/openviva/web/src/components/EvaluationScorecard.tsx"
SESSION_HUD_ROUTE = "/home/savan/openviva/web/src/app/api/biometrics/session-hud/route.ts"
PHOTO_ROUTE = "/home/savan/openviva/web/src/app/api/biometrics/photo/route.ts"
TYPES_PATH = "/home/savan/openviva/web/src/types/grading.ts"

os.makedirs(KEYFRAMES_DIR, exist_ok=True)
os.makedirs(FACES_DIR, exist_ok=True)

test_results = []

def record_test(name, passed, details=""):
    is_pass = bool(passed)
    status = "PASS" if is_pass else "FAIL"
    test_results.append((name, is_pass, details))
    print(f"[{status}] {name}")
    if details:
        print(f"       Details: {details}")

def send_get(endpoint):
    url = f"{BASE_URL}{endpoint}"
    req = urllib.request.Request(url, method="GET")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            elapsed = (time.perf_counter() - t0) * 1000
            content = resp.read()
            content_type = resp.headers.get("Content-Type", "")
            return resp.status, content, content_type, elapsed
    except urllib.error.HTTPError as e:
        elapsed = (time.perf_counter() - t0) * 1000
        content = e.read()
        content_type = e.headers.get("Content-Type", "")
        return e.code, content, content_type, elapsed
    except Exception as e:
        elapsed = (time.perf_counter() - t0) * 1000
        return 500, str(e).encode(), "", elapsed

def send_post(endpoint, payload=None, token=None):
    url = f"{BASE_URL}{endpoint}"
    data_bytes = json.dumps(payload).encode("utf-8") if payload is not None else b"{}"
    req = urllib.request.Request(url, data=data_bytes, method="POST")
    req.add_header("Content-Type", "application/json")
    if token:
        req.add_header("Authorization", f"Bearer {token}")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            elapsed = (time.perf_counter() - t0) * 1000
            content = resp.read().decode("utf-8")
            return resp.status, json.loads(content), elapsed
    except urllib.error.HTTPError as e:
        elapsed = (time.perf_counter() - t0) * 1000
        content = e.read().decode("utf-8")
        try:
            return e.code, json.loads(content), elapsed
        except Exception:
            return e.code, {"error": content}, elapsed
    except Exception as e:
        elapsed = (time.perf_counter() - t0) * 1000
        return 500, {"error": str(e)}, elapsed

# Load reference face images for testing
TEST_FACE_PATH = os.path.join(FACES_DIR, "person_a_1.jpg")
if not os.path.exists(TEST_FACE_PATH):
    TEST_FACE_PATH = "/tmp/edge_cases_bio/person_a_1.jpg"
with open(TEST_FACE_PATH, "rb") as f:
    RAW_FACE_A_BYTES = f.read()
FACE_A_BASE64 = f"data:image/jpeg;base64,{base64.b64encode(RAW_FACE_A_BYTES).decode()}"

IMPOSTOR_FACE_PATH = os.path.join(FACES_DIR, "reg1.jpg")
with open(IMPOSTOR_FACE_PATH, "rb") as f:
    RAW_IMPOSTOR_BYTES = f.read()
IMPOSTOR_BASE64 = f"data:image/jpeg;base64,{base64.b64encode(RAW_IMPOSTOR_BYTES).decode()}"

# Synthetic voice WAV
wav_header = bytearray(b"RIFF\x24\x08\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x00\x08\x00\x00")
wav_samples = bytearray(2048)
for i in range(1024):
    sample = int(12000.0 * np.sin(2.0 * np.pi * 440.0 * (i / 16000.0)))
    wav_samples[i*2] = sample & 0xff
    wav_samples[i*2 + 1] = (sample >> 8) & 0xff
SYNTHETIC_WAV_BASE64 = f"data:audio/wav;base64,{base64.b64encode(wav_header + wav_samples).decode()}"

# =========================================================================
# SECTION 1: STATIC & AST CONTRACT AUDIT ON DEPLOYED FILES
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 1: STATIC & AST CONTRACT AUDIT ON EVALUATIONSCORECARD")
print("=" * 60)

with open(SCORECARD_PATH, "r", encoding="utf-8") as f:
    scorecard_content = f.read()
with open(SESSION_HUD_ROUTE, "r", encoding="utf-8") as f:
    session_hud_content = f.read()
with open(TYPES_PATH, "r", encoding="utf-8") as f:
    types_content = f.read()

# 1.1 ArcFace badge
has_arcface_badge = "MobileFaceNet ArcFace 512-d | Anti-Spoof Liveness Passed" in scorecard_content
record_test("1.1 AST Contract: 'MobileFaceNet ArcFace 512-d | Anti-Spoof Liveness Passed' badge present", has_arcface_badge)

# 1.2 Legacy purged
no_facenet_badge = "512-d FaceNet Vector Sealed" not in scorecard_content
record_test("1.2 Legacy Purge: Zero occurrences of '512-d FaceNet Vector Sealed'", no_facenet_badge)

# 1.3 Threshold display updated to 62%
has_62_threshold = "(≥ 62%)" in scorecard_content
record_test("1.3 Calibrated Threshold: Decision boundary display strictly updated to '(≥ 62%)'", has_62_threshold)

# 1.4 Legacy 68% purged
no_68_threshold = "68%" not in scorecard_content
record_test("1.4 Legacy Purge: Zero occurrences of '(≥ 68%)' or '(&ge; 68%)'", no_68_threshold)

# 1.5 Keyframe landmark badge
has_landmark_badge = "5-Point Umeyama Locked • Liveness Verified" in scorecard_content
record_test("1.5 Keyframe Landmark Badge: '5-Point Umeyama Locked • Liveness Verified' present", has_landmark_badge)

# 1.6 Illumination tag
has_clahe_tag = "CLAHE Normalization Active" in scorecard_content
record_test("1.6 Illumination Tag: 'CLAHE Normalization Active' present", has_clahe_tag)

# 1.7 Enrolled Canonical Alignment tag
has_canonical_tag = "Canonical 112×112 Aligned" in scorecard_content
record_test("1.7 Enrolled Canonical Alignment Tag: 'Canonical 112×112 Aligned' present", has_canonical_tag)

# 1.8 Subtitle Modernization
has_subtitle = "MobileFaceNet ArcFace 512-d cosine telemetry" in scorecard_content
record_test("1.8 Subtitle Modernization: 'MobileFaceNet ArcFace 512-d cosine telemetry' present", has_subtitle)

# 1.9 Base path routing
has_api_url_hud = "apiUrl(`/api/biometrics/session-hud" in scorecard_content
record_test("1.9 Base Path Routing: fetchBiometricHud uses apiUrl helper", has_api_url_hud)

# 1.10 Types integrity
has_extended_types = ("livenessConfidence?: number;" in types_content and 
                      "alignmentMethod?: string;" in types_content and 
                      "claheNormalized?: boolean;" in types_content)
record_test("1.10 Type Definitions: BiometricIdentityCardData extended with telemetry fields", has_extended_types)


# =========================================================================
# SECTION 2: INTEGRATED CANDIDATE SETUP & PRE-VIVA GATE VERIFICATION
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 2: INTEGRATED CANDIDATE ENROLLMENT & GATE VERIFICATION")
print("=" * 60)

TEST_STUDENT_ID = "ta_eval_cand_01"
TEST_SESSION_ID = f"sess_ta_{int(time.time())}"
TEST_TOKEN = f"tok_ta_{int(time.time())}"
EXPIRY = (datetime.now(timezone.utc) + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S.000Z")

conn = sqlite3.connect(DB_PATH)
c = conn.cursor()

# Ensure student exists with complete required schema
c.execute("""
    INSERT OR REPLACE INTO students 
    (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at, updated_at) 
    VALUES (?, 'Evaluation Candidate Alpha', 'Computer Science', '2026', 'x', 'x', 0, 1, datetime('now'), datetime('now'))
""", (TEST_STUDENT_ID,))

# Ensure student session exists
c.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, ?, 0, ?, ?)",
          (TEST_TOKEN, TEST_STUDENT_ID, EXPIRY, datetime.now(timezone.utc).isoformat()))

# Ensure default exam exists
c.execute("""
    INSERT OR REPLACE INTO exams (id, course_title, instructor_id, system_prompt, created_at)
    VALUES ('exam_default', 'CS101 Intro to AI', 'inst_01', 'Default prompt', datetime('now'))
""")

# Ensure exam session exists
c.execute("""
    INSERT OR REPLACE INTO exam_sessions (session_id, exam_id, course_title, student_id, started_at, status, created_at)
    VALUES (?, 'exam_default', 'CS101 Intro to AI', ?, datetime('now'), 'IN_PROGRESS', datetime('now'))
""", (TEST_SESSION_ID, TEST_STUDENT_ID))
conn.commit()
conn.close()

# Enroll candidate via Task 3.3 multi-modal pipeline
enroll_payload = {
    "faceImageBase64": FACE_A_BASE64,
    "voiceAudioBase64": SYNTHETIC_WAV_BASE64
}
status_enroll, data_enroll, ms_enroll = send_post("/api/auth/enroll-biometrics", enroll_payload, token=TEST_TOKEN)
record_test("2.1 Candidate Multi-Modal Enrollment Pre-requisite", status_enroll == 200 and data_enroll.get("success"),
            f"HTTP {status_enroll} in {ms_enroll:.1f}ms | Telemetry: {data_enroll.get('telemetry', {}).get('livenessScore')}")

# Authenticate candidate through Chamber Gate via Task 3.2 verify-gate route
gate_payload = {
    "liveFrameBase64": FACE_A_BASE64,
    "sessionId": TEST_SESSION_ID
}
status_gate, data_gate, ms_gate = send_post("/api/auth/verify-gate", gate_payload, token=TEST_TOKEN)
gate_passed = status_gate == 200 and data_gate.get("verified") and data_gate.get("similarity", 0) >= 0.62
record_test("2.2 Live Chamber Gate Verification (Admission >= 0.62)", gate_passed,
            f"HTTP {status_gate} | Verified: {data_gate.get('verified')} | Sim: {data_gate.get('similarity', 0):.4f} in {ms_gate:.1f}ms")

# Verify keyframe persisted on disk
keyframe_file = os.path.join(KEYFRAMES_DIR, f"{TEST_SESSION_ID}.jpg")
keyframe_exists = os.path.exists(keyframe_file) and os.path.getsize(keyframe_file) > 1000
record_test("2.3 Live Keyframe Persisted to Disk", keyframe_exists,
            f"Path: {keyframe_file} (Size: {os.path.getsize(keyframe_file) if os.path.exists(keyframe_file) else 0} B)")


# =========================================================================
# SECTION 3: LIVE API INTEGRATION - SESSION BIOMETRIC HUD (/api/biometrics/session-hud)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 3: LIVE API INTEGRATION - SESSION BIOMETRIC HUD")
print("=" * 60)

hud_endpoint = f"/api/biometrics/session-hud?sessionId={TEST_SESSION_ID}&regNo={TEST_STUDENT_ID}"
hud_status, hud_raw, hud_ct, hud_ms = send_get(hud_endpoint)
hud_json = json.loads(hud_raw.decode("utf-8")) if hud_status == 200 else {}

record_test("3.1 Session HUD Query: HTTP 200 & success: true", hud_status == 200 and hud_json.get("success"),
            f"HTTP {hud_status} in {hud_ms:.1f}ms | Success: {hud_json.get('success')}")

is_auth_status = hud_json.get("verificationStatus") == "AUTHENTICATED"
is_above_thresh = hud_json.get("faceMatchSimilarity", 0) >= 0.62
record_test("3.2 Status & Match Invariant: verificationStatus is 'AUTHENTICATED' and similarity >= 0.62",
            is_auth_status and is_above_thresh,
            f"Status: {hud_json.get('verificationStatus')} | Sim: {hud_json.get('faceMatchSimilarity')}")

has_liveness_conf = hud_json.get("livenessConfidence", 0) >= 0.95
is_umeyama_method = hud_json.get("alignmentMethod") == "UMEYAMA_5POINT_112X112"
record_test("3.3 Neural Telemetry Payload: livenessConfidence >= 0.95 and alignmentMethod is 'UMEYAMA_5POINT_112X112'",
            has_liveness_conf and is_umeyama_method,
            f"Liveness: {hud_json.get('livenessConfidence')} | Method: {hud_json.get('alignmentMethod')}")

is_clahe_normalized = hud_json.get("claheNormalized") is True
record_test("3.4 Equalization Flag: claheNormalized is true", is_clahe_normalized,
            f"claheNormalized: {hud_json.get('claheNormalized')}")

enrolled_url = hud_json.get("enrolledFaceUrl", "")
keyframe_url = hud_json.get("examKeyframeUrl", "")
urls_valid = enrolled_url.startswith("/openviva/api/biometrics/photo") and keyframe_url.startswith("/openviva/api/biometrics/photo")
record_test("3.5 URL Resolution: enrolledFaceUrl and examKeyframeUrl correctly prefixed with basePath", urls_valid,
            f"Enrolled: {enrolled_url} | Keyframe: {keyframe_url}")

name_matched = hud_json.get("studentName") == "Evaluation Candidate Alpha"
id_matched = hud_json.get("studentId") == TEST_STUDENT_ID
record_test("3.6 Candidate Details: studentName and studentId correctly mapped", name_matched and id_matched,
            f"ID: {hud_json.get('studentId')} | Name: {hud_json.get('studentName')}")

no_voice_anomaly = hud_json.get("secondaryVoiceDetected") is False and len(hud_json.get("evidenceSnippets", [])) == 0
record_test("3.7 Clean State Acoustic Invariant: secondaryVoiceDetected is false and evidenceSnippets is empty",
            no_voice_anomaly,
            f"secondaryVoiceDetected: {hud_json.get('secondaryVoiceDetected')} | Snippets: {len(hud_json.get('evidenceSnippets', []))}")


# =========================================================================
# SECTION 4: LIVE API INTEGRATION - BIOMETRIC PHOTO SERVER (/api/biometrics/photo)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 4: LIVE API INTEGRATION - BIOMETRIC PHOTO SERVER")
print("=" * 60)

# 4.1 Enrolled Reference Photo
ref_endpoint = f"/api/biometrics/photo?regNo={TEST_STUDENT_ID}&type=reference"
ref_status, ref_bytes, ref_ct, ref_ms = send_get(ref_endpoint)
ref_valid = ref_status == 200 and ("image/jpeg" in ref_ct or "image/png" in ref_ct) and len(ref_bytes) > 1000
record_test("4.1 Reference Photo Retrieval: Enrolled candidate reference returns image/jpeg with non-empty bytes",
            ref_valid,
            f"HTTP {ref_status} | CT: {ref_ct} | Size: {len(ref_bytes)} B in {ref_ms:.1f}ms")

# 4.2 Live Keyframe Retrieval
kf_endpoint = f"/api/biometrics/photo?regNo={TEST_STUDENT_ID}&type=keyframe&sessionId={TEST_SESSION_ID}"
kf_status, kf_bytes, kf_ct, kf_ms = send_get(kf_endpoint)
kf_valid = kf_status == 200 and ("image/jpeg" in kf_ct or "image/png" in kf_ct) and len(kf_bytes) > 1000
record_test("4.2 Live Keyframe Retrieval: Session chamber gate keyframe returns image/jpeg with non-empty bytes",
            kf_valid,
            f"HTTP {kf_status} | CT: {kf_ct} | Size: {len(kf_bytes)} B in {kf_ms:.1f}ms")

# 4.3 Direct Keyframe Byte Verification
record_test("4.3 Direct Keyframe Integrity: Keyframe served matches persisted disk artifact",
            len(kf_bytes) == os.path.getsize(keyframe_file),
            f"Served: {len(kf_bytes)} B == Disk: {os.path.getsize(keyframe_file)} B")

# 4.4 Missing Identifier Edge Case
missing_status, missing_bytes, missing_ct, missing_ms = send_get("/api/biometrics/photo")
missing_valid = missing_status == 200 and "image/svg+xml" in missing_ct and b"Candidate ID Missing" in missing_bytes
record_test("4.4 Missing Identifier Edge Case: Missing regNo returns valid SVG placeholder (image/svg+xml)",
            missing_valid,
            f"HTTP {missing_status} | CT: {missing_ct} | Size: {len(missing_bytes)} B")

# 4.5 Unenrolled Candidate Edge Case
unenroll_status, unenroll_bytes, unenroll_ct, unenroll_ms = send_get("/api/biometrics/photo?regNo=ghost_student_999&type=reference")
unenroll_valid = unenroll_status == 200 and "image/svg+xml" in unenroll_ct and b"No Ground-Truth Photo Enrolled" in unenroll_bytes
record_test("4.5 Unenrolled Candidate Edge Case: Non-existent regNo returns 'No Ground-Truth' SVG placeholder",
            unenroll_valid,
            f"HTTP {unenroll_status} | CT: {unenroll_ct} | Size: {len(unenroll_bytes)} B")

# 4.6 Uncaptured Keyframe Edge Case
unkf_status, unkf_bytes, unkf_ct, unkf_ms = send_get("/api/biometrics/photo?regNo=unverified_ghost_999&type=keyframe&sessionId=ghost_session_999")
unkf_valid = unkf_status == 200 and "image/svg+xml" in unkf_ct and b"Live Keyframe" in unkf_bytes
record_test("4.6 Uncaptured Keyframe Edge Case: Non-existent sessionId & candidate returns 'Live Keyframe' placeholder SVG",
            unkf_valid,
            f"HTTP {unkf_status} | CT: {unkf_ct} | Size: {len(unkf_bytes)} B")


# =========================================================================
# SECTION 5: FORENSIC ANOMALY & EDGE CASE MATRIX
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 5: FORENSIC ANOMALY & EDGE CASE MATRIX")
print("=" * 60)

# 5.1 Impostor Chamber Gate Failure
impostor_payload = {
    "regNo": TEST_STUDENT_ID,
    "liveFrameBase64": IMPOSTOR_BASE64,
    "sessionId": f"sess_impostor_{int(time.time())}"
}
status_imp, data_imp, ms_imp = send_post("/api/auth/verify-gate", impostor_payload, token=TEST_TOKEN)
imp_rejected = status_imp == 200 and data_imp.get("verified") is False and data_imp.get("similarity", 1.0) < 0.40
record_test("5.1 Impostor Gate Failure: Impostor probe rejected (< 0.40) & status set to FLAGGED",
            imp_rejected,
            f"HTTP {status_imp} | Verified: {data_imp.get('verified')} | Sim: {data_imp.get('similarity', 1.0):.4f}")

# 5.2 Session HUD Flagged State for Candidate
hud_flagged_status, hud_flagged_raw, _, _ = send_get(f"/api/biometrics/session-hud?sessionId={TEST_SESSION_ID}&regNo={TEST_STUDENT_ID}")
hud_flagged_json = json.loads(hud_flagged_raw.decode("utf-8")) if hud_flagged_status == 200 else {}
is_now_flagged = hud_flagged_json.get("verificationStatus") == "FLAGGED"
record_test("5.2 Session HUD Reflects FLAGGED Status following security anomaly", is_now_flagged,
            f"verificationStatus: {hud_flagged_json.get('verificationStatus')}")

# 5.3 Acoustic Diarization Flag in Evaluations Table
c_session_flags = f"sess_flags_{int(time.time())}"
conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
c.execute("""
    INSERT OR REPLACE INTO exam_sessions (session_id, exam_id, course_title, student_id, started_at, status, created_at)
    VALUES (?, 'exam_default', 'CS101 Intro to AI', ?, datetime('now'), 'COMPLETED', datetime('now'))
""", (c_session_flags, TEST_STUDENT_ID))

c.execute("""
    INSERT OR REPLACE INTO evaluations 
    (session_id, overall_score, verdict, conceptual_rigor_score, clarity_score, 
     adversarial_resistance_score, behavioral_flags_json, committee_remarks, evaluated_at)
    VALUES (?, 65, 'BORDERLINE', 60, 60, 60, ?, 'Review required', ?)
""", (
    c_session_flags, 
    json.dumps([{"flag": "ACCOMPLICE_DETECTED", "speakerCluster": "SPEAKER_02", "similarityScore": 0.28, "timestampRange": {"startSeconds": 14.5, "endSeconds": 21.2}}]),
    datetime.now(timezone.utc).isoformat()
))
conn.commit()
conn.close()

hud_voice_status, hud_voice_raw, _, _ = send_get(f"/api/biometrics/session-hud?sessionId={c_session_flags}&regNo={TEST_STUDENT_ID}")
hud_voice_json = json.loads(hud_voice_raw.decode("utf-8")) if hud_voice_status == 200 else {}
voice_flagged = (hud_voice_json.get("secondaryVoiceDetected") is True and 
                 len(hud_voice_json.get("evidenceSnippets", [])) > 0 and 
                 hud_voice_json.get("evidenceSnippets", [])[0].get("flag") == "ACCOMPLICE_DETECTED")
record_test("5.3 Secondary Voice Diarization Detection: ACCOMPLICE_DETECTED reflected in Session HUD",
            voice_flagged,
            f"secondaryVoiceDetected: {hud_voice_json.get('secondaryVoiceDetected')} | Snippets: {len(hud_voice_json.get('evidenceSnippets', []))}")

# 5.4 Missing Session and RegNo: HTTP 400
bad_hud_status, bad_hud_raw, _, _ = send_get("/api/biometrics/session-hud")
record_test("5.4 Empty Query Parameters: Requesting session-hud with no params returns HTTP 400",
            bad_hud_status == 400,
            f"HTTP {bad_hud_status} | Body: {bad_hud_raw.decode('utf-8')[:60]}...")

# 5.5 Corrupted Session Lookup
corrupt_hud_status, corrupt_hud_raw, _, _ = send_get("/api/biometrics/session-hud?sessionId='--SELECT-INJECTION")
record_test("5.5 SQL Injection / Corrupted Query Defense: Handled cleanly without server crash",
            corrupt_hud_status in [200, 400],
            f"HTTP {corrupt_hud_status}")


# =========================================================================
# SECTION 6: CONCURRENCY & LATENCY BENCHMARK
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 6: CONCURRENCY & LATENCY BENCHMARK")
print("=" * 60)

def query_hud_and_photo(idx):
    t0 = time.perf_counter()
    s1, _, _, _ = send_get(f"/api/biometrics/session-hud?sessionId={TEST_SESSION_ID}&regNo={TEST_STUDENT_ID}")
    s2, _, _, _ = send_get(f"/api/biometrics/photo?regNo={TEST_STUDENT_ID}&type=reference")
    s3, _, _, _ = send_get(f"/api/biometrics/photo?regNo={TEST_STUDENT_ID}&type=keyframe&sessionId={TEST_SESSION_ID}")
    dur = (time.perf_counter() - t0) * 1000
    return s1 == 200 and s2 == 200 and s3 == 200, dur

with ThreadPoolExecutor(max_workers=3) as pool:
    futures = [pool.submit(query_hud_and_photo, i) for i in range(3)]
    worker_results = [f.result() for f in futures]

all_workers_passed = all(r[0] for r in worker_results)
latencies = [r[1] for r in worker_results]
record_test("6.1 Concurrency Benchmark: 3 Parallel Multi-Endpoint HUD Workers", all_workers_passed,
            f"Passed: {sum(1 for r in worker_results if r[0])}/3 | Latencies: {[f'{l:.1f}ms' for l in latencies]}")

median_latency = sorted(latencies)[len(latencies) // 2]
record_test("6.2 Full HUD Endpoint Pipeline Latency SLA (Multi-Call <= 150ms)", median_latency <= 150.0,
            f"Median: {median_latency:.1f}ms | Min: {min(latencies):.1f}ms | Max: {max(latencies):.1f}ms")


# =========================================================================
# FINAL AUDIT SUMMARY
# =========================================================================
print("\n" + "=" * 80)
total_tests = len(test_results)
passed_tests = sum(1 for _, passed, _ in test_results if passed)
pass_rate = (passed_tests / total_tests) * 100

print(f"TASK 4.3 EMPIRICAL AUDIT RESULTS: {passed_tests} / {total_tests} PASSED ({pass_rate:.1f}%)")
print("=" * 80)

if passed_tests == total_tests:
    print("\n[SUCCESS] ALL TASK 4.3 EMPIRICAL & INTEGRATED SYSTEM TESTS PASSED CLEANLY!\n")
    sys.exit(0)
else:
    print(f"\n[FAILURE] {total_tests - passed_tests} TESTS FAILED IN TASK 4.3 AUDIT!\n")
    sys.exit(1)

