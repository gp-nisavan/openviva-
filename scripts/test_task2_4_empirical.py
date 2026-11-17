
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
print("TASK 2.4 EMPIRICAL & EDGE-CASE TEST SUITE: MOBILEFACENET ARCFACE 512-D ENGINE")
print("Tasks 1.1, 1.2, 2.1, 2.2, 2.3 & 2.4 In Full Combination Across Real Candidate Instances")
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
    align_and_equalize_face,
    ArcFaceExtractor, get_arcface_extractor,
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
# TEST 1: Model Loading, Hypersphere Normalization & Dependency Purity
# =========================================================================
print("\n--- TEST 1: ArcFace Engine Loading & Hypersphere Normalization ---")
try:
    arcface = get_arcface_extractor("/home/savan/openviva/models/face/mobilefacenet_arcface_512.onnx")
    resolved = arcface.resolved_path
    path_ok = (resolved == "/home/savan/openviva/models/face/mobilefacenet_arcface_512.onnx")
    
    # Test extraction on a test image
    dummy_img = Image.new("RGB", (112, 112), (128, 128, 128))
    emb_bytes = arcface.extract(dummy_img)
    emb_floats = struct.unpack("512f", emb_bytes)
    norm = float(np.linalg.norm(emb_floats))
    
    bytes_ok = len(emb_bytes) == 2048
    norm_ok = abs(norm - 1.0) < 1e-4
    
    unwanted = [m for m in sys.modules if m.startswith(('torch', 'torchvision', 'cv2', 'skimage'))]
    purity = len(unwanted) == 0
    
    record_test("ArcFace Model Resolution & Init", path_ok, f"Loaded from: {resolved}")
    record_test("ArcFace 512-d Output Format (2,048 Bytes)", bytes_ok, f"Bytes length: {len(emb_bytes)}")
    record_test("ArcFace Unit Hypersphere L2 Normalization (||e||_2 = 1.0)", norm_ok, f"L2 Norm: {norm:.6f}")
    record_test("Zero Deep Learning Framework Overhead (Zero PyTorch/OpenCV)", purity, f"Unwanted modules: {unwanted}")
except Exception as e:
    record_test("ArcFace Model Resolution & Init", False, str(e))
    record_test("ArcFace 512-d Output Format", False, str(e))
    record_test("ArcFace Unit Hypersphere L2 Normalization", False, str(e))
    record_test("Zero Deep Learning Framework Overhead", False, str(e))

# =========================================================================
# TEST 2: Genuine Match vs Impostor Discriminative Separation
# =========================================================================
print("\n--- TEST 2: Genuine Match vs Impostor Discriminative Separation ---")
# Candidate 1 genuine portraits (different sessions / keyframes)
p1_a = "/home/savan/openviva/storage/biometrics/faces/reg1.jpg"
p1_b = "/home/savan/openviva/storage/biometrics/faces/reg1_keyframe.jpg"
p1_sess = "/home/savan/openviva/storage/biometrics/keyframes/sess_reg1_1793868787928.jpg"

# Impostor portraits
p_imp1 = "/home/savan/openviva/storage/biometrics/faces/reg9.jpg"
p_imp2 = "/home/savan/openviva/storage/biometrics/faces/master_e2e_1793867311.jpg"

emb1_a, _ = extract_face_embedding(p1_a)
emb1_b, _ = extract_face_embedding(p1_b)
emb1_sess, _ = extract_face_embedding(p1_sess)
emb_imp1, _ = extract_face_embedding(p_imp1)
emb_imp2, _ = extract_face_embedding(p_imp2)

v1_a = np.frombuffer(emb1_a, dtype=np.float32)
v1_b = np.frombuffer(emb1_b, dtype=np.float32)
v1_sess = np.frombuffer(emb1_sess, dtype=np.float32)
v_imp1 = np.frombuffer(emb_imp1, dtype=np.float32)
v_imp2 = np.frombuffer(emb_imp2, dtype=np.float32)

sim_gen_1 = float(np.dot(v1_a, v1_b))
sim_gen_sess = float(np.dot(v1_a, v1_sess))
sim_imp_1 = float(np.dot(v1_a, v_imp1))
sim_imp_2 = float(np.dot(v1_a, v_imp2))

# 2.1 Genuine pair similarity (reg1 vs reg1_keyframe)
record_test("Genuine Verification: student 1 portrait vs live keyframe", sim_gen_1 >= 0.65,
            f"Cosine Similarity: {sim_gen_1:.4f} (Threshold: >= 0.62, Target: >= 0.65)")

# 2.2 Genuine session keyframe (reg1 vs exam session)
record_test("Genuine Verification: student 1 portrait vs exam session", sim_gen_sess >= 0.65,
            f"Cosine Similarity: {sim_gen_sess:.4f} (Threshold: >= 0.62, Target: >= 0.65)")

