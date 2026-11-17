
import os
import sys
import time
import json
import base64
import struct
import subprocess
import numpy as np
from PIL import Image

print("=" * 80)
print("TASK 2.3 EMPIRICAL & EDGE-CASE TEST SUITE: UMEYAMA 5-POINT WARP & NUMPY CLAHE")
print("Tasks 1.1, 1.2, 2.1, 2.2 & 2.3 In Full Combination Across Real Candidate Instances")
print("=" * 80)

# Ensure edge cases directory and files exist
os.makedirs("/tmp/edge_cases_bio", exist_ok=True)
black_path = "/tmp/edge_cases_bio/black.jpg"
if not os.path.exists(black_path):
    Image.new("RGB", (640, 480), (0, 0, 0)).save(black_path)

sys.path.insert(0, "/home/savan/openviva/scripts")
from extract_biometrics import (
    SCRFDDetector, get_scrfd_detector,
    MiniFASNetLiveness, get_liveness_classifier,
    ARCFACE_CANONICAL_5PTS, umeyama, warp_face_arcface, numpy_clahe,
    align_and_equalize_face, extract_face_embedding
)

test_results = []

def record_test(name, passed, details=""):
    status = "PASS" if passed else "FAIL"
    test_results.append((name, passed, details))
    print(f"[{status}] {name}")
    if details:
        print(f"       Details: {details}")

# =========================================================================
# TEST 1: Mathematical Accuracy & Convergence of Umeyama Algorithm
# =========================================================================
print("\n--- TEST 1: Mathematical Accuracy of Umeyama Similarity Transform ---")
# 1.1 Identity test
T_id = umeyama(ARCFACE_CANONICAL_5PTS, ARCFACE_CANONICAL_5PTS)
homo_canon = np.hstack([ARCFACE_CANONICAL_5PTS, np.ones((5, 1))])
mapped_id = (T_id @ homo_canon.T).T[:, :2]
err_id = np.max(np.linalg.norm(mapped_id - ARCFACE_CANONICAL_5PTS, axis=1))
record_test("Umeyama 1.1 (Identity Transform)", err_id < 1e-5, f"Max error: {err_id:.2e} px")

# 1.2 Synthetic similarity transform parameter recovery
theta = np.radians(25.0)
c, s = np.cos(theta), np.sin(theta)
R_true = np.array([[c, -s], [s, c]])
scale_true = 1.80
t_true = np.array([120.0, -45.0])
synth_pts = scale_true * (ARCFACE_CANONICAL_5PTS @ R_true.T) + t_true

T_synth = umeyama(ARCFACE_CANONICAL_5PTS, synth_pts)
recovered_R = T_synth[:2, :2]
recovered_scale = np.sqrt(np.abs(np.linalg.det(recovered_R)))
recovered_theta = np.degrees(np.arctan2(recovered_R[1, 0], recovered_R[0, 0]))
recovered_t = T_synth[:2, 2]

scale_ok = abs(recovered_scale - scale_true) < 1e-3
theta_ok = abs(recovered_theta - 25.0) < 1e-3
t_ok = np.max(np.abs(recovered_t - t_true)) < 1e-3
record_test("Umeyama 1.2 (Synthetic Parameter Recovery)", scale_ok and theta_ok and t_ok,
            f"Scale: {recovered_scale:.4f} (exp 1.80) | Theta: {recovered_theta:.4f} deg (exp 25.0) | Trans: {recovered_t}")

# 1.3 Reflection rejection test
flipped_pts = ARCFACE_CANONICAL_5PTS.copy()
flipped_pts[:, 0] = -flipped_pts[:, 0]
T_flip = umeyama(ARCFACE_CANONICAL_5PTS, flipped_pts)
det_R_flip = np.linalg.det(T_flip[:2, :2])
record_test("Umeyama 1.3 (Proper Rotation / Reflection Rejection)", det_R_flip > 0,
            f"det(R): {det_R_flip:.4f} (Must be positive)")

