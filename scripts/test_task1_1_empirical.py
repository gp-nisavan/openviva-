
import os
import sys
import time
import hashlib
import numpy as np
import onnxruntime as ort

print("=" * 70)
print("TASK 1.1 EMPIRICAL & EDGE-CASE TEST SUITE: FACE ONNX MODEL STAGING")
print("=" * 70)

MODELS_DIR = "/home/savan/openviva/models/face"
EXPECTED_MODELS = {
    "scrfd_500m_kps.onnx": {
        "min_bytes": 2_400_000,
        "max_bytes": 2_700_000,
        "expected_sha256_prefix": "5e4447f50245bbd7",
        "input_name": "input.1",
        "input_shape": [1, 3, 640, 640],
    },
    "minifasnet_v2.onnx": {
        "min_bytes": 1_600_000,
        "max_bytes": 1_900_000,
        "expected_sha256_prefix": "d7b3cd9ba8a7ceb1",
        "input_name": None, # Will inspect dynamically
        "input_shape": [1, 3, 80, 80],
    },
    "mobilefacenet_arcface_512.onnx": {
        "min_bytes": 12_000_000,
        "max_bytes": 14_500_000,
        "expected_sha256_prefix": "9cc6e4a75f0e2bf0",
        "input_name": None,
        "input_shape": [1, 3, 112, 112],
    }
}

test_results = []

def record_test(name, passed, details=""):
    status = "PASS" if passed else "FAIL"
    test_results.append((name, passed, details))
    print(f"[{status}] {name}")
    if details:
        print(f"       Details: {details}")

# =========================================================================
# TEST 1: Physical File Presence & Disk Bounds
# =========================================================================
print("\n--- TEST 1: Physical File Presence & Byte Bounds ---")
all_files_present = True
for model_name, meta in EXPECTED_MODELS.items():
    path = os.path.join(MODELS_DIR, model_name)
    exists = os.path.exists(path)
    if not exists:
        record_test(f"File Existence: {model_name}", False, "File missing on disk")
        all_files_present = False
        continue
    size = os.path.getsize(path)
    in_bounds = meta["min_bytes"] <= size <= meta["max_bytes"]
    record_test(f"File Existence & Size: {model_name}", in_bounds, f"{size:,} bytes (bounds: {meta['min_bytes']:,} - {meta['max_bytes']:,})")

# =========================================================================
# TEST 2: SHA-256 Cryptographic Checksum Integrity
# =========================================================================
print("\n--- TEST 2: SHA-256 Cryptographic Checksum Integrity ---")
for model_name, meta in EXPECTED_MODELS.items():
    path = os.path.join(MODELS_DIR, model_name)
    if not os.path.exists(path):
        continue
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while chunk := f.read(65536):
            h.update(chunk)
    digest = h.hexdigest()
    matched = digest.startswith(meta["expected_sha256_prefix"])
    record_test(f"SHA-256 Verification: {model_name}", matched, f"Computed: {digest[:16]}... | Expected: {meta['expected_sha256_prefix']}...")

# =========================================================================
# TEST 3: ONNX Runtime Session Loading & Metadata Inspection
# =========================================================================
print("\n--- TEST 3: ONNX Runtime Session Loading & Metadata ---")
sessions = {}
for model_name, meta in EXPECTED_MODELS.items():
    path = os.path.join(MODELS_DIR, model_name)
    try:
        t0 = time.perf_counter()
        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 2
        sess = ort.InferenceSession(path, sess_options=opts, providers=['CPUExecutionProvider'])
        load_time_ms = (time.perf_counter() - t0) * 1000
        sessions[model_name] = sess
        inputs = [f"{i.name}: {i.shape}" for i in sess.get_inputs()]
        outputs = [f"{o.name}: {o.shape}" for o in sess.get_outputs()]
        record_test(f"Session Load: {model_name}", True, f"Loaded in {load_time_ms:.1f}ms | Inputs: {inputs} | Outputs: {outputs[:2]}")
    except Exception as e:
        record_test(f"Session Load: {model_name}", False, str(e))

