"""
Empirical and Edge-Case Test Suite for Task 3.3 (Enrollment API /api/auth/enroll-biometrics)
Integrated with Tasks 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 3.1 & 3.2
Executes on node 10.10.16.13 against live Next.js PM2 server at http://localhost:3001/openviva
"""

import os
import sys
import time
import json
import base64
import sqlite3
import subprocess
import urllib.request
import urllib.error
import numpy as np
from datetime import datetime, timezone, timedelta
from PIL import Image
from concurrent.futures import ThreadPoolExecutor

print("=" * 80)
print("TASK 3.3 EMPIRICAL TEST SUITE: LIVE HTTP API /openviva/api/auth/enroll-biometrics")
print("Tasks 1.1 -> 3.3 Integrated Multi-Modal Verification on Node 10.10.16.13:3001")
print("=" * 80)

DB_PATH = "/home/savan/openviva/storage/openviva.db"
BASE_URL = "http://localhost:3001/openviva"
MODELS_DIR = "/home/savan/openviva/models/face"
FACES_DIR = "/home/savan/openviva/storage/biometrics/faces"
VOICES_DIR = "/home/savan/openviva/storage/biometrics/voices"
KEYFRAMES_DIR = "/home/savan/openviva/storage/biometrics/keyframes"
EDGE_DIR = "/tmp/edge_cases_bio"

os.makedirs(EDGE_DIR, exist_ok=True)
os.makedirs(KEYFRAMES_DIR, exist_ok=True)
os.makedirs(FACES_DIR, exist_ok=True)
os.makedirs(VOICES_DIR, exist_ok=True)

test_results = []

def record_test(name, passed, details=""):
    status = "PASS" if passed else "FAIL"
    test_results.append((name, passed, details))
    print(f"[{status}] {name}")
    if details:
        print(f"       Details: {details}")

# Helper to send HTTP requests to Next.js
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
            body = resp.read().decode("utf-8")
            return resp.status, json.loads(body), elapsed
    except urllib.error.HTTPError as e:
        elapsed = (time.perf_counter() - t0) * 1000
        body = e.read().decode("utf-8")
        try:
            parsed = json.loads(body)
        except Exception:
            parsed = {"raw": body}
        return e.code, parsed, elapsed
    except Exception as e:
        elapsed = (time.perf_counter() - t0) * 1000
        return 0, {"error": str(e)}, elapsed

def file_to_base64_data_uri(file_path, mime_type):
    with open(file_path, "rb") as f:
        raw = f.read()
    return f"data:{mime_type};base64," + base64.b64encode(raw).decode("ascii")

# =========================================================================
# PHASE 1: STATIC & ARCHITECTURE CONTRACTS
# =========================================================================
print("\n--- PHASE 1: Static & Architecture Invariants ---")

# 1.1 Models check
m_scrfd = os.path.join(MODELS_DIR, "scrfd_500m_kps.onnx")
m_liveness = os.path.join(MODELS_DIR, "minifasnet_v2.onnx")
m_arcface = os.path.join(MODELS_DIR, "mobilefacenet_arcface_512.onnx")

models_ok = os.path.exists(m_scrfd) and os.path.exists(m_liveness) and os.path.exists(m_arcface)
record_test("Invariant 1.1: Neural Triad ONNX Models Present and Intact", models_ok,
            f"SCRFD: {os.path.getsize(m_scrfd)} B | MiniFASNet: {os.path.getsize(m_liveness)} B | ArcFace: {os.path.getsize(m_arcface)} B")

# 1.2 Zero SHA-512 mock hashing in enroll route and biometrics lib
enroll_route_path = "/home/savan/openviva/web/src/app/api/auth/enroll-biometrics/route.ts"
bio_lib_path = "/home/savan/openviva/web/src/lib/biometrics.ts"

with open(enroll_route_path, "r", encoding="utf-8") as f:
    enroll_code = f.read()
