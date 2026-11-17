
import os
import sys
import time
import json
import base64
import struct
import sqlite3
import subprocess
import numpy as np
from PIL import Image

print("=" * 80)
print("OPEN VIVA: FULL EMPIRICAL FACE INSTANCE & PRODUCTION BENCHMARK SUITE")
print("Tasks 1.1, 1.2 & 2.1 Verification Across Actual Enrolled DB & Media Instances")
print("=" * 80)

sys.path.insert(0, "/home/savan/openviva/scripts")
from extract_biometrics import SCRFDDetector, get_scrfd_detector, extract_face_embedding

test_results = []

def record_test(name, passed, details=""):
    status = "PASS" if passed else "FAIL"
    test_results.append((name, passed, details))
    print(f"[{status}] {name}")
    if details:
        print(f"       Details: {details}")

# =========================================================================
# SECTION 1: Model Staging & Environment Verification (Tasks 1.1 & 1.2)
# =========================================================================
print("\n--- SECTION 1: Model Staging & Environment Integrity ---")
models = {
    "scrfd_500m_kps.onnx": 2_524_817,
    "minifasnet_v2.onnx": 1_744_116,
    "mobilefacenet_arcface_512.onnx": 13_616_099
}

models_dir = "/home/savan/openviva/models/face"
for m_name, exp_size in models.items():
    p = os.path.join(models_dir, m_name)
    ok = os.path.exists(p) and (os.path.getsize(p) == exp_size)
    record_test(f"Model File Integrity: {m_name}", ok, f"Path: {p} | Size: {os.path.getsize(p) if os.path.exists(p) else 0:,} B")

detector = get_scrfd_detector(os.path.join(models_dir, "scrfd_500m_kps.onnx"))
record_test("SCRFD Detector Initialization", detector is not None, f"Input: {detector.input_name} | Target: {detector.target_size}x{detector.target_size}")

# =========================================================================
# SECTION 2: Actual Enrolled Candidate Instances from SQLite openviva.db
# =========================================================================
print("\n--- SECTION 2: Actual Enrolled Candidate Instances from SQLite ---")
db_path = "/home/savan/openviva/storage/openviva.db"
conn = sqlite3.connect(db_path)
c = conn.cursor()
c.execute("SELECT reg_no, student_name, face_image_path FROM student_biometrics")
rows = c.fetchall()
conn.close()

single_candidate_images = []
for reg_no, name, rel_path in rows:
    if not rel_path:
        continue
    # Clean relative path: e.g. '../storage/biometrics/faces/reg1.jpg' -> '/home/savan/openviva/storage/biometrics/faces/reg1.jpg'
    clean_p = rel_path.replace("../", "")
    full_p = os.path.join("/home/savan/openviva", clean_p)
    if os.path.exists(full_p) and os.path.getsize(full_p) > 1000:
        # Check if it is reg7 (which is our known multi-person instance)
        if reg_no == "reg7":
            continue
        single_candidate_images.append((reg_no, name, full_p))

print(f"Found {len(single_candidate_images)} valid single-candidate instances in production storage.")

db_latencies = []
for reg_no, name, fp in single_candidate_images:
    img = Image.open(fp).convert("RGB")
    w, h = img.size
    
    t0 = time.perf_counter()
    faces = detector.detect(img)
    dt_ms = (time.perf_counter() - t0) * 1000
    db_latencies.append(dt_ms)
    
    is_single = (len(faces) == 1)
    if not is_single:
        record_test(f"DB Instance: {reg_no} ({name})", False, f"Expected 1 face, found {len(faces)}")
        continue
        
    face = faces[0]
    score = face['score']
    box = face['box']
    kps = face['kps']
    
    # Anatomical geometric validation
    left_eye, right_eye, nose, left_mouth, right_mouth = kps
    ipd = right_eye[0] - left_eye[0]
    eyes_horiz = ipd > 20.0
    eye_tilt = abs(right_eye[1] - left_eye[1]) / (ipd + 1e-6)
    tilt_ok = eye_tilt < 0.35
    nose_ok = (left_eye[1] < nose[1] and right_eye[1] < nose[1] and nose[1] < left_mouth[1] and nose[1] < right_mouth[1])
    mouth_horiz = (right_mouth[0] > left_mouth[0])
    
    geom_valid = eyes_horiz and tilt_ok and nose_ok and mouth_horiz
    score_ok = score >= 0.70
    bounds_ok = (0 <= box[0] < box[2] <= w) and (0 <= box[1] < box[3] <= h)
    
    pass_all = is_single and score_ok and bounds_ok and geom_valid
    details = f"Score: {score:.3f} | Box: {box} | IPD: {ipd:.1f}px | Latency: {dt_ms:.1f}ms"
    record_test(f"DB Instance: {reg_no} ({name})", pass_all, details)

# =========================================================================
# SECTION 3: Live Session Keyframes & Media Instances
# =========================================================================
print("\n--- SECTION 3: Live Session Keyframes & Uploaded Media Instances ---")
media_instances = [
    ("Live Exam Keyframe", "/home/savan/openviva/storage/biometrics/keyframes/sess_reg1_1793868787928.jpg"),
    ("Candidate reg1 Keyframe", "/home/savan/openviva/storage/biometrics/faces/reg1_keyframe.jpg"),
    ("Benchmark Portrait A", "/home/savan/openviva/storage/biometrics/faces/person_a_1.jpg"),
    ("Benchmark Impostor B", "/home/savan/openviva/storage/biometrics/faces/person_b_impostor.jpg"),
    ("User Uploaded Media", "/home/savan/openviva/storage/biometrics/faces/media_user_upload.jpg")
]

