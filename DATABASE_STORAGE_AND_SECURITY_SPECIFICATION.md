# OpenViva: Database, Biometric Storage, LiveKit Egress & Security Specification

**Document Version:** 1.0  
**Status:** Architecture Blueprint (Specification Only — Not Yet Implemented)  
**Deployment Target:** Campus Intranet / Air-Gapped High-Performance Workstation (`10.10.16.13`)  
**Target Relational Engine:** SQLite with WAL Mode (`storage/openviva.db`)  
**Object Storage Engine:** MinIO (Local S3-compatible service on Port 9000)  

---

## Executive Summary & System Philosophy

OpenViva operates under an **air-gapped campus intranet model**:
1. **Zero External Internet Access**: No cloud email providers (SendGrid, Mailgun) or SMS gateways can be reached. Authentication and recovery must be 100% self-contained.
2. **Zero Cloud Storage Leakage**: Student biometric photos, voiceprints, and exam audio/video tracks must remain strictly on local institutional hardware (FERPA / GDPR privacy compliance).
3. **Dual-Factor Biometric Identity Ground Truth**: Rather than relying purely on unsupervised during-exam clustering, the candidate's authentic identity is verified against an **enrolled face snapshot** and **voice sample** captured during first login.
4. **Relational Purity**: Relational exam metadata, topics, rosters, and 1-2 KB mathematical embeddings live in SQLite; heavy binary media files (WAV audio, MP4 video, JPG snapshots) live in the local filesystem / MinIO.

---

## 1. 10-Student Sample Roster & Credential Seeder

### 1.1 Credential Architecture
* Initial Password: **Student's Registration Number** (e.g., `reg1`).
* Storage Rule: **Never store plaintext**. Passwords are encrypted using Node.js native `crypto.scryptSync(password, salt, 64)` producing a 128-character hexadecimal hash with a 16-byte random cryptographic salt.
* First-Login Gate: `must_change_password = 1`. The student cannot access exams until they set a personal password and complete biometric enrollment.

### 1.2 The 10-Student Dataset Specification (Simplified Test Roster)

```typescript
export interface SeedStudent {
  reg_no: string;
  student_name: string;
  department: string;
  cohort: string;
  initial_password: string; // Plaintext representation prior to hashing
}

export const SAMPLE_STUDENTS: SeedStudent[] = [
  { reg_no: "reg1",  student_name: "student 1",  department: "Computer Science", cohort: "2026", initial_password: "reg1" },
  { reg_no: "reg2",  student_name: "student 2",  department: "Computer Science", cohort: "2026", initial_password: "reg2" },
  { reg_no: "reg3",  student_name: "student 3",  department: "Computer Science", cohort: "2026", initial_password: "reg3" },
  { reg_no: "reg4",  student_name: "student 4",  department: "Computer Science", cohort: "2026", initial_password: "reg4" },
  { reg_no: "reg5",  student_name: "student 5",  department: "Computer Science", cohort: "2026", initial_password: "reg5" },
  { reg_no: "reg6",  student_name: "student 6",  department: "Computer Science", cohort: "2026", initial_password: "reg6" },
  { reg_no: "reg7",  student_name: "student 7",  department: "Computer Science", cohort: "2026", initial_password: "reg7" },
  { reg_no: "reg8",  student_name: "student 8",  department: "Computer Science", cohort: "2026", initial_password: "reg8" },
  { reg_no: "reg9",  student_name: "student 9",  department: "Computer Science", cohort: "2026", initial_password: "reg9" },
  { reg_no: "reg10", student_name: "student 10", department: "Computer Science", cohort: "2026", initial_password: "reg10" },
];
```

### 1.3 Zero-Manual-Script Architecture (In-DB Lifecycle)
No manual command-line scripts are required in day-to-day operations:
1. **Automatic Boot-Seeding on Startup (`web/src/lib/db.ts`)**:
   During `getDB()` initialization, the application checks `SELECT COUNT(*) FROM students`. If empty (`COUNT == 0`), it automatically hashes and inserts the 10 test students (`reg1` to `reg10`) using `crypto.scryptSync`.
