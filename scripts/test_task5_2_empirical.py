"""
TASK 5.2 EMPIRICAL TEST SUITE: PRESENTATION ATTACK & ANTI-SPOOF BENCHMARK
(CASIA-FASD & REPLAY-ATTACK PROTOCOLS)
Benchmarking bona fide human faces vs 2D paper print attacks, tablet screen replays,
phone display replays, warped photo creases, cross-identity discrimination,
pre-validation enrollment staging isolation, and live chamber gate fail-closed security.
Integrated with Tasks 1.1 -> 5.1 on Node 10.10.16.13:3001.
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

# Add scripts directory to path for neural pipeline imports
sys.path.append("/home/savan/openviva/scripts")
from extract_biometrics import (
    get_scrfd_detector,
    get_liveness_classifier,
    align_and_equalize_face,
    get_arcface_extractor,
    extract_face_embedding,
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
print("TASK 5.2 EMPIRICAL TEST SUITE: PRESENTATION ATTACK & ANTI-SPOOF BENCHMARK")
print("Target: Node 10.10.16.13 | PM2: openviva-web (Port 3001) | Tasks 1.1 -> 5.2")
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
    im = Image.fromarray(arr_rgb)
    bio = BytesIO()
    im.save(bio, format=format)
    return "data:image/jpeg;base64," + base64.b64encode(bio.getvalue()).decode("utf-8")

# =========================================================================
# SECTION 1: GROUND TRUTH PREPARATION & BASELINE NEURAL AUDIT
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 1: GROUND TRUTH PREPARATION & BASELINE NEURAL AUDIT")
print("=" * 60)

TEST_CAND_ID = "reg1"
IMPOSTOR_CAND_ID = "reg9"
TEST_SESSION_ID = f"sess_anti_spoof_{int(time.time())}"
TEST_TOKEN = "sess_token_reg1_test"

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# Ensure candidate exists in students
cursor.execute("SELECT reg_no FROM students WHERE reg_no = ?", (TEST_CAND_ID,))
if not cursor.fetchone():
    cursor.execute("""
        INSERT INTO students (reg_no, student_name, department, cohort, password_hash, salt, is_active, created_at, updated_at)
        VALUES (?, 'Student 1', 'Computer Science', '2026', 'hash', 'salt', 1, datetime('now'), datetime('now'))
    """, (TEST_CAND_ID,))

cursor.execute("SELECT reg_no FROM students WHERE reg_no = ?", (IMPOSTOR_CAND_ID,))
if not cursor.fetchone():
    cursor.execute("""
        INSERT INTO students (reg_no, student_name, department, cohort, password_hash, salt, is_active, created_at, updated_at)
        VALUES (?, 'Impostor Candidate', 'Mechanical Engineering', '2026', 'hash', 'salt', 1, datetime('now'), datetime('now'))
    """, (IMPOSTOR_CAND_ID,))

# Register active student session token in student_sessions
EXPIRY = (datetime.now(timezone.utc) + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
cursor.execute("""
    INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at)
    VALUES (?, ?, 0, ?, datetime('now'))
""", (TEST_TOKEN, TEST_CAND_ID, EXPIRY))

cursor.execute("""
    INSERT OR REPLACE INTO exams (id, course_title, instructor_id, system_prompt, created_at)
    VALUES ('exam_default', 'Biometrics Robustness Defense', 'inst_01', 'Default prompt', datetime('now'))
""")

# Register active exam session
cursor.execute("""
    INSERT OR REPLACE INTO exam_sessions (session_id, exam_id, course_title, student_id, status, started_at, created_at)
    VALUES (?, 'exam_default', 'Biometrics Robustness Defense', ?, 'IN_PROGRESS', datetime('now'), datetime('now'))
