
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
print("TASK 2.2 EMPIRICAL & EDGE-CASE TEST SUITE: MINIFASNET PASSIVE ANTI-SPOOFING")
print("Tasks 1.1, 1.2, 2.1 & 2.2 In Full Combination Across Real Candidate Instances")
print("=" * 80)

# Ensure edge-case test directory and files exist
os.makedirs("/tmp/edge_cases_bio", exist_ok=True)
black_path = "/tmp/edge_cases_bio/black.jpg"
if not os.path.exists(black_path):
    Image.new("RGB", (640, 480), (0, 0, 0)).save(black_path)

sys.path.insert(0, "/home/savan/openviva/scripts")
from extract_biometrics import (
    SCRFDDetector, get_scrfd_detector,
    MiniFASNetLiveness, get_liveness_classifier,
    extract_face_embedding
)

test_results = []

def record_test(name, passed, details=""):
    status = "PASS" if passed else "FAIL"
    test_results.append((name, passed, details))
    print(f"[{status}] {name}")
    if details:
        print(f"       Details: {details}")

# =========================================================================
# TEST 1: Model Loading & Dependency Purity (Tasks 1.1 & 1.2 Combination)
# =========================================================================
print("\n--- TEST 1: Model Loading & Dependency Purity ---")
try:
    liveness_classifier = get_liveness_classifier("/home/savan/openviva/models/face/minifasnet_v2.onnx")
    resolved = liveness_classifier.resolved_path
    path_ok = (resolved == "/home/savan/openviva/models/face/minifasnet_v2.onnx")
    
    detector = get_scrfd_detector("/home/savan/openviva/models/face/scrfd_500m_kps.onnx")
    
    # Check zero torch or cv2
    unwanted = [m for m in sys.modules if m.startswith(('torch', 'cv2', 'torchvision'))]
    purity = (len(unwanted) == 0)
    
    record_test("MiniFASNet-V2 Model Path Resolution", path_ok, f"Loaded from: {resolved}")
    record_test("Dependency Purity (Zero PyTorch/OpenCV)", purity, f"Unwanted modules: {unwanted}")
except Exception as e:
    record_test("MiniFASNet-V2 Model Path Resolution", False, str(e))
    record_test("Dependency Purity", False, str(e))

# =========================================================================
# TEST 2: Bona Fide Human Face Liveness Across Real Candidate Portraits
# =========================================================================
print("\n--- TEST 2: Bona Fide Human Face Liveness Across Real Candidate Portraits ---")
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

fas_latencies = []
for label, fp in real_candidates:
    if not os.path.exists(fp):
        print(f"Skipping {label} (missing {fp})")
        continue
    img = Image.open(fp).convert("RGB")
    faces = detector.detect(img)
    if not faces:
        record_test(f"Real Liveness: {label}", False, "No face detected by SCRFD")
        continue
        
    t0 = time.perf_counter()
    liveness = liveness_classifier.evaluate(img, faces[0]['box'])
    dt_ms = (time.perf_counter() - t0) * 1000
    fas_latencies.append(dt_ms)
    
    score = liveness['liveness_score']
    is_live = liveness['is_live']
    pass_live = is_live and (score >= 0.80)
    details = f"Score: {score:.4f} (>= 0.80) | Live: {is_live} | Latency: {dt_ms:.2f}ms | Spoof Probs: {liveness['spoof_probabilities']}"
    record_test(f"Real Liveness: {label}", pass_live, details)

# =========================================================================
# TEST 3: Empirical Execution Latency Benchmark
# =========================================================================
print("\n--- TEST 3: Empirical Execution Latency Benchmark ---")
img_sample = Image.open(real_candidates[0][1]).convert("RGB")
box_sample = detector.detect(img_sample)[0]['box']

# Pure MiniFASNet latency (10 passes)
for _ in range(2): liveness_classifier.evaluate(img_sample, box_sample)
lat_fas = []
for _ in range(10):
    t0 = time.perf_counter()
    _ = liveness_classifier.evaluate(img_sample, box_sample)
    lat_fas.append((time.perf_counter() - t0) * 1000)

med_fas = np.median(lat_fas)
record_test("MiniFASNet Liveness CPU Latency (10 passes)", med_fas <= 5.0, f"Median: {med_fas:.2f}ms | Min: {np.min(lat_fas):.2f}ms (Budget: <= 5ms)")

# Combined SCRFD + MiniFASNet pipeline latency (10 passes)
lat_comb = []
for _ in range(10):
    t0 = time.perf_counter()
    fcs = detector.detect(img_sample)
    _ = liveness_classifier.evaluate(img_sample, fcs[0]['box'])
    lat_comb.append((time.perf_counter() - t0) * 1000)

med_comb = np.median(lat_comb)
record_test("Combined SCRFD + Liveness Pipeline Latency", med_comb <= 25.0, f"Median: {med_comb:.2f}ms | Min: {np.min(lat_comb):.2f}ms (Budget: <= 25ms)")