2. **Dynamic Ingestion for Future Students (`upsertStudent`)**:
   When a TA or instructor uploads a class roster CSV or adds students through the TA Portal:
   - The API calls `upsertStudent(regNo, studentName, department, cohort)` in `web/src/lib/db.ts`.
   - The function automatically generates the 16-byte salt, computes the `scrypt` hash of their `reg_no`, and writes to SQLite with `must_change_password = 1`.
   - **Zero manual scripts or terminal operations are ever needed to register new students.**

---

## 2. Relational Biometrics Database Schema (`student_biometrics`)

To prevent fragmentation and unnecessary `JOIN` overhead, both **Face** and **Voice** biometrics are stored in **one unified table**.

### 2.1 SQLite DDL (Data Definition Language)

```sql
-- 1. Student Master Table (Auth & Profiles)
CREATE TABLE IF NOT EXISTS students (
    reg_no TEXT PRIMARY KEY,
    student_name TEXT NOT NULL,
    department TEXT NOT NULL,
    cohort TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    salt TEXT NOT NULL,
    must_change_password INTEGER NOT NULL DEFAULT 1,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL,
    updated_at TEXT
);

-- 2. Unified Student Biometrics Ground Truth Table
CREATE TABLE IF NOT EXISTS student_biometrics (
    reg_no TEXT PRIMARY KEY REFERENCES students(reg_no) ON DELETE CASCADE,
    student_name TEXT NOT NULL,
    
    -- Face Biometrics
    face_image_path TEXT,          -- Disk path: "storage/biometrics/faces/reg1.jpg"
    face_embedding BLOB,           -- 512-dim float32 vector (2048 bytes) from InsightFace / FaceNet
    face_enrolled_at TEXT,
    
    -- Voice Biometrics
    voice_sample_path TEXT,        -- Disk path: "storage/biometrics/voices/reg1.wav"
    voice_embedding BLOB,          -- 192-dim float32 vector (768 bytes) from ECAPA-TDNN / CAM++
    voice_enrolled_at TEXT,
    
    -- Audit Metadata
    enrolled_ip_address TEXT,
    enrolled_user_agent TEXT,
    verified_by_ta_id TEXT REFERENCES instructors(id),
    verification_status TEXT NOT NULL DEFAULT 'PENDING' -- 'PENDING', 'AUTHENTICATED', 'FLAGGED'
);

CREATE INDEX IF NOT EXISTS idx_biometrics_status ON student_biometrics(verification_status);
```

### 2.2 Storage Layout on Disk
Raw binary media is stored in structured local directories rather than bloated SQL blobs:
```
storage/
└── biometrics/
    ├── faces/
    │   ├── reg1.jpg   (~120 KB, 640x480 normalized portrait)
    │   └── reg2.jpg
    └── voices/
        ├── reg1.wav   (~160 KB, 5 seconds 16 kHz mono PCM)
        └── reg2.wav
```

### 2.3 Face Embedding Retrieval Architecture: Model Selection & Technical Trade-offs

#### Selected Model: `facenet-pytorch` (InceptionResnetV1 + MTCNN)
For the biometric ground-truth extraction and real-time pre-viva gate verification, OpenViva adopts **`facenet-pytorch`** running InceptionResnetV1 pretrained on **VGGFace2** paired with MTCNN face alignment.

#### Architectural Evaluation & Comparison:

| Criterion | `facenet-pytorch` (Chosen) | `InsightFace` (ArcFace) | `DeepFace` Wrapper | `dlib` (face_recognition) |
| :--- | :--- | :--- | :--- | :--- |
| **Primary Backbone** | **InceptionResnetV1** | ResNet-50 / ArcFace | Multi-model wrapper | ResNet-34 |
| **Weight Footprint** | **~107 MB** (vggface2) | ~350 MB (buffalo_l pack) | >600 MB (TensorFlow/Keras) | ~100 MB |
| **Dependencies** | **Pure PyTorch** (native to existing GPU CUDA) | Requires `onnxruntime-gpu`, `opencv-python`, C++ build | Requires TensorFlow, Keras, OpenCV, dlib | Requires `cmake`, C++ build tools, `dlib` wheel |
| **Inference Latency (RTX GPU)** | **~12–15 ms** per face | ~10–14 ms per face | ~80–120 ms per face | ~45–60 ms (CPU bound) |
| **Embedding Dimensions** | **512-dim `float32`** | 512-dim `float32` | 128 / 512 / 2622-dim | 128-dim `float32` |
| **SQLite BLOB Size** | **Exactly 2,048 bytes** | Exactly 2,048 bytes | Variable | 512 bytes |
| **Air-Gapped Campus Viability** | **Highest**: Self-contained weights, zero external framework conflicts | **Moderate**: Frequent CUDA/ONNX Runtime driver version mismatches | **Poor**: Extreme bloat and heavy background dependency chain | **Low**: High false-positive rate under campus lab lighting variations |