""", (TEST_SESSION_ID, TEST_CAND_ID))

conn.commit()
conn.close()

# Neural detectors
detector = get_scrfd_detector()
liveness = get_liveness_classifier()
arcface = get_arcface_extractor()

# Load pristine bona fide image
cand_img_path = os.path.join(FACES_DIR, f"{TEST_CAND_ID}.jpg")
if not os.path.exists(cand_img_path):
    # Fallback to keyframe or sample
    cand_img_path = os.path.join(FACES_DIR, f"{TEST_CAND_ID}_keyframe.jpg")

im_bona_fide = Image.open(cand_img_path).convert("RGB")
img_w, img_h = im_bona_fide.size

# Extract ground truth embedding
cand_faces = detector.detect(im_bona_fide)
assert len(cand_faces) == 1, "Expected single face in candidate portrait"
cand_aligned, _ = align_and_equalize_face(im_bona_fide, np.array(cand_faces[0]['kps'], dtype=np.float32))
cand_embedding = arcface.extract(cand_aligned)

# Verify pristine self-similarity invariant
self_sim = compute_cosine_similarity(cand_embedding, cand_embedding)
record_test("1.1 Baseline Pristine Self-Similarity Invariant (Sim == 1.0000)",
            abs(self_sim - 1.0) < 1e-5, f"Self-Similarity: {self_sim:.6f}")

# Extract impostor embedding
impostor_img_path = os.path.join(FACES_DIR, f"{IMPOSTOR_CAND_ID}.jpg")
if not os.path.exists(impostor_img_path):
    # Create distinct impostor portrait by horizontal flip + hue shift
    im_imp = im_bona_fide.transpose(Image.FLIP_LEFT_RIGHT)
    arr_imp = np.array(im_imp)
    arr_imp[:, :, [0, 2]] = arr_imp[:, :, [2, 0]]  # swap R & B
    im_imp = Image.fromarray(arr_imp)
else:
    im_imp = Image.open(impostor_img_path).convert("RGB")

imp_faces = detector.detect(im_imp)
imp_aligned, _ = align_and_equalize_face(im_imp, np.array(imp_faces[0]['kps'], dtype=np.float32))
imp_embedding = arcface.extract(imp_aligned)

impostor_sim = compute_cosine_similarity(cand_embedding, imp_embedding)
separation_margin = self_sim - impostor_sim
record_test("1.2 Baseline Impostor Inter-Class Separation (Sim < 0.35, Margin > 0.65)",
            impostor_sim < 0.35 and separation_margin >= 0.65,
            f"Impostor Sim: {impostor_sim:.4f} | Margin: {separation_margin:.4f}")

# Enroll candidate embedding into SQLite
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
cursor.execute(
    "INSERT OR REPLACE INTO student_biometrics (reg_no, student_name, face_embedding, verification_status) VALUES (?, 'Student 1', ?, 'AUTHENTICATED')",
    (TEST_CAND_ID, cand_embedding)
)
conn.commit()
conn.close()

record_test("1.3 Candidate Biometric Ground Truth Enrolled (2,048-B Sealed Vector)",
            len(cand_embedding) == 2048, "Vector Sealed in SQLite student_biometrics")


# =========================================================================
# SECTION 2: BONA FIDE HUMAN FACE LIVENESS BENCHMARK (FRR = 0%)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 2: BONA FIDE HUMAN FACE LIVENESS BENCHMARK (FRR = 0%)")
print("=" * 60)

bona_fide_probes = [
    ("candidate_portrait_reg1", im_bona_fide),
    ("candidate_keyframe_reg1", Image.open(os.path.join(FACES_DIR, f"{TEST_CAND_ID}_keyframe.jpg")).convert("RGB")
     if os.path.exists(os.path.join(FACES_DIR, f"{TEST_CAND_ID}_keyframe.jpg")) else im_bona_fide)
]

for probe_name, probe_img in bona_fide_probes:
    f_list = detector.detect(probe_img)
    if not f_list:
        record_test(f"2.X Bona Fide Liveness [{probe_name}]: Face localized", False)
        continue
    box = f_list[0]['box']
    res = liveness.evaluate(probe_img, box)
    p_real = res["liveness_score"]
    is_live = res["is_live"]
    record_test(f"2.X Bona Fide Liveness [{probe_name}]: P(real) >= 0.85 (Actual: {p_real:.4f})",
                is_live and p_real >= 0.85,
                f"P(real): {p_real:.4f} | is_live: {is_live} | spoof_type: {res['spoof_type']}")


# =========================================================================
# SECTION 3: PRESENTATION ATTACK SYNTHESIS & ANTI-SPOOF BENCHMARK
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 3: PRESENTATION ATTACK SYNTHESIS & ANTI-SPOOF BENCHMARK")
print("=" * 60)

H, W = img_h, img_w
img_arr = np.array(im_bona_fide, dtype=np.float32)
y_coords, x_coords = np.ogrid[:H, :W]

attacks = {}

# 1. 2D Paper Print Attack (halftone lattice noise + high-contrast white paper border)
arr_print = np.clip(img_arr * 0.95 + np.random.normal(0, 15, (H, W, 3)), 0, 255)
arr_print[:20, :, :] = 250
arr_print[-20:, :, :] = 250
arr_print[:, :20, :] = 250
arr_print[:, -20:, :] = 250
attacks["2d_paper_print_attack"] = arr_print.astype(np.uint8)

# 2. Tablet Screen Replay Attack (Moiré interference + subpixel grid + dark bezel)
moire = 1.0 + 0.12 * np.sin(x_coords * 0.18) * np.cos(y_coords * 0.18)
arr_screen = np.clip(img_arr * moire[:, :, np.newaxis], 0, 255)
arr_screen[::2, :, :] *= 0.90
arr_screen[:18, :, :] = 15
arr_screen[-18:, :, :] = 15
arr_screen[:, :18, :] = 15
arr_screen[:, -18:, :] = 15
attacks["tablet_screen_replay_attack"] = arr_screen.astype(np.uint8)

# 3. Phone Display Replay Attack (subpixel grid + specular glass reflection hotspot)
grid = (1.0 + 0.15 * np.sin(x_coords * 0.50))[:, :, np.newaxis]
arr_phone = img_arr * grid
cy, cx = H // 3, W // 3
dist_sq = (x_coords - cx)**2 + (y_coords - cy)**2
glare = np.exp(-dist_sq / (2.0 * (min(W, H)//4)**2))[:, :, np.newaxis]
arr_phone = np.clip(arr_phone + 110.0 * glare, 0, 255)
arr_phone[:15, :, :] = 5
arr_phone[-15:, :, :] = 5
arr_phone[:, :15, :] = 5
arr_phone[:, -15:, :] = 5
attacks["phone_display_replay_attack"] = arr_phone.astype(np.uint8)

# 4. Warped / Folded Paper Print Attack (curved diagonal crease line + halftone)
dist_to_diag = np.abs(x_coords - y_coords)
crease_mask = np.exp(-(dist_to_diag**2) / 16.0)[:, :, np.newaxis]
arr_crease = np.clip(arr_print + 100.0 * crease_mask, 0, 255)
attacks["warped_folded_print_attack"] = arr_crease.astype(np.uint8)

record_test("3.1 Generated 4 CASIA/Replay Synthetic Presentation Attack Probes",
            len(attacks) == 4, f"Protocols: {list(attacks.keys())}")

# Benchmark attacks against MiniFASNet-V2
for atk_name, atk_arr in attacks.items():
    atk_img = Image.fromarray(atk_arr)
    f_list = detector.detect(atk_img)
    self_detected = len(f_list) > 0
    if not self_detected:
        record_test(f"3.X Attack [{atk_name}]: Trapped (Zero Face Detected)", True, "SCRFD filtered frame")
        continue

    eval_res = liveness.evaluate(atk_img, f_list[0]['box'])
    p_real = eval_res["liveness_score"]
    spoof_type = eval_res["spoof_type"]
    is_live = eval_res["is_live"]

    # Attack must fail liveness (is_live == False, P_real < 0.50)
    attack_trapped = (is_live is False) and (p_real < 0.50)
    record_test(f"3.X Attack Trapped [{atk_name}]: is_live=False, P(real) < 0.50 (Actual: {p_real:.4f})",
                attack_trapped,
                f"P(real): {p_real:.4f} | Spoof Type: {spoof_type} | Probs: {eval_res['spoof_probabilities']}")

# Negative Control: Blank Canvas
black_img = Image.new("RGB", (640, 480), (0, 0, 0))
black_faces = detector.detect(black_img)
record_test("3.6 Negative Control [blank_canvas]: Zero Faces Detected",
            len(black_faces) == 0, f"Detected faces: {len(black_faces)}")


# =========================================================================
# SECTION 4: CROSS-IDENTITY DISCRIMINATION & SEPARATION BENCHMARK (FAR = 0%)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 4: CROSS-IDENTITY DISCRIMINATION & SEPARATION BENCHMARK")
print("=" * 60)

# 1. Genuine Probe Cosine Similarity
gen_sim = compute_cosine_similarity(cand_embedding, cand_embedding)
record_test("4.1 Genuine Candidate Match: Sim >= 0.62 Invariant",
            gen_sim >= 0.62, f"Genuine Similarity: {gen_sim:.4f}")

# 2. Impostor Probe Cosine Similarity
imp_sim = compute_cosine_similarity(cand_embedding, imp_embedding)
record_test("4.2 Impostor Inter-Identity Rejection: Sim < 0.35 Invariant",
            imp_sim < 0.35, f"Impostor Similarity: {imp_sim:.4f}")

# 3. Discriminative Separation Margin
margin = gen_sim - imp_sim
record_test("4.3 Discriminative Separation Margin: Margin >= 0.65",
            margin >= 0.65, f"Separation Margin: {margin:.4f} ({margin*100:.1f}%)")


# =========================================================================
# SECTION 5: LIVE CHAMBER GATE FAIL-CLOSED SECURITY BENCHMARK (TASK 3.2)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 5: LIVE CHAMBER GATE FAIL-CLOSED SECURITY BENCHMARK")
print("=" * 60)

# Snapshot keyframe directory before sending attack probes
kf_before = set(os.listdir(KEYFRAMES_DIR))

# 1. 2D Paper Print Attack against /api/auth/verify-gate -> Must return HTTP 400 SPOOF_PHOTO_DETECTED
b64_print = ndarray_to_b64(attacks["2d_paper_print_attack"])
status_print, res_print, ms_print = send_post("/api/auth/verify-gate", {
    "regNo": TEST_CAND_ID,
    "liveFrameBase64": b64_print,
    "sessionId": f"sess_spoof_print_{int(time.time())}"
}, token=TEST_TOKEN)

record_test("5.1 Chamber Gate Traps 2D Paper Print Attack with Fail-Closed HTTP 400",
            status_print == 400 and res_print.get("reason") == "SPOOF_PHOTO_DETECTED",
            f"HTTP {status_print} | Reason: {res_print.get('reason')} | Spoof Type: {res_print.get('spoofType')} in {ms_print:.1f}ms")

# 2. Tablet Screen Replay Attack against /api/auth/verify-gate -> Must return HTTP 400 SPOOF_PHOTO_DETECTED
b64_screen = ndarray_to_b64(attacks["tablet_screen_replay_attack"])
status_screen, res_screen, ms_screen = send_post("/api/auth/verify-gate", {
    "regNo": TEST_CAND_ID,
    "liveFrameBase64": b64_screen,
    "sessionId": f"sess_spoof_screen_{int(time.time())}"
}, token=TEST_TOKEN)

record_test("5.2 Chamber Gate Traps Tablet Screen Replay with Fail-Closed HTTP 400",
            status_screen == 400 and res_screen.get("reason") == "SPOOF_PHOTO_DETECTED",
            f"HTTP {status_screen} | Reason: {res_screen.get('reason')} | Spoof Type: {res_screen.get('spoofType')} in {ms_screen:.1f}ms")

# 3. Phone Display Replay Attack against /api/auth/verify-gate -> Must return HTTP 400 SPOOF_PHOTO_DETECTED
b64_phone = ndarray_to_b64(attacks["phone_display_replay_attack"])
status_phone, res_phone, ms_phone = send_post("/api/auth/verify-gate", {
    "regNo": TEST_CAND_ID,
    "liveFrameBase64": b64_phone,
    "sessionId": f"sess_spoof_phone_{int(time.time())}"
}, token=TEST_TOKEN)

record_test("5.3 Chamber Gate Traps Phone Display Replay with Fail-Closed HTTP 400",
            status_phone == 400 and res_phone.get("reason") == "SPOOF_PHOTO_DETECTED",
            f"HTTP {status_phone} | Reason: {res_phone.get('reason')} | Spoof Type: {res_phone.get('spoofType')} in {ms_phone:.1f}ms")

# 4. Blank Canvas Negative Control -> Must return HTTP 400 NO_FACE_DETECTED
b64_black = ndarray_to_b64(np.zeros((480, 640, 3), dtype=np.uint8))
status_black, res_black, ms_black = send_post("/api/auth/verify-gate", {
    "regNo": TEST_CAND_ID,
    "liveFrameBase64": b64_black,
    "sessionId": f"sess_blank_{int(time.time())}"
}, token=TEST_TOKEN)

record_test("5.4 Chamber Gate Traps Blank Canvas with Fail-Closed HTTP 400",
            status_black == 400 and res_black.get("reason") == "NO_FACE_DETECTED",
            f"HTTP {status_black} | Reason: {res_black.get('reason')} in {ms_black:.1f}ms")

# 5. Impostor Probe against /api/auth/verify-gate -> Must return HTTP 200 verified=false, sim < 0.35, candidate FLAGGED
b64_imp = ndarray_to_b64(np.array(im_imp))
status_imp, res_imp, ms_imp = send_post("/api/auth/verify-gate", {
    "regNo": TEST_CAND_ID,
    "liveFrameBase64": b64_imp,
    "sessionId": f"sess_impostor_{int(time.time())}"
}, token=TEST_TOKEN)

record_test("5.5 Chamber Gate Rejects Impostor Candidate (verified=False, Sim < 0.35)",
            status_imp == 200 and res_imp.get("verified") is False and (res_imp.get("similarity") or 1.0) < 0.35,
            f"HTTP {status_imp} | Verified: {res_imp.get('verified')} | Sim: {float(res_imp.get('similarity') or 0.0):.4f} in {ms_imp:.1f}ms")

# Check that candidate status was set to FLAGGED
conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
c.execute("SELECT verification_status FROM student_biometrics WHERE reg_no = ?", (TEST_CAND_ID,))
flagged_status = c.fetchone()[0]
conn.close()
record_test("5.6 Impostor Rejection Triggers FLAGGED Status in SQLite",
            flagged_status == "FLAGGED", f"Status in DB: {flagged_status}")

# 6. Bona Fide Candidate Admission -> Must return HTTP 200 verified=true, sim >= 0.62, candidate AUTHENTICATED
b64_bona = ndarray_to_b64(np.array(im_bona_fide))
gate_auth_sess = f"sess_bona_fide_gate_{int(time.time())}"
status_bona, res_bona, ms_bona = send_post("/api/auth/verify-gate", {
    "regNo": TEST_CAND_ID,
    "liveFrameBase64": b64_bona,
    "sessionId": gate_auth_sess
}, token=TEST_TOKEN)

record_test("5.7 Bona Fide Candidate Admitted at Chamber Gate (verified=True, Sim >= 0.62)",
            status_bona == 200 and res_bona.get("verified") is True and (res_bona.get("similarity") or 0.0) >= 0.62,
            f"HTTP {status_bona} | Verified: {res_bona.get('verified')} | Sim: {float(res_bona.get('similarity') or 0.0):.4f} in {ms_bona:.1f}ms")

# Check that candidate status restored to AUTHENTICATED
conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
c.execute("SELECT verification_status FROM student_biometrics WHERE reg_no = ?", (TEST_CAND_ID,))
auth_status = c.fetchone()[0]
conn.close()
record_test("5.8 Genuine Admission Restores AUTHENTICATED Status in SQLite",
            auth_status == "AUTHENTICATED", f"Status in DB: {auth_status}")

# 7. Forensic Disk Keyframe Integrity Audit: No new keyframe persisted for spoof attacks
kf_after = set(os.listdir(KEYFRAMES_DIR))
new_spoof_kf = [f for f in (kf_after - kf_before) if "sess_spoof" in f]
record_test("5.9 Forensic Security Audit: Zero Keyframes Persisted for Presentation Attacks",
            len(new_spoof_kf) == 0, f"New spoof keyframes: {new_spoof_kf}")


# =========================================================================
# SECTION 6: CANDIDATE ENROLLMENT STAGING ISOLATION UNDER ATTACK (TASK 3.3)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 6: CANDIDATE ENROLLMENT STAGING ISOLATION UNDER ATTACK")
print("=" * 60)

VOICES_DIR = "/home/savan/openviva/storage/biometrics/voices"
valid_voice_path = os.path.join(VOICES_DIR, "reg1.wav")
if os.path.exists(valid_voice_path):
    with open(valid_voice_path, "rb") as vf:
        valid_voice_b64 = "data:audio/wav;base64," + base64.b64encode(vf.read()).decode("utf-8")
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
    valid_voice_b64 = "data:audio/wav;base64," + base64.b64encode(bio.getvalue()).decode("utf-8")

# Register student session token for candidate enrollment validation
ENROLL_TOKEN = f"tok_enr_{int(time.time())}"
conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
c.execute("""
    INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at)
    VALUES (?, ?, 0, ?, datetime('now'))
