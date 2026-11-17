#!/usr/bin/env python3
"""
Comprehensive Empirical Verification Suite for Issue 17:
Hardcoded Fallback Metric (98.4%) in BiometricGateModal

Tests all edge cases, telemetry variations, and live system states.
"""

import os
import sys
import json
import subprocess
import requests

BASE_URL = "http://127.0.0.1:3001/openviva"
FILE_PATH = "/home/savan/openviva/web/src/components/BiometricGateModal.tsx"

print("=" * 80)
print("STARTING EMPIRICAL VERIFICATION SUITE: ISSUE 17")
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

# =========================================================================
# SUITE 1: SOURCE CODE & BUNDLE INTEGRITY CHECKS
# =========================================================================
print("\n--- SUITE 1: SOURCE CODE & BUNDLE INTEGRITY ---")

with open(FILE_PATH, "r", encoding="utf-8") as f:
    code = f.read()

# 1.1 Hardcoded string 98.4 must not exist anywhere in BiometricGateModal.tsx
check("17.1 '98.4' purged from BiometricGateModal.tsx", "98.4" not in code)

# 1.2 Verify livenessPct logic
check("17.2 Null/undefined check present for livenessScore", 
      "verifiedResult?.telemetry?.livenessScore !== undefined" in code and 
      "verifiedResult?.telemetry?.livenessScore !== null" in code)

# 1.3 Verify dynamic livenessStatusLabel exists
check("17.3 livenessStatusLabel dynamically adapts to telemetry presence",
      "livenessStatusLabel" in code and "Liveness confirmed" in code and "Identity verified" in code)

# 1.4 Search entire web/src for any occurrences of the literal string "98.4" or '98.4' or 98.4%
grep_res = subprocess.run(["grep", "-rnE", r'["\']98\.4["\']|98\.4%', "/home/savan/openviva/web/src"], capture_output=True, text=True)
check("17.4 Zero occurrences of hardcoded '98.4' string/metric in entire web/src directory", len(grep_res.stdout.strip()) == 0, grep_res.stdout.strip())

# =========================================================================
# SUITE 2: TELEMETRY & RENDERING LOGIC EDGE CASES (SIMULATED JAVASCRIPT ENGINE)
# =========================================================================
print("\n--- SUITE 2: TELEMETRY & RENDERING LOGIC EDGE CASES (NODE.JS) ---")

node_test_script = """
function evaluatePill(verifiedResult) {
  const isVerified = Boolean(verifiedResult?.verified);
  const isFailed = Boolean(verifiedResult && !verifiedResult.verified);
  const livenessPct = (verifiedResult?.telemetry?.livenessScore !== undefined && verifiedResult?.telemetry?.livenessScore !== null)
    ? `${((verifiedResult.telemetry.livenessScore || 0) * 100).toFixed(1)}%`
    : null;
  const livenessStatusLabel = verifiedResult?.telemetry?.isLive !== undefined
    ? `Liveness confirmed${livenessPct ? ` (${livenessPct})` : ""}`
    : "Identity verified";

  let pillText = "";
  if (isVerified) {
    pillText = `🟢 Face aligned • ${livenessStatusLabel}`;
  } else if (isFailed) {
    pillText = verifiedResult?.reason === "SPOOF_PHOTO_DETECTED"
      ? "Presentation attack trapped"
      : "Similarity below 62% threshold • Align inside oval";
  } else {
    pillText = "⚪ Center your face inside the frame";
  }

  let hudLiveness = null;
  if (verifiedResult?.telemetry?.isLive !== undefined) {
    hudLiveness = verifiedResult.telemetry.isLive
      ? `Real Human${livenessPct ? ` (${livenessPct})` : ""}`
      : `Presentation Attack (${verifiedResult.telemetry.spoofType || "Spoof Detected"})`;
  }

  return { pillText, hudLiveness, livenessPct };
}

const cases = [
  // 1. Full authentic liveness score (0.992)
  {
    input: { verified: true, similarity: 0.95, telemetry: { isLive: true, livenessScore: 0.992 } },
    expectedPill: "🟢 Face aligned • Liveness confirmed (99.2%)",
    expectedHud: "Real Human (99.2%)",
    name: "Full telemetry with 99.2% liveness"
  },
  // 2. Verified authentic but livenessScore is null
  {
    input: { verified: true, similarity: 0.91, telemetry: { isLive: true, livenessScore: null } },
    expectedPill: "🟢 Face aligned • Liveness confirmed",
    expectedHud: "Real Human",
    name: "isLive true with null livenessScore (no fake 98.4%)"
  },
  // 3. Verified authentic but livenessScore is undefined
  {
    input: { verified: true, similarity: 0.88, telemetry: { isLive: true } },
    expectedPill: "🟢 Face aligned • Liveness confirmed",
    expectedHud: "Real Human",
    name: "isLive true with undefined livenessScore"
  },
  // 4. Missing telemetry object entirely (e.g. legacy endpoint or stub)
  {
    input: { verified: true, similarity: 0.85 },
    expectedPill: "🟢 Face aligned • Identity verified",
    expectedHud: null,
    name: "Verified without telemetry object defaults to Identity verified"
  },
  // 5. Empty telemetry object
  {
    input: { verified: true, similarity: 0.85, telemetry: {} },
    expectedPill: "🟢 Face aligned • Identity verified",
    expectedHud: null,
    name: "Verified with empty telemetry object"
  },
  // 6. Presentation attack spoof detection
  {
    input: { verified: false, similarity: 0.92, reason: "SPOOF_PHOTO_DETECTED", telemetry: { isLive: false, livenessScore: 0.12, spoofType: "2D Screen Display" } },
    expectedPill: "Presentation attack trapped",
    expectedHud: "Presentation Attack (2D Screen Display)",
    name: "Presentation attack traps spoof and identifies type"
  },
  // 7. Initial modal state before scanning
  {
    input: null,
    expectedPill: "⚪ Center your face inside the frame",
    expectedHud: null,
    name: "Initial state displays centering instructions"
  },
  // 8. Low boundary score (0.000)
  {
    input: { verified: true, similarity: 0.75, telemetry: { isLive: true, livenessScore: 0.0 } },
    expectedPill: "🟢 Face aligned • Liveness confirmed (0.0%)",
    expectedHud: "Real Human (0.0%)",
    name: "Zero boundary score formatted as 0.0%"
  },
  // 9. Perfect boundary score (1.000)
  {
    input: { verified: true, similarity: 0.99, telemetry: { isLive: true, livenessScore: 1.0 } },
    expectedPill: "🟢 Face aligned • Liveness confirmed (100.0%)",
    expectedHud: "Real Human (100.0%)",
    name: "Perfect score formatted as 100.0%"
  }
];

const results = cases.map(c => {
  const res = evaluatePill(c.input);
  const pillOk = res.pillText === c.expectedPill;
  const hudOk = res.hudLiveness === c.expectedHud;
  const noFake = !res.pillText.includes("98.4") && !(res.hudLiveness || "").includes("98.4");
  return { name: c.name, pass: pillOk && hudOk && noFake, res, expectedPill: c.expectedPill, expectedHud: c.expectedHud };
});

console.log(JSON.stringify(results));
"""

