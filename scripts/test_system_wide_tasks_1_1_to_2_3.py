
import os
import sys
import time
import json
import base64
import struct
import hashlib
import threading
import subprocess
import numpy as np
from PIL import Image

print("=" * 80)
print("MASTER SYSTEM-WIDE EMPIRICAL TEST SUITE: OPEN-VIVA BIOMETRIC ENGINE")
print("Full Empirical Verification: Tasks 1.1, 1.2, 2.1, 2.2 & 2.3 Integrated System")
print("=" * 80)

# Ensure temporary directories and synthetic edge-case files exist
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
# LAYER 1: HARDWARE, MODELS & DEPENDENCY PURITY (Tasks 1.1 & 1.2)
# =========================================================================
print("\n" + "=" * 60)
print("LAYER 1: Hardware, Model Storage, Checksums & Concurrency")
print("=" * 60)

# 1.1 Model file existence & SHA256 hashes
models = {
    "scrfd_500m_kps.onnx": {
        "path": "/home/savan/openviva/models/face/scrfd_500m_kps.onnx",
        "sha_prefix": "5e4447f50245bbd7"
    },
    "minifasnet_v2.onnx": {
        "path": "/home/savan/openviva/models/face/minifasnet_v2.onnx",
        "sha_prefix": "d7b3cd9ba8a7ceb1"
    },
    "mobilefacenet_arcface_512.onnx": {
        "path": "/home/savan/openviva/models/face/mobilefacenet_arcface_512.onnx",
        "sha_prefix": "9cc6e4a75f0e2bf0"
    }
}

for m_name, meta in models.items():
    fp = meta["path"]
    exists = os.path.exists(fp)
    if exists:
        with open(fp, "rb") as f:
            h = hashlib.sha256(f.read()).hexdigest()
        sha_ok = h.startswith(meta["sha_prefix"])
        record_test(f"Model Checksum: {m_name}", sha_ok, f"Size: {os.path.getsize(fp):,} B | SHA256: {h[:16]}...")
    else:
        record_test(f"Model Checksum: {m_name}", False, f"Missing file: {fp}")

# 1.2 Zero unwanted dependencies
unwanted = [m for m in sys.modules if m.startswith(('torch', 'torchvision', 'cv2', 'skimage'))]
record_test("Zero Deep Learning Framework Overhead (Zero PyTorch/OpenCV)", len(unwanted) == 0,
            f"Active unwanted modules: {unwanted}")

# 1.3 Multi-threaded session concurrency
def concurrent_worker(tid, results):
    try:
        det = get_scrfd_detector()
        fas = get_liveness_classifier()
        c_img = Image.new("RGB", (640, 480), (120, 120, 120))
        _ = det.detect(c_img)
        _ = fas.evaluate(c_img, [100, 100, 300, 300])
        results.append(True)
    except Exception as e:
        results.append(False)

threads = []
concurr_res = []
for i in range(4):
    t = threading.Thread(target=concurrent_worker, args=(i, concurr_res))
    threads.append(t)
    t.start()
for t in threads:
    t.join()

record_test("Multi-Threaded Worker Concurrency (4 threads)", len(concurr_res) == 4 and all(concurr_res),
            f"Successfully executed across {len(concurr_res)} threads concurrently")

# =========================================================================
# LAYER 2: CANDIDATE BIOMETRIC FLEET VERIFICATION (Tasks 2.1, 2.2, 2.3)
# =========================================================================
print("\n" + "=" * 60)
print("LAYER 2: Real Database Candidate Records Full Pipeline")
print("=" * 60)

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

detector = get_scrfd_detector()
liveness_clf = get_liveness_classifier()

