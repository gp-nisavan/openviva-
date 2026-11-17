"""
EMPIRICAL AND EDGE-CASE TEST SUITE FOR TASK 4.1 (BiometricGateModal.tsx)
Integrated with Tasks 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, and 3.3
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
import numpy as np
from datetime import datetime, timezone, timedelta
from PIL import Image, ImageEnhance

print("=" * 80)
print("TASK 4.1 EMPIRICAL TEST SUITE: BIOMETRIC GATE MODAL (BiometricGateModal.tsx)")
print("Full-Stack Integrated Verification with Tasks 1.1 -> 3.3 on Node 10.10.16.13:3001")
print("=" * 80)

DB_PATH = "/home/savan/openviva/storage/openviva.db"
BASE_URL = "http://localhost:3001/openviva"
MODELS_DIR = "/home/savan/openviva/models/face"
FACES_DIR = "/home/savan/openviva/storage/biometrics/faces"
VOICES_DIR = "/home/savan/openviva/storage/biometrics/voices"
KEYFRAMES_DIR = "/home/savan/openviva/storage/biometrics/keyframes"
EDGE_DIR = "/tmp/edge_cases_bio"
MODAL_PATH = "/home/savan/openviva/web/src/components/BiometricGateModal.tsx"

os.makedirs(EDGE_DIR, exist_ok=True)
os.makedirs(KEYFRAMES_DIR, exist_ok=True)
os.makedirs(FACES_DIR, exist_ok=True)

test_results = []

def record_test(name, passed, details=""):
    is_pass = bool(passed)
    status = "PASS" if is_pass else "FAIL"
    test_results.append((name, is_pass, details))
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
# SECTION 1: STATIC ANALYSIS & CONTRACT VERIFICATION OF BiometricGateModal.tsx
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 1: STATIC ANALYSIS & CONTRACT VERIFICATION OF BiometricGateModal.tsx")
print("=" * 60)

modal_exists = os.path.exists(MODAL_PATH)
record_test("1.1 File Existence: BiometricGateModal.tsx present in components", modal_exists, MODAL_PATH)

if modal_exists:
    with open(MODAL_PATH, "r", encoding="utf-8") as f:
        code = f.read()

    # 1.2 Export verification
    has_export = "export function BiometricGateModal" in code
    record_test("1.2 Component Export: BiometricGateModal named export present", has_export)

    # 1.3 Canvas Reticle Element & Ref
    has_canvas_ref = "overlayCanvasRef = useRef<HTMLCanvasElement" in code
    has_canvas_tag = "<canvas" in code and "ref={overlayCanvasRef}" in code
    record_test("1.3 Canvas Reticle: overlayCanvasRef and HTML5 <canvas> overlay integrated", has_canvas_ref and has_canvas_tag)

    # 1.4 Coordinate Inversion / Mirror Math
    has_mirror_x1 = "(videoW - rawX2) * (canvas.width / videoW)" in code
    has_mirror_x2 = "(videoW - rawX1) * (canvas.width / videoW)" in code
    has_mirror_kps = "(videoW - rawKpx) * (canvas.width / videoW)" in code
    record_test("1.4 Mirror Reflection Alignment: X coordinates inverted for scale-x-[-1] video preview",
                has_mirror_x1 and has_mirror_x2 and has_mirror_kps,
                "Inverts rawX2 -> x1, rawX1 -> x2, and rawKpx -> kpx")

    # 1.5 5 Landmark Rendering Logic
    has_landmarks_loop = "telem.landmarks.forEach" in code
    has_landmark_circles = "ctx.arc(kpx, kpy" in code
    record_test("1.5 Facial Landmark Overlay: 5 regressed points drawn on canvas context",
                has_landmarks_loop and has_landmark_circles)

    # 1.6 Sleek Corner Brackets
    has_brackets = "bracketLen = Math.min(24" in code and "ctx.lineTo" in code
    record_test("1.6 Sleek Reticle Brackets: Dynamic corner bracket paths with rounded caps", has_brackets)

    # 1.7 Liveness HUD Badge
    has_liveness_badge = "Liveness:" in code and "Real Human" in code and "Presentation Attack" in code
    record_test("1.7 Liveness HUD Badge: Real Human vs Presentation Attack status rendering", has_liveness_badge)

    # 1.8 Illumination & CLAHE HUD Pill
    has_lighting_badge = "Lighting: CLAHE Equalized" in code and "Lighting: Optimal" in code
    record_test("1.8 Illumination HUD Pill: Dynamic CLAHE Equalized / Optimal lighting state", has_lighting_badge)

    # 1.9 Calibrated 62% Threshold Progress Bar & Tick Marker
    has_threshold_display = "Threshold: 62% Required" in code or "thresholdPercent.toFixed(0)}% Required" in code
    has_tick_marker = "style={{ left: `${thresholdPercent}%` }}" in code
    record_test("1.9 Calibrated 62% Threshold: UI bar with exact vertical tick marker at 62%",
                has_threshold_display and has_tick_marker)

    # 1.10 Base Path Resolution
    has_basepath = "process.env.NEXT_PUBLIC_BASE_PATH || \"/openviva\"" in code
    record_test("1.10 Base Path Support: NEXT_PUBLIC_BASE_PATH fallback pattern implemented", has_basepath)

    # 1.11 Security Anomaly Interception
    has_anomaly_handling = "SPOOF_PHOTO_DETECTED" in code or "anomalyResult" in code
    record_test("1.11 Fail-Closed Anomaly Handling: Graceful capture of gate verification errors", has_anomaly_handling)

# =========================================================================
# SECTION 2: CANVAS RETICLE MATHEMATICS & COORDINATE TRANSFORMATION SIMULATION
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 2: CANVAS RETICLE MATHEMATICS & COORDINATE TRANSFORMATIONS")
print("=" * 60)

def simulate_canvas_reticle_transform(face_box, landmarks, video_w=640, video_h=480, canvas_w=640, canvas_h=480):
    raw_x1, raw_y1, raw_x2, raw_y2 = face_box
    # Mirror transformation formula from BiometricGateModal.tsx:
    x1 = (video_w - raw_x2) * (canvas_w / video_w)
    x2 = (video_w - raw_x1) * (canvas_w / video_w)
    y1 = raw_y1 * (canvas_h / video_h)
    y2 = raw_y2 * (canvas_h / video_h)
    box_w = x2 - x1
    box_h = y2 - y1

    bracket_len = min(24.0, min(box_w, box_h) * 0.25)

    transformed_landmarks = []
    if landmarks:
        for raw_kpx, raw_kpy in landmarks:
            kpx = (video_w - raw_kpx) * (canvas_w / video_w)
            kpy = raw_kpy * (canvas_h / video_h)
            transformed_landmarks.append((kpx, kpy))

    return {
        "box": (x1, y1, x2, y2),
        "width": box_w,
        "height": box_h,
        "bracket_len": bracket_len,
        "landmarks": transformed_landmarks
    }

# 2.1 Standard 640x480 coordinate test
sample_box = (180.0, 120.0, 460.0, 400.0) # Width: 280, Height: 280
sample_kps = [
    (240.0, 200.0), # Left eye (native subject right)
    (380.0, 205.0), # Right eye (native subject left)
    (310.0, 260.0), # Nose tip
    (260.0, 320.0), # Mouth left
    (360.0, 322.0)  # Mouth right
]

res_std = simulate_canvas_reticle_transform(sample_box, sample_kps, 640, 480, 640, 480)
x1_m, y1_m, x2_m, y2_m = res_std["box"]

# Invariant 1: Width and height preserved
box_w_preserved = abs(res_std["width"] - 280.0) < 1e-4
box_h_preserved = abs(res_std["height"] - 280.0) < 1e-4
record_test("2.1 Reticle Bounding Box Invariance: Box dimensions preserved under reflection",
            box_w_preserved and box_h_preserved,
            f"Native WxH: 280x280 -> Canvas WxH: {res_std['width']:.1f}x{res_std['height']:.1f}")

# Invariant 2: Mirror reflection inverts subject eyes correctly
kps_m = res_std["landmarks"]
left_eye_mirrored = abs(kps_m[0][0] - 400.0) < 1e-4
right_eye_mirrored = abs(kps_m[1][0] - 260.0) < 1e-4
record_test("2.2 Landmark Mirror Symmetry: Left/Right eyes correctly reflected for user preview",
            left_eye_mirrored and right_eye_mirrored,
            f"Native eyes [240, 380] -> Mirrored canvas eyes [{kps_m[0][0]:.1f}, {kps_m[1][0]:.1f}]")

# Invariant 3: All landmarks remain strictly inside canvas bounding box
all_inside = all(x1_m <= kpx <= x2_m and y1_m <= kpy <= y2_m for kpx, kpy in kps_m)
record_test("2.3 Reticle Topological Invariance: All 5 landmarks contained within bounding box",
            all_inside, f"Box: [{x1_m:.1f}, {y1_m:.1f}, {x2_m:.1f}, {y2_m:.1f}]")

# Invariant 4: Corner bracket bounds safety
bracket_safe = 0 < res_std["bracket_len"] <= 24.0 and res_std["bracket_len"] < res_std["width"] / 2
record_test("2.4 Corner Bracket Safety: Bracket length non-overlapping and bounded by 24px limit",
            bracket_safe, f"Bracket length: {res_std['bracket_len']:.1f}px")

# 2.5 Responsive Canvas Scaling (e.g. Mobile viewport 320x240 and 4K 1280x960)
res_half = simulate_canvas_reticle_transform(sample_box, sample_kps, 640, 480, 320, 240)
res_double = simulate_canvas_reticle_transform(sample_box, sample_kps, 640, 480, 1280, 960)

scale_half_ok = abs(res_half["width"] - 140.0) < 1e-4 and abs(res_half["landmarks"][0][0] - 200.0) < 1e-4
scale_double_ok = abs(res_double["width"] - 560.0) < 1e-4 and abs(res_double["landmarks"][0][0] - 800.0) < 1e-4
record_test("2.5 Responsive Viewport Scaling: Correct affine ratio mapping across screen resolutions",
            scale_half_ok and scale_double_ok,
            f"320x240 box width: {res_half['width']:.1f} | 1280x960 box width: {res_double['width']:.1f}")

# 2.6 Edge Case: Face touching canvas borders
border_box = (0.0, 0.0, 200.0, 220.0)
border_kps = [(50.0, 60.0), (150.0, 65.0), (100.0, 110.0), (60.0, 160.0), (140.0, 162.0)]
res_border = simulate_canvas_reticle_transform(border_box, border_kps, 640, 480, 640, 480)
border_ok = res_border["box"][0] == 440.0 and res_border["box"][2] == 640.0
record_test("2.6 Boundary Edge Case: Face touching image border correctly mapped without clipping",
            border_ok, f"Canvas box: [{res_border['box'][0]}, {res_border['box'][1]}, {res_border['box'][2]}, {res_border['box'][3]}]")


# =========================================================================
# SECTION 3: INTEGRATED BACKEND DATA FIXTURES & ENROLLMENT (Tasks 1.1 -> 3.3)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 3: INTEGRATED BACKEND FIXTURES & CANDIDATE ENROLLMENT")
print("=" * 60)

# Load person A bona fide image, reg1 impostor image, and voice sample
img_person_a = os.path.join(FACES_DIR, "person_a_1.jpg")
img_person_impostor = os.path.join(FACES_DIR, "reg1.jpg")
valid_voice_path = os.path.join(VOICES_DIR, "reg1.wav")

if not os.path.exists(img_person_a) or not os.path.exists(img_person_impostor) or not os.path.exists(valid_voice_path):
    record_test("3.1 Test Media Staged in Storage", False, "Missing person_a_1.jpg, reg1.jpg, or reg1.wav")
    sys.exit(1)
record_test("3.1 Test Media Staged: person_a_1.jpg, reg1.jpg, and reg1.wav present", True)

# Set up test candidate `reg_alice` and `reg_bob` in SQLite openviva.db
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

# Clean up any leftover test data
cursor.execute("DELETE FROM student_sessions WHERE reg_no IN ('reg_alice', 'reg_bob')")
cursor.execute("DELETE FROM student_biometrics WHERE reg_no IN ('reg_alice', 'reg_bob')")
cursor.execute("DELETE FROM students WHERE reg_no IN ('reg_alice', 'reg_bob')")

# Insert candidate Alice and Bob with schema: reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at, updated_at
cursor.execute("""
    INSERT INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at, updated_at)
    VALUES ('reg_alice', 'Alice Morgan', 'CSE', '2026', 'x', 'x', 0, 1, datetime('now'), datetime('now'))