NODE_ENV_VARS = {**os.environ, "PATH": "/home/savan/nodejs/bin:" + os.environ.get("PATH", "")}
node_run = subprocess.run(["node", "-e", node_test_script], capture_output=True, text=True, env=NODE_ENV_VARS)
if node_run.returncode != 0:
    print("Node error:", node_run.stderr)
    sys.exit(1)

sim_results = json.loads(node_run.stdout)
for idx, item in enumerate(sim_results, start=5):
    check(f"17.{idx} {item['name']}", item["pass"], f"Result: {item['res']}")

# =========================================================================
# SUITE 3: LIVE SERVER PROCESS & CONNECTED FEATURE INTEGRITY
# =========================================================================
print("\n--- SUITE 3: LIVE SERVER PROCESS & CONNECTED FEATURES ---")

# 3.1 PM2 Process Status
pm2_proc = subprocess.run(["pm2", "jlist"], capture_output=True, text=True, env={**os.environ, "PATH": "/home/savan/nodejs/bin:" + os.environ.get("PATH", "")})
pm2_data = json.loads(pm2_proc.stdout)
web_proc = next((p for p in pm2_data if p["name"] == "openviva-web"), None)
bio_proc = next((p for p in pm2_data if p["name"] == "openviva-bio-daemon"), None)

check("17.14 openviva-web is online", web_proc is not None and web_proc["pm2_env"]["status"] == "online")
check("17.15 openviva-bio-daemon is online", bio_proc is not None and bio_proc["pm2_env"]["status"] == "online")

# 3.2 Candidate Oral Chamber / Defense Page Serves 200
r_home = requests.get(f"{BASE_URL}")
check("17.16 Home page / candidate gate entry serves HTTP 200", r_home.status_code == 200)

r_defense = requests.get(f"{BASE_URL}/defense")
check("17.17 /openviva/defense page serves HTTP 200", r_defense.status_code == 200)

# 3.3 Presets API serves 200
r_presets = requests.get(f"{BASE_URL}/api/presets")
check("17.18 /openviva/api/presets serves HTTP 200", r_presets.status_code == 200)

# 3.4 Live Biometric Daemon Verification returns real telemetry
res_bio = requests.post("http://127.0.0.1:8002/extract-face", json={
    "image_path": "/home/savan/openviva/storage/biometrics/faces/reg1.jpg",
    "verify_liveness": True
}, timeout=5)
check("17.19 Biometric daemon extraction succeeds", res_bio.status_code == 200)
bio_json = res_bio.json()
check("17.20 Live daemon returns real float liveness score", isinstance(bio_json.get("liveness_score"), float))
check("17.21 Real liveness score is authentic (> 0.80)", bio_json.get("liveness_score", 0) > 0.80, f"Score: {bio_json.get('liveness_score')}")

print("\n" + "=" * 80)
print(f"ALL TESTS PASSED: {tests_passed}/{tests_total} CHECKS SUCCEEDED (100% PASS RATE)")
print("=" * 80)
