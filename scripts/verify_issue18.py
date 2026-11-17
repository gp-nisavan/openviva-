#!/usr/bin/env python3
"""
Comprehensive Empirical Verification Suite for Issue 18:
Missing HTTP Security Headers (X-Frame-Options, X-Content-Type-Options, Referrer-Policy, Permissions-Policy)

Empirically queries multiple routes, methods, and error conditions on live server 10.10.16.13.
"""

import os
import sys
import json
import requests
import subprocess

BASE_URL = "http://127.0.0.1:3001/openviva"

print("=" * 80)
print("STARTING EMPIRICAL VERIFICATION SUITE: ISSUE 18 (SECURITY HEADERS)")
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

REQUIRED_SECURITY_HEADERS = {
    "x-frame-options": "DENY",
    "x-content-type-options": "nosniff",
    "referrer-policy": "strict-origin-when-cross-origin",
    "permissions-policy": "camera=(self), microphone=(self)",
    "cross-origin-opener-policy": "same-origin",
    "cross-origin-embedder-policy": "credentialless"
}

def verify_headers_for_response(route_label, response):
    headers_lower = {k.lower(): v for k, v in response.headers.items()}
    for header_name, expected_value in REQUIRED_SECURITY_HEADERS.items():
        val = headers_lower.get(header_name)
        check(
            f"[{route_label}] Header '{header_name}' matches expected value",
            val is not None and expected_value.lower() in val.lower(),
            f"Actual: '{val}' | Expected: '{expected_value}'"
        )

# =========================================================================
# SUITE 1: ROOT & PRIMARY PAGE ROUTES
# =========================================================================
print("\n--- SUITE 1: HTML PAGES (ROOT, DEFENSE, PROCTOR LAB) ---")

# 1.1 Root Home Page
r_home = requests.get(f"{BASE_URL}", timeout=5)
check("18.1 Root page GET /openviva returns 200", r_home.status_code == 200)
verify_headers_for_response("GET /openviva", r_home)

# 1.2 Defense Oral Chamber Page
r_defense = requests.get(f"{BASE_URL}/defense", timeout=5)
check("18.2 Defense page GET /openviva/defense returns 200", r_defense.status_code == 200)
verify_headers_for_response("GET /openviva/defense", r_defense)

# 1.3 Proctor Lab Page
r_proctor = requests.get(f"{BASE_URL}/proctor-lab", timeout=5)
check("18.3 Proctor lab GET /openviva/proctor-lab returns 200", r_proctor.status_code == 200)
verify_headers_for_response("GET /openviva/proctor-lab", r_proctor)

# 1.4 LLM Lab Page
r_llm = requests.get(f"{BASE_URL}/llm-lab", timeout=5)
check("18.4 LLM lab GET /openviva/llm-lab returns 200", r_llm.status_code == 200)
verify_headers_for_response("GET /openviva/llm-lab", r_llm)

# =========================================================================
# SUITE 2: REST API ROUTES & ERROR RESPONSES
# =========================================================================
print("\n--- SUITE 2: REST API ROUTES & ERROR CODES ---")

# 2.1 Presets API (200 OK)
r_presets = requests.get(f"{BASE_URL}/api/presets", timeout=5)
check("18.5 Presets API GET /openviva/api/presets returns 200", r_presets.status_code == 200)
verify_headers_for_response("GET /openviva/api/presets", r_presets)

# 2.2 Unauthenticated API Endpoint Returning 401 Unauthorized
r_unauth = requests.get(f"{BASE_URL}/api/defense/token?room=headers-test-room", timeout=5)
check("18.6 Unauthenticated API GET /api/defense/token returns 401", r_unauth.status_code == 401)
verify_headers_for_response("GET /openviva/api/defense/token (401)", r_unauth)

# 2.3 Candidate Session Probe (200 with authenticated: false)
r_me = requests.get(f"{BASE_URL}/api/auth/student-me", timeout=5)
check("18.7 Session probe GET /api/auth/student-me returns 200", r_me.status_code == 200)
verify_headers_for_response("GET /openviva/api/auth/student-me", r_me)

# 2.4 Non-Existent 404 Route
r_404 = requests.get(f"{BASE_URL}/some-non-existent-route-xyz", timeout=5)
check("18.8 Non-existent route returns 404", r_404.status_code == 404)
verify_headers_for_response("GET 404 Page", r_404)

# =========================================================================
# SUITE 3: HTTP METHOD VARIATIONS (HEAD, OPTIONS, POST)
# =========================================================================
print("\n--- SUITE 3: HTTP METHOD VARIATIONS (HEAD & POST) ---")

# 3.1 HEAD request
r_head = requests.head(f"{BASE_URL}", timeout=5)
check("18.8 HEAD /openviva returns 200", r_head.status_code == 200)
verify_headers_for_response("HEAD /openviva", r_head)

# 3.2 POST request to API
r_post = requests.post(f"{BASE_URL}/api/defense/token", json={"roomName": "test-headers-room"}, timeout=5)
check("18.9 POST /openviva/api/defense/token returns 401 without auth", r_post.status_code == 401)
verify_headers_for_response("POST /openviva/api/defense/token (401)", r_post)

# =========================================================================
# SUITE 4: PROCESS STABILITY & LIVE RECOVERY
# =========================================================================
print("\n--- SUITE 4: PROCESS STABILITY & PM2 HEALTH ---")

pm2_proc = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, env={**os.environ, "PATH": "/home/savan/nodejs/bin:" + os.environ.get("PATH", "")})
pm2_data = json.loads(pm2_proc.stdout)
web_proc = next((p for p in pm2_data if p["name"] == "openviva-web"), None)
bio_proc = next((p for p in pm2_data if p["name"] == "openviva-bio-daemon"), None)

check("18.10 openviva-web is online", web_proc is not None and web_proc["pm2_env"]["status"] == "online")
check("18.11 openviva-bio-daemon is online", bio_proc is not None and bio_proc["pm2_env"]["status"] == "online")

print("\n" + "=" * 80)
print(f"ALL TESTS PASSED: {tests_passed}/{tests_total} CHECKS SUCCEEDED (100% PASS RATE)")
print("=" * 80)
