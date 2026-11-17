"""
TASK 5.3 EMPIRICAL TEST SUITE: COMPLETE CANDIDATE VIVA DEFENSE LIFECYCLE SMOKE TEST
Validates the entire end-to-end viva candidate journey:
1. Candidate Enrollment (Multi-modal staging, liveness, Umeyama alignment, CLAHE, ArcFace 2,048-B sealing)
2. Pre-Viva Chamber Gate Verification (0.62 calibrated decision boundary, keyframe persistence, status updates)
3. Keyframe Photo Serving (/api/biometrics/photo with session routing and fallback placeholders)
4. TA Evaluation Scorecard Biometric HUD (/api/biometrics/session-hud with neural telemetry badges)
5. Security Anomaly & Fail-Closed Matrix (Spoof rejection, zero keyframe pollution, impostor FLAGGED alert)
6. Concurrency & Latency SLAs across Node 10.10.16.13:3001
"""

import os
import sys
import time
import json
import base64
import sqlite3
import urllib.request
import urllib.error
from datetime import datetime, timezone, timedelta
import numpy as np
from PIL import Image
from concurrent.futures import ThreadPoolExecutor

sys.path.append("/home/savan/openviva/scripts")
from extract_biometrics import (
    get_scrfd_detector,
    get_liveness_classifier,
    align_and_equalize_face,
    get_arcface_extractor,
    SpoofError
)

def compute_cosine_similarity(vec_a, vec_b) -> float:
    a = np.frombuffer(vec_a, dtype=np.float32) if isinstance(vec_a, bytes) else np.asarray(vec_a, dtype=np.float32)
    b = np.frombuffer(vec_b, dtype=np.float32) if isinstance(vec_b, bytes) else np.asarray(vec_b, dtype=np.float32)
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0 or norm_b == 0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))

print("=" * 85)
print("TASK 5.3 EMPIRICAL TEST SUITE: END-TO-END CANDIDATE VIVA DEFENSE SMOKE TEST")
print("Target: Node 10.10.16.13 | PM2: openviva-web (Port 3001) | Tasks 1.1 -> 5.3")
print("=" * 85)

DB_PATH = "/home/savan/openviva/storage/openviva.db"
BASE_URL = "http://localhost:3001/openviva"
FACES_DIR = "/home/savan/openviva/storage/biometrics/faces"
KEYFRAMES_DIR = "/home/savan/openviva/storage/biometrics/keyframes"
VOICES_DIR = "/home/savan/openviva/storage/biometrics/voices"
EDGE_DIR = "/tmp/edge_cases_bio"
os.makedirs(EDGE_DIR, exist_ok=True)

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
            return resp.status, content, resp.headers.get("content-type", ""), elapsed
    except urllib.error.HTTPError as e:
        elapsed = (time.perf_counter() - t0) * 1000
        return e.code, e.read(), e.headers.get("content-type", ""), elapsed
    except Exception as ex:
        elapsed = (time.perf_counter() - t0) * 1000
        return 500, str(ex).encode(), "", elapsed

def send_post(endpoint, payload_dict, token=None):
    url = f"{BASE_URL}{endpoint}"
    data = json.dumps(payload_dict).encode("utf-8")
    headers = {"Content-Type": "application/json"}
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url, data=data, headers=headers, method="POST")
    t0 = time.perf_counter()
    try:
        with urllib.request.urlopen(req, timeout=30) as resp:
            elapsed = (time.perf_counter() - t0) * 1000
            res_body = json.loads(resp.read().decode("utf-8"))
            return resp.status, res_body, elapsed
    except urllib.error.HTTPError as e:
        elapsed = (time.perf_counter() - t0) * 1000
        try:
            res_body = json.loads(e.read().decode("utf-8"))
        except Exception:
            res_body = {"raw_error": str(e)}
        return e.code, res_body, elapsed
    except Exception as ex:
        elapsed = (time.perf_counter() - t0) * 1000
        return 500, {"network_error": str(ex)}, elapsed

def ndarray_to_b64(arr_rgb: np.ndarray, format: str = "JPEG") -> str:
    from io import BytesIO
    im = Image.fromarray(arr_rgb.astype(np.uint8), mode="RGB")
    bio = BytesIO()
    im.save(bio, format=format, quality=95)
    return "data:image/jpeg;base64," + base64.b64encode(bio.getvalue()).decode("utf-8")


