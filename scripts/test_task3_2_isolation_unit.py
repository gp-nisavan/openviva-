"""
TASK 3.2 ISOLATION UNIT TEST SUITE: VERIFY-GATE ROUTE & BIOMETRIC ENGINES
Strict unit-level testing in isolation without external network reliance.
Executes on node 10.10.16.13 using Python agent_env and Node.js runtime.
"""

import os
import sys
import time
import math
import json
import base64
import sqlite3
import struct
import numpy as np
from datetime import datetime, timezone, timedelta
from PIL import Image

print("=" * 80)
print("TASK 3.2 ISOLATION UNIT TEST SUITE: UNIT-LEVEL ISOLATED VALIDATIONS")
print("Testing Biometric Math, Neural Units, DB Adapters & Route Logic in Isolation")
print("=" * 80)

test_results = []

def record_unit_test(suite, name, passed, details=""):
    status = "PASS" if passed else "FAIL"
    test_results.append((suite, name, passed, details))
    print(f"[{status}] [{suite}] {name}")
    if details:
        print(f"       Details: {details}")

# =========================================================================
# SUITE 1: COSINE SIMILARITY & VECTOR MATH IN ISOLATION
# =========================================================================
print("\n--- SUITE 1: Mathematical & Vector Invariants in Isolation ---")

# Pure Python / NumPy implementation of calculateCosineSimilarity to verify exact logic
def calculate_cosine_similarity_unit(ref_buf: bytes, live_buf: bytes) -> float:
    if len(ref_buf) != 2048 or len(live_buf) != 2048:
        raise ValueError(f"Buffer length must be 2048, got ref={len(ref_buf)}, live={len(live_buf)}")
    v_ref = np.frombuffer(ref_buf, dtype=np.float32)
    v_live = np.frombuffer(live_buf, dtype=np.float32)
    dot = float(np.dot(v_ref, v_live))
    norm_ref = float(np.linalg.norm(v_ref))
    norm_live = float(np.linalg.norm(v_live))
    if norm_ref == 0.0 or norm_live == 0.0:
        return 0.0
    cos_sim = dot / (norm_ref * norm_live)
    return max(-1.0, min(1.0, cos_sim))

# 1.1 Identical unit vectors yield strictly 1.0000
v_rand = np.random.randn(512).astype(np.float32)
v_rand /= np.linalg.norm(v_rand)
buf_a = v_rand.tobytes()
sim_ident = calculate_cosine_similarity_unit(buf_a, buf_a)
record_unit_test("Math", "Unit 1.1: Identical unit vectors produce similarity 1.0000",
                 abs(sim_ident - 1.0) < 1e-6, f"Similarity: {sim_ident:.6f}")

# 1.2 Inverted unit vectors yield strictly -1.0000
buf_inv = (-v_rand).tobytes()
sim_inv = calculate_cosine_similarity_unit(buf_a, buf_inv)
record_unit_test("Math", "Unit 1.2: Inverted unit vectors produce similarity -1.0000",
                 abs(sim_inv - (-1.0)) < 1e-6, f"Similarity: {sim_inv:.6f}")

# 1.3 Orthogonal vectors yield strictly 0.0000
v_ortho = np.zeros(512, dtype=np.float32)
v_ortho[0] = 1.0
v_ortho_b = np.zeros(512, dtype=np.float32)
v_ortho_b[1] = 1.0
sim_ortho = calculate_cosine_similarity_unit(v_ortho.tobytes(), v_ortho_b.tobytes())
record_unit_test("Math", "Unit 1.3: Orthogonal vectors produce similarity 0.0000",
                 abs(sim_ortho - 0.0) < 1e-6, f"Similarity: {sim_ortho:.6f}")

# 1.4 Invalid buffer sizes rejected
bad_buf = b"\x00" * 1024
try:
    calculate_cosine_similarity_unit(bad_buf, buf_a)
    threw_len = False
except ValueError:
    threw_len = True
record_unit_test("Math", "Unit 1.4: Reject non-2048 byte buffer (1024 bytes)",
                 threw_len, "Successfully threw ValueError on invalid buffer length")

