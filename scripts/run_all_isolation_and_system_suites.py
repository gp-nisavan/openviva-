"""
MASTER ORCHESTRATOR: COMPLETE ISOLATION UNIT & SYSTEM EMPIRICAL TEST HARNESS
Executes all unit and system suites across Tasks 1.1 through 5.3 on Node 10.10.16.13:
1. Task 3.2 Isolation Unit Suite (Biometric Math, Neural Modules, DB Adapters, Route Logic)
2. Task 4.1 Isolation Unit Suite (BiometricGateModal AST, Reticle Geometry, State Machines, HUD)
3. Task 4.2 Isolation Unit Suite (BiometricEnrollmentModal AST, Viewfinder Reticle, Stepper, Error Routing)
4. Task 4.3 Isolation Unit Suite (EvaluationScorecard AST, Badges, Decision Boundary, Session HUD)
5. Task 5.1 Isolation Unit Suite (Simulated Yale B Illumination Math, CLAHE Invariants, Decision Bounds)
6. Task 5.2 Isolation Unit Suite (Anti-Spoof Softmax, Attack Synthesis & Error Hierarchy)
7. Task 5.3 Isolation Unit Suite (Candidate Viva Lifecycle State Machine, Photo URI Contracts & Badges)
8. Task 1.1 -> 3.2 Master System-Wide Empirical Suite (Production Fleet Verification)
9. Task 3.3 Multi-Modal Enrollment Empirical Suite (Staging Isolation & Vector Sealing)
10. Task 4.1 Pre-Viva Identity Gate Empirical Suite (Full UI/Backend Integration & Edge Cases)
11. Task 4.2 Biometric Enrollment Modal Empirical Suite (Multi-Modal Full-Stack Integration & Gate Interoperability)
12. Task 4.3 TA Evaluation Biometric HUD Empirical Suite (Scorecard Telemetry, Keyframes, Anomalies & SLAs)
13. Task 5.1 Simulated Yale B Illumination Protocol Empirical Suite (Harsh Shadows, Glare, Underexposure & Gate SLA)
14. Task 5.2 Presentation Attack & Anti-Spoof Empirical Suite (CASIA/Replay Benchmarks, Cross-Identity & Staging)
15. Task 5.3 End-to-End Candidate Viva Defense Lifecycle Smoke Test (Full-Stack Journey & Fail-Closed Matrix)
"""

import os
import sys
import subprocess
import time

PYTHON_BIN = "/home/savan/openviva/agent_env/bin/python"
SCRIPTS_DIR = "/home/savan/openviva/scripts"