# =========================================================================
# SECTION 1: CANDIDATE LIFECYCLE FIXTURES & ENROLLMENT (TASK 3.3 & 4.2)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 1: CANDIDATE LIFECYCLE FIXTURES & ENROLLMENT")
print("=" * 60)

E2E_CAND_ID = f"cand_e2e_{int(time.time())}"
E2E_SESSION_ID = f"sess_e2e_{int(time.time())}"
E2E_TOKEN = f"tok_e2e_{int(time.time())}"
EXPIRY = (datetime.now(timezone.utc) + timedelta(hours=3)).strftime("%Y-%m-%dT%H:%M:%S.000Z")

# Register student and session
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
cursor.execute("""
    INSERT OR REPLACE INTO students (reg_no, student_name, department, cohort, password_hash, salt, is_active, created_at, updated_at)
    VALUES (?, 'End-to-End Candidate', 'Computer Science & AI', '2026', 'hash', 'salt', 1, datetime('now'), datetime('now'))
""", (E2E_CAND_ID,))

cursor.execute("""
    INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at)
    VALUES (?, ?, 0, ?, datetime('now'))
""", (E2E_TOKEN, E2E_CAND_ID, EXPIRY))

cursor.execute("""
    INSERT OR REPLACE INTO exams (id, course_title, instructor_id, system_prompt, created_at)
    VALUES ('exam_default', 'Advanced Neural Biometrics Viva', 'inst_01', 'Default prompt', datetime('now'))
""")

cursor.execute("""
    INSERT OR REPLACE INTO exam_sessions (session_id, exam_id, course_title, student_id, status, started_at, created_at)
    VALUES (?, 'exam_default', 'Advanced Neural Biometrics Viva', ?, 'IN_PROGRESS', datetime('now'), datetime('now'))
""", (E2E_SESSION_ID, E2E_CAND_ID))

conn.commit()
conn.close()

# Prepare candidate bona fide image
source_cand_path = os.path.join(FACES_DIR, "reg1.jpg")
if not os.path.exists(source_cand_path):
    source_cand_path = os.path.join(FACES_DIR, "reg1_keyframe.jpg")

im_cand = Image.open(source_cand_path).convert("RGB")
b64_cand_face = ndarray_to_b64(np.array(im_cand))

# Prepare candidate bona fide 16kHz audio WAV
valid_voice_path = os.path.join(VOICES_DIR, "reg1.wav")
if os.path.exists(valid_voice_path):
    with open(valid_voice_path, "rb") as vf:
        b64_cand_voice = "data:audio/wav;base64," + base64.b64encode(vf.read()).decode("utf-8")