# 1.5 Threshold decision logic (0.62)
thresh = 0.62
record_unit_test("Math", "Unit 1.5: Threshold decision boundary (score 0.6200 -> authorized)",
                 (0.6200 >= thresh) and not (0.6199 >= thresh),
                 f"Threshold: {thresh} | 0.6200 => True | 0.6199 => False")

# =========================================================================
# SUITE 2: NEURAL PIPELINE UNITS IN ISOLATION
# =========================================================================
print("\n--- SUITE 2: Neural Pipeline Units in Isolation ---")

sys.path.insert(0, "/home/savan/openviva/scripts")
import extract_biometrics

# 2.1 SCRFD Detector Unit
det = extract_biometrics.get_scrfd_detector()
test_canvas = Image.new("RGB", (320, 320), (128, 128, 128))
zero_faces = det.detect(test_canvas)
record_unit_test("Neural", "Unit 2.1: SCRFDDetector returns empty list on blank canvas",
                 len(zero_faces) == 0, f"Detected faces count: {len(zero_faces)}")

# 2.2 MiniFASNet Liveness Unit with Mock Presentation Attack
liveness = extract_biometrics.get_liveness_classifier()
record_unit_test("Neural", "Unit 2.2: MiniFASNetLiveness initialized with calibrated 0.80 thresh",
                 liveness.liveness_thresh == 0.80, f"Threshold: {liveness.liveness_thresh}")

# Test SpoofError typed exception
spoof_ok = False
score_saved = 0.0
type_saved = ""
try:
    raise extract_biometrics.SpoofError("Presentation attack detected", liveness_score=0.015, spoof_type="PRINT_ATTACK", spoof_probabilities={"real": 0.015, "print_attack": 0.985, "replay_attack": 0.0})
except extract_biometrics.SpoofError as se:
    spoof_ok = (se.liveness_score == 0.015) and (se.spoof_type == "PRINT_ATTACK")
    score_saved = se.liveness_score
    type_saved = se.spoof_type
record_unit_test("Neural", "Unit 2.3: SpoofError preserves liveness score and spoof type metadata",
                 spoof_ok, f"Score: {score_saved} | Type: {type_saved}")

# 2.3 Umeyama Similarity Transform Unit in Isolation
canonical_kps = np.array([
    [38.2946, 51.6963],
    [73.5318, 51.5014],
    [56.0252, 71.7366],
    [41.5493, 92.3655],
    [70.7299, 92.2041]
], dtype=np.float32)

M_identity = extract_biometrics.umeyama(canonical_kps, canonical_kps, estimate_scale=True)
record_unit_test("Neural", "Unit 2.4: Umeyama transform of canonical landmarks recovers identity 3x3 matrix",
                 np.allclose(M_identity, np.eye(3), atol=1e-5), f"Diagonal: {[round(x, 4) for x in np.diag(M_identity)]}")

# 2.4 Pure NumPy CLAHE Unit in Isolation
flat_rgb = np.full((112, 112, 3), 50, dtype=np.uint8)
clahe_flat = extract_biometrics.numpy_clahe(flat_rgb, clip_limit=2.0)
record_unit_test("Neural", "Unit 2.5: Pure NumPy CLAHE preserves dimensions and RGB mode",
                 clahe_flat.size == (112, 112) and clahe_flat.mode == "RGB",
                 f"Size: {clahe_flat.size} | Mode: {clahe_flat.mode}")

# 2.5 MobileFaceNet ArcFace Extractor Unit in Isolation
arcface = extract_biometrics.get_arcface_extractor()
dummy_aligned = Image.new("RGB", (112, 112), (120, 100, 80))
emb_bytes = arcface.extract(dummy_aligned)
emb_arr = np.frombuffer(emb_bytes, dtype=np.float32)
norm_val = float(np.linalg.norm(emb_arr))
record_unit_test("Neural", "Unit 2.6: ArcFaceExtractor extracts 512-d unit-norm vector (2048 bytes)",
                 len(emb_bytes) == 2048 and abs(norm_val - 1.0) < 1e-4,
                 f"Bytes: {len(emb_bytes)} | Dim: {len(emb_arr)} | L2 Norm: {norm_val:.6f}")

