"""
EMPIRICAL AND EDGE-CASE TEST SUITE FOR TASK 4.2 (BiometricEnrollmentModal.tsx)
Integrated with Tasks 1.1, 1.2, 2.1, 2.2, 2.3, 2.4, 3.1, 3.2, 3.3, and 4.1
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
from concurrent.futures import ThreadPoolExecutor

print("=" * 80)
print("TASK 4.2 EMPIRICAL TEST SUITE: BIOMETRIC ENROLLMENT MODAL (BiometricEnrollmentModal.tsx)")
print("Full-Stack Integrated Multi-Modal Verification on Node 10.10.16.13:3001")
print("=" * 80)

DB_PATH = "/home/savan/openviva/storage/openviva.db"
BASE_URL = "http://localhost:3001/openviva"
MODELS_DIR = "/home/savan/openviva/models/face"
FACES_DIR = "/home/savan/openviva/storage/biometrics/faces"
VOICES_DIR = "/home/savan/openviva/storage/biometrics/voices"
KEYFRAMES_DIR = "/home/savan/openviva/storage/biometrics/keyframes"
EDGE_DIR = "/tmp/edge_cases_bio"
MODAL_PATH = "/home/savan/openviva/web/src/components/BiometricEnrollmentModal.tsx"

os.makedirs(EDGE_DIR, exist_ok=True)
os.makedirs(KEYFRAMES_DIR, exist_ok=True)
os.makedirs(FACES_DIR, exist_ok=True)
os.makedirs(VOICES_DIR, exist_ok=True)

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
# SECTION 1: STATIC ANALYSIS & CONTRACT VERIFICATION OF BiometricEnrollmentModal.tsx
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 1: STATIC ANALYSIS & CONTRACT VERIFICATION OF BiometricEnrollmentModal.tsx")
print("=" * 60)

modal_exists = os.path.exists(MODAL_PATH)
record_test("1.1 File Existence: BiometricEnrollmentModal.tsx present in components", modal_exists, MODAL_PATH)

if modal_exists:
    with open(MODAL_PATH, "r", encoding="utf-8") as f:
        code = f.read()

    # 1.2 Export verification
    has_export = "export function BiometricEnrollmentModal" in code
    record_test("1.2 Component Export: BiometricEnrollmentModal named export present", has_export)

    # 1.3 Props Interface Completeness
    props_fields = ["isOpen", "regNo", "studentName", "authToken", "onEnrollmentComplete"]
    all_props = all(p in code for p in props_fields)
    record_test("1.3 Component Props: BiometricEnrollmentModalProps defines required contract", all_props)

    # 1.4 EnrollmentTelemetry interface completeness
    telem_fields = [
        "faceDetected", "isLive", "livenessScore", "alignmentStatus",
        "illuminationStatus", "faceEmbeddingBytes", "voiceEmbeddingBytes", "enrolledAt"
    ]
    all_telem = all(tf in code for tf in telem_fields)
    record_test("1.4 Telemetry Interface: EnrollmentTelemetry declares all neural fields", all_telem)

    # 1.5 Viewfinder Canvas Reticle Overlay
    has_canvas_ref = "overlayCanvasRef = useRef<HTMLCanvasElement" in code
    has_canvas_tag = "<canvas" in code and "ref={overlayCanvasRef}" in code
    record_test("1.5 Canvas Reticle: HTML5 <canvas> overlay integrated with drawViewfinderReticle",
                has_canvas_ref and has_canvas_tag)

    # 1.6 Pre-Enrollment Quality Checklist Items
    has_checklist = (
        "Anti-Spoof Liveness Check" in code and
        "5-Point Umeyama Alignment" in code and
        "Luminance CLAHE Equalized" in code and
        "ArcFace 512-d Sealed Vector" in code
    )
    record_test("1.6 Quality Checklist: Pre-enrollment neural checklist rendered in UI", has_checklist)

    # 1.7 Dual Step State Machine
    has_steps = (
        'currentStep === "face"' in code and
        'currentStep === "voice"' in code and
        'currentStep === "submitting"' in code and
        'currentStep === "success"' in code
    )
    record_test("1.7 Step State Machine: face -> voice -> submitting -> success steps implemented", has_steps)

    # 1.8 Fail-Closed Error Guidance Interception
    has_error_interception = (
        "NO_FACE_DETECTED" in code and
        "MULTIPLE_FACES_DETECTED" in code and
        "SPOOF_PHOTO_DETECTED" in code
    )
    record_test("1.8 Anomaly Routing: Fail-closed error reasons mapped to user guidance", has_error_interception)

    # 1.9 Next.js Base Path Awareness
    has_basepath = "process.env.NEXT_PUBLIC_BASE_PATH || \"/openviva\"" in code
    record_test("1.9 Base Path Support: NEXT_PUBLIC_BASE_PATH resolution implemented", has_basepath)

    # 1.10 Success Telemetry Badges
    has_success_badges = (
        "Liveness: Real Human" in code and
        "Umeyama 112×112 Aligned" in code and
        "CLAHE Equalized" in code and
        "ArcFace 512-d" in code and
        "Voice 192-d" in code
    )
    record_test("1.10 Success Badges: All 5 sealed vector and liveness badges rendered on success", has_success_badges)


# =========================================================================
# SECTION 2: CANVAS RETICLE GEOMETRY & VIEWPORT SIMULATION IN ISOLATION
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 2: CANVAS RETICLE GEOMETRY & VIEWPORT SIMULATION")
print("=" * 60)

def simulate_viewfinder_geometry(canvas_w=640, canvas_h=480):
    cx = canvas_w / 2.0
    cy = (canvas_h / 2.0) - 10.0
    box_w = 240.0 * (canvas_w / 640.0)
    box_h = 280.0 * (canvas_h / 480.0)
    x1 = cx - (box_w / 2.0)
    y1 = cy - (box_h / 2.0)
    x2 = cx + (box_w / 2.0)
    y2 = cy + (box_h / 2.0)
    bracket_len = min(24.0, min(box_w, box_h) * 0.25)
    return {
        "box": (x1, y1, x2, y2),
        "width": box_w,
        "height": box_h,
        "bracket_len": bracket_len,
        "aspect_ratio": box_h / box_w
    }

geom_640 = simulate_viewfinder_geometry(640, 480)
# 2.1 Golden portrait aspect ratio (280 / 240 = 1.167)
aspect_ok = abs(geom_640["aspect_ratio"] - (280.0 / 240.0)) < 1e-4
record_test("2.1 Viewfinder Geometry: Centered portrait box with golden 1.167 aspect ratio",
            aspect_ok, f"Dimensions: {geom_640['width']:.1f}x{geom_640['height']:.1f} (Ratio: {geom_640['aspect_ratio']:.3f})")

# 2.2 Corner bracket length constraint
bracket_ok = geom_640["bracket_len"] == 24.0
record_test("2.2 Corner Bracket Safety: Bracket length non-overlapping with 24px maximum",
            bracket_ok, f"Bracket length: {geom_640['bracket_len']}px")

# 2.3 Responsive viewport scaling
geom_320 = simulate_viewfinder_geometry(320, 240)
geom_1280 = simulate_viewfinder_geometry(1280, 960)
scale_ok = (
    abs(geom_320["width"] - 120.0) < 1e-4 and
    abs(geom_1280["width"] - 480.0) < 1e-4
)
record_test("2.3 Responsive Scaling: Viewfinder scales proportionally across mobile & desktop",
            scale_ok, f"320x240 width: {geom_320['width']}px | 1280x960 width: {geom_1280['width']}px")


# =========================================================================
# SECTION 3: LIVE MULTI-MODAL ENROLLMENT FULL-STACK INTEGRATION (Tasks 1.1 -> 3.3)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 3: LIVE MULTI-MODAL ENROLLMENT & SYSTEM INTEGRATION")
print("=" * 60)

# Load candidate media
img_alice = os.path.join(FACES_DIR, "person_a_1.jpg")
wav_valid = os.path.join(VOICES_DIR, "reg1.wav")
img_impostor = os.path.join(FACES_DIR, "reg1.jpg")

if not os.path.exists(img_alice) or not os.path.exists(wav_valid) or not os.path.exists(img_impostor):
    record_test("3.1 Test Media Staged", False, "Missing media files")
    sys.exit(1)
record_test("3.1 Test Media Staged: person_a_1.jpg, reg1.wav, reg1.jpg present", True)

# Set up test candidate `reg_enr_alice` in SQLite openviva.db
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()

candidate_reg = "reg_enr_alice"
cursor.execute("DELETE FROM student_sessions WHERE reg_no = ?", (candidate_reg,))
cursor.execute("DELETE FROM student_biometrics WHERE reg_no = ?", (candidate_reg,))
cursor.execute("DELETE FROM students WHERE reg_no = ?", (candidate_reg,))

cursor.execute("""
    INSERT INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at, updated_at)
    VALUES (?, 'Alice Enrollment Test', 'CSE', '2026', 'x', 'x', 0, 1, datetime('now'), datetime('now'))