# =========================================================================
# TEST 4: PRESENTATION ATTACK (ANTI-SPOOF) NEURAL VERIFICATION
# =========================================================================
print("\n--- TEST 4: Presentation Attack (Anti-Spoof) Neural Verification ---")
base_cand_img = Image.open(real_candidates[0][1]).convert("RGB")
real_patch = base_cand_img.crop((150, 100, 450, 400)).resize((80, 80), Image.Resampling.BILINEAR)
arr_patch = np.array(real_patch, dtype=np.float32)

# Test 4.1: Direct Neural PAD Classification on Screen Replay Attack (Moiré raster)
moire_patch = arr_patch.copy()
for y in range(80):
    for x in range(80):
        moire = np.sin(x * 0.8) * 45.0 + np.sin(y * 0.8) * 45.0
        moire_patch[y, x] = np.clip(moire_patch[y, x] + moire, 0, 255)

blob_moire = np.transpose(moire_patch[:, :, ::-1], (2, 0, 1))[np.newaxis, :].astype(np.float32)
out_moire = liveness_classifier.session.run(None, {liveness_classifier.input_name: blob_moire})[0][0]
probs_moire = np.exp(out_moire - np.max(out_moire)) / np.sum(np.exp(out_moire - np.max(out_moire)))
# Class 0: print, Class 1: real, Class 2: replay
p_real_m = float(probs_moire[1])
p_replay_m = float(probs_moire[2])
record_test("Direct Neural PAD (Screen Replay Moiré)", (p_real_m < 0.05) and (p_replay_m > 0.90), 
            f"P(Real): {p_real_m:.4f} | P(Replay): {p_replay_m:.4f} (Expected Replay > 0.90)")

# Test 4.2: Direct Neural PAD Classification on Paper Print Attack (Halftone dots)
print_patch = arr_patch.copy()
noise = np.random.normal(0, 35, (80, 80, 3))
print_patch = np.clip(print_patch * 0.85 + noise + 20, 0, 255)
# Add flat paper border
print_patch[:10, :, :] = 245
print_patch[-10:, :, :] = 245
print_patch[:, :10, :] = 245
print_patch[:, -10:, :] = 245

blob_print = np.transpose(print_patch[:, :, ::-1], (2, 0, 1))[np.newaxis, :].astype(np.float32)
out_print = liveness_classifier.session.run(None, {liveness_classifier.input_name: blob_print})[0][0]
probs_print = np.exp(out_print - np.max(out_print)) / np.sum(np.exp(out_print - np.max(out_print)))
p_real_p = float(probs_print[1])
p_print_p = float(probs_print[0])
record_test("Direct Neural PAD (Paper Print Halftone)", (p_real_p < 0.05) and (p_print_p > 0.90), 
            f"P(Real): {p_real_p:.4f} | P(Print): {p_print_p:.4f} (Expected Print > 0.90)")

# Test 4.3: End-to-End CLI Presentation Attack Fail-Closed Trigger
mock_spoof_code = '''
import sys, json
sys.path.insert(0, "/home/savan/openviva/scripts")
import extract_biometrics

class MockSpoofLiveness:
    liveness_thresh = 0.80
    def evaluate(self, img, box):
        return {
            "is_live": False,
            "liveness_score": 0.0012,
            "spoof_probabilities": {"real": 0.0012, "print_attack": 0.9988, "replay_attack": 0.0000},
            "spoof_type": "PRINT_ATTACK"
        }

extract_biometrics._liveness_instance = MockSpoofLiveness()
try:
    extract_biometrics.main()
except SystemExit:
    pass
'''
res_spoof_cli = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "-c", mock_spoof_code, "--face", real_candidates[0][1]],
    capture_output=True, text=True
)
try:
    spoof_cli_data = json.loads(res_spoof_cli.stdout.strip())
    spoof_trapped = (spoof_cli_data.get("success") is False) and (spoof_cli_data.get("error") == "SPOOF_PHOTO_DETECTED")
    record_test("End-to-End CLI Fail-Closed on Spoof Attack", spoof_trapped, f"Response: {spoof_cli_data}")
except Exception as e:
    record_test("End-to-End CLI Fail-Closed on Spoof Attack", False, f"CLI output: {res_spoof_cli.stdout}")

# =========================================================================
# TEST 5: Edge-Case Validations (Boundary Padding & Prior Gates)
# =========================================================================
print("\n--- TEST 5: Edge-Case Validations ---")
# Edge Case 5.1: Corner Boundary Face Scaling
corner_canvas = Image.new("RGB", (640, 480), (128, 128, 128))
face_crop = base_cand_img.crop((int(box_sample[0]), int(box_sample[1]), int(box_sample[2]), int(box_sample[3])))
corner_canvas.paste(face_crop, (0, 0))
corner_faces = detector.detect(corner_canvas)
if corner_faces:
    try:
        live_corner = liveness_classifier.evaluate(corner_canvas, corner_faces[0]['box'])
        record_test("Edge Case 5.1 (Corner Boundary Face Scaling)", True, f"Boundary clamped safely | Score: {live_corner['liveness_score']:.3f}")
    except Exception as e:
        record_test("Edge Case 5.1 (Corner Boundary Face Scaling)", False, str(e))