# =========================================================================
# TEST 4: Empirical Forward Inference Latency & Numerical Stability
# =========================================================================
print("\n--- TEST 4: Empirical Forward Inference & Latency ---")
for model_name, sess in sessions.items():
    meta = EXPECTED_MODELS[model_name]
    input_tensor_meta = sess.get_inputs()[0]
    input_name = input_tensor_meta.name
    shape = meta["input_shape"]
    dummy_input = np.random.randn(*shape).astype(np.float32)

    latencies = []
    # Warmup
    _ = sess.run(None, {input_name: dummy_input})

    # Benchmark 5 iterations
    for _ in range(5):
        t0 = time.perf_counter()
        out = sess.run(None, {input_name: dummy_input})
        latencies.append((time.perf_counter() - t0) * 1000)

    avg_lat = np.mean(latencies)
    std_lat = np.std(latencies)
    
    # Numerical sanity: check for NaNs or Infs
    has_nan = any(np.isnan(arr).any() for arr in out)
    has_inf = any(np.isinf(arr).any() for arr in out)
    healthy = (not has_nan) and (not has_inf) and (avg_lat < 100.0)

    details = f"Avg Latency: {avg_lat:.2f}ms +/- {std_lat:.2f}ms | NaN: {has_nan} | Inf: {has_inf}"
    if model_name == "mobilefacenet_arcface_512.onnx":
        emb = out[0]
        details += f" | Output Shape: {emb.shape} (Expected (1, 512))"
        healthy = healthy and (emb.shape == (1, 512))
    elif model_name == "minifasnet_v2.onnx":
        logits = out[0]
        details += f" | Logits Shape: {logits.shape} (Expected (1, 3))"
        healthy = healthy and (logits.shape == (1, 3))

    record_test(f"Inference Latency & Numerics: {model_name}", healthy, details)

# =========================================================================
# TEST 5: EDGE CASES
# =========================================================================
print("\n--- TEST 5: Edge-Case Validations ---")

# Edge Case 5.1: Zero Input Tensor (Pitch Black Frame)
for model_name, sess in sessions.items():
    meta = EXPECTED_MODELS[model_name]
    inp_name = sess.get_inputs()[0].name
    zero_inp = np.zeros(meta["input_shape"], dtype=np.float32)
    try:
        out = sess.run(None, {inp_name: zero_inp})
        has_nan = any(np.isnan(arr).any() for arr in out)
        record_test(f"Edge Case 5.1 (Zero Input): {model_name}", not has_nan, "Handles all-zero frame without numerical crash or NaN")
    except Exception as e:
        record_test(f"Edge Case 5.1 (Zero Input): {model_name}", False, str(e))

# Edge Case 5.2: Extreme Saturation (Pure White / Glare Overexposure)
for model_name, sess in sessions.items():
    meta = EXPECTED_MODELS[model_name]
    inp_name = sess.get_inputs()[0].name
    sat_inp = np.ones(meta["input_shape"], dtype=np.float32) * 255.0
    try:
        out = sess.run(None, {inp_name: sat_inp})
        has_nan = any(np.isnan(arr).any() for arr in out)
        record_test(f"Edge Case 5.2 (Saturated Input): {model_name}", not has_nan, "Handles 255.0 saturation without overflow")
    except Exception as e:
        record_test(f"Edge Case 5.2 (Saturated Input): {model_name}", False, str(e))

# Edge Case 5.3: Invalid Input Dimensions (Shape Mismatch Rejection)
for model_name, sess in sessions.items():
    inp_name = sess.get_inputs()[0].name
    # Pass 4 channels instead of 3
    invalid_inp = np.zeros((1, 4, 100, 100), dtype=np.float32)
    try:
        sess.run(None, {inp_name: invalid_inp})
        record_test(f"Edge Case 5.3 (Invalid Shape Rejection): {model_name}", False, "Should have thrown shape mismatch error")
    except Exception as e:
        record_test(f"Edge Case 5.3 (Invalid Shape Rejection): {model_name}", True, f"Gracefully rejected invalid shape: {type(e).__name__}")

# Edge Case 5.4: Concurrency (Simultaneous Multi-Threaded Inference)
import threading
concurrency_errors = []
def worker_inference(thread_id):
    try:
        sess = sessions["mobilefacenet_arcface_512.onnx"]
        inp_name = sess.get_inputs()[0].name
        x = np.random.randn(1, 3, 112, 112).astype(np.float32)
        for _ in range(10):
            res = sess.run(None, {inp_name: x})
            assert res[0].shape == (1, 512)
    except Exception as e:
        concurrency_errors.append((thread_id, str(e)))

threads = [threading.Thread(target=worker_inference, args=(i,)) for i in range(4)]
for t in threads: t.start()
for t in threads: t.join()

record_test("Edge Case 5.4 (Concurrent Multi-Threaded Inference)", len(concurrency_errors) == 0, f"4 concurrent threads, 10 passes each | Errors: {len(concurrency_errors)}")

# =========================================================================
# SUMMARY
# =========================================================================
total_passed = sum(1 for _, p, _ in test_results if p)
total_tests = len(test_results)
print("\n" + "=" * 70)
print(f"TASK 1.1 EMPIRICAL RESULTS: {total_passed}/{total_tests} TESTS PASSED ({(total_passed/total_tests)*100:.1f}%)")
print("=" * 70)

if total_passed == total_tests:
    print("ALL TASK 1.1 CHECKS VERIFIED SUCCESSFULLY.")
    sys.exit(0)
else:
    print("SOME TESTS FAILED.")
    sys.exit(1)