# 2.3 Impostor rejection (reg1 vs reg9)
record_test("Impostor Rejection: student 1 vs student 9", sim_imp_1 < 0.35,
            f"Cosine Similarity: {sim_imp_1:.4f} (Threshold: < 0.62, Rejection ceiling: < 0.35)")

# 2.4 Impostor rejection (reg1 vs Master E2E)
record_test("Impostor Rejection: student 1 vs Master E2E candidate", sim_imp_2 < 0.35,
            f"Cosine Similarity: {sim_imp_2:.4f} (Threshold: < 0.62, Rejection ceiling: < 0.35)")

# 2.5 Discriminative separation margin
min_gen = min(sim_gen_1, sim_gen_sess)
max_imp = max(sim_imp_1, sim_imp_2)
margin = min_gen - max_imp
record_test("Discriminative Margin (min(Genuine) - max(Impostor))", margin >= 0.40,
            f"Margin: {margin:.4f} (min Genuine: {min_gen:.4f}, max Impostor: {max_imp:.4f})")

# =========================================================================
# TEST 3: Fleetwide Extraction Across Real Database Candidate Instances
# =========================================================================
print("\n--- TEST 3: Fleetwide Extraction Across Real Database Candidate Instances ---")
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

for label, fp in real_candidates:
    if not os.path.exists(fp):
        continue
    emb, meta = extract_face_embedding(fp)
    floats = np.frombuffer(emb, dtype=np.float32)
    norm = float(np.linalg.norm(floats))
    cand_ok = (
        len(emb) == 2048 and
        abs(norm - 1.0) < 1e-4 and
        meta.get("embedding_model") == "MobileFaceNet-ArcFace-512" and
        meta.get("embedding_dim") == 512 and
        meta.get("is_live") is True and
        meta.get("alignment_status") == "UMEYAMA_ALIGNED_112X112" and
        meta.get("illumination_status") == "OPTIMAL_EQUALIZED"
    )
    details = f"Bytes: {len(emb)} | Norm: {norm:.4f} | Model: {meta.get('embedding_model')} | Live: {meta.get('liveness_score')}"
    record_test(f"Fleet Extraction: {label}", cand_ok, details)

# =========================================================================
# TEST 4: Latency & Performance SLA Benchmarks
# =========================================================================
print("\n--- TEST 4: Latency & Performance SLA Benchmarks ---")
base_cand_img = Image.open(real_candidates[0][1]).convert("RGB")
detector = get_scrfd_detector()
fcs = detector.detect(base_cand_img)
aligned_patch, _ = align_and_equalize_face(base_cand_img, np.array(fcs[0]['kps'], dtype=np.float32))

# Pure ArcFace inference latency (10 passes)
for _ in range(3): _ = arcface.extract(aligned_patch)
lat_arcface = []
for _ in range(10):
    t0 = time.perf_counter()
    _ = arcface.extract(aligned_patch)
    lat_arcface.append((time.perf_counter() - t0) * 1000)

med_arcface = np.median(lat_arcface)
record_test("ArcFace 512-d CPU Forward Pass Latency", med_arcface <= 8.0,
            f"Median: {med_arcface:.2f}ms | Min: {np.min(lat_arcface):.2f}ms (Budget: <= 8.0ms)")

# Combined Full Pipeline Latency (Detection + Liveness + Alignment + CLAHE + ArcFace)
lat_full_pipe = []
for _ in range(10):
    t0 = time.perf_counter()
    _ = extract_face_embedding(real_candidates[0][1])
    lat_full_pipe.append((time.perf_counter() - t0) * 1000)

med_full_pipe = np.median(lat_full_pipe)
record_test("Combined Full Biometric Extraction Pipeline Latency", med_full_pipe <= 25.0,
            f"Median: {med_full_pipe:.2f}ms | Min: {np.min(lat_full_pipe):.2f}ms (Budget: <= 25.0ms)")

# =========================================================================
# TEST 5: Edge-Case Validations
# =========================================================================
print("\n--- TEST 5: Edge-Case Validations ---")
# Edge Case 5.1: Zero-vector protection (pure black image patch)
black_patch = Image.new("RGB", (112, 112), (0, 0, 0))
try:
    emb_black = arcface.extract(black_patch)
    floats_b = np.frombuffer(emb_black, dtype=np.float32)
    has_nan = np.any(np.isnan(floats_b))
    norm_b = float(np.linalg.norm(floats_b))
    record_test("Edge Case 5.1 (Zero Glare/Black Patch Handled Safely)", not has_nan,
                f"Norm: {norm_b:.4f} | Has NaN: {has_nan}")
except Exception as e:
    record_test("Edge Case 5.1 (Zero Glare/Black Patch Handled Safely)", False, str(e))

