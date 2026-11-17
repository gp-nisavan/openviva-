#!/usr/bin/env python3
"""
Empirical Concurrency Race Condition and Stale Lease Expiration Test for Issue 10
"""
import time
import requests
import sqlite3
from concurrent.futures import ThreadPoolExecutor

BASE_URL = "http://127.0.0.1:3001/openviva"
DB_PATH = "/home/savan/openviva/storage/openviva.db"

con = sqlite3.connect(DB_PATH)
cur = con.cursor()
cur.execute("UPDATE student_biometrics SET verification_status = 'AUTHENTICATED' WHERE reg_no IN ('reg1', 'reg3')")
TOK1 = "tok_race_reg1"
TOK3 = "tok_race_reg3"
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg1', 0, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK1,))
cur.execute("INSERT OR REPLACE INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, 'reg3', 0, '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (TOK3,))
con.commit()
con.close()

try:
    print("Testing concurrent race condition between reg1 and reg3 for same chamber...")
    RACE_ROOM = "race-chamber-empirical-99"
    # Ensure freed first
    admin_tok = "tok_emp_admin_temp"
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("INSERT OR IGNORE INTO instructors (id, username, display_name, password_hash, salt, role, created_at) VALUES ('inst_race_admin', 'race_admin', 'Admin', 'hash', 'salt', 'ADMIN', '2026-01-01')")
    cur.execute("INSERT OR REPLACE INTO instructor_sessions (token, instructor_id, expires_at, created_at) VALUES (?, 'inst_race_admin', '2099-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')", (admin_tok,))
    con.commit()
    con.close()

    requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {admin_tok}"}, json={"roomName": RACE_ROOM})

    def request_claim(candidate_tok):
        return requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {candidate_tok}"}, json={"roomName": RACE_ROOM})

    with ThreadPoolExecutor(max_workers=2) as executor:
        f1 = executor.submit(request_claim, TOK1)
        f3 = executor.submit(request_claim, TOK3)
        res1 = f1.result()
        res3 = f3.result()

    codes = sorted([res1.status_code, res3.status_code])
    print(f"Concurrent race results: {codes}")
    assert codes == [200, 409], f"Expected one 200 and one 409, got {codes}"
    print("  [PASS] Exactly one candidate won the chamber lock, competitor got 409 Conflict!")

    winner = "reg1" if res1.status_code == 200 else "reg3"
    loser_res = res3 if res1.status_code == 200 else res1
    assert loser_res.json().get("code") == "CHAMBER_OCCUPIED"
    assert loser_res.json().get("occupiedBy") == winner
    print(f"  [PASS] 409 response correctly identifies the winner as {winner}!")

    print("\nTesting natural TTL expiration (30s lease timeout)...")
    print("Waiting 31 seconds without heartbeats to verify stale lease auto-eviction...")
    time.sleep(31)

    loser_tok = TOK3 if winner == "reg1" else TOK1
    res_after_timeout = requests.post(f"{BASE_URL}/api/defense/token", headers={"Authorization": f"Bearer {loser_tok}"}, json={"roomName": RACE_ROOM})
    print(f"Post-timeout claim by former competitor: Status {res_after_timeout.status_code}")
    assert res_after_timeout.status_code == 200, f"Expected 200 after 31s timeout, got {res_after_timeout.status_code}: {res_after_timeout.text}"
    print("  [PASS] Stale lock was automatically evicted after 30s TTL expiry! Former competitor claimed chamber.")

    # Cleanup
    requests.post(f"{BASE_URL}/api/defense/chambers/release", headers={"Authorization": f"Bearer {admin_tok}"}, json={"roomName": RACE_ROOM})

finally:
    con = sqlite3.connect(DB_PATH)
    cur = con.cursor()
    cur.execute("DELETE FROM student_sessions WHERE token IN (?, ?)", (TOK1, TOK3))
    cur.execute("DELETE FROM instructor_sessions WHERE token = ?", (admin_tok,))
    cur.execute("DELETE FROM instructors WHERE id = 'inst_race_admin'")
    con.commit()
    con.close()

print("\nALL CONCURRENCY & TTL EDGE CASES PASSED EMPIRICALLY!")