# =========================================================================
# TEST 2: Landmark Alignment Across All Real Candidate Database Instances
# =========================================================================
print("\n--- TEST 2: Landmark Alignment Across Real Database Candidates ---")
detector = get_scrfd_detector()
real_candidates = [
    ("student 1 (reg1)", "/home/savan/openviva/storage/biometrics/faces/reg1.jpg"),
    ("student 1 live keyframe", "/home/savan/openviva/storage/biometrics/faces/reg1_keyframe.jpg"),
    ("student 1 exam session", "/home/savan/openviva/storage/biometrics/keyframes/sess_reg1_1793868787928.jpg"),
    ("Master E2E Candidate", "/home/savan/openviva/storage/biometrics/faces/master_e2e_1793867311.jpg"),
    ("Subsystem 2 Candidate", "/home/savan/openviva/storage/biometrics/faces/sub2_cand_1793867310.jpg"),
    ("Unit Bio Candidate", "/home/savan/openviva/storage/biometrics/faces/unit2_4_cand.jpg"),
    ("student 9 (reg9)", "/home/savan/openviva/storage/biometrics/faces/reg9.jpg"),
    ("Benchmark Portrait A", "/home/savan/openviva/storage/biometrics/faces/person_a_1.jpg")
]

all_cand_errors = []
for label, fp in real_candidates:
    if not os.path.exists(fp):
        continue
    img = Image.open(fp).convert("RGB")
    faces = detector.detect(img)
    if not faces:
        record_test(f"Cand Alignment: {label}", False, "Face not detected by SCRFD")
        continue
    kps = np.array(faces[0]['kps'], dtype=np.float32)
    T_fwd = umeyama(kps, ARCFACE_CANONICAL_5PTS)
    
    homo_src = np.hstack([kps, np.ones((5, 1))])
    mapped_canon = (T_fwd @ homo_src.T).T[:, :2]
    res_err = np.mean(np.linalg.norm(mapped_canon - ARCFACE_CANONICAL_5PTS, axis=1))
    all_cand_errors.append(res_err)
    
    # Check horizontality of mapped eyes
    eye_dy = abs(mapped_canon[0, 1] - mapped_canon[1, 1])
    
    # Warp face and verify dimensions
    aligned = warp_face_arcface(img, kps)
    size_ok = (aligned.size == (112, 112))
    
    cand_ok = (res_err < 5.0) and (eye_dy < 2.5) and size_ok
    details = f"Residual: {res_err:.2f}px (<5.0) | Eye dY: {eye_dy:.3f}px (<2.5) | Size: {aligned.size}"
    record_test(f"Cand Alignment: {label}", cand_ok, details)

# =========================================================================
# TEST 3: Pure NumPy CLAHE Illumination Normalization (Shadow Neutralization)
# =========================================================================
print("\n--- TEST 3: Pure NumPy CLAHE Illumination Normalization ---")
base_cand = Image.open(real_candidates[0][1]).convert("RGB")
base_kps = np.array(detector.detect(base_cand)[0]['kps'], dtype=np.float32)
aligned_base = warp_face_arcface(base_cand, base_kps)

# 3.1 Synthesize harsh unilateral shadow: darken left half by 70%
arr_unshadowed = np.array(aligned_base, dtype=np.float32)
arr_shadowed = arr_unshadowed.copy()
arr_shadowed[:, :56, :] *= 0.30
img_shadowed = Image.fromarray(arr_shadowed.astype(np.uint8))

# Apply CLAHE
img_equalized = numpy_clahe(img_shadowed, grid_size=(8, 8), clip_limit=2.5)
arr_equalized = np.array(img_equalized, dtype=np.float32)

# Verify shadow neutralization:
# Left half luminance before vs after
Y_before = 0.299 * arr_shadowed[:, :, 0] + 0.587 * arr_shadowed[:, :, 1] + 0.114 * arr_shadowed[:, :, 2]
Y_after = 0.299 * arr_equalized[:, :, 0] + 0.587 * arr_equalized[:, :, 1] + 0.114 * arr_equalized[:, :, 2]

shadow_mean_before = np.mean(Y_before[:, :56])
shadow_mean_after = np.mean(Y_after[:, :56])
boost_ratio = (shadow_mean_after - shadow_mean_before) / (shadow_mean_before + 1e-6)

record_test("NumPy CLAHE 3.1 (Harsh Shadow Luminance Recovery)", boost_ratio > 0.40,
            f"Shadowed mean before: {shadow_mean_before:.1f} -> after: {shadow_mean_after:.1f} (Boost: +{boost_ratio*100:.1f}%)")

# 3.2 Chromaticity preservation check
Cb_before = -0.168736 * arr_unshadowed[:, :, 0] - 0.331264 * arr_unshadowed[:, :, 1] + 0.5 * arr_unshadowed[:, :, 2] + 128.0
Cr_before = 0.5 * arr_unshadowed[:, :, 0] - 0.418688 * arr_unshadowed[:, :, 1] - 0.081312 * arr_unshadowed[:, :, 2] + 128.0

