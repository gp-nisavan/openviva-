#!/usr/bin/env python3
"""
Comprehensive Empirical Verification Suite for Issue 11:
Insecure Default Secrets & Production Auto-Seed Remediation
Runs on remote GPU host (127.0.0.1:3001) with direct SQLite inspection.
"""

import os
import sys
import time
import json
import sqlite3
import hashlib
import requests
import subprocess

BASE_URL = "http://127.0.0.1:3001/openviva"
DB_PATH = "/home/savan/openviva/storage/openviva.db"

print("=" * 80)
print("STARTING ISSUE 11 EMPIRICAL VERIFICATION SUITE")
print("=" * 80)

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

# -------------------------------------------------------------------------
# Suite 1: Insecure Default Password Deactivation (4 tests)
# -------------------------------------------------------------------------
print("\n--- Suite 1: Insecure Default Password Deactivation ---")

# 1.1 ta1 with trivial password "password" must return 401
r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "ta1", "password": "password"})
check("ta1 with trivial password 'password' rejected with 401", r.status_code == 401, f"Status: {r.status_code}")

# 1.2 ta1 with trivial password "admin" must return 401
r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "ta1", "password": "admin"})
check("ta1 with trivial password 'admin' rejected with 401", r.status_code == 401)

# 1.3 ta1 with empty password must return 400
r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "ta1", "password": ""})
check("ta1 with empty password rejected with 400", r.status_code == 400)

# 1.4 prof1 (legacy default) must return 401
r = requests.post(f"{BASE_URL}/api/auth/login", json={"username": "prof1", "password": "password"})
check("Legacy default prof1 rejected with 401", r.status_code == 401)

# -------------------------------------------------------------------------
# Suite 2: Cryptographic Database Integrity for ta1 (4 tests)
# -------------------------------------------------------------------------
print("\n--- Suite 2: Cryptographic Database Integrity for ta1 ---")

con = sqlite3.connect(DB_PATH)
cur = con.cursor()
cur.execute("SELECT password_hash, salt, role FROM instructors WHERE username = 'ta1'")
row = cur.fetchone()
check("ta1 record exists in instructors table", row is not None)
stored_hash, stored_salt, role = row

# Verify salt is 32-hex (16 bytes)
check("ta1 salt is 32 hex chars (16 bytes random salt)", len(stored_salt) == 32 and all(c in '0123456789abcdef' for c in stored_salt.lower()))

# Verify hash is 128-hex (64 bytes scrypt dklen)
check("ta1 hash is 128 hex chars (64 bytes scrypt)", len(stored_hash) == 128 and all(c in '0123456789abcdef' for c in stored_hash.lower()))

# Verify that scrypt("password", stored_salt) does NOT match stored_hash
computed_pw = hashlib.scrypt(b"password", salt=bytes.fromhex(stored_salt), n=16384, r=8, p=1, dklen=64).hex()
check("Stored hash cryptographically differs from scrypt('password')", computed_pw != stored_hash)

con.close()

# -------------------------------------------------------------------------
# Suite 3: Existing Exam Attribution Integrity (2 tests)
# -------------------------------------------------------------------------
print("\n--- Suite 3: Existing Exam Attribution Integrity ---")

r_presets = requests.get(f"{BASE_URL}/api/presets")
check("Presets discovery returns 200 OK", r_presets.status_code == 200)
presets_data = r_presets.json()
exams = presets_data.get("exams", [])
check("Existing syllabus exams remain intact and accessible", len(exams) > 0, f"Count: {len(exams)}")

# -------------------------------------------------------------------------
# Suite 4: High-Entropy Production Bootstrap Key Guard (4 tests)
# -------------------------------------------------------------------------
print("\n--- Suite 4: High-Entropy Bootstrap Key Guard ---")

OLD_PUBLIC_KEY = "openviva_admin_bootstrap_secret_2026"
NEW_SECURE_KEY = "openviva_admin_bootstrap_9f8e7d6c5b4a3928170e_2026"

ts = int(time.time() * 1000)
# 4.1 Register with old public bootstrap key attempting ADMIN elevation -> must be demoted to TA
reg_old = requests.post(f"{BASE_URL}/api/auth/register", json={
    "username": f"inst_oldkey_{ts}",
    "password": "SecurePassword123!",
    "displayName": "Old Key Test",
    "role": "ADMIN",
    "adminKey": OLD_PUBLIC_KEY
})
check("Registration with old public key succeeds as TA (demoted)", reg_old.status_code == 200, f"Status: {reg_old.status_code}, Body: {reg_old.text}")
check("Role strictly demoted to TA", reg_old.json().get("instructor", {}).get("role") == "TA")

# 4.2 Register with new secure production bootstrap key -> succeeds as ADMIN
reg_new = requests.post(f"{BASE_URL}/api/auth/register", json={
    "username": f"inst_newkey_{ts}",
    "password": "SecurePassword123!",
    "displayName": "New Key Admin",
    "role": "ADMIN",
    "adminKey": NEW_SECURE_KEY
})
check("Registration with new production key succeeds as ADMIN", reg_new.status_code == 200, f"Status: {reg_new.status_code}, Body: {reg_new.text}")
check("Role elevated to ADMIN", reg_new.json().get("instructor", {}).get("role") == "ADMIN")

# Clean up test instructors
con = sqlite3.connect(DB_PATH)
cur = con.cursor()
cur.execute("DELETE FROM instructors WHERE username IN (?, ?)", (f"inst_oldkey_{ts}", f"inst_newkey_{ts}"))
con.commit()
con.close()

# -------------------------------------------------------------------------
# Suite 5: Process Stability & Regressions (2 tests)
# -------------------------------------------------------------------------
print("\n--- Suite 5: Process Stability Check ---")
pm2_proc = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, env={**os.environ, "PATH": "/home/savan/nodejs/bin:" + os.environ.get("PATH", "")})
pm2_data = json.loads(pm2_proc.stdout)
for proc in pm2_data:
    if proc["name"] in ["openviva-web", "openviva-bio-daemon"]:
        status = proc["pm2_env"]["status"]
        restarts = proc["pm2_env"]["restart_time"]
        print(f"  Process '{proc['name']}': status={status}, restarts={restarts}")
        check(f"Process {proc['name']} is online", status == "online")

print("\n" + "=" * 80)
print(f"ISSUE 11 VERIFICATION COMPLETE: {tests_passed}/{tests_total} CHECKS SUCCEEDED (100% PASS RATE)")
print("=" * 80)
