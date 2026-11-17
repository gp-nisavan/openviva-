import os
import re
import glob
import sqlite3
import traceback
import sys

# Ensure imports work cleanly
sys.path.insert(0, "/home/savan/openviva")
sys.path.insert(0, "/home/savan/openviva/scripts")

from scripts.audit_session_biometrics import audit_session

RECORDINGS_DIR = "/home/savan/openviva/storage/recordings"
DB_PATH = "/home/savan/openviva/storage/openviva.db"

# 1. Connect to SQLite to get known sessions
conn = sqlite3.connect(DB_PATH)
cur = conn.cursor()
db_sessions = {}
for row in cur.execute("SELECT session_id, student_id, recording_url FROM exam_sessions"):
    db_sessions[row[0]] = {"student_id": row[1], "recording_url": row[2]}
conn.close()

# 2. Collect all audio files in RECORDINGS_DIR
audio_files = glob.glob(os.path.join(RECORDINGS_DIR, "*.*"))
audio_files = [f for f in audio_files if f.endswith(('.wav', '.m4a', '.ogg', '.mp3'))]

# Group by session base name to prefer .wav over .m4a
file_groups = {}
for f in audio_files:
    basename = os.path.basename(f)
    name_no_ext, ext = os.path.splitext(basename)
    if name_no_ext not in file_groups:
        file_groups[name_no_ext] = []
    file_groups[name_no_ext].append(f)

# Sort: prefer .wav if present, else first
selected_files = []
for name_no_ext, paths in file_groups.items():
    wav_paths = [p for p in paths if p.endswith('.wav')]
    if wav_paths:
        selected_files.append((name_no_ext, wav_paths[0]))
    else:
        selected_files.append((name_no_ext, paths[0]))

selected_files.sort(key=lambda x: os.path.getmtime(x[1]), reverse=True)

print(f"=== FOUND {len(selected_files)} AUDIO SESSIONS TO FRESHLY RE-ANALYSE ===")

results = []

for idx, (base_name, file_path) in enumerate(selected_files, 1):
    file_size_kb = os.path.getsize(file_path) / 1024.0
    if file_size_kb < 1.0:
        print(f"[{idx}/{len(selected_files)}] Skipping empty file {base_name} ({file_size_kb:.1f} KB)")
        continue

    # Determine session_id and student_id
    session_id = base_name
    student_id = "unknown"

    if session_id in db_sessions and db_sessions[session_id]["student_id"]:
        student_id = db_sessions[session_id]["student_id"]
    else:
        # Heuristics from filename
        # Pattern: sess_<student>_<timestamp>
        m = re.match(r"sess_([a-zA-Z0-9]+)_", base_name)
        if m:
            student_id = m.group(1)
        elif "regxyz" in base_name.lower():
            student_id = "regxyz"
        elif "reg1" in base_name.lower():
            student_id = "reg1"
        elif "reg3" in base_name.lower():
            student_id = "reg3"
        elif "1234" in base_name:
            student_id = "1234"
        elif "_" in base_name:
            parts = base_name.split("_")
            if len(parts) >= 2 and parts[-1] in ("reg1", "reg3", "reg100", "1234"):
                student_id = parts[-1]

    print(f"\n[{idx}/{len(selected_files)}] Processing: {base_name}")
    print(f"  Target File: {os.path.basename(file_path)} ({file_size_kb:.1f} KB)")
    print(f"  Candidate: {student_id} | Session ID: {session_id}")

    try:
        res = audit_session(
            session_id=session_id,
            student_id=student_id,
            audio_path_or_url=file_path,
            room_name="batch-audit-chamber",
            db_path=DB_PATH,
            persist_db=True
        )
        verdict = res.get("verdict", "UNKNOWN")
        sim = res.get("dominantSimilarity")
        sim_str = f"{sim:.4f}" if isinstance(sim, (int, float)) else "N/A"
        speech_sec = res.get("speechDurationSeconds", 0.0)
        flags = res.get("flags", [])
        
        print(f"  --> RESULT: Verdict={verdict}, Match={sim_str}, SpeechSec={speech_sec:.1f}s, Flags={flags}")
        results.append({
            "session_id": session_id,
            "student_id": student_id,
            "verdict": verdict,
            "similarity": sim,
            "speech_sec": speech_sec,
            "flags": flags,
            "file": os.path.basename(file_path),
            "status": "SUCCESS"
        })
    except Exception as e:
        print(f"  --> ERROR: {e}")
        traceback.print_exc()
        results.append({
            "session_id": session_id,
            "student_id": student_id,
            "error": str(e),
            "file": os.path.basename(file_path),
            "status": "ERROR"
        })

print("\n" + "="*80)
print(f"BATCH FORENSIC RE-ANALYSIS COMPLETE ({len(results)} sessions processed)")
print("="*80)
for r in results:
    if r["status"] == "SUCCESS":
        f_str = ",".join(r["flags"]) if r["flags"] else "NONE"
        sim_val = f"{r['similarity']:.3f}" if isinstance(r['similarity'], (int, float)) else "N/A"
        print(f"[{r['student_id']:<8}] {r['session_id']:<32} | {r['verdict']:<25} | Sim: {sim_val:<7} | Speech: {r['speech_sec']:>5.1f}s | Flags: {f_str}")
    else:
        print(f"[{r['student_id']:<8}] {r['session_id']:<32} | FAILED: {r.get('error')}")