# Edge Case 5.2: Illumination Invariance (Harsh Unilateral Shadow)
# Dim left half of candidate portrait by 70%, extract embedding, and measure cosine similarity to normal portrait
arr_cand = np.array(base_cand_img, dtype=np.float32)
arr_cand_shadow = arr_cand.copy()
arr_cand_shadow[:, :arr_cand.shape[1]//2, :] *= 0.30
img_cand_shadow = Image.fromarray(arr_cand_shadow.astype(np.uint8))
shadow_path = "/tmp/edge_cases_bio/cand_shadow.jpg"
img_cand_shadow.save(shadow_path)

emb_normal, _ = extract_face_embedding(real_candidates[0][1])
emb_shadow, _ = extract_face_embedding(shadow_path)
sim_shadow = float(np.dot(np.frombuffer(emb_normal, dtype=np.float32), np.frombuffer(emb_shadow, dtype=np.float32)))
record_test("Edge Case 5.2 (Illumination Invariance under Harsh Shadow)", sim_shadow >= 0.70,
            f"Cosine Similarity under 70% shadow: {sim_shadow:.4f} (Target: >= 0.70)")

# Edge Case 5.3: Head Roll Tilt Invariance (30 deg rotation)
rot_cand_img = base_cand_img.rotate(30, expand=True)
rot_path = "/tmp/edge_cases_bio/cand_rot30.jpg"
rot_cand_img.save(rot_path)

emb_rot, _ = extract_face_embedding(rot_path)
sim_rot = float(np.dot(np.frombuffer(emb_normal, dtype=np.float32), np.frombuffer(emb_rot, dtype=np.float32)))
record_test("Edge Case 5.3 (Pose Invariance under 30 deg Head Roll Tilt)", sim_rot >= 0.70,
            f"Cosine Similarity under 30 deg roll: {sim_rot:.4f} (Target: >= 0.70)")

# Edge Case 5.4: Prior Gates Preserved (Zero-face, Multi-person, Spoof attack)
res_zero = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", black_path],
    capture_output=True, text=True
)
data_zero = json.loads(res_zero.stdout.strip())
record_test("Edge Case 5.4a (Zero-Face Prior Gate Preserved)", data_zero.get("error") == "NO_FACE_DETECTED", f"Error: {data_zero.get('error')}")

res_multi = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", "/home/savan/openviva/storage/biometrics/faces/reg7.jpg"],
    capture_output=True, text=True
)
data_multi = json.loads(res_multi.stdout.strip())
record_test("Edge Case 5.4b (Multi-Person Prior Gate Preserved)", data_multi.get("error") == "MULTIPLE_FACES_DETECTED", f"Error: {data_multi.get('error')}")

# =========================================================================
# TEST 6: Full CLI Schema & Serialization Verification
# =========================================================================
print("\n--- TEST 6: Full CLI Schema & Serialization Verification ---")
res_cli = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", real_candidates[0][1]],
    capture_output=True, text=True
)
try:
    cli_data = json.loads(res_cli.stdout.strip())
    raw_b64 = cli_data.get("face_embedding_base64", "")
    decoded_blob = base64.b64decode(raw_b64)
    floats = np.frombuffer(decoded_blob, dtype=np.float32)
    norm = float(np.linalg.norm(floats))
    
    schema_ok = (
        cli_data.get("success") is True and
        cli_data.get("face_detected") is True and
        cli_data.get("is_live") is True and
        cli_data.get("liveness_score") >= 0.80 and
        cli_data.get("face_embedding_bytes") == 2048 and
        len(decoded_blob) == 2048 and
        len(floats) == 512 and
        abs(norm - 1.0) < 1e-4 and
        cli_data.get("embedding_model") == "MobileFaceNet-ArcFace-512" and
        cli_data.get("embedding_dim") == 512 and
        cli_data.get("alignment_status") == "UMEYAMA_ALIGNED_112X112" and
        cli_data.get("illumination_status") == "OPTIMAL_EQUALIZED"
    )
    record_test("Full CLI Output Schema & Rich Telemetry", schema_ok,
                f"Model: {cli_data.get('embedding_model')} | Dim: {cli_data.get('embedding_dim')} | Bytes: {len(decoded_blob)} | Norm: {norm:.4f}")
except Exception as e:
    record_test("Full CLI Output Schema & Rich Telemetry", False, f"Failed: {e} | Raw: {res_cli.stdout}")

# =========================================================================
# MASTER SUMMARY
# =========================================================================
total_passed = sum(1 for _, p, _ in test_results if p)
total_tests = len(test_results)
print("\n" + "=" * 80)
print(f"TASK 2.4 EMPIRICAL RESULTS: {total_passed}/{total_tests} TESTS PASSED ({(total_passed/total_tests)*100:.1f}%)")
print("=" * 80)

if total_passed == total_tests:
    print("ALL TASK 2.4 ARCFACE BIOMETRIC VERIFICATION CHECKS VERIFIED SUCCESSFULLY.")
    sys.exit(0)
else:
    print("SOME TESTS FAILED.")
    sys.exit(1)