Cb_after = -0.168736 * arr_equalized[:, :, 0] - 0.331264 * arr_equalized[:, :, 1] + 0.5 * arr_equalized[:, :, 2] + 128.0
Cr_after = 0.5 * arr_equalized[:, :, 0] - 0.418688 * arr_equalized[:, :, 1] - 0.081312 * arr_equalized[:, :, 2] + 128.0

cb_drift = np.mean(np.abs(Cb_before[:, 56:] - Cb_after[:, 56:]))
cr_drift = np.mean(np.abs(Cr_before[:, 56:] - Cr_after[:, 56:]))
record_test("NumPy CLAHE 3.2 (Skin Chromaticity Preservation)", (cb_drift < 2.0) and (cr_drift < 2.0),
            f"Cb drift: {cb_drift:.3f} | Cr drift: {cr_drift:.3f} (Preserves natural skin tones)")

# =========================================================================
# TEST 4: Empirical Latency & Performance Benchmarks
# =========================================================================
print("\n--- TEST 4: Empirical Latency Benchmarks ---")
# Warmup passes
for _ in range(3):
    _ = warp_face_arcface(base_cand, base_kps)
    _ = numpy_clahe(aligned_base)

lat_warp = []
for _ in range(10):
    t0 = time.perf_counter()
    _ = warp_face_arcface(base_cand, base_kps)
    lat_warp.append((time.perf_counter() - t0) * 1000)
med_warp = np.median(lat_warp)
record_test("Umeyama Alignment Latency (10 passes)", med_warp <= 2.0,
            f"Median: {med_warp:.2f}ms | Min: {np.min(lat_warp):.2f}ms (Budget: <= 2.0ms)")

lat_clahe = []
for _ in range(10):
    t0 = time.perf_counter()
    _ = numpy_clahe(aligned_base)
    lat_clahe.append((time.perf_counter() - t0) * 1000)
med_clahe = np.median(lat_clahe)
record_test("NumPy CLAHE Latency (10 passes)", med_clahe <= 5.0,
            f"Median: {med_clahe:.2f}ms | Min: {np.min(lat_clahe):.2f}ms (Budget: <= 5.0ms)")

# Combined Tasks 2.1 + 2.2 + 2.3 pipeline latency
liveness_clf = get_liveness_classifier()
lat_all = []
for _ in range(10):
    t0 = time.perf_counter()
    fcs = detector.detect(base_cand)
    _ = liveness_clf.evaluate(base_cand, fcs[0]['box'])
    _ = align_and_equalize_face(base_cand, fcs[0]['kps'])
    lat_all.append((time.perf_counter() - t0) * 1000)
med_all = np.median(lat_all)
record_test("Combined 2.1 + 2.2 + 2.3 Full Prep Pipeline Latency", med_all <= 25.0,
            f"Median: {med_all:.2f}ms | Min: {np.min(lat_all):.2f}ms (Budget: <= 25.0ms)")

# =========================================================================
# TEST 5: Edge-Case Validations (Rotation, Degeneracy, Prior Gates)
# =========================================================================
print("\n--- TEST 5: Edge-Case Validations ---")
# Edge Case 5.1: Head Roll Tilt Angles (+30 deg and -30 deg)
for angle in [30, -30]:
    rot_img = base_cand.rotate(angle, expand=True)
    rot_faces = detector.detect(rot_img)
    if rot_faces:
        rot_kps = np.array(rot_faces[0]['kps'], dtype=np.float32)
        T_rot = umeyama(rot_kps, ARCFACE_CANONICAL_5PTS)
        homo_rot = np.hstack([rot_kps, np.ones((5, 1))])
        canon_pts = (T_rot @ homo_rot.T).T[:, :2]
        eye_horiz = abs(canon_pts[0, 1] - canon_pts[1, 1])
        rot_aligned = warp_face_arcface(rot_img, rot_kps)
        record_test(f"Edge Case 5.1 (Head Roll Tilt {angle:+d} deg)", (eye_horiz < 1.0) and (rot_aligned.size == (112, 112)),
                    f"Aligned Eye dY: {eye_horiz:.3f}px | Aligned size: {rot_aligned.size}")
    else:
        record_test(f"Edge Case 5.1 (Head Roll Tilt {angle:+d} deg)", False, "Face not detected at tilt")