for label, fp in real_candidates:
    if not os.path.exists(fp):
        print(f"Skipping {label} (missing {fp})")
        continue
    
    img = Image.open(fp).convert("RGB")
    
    # 1. Detection
    faces = detector.detect(img)
    det_ok = len(faces) == 1 and faces[0]['score'] >= 0.70
    if not det_ok:
        record_test(f"Fleet Candidate: {label}", False, f"Detection failed: {len(faces)} faces")
        continue
        
    face = faces[0]
    box = face['box']
    kps = np.array(face['kps'], dtype=np.float32)
    
    # 2. Liveness
    live_res = liveness_clf.evaluate(img, box)
    live_ok = live_res['is_live'] and (live_res['liveness_score'] >= 0.80)
    
    # 3. Umeyama Alignment
    T_fwd = umeyama(kps, ARCFACE_CANONICAL_5PTS)
    homo = np.hstack([kps, np.ones((5, 1))])
    mapped = (T_fwd @ homo.T).T[:, :2]
    res_err = float(np.mean(np.linalg.norm(mapped - ARCFACE_CANONICAL_5PTS, axis=1)))
    eye_dy = float(abs(mapped[0, 1] - mapped[1, 1]))
    aligned_face, align_meta = align_and_equalize_face(img, kps)
    align_ok = (res_err < 5.0) and (eye_dy < 2.5) and (aligned_face.size == (112, 112))
    
    # 4. Feature Extraction
    feat_bytes, feat_meta = extract_face_embedding(fp)
    feat_floats = struct.unpack("512f", feat_bytes)
    norm = float(np.linalg.norm(feat_floats))
    feat_ok = (len(feat_bytes) == 2048) and (abs(norm - 1.0) < 1e-4)
    
    all_ok = det_ok and live_ok and align_ok and feat_ok
    details = f"Det: {face['score']:.3f} | Live: {live_res['liveness_score']:.4f} | Residual: {res_err:.2f}px | Eye dY: {eye_dy:.2f}px | Norm: {norm:.4f}"
    record_test(f"Fleet Candidate: {label}", all_ok, details)

# =========================================================================
# LAYER 3: PRESENTATION ATTACK DETECTION (ANTI-SPOOF) (Task 2.2)
# =========================================================================
print("\n" + "=" * 60)
print("LAYER 3: Presentation Attack Detection & Security Gates")
print("=" * 60)

base_img = Image.open(real_candidates[0][1]).convert("RGB")
real_patch = base_img.crop((150, 100, 450, 400)).resize((80, 80), Image.Resampling.BILINEAR)
arr_patch = np.array(real_patch, dtype=np.float32)

# 3.1 Screen replay attack (moiré)
moire_patch = arr_patch.copy()
for y in range(80):
    for x in range(80):
        moire = np.sin(x * 0.8) * 45.0 + np.sin(y * 0.8) * 45.0
        moire_patch[y, x] = np.clip(moire_patch[y, x] + moire, 0, 255)
blob_m = np.transpose(moire_patch[:, :, ::-1], (2, 0, 1))[np.newaxis, :].astype(np.float32)
out_m = liveness_clf.session.run(None, {liveness_clf.input_name: blob_m})[0][0]
p_m = np.exp(out_m - np.max(out_m)) / np.sum(np.exp(out_m - np.max(out_m)))
record_test("Presentation Attack 3.1 (Screen Replay Moiré Rejected)", (p_m[1] < 0.05) and (p_m[2] > 0.90),
            f"P(Real): {p_m[1]:.4f} | P(Replay): {p_m[2]:.4f}")

# 3.2 Paper print attack (halftone)
print_patch = arr_patch.copy()
noise = np.random.normal(0, 35, (80, 80, 3))
print_patch = np.clip(print_patch * 0.85 + noise + 20, 0, 255)
print_patch[:10, :, :] = 245
print_patch[-10:, :, :] = 245
print_patch[:, :10, :] = 245
print_patch[:, -10:, :] = 245
blob_p = np.transpose(print_patch[:, :, ::-1], (2, 0, 1))[np.newaxis, :].astype(np.float32)
out_p = liveness_clf.session.run(None, {liveness_clf.input_name: blob_p})[0][0]
p_p = np.exp(out_p - np.max(out_p)) / np.sum(np.exp(out_p - np.max(out_p)))
record_test("Presentation Attack 3.2 (Paper Print Halftone Rejected)", (p_p[1] < 0.05) and (p_p[0] > 0.90),
            f"P(Real): {p_p[1]:.4f} | P(Print): {p_p[0]:.4f}")

# 3.3 Fail-closed CLI presentation attack trigger
mock_spoof_code = '''
import sys, json
sys.path.insert(0, "/home/savan/openviva/scripts")
import extract_biometrics

class MockSpoofLiveness:
    liveness_thresh = 0.80
    def evaluate(self, img, box):
        return {
            "is_live": False,
            "liveness_score": 0.0005,
            "spoof_probabilities": {"real": 0.0005, "print_attack": 0.9995, "replay_attack": 0.0000},
            "spoof_type": "PRINT_ATTACK"
        }

extract_biometrics._liveness_instance = MockSpoofLiveness()
try:
    extract_biometrics.main()
except SystemExit:
    pass
'''
res_spoof = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "-c", mock_spoof_code, "--face", real_candidates[0][1]],
    capture_output=True, text=True
)
data_spoof = json.loads(res_spoof.stdout.strip())
record_test("Presentation Attack 3.3 (CLI Fail-Closed Exception)",
            (data_spoof.get("success") is False) and (data_spoof.get("error") == "SPOOF_PHOTO_DETECTED"),
            f"Returned Error Code: {data_spoof.get('error')}")

