
import os
import sys
import time
import json
import base64
import subprocess
import numpy as np
from PIL import Image

print("=" * 75)
print("TASK 2.1 EMPIRICAL & EDGE-CASE TEST SUITE: SCRFD FACE DETECTION & LANDMARKS")
print("=" * 75)

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
# TEST 1: Model Loading & Dependency Purity (Combination with Tasks 1.1 & 1.2)
# =========================================================================
print("\n--- TEST 1: Model Loading & Dependency Purity ---")
try:
    detector = get_scrfd_detector("/home/savan/openviva/models/face/scrfd_500m_kps.onnx")
    resolved = detector.resolved_path
    model_matched = (resolved == "/home/savan/openviva/models/face/scrfd_500m_kps.onnx")
    
    # Check that no torch, torchvision or cv2 is imported in python memory
    unwanted = [m for m in sys.modules if m.startswith(('torch', 'cv2', 'torchvision'))]
    purity = (len(unwanted) == 0)
    
    record_test("Model Path Verification", model_matched, f"Loaded from: {resolved}")
    record_test("Dependency Purity (Zero PyTorch/OpenCV)", purity, f"Unwanted modules: {unwanted}")
except Exception as e:
    record_test("Model Path Verification", False, str(e))
    record_test("Dependency Purity", False, str(e))

# =========================================================================
# TEST 2: Single Face Detection on Real Candidate Portraits
# =========================================================================
print("\n--- TEST 2: Single Face Detection on Real Portraits ---")
single_face_images = [
    "/home/savan/openviva/storage/biometrics/faces/reg1.jpg",
    "/home/savan/openviva/storage/biometrics/faces/reg1_keyframe.jpg",
    "/home/savan/openviva/storage/biometrics/faces/master_e2e_1793867311.jpg"
]

for img_path in single_face_images:
    if not os.path.exists(img_path):
        record_test(f"Real Portrait Detection: {os.path.basename(img_path)}", False, "File missing")
        continue
    img = Image.open(img_path).convert("RGB")
    w, h = img.size
    faces = detector.detect(img)
    
    single_face = (len(faces) == 1)
    if not single_face:
        record_test(f"Real Portrait Detection: {os.path.basename(img_path)}", False, f"Expected 1 face, got {len(faces)}")
        continue
        
    face = faces[0]
    box = face['box'] # [x1, y1, x2, y2]
    kps = face['kps'] # [[x,y], ...]
    score = face['score']
    
    in_bounds = (0 <= box[0] < box[2] <= w) and (0 <= box[1] < box[3] <= h)
    high_conf = score >= 0.70
    
    # Anatomical landmark order verification:
    # 0: Left Eye, 1: Right Eye, 2: Nose, 3: Left Mouth, 4: Right Mouth
    left_eye, right_eye, nose, left_mouth, right_mouth = kps
    eyes_horizontal = (left_eye[0] < right_eye[0])
    eyes_above_nose = (left_eye[1] < nose[1] and right_eye[1] < nose[1])
    nose_above_mouth = (nose[1] < left_mouth[1] and nose[1] < right_mouth[1])
    mouth_horizontal = (left_mouth[0] < right_mouth[0])
    
    landmarks_valid = eyes_horizontal and eyes_above_nose and nose_above_mouth and mouth_horizontal
    all_ok = single_face and in_bounds and high_conf and landmarks_valid
    details = f"Score: {score:.3f} | Box: {box} | Eyes Horiz: {eyes_horizontal} | Eyes>Nose: {eyes_above_nose} | Nose>Mouth: {nose_above_mouth}"
    record_test(f"Real Portrait Detection: {os.path.basename(img_path)}", all_ok, details)

# =========================================================================
# TEST 3: Empirical Execution Latency Benchmark
# =========================================================================
print("\n--- TEST 3: Empirical Execution Latency Benchmark ---")
img = Image.open(single_face_images[0]).convert("RGB")
# 2 Warmup passes
for _ in range(2):
    _ = detector.detect(img)

latencies = []
for _ in range(10):
    t0 = time.perf_counter()
    _ = detector.detect(img)
    latencies.append((time.perf_counter() - t0) * 1000)