# Edge Case 5.2: Degenerate / Collinear Landmarks
collinear_pts = np.array([
    [100.0, 100.0],
    [120.0, 100.0],
    [140.0, 100.0],
    [160.0, 100.0],
    [180.0, 100.0]
], dtype=np.float32)
try:
    T_degen = umeyama(collinear_pts, ARCFACE_CANONICAL_5PTS)
    degen_ok = not np.any(np.isnan(T_degen))
    record_test("Edge Case 5.2 (Collinear Degenerate Landmarks Handled Safely)", degen_ok, f"Matrix:\n{T_degen}")
except Exception as e:
    record_test("Edge Case 5.2 (Collinear Degenerate Landmarks Handled Safely)", False, str(e))

# Edge Case 5.3: Prior Gates (Tasks 1.2, 2.1, 2.2 preserved)
res_zero = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", black_path],
    capture_output=True, text=True
)
data_zero = json.loads(res_zero.stdout.strip())
record_test("Edge Case 5.3a (Zero-Face Prior Gate Preserved)", data_zero.get("error") == "NO_FACE_DETECTED", f"Error: {data_zero.get('error')}")

res_multi = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", "/home/savan/openviva/storage/biometrics/faces/reg7.jpg"],
    capture_output=True, text=True
)
data_multi = json.loads(res_multi.stdout.strip())
record_test("Edge Case 5.3b (Multi-Person Prior Gate Preserved)", data_multi.get("error") == "MULTIPLE_FACES_DETECTED", f"Error: {data_multi.get('error')}")

# =========================================================================
# TEST 6: CLI Telemetry & Schema Integration
# =========================================================================
print("\n--- TEST 6: CLI Telemetry & Schema Integration ---")
# 6.1 --align-only CLI flag
res_align = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", real_candidates[0][1], "--align-only"],
    capture_output=True, text=True
)
data_align = json.loads(res_align.stdout.strip())
align_flag_ok = (data_align.get("success") is True) and (data_align.get("alignment_status") == "UMEYAMA_ALIGNED_112X112") and (data_align.get("illumination_status") == "OPTIMAL_EQUALIZED") and (data_align.get("aligned_size") == [112, 112])
record_test("CLI --align-only Flag Fast-Path", align_flag_ok, f"Status: {data_align.get('alignment_status')} | Size: {data_align.get('aligned_size')}")

# 6.2 Full CLI Biometric Extraction Output Schema
res_full = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", real_candidates[0][1]],
    capture_output=True, text=True
)
try:
    full_data = json.loads(res_full.stdout.strip())
    has_success = full_data.get("success") is True
    has_liveness = (full_data.get("is_live") is True) and (full_data.get("liveness_score") >= 0.80)
    has_align = (full_data.get("alignment_status") == "UMEYAMA_ALIGNED_112X112") and (full_data.get("illumination_status") == "OPTIMAL_EQUALIZED")
    has_meta = full_data.get("face_detected") is True and "face_box" in full_data and "landmarks" in full_data
    has_bytes = full_data.get("face_embedding_bytes") == 2048
    blob = base64.b64decode(full_data.get("face_embedding_base64", ""))
    valid_blob = len(blob) == 2048
    
    full_ok = has_success and has_liveness and has_align and has_meta and has_bytes and valid_blob
    record_test("Full CLI Extraction with Umeyama + CLAHE Telemetry", full_ok,
                f"Align: {full_data.get('alignment_status')} | Illumin: {full_data.get('illumination_status')} | Bytes: {len(blob)}")
except Exception as e:
    record_test("Full CLI Extraction with Umeyama + CLAHE Telemetry", False, f"Failed: {e} | Raw: {res_full.stdout}")

# =========================================================================
# SUMMARY
# =========================================================================
total_passed = sum(1 for _, p, _ in test_results if p)
total_tests = len(test_results)
print("\n" + "=" * 80)
print(f"TASK 2.3 EMPIRICAL RESULTS: {total_passed}/{total_tests} TESTS PASSED ({(total_passed/total_tests)*100:.1f}%)")
print("=" * 80)

if total_passed == total_tests:
    print("ALL TASK 2.3 UMEYAMA & CLAHE CHECKS VERIFIED SUCCESSFULLY.")
    sys.exit(0)
else:
    print("SOME TESTS FAILED.")
    sys.exit(1)