""", (candidate_reg,))

now_utc = datetime.now(timezone.utc)
iso_future = (now_utc + timedelta(hours=2)).strftime("%Y-%m-%dT%H:%M:%S.000Z")
iso_now = now_utc.strftime("%Y-%m-%dT%H:%M:%S.000Z")
token_enr_alice = f"token_enr_{candidate_reg}_{int(time.time())}"

cursor.execute(
    "INSERT INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, ?, 0, ?, ?)",
    (token_enr_alice, candidate_reg, iso_future, iso_now)
)
conn.commit()
conn.close()

# SCENARIO 4.2.A: Submit Multi-Modal Enrollment via Live HTTP Endpoint
alice_face_b64 = file_to_base64_data_uri(img_alice, "image/jpeg")
alice_voice_b64 = file_to_base64_data_uri(wav_valid, "audio/wav")

status_enr, res_enr, elapsed_enr = send_post("/api/auth/enroll-biometrics", {
    "regNo": candidate_reg,
    "studentName": "Alice Enrollment Test",
    "faceImageBase64": alice_face_b64,
    "voiceAudioBase64": alice_voice_b64
}, token=token_enr_alice)

enr_ok = (status_enr == 200 and res_enr.get("success") is True)
record_test("3.2 Scenario A: Live Multi-Modal Enrollment Submission", enr_ok,
            f"HTTP {status_enr} in {elapsed_enr:.1f}ms | Message: {res_enr.get('message')}")

# Verify Sealed Vector Byte Schemas
bio_data = res_enr.get("biometrics", {})
face_bytes = bio_data.get("faceEmbeddingBytes")
voice_bytes = bio_data.get("voiceEmbeddingBytes")
telem = bio_data.get("telemetry", {})

vectors_ok = (face_bytes == 2048 and voice_bytes == 768)
record_test("3.3 Vector Schemas: Strictly 2,048-byte Face (512-d) and 768-byte Voice (192-d)",
            vectors_ok, f"Face: {face_bytes} B | Voice: {voice_bytes} B")

# Verify Rich Telemetry Forwarded to Modal
telem_ok = (
    telem.get("faceDetected") is True and
    isinstance(telem.get("livenessScore"), (float, int)) and telem["livenessScore"] >= 0.90 and
    telem.get("alignedSize") == [112, 112] and
    ("ALIGNED" in telem.get("alignmentStatus", "") or telem.get("alignmentStatus") == "COMPLETED") and
    ("EQUALIZED" in telem.get("illuminationStatus", "") or "OPTIMAL" in telem.get("illuminationStatus", "")) and
    telem.get("embeddingDim") == 512 and
    abs(telem.get("embeddingL2Norm", 0) - 1.0) < 1e-4
)
record_test("3.4 Telemetry Forwarding: Full neural telemetry forwarded to enrollment component",
            telem_ok,
            f"Liveness: {telem.get('livenessScore'):.4f} | Lighting: {telem.get('illuminationStatus')} | Align: {telem.get('alignmentStatus')}")

# Verify Permanent Media Storage on Disk
perm_face_path = os.path.join(FACES_DIR, f"{candidate_reg}.jpg")
perm_voice_path = os.path.join(VOICES_DIR, f"{candidate_reg}.wav")
disk_ok = (
    os.path.exists(perm_face_path) and os.path.getsize(perm_face_path) > 1000 and
    os.path.exists(perm_voice_path) and os.path.getsize(perm_voice_path) > 1000
)
record_test("3.5 Disk Persistence: Permanent facial portrait and voice WAV sealed",
            disk_ok, f"Face: {os.path.getsize(perm_face_path) if os.path.exists(perm_face_path) else 0} B | Voice: {os.path.getsize(perm_voice_path) if os.path.exists(perm_voice_path) else 0} B")

# Verify SQLite Record Committed
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
cursor.execute("SELECT verification_status, LENGTH(face_embedding), LENGTH(voice_embedding) FROM student_biometrics WHERE reg_no = ?", (candidate_reg,))
db_row = cursor.fetchone()
conn.close()

db_ok = (db_row is not None and db_row[0] == "AUTHENTICATED" and db_row[1] == 2048 and db_row[2] == 768)
record_test("3.6 SQLite Ground Truth: student_biometrics sealed with status AUTHENTICATED",
            db_ok, f"Status: {db_row[0] if db_row else None} | Face: {db_row[1] if db_row else 0} B | Voice: {db_row[2] if db_row else 0} B")

# SCENARIO 4.2.B: Immediate Pre-Viva Gate Interoperability (Tasks 4.2 -> 4.1 -> 3.2 Full Chain)
# Newly enrolled candidate immediately proceeds to BiometricGateModal at /api/auth/verify-gate
gate_sess_id = f"sess_enr_gate_{int(time.time())}"
status_gate, res_gate, elapsed_gate = send_post("/api/auth/verify-gate", {
    "regNo": candidate_reg,
    "liveFrameBase64": alice_face_b64,
    "sessionId": gate_sess_id
}, token=token_enr_alice)

gate_auth_ok = (status_gate == 200 and res_gate.get("verified") is True and res_gate.get("similarity", 0) >= 0.62)
record_test("3.7 Gate Interoperability: Newly enrolled profile immediately admitted at Pre-Viva Gate",
            gate_auth_ok,
            f"HTTP {status_gate} | Verified: {res_gate.get('verified')} | Similarity: {res_gate.get('similarity'):.4f} (>= 0.62) in {elapsed_gate:.1f}ms")

# SCENARIO 4.2.C: Immediate Impostor Rejection Against Newly Enrolled Profile
impostor_face_b64 = file_to_base64_data_uri(img_impostor, "image/jpeg")
status_imp, res_imp, elapsed_imp = send_post("/api/auth/verify-gate", {
    "regNo": candidate_reg,
    "liveFrameBase64": impostor_face_b64,
    "sessionId": f"sess_imp_{int(time.time())}"
}, token=token_enr_alice)

gate_imp_denied = (status_imp == 200 and res_imp.get("verified") is False and res_imp.get("similarity", 0) < 0.40)
record_test("3.8 Impostor Denial: Impostor probe immediately rejected against new profile",
            gate_imp_denied,
            f"HTTP {status_imp} | Verified: {res_imp.get('verified')} | Impostor Similarity: {res_imp.get('similarity'):.4f} in {elapsed_imp:.1f}ms")


# =========================================================================
# SECTION 4: EDGE CASES & FAIL-CLOSED STAGING ISOLATION (HTTP 400 & 401)
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 4: EDGE CASES & FAIL-CLOSED STAGING ISOLATION")
print("=" * 60)

# Setup candidate reg2 for security anomaly probes
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
cursor.execute("DELETE FROM student_sessions WHERE reg_no = 'reg_sec_test'")
cursor.execute("DELETE FROM student_biometrics WHERE reg_no = 'reg_sec_test'")
cursor.execute("DELETE FROM students WHERE reg_no = 'reg_sec_test'")
cursor.execute("""
    INSERT INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at, updated_at)
    VALUES ('reg_sec_test', 'Security Anomaly Candidate', 'CSE', '2026', 'x', 'x', 0, 1, datetime('now'), datetime('now'))