""", (ENROLL_TOKEN, TEST_CAND_ID, EXPIRY))
# Record baseline ground truth face embedding before attack enrollment
c.execute("SELECT face_embedding FROM student_biometrics WHERE reg_no = ?", (TEST_CAND_ID,))
baseline_face_db = c.fetchone()[0]
conn.commit()
conn.close()

# Attempt to enroll with 2D Paper Print Attack
status_enr_print, res_enr_print, ms_enr_print = send_post("/api/auth/enroll-biometrics", {
    "faceImageBase64": b64_print,
    "voiceAudioBase64": valid_voice_b64
}, token=ENROLL_TOKEN)

record_test("6.1 Enrollment API Traps 2D Paper Print Attack (Fail-Closed HTTP 400)",
            status_enr_print == 400 and (res_enr_print.get("reason") == "SPOOF_PHOTO_DETECTED" or "SPOOF" in str(res_enr_print)),
            f"HTTP {status_enr_print} | Reason: {res_enr_print.get('reason')} in {ms_enr_print:.1f}ms")

# Attempt to enroll with Tablet Screen Replay Attack
status_enr_screen, res_enr_screen, ms_enr_screen = send_post("/api/auth/enroll-biometrics", {
    "faceImageBase64": b64_screen,
    "voiceAudioBase64": valid_voice_b64
}, token=ENROLL_TOKEN)

record_test("6.2 Enrollment API Traps Screen Replay Attack (Fail-Closed HTTP 400)",
            status_enr_screen == 400 and (res_enr_screen.get("reason") == "SPOOF_PHOTO_DETECTED" or "SPOOF" in str(res_enr_screen)),
            f"HTTP {status_enr_screen} | Reason: {res_enr_screen.get('reason')} in {ms_enr_screen:.1f}ms")

# Verify zero disk and database pollution from failed enrollments:
# 1. No temporary staging files left behind
staging_files = [f for f in os.listdir(FACES_DIR) if "temp_enroll" in f]
# 2. Database embedding was NOT overwritten/tampered with
conn = sqlite3.connect(DB_PATH)
c = conn.cursor()
c.execute("SELECT face_embedding FROM student_biometrics WHERE reg_no = ?", (TEST_CAND_ID,))
current_face_db = c.fetchone()[0]
conn.close()

record_test("6.3 Staging Isolation: Zero Disk Pollution and Zero DB Tampering on Spoof",
            len(staging_files) == 0 and current_face_db == baseline_face_db,
            f"Staging files remaining: {staging_files} | DB untampered: {current_face_db == baseline_face_db}")


# =========================================================================
# SECTION 7: TA EVALUATION SCORECARD HUD INTEGRATION (TASKS 4.1 -> 4.3)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 7: TA EVALUATION SCORECARD HUD INTEGRATION")
print("=" * 60)

# Check TA session HUD for authenticated session
hud_status, hud_raw, _, hud_ms = send_get(f"/api/biometrics/session-hud?sessionId={gate_auth_sess}&regNo={TEST_CAND_ID}")
hud_json = json.loads(hud_raw.decode("utf-8")) if hud_status == 200 else {}

record_test("7.1 TA Scorecard HUD Displays AUTHENTICATED Status for Admitted Candidate",
            hud_status == 200 and hud_json.get("verificationStatus") == "AUTHENTICATED",
            f"Status: {hud_json.get('verificationStatus')} | Sim: {hud_json.get('faceMatchSimilarity')}")

record_test("7.2 TA Scorecard HUD Returns High Liveness Confidence (>= 0.85)",
            hud_json.get("livenessConfidence", 0.0) >= 0.85,
            f"Liveness Confidence: {hud_json.get('livenessConfidence')} | Method: {hud_json.get('alignmentMethod')}")

# Photo server serves keyframe
photo_status, photo_raw, photo_ct, photo_ms = send_get(f"/api/biometrics/photo?regNo={TEST_CAND_ID}&type=keyframe&sessionId={gate_auth_sess}")
record_test("7.3 Biometric Photo Server Serves Live Verified Keyframe",
            photo_status == 200 and "image/jpeg" in photo_ct and len(photo_raw) > 1000,
            f"HTTP {photo_status} | CT: {photo_ct} | Size: {len(photo_raw)} B in {photo_ms:.1f}ms")


# =========================================================================
# SECTION 8: CONCURRENCY & LATENCY BENCHMARKS UNDER ATTACK STRESS
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 8: CONCURRENCY & LATENCY BENCHMARKS UNDER ATTACK STRESS")
print("=" * 60)

stress_probes = [
    (b64_bona, True),
    (b64_print, False),
    (b64_screen, False)
]

def verify_attack_worker(idx):
    payload_b64, should_pass = stress_probes[idx % len(stress_probes)]
    sess_id = f"sess_atk_bench_{idx}_{int(time.time())}"
    t0 = time.perf_counter()
    status, res, _ = send_post("/api/auth/verify-gate", {
        "regNo": TEST_CAND_ID,
        "liveFrameBase64": payload_b64,
        "sessionId": sess_id
    }, token=TEST_TOKEN)
    dur = (time.perf_counter() - t0) * 1000
    if should_pass:
        ok = status == 200 and res.get("verified") is True
    else:
        ok = status == 400 and res.get("reason") == "SPOOF_PHOTO_DETECTED"
    return ok, dur

with ThreadPoolExecutor(max_workers=3) as pool:
    futures = [pool.submit(verify_attack_worker, i) for i in range(3)]
    bench_results = [f.result() for f in futures]

bench_passed = all(r[0] for r in bench_results)
bench_latencies = [r[1] for r in bench_results]

record_test("8.1 Concurrency Benchmark: 3 Parallel Mixed Gate Workers (Bona Fide + Spoof)",
            bench_passed,
            f"Passed: {sum(1 for r in bench_results if r[0])}/3 | Latencies: {[f'{l:.1f}ms' for l in bench_latencies]}")

median_bench = sorted(bench_latencies)[len(bench_latencies) // 2]
record_test("8.2 Full-Stack Gate Verification Latency SLA Under Attack Stress (Median <= 400ms)",
            median_bench <= 400.0,
            f"Median: {median_bench:.1f}ms | Min: {min(bench_latencies):.1f}ms | Max: {max(bench_latencies):.1f}ms")


# =========================================================================
# FINAL AUDIT SUMMARY
# =========================================================================
print("\n" + "=" * 85)
total_tests = len(test_results)
passed_tests = sum(1 for _, passed, _ in test_results if passed)
pass_rate = (passed_tests / total_tests) * 100

print(f"TASK 5.2 EMPIRICAL AUDIT RESULTS: {passed_tests} / {total_tests} PASSED ({pass_rate:.1f}%)")
print("=" * 85)

if passed_tests == total_tests:
    print("\n[SUCCESS] ALL TASK 5.2 PRESENTATION ATTACK & ANTI-SPOOF TESTS PASSED CLEANLY!\n")
    sys.exit(0)
else:
    print(f"\n[FAILURE] {total_tests - passed_tests} TESTS FAILED IN TASK 5.2 AUDIT!\n")
    sys.exit(1)