# =========================================================================
# LAYER 4: MATHEMATICAL ALIGNMENT & ILLUMINATION (Task 2.3)
# =========================================================================
print("\n" + "=" * 60)
print("LAYER 4: Mathematical Alignment & Illumination Equalization")
print("=" * 60)

# 4.1 Canonical identity
T_id = umeyama(ARCFACE_CANONICAL_5PTS, ARCFACE_CANONICAL_5PTS)
err_id = np.max(np.linalg.norm((T_id @ np.hstack([ARCFACE_CANONICAL_5PTS, np.ones((5, 1))]).T).T[:, :2] - ARCFACE_CANONICAL_5PTS, axis=1))
record_test("Umeyama Identity Mapping", err_id < 1e-5, f"Residual: {err_id:.2e} px")

# 4.2 Parameter recovery
theta = np.radians(35.0)
R_mat = np.array([[np.cos(theta), -np.sin(theta)], [np.sin(theta), np.cos(theta)]])
synth = 2.15 * (ARCFACE_CANONICAL_5PTS @ R_mat.T) + np.array([80.0, -60.0])
T_synth = umeyama(ARCFACE_CANONICAL_5PTS, synth)
rec_s = np.sqrt(np.abs(np.linalg.det(T_synth[:2, :2])))
rec_th = np.degrees(np.arctan2(T_synth[1, 0], T_synth[0, 0]))
record_test("Umeyama 2D Similarity Parameter Recovery", (abs(rec_s - 2.15) < 1e-3) and (abs(rec_th - 35.0) < 1e-3),
            f"Recovered scale: {rec_s:.4f} (exp 2.15) | angle: {rec_th:.2f} deg (exp 35.0)")

# 4.3 Shadow suppression via pure NumPy CLAHE
aligned_base = warp_face_arcface(base_img, kps)
arr_unshadowed = np.array(aligned_base, dtype=np.float32)
arr_shadowed = arr_unshadowed.copy()
arr_shadowed[:, :56, :] *= 0.30
equalized = numpy_clahe(Image.fromarray(arr_shadowed.astype(np.uint8)))
arr_eq = np.array(equalized, dtype=np.float32)
Y_b = 0.299 * arr_shadowed[:, :, 0] + 0.587 * arr_shadowed[:, :, 1] + 0.114 * arr_shadowed[:, :, 2]
Y_a = 0.299 * arr_eq[:, :, 0] + 0.587 * arr_eq[:, :, 1] + 0.114 * arr_eq[:, :, 2]
boost = (np.mean(Y_a[:, :56]) - np.mean(Y_b[:, :56])) / (np.mean(Y_b[:, :56]) + 1e-6)
record_test("NumPy CLAHE Luminance Shadow Neutralization", boost > 0.50,
            f"Shadowed luminance boosted by +{boost*100:.1f}%")

# =========================================================================
# LAYER 5: FAIL-CLOSED ANOMALIES & EDGE CASES
# =========================================================================
print("\n" + "=" * 60)
print("LAYER 5: Anomaly Trapping & Edge Cases")
print("=" * 60)

# 5.1 Zero-face fail closed
res_zero = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", black_path],
    capture_output=True, text=True
)
data_zero = json.loads(res_zero.stdout.strip())
record_test("Anomaly 5.1: Zero-Face Fail-Closed Gate", data_zero.get("error") == "NO_FACE_DETECTED", f"Response: {data_zero}")

# 5.2 Multi-face accomplice fail closed (reg7.jpg contains 2 students)
res_multi = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", "/home/savan/openviva/storage/biometrics/faces/reg7.jpg"],
    capture_output=True, text=True
)
data_multi = json.loads(res_multi.stdout.strip())
record_test("Anomaly 5.2: Multi-Person Accomplice Detection Gate", data_multi.get("error") == "MULTIPLE_FACES_DETECTED", f"Response: {data_multi}")