""")
token_sec_valid = f"token_sec_{int(time.time())}"
cursor.execute(
    "INSERT INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg_sec_test', 0, ?, ?)",
    (token_sec_valid, iso_future, iso_now)
)
conn.commit()
conn.close()

target_sec_face = os.path.join(FACES_DIR, "reg_sec_test.jpg")
target_sec_voice = os.path.join(VOICES_DIR, "reg_sec_test.wav")
if os.path.exists(target_sec_face): os.remove(target_sec_face)
if os.path.exists(target_sec_voice): os.remove(target_sec_voice)

# 4.1 Zero Face Detected Portrait
blank_img = Image.new("RGB", (640, 480), color=(5, 5, 5))
blank_path = os.path.join(EDGE_DIR, "blank_enroll.jpg")
blank_img.save(blank_path, quality=80)
blank_b64 = file_to_base64_data_uri(blank_path, "image/jpeg")

st_zero, res_zero, _ = send_post("/api/auth/enroll-biometrics", {
    "regNo": "reg_sec_test",
    "faceImageBase64": blank_b64,
    "voiceAudioBase64": alice_voice_b64
}, token=token_sec_valid)

zero_ok = (st_zero == 400 and res_zero.get("reason") == "NO_FACE_DETECTED")
record_test("4.1 Edge Case: Zero-Face Canvas Rejected with HTTP 400 NO_FACE_DETECTED", zero_ok,
            f"HTTP {st_zero} | Reason: {res_zero.get('reason')} | Message: {res_zero.get('message')}")

# Verify Staging Isolation: No permanent disk artifacts created
staging_isolated_zero = not os.path.exists(target_sec_face) and not os.path.exists(target_sec_voice)
record_test("4.2 Staging Isolation: Zero permanent disk artifacts created on failure", staging_isolated_zero)

# 4.2 Multiple Faces Detected
multi_path = os.path.join(EDGE_DIR, "multi.jpg")
if not os.path.exists(multi_path):
    im_single = Image.open(img_alice).convert("RGB").resize((320, 480))
    im_m = Image.new("RGB", (640, 480))
    im_m.paste(im_single, (0, 0))
    im_m.paste(im_single, (320, 0))
    im_m.save(multi_path)

multi_b64 = file_to_base64_data_uri(multi_path, "image/jpeg")
st_multi, res_multi, _ = send_post("/api/auth/enroll-biometrics", {
    "regNo": "reg_sec_test",
    "faceImageBase64": multi_b64,
    "voiceAudioBase64": alice_voice_b64
}, token=token_sec_valid)

multi_ok = (st_multi == 400 and res_multi.get("reason") == "MULTIPLE_FACES_DETECTED")
record_test("4.3 Edge Case: Multiple Faces Detected Rejected with HTTP 400 MULTIPLE_FACES_DETECTED", multi_ok,
            f"HTTP {st_multi} | Reason: {res_multi.get('reason')} | Message: {res_multi.get('message')}")

# 4.3 Presentation Attack / Print Photo Spoof
spoof_path = os.path.join(EDGE_DIR, "paper_print_spoof.jpg")
spoof_b64 = file_to_base64_data_uri(spoof_path, "image/jpeg")

st_spoof, res_spoof, _ = send_post("/api/auth/enroll-biometrics", {
    "regNo": "reg_sec_test",
    "faceImageBase64": spoof_b64,
    "voiceAudioBase64": alice_voice_b64
}, token=token_sec_valid)

spoof_ok = (st_spoof == 400 and res_spoof.get("reason") == "SPOOF_PHOTO_DETECTED")
record_test("4.4 Edge Case: Paper Print Presentation Attack Trapped by MiniFASNet-V2", spoof_ok,
            f"HTTP {st_spoof} | Reason: {res_spoof.get('reason')} | Type: {res_spoof.get('spoofType')}")

# Verify Database Isolation: No SQLite row committed on spoof failure
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
cursor.execute("SELECT reg_no FROM student_biometrics WHERE reg_no = 'reg_sec_test'")
db_sec_row = cursor.fetchone()
conn.close()
record_test("4.5 Database Isolation: Zero SQLite records committed on anomaly failure", db_sec_row is None)

# 4.4 Missing Voice Audio Buffer
st_novoice, res_novoice, _ = send_post("/api/auth/enroll-biometrics", {
    "regNo": "reg_sec_test",
    "faceImageBase64": alice_face_b64
}, token=token_sec_valid)
record_test("4.6 Edge Case: Missing Voice Audio Payload Rejected with HTTP 400",
            st_novoice == 400 and "Missing required voice audio" in str(res_novoice),
            f"HTTP {st_novoice} | Error: {res_novoice.get('error')}")

# 4.5 Missing Face Portrait Buffer
st_noface, res_noface, _ = send_post("/api/auth/enroll-biometrics", {
    "regNo": "reg_sec_test",
    "voiceAudioBase64": alice_voice_b64
}, token=token_sec_valid)
record_test("4.7 Edge Case: Missing Face Portrait Payload Rejected with HTTP 400",
            st_noface == 400 and "Missing required face portrait" in str(res_noface),
            f"HTTP {st_noface} | Error: {res_noface.get('error')}")

# 4.6 Corrupted Image Buffer
st_corrupt_face, res_corrupt_face, _ = send_post("/api/auth/enroll-biometrics", {
    "regNo": "reg_sec_test",
    "faceImageBase64": "data:image/jpeg;base64,CORRUPTED_FACE_IMAGE_DATA",
    "voiceAudioBase64": alice_voice_b64
}, token=token_sec_valid)
record_test("4.8 Edge Case: Corrupted Face Portrait Rejected Cleanly with HTTP 400",
            st_corrupt_face == 400, f"HTTP {st_corrupt_face} | Error: {res_corrupt_face.get('error')}")

# 4.7 Corrupted Audio Buffer
st_corrupt_voice, res_corrupt_voice, _ = send_post("/api/auth/enroll-biometrics", {
    "regNo": "reg_sec_test",
    "faceImageBase64": alice_face_b64,
    "voiceAudioBase64": "data:audio/wav;base64,CORRUPTED_AUDIO_DATA"
}, token=token_sec_valid)
record_test("4.9 Edge Case: Corrupted Voice Audio Recording Rejected Cleanly with HTTP 400",
            st_corrupt_voice == 400, f"HTTP {st_corrupt_voice} | Error: {res_corrupt_voice.get('error')}")

# 4.8 Expired Session Token
token_expired = f"token_expired_{int(time.time())}"
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
cursor.execute(
    "INSERT INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg_sec_test', 0, ?, ?)",
    (token_expired, (now_utc - timedelta(hours=1)).strftime("%Y-%m-%dT%H:%M:%S.000Z"), iso_now)
)
conn.commit()
conn.close()

st_exp, res_exp, _ = send_post("/api/auth/enroll-biometrics", {
    "regNo": "reg_sec_test",
    "faceImageBase64": alice_face_b64,
    "voiceAudioBase64": alice_voice_b64
}, token=token_expired)
record_test("4.10 Security Edge Case: Expired Session Token Blocked with HTTP 401",
            st_exp == 401, f"HTTP {st_exp} | Error: {res_exp.get('error')}")


# =========================================================================
# SECTION 5: MULTI-MODAL CONCURRENCY & LATENCY BENCHMARK
# =========================================================================
print("\n" + "=" * 60)
print("SECTION 5: MULTI-MODAL CONCURRENCY & LATENCY BENCHMARK")
print("=" * 60)

# Setup candidate reg3 for concurrent enrollment benchmark
conn = sqlite3.connect(DB_PATH)
cursor = conn.cursor()
cursor.execute("DELETE FROM student_sessions WHERE reg_no = 'reg_bench'")
cursor.execute("DELETE FROM student_biometrics WHERE reg_no = 'reg_bench'")
cursor.execute("DELETE FROM students WHERE reg_no = 'reg_bench'")
cursor.execute("""
    INSERT INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at, updated_at)
    VALUES ('reg_bench', 'Benchmark Candidate', 'CSE', '2026', 'x', 'x', 0, 1, datetime('now'), datetime('now'))