for label, p in media_instances:
    if not os.path.exists(p):
        print(f"Skipping {label} (not found at {p})")
        continue
    img = Image.open(p).convert("RGB")
    faces = detector.detect(img)
    has_face = len(faces) >= 1
    face = faces[0] if faces else None
    details = f"Faces: {len(faces)} | Score: {face['score']:.3f} | Box: {face['box']}" if face else "No face"
    record_test(f"Media Instance: {label}", has_face and face['score'] >= 0.65, details)

# =========================================================================
# SECTION 4: Real Multi-Person Instance Security Gating
# =========================================================================
print("\n--- SECTION 4: Actual Multi-Person Instance Security Gating ---")
multi_real_p = "/home/savan/openviva/storage/biometrics/faces/reg7.jpg"
if os.path.exists(multi_real_p):
    img_multi = Image.open(multi_real_p).convert("RGB")
    faces_real = detector.detect(img_multi)
    multi_detected = len(faces_real) == 2
    record_test("Actual Multi-Person Detection: reg7.jpg", multi_detected, f"Detected {len(faces_real)} faces (Scores: {[round(f['score'], 3) for f in faces_real]})")
    
    # CLI fail-closed check
    cmd = ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", multi_real_p]
    res = subprocess.run(cmd, capture_output=True, text=True)
    out_json = json.loads(res.stdout.strip())
    fail_closed = (out_json.get("success") is False) and (out_json.get("error") == "MULTIPLE_FACES_DETECTED")
    record_test("Actual Multi-Person CLI Fail-Closed", fail_closed, f"Response: {out_json}")

# =========================================================================
# SECTION 5: Zero-Face & Edge Cases
# =========================================================================
print("\n--- SECTION 5: Zero-Face & Non-Face Edge Cases ---")
black_path = "/tmp/edge_cases_bio/black.jpg"
res_zero = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", black_path],
    capture_output=True, text=True
)
out_zero = json.loads(res_zero.stdout.strip())
zero_ok = (out_zero.get("success") is False) and (out_zero.get("error") == "NO_FACE_DETECTED")
record_test("Zero-Face Frame Fail-Closed", zero_ok, f"Error: {out_zero.get('error')}")

# Low-Light Dimming test on reg1.jpg
base_img = Image.open("/home/savan/openviva/storage/biometrics/faces/reg1.jpg").convert("RGB")
dim_img = Image.fromarray((np.array(base_img, dtype=np.float32) * 0.25).astype(np.uint8))
dim_faces = detector.detect(dim_img)
record_test("Low-Light Robustness (25% Brightness)", len(dim_faces) == 1 and dim_faces[0]['score'] >= 0.70, f"Score: {dim_faces[0]['score'] if dim_faces else 0:.3f}")

# =========================================================================
# SECTION 6: Full CLI Extraction Smoke Test & Output Vector Bounds
# =========================================================================
print("\n--- SECTION 6: Full CLI Extraction Smoke Test & Vector Bounds ---")
cli_test_img = "/home/savan/openviva/storage/biometrics/faces/reg1.jpg"
res_cli = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", cli_test_img],
    capture_output=True, text=True
)
cli_data = json.loads(res_cli.stdout.strip())
raw_blob = base64.b64decode(cli_data.get("face_embedding_base64", ""))
floats = struct.unpack(f"{len(raw_blob)//4}f", raw_blob)
l2_norm = np.sqrt(sum(x*x for x in floats))

vec_valid = (len(raw_blob) == 2048) and (len(floats) == 512) and (0.99 <= l2_norm <= 1.01)
record_test("CLI Vector Length & L2 Hypersphere Norm", vec_valid, f"Length: {len(raw_blob)} bytes | Dimensions: {len(floats)} | L2 Norm: {l2_norm:.4f}")
record_test("CLI Face Telemetry Present", ("face_box" in cli_data) and ("landmarks" in cli_data), f"Box: {cli_data.get('face_box')}")

# =========================================================================
# SECTION 7: Production Latency Profiling Across All Real Instances
# =========================================================================
print("\n--- SECTION 7: Production CPU Latency Statistics Across All Real Instances ---")
median_lat = np.median(db_latencies)
mean_lat = np.mean(db_latencies)
p95_lat = np.percentile(db_latencies, 95)
min_lat = np.min(db_latencies)
max_lat = np.max(db_latencies)

lat_budget_ok = median_lat <= 30.0
record_test("Fleetwide Production CPU Latency Profile", lat_budget_ok, 
            f"Median: {median_lat:.2f}ms | Mean: {mean_lat:.2f}ms | Min: {min_lat:.2f}ms | 95th Percentile: {p95_lat:.2f}ms | Max: {max_lat:.2f}ms (Budget: <= 30ms)")

# =========================================================================
# SUMMARY
# =========================================================================
total_passed = sum(1 for _, p, _ in test_results if p)
total_tests = len(test_results)
print("\n" + "=" * 80)
print(f"MASTER EMPIRICAL TEST SUITE: {total_passed}/{total_tests} TESTS PASSED ({(total_passed/total_tests)*100:.1f}%)")
print("=" * 80)

if total_passed == total_tests:
    print("ALL REAL INSTANCES, DATABASE CANDIDATES, MEDIA, AND SECURITY GATES VERIFIED SUCCESSFULLY.")
    sys.exit(0)
else:
    print("SOME TESTS FAILED.")
    sys.exit(1)