# 5.3 Head roll tilts (+30 and -30 deg)
for angle in [30, -30]:
    rot_img = base_img.rotate(angle, expand=True)
    fcs_rot = detector.detect(rot_img)
    if fcs_rot:
        aligned_rot = warp_face_arcface(rot_img, np.array(fcs_rot[0]['kps'], dtype=np.float32))
        record_test(f"Edge Case 5.3 (Head Roll Tilt {angle:+d} deg)", aligned_rot.size == (112, 112),
                    f"Aligned crop size: {aligned_rot.size}")
    else:
        record_test(f"Edge Case 5.3 (Head Roll Tilt {angle:+d} deg)", False, "Detection missed at roll")

# 5.4 Widescreen 16:9 1280x720 webcam stream
cam_stream = Image.new("RGB", (1280, 720), (50, 50, 50))
cand_cam = base_img.resize((720, 720))
cam_stream.paste(cand_cam, ((1280 - 720) // 2, 0))
fcs_cam = detector.detect(cam_stream)
if fcs_cam:
    live_cam = liveness_clf.evaluate(cam_stream, fcs_cam[0]['box'])
    record_test("Edge Case 5.4 (Widescreen 16:9 Webcam Stream)", live_cam["is_live"] and live_cam["liveness_score"] >= 0.80,
                f"Liveness: {live_cam['liveness_score']:.4f} (>= 0.80)")
else:
    record_test("Edge Case 5.4 (Widescreen 16:9 Webcam Stream)", False, "Detection missed on widescreen stream")

# 5.5 Low-light dimming (25% luminance)
dimmed = Image.fromarray((np.array(base_img, dtype=np.float32) * 0.25).astype(np.uint8))
fcs_dim = detector.detect(dimmed)
record_test("Edge Case 5.5 (Low-Light 25% Luminance Face Trapping)", len(fcs_dim) == 1,
            f"Detected faces: {len(fcs_dim)} | Score: {fcs_dim[0]['score'] if fcs_dim else 0.0:.3f}")

# =========================================================================
# LAYER 6: CLI INTERFACE MODES & SCHEMAS
# =========================================================================
print("\n" + "=" * 60)
print("LAYER 6: CLI Modes & Schema Compliance")
print("=" * 60)

# 6.1 --detect-only
res_det = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", real_candidates[0][1], "--detect-only"],
    capture_output=True, text=True
)
data_det = json.loads(res_det.stdout.strip())
record_test("CLI Mode 6.1 (--detect-only Fast Path)", (data_det.get("success") is True) and ("face" in data_det),
            f"Box: {data_det.get('face', {}).get('box')}")

# 6.2 --liveness-only
res_live = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", real_candidates[0][1], "--liveness-only"],
    capture_output=True, text=True
)
data_live = json.loads(res_live.stdout.strip())
record_test("CLI Mode 6.2 (--liveness-only Fast Path)", (data_live.get("success") is True) and ("liveness_score" in data_live),
            f"Live: {data_live.get('is_live')} | Score: {data_live.get('liveness_score')}")

# 6.3 --align-only
res_align = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", real_candidates[0][1], "--align-only"],
    capture_output=True, text=True
)
data_align = json.loads(res_align.stdout.strip())
record_test("CLI Mode 6.3 (--align-only Fast Path)", (data_align.get("success") is True) and (data_align.get("alignment_status") == "UMEYAMA_ALIGNED_112X112"),
            f"Status: {data_align.get('alignment_status')} | Size: {data_align.get('aligned_size')}")

# 6.4 Full extraction end-to-end
res_full = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", real_candidates[0][1]],
    capture_output=True, text=True
)
data_full = json.loads(res_full.stdout.strip())
blob_f = base64.b64decode(data_full.get("face_embedding_base64", ""))
full_valid = (
    data_full.get("success") is True and
    data_full.get("face_embedding_bytes") == 2048 and
    len(blob_f) == 2048 and
    data_full.get("face_detected") is True and
    data_full.get("is_live") is True and
    data_full.get("alignment_status") == "UMEYAMA_ALIGNED_112X112" and
    data_full.get("illumination_status") == "OPTIMAL_EQUALIZED"
)
record_test("CLI Mode 6.4 (Full Unimodal End-to-End Extraction)", full_valid,
            f"Bytes: {len(blob_f)} | Align: {data_full.get('alignment_status')} | Live: {data_full.get('liveness_score')}")

# 6.5 Full multimodal extraction (Face + Voice sample)
voice_dir = "/home/savan/openviva/storage/biometrics/voice"
os.makedirs(voice_dir, exist_ok=True)
sample_voice = os.path.join(voice_dir, "reg1.wav")
if not os.path.exists(sample_voice):
    import wave
    with wave.open(sample_voice, "wb") as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(16000)
        synth_pcm = (np.sin(np.linspace(0, 100 * np.pi, 16000)) * 10000).astype(np.int16)
        wf.writeframes(synth_pcm.tobytes())