#### Mathematical Pipeline:
1. **Facial Alignment (MTCNN)**:
   Detects facial bounding boxes and 5 facial landmark points (left eye, right eye, nose, left mouth corner, right mouth corner). It affine-transforms and crops the portrait to $160 \times 160$ pixels.
2. **Feature Extraction (InceptionResnetV1)**:
   Generates a 512-dimensional continuous latent representation vector $\mathbf{v} \in \mathbb{R}^{512}$.
3. **L2 Normalization**:
   The embedding is projected onto the unit hypersphere:
   $$\hat{\mathbf{v}} = \frac{\mathbf{v}}{\|\mathbf{v}\|_2} = \frac{\mathbf{v}}{\sqrt{\sum_{i=1}^{512} v_i^2}}$$
4. **Database Persistence**:
   The 512 `float32` values are packed into a continuous byte array:
   $$\text{BLOB Size} = 512 \times 4\text{ bytes} = 2,048\text{ bytes}$$
   Stored directly in column `student_biometrics.face_embedding`.
5. **Verification Scoring (Cosine Similarity)**:
   Given stored reference vector $\hat{\mathbf{v}}$ and live pre-viva probe vector $\hat{\mathbf{u}}$:
   $$\text{Similarity}(\hat{\mathbf{u}}, \hat{\mathbf{v}}) = \hat{\mathbf{u}} \cdot \hat{\mathbf{v}} = \sum_{i=1}^{512} u_i v_i$$
   * **$\text{Similarity} \ge 0.68$**: Candidate identity verified ($\ge 99.6\%$ accuracy). Admission granted.
   * **$\text{Similarity} < 0.68$**: Potential impersonation. Access blocked, incident flagged in TA console.

---

## 3. Recording Pipeline: LiveKit Egress + MinIO (S3-Compatible)

### 3.1 The Architectural Need
* **LiveKit SFU**: Dispatches WebRTC UDP packets between browser and AI worker. It does **not** persist audio or video to disk.
* **LiveKit Egress**: A background worker that taps into live LiveKit rooms, encodes real-time media streams into `.wav` or `.mp4`, and uploads them to object storage upon exam completion.
* **MinIO**: High-performance, self-hosted S3 object storage server running on the GPU host (`http://10.10.16.13:9000`). It replaces cloud AWS S3 with zero data leaving the campus LAN.

```
Candidate Mic / Cam ──► LiveKit SFU (WebRTC)
                             │
                             ▼
                    LiveKit Egress Service
                             │
             ┌───────────────┴───────────────┐
             ▼                               ▼
     [ Track Egress ]               [ Room Composite ]
     Candidate Speech (.wav)        Side-by-side Video (.mp4)
     (16 kHz Mono, 10 min = ~19 MB) (720p H.264, 10 min = ~120 MB)
             │                               │
             └───────────────┬───────────────┘
                             ▼
             MinIO Local S3 (Bucket: "viva-recordings")
                             │
                             ▼
         Trigger Post-Exam Forensic Voice & Vision Audit
```

### 3.2 MinIO Service Configuration on Server `10.10.16.13`
* **Docker Compose or Native Binary**:
  ```bash
  # Native launch example on GPU host
  minio server /home/savan/openviva/storage/minio_data --address ":9000" --console-address ":9001"
  ```
* **Default S3 Bucket**: `viva-recordings`
* **Storage Path Pattern**:
  * Audio: `exams/{year}/{exam_id}/{reg_no}_mic.wav`
  * Composite Video: `exams/{year}/{exam_id}/{reg_no}_composite.mp4`