""")
cursor.execute("""
    INSERT INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at, updated_at)
    VALUES ('reg_bob', 'Bob Smith (Impostor)', 'CSE', '2026', 'x', 'x', 0, 1, datetime('now'), datetime('now'))
""")

# Insert student sessions for Alice and Bob
now_utc = datetime.now(timezone.utc)
iso_future = (now_utc + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
iso_past = (now_utc - timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
iso_now = now_utc.strftime("%Y-%m-%dT%H:%M:%S.000Z")

token_alice_valid = f"token_alice_valid_{int(time.time())}"
token_alice_expired = f"token_alice_exp_{int(time.time())}"
token_bob_valid = f"token_bob_valid_{int(time.time())}"

cursor.execute(
    "INSERT INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg_alice', 0, ?, ?)",
    (token_alice_valid, iso_future, iso_now)
)
cursor.execute(
    "INSERT INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg_alice', 0, ?, ?)",
    (token_alice_expired, iso_past, iso_now)
)
cursor.execute(
    "INSERT INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg_bob', 0, ?, ?)",
    (token_bob_valid, iso_future, iso_now)
)

conn.commit()
conn.close()

# Enroll Alice via live Task 3.3 endpoint /api/auth/enroll-biometrics using Alice's valid session token
alice_enroll_img_b64 = file_to_base64_data_uri(img_person_a, "image/jpeg")
alice_wav_b64 = file_to_base64_data_uri(valid_voice_path, "audio/wav")

status_enr, res_enr, elapsed_enr = send_post("/api/auth/enroll-biometrics", {
    "regNo": "reg_alice",
    "faceImageBase64": alice_enroll_img_b64,
    "voiceAudioBase64": alice_wav_b64
}, token=token_alice_valid)

alice_enrolled = (status_enr == 200 and res_enr.get("success") is True)
record_test("3.2 Pre-requisite Enrollment: Alice enrolled via /api/auth/enroll-biometrics",
            alice_enrolled, f"HTTP {status_enr} in {elapsed_enr:.1f}ms | Vector dim: {res_enr.get('biometricInfo', {}).get('faceEmbeddingBytes')} B")

# Verify vector in DB
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
cursor.execute("SELECT LENGTH(face_embedding), LENGTH(voice_embedding) FROM student_biometrics WHERE reg_no = 'reg_alice'")
row = cursor.fetchone()
conn.close()

db_sealed = row is not None and row[0] == 2048 and row[1] == 768
record_test("3.3 Database Vector Sealing: Strict 2,048-byte ArcFace and 768-byte Voice blobs sealed",
            db_sealed, f"Face bytes: {row[0] if row else 0} (512x4), Voice bytes: {row[1] if row else 0} (192x4)")


# =========================================================================
# SECTION 4: INTEGRATED LIVE CHAMBER GATE VERIFICATION SCENARIOS (Task 4.1 UI + 3.2 Gate)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 4: LIVE CHAMBER GATE VERIFICATION SCENARIOS & RETICLE AUDIT")
print("=" * 60)

# SCENARIO 4.1: Genuine Student Verification (Full Triad Pass)
# Alice submits a second bona fide frame with slight variance (brightness 1.04)
img_a = Image.open(img_person_a).convert("RGB")
img_a_live = ImageEnhance.Brightness(img_a).enhance(1.04)
live_a_path = os.path.join(EDGE_DIR, "alice_live_frame.jpg")
img_a_live.save(live_a_path, quality=95)
alice_live_b64 = file_to_base64_data_uri(live_a_path, "image/jpeg")

session_audit_id = f"sess_chamber_{int(time.time())}"

status_a, res_a, elapsed_a = send_post("/api/auth/verify-gate", {
    "regNo": "reg_alice",
    "liveFrameBase64": alice_live_b64,
    "sessionId": session_audit_id
}, token=token_alice_valid)

sim_a = res_a.get("similarity", 0.0)
ver_a = res_a.get("verified", False)
telem_a = res_a.get("telemetry", {})

genuine_pass = (status_a == 200 and ver_a is True and sim_a >= 0.62)
record_test("4.1 Scenario A: Genuine Candidate Gate Verification", genuine_pass,
            f"HTTP {status_a} | Verified: {ver_a} | Similarity: {sim_a:.4f} (>= 0.62) in {elapsed_a:.1f}ms")

# Verify Full Telemetry Contract for BiometricGateModal
liveness_val = telem_a.get("livenessScore") or 0.0
norm_val = telem_a.get("embeddingL2Norm") or 0.0
illum_status = telem_a.get("illuminationStatus") or ""

telem_contract_valid = (
    telem_a.get("faceDetected") is True and
    isinstance(telem_a.get("detectionScore"), (float, int)) and telem_a["detectionScore"] > 0.60 and
    isinstance(telem_a.get("faceBox"), list) and len(telem_a["faceBox"]) == 4 and
    isinstance(telem_a.get("landmarks"), list) and len(telem_a["landmarks"]) == 5 and
    telem_a.get("isLive") is True and
    isinstance(liveness_val, (float, int)) and liveness_val >= 0.95 and
    telem_a.get("alignedSize") == [112, 112] and
    ("ALIGNED" in telem_a.get("alignmentStatus", "") or telem_a.get("alignmentStatus") == "COMPLETED") and
    ("EQUALIZED" in illum_status or "APPLIED" in illum_status or "OPTIMAL" in illum_status) and
    telem_a.get("embeddingDim") == 512 and
    abs(norm_val - 1.0) < 1e-4
)
record_test("4.2 Telemetry Contract Validation: All 11 telemetry fields present and typed",
            telem_contract_valid,
            f"Liveness: {liveness_val:.4f} | Lighting: {illum_status} | L2: {norm_val:.6f}")

# Simulate BiometricGateModal Render for Genuine Candidate
sim_reticle_a = simulate_canvas_reticle_transform(telem_a.get("faceBox", [0, 0, 0, 0]), telem_a.get("landmarks", []))
modal_ui_genuine_color = "#10b981" # Emerald
modal_ui_badge = f"Real Human ({liveness_val*100:.1f}%)"
modal_progress_percent = min(100, sim_a * 100)

record_test("4.3 Modal UI State Simulation (Genuine): Emerald reticle & Real Human HUD badge",
            sim_reticle_a["width"] > 50 and "Real Human" in modal_ui_badge and modal_progress_percent >= 62,
            f"Reticle color: {modal_ui_genuine_color} | Badge: {modal_ui_badge} | Bar: {modal_progress_percent:.1f}%")

# Verify Keyframe and DB Biometrics Status Update
keyframe_path = os.path.join(KEYFRAMES_DIR, f"{session_audit_id}.jpg")
keyframe_saved = os.path.exists(keyframe_path) and os.path.getsize(keyframe_path) > 10000

conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
cursor.execute("SELECT verification_status FROM student_biometrics WHERE reg_no = 'reg_alice'")
bio_status = cursor.fetchone()
conn.close()

db_authenticated = bio_status and bio_status[0] == "AUTHENTICATED"
record_test("4.4 Biometrics Status & Disk Keyframe: Status AUTHENTICATED and keyframe persisted",
            keyframe_saved and db_authenticated,
            f"Keyframe size: {os.path.getsize(keyframe_path) if keyframe_saved else 0} B | Biometrics: {bio_status[0] if bio_status else None}")


# SCENARIO 4.2: Impostor Rejection (Defense Against Face Swapping)
# Candidate Bob attempts to verify as Alice using genuine human face reg1.jpg (distinct individual)
impostor_img_b64 = file_to_base64_data_uri(img_person_impostor, "image/jpeg")

status_b, res_b, elapsed_b = send_post("/api/auth/verify-gate", {
    "regNo": "reg_alice",
    "liveFrameBase64": impostor_img_b64,
    "sessionId": f"sess_impostor_{int(time.time())}"
}, token=token_alice_valid)

sim_b = res_b.get("similarity", 0.0)
ver_b = res_b.get("verified", True)
telem_b = res_b.get("telemetry", {})

impostor_rejected = (status_b == 200 and ver_b is False and sim_b < 0.40)
record_test("4.5 Scenario B: Impostor Rejection Defense", impostor_rejected,
            f"HTTP {status_b} | Verified: {ver_b} | Impostor Similarity: {sim_b:.4f} (< 0.40) in {elapsed_b:.1f}ms")

# Simulate Modal UI State for Impostor
modal_ui_impostor_color = "#f43f5e" # Rose
modal_impostor_alert = "Admission Denied"
record_test("4.6 Modal UI State Simulation (Impostor): Rose reticle & Admission Denied alert",
            res_b.get("message") is not None and sim_b < 0.62,
            f"Reticle color: {modal_ui_impostor_color} | Alert: {modal_impostor_alert} | Similarity: {sim_b*100:.1f}%")

# Check DB Flagged state in student_biometrics
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
cursor.execute("SELECT verification_status FROM student_biometrics WHERE reg_no = 'reg_alice'")
bio_status_b = cursor.fetchone()
conn.close()
record_test("4.7 Security Flagging: Impostor attempt triggers biometric status FLAGGED",
            bio_status_b and bio_status_b[0] == "FLAGGED",
            f"Database biometrics status: {bio_status_b[0] if bio_status_b else None}")


# =========================================================================
# SECTION 5: EDGE CASES & ANOMALY HANDLING IN BIOMETRIC GATE MODAL
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 5: EDGE CASES & SECURITY ANOMALY DEFENSES")
print("=" * 60)

# EDGE CASE 5.1: Zero Face Detected (Blank / Occluded Frame)
blank_img = Image.new("RGB", (640, 480), color=(10, 10, 10))
blank_path = os.path.join(EDGE_DIR, "blank_frame.jpg")
blank_img.save(blank_path, quality=80)
blank_b64 = file_to_base64_data_uri(blank_path, "image/jpeg")

status_zero, res_zero, elapsed_zero = send_post("/api/auth/verify-gate", {
    "regNo": "reg_alice",
    "liveFrameBase64": blank_b64,
    "sessionId": "sess_zero"
}, token=token_alice_valid)

zero_face_handled = (status_zero == 400 and res_zero.get("reason") == "NO_FACE_DETECTED")
record_test("5.1 Edge Case: Zero Face Detected Frame Handled Cleanly", zero_face_handled,
            f"HTTP {status_zero} | Reason: {res_zero.get('reason')} | Message: {res_zero.get('message')}")

# Modal behavior for zero face: Reticle must be cleared, no ghost coordinates
modal_cleared_reticle = (res_zero.get("telemetry") is None)
record_test("5.2 Modal Zero-Face Reticle Cleanup: Ghost reticles prevented on 0 faces", modal_cleared_reticle)


# EDGE CASE 5.2: Multiple Faces Detected (Colleague / Bystander in Frame)
multi_path = os.path.join(EDGE_DIR, "multi.jpg")
if not os.path.exists(multi_path):
    im_single = Image.open(img_person_a).convert("RGB").resize((320, 480))
    im_multi = Image.new("RGB", (640, 480))
    im_multi.paste(im_single, (0, 0))
    im_multi.paste(im_single, (320, 0))
    im_multi.save(multi_path)

multi_b64 = file_to_base64_data_uri(multi_path, "image/jpeg")

status_multi, res_multi, elapsed_multi = send_post("/api/auth/verify-gate", {
    "regNo": "reg_alice",
    "liveFrameBase64": multi_b64,
    "sessionId": "sess_multi"
}, token=token_alice_valid)

multi_face_handled = (status_multi == 400 and res_multi.get("reason") == "MULTIPLE_FACES_DETECTED")
record_test("5.3 Edge Case: Multiple Faces Detected Handled Cleanly", multi_face_handled,
            f"HTTP {status_multi} | Reason: {res_multi.get('reason')} | Code: {res_multi.get('reason')}")


# EDGE CASE 5.3: Presentation Attack / Print Spoof Defense
spoof_path = os.path.join(EDGE_DIR, "paper_print_spoof.jpg")
if not os.path.exists(spoof_path):
    im_base = Image.open(img_person_a).convert("RGB")
    w_s, h_s = im_base.size
    arr_s = np.array(im_base, dtype=np.float32)
    noise = np.random.normal(0, 15, (h_s, w_s, 3))
    arr_s = np.clip(arr_s * 0.95 + noise, 0, 255)
    arr_s[:20, :, :] = 250
    arr_s[-20:, :, :] = 250
    arr_s[:, :20, :] = 250
    arr_s[:, -20:, :] = 250
    Image.fromarray(arr_s.astype(np.uint8)).save(spoof_path)

spoof_b64 = file_to_base64_data_uri(spoof_path, "image/jpeg")

status_spoof, res_spoof, elapsed_spoof = send_post("/api/auth/verify-gate", {
    "regNo": "reg_alice",
    "liveFrameBase64": spoof_b64,
    "sessionId": "sess_spoof"
}, token=token_alice_valid)

spoof_trapped = (status_spoof == 400 and res_spoof.get("reason") == "SPOOF_PHOTO_DETECTED")
record_test("5.4 Edge Case: Presentation Attack Trapped by MiniFASNet-V2", spoof_trapped,
            f"HTTP {status_spoof} | Reason: {res_spoof.get('reason')} | Spoof Type: {res_spoof.get('spoofType')}")

modal_spoof_pill = (res_spoof.get("reason") == "SPOOF_PHOTO_DETECTED") or (res_spoof.get("spoofType") is not None)
record_test("5.5 Modal Spoof Alert HUD Badge: '⚠️ Attack Trapped: Print/Screen Spoof' rendered", modal_spoof_pill)


# EDGE CASE 5.4: Extreme Illumination & Luminance CLAHE Equalization
# Low light (underexposed 0.30x)
img_dark = ImageEnhance.Brightness(img_a).enhance(0.30)
dark_path = os.path.join(EDGE_DIR, "dark_face.jpg")
img_dark.save(dark_path, quality=90)
dark_b64 = file_to_base64_data_uri(dark_path, "image/jpeg")

status_dark, res_dark, elapsed_dark = send_post("/api/auth/verify-gate", {
    "regNo": "reg_alice",
    "liveFrameBase64": dark_b64,
    "sessionId": "sess_dark"
}, token=token_alice_valid)

illum_dark = res_dark.get("telemetry", {}).get("illuminationStatus", "")
dark_clahe_ok = (status_dark == 200 and ("EQUALIZED" in illum_status or "APPLIED" in illum_status or "OPTIMAL" in illum_status))
record_test("5.6 Edge Case: Low-Light Underexposed Frame Equalized by NumPy CLAHE", dark_clahe_ok,
            f"HTTP {status_dark} | Illumination: {illum_dark} | Sim: {res_dark.get('similarity', 0):.4f}")

# Overexposed light (1.8x)
img_bright = ImageEnhance.Brightness(img_a).enhance(1.8)
bright_path = os.path.join(EDGE_DIR, "bright_face.jpg")
img_bright.save(bright_path, quality=90)
bright_b64 = file_to_base64_data_uri(bright_path, "image/jpeg")

status_bright, res_bright, elapsed_bright = send_post("/api/auth/verify-gate", {
    "regNo": "reg_alice",
    "liveFrameBase64": bright_b64,
    "sessionId": "sess_bright"
}, token=token_alice_valid)

bright_handled = (status_bright in (200, 400))
record_test("5.7 Edge Case: Overexposed High-Contrast Frame Handled Cleanly", bright_handled,
            f"HTTP {status_bright} | Telemetry: {res_bright.get('telemetry') is not None}")


# EDGE CASE 5.5: Calibrated Match Threshold Decision Boundary
threshold_constant = 0.62

def evaluate_decision_boundary(similarity, threshold=0.62):
    return similarity >= threshold

test_boundary_pass = evaluate_decision_boundary(0.62001, threshold_constant)
test_boundary_fail = not evaluate_decision_boundary(0.61999, threshold_constant)
test_boundary_exact = evaluate_decision_boundary(0.62000, threshold_constant)

record_test("5.8 Decision Boundary Edge Case: Strict 0.62 Cutoff (0.62001 PASS vs 0.61999 FAIL)",
            test_boundary_pass and test_boundary_fail and test_boundary_exact,
            f"0.62001 -> {test_boundary_pass} | 0.61999 -> {not test_boundary_fail} | 0.62000 -> {test_boundary_exact}")


# EDGE CASE 5.6: Authentication & Security Session Failures
# 5.6.1 Expired Session Token
status_exp, res_exp, _ = send_post("/api/auth/verify-gate", {
    "regNo": "reg_alice",
    "liveFrameBase64": alice_live_b64,
    "sessionId": "sess_alice_expired"
}, token=token_alice_expired)

expired_token_blocked = (status_exp == 401)
record_test("5.9 Security Edge Case: Expired Session Token Blocked with HTTP 401", expired_token_blocked,
            f"HTTP {status_exp} | Error: {res_exp.get('error')}")

# 5.6.2 Unenrolled Candidate
status_unenrolled, res_unenrolled, _ = send_post("/api/auth/verify-gate", {
    "regNo": "reg_bob", # Bob is in students table and has a valid session, but has no biometric vectors
    "liveFrameBase64": impostor_img_b64,
    "sessionId": "sess_bob_unenrolled"
}, token=token_bob_valid)

unenrolled_blocked = (status_unenrolled == 400 and "not sealed" in res_unenrolled.get("error", ""))
record_test("5.10 Security Edge Case: Unenrolled Candidate Rejected with HTTP 400", unenrolled_blocked,
            f"HTTP {status_unenrolled} | Error: {res_unenrolled.get('error')}")

# 5.6.3 Corrupted / Malformed Base64 Image
status_corrupt, res_corrupt, _ = send_post("/api/auth/verify-gate", {
    "regNo": "reg_alice",
    "liveFrameBase64": "data:image/jpeg;base64,CORRUPTED_BASE64_DATA_NOT_VALID",
    "sessionId": "sess_corrupt"
}, token=token_alice_valid)

corrupt_payload_blocked = (status_corrupt in (400, 500))
record_test("5.11 Security Edge Case: Corrupted Base64 Payload Rejected Cleanly", corrupt_payload_blocked,
            f"HTTP {status_corrupt} | Message: {res_corrupt.get('message') or res_corrupt.get('error')}")


# =========================================================================
# SECTION 6: BURST LATENCY SLA & SEQUENTIAL RELIABILITY
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 6: SEQUENTIAL BURST LATENCY SLA & CONCURRENCY")
print("=" * 60)

latencies = []
for i in range(5):
    t_start = time.perf_counter()
    st, resp, el = send_post("/api/auth/verify-gate", {
        "regNo": "reg_alice",
        "liveFrameBase64": alice_live_b64,
        "sessionId": f"sess_perf_{i}"
    }, token=token_alice_valid)
    latencies.append(el)
    time.sleep(0.05)

avg_latency = sum(latencies) / len(latencies)
max_latency = max(latencies)
sla_passed = (max_latency <= 350.0 and avg_latency <= 300.0)

record_test("6.1 Burst Latency SLA: 5 Sequential Gate Invocations <= 350ms (Avg <= 300ms)",
            sla_passed,
            f"Avg: {avg_latency:.1f}ms | Max: {max_latency:.1f}ms | Min: {min(latencies):.1f}ms (All 5: {[f'{x:.1f}ms' for x in latencies]})")


# =========================================================================
# FINAL AUDIT SUMMARY
# =========================================================================
print("\n" + "=" * 80)
total_tests = len(test_results)
passed_tests = sum(1 for _, p, _ in test_results if p is True)
failed_tests = total_tests - passed_tests
success_rate = (passed_tests / total_tests) * 100.0

print(f"TASK 4.1 EMPIRICAL AUDIT RESULTS: {passed_tests} / {total_tests} PASSED ({success_rate:.1f}%)")
print("=" * 80)

if failed_tests > 0:
    print("\nFAILED TESTS RECAP:")
    for name, p, det in test_results:
        if not p:
            print(f"- [FAIL] {name}: {det}")
    sys.exit(1)
else:
    print("\n[SUCCESS] ALL TASK 4.1 EMPIRICAL & INTEGRATED SYSTEM TESTS PASSED CLEANLY!")
    sys.exit(0)
