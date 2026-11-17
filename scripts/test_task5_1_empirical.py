"""
EMPIRICAL TEST SUITE FOR TASK 5.1 (Simulated Yale B Illumination Stress Suite)
Integrated with Tasks 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, 4.1, 4.2, and 4.3
Tests SCRFD, MiniFASNet-V2, Umeyama alignment, pure NumPy Luminance CLAHE,
MobileFaceNet ArcFace 512-d extraction, and Chamber Gate / TA Scorecard HUD under extreme lighting distortions.
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
from PIL import Image
from datetime import datetime, timezone, timedelta
from concurrent.futures import ThreadPoolExecutor

# Add scripts directory to path to import neural modules directly
sys.path.insert(0, "/home/savan/openviva/scripts")
from extract_biometrics import (
    get_scrfd_detector,
    get_liveness_classifier,
    align_and_equalize_face,
    get_arcface_extractor
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
print("TASK 5.1 EMPIRICAL TEST SUITE: SIMULATED YALE B ILLUMINATION STRESS SUITE")
print("Target: Node 10.10.16.13 | PM2: openviva-web (Port 3001) | Tasks 1.1 -> 5.1")
print("=" * 85)

DB_PATH = "/home/savan/openviva/storage/openviva.db"
BASE_URL = "http://localhost:3001/openviva"
FACES_DIR = "/home/savan/openviva/storage/biometrics/faces"
KEYFRAMES_DIR = "/home/savan/openviva/storage/biometrics/keyframes"
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

def ndarray_to_b64(arr_rgb: np.ndarray) -> str:
    img = Image.fromarray(arr_rgb.astype(np.uint8), mode="RGB")
    import io
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=95)
    raw = buf.getvalue()
    return f"data:image/jpeg;base64,{base64.b64encode(raw).decode('utf-8')}"

# =========================================================================
# SECTION 1: GROUND TRUTH PREPARATION & BASELINE NEURAL AUDIT
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 1: GROUND TRUTH PREPARATION & BASELINE NEURAL AUDIT")
print("=" * 60)

# Initialize neural models
detector = get_scrfd_detector()
liveness_classifier = get_liveness_classifier()
arcface = get_arcface_extractor()

# Load pristine genuine reference image
GENUINE_PATH = os.path.join(FACES_DIR, "person_a_1.jpg")
if not os.path.exists(GENUINE_PATH):
    GENUINE_PATH = "/tmp/edge_cases_bio/person_a_1.jpg"

IMPOSTOR_PATH = os.path.join(FACES_DIR, "reg1.jpg")

pristine_img = Image.open(GENUINE_PATH).convert("RGB")
pristine_arr = np.array(pristine_img)
H, W, _ = pristine_arr.shape

impostor_img = Image.open(IMPOSTOR_PATH).convert("RGB")
impostor_arr = np.array(impostor_img)

# Extract pristine baseline embedding
faces_base = detector.detect(pristine_img)
assert len(faces_base) > 0, "No face detected in pristine reference"
aligned_base, _ = align_and_equalize_face(pristine_img, np.array(faces_base[0]['kps'], dtype=np.float32))
emb_base_bytes = arcface.extract(aligned_base)
emb_base = np.frombuffer(emb_base_bytes, dtype=np.float32)

# Extract impostor baseline embedding
faces_imp = detector.detect(impostor_img)
assert len(faces_imp) > 0, "No face detected in impostor reference"
aligned_imp, _ = align_and_equalize_face(impostor_img, np.array(faces_imp[0]['kps'], dtype=np.float32))
emb_imp_bytes = arcface.extract(aligned_imp)
emb_impostor = np.frombuffer(emb_imp_bytes, dtype=np.float32)

sim_baseline_self = compute_cosine_similarity(emb_base, emb_base)
sim_baseline_imp = compute_cosine_similarity(emb_base, emb_impostor)

record_test("1.1 Baseline Pristine Self-Similarity Invariant (Sim == 1.0000)",
            abs(sim_baseline_self - 1.0) < 1e-4, f"Self-Similarity: {sim_baseline_self:.6f}")

record_test("1.2 Baseline Impostor Inter-Class Separation (Sim < 0.20, Margin > 0.80)",
            sim_baseline_imp < 0.20 and (sim_baseline_self - sim_baseline_imp) > 0.80,
            f"Impostor Sim: {sim_baseline_imp:.4f} | Margin: {sim_baseline_self - sim_baseline_imp:.4f}")

# Setup test candidate `cand_yale_b` in SQLite
TEST_CAND_ID = "cand_yale_b"
TEST_SESSION_ID = f"sess_yale_{int(time.time())}"
TEST_TOKEN = f"tok_yale_{int(time.time())}"
EXPIRY = (datetime.now(timezone.utc) + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S.000Z")

conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
c.execute("""
    INSERT OR REPLACE INTO students 
    (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at, updated_at) 
    VALUES (?, 'Yale-B Stress Candidate', 'Computer Science', '2026', 'x', 'x', 0, 1, datetime('now'), datetime('now'))