suites = [
    {
        "id": "UNIT_3.2",
        "title": "Task 3.2 Isolation Unit Suite: Biometric Math, Neural Units, DB & Route Handlers",
        "file": os.path.join(SCRIPTS_DIR, "test_task3_2_isolation_unit.py"),
        "type": "ISOLATION_UNIT"
    },
    {
        "id": "UNIT_4.1",
        "title": "Task 4.1 Isolation Unit Suite: BiometricGateModal AST, Reticle Geometry & HUD Logic",
        "file": os.path.join(SCRIPTS_DIR, "test_task4_1_isolation_unit.py"),
        "type": "ISOLATION_UNIT"
    },
    {
        "id": "UNIT_4.2",
        "title": "Task 4.2 Isolation Unit Suite: BiometricEnrollmentModal AST, Viewfinder Math & Error Routing",
        "file": os.path.join(SCRIPTS_DIR, "test_task4_2_isolation_unit.py"),
        "type": "ISOLATION_UNIT"
    },
    {
        "id": "UNIT_4.3",
        "title": "Task 4.3 Isolation Unit Suite: EvaluationScorecard AST, Badges & 62% Decision Boundary",
        "file": os.path.join(SCRIPTS_DIR, "test_task4_3_isolation_unit.py"),
        "type": "ISOLATION_UNIT"
    },
    {
        "id": "UNIT_5.1",
        "title": "Task 5.1 Isolation Unit Suite: Simulated Yale B Protocol, CLAHE Math & Dynamic Range",
        "file": os.path.join(SCRIPTS_DIR, "test_task5_1_isolation_unit.py"),
        "type": "ISOLATION_UNIT"
    },
    {
        "id": "UNIT_5.2",
        "title": "Task 5.2 Isolation Unit Suite: Anti-Spoof Softmax, Attack Synthesis & Error Hierarchy",
        "file": os.path.join(SCRIPTS_DIR, "test_task5_2_isolation_unit.py"),
        "type": "ISOLATION_UNIT"
    },
    {
        "id": "UNIT_5.3",
        "title": "Task 5.3 Isolation Unit Suite: Candidate Viva Lifecycle State Machine, Photo URI Contracts & Badges",
        "file": os.path.join(SCRIPTS_DIR, "test_task5_3_isolation_unit.py"),
        "type": "ISOLATION_UNIT"
    },
    {
        "id": "SYS_1.1_TO_3.2",
        "title": "Master System-Wide Suite: Tasks 1.1 -> 3.2 Integrated Full-Stack Production Fleet",
        "file": os.path.join(SCRIPTS_DIR, "test_master_system_wide_1_1_to_3_2.py"),
        "type": "SYSTEM_EMPIRICAL"
    },
    {
        "id": "SYS_3.3",
        "title": "Task 3.3 Empirical Suite: Multi-Modal Enrollment, Staging Isolation & DB Sealing",
        "file": os.path.join(SCRIPTS_DIR, "test_task3_3_empirical.py"),
        "type": "SYSTEM_EMPIRICAL"
    },
    {
        "id": "SYS_4.1",
        "title": "Task 4.1 Empirical Suite: Pre-Viva Chamber Gate Integration, Reticle & Edge Cases",
        "file": os.path.join(SCRIPTS_DIR, "test_task4_1_empirical.py"),
        "type": "SYSTEM_EMPIRICAL"
    },
    {
        "id": "SYS_4.2",
        "title": "Task 4.2 Empirical Suite: Biometric Enrollment Modal Full-Stack Integration & Edge Cases",
        "file": os.path.join(SCRIPTS_DIR, "test_task4_2_empirical.py"),
        "type": "SYSTEM_EMPIRICAL"
    },
    {
        "id": "SYS_4.3",
        "title": "Task 4.3 Empirical Suite: Evaluation Scorecard HUD, Photo Retrieval, Keyframes & Anomaly Matrix",
        "file": os.path.join(SCRIPTS_DIR, "test_task4_3_empirical.py"),
        "type": "SYSTEM_EMPIRICAL"
    },
    {
        "id": "SYS_5.1",
        "title": "Task 5.1 Empirical Suite: Simulated Yale B Illumination Protocol, Stress Benchmark & Gate Integration",
        "file": os.path.join(SCRIPTS_DIR, "test_task5_1_empirical.py"),
        "type": "SYSTEM_EMPIRICAL"
    },
    {
        "id": "SYS_5.2",
        "title": "Task 5.2 Empirical Suite: Presentation Attack & Anti-Spoof Benchmark, Cross-Identity & Staging",
        "file": os.path.join(SCRIPTS_DIR, "test_task5_2_empirical.py"),
        "type": "SYSTEM_EMPIRICAL"
    },
    {
        "id": "SYS_5.3",
        "title": "Task 5.3 Empirical Suite: Complete Candidate Viva Defense Lifecycle Smoke Test & SLAs",
        "file": os.path.join(SCRIPTS_DIR, "test_task5_3_empirical.py"),
        "type": "SYSTEM_EMPIRICAL"
    }
]

print("=" * 85)
print("MASTER TEST HARNESS: FLEET-WIDE ISOLATION UNIT & SYSTEM EMPIRICAL VERIFICATION")
print("Target: Node 10.10.16.13 | PM2: openviva-web (Port 3001) | Tasks 1.1 -> 5.3")
print("=" * 85)

suite_summaries = []

for s in suites:
    print("\n" + "#" * 85)
    print(f"RUNNING SUITE [{s['id']}] ({s['type']}): {s['title']}")
    print("#" * 85 + "\n")

    t0 = time.perf_counter()
    res = subprocess.run([PYTHON_BIN, s["file"]], capture_output=True, text=True)
    elapsed = (time.perf_counter() - t0) * 1000

    print(res.stdout)
    if res.stderr:
        print("STDERR:\n" + res.stderr)

    passed = (res.returncode == 0)
    suite_summaries.append({
        "id": s["id"],
        "title": s["title"],
        "type": s["type"],
        "passed": passed,
        "elapsed_ms": elapsed
    })

print("\n" + "=" * 85)
print("FLEET-WIDE ISOLATION UNIT & SYSTEM EMPIRICAL AUDIT SUMMARY")
print("=" * 85)

all_passed = True
for summ in suite_summaries:
    status_str = "[PASS]" if summ["passed"] else "[FAIL]"
    if not summ["passed"]:
        all_passed = False
    print(f"{status_str} [{summ['type']}] {summ['id']}: {summ['title']} ({summ['elapsed_ms']:.1f}ms)")

print("=" * 85)
if all_passed:
    print(f">>> ALL {len(suite_summaries)} ISOLATION UNIT AND SYSTEM EMPIRICAL SUITES PASSED CLEANLY (100.0%)! <<<\n")
    sys.exit(0)
else:
    print(">>> WARNING: ONE OR MORE SUITES FAILED REGRESSION AUDIT! <<<\n")
    sys.exit(1)