### 3.3 LiveKit Egress Python Trigger (`agent_worker_universal.py`)
When a student connects and the viva session is confirmed:
```python
from livekit import api

async def start_candidate_recording(room_name: str, candidate_id: str):
    egress_client = api.EgressServiceClient(
        LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET
    )
    
    # Track Egress: Clean audio track for PyAnnote Voice Recognition
    request = api.TrackEgressRequest(
        room_name=room_name,
        track_id=candidate_audio_track_id,
        file=api.DirectFileOutput(
            filepath=f"exams/2026/{room_name}/{candidate_id}.wav",
            s3=api.S3Upload(
                endpoint="http://10.10.16.13:9000",
                access_key="openviva_minio",
                secret_key="secure_minio_secret",
                bucket="viva-recordings",
                force_path_style=True
            )
        )
    )
    egress_info = await egress_client.start_track_egress(request)
    return egress_info.egress_id
```

---

## 4. Post-Exam Forensic Voice Recognition Audit

### 4.1 Comparison Mathematics
When the exam concludes, the offline audit worker pulls `exams/2026/{room_name}/{candidate_id}.wav` from MinIO and queries `student_biometrics.voice_embedding` from SQLite:

1. **Extract Global Centroids**:
   PyAnnote 3.1 diarizes the 10-minute WAV into speaker clusters $C_0, C_1, \dots$ and extracts centroid vectors:
   $$\mathbf{c}_k \in \mathbb{R}^{192}, \quad \|\mathbf{c}_k\|_2 = 1$$
2. **Compute Verification Metric**:
   $$\text{Similarity}_k = \mathbf{c}_k \cdot \mathbf{v}_{\text{enrolled}}$$
3. **Threshold Decision Rules**:
   * Dominant Cluster ($>85\%$ speech) $\text{Sim}_0 \ge 0.70$: **Authenticated Student**.
   * Dominant Cluster $\text{Sim}_0 < 0.50$: **Imposter Swap Detected** (A proxy took the entire viva).
   * Secondary Cluster ($\ge 1.5\text{s}$) with $\text{Sim}_1 < 0.45$: **Accomplice Collusion Detected** (Off-camera whisperer).

---

## 5. Database Health, Concurrency & Security Optimizations

### 5.1 The `sql.js` (WASM) Bottleneck vs. `better-sqlite3` Native
* **Current Issue**: Next.js uses `sql.js` which exports the entire memory heap to disk on write (`fs.writeFileSync`). If Python workers query SQLite simultaneously, file lock collision can occur.
* **The Fix**: Migrate `web/src/lib/db.ts` to **`better-sqlite3`** (Node.js native C++ bindings).
* **Enable Write-Ahead Logging (WAL)**:
  ```sql
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA foreign_keys = ON;
  PRAGMA busy_timeout = 5000;
  ```
  * Concurrent readers never block writers.
  * Writes take $<0.2\text{ ms}$.

### 5.2 Air-Gapped Password Recovery Protocols

Because the system cannot send emails or SMS, password resets are handled via two offline vectors:

#### Vector A: TA One-Click Reset (Institutional Baseline)
1. Student reports to the supervising TA desk with their physical university ID card.
2. In the TA Portal (`/instructors`), the TA clicks **"Reset Password to Default"**.
3. Backend sets password back to their `reg_no`, hashes with a fresh salt, and sets `must_change_password = 1`.
4. Student logs in at their lab terminal and immediately enters a new personal password.

#### Vector B: Automated Biometric Face Reset (Self-Service)
1. On the login screen, student clicks **"Forgot Password? Verify with Face"**.
2. Webcam captures a frame and computes the 512-d vector.
3. If $\text{Cosine Similarity}(\mathbf{v}_{\text{camera}}, \mathbf{v}_{\text{enrolled}}) \ge 0.72$:
   * Authenticated!
   * System unlocks a modal to type a new password directly on screen without human TA intervention.

---

## 6. Comprehensive Implementation Task Lists

Below is the concrete, step-by-step task breakdown for each component.

---

### Task List 1: 10-Student Sample Seed & Authentication Setup
- [x] **1.1 Database Schema Migration (`students`)**:
  - Add the `students` table to `storage/openviva.db` with columns: `reg_no` (PK), `student_name`, `department`, `cohort`, `password_hash`, `salt`, `must_change_password`, `is_active`, `created_at`.