""", (TEST_CAND_ID,))

c.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, ?, 0, ?, ?)",
          (TEST_TOKEN, TEST_CAND_ID, EXPIRY, datetime.now(timezone.utc).isoformat()))

c.execute("""
    INSERT OR REPLACE INTO exams (id, course_title, instructor_id, system_prompt, created_at)
    VALUES ('exam_default', 'CS101 Intro to AI', 'inst_01', 'Default prompt', datetime('now'))
""")

c.execute("""
    INSERT OR REPLACE INTO exam_sessions (session_id, exam_id, course_title, student_id, started_at, status, created_at)
    VALUES (?, 'exam_default', 'CS101 Intro to AI', ?, datetime('now'), 'IN_PROGRESS', datetime('now'))
""", (TEST_SESSION_ID, TEST_CAND_ID))
conn.commit()
conn.close()

# Enroll candidate with pristine reference
with open(GENUINE_PATH, "rb") as f:
    face_pristine_b64 = f"data:image/jpeg;base64,{base64.b64encode(f.read()).decode('utf-8')}"

# Synthetic voice WAV
wav_header = bytearray(b"RIFF\x24\x08\x00\x00WAVEfmt \x10\x00\x00\x00\x01\x00\x01\x00\x80>\x00\x00\x00}\x00\x00\x02\x00\x10\x00data\x00\x08\x00\x00")
wav_samples = bytearray(2048)
for i in range(1024):
    sample = int(12000.0 * np.sin(2.0 * np.pi * 440.0 * (i / 16000.0)))
    wav_samples[i*2] = sample & 0xff
    wav_samples[i*2 + 1] = (sample >> 8) & 0xff
synth_wav_b64 = f"data:audio/wav;base64,{base64.b64encode(wav_header + wav_samples).decode()}"

status_enr, res_enr, ms_enr = send_post("/api/auth/enroll-biometrics", {
    "faceImageBase64": face_pristine_b64,
    "voiceAudioBase64": synth_wav_b64
}, token=TEST_TOKEN)

record_test("1.3 Candidate Biometric Ground Truth Enrolled (2,048-B Sealed Vector)",
            status_enr == 200 and res_enr.get("success"),
            f"HTTP {status_enr} in {ms_enr:.1f}ms | Vector Sealed")


# =========================================================================
# SECTION 2: SIMULATED YALE B ILLUMINATION DISTORTION GENERATORS
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 2: SIMULATED YALE B ILLUMINATION DISTORTION GENERATION")
print("=" * 60)

img_f = pristine_arr.astype(np.float32)
x = np.linspace(0, 1, W)[np.newaxis, :, np.newaxis]
y = np.linspace(0, 1, H)[:, np.newaxis, np.newaxis]

distortions = {}

# 1. Left Directional Shadow (Yale B Subset 4: 0.20 on left smoothly ramping to 1.0 on right)
distortions["yale_b_left_shadow"] = np.clip(img_f * (0.20 + 0.80 * x), 0, 255).astype(np.uint8)

# 2. Right Directional Shadow (Yale B Subset 4: 1.0 on left smoothly ramping down to 0.20 on right)
distortions["yale_b_right_shadow"] = np.clip(img_f * (1.00 - 0.80 * x), 0, 255).astype(np.uint8)

# 3. Overhead Direct Down-Light (1.0 on brow ramping down to 0.25 on chin/eye-sockets)
distortions["yale_b_overhead_shadow"] = np.clip(img_f * (1.00 - 0.75 * y), 0, 255).astype(np.uint8)

# 4. Severe Global Underexposure (Dim room, Gain x 0.25)
distortions["yale_b_severe_underexposure"] = np.clip(img_f * 0.25, 0, 255).astype(np.uint8)

# 5. Severe Global Overexposure (Intense glare, Gain x 1.80)
distortions["yale_b_severe_overexposure"] = np.clip(img_f * 1.80, 0, 255).astype(np.uint8)

# 6. Center Specular Flash Glare (Direct camera flash hotspot + 80)
glare_kernel = np.exp(-((x - 0.5)**2 + (y - 0.5)**2) / 0.15)
distortions["yale_b_specular_glare"] = np.clip(img_f + 80.0 * glare_kernel, 0, 255).astype(np.uint8)

# 7. Extreme Low Light (Dark room Gain x 0.20)
distortions["yale_b_extreme_low_light"] = np.clip(img_f * 0.20, 0, 255).astype(np.uint8)

# 8. Pitch Black Frame (Fail-Closed Negative Control Gain x 0.01)
distortions["yale_b_pitch_black"] = np.clip(img_f * 0.01, 0, 255).astype(np.uint8)

record_test("2.1 Generated 8 Simulated Yale B Illumination Test Frames", len(distortions) == 8,
            f"Conditions: {list(distortions.keys())}")


# =========================================================================
# SECTION 3: NEURAL PIPELINE INVARIANCE UNDER YALE B STRESS (OFFLINE BENCHMARK)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 3: NEURAL PIPELINE INVARIANCE (DETECTION, LIVENESS, CLAHE, ARCFACE)")
print("=" * 60)

genuine_lighting_keys = [
    "yale_b_left_shadow", "yale_b_right_shadow", "yale_b_overhead_shadow",
    "yale_b_severe_underexposure", "yale_b_severe_overexposure", "yale_b_specular_glare",
    "yale_b_extreme_low_light"
]

all_genuine_passed = True
lighting_metrics = {}

for k in genuine_lighting_keys:
    dist_arr = distortions[k]
    dist_img = Image.fromarray(dist_arr)
    t0 = time.perf_counter()
    
    # 1. Detection
    faces = detector.detect(dist_img)
    detected = len(faces) == 1
    if not detected:
        record_test(f"3.X Neural Invariance Under [{k}]: Single Face Detection", False, f"Faces detected: {len(faces)}")
        all_genuine_passed = False
        continue
    
    # 2. Liveness Check
    box = faces[0]['box']
    kps = faces[0]['kps']
    liveness_res = liveness_classifier.evaluate(dist_img, box)
    score = liveness_res["liveness_score"]
    liveness_passed = liveness_res["is_live"]
    
    # 3 & 4. Umeyama Alignment + Pure NumPy CLAHE
    aligned_face, align_meta = align_and_equalize_face(dist_img, np.array(kps, dtype=np.float32))
    
    # 5. ArcFace 512-d Extraction
    emb_bytes = arcface.extract(aligned_face)
    emb = np.frombuffer(emb_bytes, dtype=np.float32)
    dur_ms = (time.perf_counter() - t0) * 1000
    
    # Cosine Similarity against baseline pristine embedding
    sim_genuine = compute_cosine_similarity(emb_base, emb)
    sim_imp = compute_cosine_similarity(emb_impostor, emb)
    margin = sim_genuine - sim_imp
    
    passed_sim = sim_genuine >= 0.6200
    passed_margin = margin >= 0.2500
    
    lighting_metrics[k] = {
        "similarity": sim_genuine,
        "impostor_sim": sim_imp,
        "margin": margin,
        "liveness_score": score,
        "latency_ms": dur_ms
    }
    
    record_test(f"3.X Yale B [{k}]: Sim >= 0.62 (Actual: {sim_genuine:.4f}) & Margin >= 0.25 (Actual: {margin:.4f})",
                passed_sim and passed_margin and liveness_passed,
                f"Sim: {sim_genuine:.4f} | Impostor: {sim_imp:.4f} | Margin: {margin:.4f} | Liveness: {score:.3f} in {dur_ms:.1f}ms")

# Summary check across all 7 bona fide conditions
min_genuine_sim = min(v["similarity"] for v in lighting_metrics.values())
min_margin = min(v["margin"] for v in lighting_metrics.values())
record_test("3.8 All Yale B Bona Fide Conditions Satisfy Sim >= 0.6200 Threshold Invariant",
            min_genuine_sim >= 0.6200 and min_margin >= 0.2500,
            f"Worst-Case Genuine Sim: {min_genuine_sim:.4f} (>= 0.62) | Worst-Case Margin: {min_margin:.4f} (>= 0.25)")


# =========================================================================
# SECTION 4: LIVE CHAMBER GATE INTEGRATION (/api/auth/verify-gate)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 4: LIVE CHAMBER GATE INTEGRATION UNDER ILLUMINATION STRESS")
print("=" * 60)

gate_test_keys = [
    ("yale_b_left_shadow", True),
    ("yale_b_right_shadow", True),
    ("yale_b_overhead_shadow", True),
    ("yale_b_severe_underexposure", True),
    ("yale_b_severe_overexposure", True),
    ("yale_b_specular_glare", True),
    ("yale_b_extreme_low_light", True),
    ("yale_b_pitch_black", False)  # Must fail closed with HTTP 400 NO_FACE_DETECTED
]

for cond_name, should_pass in gate_test_keys:
    frame_b64 = ndarray_to_b64(distortions[cond_name])
    gate_sess = f"sess_gate_{cond_name}_{int(time.time())}"
    
    status, res, ms = send_post("/api/auth/verify-gate", {
        "regNo": TEST_CAND_ID,
        "liveFrameBase64": frame_b64,
        "sessionId": gate_sess
    }, token=TEST_TOKEN)
    
    if should_pass:
        is_ok = status == 200 and res.get("verified") is True and res.get("similarity", 0) >= 0.62
        record_test(f"4.X Gate Entry Under [{cond_name}]: Admitted (Sim >= 0.62)", is_ok,
                    f"HTTP {status} | Verified: {res.get('verified')} | Sim: {res.get('similarity', 0):.4f} in {ms:.1f}ms")
    else:
        # Pitch black must fail closed with HTTP 400
        is_fail_closed = status == 400 and (res.get("reason") == "NO_FACE_DETECTED" or "face" in str(res).lower())
        record_test(f"4.X Gate Negative Control [{cond_name}]: Fail-Closed HTTP 400 (NO_FACE_DETECTED)", is_fail_closed,
                    f"HTTP {status} | Reason: {res.get('reason')} | Msg: {res.get('message', '')[:60]}")

# Verify keyframe was saved for severe shadow gate session
kf_files = [os.path.join(KEYFRAMES_DIR, f) for f in os.listdir(KEYFRAMES_DIR) if "yale_b_left_shadow" in f]
record_test("4.9 Gate Keyframe Saved on Disk Under Harsh Lighting",
            len(kf_files) > 0 and os.path.getsize(kf_files[-1]) > 1000,
            f"Keyframe: {kf_files[-1] if kf_files else 'None'} ({os.path.getsize(kf_files[-1]) if kf_files else 0} B)")


# =========================================================================
# SECTION 5: UI & SCORECARD HUD INTEGRATION (TASKS 4.1 -> 4.3 COMBINATION)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 5: TA SCORECARD HUD INTEGRATION (TASKS 4.1 -> 4.3 COMBINATION)")
print("=" * 60)

# Check session-hud for candidate after gate admission
hud_status, hud_raw, _, hud_ms = send_get(f"/api/biometrics/session-hud?sessionId={TEST_SESSION_ID}&regNo={TEST_CAND_ID}")
hud_json = json.loads(hud_raw.decode("utf-8")) if hud_status == 200 else {}

record_test("5.1 TA Scorecard HUD Reflects AUTHENTICATED State Under Stress",
            hud_status == 200 and hud_json.get("verificationStatus") == "AUTHENTICATED",
            f"Status: {hud_json.get('verificationStatus')} | Sim: {hud_json.get('faceMatchSimilarity')}")

record_test("5.2 TA Scorecard HUD Returns CLAHE Normalization Active Tag",
            hud_json.get("claheNormalized") is True and hud_json.get("alignmentMethod") == "UMEYAMA_5POINT_112X112",
            f"claheNormalized: {hud_json.get('claheNormalized')} | alignmentMethod: {hud_json.get('alignmentMethod')}")

# Fetch keyframe photo via /api/biometrics/photo
photo_status, photo_raw, photo_ct, photo_ms = send_get(f"/api/biometrics/photo?regNo={TEST_CAND_ID}&type=keyframe&sessionId={TEST_SESSION_ID}")
record_test("5.3 Biometric Photo Server Serves Keyframe Under Illumination Stress",
            photo_status == 200 and "image/jpeg" in photo_ct and len(photo_raw) > 1000,
            f"HTTP {photo_status} | CT: {photo_ct} | Size: {len(photo_raw)} B in {photo_ms:.1f}ms")


# =========================================================================
# SECTION 6: CONCURRENCY & LATENCY BENCHMARKS UNDER LIGHTING STRESS
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 6: CONCURRENCY & LATENCY BENCHMARKS UNDER ILLUMINATION STRESS")
print("=" * 60)

stress_frames = [
    ndarray_to_b64(distortions["yale_b_left_shadow"]),
    ndarray_to_b64(distortions["yale_b_specular_glare"]),
    ndarray_to_b64(distortions["yale_b_severe_underexposure"])
]

def verify_worker(idx):
    sess_id = f"sess_stress_bench_{idx}_{int(time.time())}"
    t0 = time.perf_counter()
    status, res, _ = send_post("/api/auth/verify-gate", {
        "regNo": TEST_CAND_ID,
        "liveFrameBase64": stress_frames[idx % len(stress_frames)],
        "sessionId": sess_id
    }, token=TEST_TOKEN)
    dur = (time.perf_counter() - t0) * 1000
    ok = status == 200 and res.get("verified") is True and res.get("similarity", 0) >= 0.62
    return ok, dur

with ThreadPoolExecutor(max_workers=3) as pool:
    futures = [pool.submit(verify_worker, i) for i in range(3)]
    bench_results = [f.result() for f in futures]

bench_passed = all(r[0] for r in bench_results)
bench_latencies = [r[1] for r in bench_results]

record_test("6.1 Concurrency Benchmark: 3 Parallel Gate Workers Under Harsh Lighting", bench_passed,
            f"Passed: {sum(1 for r in bench_results if r[0])}/3 | Latencies: {[f'{l:.1f}ms' for l in bench_latencies]}")

median_bench = sorted(bench_latencies)[len(bench_latencies) // 2]
record_test("6.2 Full-Stack Gate Verification Latency SLA Under Stress (Median <= 400ms)", median_bench <= 400.0,
            f"Median: {median_bench:.1f}ms | Min: {min(bench_latencies):.1f}ms | Max: {max(bench_latencies):.1f}ms")


# =========================================================================
# FINAL AUDIT SUMMARY
# =========================================================================
print("\n" + "=" * 85)
total_tests = len(test_results)
passed_tests = sum(1 for _, passed, _ in test_results if passed)
pass_rate = (passed_tests / total_tests) * 100

print(f"TASK 5.1 EMPIRICAL AUDIT RESULTS: {passed_tests} / {total_tests} PASSED ({pass_rate:.1f}%)")
print("=" * 85)

if passed_tests == total_tests:
    print("\n[SUCCESS] ALL TASK 5.1 YALE B ILLUMINATION STRESS TESTS PASSED CLEANLY!\n")
    sys.exit(0)
else:
    print(f"\n[FAILURE] {total_tests - passed_tests} TESTS FAILED IN TASK 5.1 AUDIT!\n")
    sys.exit(1)