else:
    sample_rate = 16000
    duration = 1.0
    t = np.linspace(0, duration, int(sample_rate * duration), endpoint=False)
    audio = (np.sin(2 * np.pi * 440 * t) * 16384).astype(np.int16)
    import io, wave
    bio = io.BytesIO()
    with wave.open(bio, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(sample_rate)
        wf.writeframes(audio.tobytes())
    b64_cand_voice = "data:audio/wav;base64," + base64.b64encode(bio.getvalue()).decode("utf-8")

# Step 1: Candidate executes initial biometric enrollment via /api/auth/enroll-biometrics
status_enr, res_enr, ms_enr = send_post("/api/auth/enroll-biometrics", {
    "faceImageBase64": b64_cand_face,
    "voiceAudioBase64": b64_cand_voice,
    "studentName": "End-to-End Candidate"
}, token=E2E_TOKEN)

enrolled_ok = (status_enr == 200 and res_enr.get("success") is True)
record_test("1.1 Candidate Enrollment API Invocation Succeeded (HTTP 200)",
            enrolled_ok, f"HTTP {status_enr} | Success: {res_enr.get('success')} in {ms_enr:.1f}ms")

# Verify enrolled neural telemetry
tel = res_enr.get("biometrics", {}).get("telemetry", {}) or res_enr.get("telemetry", {})
record_test("1.2 Enrollment Returns Comprehensive Neural Telemetry (Liveness & Alignment)",
            tel.get("isLive") is True and tel.get("livenessScore", 0.0) >= 0.85 and "UMEYAMA" in str(tel.get("alignmentStatus", "")),
            f"Liveness: {tel.get('livenessScore')} | Alignment: {tel.get('alignmentStatus')}")

# Verify SQLite vector sealing (exact 2,048 bytes face and 768 bytes voice)
conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
c.execute("SELECT face_embedding, voice_embedding, verification_status FROM student_biometrics WHERE reg_no = ?", (E2E_CAND_ID,))
row = c.fetchone()
conn.close()

face_blob = row[0] if row else None
voice_blob = row[1] if row else None
status_db = row[2] if row else None

record_test("1.3 Biometric Vectors Sealed in SQLite (2048-B Face & 768-B Voice)",
            face_blob is not None and len(face_blob) == 2048 and voice_blob is not None and len(voice_blob) == 768,
            f"Face: {len(face_blob) if face_blob else 0} B | Voice: {len(voice_blob) if voice_blob else 0} B | Status: {status_db}")

# Verify candidate reference photo on disk
enrolled_photo_path = os.path.join(FACES_DIR, f"{E2E_CAND_ID}.jpg")
record_test("1.4 Candidate Reference Portrait Persisted on Disk",
            os.path.exists(enrolled_photo_path) and os.path.getsize(enrolled_photo_path) > 1000,
            f"Path: {enrolled_photo_path} ({os.path.getsize(enrolled_photo_path) if os.path.exists(enrolled_photo_path) else 0} B)")


# =========================================================================
# SECTION 2: PRE-VIVA CHAMBER GATE VERIFICATION (TASK 3.2 & 4.1)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 2: PRE-VIVA CHAMBER GATE VERIFICATION")
print("=" * 60)

# Candidate submits live webcam snapshot at pre-viva gate
status_gate, res_gate, ms_gate = send_post("/api/auth/verify-gate", {
    "regNo": E2E_CAND_ID,
    "liveFrameBase64": b64_cand_face,
    "sessionId": E2E_SESSION_ID
}, token=E2E_TOKEN)

gate_verified = (status_gate == 200 and res_gate.get("verified") is True and res_gate.get("similarity", 0.0) >= 0.62)
record_test("2.1 Chamber Gate Admits Bona Fide Candidate (HTTP 200, Sim >= 0.62)",
            gate_verified,
            f"HTTP {status_gate} | Verified: {res_gate.get('verified')} | Sim: {res_gate.get('similarity', 0.0):.4f} in {ms_gate:.1f}ms")

# Verify gate telemetry
gate_tel = res_gate.get("telemetry", {})
landmarks = gate_tel.get("landmarks") or []
record_test("2.2 Chamber Gate Forwards 5 Anatomical Facial Landmarks",
            len(landmarks) == 5, f"Landmarks count: {len(landmarks)} | Points: {landmarks[:2]}...")

record_test("2.3 Chamber Gate Anti-Spoof Liveness Confirmed (P_real >= 0.85)",
            gate_tel.get("isLive") is True and gate_tel.get("livenessScore", 0.0) >= 0.85,
            f"isLive: {gate_tel.get('isLive')} | Score: {gate_tel.get('livenessScore')}")

# Verify session keyframe saved to disk
expected_keyframe_path = os.path.join(KEYFRAMES_DIR, f"{E2E_SESSION_ID}.jpg")
keyframe_exists = os.path.exists(expected_keyframe_path) and os.path.getsize(expected_keyframe_path) > 1000
record_test("2.4 Chamber Gate Persists Live Session Keyframe to Disk",
            keyframe_exists,
            f"Path: {expected_keyframe_path} ({os.path.getsize(expected_keyframe_path) if keyframe_exists else 0} B)")

# Verify candidate status in SQLite updated to AUTHENTICATED
conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
c.execute("SELECT verification_status FROM student_biometrics WHERE reg_no = ?", (E2E_CAND_ID,))
current_status = c.fetchone()[0]
conn.close()

record_test("2.5 Student Verification Status Maintained as AUTHENTICATED in SQLite",
            current_status == "AUTHENTICATED", f"Status in DB: {current_status}")


# =========================================================================
# SECTION 3: KEYFRAME PHOTO RETRIEVAL LIFECYCLE (/api/biometrics/photo)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 3: KEYFRAME PHOTO RETRIEVAL LIFECYCLE")
print("=" * 60)

# Fetch session keyframe photo
kf_status, kf_raw, kf_ct, kf_ms = send_get(f"/api/biometrics/photo?regNo={E2E_CAND_ID}&type=keyframe&sessionId={E2E_SESSION_ID}")
record_test("3.1 Biometric Photo Server Serves Live Verified Exam Keyframe",
            kf_status == 200 and "image/jpeg" in kf_ct and len(kf_raw) > 1000,
            f"HTTP {kf_status} | Content-Type: {kf_ct} | Size: {len(kf_raw)} B in {kf_ms:.1f}ms")

# Fetch reference enrolled portrait
ref_status, ref_raw, ref_ct, ref_ms = send_get(f"/api/biometrics/photo?regNo={E2E_CAND_ID}&type=reference")
record_test("3.2 Biometric Photo Server Serves Enrolled Reference Portrait",
            ref_status == 200 and "image/jpeg" in ref_ct and len(ref_raw) > 1000,
            f"HTTP {ref_status} | Content-Type: {ref_ct} | Size: {len(ref_raw)} B in {ref_ms:.1f}ms")

# Fetch missing photo returns SVG placeholder
ghost_status, ghost_raw, ghost_ct, ghost_ms = send_get("/api/biometrics/photo?regNo=nonexistent_ghost_999&type=reference")
record_test("3.3 Missing Photo Gracefully Fallbacks to SVG Placeholder",
            ghost_status == 200 and ("image/svg" in ghost_ct or b"<svg" in ghost_raw),
            f"HTTP {ghost_status} | Content-Type: {ghost_ct} | Size: {len(ghost_raw)} B in {ghost_ms:.1f}ms")


# =========================================================================
# SECTION 4: TA EVALUATION SCORECARD BIOMETRIC HUD (TASK 4.3)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 4: TA EVALUATION SCORECARD BIOMETRIC HUD")
print("=" * 60)

# Query TA Scorecard Session HUD
hud_status, hud_raw, _, hud_ms = send_get(f"/api/biometrics/session-hud?sessionId={E2E_SESSION_ID}&regNo={E2E_CAND_ID}")
hud_json = json.loads(hud_raw.decode("utf-8")) if hud_status == 200 else {}

record_test("4.1 TA Scorecard HUD Endpoint Responded Successfully (HTTP 200)",
            hud_status == 200, f"HTTP {hud_status} in {hud_ms:.1f}ms")

record_test("4.2 TA HUD Displays AUTHENTICATED Verification Status",
            hud_json.get("verificationStatus") == "AUTHENTICATED",
            f"Status: {hud_json.get('verificationStatus')}")

record_test("4.3 TA HUD Displays Similarity Above Calibrated 62% Threshold",
            hud_json.get("faceMatchSimilarity", 0.0) >= 0.62,
            f"Face Match Similarity: {hud_json.get('faceMatchSimilarity')}")

record_test("4.4 TA HUD Confirms Anti-Spoof Liveness Confidence (>= 0.85)",
            hud_json.get("livenessConfidence", 0.0) >= 0.85,
            f"Liveness Confidence: {hud_json.get('livenessConfidence')}")

record_test("4.5 TA HUD Confirms Pure NumPy CLAHE Illumination Equalization",
            hud_json.get("claheNormalized") is True,
            f"claheNormalized: {hud_json.get('claheNormalized')}")

record_test("4.6 TA HUD Confirms Canonical 112x112 Umeyama Alignment Method",
            hud_json.get("alignmentMethod") == "UMEYAMA_5POINT_112X112",
            f"alignmentMethod: {hud_json.get('alignmentMethod')}")


# =========================================================================
# SECTION 5: SECURITY ANOMALY & FAIL-CLOSED LIFECYCLE MATRIX
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 5: SECURITY ANOMALY & FAIL-CLOSED LIFECYCLE MATRIX")
print("=" * 60)

# 1. 2D Paper Print Attack at Gate -> Fail-Closed HTTP 400
arr_print = np.array(im_cand, dtype=np.float32)
H, W, _ = arr_print.shape
arr_print = np.clip(arr_print * 0.95 + np.random.normal(0, 15, (H, W, 3)), 0, 255)
arr_print[:20, :, :] = 250
arr_print[-20:, :, :] = 250
arr_print[:, :20, :] = 250
arr_print[:, -20:, :] = 250
b64_print = ndarray_to_b64(arr_print)

sess_spoof_id = f"sess_spoof_gate_{int(time.time())}"
status_sp, res_sp, ms_sp = send_post("/api/auth/verify-gate", {
    "regNo": E2E_CAND_ID,
    "liveFrameBase64": b64_print,
    "sessionId": sess_spoof_id
}, token=E2E_TOKEN)

record_test("5.1 Gate Traps 2D Paper Print Attack with Fail-Closed HTTP 400",
            status_sp == 400 and res_sp.get("reason") == "SPOOF_PHOTO_DETECTED",
            f"HTTP {status_sp} | Reason: {res_sp.get('reason')} in {ms_sp:.1f}ms")

# Verify no keyframe saved for spoof attempt
spoof_kf_exists = os.path.exists(os.path.join(KEYFRAMES_DIR, f"{sess_spoof_id}.jpg"))
record_test("5.2 Forensic Integrity: Zero Keyframe Persisted for Spoof Attack",
            not spoof_kf_exists, f"Spoof keyframe exists: {spoof_kf_exists}")

# 2. Impostor Probe at Gate -> Rejected HTTP 200 verified=false, candidate FLAGGED
# Load distinct impostor portrait (reg9 or person_b_impostor)
imp_path = os.path.join(FACES_DIR, "reg9.jpg")
if not os.path.exists(imp_path):
    imp_path = os.path.join(FACES_DIR, "person_b_impostor.jpg")
im_imp = Image.open(imp_path).convert("RGB")
b64_imp = ndarray_to_b64(np.array(im_imp))

sess_imp_id = f"sess_imp_gate_{int(time.time())}"
status_imp, res_imp, ms_imp = send_post("/api/auth/verify-gate", {
    "regNo": E2E_CAND_ID,
    "liveFrameBase64": b64_imp,
    "sessionId": sess_imp_id
}, token=E2E_TOKEN)

record_test("5.3 Gate Rejects Impostor Candidate (verified=False, Sim < 0.35)",
            status_imp == 200 and res_imp.get("verified") is False and (res_imp.get("similarity") or 1.0) < 0.35,
            f"HTTP {status_imp} | Verified: {res_imp.get('verified')} | Sim: {float(res_imp.get('similarity') or 0.0):.4f} in {ms_imp:.1f}ms")

# Verify candidate status in SQLite transitioned to FLAGGED
conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
c.execute("SELECT verification_status FROM student_biometrics WHERE reg_no = ?", (E2E_CAND_ID,))
flagged_status = c.fetchone()[0]
conn.close()

record_test("5.4 Impostor Mismatch Updates Student Status to FLAGGED in SQLite",
            flagged_status == "FLAGGED", f"Status in DB: {flagged_status}")

# Check TA Scorecard HUD reflects FLAGGED status
hud_flag_status, hud_flag_raw, _, _ = send_get(f"/api/biometrics/session-hud?sessionId={sess_imp_id}&regNo={E2E_CAND_ID}")
hud_flag_json = json.loads(hud_flag_raw.decode("utf-8")) if hud_flag_status == 200 else {}

record_test("5.5 TA Scorecard HUD Reflects FLAGGED Status for Mismatched Session",
            hud_flag_json.get("verificationStatus") == "FLAGGED",
            f"HUD verificationStatus: {hud_flag_json.get('verificationStatus')}")

# 3. Bona Fide Candidate Re-Authenticates -> Restores AUTHENTICATED
sess_restore_id = f"sess_restore_gate_{int(time.time())}"
status_res, res_res, ms_res = send_post("/api/auth/verify-gate", {
    "regNo": E2E_CAND_ID,
    "liveFrameBase64": b64_cand_face,
    "sessionId": sess_restore_id
}, token=E2E_TOKEN)

conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
c.execute("SELECT verification_status FROM student_biometrics WHERE reg_no = ?", (E2E_CAND_ID,))
restored_status = c.fetchone()[0]
conn.close()

record_test("5.6 Re-Authentication Restores AUTHENTICATED Status in SQLite",
            status_res == 200 and res_res.get("verified") is True and restored_status == "AUTHENTICATED",
            f"HTTP {status_res} | Status in DB: {restored_status} in {ms_res:.1f}ms")

# 4. Blank Camera Frame -> Fail-Closed HTTP 400 NO_FACE_DETECTED
b64_black = ndarray_to_b64(np.zeros((480, 640, 3), dtype=np.uint8))
status_blk, res_blk, ms_blk = send_post("/api/auth/verify-gate", {
    "regNo": E2E_CAND_ID,
    "liveFrameBase64": b64_black,
    "sessionId": f"sess_blk_{int(time.time())}"
}, token=E2E_TOKEN)

record_test("5.7 Blank Camera Snapshot Fails Closed with HTTP 400 NO_FACE_DETECTED",
            status_blk == 400 and res_blk.get("reason") == "NO_FACE_DETECTED",
            f"HTTP {status_blk} | Reason: {res_blk.get('reason')} in {ms_blk:.1f}ms")

# 5. Missing / Invalid Session Token -> HTTP 401 Unauthorized
status_tok, res_tok, ms_tok = send_post("/api/auth/verify-gate", {
    "regNo": E2E_CAND_ID,
    "liveFrameBase64": b64_cand_face,
    "sessionId": f"sess_tok_{int(time.time())}"
}, token="bogus_invalid_token_xyz")

record_test("5.8 Bogus Authentication Token Fails Closed with HTTP 401 Unauthorized",
            status_tok == 401, f"HTTP {status_tok} in {ms_tok:.1f}ms")


# =========================================================================
# SECTION 6: CONCURRENCY & LATENCY BENCHMARK
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 6: CONCURRENCY & LATENCY BENCHMARK")
print("=" * 60)

def viva_gate_worker(idx):
    sess_id = f"sess_viva_bench_{idx}_{int(time.time())}"
    t0 = time.perf_counter()
    status, res, _ = send_post("/api/auth/verify-gate", {
        "regNo": E2E_CAND_ID,
        "liveFrameBase64": b64_cand_face,
        "sessionId": sess_id
    }, token=E2E_TOKEN)
    dur = (time.perf_counter() - t0) * 1000
    ok = (status == 200 and res.get("verified") is True)
    return ok, dur

with ThreadPoolExecutor(max_workers=3) as pool:
    futures = [pool.submit(viva_gate_worker, i) for i in range(3)]
    worker_results = [f.result() for f in futures]

bench_passed = all(r[0] for r in worker_results)
bench_latencies = [r[1] for r in worker_results]

record_test("6.1 Concurrency Benchmark: 3 Parallel Viva Defense Gate Entrants",
            bench_passed,
            f"Passed: {sum(1 for r in worker_results if r[0])}/3 | Latencies: {[f'{l:.1f}ms' for l in bench_latencies]}")

median_bench = sorted(bench_latencies)[len(bench_latencies) // 2]
record_test("6.2 Full-Stack Viva Verification Latency SLA (Median <= 400ms)",
            median_bench <= 400.0,
            f"Median: {median_bench:.1f}ms | Min: {min(bench_latencies):.1f}ms | Max: {max(bench_latencies):.1f}ms")


# =========================================================================
# FINAL AUDIT SUMMARY
# =========================================================================
print("\n" + "=" * 85)
total_tests = len(test_results)
passed_tests = sum(1 for _, passed, _ in test_results if passed)
pass_rate = (passed_tests / total_tests) * 100

print(f"TASK 5.3 EMPIRICAL AUDIT RESULTS: {passed_tests} / {total_tests} PASSED ({pass_rate:.1f}%)")
print("=" * 85)

if passed_tests == total_tests:
    print("\n[SUCCESS] ALL TASK 5.3 END-TO-END VIVA DEFENSE LIFECYCLE TESTS PASSED CLEANLY!\n")
    sys.exit(0)
else:
    print(f"\n[FAILURE] {total_tests - passed_tests} TESTS FAILED IN TASK 5.3 AUDIT!\n")
    sys.exit(1)