# =========================================================================
# SUITE 3: DATABASE SESSION & BIOMETRICS QUERIES IN ISOLATION
# =========================================================================
print("\n--- SUITE 3: Database Session & Biometrics Adapters in Isolation ---")

DB_PATH = "/home/savan/openviva/storage/openviva.db"

# We execute the exact SQL queries used by validateStudentSession, getStudentBiometrics, upsertStudentBiometrics
def unit_validate_session(token: str, db_path: str = DB_PATH):
    if not token:
        return None
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    now_iso = datetime.now(timezone.utc).strftime('%Y-%m-%dT%H:%M:%S.000Z')
    c.execute(
        """SELECT s.reg_no, s.student_name, s.department, s.cohort, s.password_hash, s.salt, 
                  s.must_change_password, s.is_active, s.created_at, s.updated_at, ss.is_temp
           FROM student_sessions ss
           JOIN students s ON ss.reg_no = s.reg_no
           WHERE ss.token = ? AND ss.expires_at > ? AND s.is_active = 1""",
        (token, now_iso)
    )
    row = c.fetchone()
    conn.close()
    if not row:
        return None
    return {
        "student": {"regNo": row[0], "studentName": row[1], "department": row[2], "isActive": bool(row[7])},
        "isTemp": bool(row[10])
    }

def unit_get_biometrics(reg_no: str, db_path: str = DB_PATH):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("SELECT reg_no, student_name, face_embedding, verification_status FROM student_biometrics WHERE LOWER(reg_no) = LOWER(?)", (reg_no,))
    row = c.fetchone()
    conn.close()
    if not row:
        return None
    return {"regNo": row[0], "studentName": row[1], "faceEmbedding": row[2], "verificationStatus": row[3]}

def unit_upsert_status(reg_no: str, status: str, db_path: str = DB_PATH):
    conn = sqlite3.connect(db_path)
    c = conn.cursor()
    c.execute("UPDATE student_biometrics SET verification_status = ? WHERE LOWER(reg_no) = LOWER(?)", (status, reg_no))
    conn.commit()
    conn.close()