- [x] **1.2 Automatic Startup Seeder & Reusable Roster Ingestion (`web/src/lib/db.ts`)**:
  - Implement auto-seeding in `getDB()`: checks if `students` table is empty; if so, automatically seeds `reg1` through `reg10` with salted `scrypt` hashes and `must_change_password = 1`.
  - Implement reusable helper `upsertStudent(regNo, studentName, department, cohort)` in `web/src/lib/db.ts` so future roster additions (via TA Portal CSV upload) hash credentials on the fly with zero manual terminal scripts.
- [x] **1.3 Student Authentication API**:
  - Implement Next.js route `POST /api/auth/student-login`:
    - Validates `reg_no` and password against stored `password_hash` and `salt` via timing-safe comparison.
    - If `must_change_password === 1`, returns `{ mustChangePassword: true, tempToken: "..." }`.
    - If authenticated, issues a secure 32-byte session token with expiration.
- [x] **1.4 Mandatory Password Change Route**:
  - Implement `POST /api/auth/student-change-password`:
    - Enforces new password $\neq$ initial `reg_no`.
    - Re-hashes new password with fresh salt, updates `password_hash`, and sets `must_change_password = 0`.
- [x] **1.5 Unit Verification**:
  - Run verification script: test authentic login with `reg1`/`reg1`, test invalid password rejection, and confirm session token issuance.

---

### Task List 2: Biometric Database & Media Storage (`student_biometrics`)
- [x] **2.1 Database Schema Migration (`student_biometrics`)**:
  - Add `student_biometrics` table to `storage/openviva.db` with `face_image_path`, `face_embedding` (`BLOB`), `voice_sample_path`, `voice_embedding` (`BLOB`), `enrolled_at`, and `verification_status`.
- [x] **2.2 Local Media Storage Directories**:
  - Create directories `storage/biometrics/faces/` and `storage/biometrics/voices/` on disk with proper read/write permissions.
- [x] **2.3 First-Login Biometric Enrollment Modal (UI)**:
  - In `web/src/components/StudentPortal.tsx` (or `PreJoinGateway.tsx`):
    - Present mandatory enrollment step after password change.
    - Step 1: Webcam capture preview $\rightarrow$ snaps 1 high-resolution facial photo (`640x480`).
    - Step 2: Microphone capture $\rightarrow$ prompts candidate to read dynamic 5-second sentence, recording 16 kHz Mono WAV.
- [x] **2.4 Biometric Enrollment Ingestion API & Vector Extraction**:
  - Install `facenet-pytorch` and `Pillow` in the GPU workstation Python environment.
  - Pre-cache InceptionResnetV1 (`vggface2`) weights to `/home/savan/models/biometrics/` (~107 MB) for air-gapped execution.
  - Implement biometric extraction worker (`biometrics_extractor.py`):
    - MTCNN alignment + InceptionResnetV1 forward pass $\rightarrow$ 512-dim L2-normalized float32 vector (2048-byte `BLOB`).
    - Audio acoustic feature projection $\rightarrow$ 192-dim float32 vector (768-byte `BLOB`).
  - Wire into `POST /api/auth/enroll-biometrics`:
    - Saves media to `storage/biometrics/faces/{reg_no}.jpg` and `storage/biometrics/voices/{reg_no}.wav`.
    - Inserts/updates `student_biometrics` row with embeddings and sets `verification_status = 'AUTHENTICATED'`.
- [x] **2.5 Automated Pre-Viva Verification Gate (`BiometricGateModal.tsx`)**:
  - Live face verification before candidate enters `/defense` room.
  - Extracts 512-d vector from live webcam frame $\rightarrow$ computes cosine similarity against stored `face_embedding` BLOB.
  - Verification threshold:
    - $\ge 0.68$: Authorized, admission granted to defense chamber.
    - $< 0.68$: Access denied, logged to TA console audit trail.

---

### Task List 3: LiveKit Egress & MinIO Local S3 Recording Pipeline
- [ ] **3.1 Local MinIO Server Setup**:
  - Verify / start MinIO server on GPU host `10.10.16.13` binding API to `:9000` and console to `:9001`.
  - Create default S3 bucket: `viva-recordings`.
  - Configure permanent service credentials (`MINIO_ROOT_USER`, `MINIO_ROOT_PASSWORD`).
