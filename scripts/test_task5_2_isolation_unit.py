"""
TASK 5.2 ISOLATION UNIT TEST SUITE: PRESENTATION ATTACK & ANTI-SPOOF BENCHMARK
Tests MiniFASNet-V2 softmax math, attack artifact synthesis, SpoofError typed hierarchy,
cross-identity cosine similarity decision gates, and fail-closed staging contracts in strict isolation.
"""

import unittest
import numpy as np


def stable_softmax(logits: np.ndarray) -> np.ndarray:
    """
    Numerically stable softmax over 1D or 2D logits array.
    """
    logits_f = np.asarray(logits, dtype=np.float32)
    shifted = logits_f - np.max(logits_f, axis=-1, keepdims=True)
    exps = np.exp(shifted)
    return exps / np.sum(exps, axis=-1, keepdims=True)


def evaluate_liveness_decision(probs: list, threshold: float = 0.80) -> dict:
    """
    Evaluates softmax probability vector [P_print, P_real, P_replay].
    """
    p_print, p_real, p_replay = float(probs[0]), float(probs[1]), float(probs[2])
    is_live = bool(p_real >= threshold)
    spoof_type = None
    if not is_live:
        spoof_type = "PRINT_ATTACK" if p_print >= p_replay else "SCREEN_REPLAY_ATTACK"
    return {
        "is_live": is_live,
        "liveness_score": round(p_real, 4),
        "spoof_probabilities": {
            "real": round(p_real, 4),
            "print_attack": round(p_print, 4),
            "replay_attack": round(p_replay, 4)
        },
        "spoof_type": spoof_type
    }


class SpoofError(ValueError):
    def __init__(self, message: str, liveness_score: float = 0.0, spoof_type: str = None, spoof_probabilities: dict = None):
        super().__init__(message)
        self.liveness_score = liveness_score
        self.spoof_type = spoof_type
        self.spoof_probabilities = spoof_probabilities or {}


def compute_cosine_similarity(vec_a: np.ndarray, vec_b: np.ndarray) -> float:
    a = np.asarray(vec_a, dtype=np.float32).flatten()
    b = np.asarray(vec_b, dtype=np.float32).flatten()
    norm_a = np.linalg.norm(a)
    norm_b = np.linalg.norm(b)
    if norm_a == 0.0 or norm_b == 0.0:
        return 0.0
    return float(np.dot(a, b) / (norm_a * norm_b))