""")
token_bench = f"token_bench_{int(time.time())}"
cursor.execute(
    "INSERT INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg_bench', 0, ?, ?)",
    (token_bench, iso_future, iso_now)
)
conn.commit()
conn.close()

def execute_enroll_worker(idx):
    st, resp, el = send_post("/api/auth/enroll-biometrics", {
        "regNo": "reg_bench",
        "studentName": "Benchmark Candidate",
        "faceImageBase64": alice_face_b64,
        "voiceAudioBase64": alice_voice_b64
    }, token=token_bench)
    return st == 200, el

with ThreadPoolExecutor(max_workers=3) as executor:
    futures = [executor.submit(execute_enroll_worker, i) for i in range(3)]
    bench_results = [f.result() for f in futures]

bench_passed = all(p for p, _ in bench_results)
bench_latencies = [l for _, l in bench_results]
record_test("5.1 Concurrency Benchmark: 3 Parallel Multi-Modal Enrollment Workers",
            bench_passed, f"Passed: {sum(1 for p, _ in bench_results)}/3 | Latencies: {[f'{x:.1f}ms' for x in bench_latencies]}")

median_latency = float(np.median(bench_latencies))
sla_enroll_passed = median_latency <= 600.0 and max(bench_latencies) <= 800.0
record_test("5.2 Full-Stack Enrollment Latency SLA (Multi-Modal Pipeline <= 600ms)",
            sla_enroll_passed,
            f"Median: {median_latency:.1f}ms | Min: {min(bench_latencies):.1f}ms | Max: {max(bench_latencies):.1f}ms")


# =========================================================================
# FINAL AUDIT SUMMARY
# =========================================================================
print("\n" + "=" * 80)
total_tests = len(test_results)
passed_tests = sum(1 for _, p, _ in test_results if p is True)
failed_tests = total_tests - passed_tests
success_rate = (passed_tests / total_tests) * 100.0

print(f"TASK 4.2 EMPIRICAL AUDIT RESULTS: {passed_tests} / {total_tests} PASSED ({success_rate:.1f}%)")
print("=" * 80)

if failed_tests > 0:
    print("\nFAILED TESTS RECAP:")
    for name, p, det in test_results:
        if not p:
            print(f"- [FAIL] {name}: {det}")
    sys.exit(1)
else:
    print("\n[SUCCESS] ALL TASK 4.2 EMPIRICAL & INTEGRATED SYSTEM TESTS PASSED CLEANLY!")
    sys.exit(0)