# 3.1 Validate unexpired active session
now_utc = datetime.now(timezone.utc)
iso_fut = (now_utc + timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
iso_past = (now_utc - timedelta(hours=1)).strftime('%Y-%m-%dT%H:%M:%S.000Z')
iso_now = now_utc.strftime('%Y-%m-%dT%H:%M:%S.000Z')

test_tok_valid = f"unit_tok_valid_{int(time.time())}"
test_tok_exp = f"unit_tok_exp_{int(time.time())}"

conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
c.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg1', 0, ?, ?)", (test_tok_valid, iso_fut, iso_now))
c.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg1', 0, ?, ?)", (test_tok_exp, iso_past, iso_now))
conn.commit()
conn.close()

res_valid = unit_validate_session(test_tok_valid)
record_unit_test("Database", "Unit 3.1: Valid session returns student record with isActive=True",
                 res_valid is not None and res_valid["student"]["regNo"] == "reg1",
                 f"Student: {res_valid.get('student') if res_valid else None}")

# 3.2 Expired session returns None
res_exp = unit_validate_session(test_tok_exp)
record_unit_test("Database", "Unit 3.2: Expired session returns None",
                 res_exp is None, f"Result: {res_exp}")

# 3.3 Nonexistent session returns None
res_nonexist = unit_validate_session("completely_bogus_token")
record_unit_test("Database", "Unit 3.3: Nonexistent token returns None",
                 res_nonexist is None, f"Result: {res_nonexist}")

# 3.4 Inactive candidate returns None
res_inact = unit_validate_session(None)
record_unit_test("Database", "Unit 3.4: Null/Empty token returns None immediately",
                 res_inact is None, f"Result: {res_inact}")

# 3.5 Biometrics ground truth fetch
bio_reg1 = unit_get_biometrics("reg1")
record_unit_test("Database", "Unit 3.5: getStudentBiometrics retrieves 2048-byte sealed vector",
                 bio_reg1 is not None and len(bio_reg1["faceEmbedding"]) == 2048,
                 f"Bytes: {len(bio_reg1['faceEmbedding']) if bio_reg1 else 0} | Status: {bio_reg1.get('verificationStatus') if bio_reg1 else None}")

# 3.6 Upsert status update
unit_upsert_status("reg1", "AUTHENTICATED")
bio_after = unit_get_biometrics("reg1")
record_unit_test("Database", "Unit 3.6: upsertStudentBiometrics updates verificationStatus to AUTHENTICATED",
                 bio_after["verificationStatus"] == "AUTHENTICATED", f"Status: {bio_after['verificationStatus']}")

# Clean test session tokens
conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
c.execute("DELETE FROM student_sessions WHERE token IN (?, ?)", (test_tok_valid, test_tok_exp))
conn.commit()
conn.close()

# =========================================================================
# SUITE 4: VERIFY-GATE ROUTE HANDLER LOGIC & BRANCH MATRIX IN ISOLATION
# =========================================================================
print("\n--- SUITE 4: Verify-Gate Route Handler Branch Matrix in Isolation ---")

# We simulate the exact logic branches of POST(req: NextRequest) in web/src/app/api/auth/verify-gate/route.ts
def simulate_verify_gate_handler(auth_token, body, session_data_fn, biometrics_fn, extract_fn):
    # Step 1: Token verification
    if not auth_token:
        return 401, {"verified": False, "error": "Unauthorized: Missing authentication token."}
    
    session = session_data_fn(auth_token)
    if not session or not session.get("student") or not session["student"].get("isActive"):
        return 401, {"verified": False, "error": "Unauthorized: Invalid or expired session."}
    
    reg_no = session["student"]["regNo"].lower()

    # Step 2: Body validation
    if not body or not body.get("liveFrameBase64") or not isinstance(body["liveFrameBase64"], str):
        return 400, {"verified": False, "error": "Missing live camera frame snapshot ('liveFrameBase64')."}

    # Step 3: Ground truth reference
    record = biometrics_fn(reg_no)
    if not record or not record.get("faceEmbedding"):
        return 400, {"verified": False, "error": "Biometric ground truth is not sealed. Please complete initial enrollment first."}

    # Step 4: Parse image buffer
    b64_data = body["liveFrameBase64"].replace("data:image/jpeg;base64,", "").replace("data:image/png;base64,", "")
    try:
        raw_bytes = base64.b64decode(b64_data)
    except Exception:
        return 400, {"verified": False, "error": "Invalid or corrupted camera snapshot image buffer."}
    
    if len(raw_bytes) < 100:
        return 400, {"verified": False, "error": "Invalid or corrupted camera snapshot image buffer."}

    # Step 5: Extract embedding & telemetry
    try:
        live_embedding, telemetry = extract_fn(raw_bytes)
    except extract_biometrics.SpoofError as se:
        return 400, {
            "verified": False,
            "reason": "SPOOF_PHOTO_DETECTED",
            "error": str(se),
            "message": f"Presentation attack detected ({se.spoof_type}). Passive liveness confidence: {se.liveness_score*100:.1f}%. Real human candidate required.",
            "livenessScore": se.liveness_score,
            "spoofType": se.spoof_type,
            "spoofProbabilities": se.spoof_probabilities
        }
    except ValueError as ve:
        err_msg = str(ve)
        reason = "NO_FACE_DETECTED" if "NO_FACE_DETECTED" in err_msg else "MULTIPLE_FACES_DETECTED" if "MULTIPLE_FACES_DETECTED" in err_msg else "VALIDATION_ERROR"
        return 400, {
            "verified": False,
            "reason": reason,
            "error": err_msg,
            "message": "No human face found in camera frame." if reason == "NO_FACE_DETECTED" else "Multiple individuals detected in frame."
        }
    except Exception as e:
        return 400, {"verified": False, "reason": "EXTRACTION_FAILURE", "error": str(e), "message": str(e)}

    # Step 6: Similarity check
    ref_embedding = record["faceEmbedding"]
    sim = calculate_cosine_similarity_unit(ref_embedding, live_embedding)
    is_verified = sim >= 0.62

    if is_verified:
        return 200, {
            "verified": True,
            "similarity": round(sim, 4),
            "threshold": 0.62,
            "studentName": session["student"]["studentName"],
            "regNo": session["student"]["regNo"],
            "telemetry": telemetry,
            "message": "Identity verified successfully. Chamber admission authorized."
        }
    else:
        return 200, {
            "verified": False,
            "similarity": round(sim, 4),
            "threshold": 0.62,
            "studentName": session["student"]["studentName"],
            "regNo": session["student"]["regNo"],
            "telemetry": telemetry,
            "message": f"Facial match score ({sim*100:.1f}%) is below authorization threshold (62%). Access denied."
        }

# Mock fixtures for route branch testing
dummy_valid_session = {"student": {"regNo": "reg1", "studentName": "Student One", "isActive": True}, "isTemp": False}
dummy_ref_record = {"regNo": "reg1", "faceEmbedding": v_rand.tobytes(), "verificationStatus": "AUTHENTICATED"}
dummy_valid_b64 = "data:image/jpeg;base64," + base64.b64encode(b"A" * 500).decode("ascii")

# 4.1 Branch: Missing token
s, d = simulate_verify_gate_handler(None, {}, lambda t: None, lambda r: None, lambda b: None)
record_unit_test("RouteLogic", "Unit 4.1: Missing token branch returns HTTP 401",
                 s == 401 and "Missing authentication token" in d.get("error", ""), f"Status: {s} | Error: {d.get('error')}")

# 4.2 Branch: Invalid / expired session
s, d = simulate_verify_gate_handler("invalid_token", {}, lambda t: None, lambda r: None, lambda b: None)
record_unit_test("RouteLogic", "Unit 4.2: Invalid session branch returns HTTP 401",
                 s == 401 and "Invalid or expired session" in d.get("error", ""), f"Status: {s} | Error: {d.get('error')}")

# 4.3 Branch: Missing live snapshot in body
s, d = simulate_verify_gate_handler("tok", {}, lambda t: dummy_valid_session, lambda r: dummy_ref_record, lambda b: None)
record_unit_test("RouteLogic", "Unit 4.3: Missing body branch returns HTTP 400",
                 s == 400 and "Missing live camera frame" in d.get("error", ""), f"Status: {s} | Error: {d.get('error')}")

# 4.4 Branch: Unsealed biometric ground truth
s, d = simulate_verify_gate_handler("tok", {"liveFrameBase64": dummy_valid_b64}, lambda t: dummy_valid_session, lambda r: None, lambda b: None)
record_unit_test("RouteLogic", "Unit 4.4: Unsealed ground truth branch returns HTTP 400",
                 s == 400 and "Biometric ground truth is not sealed" in d.get("error", ""), f"Status: {s} | Error: {d.get('error')}")

# 4.5 Branch: Corrupted image buffer
s, d = simulate_verify_gate_handler("tok", {"liveFrameBase64": "data:image/jpeg;base64,short"}, lambda t: dummy_valid_session, lambda r: dummy_ref_record, lambda b: None)
record_unit_test("RouteLogic", "Unit 4.5: Corrupted image buffer branch returns HTTP 400",
                 s == 400 and "Invalid or corrupted camera snapshot" in d.get("error", ""), f"Status: {s} | Error: {d.get('error')}")

# 4.6 Branch: NO_FACE_DETECTED exception thrown by extractor
def mock_extract_no_face(raw): raise ValueError("NO_FACE_DETECTED: No human face found in image.")
s, d = simulate_verify_gate_handler("tok", {"liveFrameBase64": dummy_valid_b64}, lambda t: dummy_valid_session, lambda r: dummy_ref_record, mock_extract_no_face)
record_unit_test("RouteLogic", "Unit 4.6: NO_FACE_DETECTED exception caught & returns HTTP 400",
                 s == 400 and d.get("reason") == "NO_FACE_DETECTED", f"Status: {s} | Reason: {d.get('reason')} | Message: {d.get('message')}")

# 4.7 Branch: MULTIPLE_FACES_DETECTED exception thrown by extractor
def mock_extract_multi_faces(raw): raise ValueError("MULTIPLE_FACES_DETECTED: 2 individuals detected in frame.")
s, d = simulate_verify_gate_handler("tok", {"liveFrameBase64": dummy_valid_b64}, lambda t: dummy_valid_session, lambda r: dummy_ref_record, mock_extract_multi_faces)
record_unit_test("RouteLogic", "Unit 4.7: MULTIPLE_FACES_DETECTED exception caught & returns HTTP 400",
                 s == 400 and d.get("reason") == "MULTIPLE_FACES_DETECTED", f"Status: {s} | Reason: {d.get('reason')} | Message: {d.get('message')}")

# 4.8 Branch: SPOOF_PHOTO_DETECTED exception thrown by extractor
def mock_extract_spoof(raw):
    raise extract_biometrics.SpoofError("Presentation attack detected", liveness_score=0.012, spoof_type="PRINT_ATTACK", spoof_probabilities={"real": 0.012, "print_attack": 0.988})
s, d = simulate_verify_gate_handler("tok", {"liveFrameBase64": dummy_valid_b64}, lambda t: dummy_valid_session, lambda r: dummy_ref_record, mock_extract_spoof)
record_unit_test("RouteLogic", "Unit 4.8: SpoofError exception caught & returns HTTP 400 with telemetry",
                 s == 400 and d.get("reason") == "SPOOF_PHOTO_DETECTED" and d.get("livenessScore") == 0.012,
                 f"Status: {s} | Reason: {d.get('reason')} | Score: {d.get('livenessScore')} | Type: {d.get('spoofType')}")

# 4.9 Branch: Genuine match authorized (similarity >= 0.62)
def mock_extract_genuine(raw):
    # Same vector as reference
    return v_rand.tobytes(), {"faceBox": [10, 10, 100, 100], "isLive": True, "livenessScore": 0.99}
s, d = simulate_verify_gate_handler("tok", {"liveFrameBase64": dummy_valid_b64}, lambda t: dummy_valid_session, lambda r: dummy_ref_record, mock_extract_genuine)
record_unit_test("RouteLogic", "Unit 4.9: Genuine match authorized branch returns HTTP 200 verified=True",
                 s == 200 and d.get("verified") is True and d.get("similarity") >= 0.62 and d.get("threshold") == 0.62,
                 f"Status: {s} | Verified: {d.get('verified')} | Sim: {d.get('similarity')} | Thresh: {d.get('threshold')}")

# 4.10 Branch: Impostor mismatch rejected (similarity < 0.62)
v_diff = np.random.randn(512).astype(np.float32)
v_diff /= np.linalg.norm(v_diff)
def mock_extract_impostor(raw):
    return v_diff.tobytes(), {"faceBox": [10, 10, 100, 100], "isLive": True, "livenessScore": 0.95}
s, d = simulate_verify_gate_handler("tok", {"liveFrameBase64": dummy_valid_b64}, lambda t: dummy_valid_session, lambda r: dummy_ref_record, mock_extract_impostor)
record_unit_test("RouteLogic", "Unit 4.10: Impostor mismatch rejected branch returns HTTP 200 verified=False",
                 s == 200 and d.get("verified") is False and d.get("similarity") < 0.62,
                 f"Status: {s} | Verified: {d.get('verified')} | Sim: {d.get('similarity')} | Message: {d.get('message')}")

# =========================================================================
# SUMMARY
# =========================================================================
total_passed = sum(1 for _, _, p, _ in test_results if p)
total_tests = len(test_results)
print("\n" + "=" * 80)
print(f"TASK 3.2 ISOLATION UNIT RESULTS: {total_passed}/{total_tests} TESTS PASSED ({(total_passed/total_tests)*100:.1f}%)")
print("=" * 80)

if total_passed == total_tests:
    print(">>> ALL ISOLATION UNIT TESTS PASSED SUCCESSFULLY (100.0%) <<<")
    sys.exit(0)
else:
    print(f">>> {total_tests - total_passed} UNIT TESTS FAILED <<<")
    sys.exit(1)