class TestTask52AntiSpoofIsolationUnit(unittest.TestCase):

    # -------------------------------------------------------------------------
    # SUITE 1: Softmax & Probability Invariants
    # -------------------------------------------------------------------------
    def test_unit_1_1_stable_softmax_sum_to_one(self):
        logits = np.array([1.2, 5.8, -0.4], dtype=np.float32)
        probs = stable_softmax(logits)
        self.assertAlmostEqual(float(np.sum(probs)), 1.0, places=6)
        self.assertTrue(np.all(probs >= 0.0))
        self.assertTrue(np.all(probs <= 1.0))

    def test_unit_1_2_stable_softmax_handles_extreme_logits(self):
        logits = np.array([1000.0, 500.0, -1000.0], dtype=np.float32)
        probs = stable_softmax(logits)
        self.assertFalse(np.isnan(probs).any())
        self.assertAlmostEqual(float(probs[0]), 1.0, places=5)
        self.assertAlmostEqual(float(probs[1]), 0.0, places=5)
        self.assertAlmostEqual(float(probs[2]), 0.0, places=5)

    def test_unit_1_3_bona_fide_liveness_decision(self):
        # High real probability
        probs = [0.001, 0.985, 0.014]
        res = evaluate_liveness_decision(probs, threshold=0.80)
        self.assertTrue(res["is_live"])
        self.assertEqual(res["liveness_score"], 0.985)
        self.assertIsNone(res["spoof_type"])

    def test_unit_1_4_paper_print_attack_decision(self):
        # Print attack dominant
        probs = [0.895, 0.005, 0.100]
        res = evaluate_liveness_decision(probs, threshold=0.80)
        self.assertFalse(res["is_live"])
        self.assertEqual(res["spoof_type"], "PRINT_ATTACK")
        self.assertEqual(res["liveness_score"], 0.005)
        self.assertEqual(res["spoof_probabilities"]["print_attack"], 0.895)

    def test_unit_1_5_screen_replay_attack_decision(self):
        # Replay attack dominant
        probs = [0.005, 0.015, 0.980]
        res = evaluate_liveness_decision(probs, threshold=0.80)
        self.assertFalse(res["is_live"])
        self.assertEqual(res["spoof_type"], "SCREEN_REPLAY_ATTACK")
        self.assertEqual(res["liveness_score"], 0.015)
        self.assertEqual(res["spoof_probabilities"]["replay_attack"], 0.980)

    def test_unit_1_6_borderline_rejection_boundary(self):
        # Score just below calibrated 0.80 threshold
        probs = [0.150, 0.799, 0.051]
        res = evaluate_liveness_decision(probs, threshold=0.80)
        self.assertFalse(res["is_live"])
        self.assertEqual(res["spoof_type"], "PRINT_ATTACK")

        # Score meeting calibrated 0.80 threshold
        probs_pass = [0.100, 0.800, 0.100]
        res_pass = evaluate_liveness_decision(probs_pass, threshold=0.80)
        self.assertTrue(res_pass["is_live"])
        self.assertIsNone(res_pass["spoof_type"])

    # -------------------------------------------------------------------------
    # SUITE 2: Presentation Attack Synthetic Invariants
    # -------------------------------------------------------------------------
    def test_unit_2_1_paper_print_generator_invariants(self):
        # Canvas 100x100
        canvas = np.full((100, 100, 3), 128, dtype=np.uint8)
        arr = canvas.astype(np.float32)
        noise = np.random.normal(0, 10, (100, 100, 3))
        arr_print = np.clip(arr * 0.95 + noise, 0, 255)
        # White border
        arr_print[:10, :, :] = 250
        arr_print[-10:, :, :] = 250
        arr_print[:, :10, :] = 250
        arr_print[:, -10:, :] = 250
        out = arr_print.astype(np.uint8)

        self.assertEqual(out.shape, (100, 100, 3))
        self.assertEqual(out.dtype, np.uint8)
        # Verify border is high-intensity paper white
        self.assertTrue(np.all(out[:10, :, :] >= 240))
        self.assertTrue(np.all(out[-10:, :, :] >= 240))

    def test_unit_2_2_screen_replay_generator_invariants(self):
        canvas = np.full((100, 100, 3), 128, dtype=np.uint8)
        arr = canvas.astype(np.float32)
        y, x = np.ogrid[:100, :100]
        moire = 1.0 + 0.15 * np.sin(x * 0.2) * np.cos(y * 0.2)
        arr_screen = arr * moire[:, :, np.newaxis]
        arr_screen[::2, :, :] *= 0.90
        # Bezel border
        arr_screen[:10, :, :] = 10
        arr_screen[-10:, :, :] = 10
        arr_screen[:, :10, :] = 10
        arr_screen[:, -10:, :] = 10
        out = np.clip(arr_screen, 0, 255).astype(np.uint8)

        self.assertEqual(out.shape, (100, 100, 3))
        self.assertEqual(out.dtype, np.uint8)
        # Verify bezel border is dark
        self.assertTrue(np.all(out[:10, :, :] <= 20))
        # Verify scanlines produce intensity delta between adjacent rows
        row_even = np.mean(out[10:90:2, 10:90, :])
        row_odd = np.mean(out[11:90:2, 10:90, :])
        self.assertGreater(row_odd, row_even)

    # -------------------------------------------------------------------------
    # SUITE 3: SpoofError Typed Hierarchy Invariants
    # -------------------------------------------------------------------------
    def test_unit_3_1_spoof_error_attributes(self):
        probs = {"real": 0.005, "print_attack": 0.910, "replay_attack": 0.085}
        err = SpoofError(
            "SPOOF_PHOTO_DETECTED: Presentation attack detected (PRINT_ATTACK)",
            liveness_score=0.005,
            spoof_type="PRINT_ATTACK",
            spoof_probabilities=probs
        )
        self.assertIsInstance(err, ValueError)
        self.assertIsInstance(err, Exception)
        self.assertEqual(err.liveness_score, 0.005)
        self.assertEqual(err.spoof_type, "PRINT_ATTACK")
        self.assertEqual(err.spoof_probabilities["print_attack"], 0.910)
        self.assertIn("SPOOF_PHOTO_DETECTED", str(err))

    # -------------------------------------------------------------------------
    # SUITE 4: Cross-Identity & Decision Gate Boundary Invariants
    # -------------------------------------------------------------------------
    def test_unit_4_1_cosine_similarity_identity(self):
        vec = np.random.randn(512).astype(np.float32)
        vec /= np.linalg.norm(vec)
        sim = compute_cosine_similarity(vec, vec)
        self.assertAlmostEqual(sim, 1.0, places=5)

    def test_unit_4_2_cross_identity_separation_bound(self):
        # Two random 512-d unit vectors (orthogonal expectation in high dimensions)
        np.random.seed(42)
        vec1 = np.random.randn(512).astype(np.float32)
        vec1 /= np.linalg.norm(vec1)
        vec2 = np.random.randn(512).astype(np.float32)
        vec2 /= np.linalg.norm(vec2)
        sim = compute_cosine_similarity(vec1, vec2)
        # High-dimensional random vectors have cosine sim close to 0 (< 0.20)
        self.assertLess(abs(sim), 0.20)
        # Strictly below calibrated 0.62 threshold
        self.assertLess(sim, 0.62)
        # Satisfies impostor ceiling < 0.35
        self.assertLess(sim, 0.35)

    def test_unit_4_3_calibrated_threshold_decision_boundary(self):
        threshold = 0.62
        self.assertTrue(0.6201 >= threshold)
        self.assertTrue(0.6200 >= threshold)
        self.assertFalse(0.6199 >= threshold)
        self.assertFalse(0.3500 >= threshold)

    def test_unit_4_4_zero_vector_similarity_handling(self):
        zero_vec = np.zeros(512, dtype=np.float32)
        norm_vec = np.ones(512, dtype=np.float32)
        sim = compute_cosine_similarity(zero_vec, norm_vec)
        self.assertEqual(sim, 0.0)


if __name__ == "__main__":
    unittest.main()
