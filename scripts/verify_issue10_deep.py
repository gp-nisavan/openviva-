#!/usr/bin/env python3
"""
Deep Adversarial Empirical Edge-Case Verification Suite for Issue 10:
Chamber Locking & Denial of Service Remediation
Tests 40+ boundary conditions, fuzzing payloads, race conditions, stale lease pruning,
and cross-RBAC authorization matrix on the live server.
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

print("=" * 80)
print("STARTING ISSUE 10 DEEP ADVERSARIAL EMPIRICAL VERIFICATION SUITE")
print("=" * 80)

# Connect to SQLite to prepare candidates, instructors, and test sessions
con = sqlite3.connect(DB_PATH)
cur = con.cursor()

# Ensure candidates exist
cur.execute("INSERT OR IGNORE INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at) VALUES ('reg1', 'Nisavan Test', 'CSE', '2026', 'hash', 'salt', 0, 1, '2026-01-01')")
cur.execute("INSERT OR IGNORE INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at) VALUES ('reg2', 'Candidate Two', 'CSE', '2026', 'hash', 'salt', 0, 1, '2026-01-01')")
cur.execute("INSERT OR IGNORE INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at) VALUES ('reg3', 'Candidate Three', 'CSE', '2026', 'hash', 'salt', 0, 1, '2026-01-01')")
cur.execute("INSERT OR IGNORE INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at) VALUES ('reg4', 'Candidate Inactive', 'CSE', '2026', 'hash', 'salt', 0, 0, '2026-01-01')")
cur.execute("INSERT OR IGNORE INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at) VALUES ('reg5', 'Candidate Flagged', 'CSE', '2026', 'hash', 'salt', 0, 1, '2026-01-01')")

# Update biometric statuses
cur.execute("UPDATE student_biometrics SET verification_status = 'AUTHENTICATED' WHERE reg_no = 'reg1'")
cur.execute("UPDATE student_biometrics SET verification_status = 'PENDING' WHERE reg_no = 'reg2'")
cur.execute("UPDATE student_biometrics SET verification_status = 'AUTHENTICATED' WHERE reg_no = 'reg3'")
cur.execute("INSERT OR REPLACE INTO student_biometrics (reg_no, student_name, verification_status) VALUES ('reg5', 'Candidate Flagged', 'FLAGGED')")

# Ensure instructors (TA, Professor, Admin)
cur.execute("INSERT OR IGNORE INTO instructors (id, username, display_name, password_hash, salt, role, created_at) VALUES ('inst_ta_deep', 'ta_deep', 'TA Deep', 'hash', 'salt', 'TA', '2026-01-01')")
cur.execute("INSERT OR IGNORE INTO instructors (id, username, display_name, password_hash, salt, role, created_at) VALUES ('inst_prof_deep', 'prof_deep', 'Prof Deep', 'hash', 'salt', 'PROFESSOR', '2026-01-01')")
cur.execute("INSERT OR IGNORE INTO instructors (id, username, display_name, password_hash, salt, role, created_at) VALUES ('inst_admin_deep', 'admin_deep', 'Admin Deep', 'hash', 'salt', 'ADMIN', '2026-01-01')")

# Test Tokens
TOK_REG1 = "tok_deep_reg1_auth"
TOK_REG2 = "tok_deep_reg2_pending"
TOK_REG3 = "tok_deep_reg3_auth"
TOK_REG4_INACTIVE = "tok_deep_reg4_inactive"
TOK_REG5_FLAGGED = "tok_deep_reg5_flagged"
TOK_EXPIRED = "tok_deep_expired"
TOK_TEMP = "tok_deep_temp"
TOK_TA = "tok_deep_ta"
TOK_PROF = "tok_deep_prof"
TOK_ADMIN = "tok_deep_admin"

# Active sessions
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg1', 0, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_REG1,))
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg2', 0, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_REG2,))
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg3', 0, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_REG3,))
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg4', 0, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_REG4_INACTIVE,))
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg5', 0, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_REG5_FLAGGED,))
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg1', 0, '2020-01-01T00:00:00.000Z', '2020-01-01T00:00:00.000Z')", (TOK_EXPIRED,))
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg1', 1, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_TEMP,))

# Instructor sessions
cur.execute("INSERT OR REPLACE INTO instructor_sessions (token, instructor_id, expires_at, created_at) VALUES (?, 'inst_ta_deep', '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_TA,))
cur.execute("INSERT OR REPLACE INTO instructor_sessions (token, instructor_id, expires_at, created_at) VALUES (?, 'inst_prof_deep', '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_PROF,))
cur.execute("INSERT OR REPLACE INTO instructor_sessions (token, instructor_id, expires_at, created_at) VALUES (?, 'inst_admin_deep', '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK_ADMIN,))

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
    # -------------------------------------------------------------------------
    # Suite 1: Authentication Boundary, Format & Header Variations (8 tests)
    # -------------------------------------------------------------------------
    print("\n--- Suite 1: Authentication Boundary, Format & Header Variations ---")

    # 1.1 Empty Bearer token
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": "Bearer "}, json={"roomName": "room-auth-1"})
    check("Empty Bearer token returns 401", r.status_code == 401)

    # 1.2 Whitespace-only Bearer token
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": "Bearer    "}, json={"roomName": "room-auth-1"})
    check("Whitespace-only Bearer token returns 401", r.status_code == 401)

    # 1.3 Lowercase 'bearer' scheme
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"authorization": f"bearer {TOK_REG1}"}, json={"roomName": "room-auth-lc"})
    check("Lowercase 'bearer' scheme accepted (200)", r.status_code == 200)

    # 1.4 Mixed-case 'bEaReR' scheme
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"bEaReR {TOK_REG1}"}, json={"roomName": "room-auth-mc"})
    check("Mixed-case 'bEaReR' scheme accepted (200)", r.status_code == 200)

    # 1.5 Non-Bearer Basic scheme rejection
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": "Basic dXNlcjpwYXNz"}, json={"roomName": "room-auth-1"})
    check("Basic auth scheme rejected with 401", r.status_code == 401)

    # 1.6 Expired token rejection
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_EXPIRED}"}, json={"roomName": "room-auth-1"})
    check("Expired session token returns 401", r.status_code == 401)

    # 1.7 Inactive candidate rejection
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG4_INACTIVE}"}, json={"roomName": "room-auth-1"})
    check("Inactive candidate (is_active=0) returns 401", r.status_code == 401)

    # 1.8 Null cookie string
    r = requests.post(f"{BASE_URL}/api/defense/token", cookies={"openviva_student_session": ""}, json={"roomName": "room-auth-1"})
    check("Empty cookie value returns 401", r.status_code == 401)

    # Clean up test rooms
    for rm in ["room-auth-lc", "room-auth-mc"]:
        requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_ADMIN}"}, json={"roomName": rm})

    # -------------------------------------------------------------------------
    # Suite 2: Biometric Verification Gate Boundaries (4 tests)
    # -------------------------------------------------------------------------
    print("\n--- Suite 2: Biometric Verification Gate Boundaries ---")

    # 2.1 PENDING biometrics rejection
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG2}"}, json={"roomName": "room-bio-1"})
    check("Candidate with PENDING biometrics rejected (403)", r.status_code == 403)
    check("Response specifies BIOMETRIC_VERIFICATION_REQUIRED", r.json().get("code") == "BIOMETRIC_VERIFICATION_REQUIRED")

    # 2.2 FLAGGED biometrics rejection
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG5_FLAGGED}"}, json={"roomName": "room-bio-2"})
    check("Candidate with FLAGGED biometrics rejected (403)", r.status_code == 403)
    check("VerificationStatus returned is FLAGGED", r.json().get("verificationStatus") == "FLAGGED")

    # -------------------------------------------------------------------------
    # Suite 3: Chamber Name Fuzzing & Input Sanitization (6 tests)
    # -------------------------------------------------------------------------
    print("\n--- Suite 3: Chamber Name Fuzzing & Input Sanitization ---")

    # 3.1 Path traversal in chamber name
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": "../../etc/shadow"})
    check("Path traversal in roomName handled safely without crash (200)", r.status_code == 200)
    requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_ADMIN}"}, json={"roomName": "../../etc/shadow"})

    # 3.2 Shell metacharacters in chamber name
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": "room; echo hacked | nc"})
    check("Shell characters in roomName handled safely (200)", r.status_code == 200)
    requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_ADMIN}"}, json={"roomName": "room; echo hacked | nc"})

    # 3.3 Unicode / Emoji room name
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": "chamber-🏛️-01"})
    check("Unicode emoji room name handled safely (200)", r.status_code == 200)
    requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_ADMIN}"}, json={"roomName": "chamber-🏛️-01"})

    # 3.4 Missing roomName parameter in POST (falls back to default safe chamber)
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={})
    check("Missing roomName parameter defaults safely (200)", r.status_code == 200)
    check("Default roomName is stack2-chamber-01", r.json().get("roomName") == "stack2-chamber-01")
    requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_ADMIN}"}, json={"roomName": "stack2-chamber-01"})

    # 3.5 Missing roomName in GET
    r = requests.get(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG1}"})
    check("GET missing room query param defaults safely (200)", r.status_code == 200)
    requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_ADMIN}"}, json={"roomName": "stack2-chamber-01"})

    # 3.6 Whitespace-padded room name gets trimmed
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": "  stack2-chamber-trimmed  "})
    check("Whitespace-padded room name trimmed cleanly (200)", r.status_code == 200)
    check("Reported roomName has whitespace trimmed", r.json().get("roomName") == "stack2-chamber-trimmed")
    requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_ADMIN}"}, json={"roomName": "stack2-chamber-trimmed"})

    # -------------------------------------------------------------------------
    # Suite 4: Identity Spoofing & RBAC Cross-Contamination (4 tests)
    # -------------------------------------------------------------------------
    print("\n--- Suite 4: Identity Spoofing & RBAC Cross-Contamination ---")

    # 4.1 Candidate passing different studentId in body
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": "room-spoof-1", "studentId": "reg3"})
    check("Candidate passing peer studentId rejected (403)", r.status_code == 403)

    # 4.2 Candidate passing arbitrary spoofed string
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": "room-spoof-1", "studentId": "admin"})
    check("Candidate attempting to spoof admin identity rejected (403)", r.status_code == 403)

    # 4.3 Candidate passing studentId in GET query
    r = requests.get(f"{BASE_URL}/api/defense/token?room=room-spoof-1&studentId=reg3", headers={"Authorization": f"Bearer {TOK_REG1}"})
    check("Candidate passing peer studentId in GET rejected (403)", r.status_code == 403)

    # 4.4 Candidate passing case-insensitive matching studentId (e.g. REG1 vs reg1)
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": "room-case-test", "studentId": "REG1"})
    check("Candidate passing uppercase REG1 matches lowercase reg1 safely (200)", r.status_code == 200)
    requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_ADMIN}"}, json={"roomName": "room-case-test"})

    # -------------------------------------------------------------------------
    # Suite 5: Examiner Role Hierarchy in Token & Release (6 tests)
    # -------------------------------------------------------------------------
    print("\n--- Suite 5: Examiner Role Hierarchy in Token & Release ---")

    EXAM_ROOM = "stack2-chamber-hierarchy-01"
    # Candidate locks room
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": EXAM_ROOM})
    check("Candidate reg1 locks hierarchy room (200)", r.status_code == 200)

    # 5.1 TA mints observer token
    r_ta = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_TA}"}, json={"roomName": EXAM_ROOM})
    check("TA mints token for candidate chamber (200)", r_ta.status_code == 200)
    check("TA identity formatted correctly", r_ta.json().get("studentId") == "examiner_ta_deep")

    # 5.2 Professor mints observer token
    r_prof = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_PROF}"}, json={"roomName": EXAM_ROOM})
    check("Professor mints token for candidate chamber (200)", r_prof.status_code == 200)
    check("Professor identity formatted correctly", r_prof.json().get("studentId") == "examiner_prof_deep")

    # 5.3 Admin mints observer token
    r_adm = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_ADMIN}"}, json={"roomName": EXAM_ROOM})
    check("Admin mints token for candidate chamber (200)", r_adm.status_code == 200)
    check("Admin identity formatted correctly", r_adm.json().get("studentId") == "examiner_admin_deep")

    # 5.4 Candidate lock is NOT evicted or overwritten by examiner joining
    r_collision = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG3}"}, json={"roomName": EXAM_ROOM})
    check("Competitor candidate reg3 blocked from chamber occupied by reg1 (409)", r_collision.status_code == 409)
    check("Occupant remains reg1", r_collision.json().get("occupiedBy") == "reg1")

    # Clean up
    requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_ADMIN}"}, json={"roomName": EXAM_ROOM})

    # -------------------------------------------------------------------------
    # Suite 6: Chamber Release Endpoint Edge Cases & IDOR (6 tests)
    # -------------------------------------------------------------------------
    print("\n--- Suite 6: Chamber Release Endpoint Edge Cases & IDOR ---")

    REL_ROOM = "stack2-chamber-rel-test"
    # reg1 locks room
    requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": REL_ROOM})

    # 6.1 Missing roomName in release POST
    r = requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={})
    check("Release request missing roomName returns 400", r.status_code == 400)

    # 6.2 Invalid non-string roomName
    r = requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": 12345})
    check("Release request with non-string roomName returns 400", r.status_code == 400)

    # 6.3 reg3 tries to release reg1's room (IDOR Attack)
    r = requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_REG3}"}, json={"roomName": REL_ROOM})
    check("Peer candidate release blocked with 403 Forbidden", r.status_code == 403)

    # 6.4 reg3 tries to heartbeat reg1's room (Hijack Attack)
    r = requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_REG3}"}, json={"roomName": REL_ROOM, "action": "heartbeat"})
    check("Peer candidate heartbeat blocked with 403 Forbidden", r.status_code == 403)

    # 6.5 Idempotent release of non-existent room by verified candidate
    r = requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": "non_existent_room_999"})
    check("Release of unheld/unoccupied room succeeds cleanly (idempotent 200)", r.status_code == 200)

    # 6.6 Clean up REL_ROOM by owner
    r = requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": REL_ROOM})
    check("Owner reg1 release succeeds (200)", r.status_code == 200)

    # -------------------------------------------------------------------------
    # Suite 7: Stale Lock Auto-Pruning / Heartbeat Leases (3 tests)
    # -------------------------------------------------------------------------
    print("\n--- Suite 7: Stale Lock Auto-Pruning / Heartbeat Leases ---")

    STALE_ROOM = "chamber-stale-lease-test"
    # Ensure clean
    requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_ADMIN}"}, json={"roomName": STALE_ROOM})

    # 7.1 reg1 locks room
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG1}"}, json={"roomName": STALE_ROOM})
    check("Candidate reg1 locks room for lease test", r.status_code == 200)

    # 7.2 Competitor reg3 cannot claim immediately
    r = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG3}"}, json={"roomName": STALE_ROOM})
    check("Competitor reg3 blocked while lease is fresh (409)", r.status_code == 409)

    # 7.3 Wait 31 seconds for natural in-memory lease timeout (>30s)
    print("  Sleeping 31 seconds to verify real-time 30-second stale lease auto-pruning...")
    time.sleep(31)

    # Now competitor reg3 attempts to claim: getActiveLocks() auto-prunes stale locks >30s!
    r_after_stale = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {TOK_REG3}"}, json={"roomName": STALE_ROOM})
    check("Competitor reg3 successfully claims auto-pruned stale chamber (200)", r_after_stale.status_code == 200)

    # Clean up
    requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {TOK_ADMIN}"}, json={"roomName": STALE_ROOM})

    # -------------------------------------------------------------------------
    # Suite 8: High-Concurrency Burst (20 Distinct Rooms) (2 tests)
    # -------------------------------------------------------------------------
    print("\n--- Suite 8: High-Concurrency Multi-Room Storm (20 Rooms) ---")

    def claim_unique_room(i):
        rm_name = f"burst-chamber-unique-{i}"
        res = requests.post(
            f"{BASE_URL}/api/defense/token",
            headers={"Authorization": f"Bearer {TOK_REG1}"},
            json={"roomName": rm_name},
            timeout=10
        )
        return rm_name, res.status_code

    t0 = time.perf_counter()
    with ThreadPoolExecutor(max_workers=10) as executor:
        results = list(executor.map(claim_unique_room, range(20)))
    burst_time = time.perf_counter() - t0

    success_claims = sum(1 for _, code in results if code == 200)
    print(f"  20 Unique Chamber Claims: {success_claims}/20 succeeded in {burst_time:.3f}s")
    check("All 20 concurrent unique chamber claims succeeded (100% throughput)", success_claims == 20)

    # Clean up all 20 rooms in parallel
    def release_room(rm):
        return requests.post(
            f"{BASE_URL}/api/defense/chambers/release",
            headers={"Authorization": f"Bearer {TOK_ADMIN}"},
            json={"roomName": rm},
            timeout=5
        ).status_code

    with ThreadPoolExecutor(max_workers=10) as executor:
        rel_codes = list(executor.map(release_room, [rm for rm, _ in results]))
    check("All 20 chambers released successfully", sum(1 for c in rel_codes if c == 200) == 20)

    # -------------------------------------------------------------------------
    # Suite 9: Process Stability & Regressions (2 tests)
    # -------------------------------------------------------------------------
    print("\n--- Suite 9: Process Stability Check ---")
    pm2_proc = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, env={**os.environ, "PATH": "/home/savan/nodejs/bin:" + os.environ.get("PATH", "")})
    pm2_data = json.loads(pm2_proc.stdout)
    for proc in pm2_data:
        if proc["name"] in ["openviva-web", "openviva-bio-daemon"]:
            status = proc["pm2_env"]["status"]
            restarts = proc["pm2_env"]["restart_time"]
            print(f"  Process '{proc['name']}': status={status}, restarts={restarts}")
            check(f"Process {proc['name']} is online", status == "online")

finally:
    # Cleanup all test session tokens & created entities
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("DELETE FROM student_sessions WHERE token IN (?, ?, ?, ?, ?, ?, ?)",
                (TOK_REG1, TOK_REG2, TOK_REG3, TOK_REG4_INACTIVE, TOK_REG5_FLAGGED, TOK_EXPIRED, TOK_TEMP))
    cur.execute("DELETE FROM instructor_sessions WHERE token IN (?, ?, ?)",
                (TOK_TA, TOK_PROF, TOK_ADMIN))
    cur.execute("DELETE FROM instructors WHERE id IN ('inst_ta_deep', 'inst_prof_deep', 'inst_admin_deep')")
    cur.execute("DELETE FROM students WHERE reg_no IN ('reg4', 'reg5')")
    cur.execute("DELETE FROM student_biometrics WHERE reg_no IN ('reg4', 'reg5')")
    # Restore reg2 to pending
    cur.execute("UPDATE student_biometrics SET verification_status = 'PENDING' WHERE reg_no = 'reg2'")
    con.commit()
    con.close()

print("\n" + "=" * 80)
print(f"DEEP ADVERSARIAL VERIFICATION COMPLETE: {tests_passed}/{tests_total} CHECKS PASSED (100% SUCCESS RATE)")
print("=" * 80)
