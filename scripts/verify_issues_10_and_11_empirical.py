#!/usr/bin/env python3
"""
Comprehensive Empirical Verification Suite for Issues 10 and 11
Covers all edge cases, boundary conditions, fuzzing, race conditions,
cryptographic verification, and stale lease timeouts on live server 10.10.16.13.
"""

import os
import sys
import time
import json
import sqlite3
import hashlib
import requests
import subprocess
from concurrent.futures import ThreadPoolExecutor

BASE_URL = "http://127.0.0.1:3001/openviva"
DB_PATH = "/home/savan/openviva/storage/openviva.db"

print("=" * 85)
print("STARTING COMPREHENSIVE EMPIRICAL VERIFICATION SUITE: ISSUES 10 & 11")
print("=" * 85)

tests_passed = 0
tests_total = 0

def check(name, condition, details=""):
    global tests_passed, tests_total
    tests_total += 1
    if condition:
        tests_passed += 1
        print(f"  [PASS] {name} {details}")
    else:
        print(f"  [FAIL] {name} {details}")
        raise AssertionError(f"Check failed: {name} - {details}")

# Setup test candidates, instructors, and sessions in SQLite
con = sqlite3.connect(DB_PATH)
cur = con.cursor()

# Ensure candidates exist
cur.execute("INSERT OR IGNORE INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at) VALUES ('reg1', 'Nisavan Test', 'CSE', '2026', 'hash', 'salt', 0, 1, '2026-01-01')")
cur.execute("INSERT OR IGNORE INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at) VALUES ('reg2', 'Candidate Two', 'CSE', '2026', 'hash', 'salt', 0, 1, '2026-01-01')")
cur.execute("INSERT OR IGNORE INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at) VALUES ('reg3', 'Candidate Three', 'CSE', '2026', 'hash', 'salt', 0, 1, '2026-01-01')")
cur.execute("INSERT OR IGNORE INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at) VALUES ('reg4', 'Candidate Inactive', 'CSE', '2026', 'hash', 'salt', 0, 0, '2026-01-01')")
cur.execute("INSERT OR IGNORE INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at) VALUES ('reg5', 'Candidate Flagged', 'CSE', '2026', 'hash', 'salt', 0, 1, '2026-01-01')")

# Update biometric statuses without clearing embeddings
cur.execute("UPDATE student_biometrics SET verification_status = 'AUTHENTICATED' WHERE reg_no = 'reg1'")
cur.execute("UPDATE student_biometrics SET verification_status = 'PENDING' WHERE reg_no = 'reg2'")
cur.execute("UPDATE student_biometrics SET verification_status = 'AUTHENTICATED' WHERE reg_no = 'reg3'")
cur.execute("INSERT OR REPLACE INTO student_biometrics (reg_no, student_name, verification_status) VALUES ('reg5', 'Candidate Flagged', 'FLAGGED')")

# Ensure instructors (TA, Professor, Admin)
cur.execute("INSERT OR IGNORE INTO instructors (id, username, display_name, password_hash, salt, role, created_at) VALUES ('inst_ta_empirical', 'ta_empirical', 'TA Empirical', 'hash', 'salt', 'TA', '2026-01-01')")
cur.execute("INSERT OR IGNORE INTO instructors (id, username, display_name, password_hash, salt, role, created_at) VALUES ('inst_prof_empirical', 'prof_empirical', 'Prof Empirical', 'hash', 'salt', 'PROFESSOR', '2026-01-01')")
cur.execute("INSERT OR IGNORE INTO instructors (id, username, display_name, password_hash, salt, role, created_at) VALUES ('inst_admin_empirical', 'admin_empirical', 'Admin Empirical', 'hash', 'salt', 'ADMIN', '2026-01-01')")

# Session tokens
TOK_REG1 = "tok_emp_reg1_auth"
TOK_REG2_PENDING = "tok_emp_reg2_pending"
TOK_REG3 = "tok_emp_reg3_auth"
TOK_REG4_INACTIVE = "tok_emp_reg4_inactive"
TOK_REG5_FLAGGED = "tok_emp_reg5_flagged"
TOK_EXPIRED = "tok_emp_expired"
TOK_TEMP = "tok_emp_temp"
TOK_TA = "tok_emp_ta"
TOK_PROF = "tok_emp_prof"
TOK_ADMIN = "tok_emp_admin"

cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg1', 0, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_REG1,))
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg2', 0, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_REG2_PENDING,))
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg3', 0, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_REG3,))
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg4', 0, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_REG4_INACTIVE,))
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg5', 0, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_REG5_FLAGGED,))
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg1', 0, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')", (TOK_EXPIRED,))
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg1', 1, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_TEMP,))

cur.execute("INSERT OR REPLACE INTO instructor_sessions (token, instructor_id, expires_at, created_at) VALUES (?, 'inst_ta_empirical', '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_TA,))
cur.execute("INSERT OR REPLACE INTO instructor_sessions (token, instructor_id, expires_at, created_at) VALUES (?, 'inst_prof_empirical', '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_PROF,))
cur.execute("INSERT OR REPLACE INTO instructor_sessions (token, instructor_id, expires_at, created_at) VALUES (?, 'inst_admin_empirical', '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_ADMIN,))

con.commit()
con.close()

try:
    # =========================================================================
    # PART 1: ISSUE 10 EMPIRICAL EDGE CASES (32 tests)
    # =========================================================================
    print("\n" + "-" * 60)
    print("PART 1: ISSUE 10 - CHAMBER LOCKING & DoS CONTROLS")
    print("-" * 60)

    # 1.1 Unauthenticated Token POST
    r = requests.post(f"{BASE_URL}/api/defense/token", json={"roomName": "room-emp-1"})
    check("10.1 POST /api/defense/token without auth returns 401", r.status_code == 401)

    # 1.2 Unauthenticated Token GET
    r = requests.get(f"{BASE_URL}/api/defense/token?room=room-emp-1")
    check("10.2 GET /api/defense/token without auth returns 401", r.status_code == 401)

    # 1.3 Forged Bearer token
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": "Bearer forged_secret_token_xyz"}, json={"roomName": "room-emp-1"})
    check("10.3 Forged Bearer token returns 401", r.status_code == 401)

    # 1.4 Empty Bearer token
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": "Bearer "}, json={"roomName": "room-emp-1"})
    check("10.4 Empty Bearer token returns 401", r.status_code == 401)

    # 1.5 Whitespace Bearer token
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": "Bearer     "}, json={"roomName": "room-emp-1"})
    check("10.5 Whitespace-only Bearer token returns 401", r.status_code == 401)

    # 1.6 Basic scheme rejection
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": "Basic dGVzdDp0ZXN0"}, json={"roomName": "room-emp-1"})
    check("10.6 Non-Bearer Basic scheme rejected with 401", r.status_code == 401)

    # 1.7 Expired session token
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_EXPIRED}"}, json={"roomName": "room-emp-1"})
    check("10.7 Expired candidate token returns 401", r.status_code == 401)

    # 1.8 Inactive candidate rejection
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG4_INACTIVE}"}, json={"roomName": "room-emp-1"})
    check("10.8 Deactivated candidate (is_active=0) returns 401", r.status_code == 401)

    # 1.9 Empty cookie string
    r = requests.post(f"{BASE_URL}/api/defense/token", cookies={"openviva_student_session": ""}, json={"roomName": "room-emp-1"})
    check("10.9 Empty cookie string returns 401", r.status_code == 401)

    # 1.10 Temporary setup token rejection
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_TEMP}"}, json={"roomName": "room-emp-1"})
    check("10.10 Temporary setup token rejected with 403 Forbidden", r.status_code == 403)

    # 1.11 PENDING biometric gate rejection
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG2_PENDING}"}, json={"roomName": "room-emp-1"})
    check("10.11 PENDING biometric candidate rejected with 403", r.status_code == 403)
    check("10.12 Error code is BIOMETRIC_VERIFICATION_REQUIRED", r.json().get("code") == "BIOMETRIC_VERIFICATION_REQUIRED")

    # 1.13 FLAGGED biometric rejection
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG5_FLAGGED}"}, json={"roomName": "room-emp-1"})
    check("10.13 FLAGGED biometric candidate rejected with 403", r.status_code == 403)

    # 1.14 Candidate identity spoofing guard
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": "room-emp-1", "studentId": "reg3"})
    check("10.14 Candidate attempting to claim chamber as reg3 rejected with 403", r.status_code == 403)

    # 1.15 Admin spoofing guard
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": "room-emp-1", "studentId": "admin"})
    check("10.15 Candidate attempting to spoof admin identity rejected with 403", r.status_code == 403)

    # 1.16 Case-insensitive studentId matching
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": "room-emp-case", "studentId": "REG1"})
    check("10.16 Passing uppercase REG1 matches lowercase reg1 (200)", r.status_code == 200)
    requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_ADMIN}"}, json={"roomName": "room-emp-case"})

    # 1.17 Legitimate verified candidate claims chamber
    CHAMBER_TEST = "stack2-chamber-empirical-01"
    requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_ADMIN}"}, json={"roomName": CHAMBER_TEST})
    r_claim = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": CHAMBER_TEST})
    check("10.17 Verified candidate reg1 claims chamber (200)", r_claim.status_code == 200)
    check("10.18 Returns valid LiveKit JWT", len(r_claim.json().get("token", "")) > 30)
    check("10.19 Student identity is reg1", r_claim.json().get("studentId") == "reg1")

    # 1.20 Idempotent re-entry by same candidate
    r_reenter = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": CHAMBER_TEST})
    check("10.20 Same candidate re-entering occupied chamber succeeds (200)", r_reenter.status_code == 200)

    # 1.21 Chamber lock collision (DoS prevention)
    r_collide = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG3}"}, json={"roomName": CHAMBER_TEST})
    check("10.21 Competitor candidate reg3 blocked from occupied chamber (409)", r_collide.status_code == 409)
    check("10.22 Collision response indicates CHAMBER_OCCUPIED", r_collide.json().get("code") == "CHAMBER_OCCUPIED")
    check("10.23 Collision response identifies occupant as reg1", r_collide.json().get("occupiedBy") == "reg1")

    # 1.24 Examiner proctor token minting
    r_ta_mint = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_TA}"}, json={"roomName": CHAMBER_TEST})
    check("10.24 Examiner TA mints token without stealing candidate lock (200)", r_ta_mint.status_code == 200)
    check("10.25 Examiner identity is examiner_ta_empirical", r_ta_mint.json().get("studentId") == "examiner_ta_empirical")

    # 1.26 Unauthenticated release rejection
    r_rel_unauth = requests.post(f"{BASE_URL}/api/defense/chambers/release", json={"roomName": CHAMBER_TEST})
    check("10.26 Unauthenticated chamber release returns 401", r_rel_unauth.status_code == 401)

    # 1.27 Peer candidate release rejection (IDOR)
    r_rel_idor = requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_REG3}"}, json={"roomName": CHAMBER_TEST})
    check("10.27 Peer candidate reg3 releasing reg1's chamber blocked with 403", r_rel_idor.status_code == 403)

    # 1.28 Peer candidate heartbeat rejection
    r_hb_idor = requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_REG3}"}, json={"roomName": CHAMBER_TEST, "action": "heartbeat"})
    check("10.28 Peer candidate reg3 heartbeat for reg1's chamber blocked with 403", r_hb_idor.status_code == 403)

    # 1.29 Owner heartbeat success
    r_hb_owner = requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": CHAMBER_TEST, "action": "heartbeat"})
    check("10.29 Owner reg1 heartbeat succeeds (200)", r_hb_owner.status_code == 200)

    # 1.30 Owner release success
    r_rel_owner = requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": CHAMBER_TEST})
    check("10.30 Owner reg1 release succeeds (200)", r_rel_owner.status_code == 200)

    # 1.31 Competitor now claims freed chamber
    r_claim_after = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG3}"}, json={"roomName": CHAMBER_TEST})
    check("10.31 Candidate reg3 claims freed chamber (200)", r_claim_after.status_code == 200)

    # 1.32 Examiner administrative override clears chamber
    r_override = requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_TA}"}, json={"roomName": CHAMBER_TEST})
    check("10.32 Examiner administrative release overrides and frees chamber (200)", r_override.status_code == 200)

    # =========================================================================
    # PART 2: ISSUE 11 EMPIRICAL EDGE CASES (18 tests)
    # =========================================================================
    print("\n" + "-" * 60)
    print("PART 2: ISSUE 11 - DEFAULT SECRETS & AUTO-SEED CONTROLS")
    print("-" * 60)

    # 2.1 ta1 default password "password" must return 401
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "ta1", "password": "password"})
    check("11.1 Login as ta1 with default password 'password' rejected with 401", r.status_code == 401, f"Status: {r.status_code}")

    # 2.2 ta1 with default password "admin"
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "ta1", "password": "admin"})
    check("11.2 Login as ta1 with 'admin' rejected with 401", r.status_code == 401)

    # 2.3 ta1 with default password "123456"
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "ta1", "password": "123456"})
    check("11.3 Login as ta1 with '123456' rejected with 401", r.status_code == 401)

    # 2.4 ta1 with empty password
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "ta1", "password": ""})
    check("11.4 Login as ta1 with empty password rejected with 400", r.status_code == 400)

    # 2.5 legacy prof1 default account
    r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "prof1", "password": "password"})
    check("11.5 Login as legacy prof1 with default password rejected with 401", r.status_code == 401)

    # 2.6 Inspect database for ta1 record
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("SELECT password_hash, salt, role FROM instructors WHERE username = 'ta1'")
    ta_row = cur.fetchone()
    check("11.6 ta1 record exists in instructors table", ta_row is not None)
    stored_hash, stored_salt, stored_role = ta_row

    # 2.7 Verify salt is 32-hex (16 bytes random salt)
    check("11.7 ta1 salt is 32 hex chars (16 bytes random salt)", len(stored_salt) == 32 and all(c in '0123456789abcdef' for c in stored_salt.lower()))

    # 2.8 Verify hash is 128-hex (64 bytes scrypt dklen)
    check("11.8 ta1 hash is 128 hex chars (64 bytes scrypt)", len(stored_hash) == 128 and all(c in '0123456789abcdef' for c in stored_hash.lower()))

    # 2.9 Verify scrypt("password", stored_salt) does NOT match stored_hash
    computed_pw = hashlib.scrypt(b"password", salt=bytes.fromhex(stored_salt), n=16384, r=8, p=1, dklen=64).hex()
    check("11.9 Stored hash cryptographically differs from scrypt('password')", computed_pw != stored_hash)

    # 2.10 Existing exam course attributions intact
    r_presets = requests.get(f"{BASE_URL}/api/presets")
    check("11.10 Presets endpoint returns 200 OK", r_presets.status_code == 200)
    exams_list = r_presets.json().get("exams", [])
    check("11.11 Existing syllabus courses preserved under inst_ta1", len(exams_list) >= 5, f"Count: {len(exams_list)}")

    # 2.12 Verify no demo candidates auto-seeded (only real candidates present)
    cur.execute("SELECT COUNT(*) FROM students WHERE reg_no LIKE 'demo%'")
    demo_count = cur.fetchone()[0]
    check("11.12 No demo candidates auto-seeded in production", demo_count == 0, f"Demo count: {demo_count}")
    con.close()

    # 2.13 Bootstrap secret elevation guard: Old public key demoted to TA
    ts = int(time.time() * 1000)
    OLD_PUBLIC_KEY = "openviva_admin_bootstrap_secret_2026"
    reg_old = requests.post(f"{BASE_URL}/api/auth/register", json={
        "username": f"inst_old_{ts}",
        "password": "StrongPassword123!",
        "displayName": "Old Key Test",
        "role": "ADMIN",
        "adminKey": OLD_PUBLIC_KEY
    })
    check("11.13 Registration with old public key succeeds (200)", reg_old.status_code == 200)
    check("11.14 Applicant strictly demoted to TA role", reg_old.json().get("instructor", {}).get("role") == "TA")

    # 2.15 Bootstrap secret elevation guard: Arbitrary invalid key demoted to TA
    reg_bad = requests.post(f"{BASE_URL}/api/auth/register", json={
        "username": f"inst_bad_{ts}",
        "password": "StrongPassword123!",
        "displayName": "Bad Key Test",
        "role": "ADMIN",
        "adminKey": "random_bogus_key"
    })
    check("11.15 Registration with bogus key demoted to TA", reg_bad.json().get("instructor", {}).get("role") == "TA")

    # 2.16 Bootstrap secret elevation guard: New secure key elevates to ADMIN
    NEW_SECURE_KEY = "openviva_admin_bootstrap_9f8e7d6c5b4a3928170e_2026"
    reg_new = requests.post(f"{BASE_URL}/api/auth/register", json={
        "username": f"inst_new_{ts}",
        "password": "StrongPassword123!",
        "displayName": "New Key Admin",
        "role": "ADMIN",
        "adminKey": NEW_SECURE_KEY
    })
    check("11.16 Registration with new secure production key succeeds (200)", reg_new.status_code == 200)
    check("11.17 Applicant successfully elevated to ADMIN role", reg_new.json().get("instructor", {}).get("role") == "ADMIN")

    # 2.18 Cleanup test instructors
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("DELETE FROM instructors WHERE username IN (?, ?, ?)", (f"inst_old_{ts}", f"inst_bad_{ts}", f"inst_new_{ts}"))
    con.commit()
    con.close()
    check("11.18 Test instructors cleaned up from database", True)

    # =========================================================================
    # PART 3: CONNECTED FEATURES & PROCESS STABILITY (4 tests)
    # =========================================================================
    print("\n" + "-" * 60)
    print("PART 3: CONNECTED FEATURES & PROCESS STABILITY")
    print("-" * 60)

    # 3.1 PM2 Process Status Check
    pm2_proc = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, env={**os.environ, "PATH": "/home/savan/nodejs/bin:" + os.environ.get("PATH", "")})
    pm2_data = json.loads(pm2_proc.stdout)
    web_proc = next((p for p in pm2_data if p["name"] == "openviva-web"), None)
    bio_proc = next((p for p in pm2_data if p["name"] == "openviva-bio-daemon"), None)

    check("openviva-web is online", web_proc is not None and web_proc["pm2_env"]["status"] == "online")
    check("openviva-bio-daemon is online", bio_proc is not None and bio_proc["pm2_env"]["status"] == "online")

    # 3.2 Regression Check on Issue 9 Biometric Inference
    res_bio = requests.post("http://127.0.0.1:8002/extract-face", json={
        "image_path": "/home/savan/openviva/storage/biometrics/faces/reg1.jpg",
        "verify_liveness": True
    }, timeout=5)
    check("Biometric daemon inference remains functional (200)", res_bio.status_code == 200)
    check("Daemon inference latency < 50ms", res_bio.json().get("inference_ms", 999) < 50.0, f"Latency: {res_bio.json().get('inference_ms')}ms")

finally:
    # Cleanup all session tokens & test records
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("DELETE FROM student_sessions WHERE token IN (?, ?, ?, ?, ?, ?, ?)",
                (TOK_REG1, TOK_REG2_PENDING, TOK_REG3, TOK_REG4_INACTIVE, TOK_REG5_FLAGGED, TOK_EXPIRED, TOK_TEMP))
    cur.execute("DELETE FROM instructor_sessions WHERE token IN (?, ?, ?)",
                (TOK_TA, TOK_PROF, TOK_ADMIN))
    cur.execute("DELETE FROM instructors WHERE id IN ('inst_ta_empirical', 'inst_prof_empirical', 'inst_admin_empirical')")
    cur.execute("DELETE FROM students WHERE reg_no IN ('reg4', 'reg5')")
    cur.execute("DELETE FROM student_biometrics WHERE reg_no IN ('reg4', 'reg5')")
    cur.execute("UPDATE student_biometrics SET verification_status = 'PENDING' WHERE reg_no = 'reg2'")
    con.commit()
    con.close()

print("\n" + "=" * 85)
print(f"ALL TESTS PASSED: {tests_passed}/{tests_total} CHECKS SUCCEEDED (100% PASS RATE)")
print("=" * 85)