res_multi_modal = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", real_candidates[0][1], "--voice", sample_voice],
    capture_output=True, text=True
)
data_mm = json.loads(res_multi_modal.stdout.strip())
blob_v = base64.b64decode(data_mm.get("voice_embedding_base64", ""))
mm_valid = (data_mm.get("success") is True) and (len(blob_f) == 2048) and (len(blob_v) == 768)
record_test("CLI Mode 6.5 (Multimodal Face 2048B + Voice 768B Schema)", mm_valid,
            f"Face bytes: {len(blob_f)} | Voice bytes: {len(blob_v)}")

# =========================================================================
# LAYER 7: SYSTEM LATENCY & REAL-TIME SLA BENCHMARK
# =========================================================================
print("\n" + "=" * 60)
print("LAYER 7: End-to-End Latency & Performance SLA Budgeting")
print("=" * 60)

# Warmup passes
for _ in range(3):
    extract_face_embedding(real_candidates[0][1])

# Stage 1: SCRFD Face Detection
lat_det = []
for _ in range(10):
    t0 = time.perf_counter()
    _ = detector.detect(base_img)
    lat_det.append((time.perf_counter() - t0) * 1000)
med_det = np.median(lat_det)
record_test("Stage 1: SCRFD-500M Face Detection Latency", med_det <= 20.0,
            f"Median: {med_det:.2f}ms | Min: {np.min(lat_det):.2f}ms (SLA: <= 20.0ms)")

# Stage 2: MiniFASNet-V2 Anti-Spoof Liveness
lat_live = []
for _ in range(10):
    t0 = time.perf_counter()
    _ = liveness_clf.evaluate(base_img, box)
    lat_live.append((time.perf_counter() - t0) * 1000)
med_live = np.median(lat_live)
record_test("Stage 2: MiniFASNet-V2 Anti-Spoof Latency", med_live <= 5.0,
            f"Median: {med_live:.2f}ms | Min: {np.min(lat_live):.2f}ms (SLA: <= 5.0ms)")

# Stage 3: Umeyama 5-Point Affine Alignment
lat_align = []
for _ in range(10):
    t0 = time.perf_counter()
    _ = warp_face_arcface(base_img, kps)
    lat_align.append((time.perf_counter() - t0) * 1000)
med_align = np.median(lat_align)
record_test("Stage 3: Umeyama 5-Point Alignment Latency", med_align <= 2.0,
            f"Median: {med_align:.2f}ms | Min: {np.min(lat_align):.2f}ms (SLA: <= 2.0ms)")

# Stage 4: Pure NumPy CLAHE Illumination Equalization
lat_clahe = []
for _ in range(10):
    t0 = time.perf_counter()
    _ = numpy_clahe(aligned_base)
    lat_clahe.append((time.perf_counter() - t0) * 1000)
med_clahe = np.median(lat_clahe)
record_test("Stage 4: NumPy CLAHE Equalization Latency", med_clahe <= 5.0,
            f"Median: {med_clahe:.2f}ms | Min: {np.min(lat_clahe):.2f}ms (SLA: <= 5.0ms)")

# Stage 5: Combined Full End-to-End Extraction Pipeline
lat_e2e = []
for _ in range(10):
    t0 = time.perf_counter()
    _ = extract_face_embedding(real_candidates[0][1])
    lat_e2e.append((time.perf_counter() - t0) * 1000)
med_e2e = np.median(lat_e2e)
record_test("Stage 5: Combined End-to-End Biometric Pipeline Latency", med_e2e <= 25.0,
            f"Median: {med_e2e:.2f}ms | Min: {np.min(lat_e2e):.2f}ms (SLA: <= 30.0ms)")

# =========================================================================
# MASTER SUMMARY
# =========================================================================
total_passed = sum(1 for _, p, _ in test_results if p)
total_tests = len(test_results)
print("\n" + "=" * 80)
print(f"MASTER SYSTEM EVALUATION: {total_passed}/{total_tests} TESTS PASSED ({(total_passed/total_tests)*100:.1f}%)")
print("=" * 80)

if total_passed == total_tests:
    print("ALL INTEGRATED SYSTEM TESTS PASSED SUCCESSFULLY ACROSS TASKS 1.1 -> 2.3.")
    sys.exit(0)
else:
    print("SOME SYSTEM TESTS FAILED.")
    sys.exit(1)