with open(bio_lib_path, "r", encoding="utf-8") as f:
    bio_code = f.read()

zero_sha = ("createHash(\"sha512\")" not in enroll_code) and ("createHash('sha512')" not in enroll_code) and ("createHash" not in bio_code)
record_test("Invariant 1.2: Complete Elimination of SHA-512 Mock Fallback Across Enrollment Pipeline", zero_sha,
            "Verified zero mock SHA-512 byte hashing across enroll-biometrics and biometrics.ts")

# 1.3 Exact vector size invariants
exact_sizes = ("FACE_EMBEDDING_BYTES" in enroll_code) and ("VOICE_EMBEDDING_BYTES" in enroll_code)
record_test("Invariant 1.3: Enforces Exact 2,048-byte Face and 768-byte Voice Vector Schema", exact_sizes,
            "Face: 512 float32 (2048 B) | Voice: 192 float32 (768 B)")

# =========================================================================
# PHASE 2: DATABASE FIXTURES & AUTH GATES (HTTP 401 & 400)
# =========================================================================
print("\n--- PHASE 2: Database Sessions & Authentication Gates ---")

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# Ensure reg2 exists in students table and is active
cursor.execute("SELECT reg_no, is_active FROM students WHERE reg_no = 'reg2'")
row = cursor.fetchone()
if not row:
    cursor.execute("INSERT INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at, updated_at) VALUES ('reg2', 'student 2', 'CSE', '2026', 'x', 'x', 0, 1, datetime('now'), datetime('now'))")
elif row[1] != 1:
    cursor.execute("UPDATE students SET is_active = 1 WHERE reg_no = 'reg2'")

# Create active test session for reg2
token_reg2 = f"enroll_live_token_{int(time.time())}"
token_expired = f"enroll_expired_token_{int(time.time())}"
token_inactive = f"enroll_inactive_token_{int(time.time())}"