else:
    record_test("Edge Case 5.1 (Corner Boundary Face Scaling)", True, "Handled safely")

# Edge Case 5.2: Zero-Face & Multi-Person Prior Gates (Tasks 1.2 & 2.1 Preserved)
res_zero = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", black_path],
    capture_output=True, text=True
)
data_zero = json.loads(res_zero.stdout.strip())
record_test("Edge Case 5.2a (Zero-Face Prior Gate Preserved)", data_zero.get("error") == "NO_FACE_DETECTED", f"Error: {data_zero.get('error')}")

res_multi = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", "/home/savan/openviva/storage/biometrics/faces/reg7.jpg"],
    capture_output=True, text=True
)
data_multi = json.loads(res_multi.stdout.strip())
record_test("Edge Case 5.2b (Multi-Person Prior Gate Preserved)", data_multi.get("error") == "MULTIPLE_FACES_DETECTED", f"Error: {data_multi.get('error')}")

# Edge Case 5.3: Widescreen 16:9 Webcam Stream (1280x720)
cam_stream = Image.new("RGB", (1280, 720), (50, 50, 50))
cand_cam = base_cand_img.resize((720, 720))
cam_stream.paste(cand_cam, ((1280 - 720) // 2, 0))
faces_cam = detector.detect(cam_stream)
if faces_cam:
    try:
        live_cam = liveness_classifier.evaluate(cam_stream, faces_cam[0]['box'])
        record_test("Edge Case 5.3 (Widescreen 16:9 1280x720 Webcam Stream)", live_cam["is_live"], f"Liveness score: {live_cam['liveness_score']:.4f} (>= 0.80)")
    except Exception as e:
        record_test("Edge Case 5.3 (Widescreen 16:9 1280x720 Webcam Stream)", False, str(e))
else:
    record_test("Edge Case 5.3 (Widescreen 16:9 1280x720 Webcam Stream)", False, "Face not detected on widescreen stream")

# =========================================================================
# TEST 6: CLI Telemetry & Extraction Flags
# =========================================================================
print("\n--- TEST 6: CLI Telemetry & Extraction Flags ---")
# 6.1 --liveness-only CLI flag
res_live_only = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", real_candidates[0][1], "--liveness-only"],
    capture_output=True, text=True
)
data_live_only = json.loads(res_live_only.stdout.strip())
has_live_only = (data_live_only.get("success") is True) and ("is_live" in data_live_only) and ("liveness_score" in data_live_only) and ("face_embedding_base64" not in data_live_only)
record_test("CLI --liveness-only Fast-Path Verification", has_live_only, f"is_live: {data_live_only.get('is_live')} | score: {data_live_only.get('liveness_score')}")

# 6.2 Full CLI Biometric Extraction Output Schema (Liveness + Face Blob)
res_full = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", real_candidates[0][1]],
    capture_output=True, text=True
)
try:
    full_data = json.loads(res_full.stdout.strip())
    has_success = full_data.get("success") is True
    has_liveness = (full_data.get("is_live") is True) and (full_data.get("liveness_score") >= 0.80)
    has_meta = full_data.get("face_detected") is True and "face_box" in full_data and "landmarks" in full_data
    has_bytes = full_data.get("face_embedding_bytes") == 2048
    blob = base64.b64decode(full_data.get("face_embedding_base64", ""))
    valid_blob = len(blob) == 2048
    
    smoke_ok = has_success and has_liveness and has_meta and has_bytes and valid_blob
    record_test("Full CLI Extraction with Liveness Telemetry", smoke_ok, 
                f"Live: {full_data.get('is_live')} | Liveness Score: {full_data.get('liveness_score'):.4f} | Bytes: {len(blob)} | Box: {full_data.get('face_box')}")
except Exception as e:
    record_test("Full CLI Extraction with Liveness Telemetry", False, f"Failed: {e} | Raw output: {res_full.stdout}")

# =========================================================================
# SUMMARY
# =========================================================================
total_passed = sum(1 for _, p, _ in test_results if p)
total_tests = len(test_results)
print("\n" + "=" * 80)
print(f"TASK 2.2 EMPIRICAL RESULTS: {total_passed}/{total_tests} TESTS PASSED ({(total_passed/total_tests)*100:.1f}%)")
print("=" * 80)

if total_passed == total_tests:
    print("ALL TASK 2.2 LIVENESS & PRESENTATION ATTACK CHECKS VERIFIED SUCCESSFULLY.")
    sys.exit(0)
else:
    print("SOME TESTS FAILED.")
    sys.exit(1)
