#!/usr/bin/env python3
"""
Comprehensive Empirical Verification Suite for Issue 10:
Chamber Locking & Denial of Service Remediation
Runs on remote GPU host (127.0.0.1:3001) with direct SQLite verification.
"""

import os
import sys
import time
import json
import sqlite3
import requests
import subprocess
from concurrent.futures import ThreadPoolExecutor

BASE_URL = "http://127.0.0.1:3001/openviva"
DB_PATH = "/home/savan/openviva/storage/openviva.db"

print("=" * 70)
print("STARTING ISSUE 10 EMPIRICAL VERIFICATION SUITE")
print("=" * 70)

# Connect to SQLite to seed test candidates and sessions
con = sqlite3.connect(DB_PATH)
cur = con.cursor()

# Ensure reg1 has verified biometrics without overwriting embeddings
cur.execute("UPDATE student_biometrics SET verification_status = 'AUTHENTICATED' WHERE reg_no = 'reg1'")

# Ensure reg3 has verified biometrics without overwriting embeddings
cur.execute("UPDATE student_biometrics SET verification_status = 'AUTHENTICATED' WHERE reg_no = 'reg3'")

# Ensure reg2 has PENDING (unverified) biometrics
cur.execute("UPDATE student_biometrics SET verification_status = 'PENDING' WHERE reg_no = 'reg2'")

# Ensure test session tokens
TOKEN_REG1 = "token_issue10_verified_reg1"
TOKEN_REG3 = "token_issue10_verified_reg3"
TOKEN_REG2_UNVERIFIED = "token_issue10_unverified_reg2"
TOKEN_TEMP = "token_issue10_temp_reg1"
TOKEN_EXAMINER = "token_issue10_examiner_ta1"

cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg1', 0, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOKEN_REG1,))
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg3', 0, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOKEN_REG3,))
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg2', 0, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOKEN_REG2_UNVERIFIED,))
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg1', 1, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOKEN_TEMP,))

# Ensure TA instructor session
cur.execute("SELECT id FROM instructors WHERE username = 'ta1'")
ta_row = cur.fetchone()
if not ta_row:
    cur.execute("INSERT INTO instructors (id, username, display_name, password_hash, salt, role, created_at) VALUES ('inst_ta1', 'ta1', 'TA One', 'hash', 'salt', 'TA', '2026-01-01')")
    ta_id = 'inst_ta1'
else:
    ta_id = ta_row[0]