- [ ] **3.2 LiveKit Egress Service Deployment**:
  - Install / deploy `livekit-egress` service on server `10.10.16.13`.
  - Configure `egress.yaml` to connect to local LiveKit SFU (`ws://localhost:7880`) and point S3 output to MinIO (`http://localhost:9000`).
- [ ] **3.3 Agent Worker Egress Hook (`agent_worker_universal.py`)**:
  - In `connect_and_serve()`, when candidate participant joins and session is configured:
    - Call `EgressServiceClient.start_track_egress()` targeting the candidate's audio track.
    - Specify MinIO output path: `exams/2026/{room_name}/{reg_no}_mic.wav`.
    - Store `egress_id` in session instance.
- [ ] **3.4 Exam Termination & Egress Finalization**:
  - When exam finishes or candidate disconnects:
    - Send stop signal or allow track egress to finalize automatically upon track unpublish.
    - Save the completed MinIO recording URL to `exam_sessions.recording_url` and `defense_records`.

---

### Task List 4: Offline Post-Exam Forensic Voice Recognition Audit
- [ ] **4.1 Post-Exam Audit Script (`scripts/audit_session_biometrics.py`)**:
  - Create asynchronous background auditor script triggered when room closes.
  - Step 1: Download `{reg_no}_mic.wav` from MinIO (or read directly from local shared storage).
  - Step 2: Query candidate's enrolled voice embedding from `student_biometrics.voice_embedding` in SQLite.
- [ ] **4.2 Neural Diarization Pipeline (PyAnnote 3.1)**:
  - Run PyAnnote diarization over the full 10-minute audio file.
  - Mask out time intervals where the AI Examiner (Kokoro TTS) was speaking.
  - Extract speaker clusters and compute average centroid embedding for each cluster.
- [ ] **4.3 Verification & Anomaly Classification**:
  - Compute cosine similarity of each cluster against enrolled `voice_embedding`:
    - Dominant speaker $< 0.50 \rightarrow$ Flag `IMPOSTER_PROXY_TAKEOVER`.
    - Secondary speaker $\ge 1.5\text{s}$ with similarity $< 0.45 \rightarrow$ Flag `ACCOMPLICE_DETECTED`.
- [ ] **4.4 Evidence Snip Extraction & DB Persistence**:
  - If anomaly detected:
    - Use `ffmpeg` or `torchaudio` to carve a 5-second WAV snippet around the flagged timestamp.
    - Align anomaly timestamp with Faster-Whisper transcript text.
    - Save anomaly record, transcript excerpt, and audio snippet path to `evaluations.behavioral_flags_json`.

---

### Task List 5: Database Health, Concurrency & Air-Gapped Password Recovery
- [ ] **5.1 SQLite WAL Mode & Concurrency Upgrade**:
  - Upgrade `web/src/lib/db.ts` to use native `better-sqlite3` bindings instead of WASM `sql.js` memory dumping.
  - Execute initialization pragmas:
    - `PRAGMA journal_mode = WAL;`
    - `PRAGMA synchronous = NORMAL;`
    - `PRAGMA busy_timeout = 5000;`
  - Verify that concurrent writes from Next.js and Python workers run without `database is locked` errors.
- [ ] **5.2 TA One-Click Password Reset (Human Protocol)**:
  - Add API endpoint `POST /api/instructors/reset-student-password`:
    - TA authentication required.
    - Re-hashes student's default `reg_no` password with fresh salt.
    - Sets `must_change_password = 1`.
  - In `web/src/components/TAPortal.tsx`, add a **"Reset to Default"** button next to each student in the Class Roster tab.
- [ ] **5.3 Automated Biometric Face Password Reset (Self-Service)**:
  - Implement `POST /api/auth/reset-password-face`:
    - Candidate enters their `reg_no` and submits a live webcam capture.
    - Server matches capture against `student_biometrics.face_embedding`.
    - If cosine match $\ge 0.72$, issues a temporary 5-minute password reset token.
- [ ] **5.4 TA Scorecard Multi-Modal Biometric HUD**:
  - In `web/src/components/EvaluationScorecard.tsx`:
    - Add a side-by-side **Identity Verification Card**:
      - Left: Enrolled Reference Photo (captured on registration day).
      - Right: Live Exam Keyframe (captured during viva).
    - If secondary voice was flagged: render an inline HTML5 audio player `▶ Play Whisper Snippet (04:14)` with the aligned transcript text.