avg_lat = np.mean(latencies)
median_lat = np.median(latencies)
std_lat = np.std(latencies)
lat_ok = median_lat < 20.0
record_test("SCRFD CPU Latency Benchmark (10 passes)", lat_ok, f"Median: {median_lat:.2f}ms | Mean: {avg_lat:.2f}ms | Min: {np.min(latencies):.2f}ms (Budget: Median <= 20ms)")

# =========================================================================
# TEST 4: EDGE CASES
# =========================================================================
print("\n--- TEST 4: Edge-Case Validations ---")

os.makedirs("/tmp/edge_cases_bio", exist_ok=True)

# Edge Case 4.1: Zero Faces (Blank / Black / Noise / Non-face)
black_img = Image.new("RGB", (640, 480), (0, 0, 0))
black_path = "/tmp/edge_cases_bio/black.jpg"
black_img.save(black_path)
faces_black = detector.detect(black_img)
record_test("Edge Case 4.1a (Pure Black Frame): 0 Faces", len(faces_black) == 0, f"Detected: {len(faces_black)}")

noise_arr = np.random.randint(0, 256, (480, 640, 3), dtype=np.uint8)
noise_img = Image.fromarray(noise_arr)
noise_path = "/tmp/edge_cases_bio/noise.jpg"
noise_img.save(noise_path)
faces_noise = detector.detect(noise_img)
record_test("Edge Case 4.1b (Gaussian Noise Frame): 0 Faces", len(faces_noise) == 0, f"Detected: {len(faces_noise)}")

# Edge Case 4.2: Zero-Face Fail-Closed CLI Output
res = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", black_path],
    capture_output=True, text=True
)
try:
    data = json.loads(res.stdout.strip())
    fail_closed = (data.get("success") is False) and (data.get("error") == "NO_FACE_DETECTED")
    record_test("Edge Case 4.2 (Zero-Face CLI Fail-Closed)", fail_closed, f"Response: {data}")
except Exception as e:
    record_test("Edge Case 4.2 (Zero-Face CLI Fail-Closed)", False, f"Failed parsing JSON: {res.stdout}")

# Edge Case 4.3: Multiple Faces (Accomplice Detection: Synthetic & Real)
# Real multi-person test frame: reg7.jpg
real_multi_path = "/home/savan/openviva/storage/biometrics/faces/reg7.jpg"
faces_real_multi = detector.detect(Image.open(real_multi_path).convert("RGB"))
record_test("Edge Case 4.3a (Real Multi-Person Frame reg7.jpg)", len(faces_real_multi) >= 2, f"Detected {len(faces_real_multi)} faces in reg7.jpg")

# Synthetic dual-face stitched frame
img_base = Image.open(single_face_images[0]).convert("RGB")
box1 = detector.detect(img_base)[0]['box']
crop1 = img_base.crop((int(box1[0]), int(box1[1]), int(box1[2]), int(box1[3])))

multi_canvas = Image.new("RGB", (1280, 480), (128, 128, 128))
multi_canvas.paste(crop1, (80, 100))
multi_canvas.paste(crop1, (700, 100))
multi_path = "/tmp/edge_cases_bio/multi.jpg"
multi_canvas.save(multi_path)

faces_multi = detector.detect(multi_canvas)
detected_multi = len(faces_multi) >= 2
record_test("Edge Case 4.3b (Synthetic Dual-Face Stitched Frame)", detected_multi, f"Detected {len(faces_multi)} faces (Expected >= 2)")

res_multi = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", multi_path],
    capture_output=True, text=True
)
try:
    data_multi = json.loads(res_multi.stdout.strip())
    multi_fail_closed = (data_multi.get("success") is False) and (data_multi.get("error") == "MULTIPLE_FACES_DETECTED")
    record_test("Edge Case 4.3c (Multi-Face CLI Fail-Closed)", multi_fail_closed, f"Response: {data_multi}")
except Exception as e:
    record_test("Edge Case 4.3c (Multi-Face CLI Fail-Closed)", False, f"JSON parse error: {res_multi.stdout}")

# Edge Case 4.4: Extreme Aspect Ratios (Ultra-Wide Panorama & Ultra-Tall Vertical)
# Ultra-wide 1920x400
wide_canvas = Image.new("RGB", (1920, 400), (80, 80, 80))
wide_canvas.paste(crop1.resize((220, 260)), (850, 70))
wide_faces = detector.detect(wide_canvas)
wide_ok = len(wide_faces) == 1 and (800 <= wide_faces[0]['box'][0] <= 900)
record_test("Edge Case 4.4a (Ultra-Wide Aspect Ratio 1920x400)", wide_ok, f"Detected {len(wide_faces)} faces | Box: {wide_faces[0]['box'] if wide_faces else None}")