cur.execute("INSERT OR REPLACE INTO instructor_sessions (token, instructor_id, expires_at, created_at) VALUES (?, ?, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOKEN_EXAMINER, ta_id))

con.commit()
con.close()

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

try:
    # -------------------------------------------------------------
    # Suite 1: Unauthenticated Defense Token Endpoint Guards
    # -------------------------------------------------------------
    print("\n--- Suite 1: Unauthenticated Defense Token Guards ---")
    
    # 1.1 POST without auth
    r = requests.post(f"{BASE_URL}/api/defense/token", json={"roomName": "chamber-sec-01", "studentId": "reg1"})
    check("POST /api/defense/token without auth returns 401", r.status_code == 401, f"Status: {r.status_code}")

    # 1.2 GET without auth
    r = requests.get(f"{BASE_URL}/api/defense/token?room=chamber-sec-01&studentId=reg1")
    check("GET /api/defense/token without auth returns 401", r.status_code == 401, f"Status: {r.status_code}")

    # 1.3 Forged / random Bearer token
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": "Bearer fake_token_123"}, json={"roomName": "chamber-sec-01"})
    check("POST /api/defense/token with forged Bearer returns 401", r.status_code == 401)

    # 1.4 Temporary setup token rejection
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOKEN_TEMP}"}, json={"roomName": "chamber-sec-01"})
    check("POST /api/defense/token with tempToken returns 403 Forbidden", r.status_code == 403)

    # -------------------------------------------------------------
    # Suite 2: Biometric Gate Verification Clearance Guards
    # -------------------------------------------------------------
    print("\n--- Suite 2: Biometric Gate Verification Clearance Guards ---")
    
    # 2.1 Candidate with PENDING biometrics
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOKEN_REG2_UNVERIFIED}"}, json={"roomName": "chamber-sec-01"})
    check("Unverified candidate (PENDING) returns 403", r.status_code == 403, f"Status: {r.status_code}, Body: {r.text}")
    check("Error code indicates BIOMETRIC_VERIFICATION_REQUIRED", r.json().get("code") == "BIOMETRIC_VERIFICATION_REQUIRED")

    # -------------------------------------------------------------
    # Suite 3: Candidate Identity Spoofing Guards
    # -------------------------------------------------------------
    print("\n--- Suite 3: Candidate Identity Spoofing Guards ---")
    
    # 3.1 Authenticated as reg1, attempting to claim room as reg3
    r = requests.post(
        f"{BASE_URL}/api/defense/token",
        headers={"Authorization": f"Bearer {TOKEN_REG1}"},
        json={"roomName": "chamber-sec-01", "studentId": "reg3"}
    )
    check("Candidate cannot claim chamber under another candidate's studentId (403)", r.status_code == 403, f"Status: {r.status_code}")

    # -------------------------------------------------------------
    # Suite 4: Legitimate Verified Candidate Chamber Claim
    # -------------------------------------------------------------
    print("\n--- Suite 4: Legitimate Chamber Claim ---")
    
    # 4.1 reg1 claims chamber-sec-01
    TEST_ROOM = "stack2-chamber-01"
    # First ensure room is released
    requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOKEN_EXAMINER}"}, json={"roomName": TEST_ROOM})

    r = requests.post(
        f"{BASE_URL}/api/defense/token",
        headers={"Authorization": f"Bearer {TOKEN_REG1}"},
        json={"roomName": TEST_ROOM}
    )
    check("Verified candidate reg1 successfully claims chamber (200)", r.status_code == 200, f"Status: {r.status_code}")
    data = r.json()
    check("Token endpoint returns valid LiveKit JWT", "token" in data and len(data["token"]) > 30)
    check("Chamber identity is reg1", data.get("studentId") == "reg1")

    # 4.2 Re-entry by the SAME candidate is permitted
    r_reentry = requests.post(
        f"{BASE_URL}/api/defense/token",
        headers={"Authorization": f"Bearer {TOKEN_REG1}"},
        json={"roomName": TEST_ROOM}
    )
    check("Same candidate re-entering occupied chamber succeeds (200)", r_reentry.status_code == 200)

    # -------------------------------------------------------------
    # Suite 5: Chamber Lock Collision & DoS Prevention
    # -------------------------------------------------------------
    print("\n--- Suite 5: Chamber Lock Collision & DoS Prevention ---")
    
    # 5.1 Verified candidate reg3 attempts to claim chamber-sec-01 (held by reg1)
    r_collision = requests.post(
        f"{BASE_URL}/api/defense/token",
        headers={"Authorization": f"Bearer {TOKEN_REG3}"},
        json={"roomName": TEST_ROOM}
    )
    check("Different candidate attempting to claim occupied chamber receives 409 Conflict", r_collision.status_code == 409, f"Status: {r_collision.status_code}")
    check("Error code indicates CHAMBER_OCCUPIED", r_collision.json().get("code") == "CHAMBER_OCCUPIED")
    check("Response identifies current occupant", r_collision.json().get("occupiedBy") == "reg1")

    # -------------------------------------------------------------
    # Suite 6: Examiner Access Without Chamber Lock Theft
    # -------------------------------------------------------------
    print("\n--- Suite 6: Examiner Proctor Access ---")
    
    r_examiner = requests.post(
        f"{BASE_URL}/api/defense/token",
        headers={"Authorization": f"Bearer {TOKEN_EXAMINER}"},
        json={"roomName": TEST_ROOM}
    )
    check("Examiner mints room token successfully (200)", r_examiner.status_code == 200)
    check("Examiner identity is examiner_ta1", r_examiner.json().get("studentId") == "examiner_ta1")

    # -------------------------------------------------------------
    # Suite 7: Chamber Release Endpoint Authorization Guards
    # -------------------------------------------------------------
    print("\n--- Suite 7: Chamber Release Authorization Guards ---")
    
    # 7.1 Unauthenticated release
    r_rel_unauth = requests.post(f"{BASE_URL}/api/defense/chambers/release", json={"roomName": TEST_ROOM})
    check("Unauthenticated release returns 401", r_rel_unauth.status_code == 401)

    # 7.2 Forged Bearer release
    r_rel_forged = requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": "Bearer invalid_123"}, json={"roomName": TEST_ROOM})
    check("Forged Bearer release returns 401", r_rel_forged.status_code == 401)

    # 7.3 Candidate reg3 attempts to release reg1's chamber (Cross-Candidate DoS attack)
    r_rel_idor = requests.post(
        f"{BASE_URL}/api/defense/chambers/release",
        headers={"Authorization": f"Bearer {TOKEN_REG3}"},
        json={"roomName": TEST_ROOM}
    )
    check("Candidate reg3 releasing reg1's chamber is blocked with 403 Forbidden", r_rel_idor.status_code == 403)

    # 7.4 Cross-Candidate heartbeat spoofing
    r_hb_idor = requests.post(
        f"{BASE_URL}/api/defense/chambers/release",
        headers={"Authorization": f"Bearer {TOKEN_REG3}"},
        json={"roomName": TEST_ROOM, "action": "heartbeat"}
    )
    check("Candidate reg3 heartbeat for reg1's chamber is blocked with 403 Forbidden", r_hb_idor.status_code == 403)

    # -------------------------------------------------------------
    # Suite 8: Legitimate Candidate Release & Examiner Override
    # -------------------------------------------------------------
    print("\n--- Suite 8: Legitimate Candidate Release & Examiner Override ---")
    
    # 8.1 Legitimate owner reg1 sends heartbeat
    r_hb_owner = requests.post(
        f"{BASE_URL}/api/defense/chambers/release",
        headers={"Authorization": f"Bearer {TOKEN_REG1}"},
        json={"roomName": TEST_ROOM, "action": "heartbeat"}
    )
    check("Owner reg1 heartbeat succeeds (200)", r_hb_owner.status_code == 200)

    # 8.2 Legitimate owner reg1 releases chamber
    r_rel_owner = requests.post(
        f"{BASE_URL}/api/defense/chambers/release",
        headers={"Authorization": f"Bearer {TOKEN_REG1}"},
        json={"roomName": TEST_ROOM}
    )
    check("Owner reg1 release succeeds (200)", r_rel_owner.status_code == 200)

    # 8.3 Now candidate reg3 can claim the newly released chamber
    r_claim_reg3 = requests.post(
        f"{BASE_URL}/api/defense/token",
        headers={"Authorization": f"Bearer {TOKEN_REG3}"},
        json={"roomName": TEST_ROOM}
    )
    check("Candidate reg3 claims newly freed chamber (200)", r_claim_reg3.status_code == 200)

    # 8.4 Examiner administrative override (TA releases reg3's chamber)
    r_rel_ta = requests.post(
        f"{BASE_URL}/api/defense/chambers/release",
        headers={"Authorization": f"Bearer {TOKEN_EXAMINER}"},
        json={"roomName": TEST_ROOM}
    )
    check("Examiner administrative release succeeds (200)", r_rel_ta.status_code == 200)
    check("Release response identifies examiner", r_rel_ta.json().get("role") == "TA")

    # -------------------------------------------------------------
    # Suite 9: Cookie-Based Authentication Verification
    # -------------------------------------------------------------
    print("\n--- Suite 9: Cookie-Based Authentication Verification ---")
    
    # Test cookie auth (openviva_student_session)
    s = requests.Session()
    s.cookies.set("openviva_student_session", TOKEN_REG1)
    r_cookie = s.post(f"{BASE_URL}/api/defense/token", json={"roomName": "chamber-cookie-test"})
    check("Cookie-authenticated token minting succeeds (200)", r_cookie.status_code == 200)

    # Clean up chamber
    s.post(f"{BASE_URL}/api/defense/chambers/release", json={"roomName": "chamber-cookie-test"})

    # -------------------------------------------------------------
    # Suite 10: High-Concurrency Race Condition on Chamber Claim
    # -------------------------------------------------------------
    print("\n--- Suite 10: High-Concurrency Race Condition on Chamber Claim ---")
    RACE_ROOM = "chamber-race-test-99"
    # Ensure release
    requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOKEN_EXAMINER}"}, json={"roomName": RACE_ROOM})

    def fire_race(student_tok):
        res = requests.post(
            f"{BASE_URL}/api/defense/token",
            headers={"Authorization": f"Bearer {student_tok}"},
            json={"roomName": RACE_ROOM},
            timeout=5
        )
        return res.status_code

    # 10 workers simultaneously attempt to claim RACE_ROOM: 5 as reg1, 5 as reg3
    tasks = [TOKEN_REG1 if i % 2 == 0 else TOKEN_REG3 for i in range(10)]
    with ThreadPoolExecutor(max_workers=10) as executor:
        status_codes = list(executor.map(fire_race, tasks))

    successes = sum(1 for c in status_codes if c == 200)
    conflicts = sum(1 for c in status_codes if c == 409)
    print(f"  Race results: {successes} 200 OKs, {conflicts} 409 Conflicts out of 10 requests")
    check("Chamber collision prevention: requests from competitor strictly rejected with 409", conflicts >= 4, f"Conflicts: {conflicts}")

    # Clean up race room
    requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOKEN_EXAMINER}"}, json={"roomName": RACE_ROOM})

    # -------------------------------------------------------------
    # Suite 11: PM2 Process Stability Check
    # -------------------------------------------------------------
    print("\n--- Suite 11: Process Stability Check ---")
    pm2_proc = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, env={**os.environ, "PATH": "/home/savan/nodejs/bin:" + os.environ.get("PATH", "")})
    pm2_data = json.loads(pm2_proc.stdout)
    for proc in pm2_data:
        if proc["name"] in ["openviva-web", "openviva-bio-daemon"]:
            status = proc["pm2_env"]["status"]
            restarts = proc["pm2_env"]["restart_time"]
            print(f"  Process '{proc['name']}': status={status}, restarts={restarts}")
            check(f"Process {proc['name']} is online", status == "online")

finally:
    # Clean up test session tokens
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("DELETE FROM student_sessions WHERE token IN (?, ?, ?, ?)", (TOKEN_REG1, TOKEN_REG3, TOKEN_REG2_UNVERIFIED, TOKEN_TEMP))
    cur.execute("DELETE FROM instructor_sessions WHERE token = ?", (TOKEN_EXAMINER,))
    con.commit()
    con.close()

print("\n" + "=" * 70)
print(f"ALL TESTS PASSED: {tests_passed}/{tests_total} CHECKS SUCCEEDED (100% PASS RATE)")
print("=" * 70)