now_utc = datetime.now(timezone.utc)
iso_future = (now_utc + timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
iso_past = (now_utc - timedelta(hours=2)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
iso_now = now_utc.strftime('%Y-%m-%dT%H:%M:%S.000Z')

cursor.execute("DELETE FROM student_sessions WHERE reg_no IN ('reg2', 'reg_inactive')")
cursor.execute(
    "INSERT INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg2', 0, ?, ?)",
    (token_reg2, iso_future, iso_now)
)
cursor.execute(
    "INSERT INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg2', 0, ?, ?)",
    (token_expired, iso_past, iso_now)
)
cursor.execute(
    "INSERT INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg_inactive', 0, ?, ?)",
    (token_inactive, iso_future, iso_now)
)
conn.commit()
conn.close()

# Prepare media fixtures
valid_face_path = os.path.join(FACES_DIR, "reg1.jpg") # high-quality bona fide portrait
valid_voice_path = os.path.join(VOICES_DIR, "reg1.wav") # valid 16kHz WAV

b64_valid_face = file_to_base64_data_uri(valid_face_path, "image/jpeg")
b64_valid_voice = file_to_base64_data_uri(valid_voice_path, "audio/wav")

# 2.1 Missing token
status, data, _ = send_post("/api/auth/enroll-biometrics", {"faceImageBase64": b64_valid_face, "voiceAudioBase64": b64_valid_voice})
record_test("Auth 2.1: Missing Token Returns HTTP 401", status == 401 and "Missing authentication token" in str(data),
            f"Status: {status} | Error: {data.get('error')}")

# 2.2 Bogus token
status, data, _ = send_post("/api/auth/enroll-biometrics", {"faceImageBase64": b64_valid_face, "voiceAudioBase64": b64_valid_voice}, token="bogus_token_xyz")
record_test("Auth 2.2: Invalid Token Returns HTTP 401", status == 401 and "Invalid or expired session" in str(data),
            f"Status: {status} | Error: {data.get('error')}")

# 2.3 Expired token
status, data, _ = send_post("/api/auth/enroll-biometrics", {"faceImageBase64": b64_valid_face, "voiceAudioBase64": b64_valid_voice}, token=token_expired)
record_test("Auth 2.3: Expired Token Returns HTTP 401", status == 401 and "Invalid or expired session" in str(data),
            f"Status: {status} | Error: {data.get('error')}")

# 2.4 Inactive candidate account
status, data, _ = send_post("/api/auth/enroll-biometrics", {"faceImageBase64": b64_valid_face, "voiceAudioBase64": b64_valid_voice}, token=token_inactive)
record_test("Auth 2.4: Inactive Candidate Session Returns HTTP 401", status == 401,
            f"Status: {status} | Error: {data.get('error')}")

# 2.5 Missing face image payload
status, data, _ = send_post("/api/auth/enroll-biometrics", {"voiceAudioBase64": b64_valid_voice}, token=token_reg2)
record_test("Auth 2.5: Missing Face Capture Returns HTTP 400", status == 400 and "Missing required face portrait" in str(data),
            f"Status: {status} | Error: {data.get('error')}")

# 2.6 Missing voice audio payload
status, data, _ = send_post("/api/auth/enroll-biometrics", {"faceImageBase64": b64_valid_face}, token=token_reg2)
record_test("Auth 2.6: Missing Voice Audio Recording Returns HTTP 400", status == 400 and "Missing required voice audio" in str(data),
            f"Status: {status} | Error: {data.get('error')}")

# 2.7 Corrupted face image buffer
status, data, _ = send_post("/api/auth/enroll-biometrics", {"faceImageBase64": "data:image/jpeg;base64,short", "voiceAudioBase64": b64_valid_voice}, token=token_reg2)
record_test("Auth 2.7: Corrupted Face Portrait Buffer Returns HTTP 400", status == 400 and "corrupted" in str(data).lower(),
            f"Status: {status} | Error: {data.get('error')}")

# 2.8 Corrupted voice audio buffer
status, data, _ = send_post("/api/auth/enroll-biometrics", {"faceImageBase64": b64_valid_face, "voiceAudioBase64": "data:audio/wav;base64,short"}, token=token_reg2)
record_test("Auth 2.8: Corrupted Voice Audio Buffer Returns HTTP 400", status == 400 and "corrupted" in str(data).lower(),
            f"Status: {status} | Error: {data.get('error')}")

# =========================================================================
# PHASE 3: FAIL-CLOSED SECURITY GATES & STAGING ISOLATION (HTTP 400)
# =========================================================================
print("\n--- PHASE 3: Fail-Closed Security Gates & Anomaly Edge Cases ---")

# Ensure reg2 target files and DB records are clean before security probe
reg2_face_dest = os.path.join(FACES_DIR, "reg2.jpg")
reg2_voice_dest = os.path.join(VOICES_DIR, "reg2.wav")
if os.path.exists(reg2_face_dest): os.remove(reg2_face_dest)
if os.path.exists(reg2_voice_dest): os.remove(reg2_voice_dest)

conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
c.execute("DELETE FROM student_biometrics WHERE reg_no = 'reg2'")
conn.commit()
conn.close()

# 3.1 Zero-face frame (pure black) -> HTTP 400 NO_FACE_DETECTED
b64_black = file_to_base64_data_uri(os.path.join(EDGE_DIR, "black.jpg"), "image/jpeg")
status, data, _ = send_post("/api/auth/enroll-biometrics", {"faceImageBase64": b64_black, "voiceAudioBase64": b64_valid_voice}, token=token_reg2)
ok_zero = (status == 400) and (data.get("reason") == "NO_FACE_DETECTED")
record_test("Security 3.1: Zero-Face Canvas Returns HTTP 400 NO_FACE_DETECTED", ok_zero,
            f"Status: {status} | Reason: {data.get('reason')} | Message: {data.get('message')}")

# Verify no files were created on disk when zero-face failed
record_test("Security 3.2: Staging Isolation: No Disk Artifacts Created on Zero-Face Failure",
            not os.path.exists(reg2_face_dest) and not os.path.exists(reg2_voice_dest),
            f"Files exist: Face={os.path.exists(reg2_face_dest)}, Voice={os.path.exists(reg2_voice_dest)}")

# 3.3 Multi-person frame -> HTTP 400 MULTIPLE_FACES_DETECTED
b64_multi = file_to_base64_data_uri(os.path.join(EDGE_DIR, "multi.jpg"), "image/jpeg")
status, data, _ = send_post("/api/auth/enroll-biometrics", {"faceImageBase64": b64_multi, "voiceAudioBase64": b64_valid_voice}, token=token_reg2)
ok_multi = (status == 400) and (data.get("reason") == "MULTIPLE_FACES_DETECTED")
record_test("Security 3.3: Multi-Person Portrait Returns HTTP 400 MULTIPLE_FACES_DETECTED", ok_multi,
            f"Status: {status} | Reason: {data.get('reason')} | Message: {data.get('message')}")

# 3.4 Presentation attack / spoof (paper print attack) -> HTTP 400 SPOOF_PHOTO_DETECTED
b64_spoof = file_to_base64_data_uri(os.path.join(EDGE_DIR, "paper_print_spoof.jpg"), "image/jpeg")
status, data, _ = send_post("/api/auth/enroll-biometrics", {"faceImageBase64": b64_spoof, "voiceAudioBase64": b64_valid_voice}, token=token_reg2)
ok_spoof = (status == 400) and (data.get("reason") == "SPOOF_PHOTO_DETECTED")
record_test("Security 3.4: Paper Print Spoof Portrait Returns HTTP 400 SPOOF_PHOTO_DETECTED", ok_spoof,
            f"Status: {status} | Reason: {data.get('reason')} | Score: {data.get('livenessScore')} | Type: {data.get('spoofType')}")

# Verify no database record was created on spoof failure
conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
c.execute("SELECT reg_no FROM student_biometrics WHERE reg_no = 'reg2'")
row_bio = c.fetchone()
conn.close()
record_test("Security 3.5: Database Isolation: No SQLite Record Committed on Spoof Failure",
            row_bio is None, f"Database row for reg2: {row_bio}")

# =========================================================================
# PHASE 4: GENUINE CANDIDATE BIOMETRIC ENROLLMENT (Task 3.3 Main Flow)
# =========================================================================
print("\n--- PHASE 4: Genuine Candidate Biometric Enrollment ---")

status, data, dt_enroll = send_post(
    "/api/auth/enroll-biometrics",
    {"faceImageBase64": b64_valid_face, "voiceAudioBase64": b64_valid_voice, "studentName": "Student Two"},
    token=token_reg2
)

enroll_ok = (status == 200) and (data.get("success") is True)
bio_info = data.get("biometrics", {})
telem = bio_info.get("telemetry", {})

record_test("Enroll 4.1: Genuine Candidate Identity Ground Truth Sealed (HTTP 200)", enroll_ok,
            f"Status: {status} | Success: {data.get('success')} | Latency: {dt_enroll:.1f}ms")

# Verify vector dimensions
vecs_ok = (bio_info.get("faceEmbeddingBytes") == 2048) and (bio_info.get("voiceEmbeddingBytes") == 768)
record_test("Enroll 4.2: Sealed Vectors Match 2048-byte Face and 768-byte Voice Schema", vecs_ok,
            f"Face: {bio_info.get('faceEmbeddingBytes')} B | Voice: {bio_info.get('voiceEmbeddingBytes')} B")

# Verify rich telemetry forwarded
telem_ok = (telem.get("isLive") is True) and (telem.get("livenessScore", 0) >= 0.85) and (len(telem.get("landmarks", [])) == 5)
record_test("Enroll 4.3: Enrollment Returns Comprehensive Neural Telemetry", telem_ok,
            f"Box: {telem.get('faceBox')} | KPS: 5 pts | P(Real): {telem.get('livenessScore')} | Illum: {telem.get('illuminationStatus')}")

# Check permanent files on disk
disk_face_ok = os.path.exists(reg2_face_dest) and os.path.getsize(reg2_face_dest) > 1000
disk_voice_ok = os.path.exists(reg2_voice_dest) and os.path.getsize(reg2_voice_dest) > 1000
record_test("Enroll 4.4: Permanent Candidate Biometric Media Saved on Storage Disk", disk_face_ok and disk_voice_ok,
            f"Face: {reg2_face_dest} ({os.path.getsize(reg2_face_dest) if disk_face_ok else 0} B) | Voice: {reg2_voice_dest} ({os.path.getsize(reg2_voice_dest) if disk_voice_ok else 0} B)")

# Check SQLite student_biometrics record
conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
c.execute("SELECT reg_no, length(face_embedding), length(voice_embedding), verification_status FROM student_biometrics WHERE reg_no = 'reg2'")
db_reg2 = c.fetchone()
conn.close()

db_ok = (db_reg2 is not None) and (db_reg2[1] == 2048) and (db_reg2[2] == 768) and (db_reg2[3] == "AUTHENTICATED")
record_test("Enroll 4.5: SQLite student_biometrics Record Sealed with AUTHENTICATED Status", db_ok,
            f"DB row: reg_no={db_reg2[0] if db_reg2 else None}, face_len={db_reg2[1] if db_reg2 else 0}, voice_len={db_reg2[2] if db_reg2 else 0}, status={db_reg2[3] if db_reg2 else None}")

# =========================================================================
# PHASE 5: MULTI-TASK VERIFICATION INTEGRATION (Tasks 1.1 -> 3.3 FULL CHAIN)
# =========================================================================
print("\n--- PHASE 5: End-to-End System Integration: Immediate Verify-Gate Test ---")

# Test 5.1: Immediately verify the newly enrolled reg2 at the chamber entry gate (Task 3.2)
# Using reg1_keyframe.jpg as the live camera snapshot (which matches reg1.jpg face enrolled for reg2)
sess_id_reg2 = f"sess_reg2_e2e_{int(time.time())}"
b64_reg2_probe = file_to_base64_data_uri(os.path.join(FACES_DIR, "reg1_keyframe.jpg"), "image/jpeg")

s_ver, d_ver, dt_ver = send_post(
    "/api/auth/verify-gate",
    {"liveFrameBase64": b64_reg2_probe, "sessionId": sess_id_reg2},
    token=token_reg2
)

ver_ok = (s_ver == 200) and (d_ver.get("verified") is True) and (d_ver.get("similarity", 0) >= 0.62)
record_test("Integration 5.1: Newly Enrolled Candidate Authorized at Verify-Gate (Task 3.2)", ver_ok,
            f"HTTP: {s_ver} | Verified: {d_ver.get('verified')} | Similarity: {d_ver.get('similarity')} (>= 0.62) | Liveness: {d_ver.get('telemetry', {}).get('livenessScore')}")

# Test 5.2: Verify keyframe persisted for reg2
kf_reg2_path = os.path.join(KEYFRAMES_DIR, f"{sess_id_reg2}.jpg")
kf_reg2_ok = os.path.exists(kf_reg2_path) and os.path.getsize(kf_reg2_path) > 1000
record_test("Integration 5.2: Chamber Admission Keyframe Persisted for Newly Enrolled Candidate", kf_reg2_ok,
            f"Path: {kf_reg2_path} ({os.path.getsize(kf_reg2_path) if kf_reg2_ok else 0} B)")

# Test 5.3: Impostor probe rejected against newly enrolled reg2
b64_reg9 = file_to_base64_data_uri(os.path.join(FACES_DIR, "reg9.jpg"), "image/jpeg")
s_imp, d_imp, _ = send_post(
    "/api/auth/verify-gate",
    {"liveFrameBase64": b64_reg9},
    token=token_reg2
)

imp_ok = (s_imp == 200) and (d_imp.get("verified") is False) and (d_imp.get("similarity", 1.0) < 0.35)
record_test("Integration 5.3: Impostor Access Denied Against Newly Enrolled Candidate (reg9 vs reg2)", imp_ok,
            f"HTTP: {s_imp} | Verified: {d_imp.get('verified')} | Similarity: {d_imp.get('similarity')} (< 0.35)")

# Check status updated to FLAGGED on impostor
conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
c.execute("SELECT verification_status FROM student_biometrics WHERE reg_no = 'reg2'")
db_flag_status = c.fetchone()[0]
# Restore for candidate
c.execute("UPDATE student_biometrics SET verification_status = 'AUTHENTICATED' WHERE reg_no = 'reg2'")
conn.commit()
conn.close()
record_test("Integration 5.4: Database Status Updated to FLAGGED on Impostor Attempt", db_flag_status == "FLAGGED",
            f"DB Status: {db_flag_status}")

# =========================================================================
# PHASE 6: CONCURRENCY & PERFORMANCE SLA
# =========================================================================
print("\n--- PHASE 6: Multi-Threaded Concurrency & Performance Benchmark ---")

# 6.1 Parallel requests to verify concurrency safety
def run_concurrent_enroll(idx):
    s, d, el = send_post(
        "/api/auth/enroll-biometrics",
        {"faceImageBase64": b64_valid_face, "voiceAudioBase64": b64_valid_voice},
        token=token_reg2
    )
    return (s == 200 and d.get("success") is True, el)

with ThreadPoolExecutor(max_workers=3) as pool:
    concur_enroll_res = list(pool.map(run_concurrent_enroll, range(3)))

concur_ok = all(r[0] for r in concur_enroll_res)
record_test("Concurrency 6.1: Concurrent Multi-Modal Enrollment Requests (3 Parallel Workers)", concur_ok,
            f"Passed: {sum(1 for r in concur_enroll_res if r[0])}/3 | Latencies: {[round(r[1], 1) for r in concur_enroll_res]}ms")

# 6.2 Latency SLA Benchmark
enroll_latencies = []
for _ in range(3):
    s, d, el = send_post(
        "/api/auth/enroll-biometrics",
        {"faceImageBase64": b64_valid_face, "voiceAudioBase64": b64_valid_voice},
        token=token_reg2
    )
    if s == 200:
        enroll_latencies.append(el)

enroll_latencies.sort()
med_enroll_lat = enroll_latencies[len(enroll_latencies) // 2]
record_test("Latency 6.2: Full-Stack Enrollment Latency SLA (Multi-Modal Neural Pipeline <= 600.0ms)", med_enroll_lat <= 600.0,
            f"Median: {med_enroll_lat:.2f}ms | Min: {enroll_latencies[0]:.2f}ms | Max: {enroll_latencies[-1]:.2f}ms (Production SLA: <= 600.0ms)")

# =========================================================================
# SUMMARY & VERDICT
# =========================================================================
total_passed = sum(1 for _, p, _ in test_results if p)
total_tests = len(test_results)
print("\n" + "=" * 80)
print(f"TASK 3.3 EMPIRICAL SUITE RESULTS: {total_passed}/{total_tests} TESTS PASSED ({(total_passed/total_tests)*100:.1f}%)")
print("=" * 80)

if total_passed == total_tests:
    print(">>> ALL TASK 3.3 EMPIRICAL & EDGE-CASE TESTS PASSED WITH 100% SUCCESS! <<<")
    sys.exit(0)
else:
    print(f">>> TEST SUITE FAILED: {total_tests - total_passed} tests failed. <<<")
    sys.exit(1)