# Ultra-tall 400x1920
tall_canvas = Image.new("RGB", (400, 1920), (80, 80, 80))
tall_canvas.paste(crop1.resize((220, 260)), (90, 850))
tall_faces = detector.detect(tall_canvas)
tall_ok = len(tall_faces) == 1 and (800 <= tall_faces[0]['box'][1] <= 900)
record_test("Edge Case 4.4b (Ultra-Tall Aspect Ratio 400x1920)", tall_ok, f"Detected {len(tall_faces)} faces | Box: {tall_faces[0]['box'] if tall_faces else None}")

# Edge Case 4.5: Scale Invariance across Strides (Small / Medium / Large Face)
canvas_scale = Image.new("RGB", (640, 640), (128, 128, 128))
# Small face 75x90 -> Stride 8
canvas_small = canvas_scale.copy()
canvas_small.paste(crop1.resize((75, 90)), (280, 270))
small_faces = detector.detect(canvas_small)
small_ok = len(small_faces) == 1
record_test("Edge Case 4.5a (Small Face ~80px, Stride 8)", small_ok, f"Detected: {len(small_faces)} | Score: {small_faces[0]['score'] if small_faces else 0}")

# Large face 360x420 -> Stride 32
canvas_large = canvas_scale.copy()
canvas_large.paste(crop1.resize((360, 420)), (140, 110))
large_faces = detector.detect(canvas_large)
large_ok = len(large_faces) == 1
record_test("Edge Case 4.5b (Large Close-Up Face ~400px, Stride 32)", large_ok, f"Detected: {len(large_faces)} | Score: {large_faces[0]['score'] if large_faces else 0}")

# Edge Case 4.6: Low-Light Illumination Dimming (25% Brightness)
dim_arr = (np.array(img_base, dtype=np.float32) * 0.25).astype(np.uint8)
dim_img = Image.fromarray(dim_arr)
dim_faces = detector.detect(dim_img)
dim_ok = len(dim_faces) == 1
record_test("Edge Case 4.6 (Low-Light 25% Brightness)", dim_ok, f"Detected {len(dim_faces)} faces | Score: {dim_faces[0]['score'] if dim_faces else 0}")

# =========================================================================
# TEST 5: Full CLI Extraction Smoke Test with 2,048-Byte Vector & Telemetry
# =========================================================================
print("\n--- TEST 5: Full CLI Extraction Smoke Test ---")
res_full = subprocess.run(
    ["/home/savan/openviva/agent_env/bin/python", "/home/savan/openviva/scripts/extract_biometrics.py", "--face", single_face_images[0]],
    capture_output=True, text=True
)
try:
    full_data = json.loads(res_full.stdout.strip())
    has_success = full_data.get("success") is True
    has_meta = full_data.get("face_detected") is True and "face_box" in full_data and "landmarks" in full_data
    has_bytes = full_data.get("face_embedding_bytes") == 2048
    blob = base64.b64decode(full_data.get("face_embedding_base64", ""))
    valid_blob = len(blob) == 2048
    
    smoke_ok = has_success and has_meta and has_bytes and valid_blob
    record_test("Full CLI Biometric Extraction Output Schema", smoke_ok, f"Bytes: {len(blob)} | Score: {full_data.get('detection_score'):.3f} | Box: {full_data.get('face_box')}")
except Exception as e:
    record_test("Full CLI Biometric Extraction Output Schema", False, f"Failed: {e} | Raw output: {res_full.stdout}")

# =========================================================================
# SUMMARY
# =========================================================================
total_passed = sum(1 for _, p, _ in test_results if p)
total_tests = len(test_results)
print("\n" + "=" * 75)
print(f"TASK 2.1 EMPIRICAL RESULTS: {total_passed}/{total_tests} TESTS PASSED ({(total_passed/total_tests)*100:.1f}%)")
print("=" * 75)

if total_passed == total_tests:
    print("ALL TASK 2.1 DETECTION & EDGE-CASE CHECKS VERIFIED SUCCESSFULLY.")
    sys.exit(0)
else:
    print("SOME TESTS FAILED.")
    sys.exit(1)
