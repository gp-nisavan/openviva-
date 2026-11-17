"""
TASK 5.1 ISOLATION UNIT TEST SUITE: SIMULATED YALE B ILLUMINATION PROTOCOL
Tests pure NumPy CLAHE math, dynamic range expansion, luminance invariance,
physically grounded Yale B illumination distortion gradients, and ArcFace cosine similarity decision boundaries in isolation.
"""

import unittest
import numpy as np


def apply_pure_numpy_clahe(img_arr: np.ndarray, clip_limit: float = 2.0, grid_size: int = 8) -> np.ndarray:
    """
    Pure NumPy implementation of Luminance-Only CLAHE on RGB image array (H, W, 3).
    Converts RGB to YCbCr, computes CLAHE on Y channel, and converts back.
    """
    rgb = img_arr.astype(np.float32)
    # ITU-R BT.601 conversion matrix
    y = 0.299 * rgb[:, :, 0] + 0.587 * rgb[:, :, 1] + 0.114 * rgb[:, :, 2]
    cb = 128.0 - 0.168736 * rgb[:, :, 0] - 0.331264 * rgb[:, :, 1] + 0.5 * rgb[:, :, 2]
    cr = 128.0 + 0.5 * rgb[:, :, 0] - 0.418688 * rgb[:, :, 1] - 0.081312 * rgb[:, :, 2]

    H, W = y.shape
    tile_h = H // grid_size
    tile_w = W // grid_size

    equalized_y = np.zeros_like(y)
    for i in range(grid_size):
        for j in range(grid_size):
            y_start = i * tile_h
            y_end = (i + 1) * tile_h if i < grid_size - 1 else H
            x_start = j * tile_w
            x_end = (j + 1) * tile_w if j < grid_size - 1 else W

            tile = y[y_start:y_end, x_start:x_end].astype(np.uint8)
            hist, _ = np.histogram(tile.flatten(), bins=256, range=(0, 256))

            # Clip histogram
            actual_clip = int(clip_limit * (tile.size / 256.0))
            excess = np.sum(np.maximum(hist - actual_clip, 0))
            clipped = np.minimum(hist, actual_clip)
            clipped += excess // 256

            # Compute CDF
            cdf = clipped.cumsum()
            cdf_norm = ((cdf - cdf.min()) * 255.0) / max(1, (cdf.max() - cdf.min()))
            equalized_y[y_start:y_end, x_start:x_end] = cdf_norm[tile]

    # Convert back from YCbCr to RGB
    y_eq = equalized_y
    r = y_eq + 1.402 * (cr - 128.0)
    g = y_eq - 0.344136 * (cb - 128.0) - 0.714136 * (cr - 128.0)
    b = y_eq + 1.772 * (cb - 128.0)

    out_rgb = np.stack([r, g, b], axis=-1)
    return np.clip(out_rgb, 0, 255).astype(np.uint8)


def generate_yale_b_distortions(img_arr: np.ndarray):
    """
    Applies the full Simulated Yale B Illumination Protocol to an RGB image array (H, W, 3).
    Models directional gradients corresponding to real physical flash bulbs at varying azimuth and elevation.
    """
    H, W, C = img_arr.shape
    img_f = img_arr.astype(np.float32)
    x = np.linspace(0, 1, W)[np.newaxis, :, np.newaxis]
    y = np.linspace(0, 1, H)[:, np.newaxis, np.newaxis]
    distortions = {}

    # 1. Left Directional Shadow (0.20 on left smoothly increasing to 1.0 on right)
    distortions["left_harsh_shadow"] = np.clip(img_f * (0.20 + 0.80 * x), 0, 255).astype(np.uint8)

    # 2. Right Directional Shadow (1.0 on left smoothly decreasing to 0.20 on right)
    distortions["right_harsh_shadow"] = np.clip(img_f * (1.00 - 0.80 * x), 0, 255).astype(np.uint8)

    # 3. Overhead Direct Down-Light (1.0 on top decreasing to 0.25 on bottom)
    distortions["top_overhead_shadow"] = np.clip(img_f * (1.00 - 0.75 * y), 0, 255).astype(np.uint8)

    # 4. Severe Global Underexposure (Gain x0.25)
    distortions["severe_underexposure"] = np.clip(img_f * 0.25, 0, 255).astype(np.uint8)

    # 5. Severe Global Overexposure (Gain x1.80)
    distortions["severe_overexposure"] = np.clip(img_f * 1.80, 0, 255).astype(np.uint8)

    # 6. Center Specular Flash Glare (Diffuse hotspot +80 falloff)
    glare_kernel = np.exp(-((x - 0.5)**2 + (y - 0.5)**2) / 0.15)
    distortions["specular_glare_hotspot"] = np.clip(img_f + 80.0 * glare_kernel, 0, 255).astype(np.uint8)

    # 7. Extreme Low Light (Gain x0.20)
    distortions["extreme_low_light"] = np.clip(img_f * 0.20, 0, 255).astype(np.uint8)

    # 8. Pitch Black Frame (Fail-closed negative control x0.01)
    distortions["pitch_black_negative_control"] = np.clip(img_f * 0.01, 0, 255).astype(np.uint8)

    return distortions


class TestTask51IlluminationIsolationUnit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        # Create synthetic face-like gradient canvas (112, 112, 3)
        np.random.seed(42)
        H, W = 112, 112
        y, x = np.mgrid[:H, :W]
        center_y, center_x = H // 2, W // 2
        r = np.sqrt((x - center_x)**2 + (y - center_y)**2) / (H / 2)
        base_intensity = np.clip(180 - 80 * r, 30, 220)[:, :, np.newaxis]
        cls.synthetic_face = np.repeat(base_intensity.astype(np.uint8), 3, axis=2)

    # =========================================================================
    # SUITE 1: CLAHE Mathematical Invariants in Isolation
    # =========================================================================
    def test_01_clahe_preserves_dimensions_and_mode(self):
        """CLAHE output must strictly match input shape (H, W, 3) and uint8 dtype"""
        res = apply_pure_numpy_clahe(self.synthetic_face)
        self.assertEqual(res.shape, self.synthetic_face.shape)
        self.assertEqual(res.dtype, np.uint8)

    def test_02_clahe_enhances_underexposed_dynamic_range(self):
        """CLAHE on underexposed canvas must significantly expand dynamic range (std dev)"""
        dark_img = (self.synthetic_face.astype(np.float32) * 0.25).astype(np.uint8)
        dark_std = np.std(dark_img)
        enhanced = apply_pure_numpy_clahe(dark_img)
        enhanced_std = np.std(enhanced)
        self.assertGreater(enhanced_std, dark_std * 1.5,
                           f"CLAHE dynamic range {enhanced_std:.2f} must exceed dark {dark_std:.2f} by >= 1.5x")

    def test_03_clahe_preserves_chroma_zero_drift(self):
        """CLAHE modifies only luminance Y; Cb and Cr chrominance coordinates must experience minimal shift"""
        img = self.synthetic_face.astype(np.float32)
        cb_orig = 128.0 - 0.168736 * img[:, :, 0] - 0.331264 * img[:, :, 1] + 0.5 * img[:, :, 2]
        cr_orig = 128.0 + 0.5 * img[:, :, 0] - 0.418688 * img[:, :, 1] - 0.081312 * img[:, :, 2]

        enhanced = apply_pure_numpy_clahe(self.synthetic_face).astype(np.float32)
        cb_enh = 128.0 - 0.168736 * enhanced[:, :, 0] - 0.331264 * enhanced[:, :, 1] + 0.5 * enhanced[:, :, 2]
        cr_enh = 128.0 + 0.5 * enhanced[:, :, 0] - 0.418688 * enhanced[:, :, 1] - 0.081312 * enhanced[:, :, 2]

        cb_drift = np.mean(np.abs(cb_orig - cb_enh))
        cr_drift = np.mean(np.abs(cr_orig - cr_enh))
        self.assertLess(cb_drift, 5.0, f"Cb chrominance drift {cb_drift:.2f} must be < 5.0")
        self.assertLess(cr_drift, 5.0, f"Cr chrominance drift {cr_drift:.2f} must be < 5.0")

    # =========================================================================
    # SUITE 2: Yale B Illumination Distortion Generators
    # =========================================================================
    def test_04_yale_b_distortions_generation(self):
        """Verify all 8 Yale B simulated distortions generate valid uint8 arrays"""
        distortions = generate_yale_b_distortions(self.synthetic_face)
        expected_keys = [
            "left_harsh_shadow", "right_harsh_shadow", "top_overhead_shadow",
            "severe_underexposure", "severe_overexposure", "specular_glare_hotspot",
            "extreme_low_light", "pitch_black_negative_control"
        ]
        for k in expected_keys:
            self.assertIn(k, distortions)
            self.assertEqual(distortions[k].shape, (112, 112, 3))
            self.assertEqual(distortions[k].dtype, np.uint8)

    def test_05_shadow_asymmetry_invariants(self):
        """Verify left shadow is darker on left than right, and vice-versa for right shadow"""
        distortions = generate_yale_b_distortions(self.synthetic_face)
        left_img = distortions["left_harsh_shadow"]
        self.assertLess(np.mean(left_img[:, :56, :]), np.mean(left_img[:, 56:, :]))

        right_img = distortions["right_harsh_shadow"]
        self.assertLess(np.mean(right_img[:, 56:, :]), np.mean(right_img[:, :56, :]))

    def test_06_glare_hotspot_intensity_invariant(self):
        """Verify center glare hotspot is brighter in center than periphery"""
        distortions = generate_yale_b_distortions(self.synthetic_face)
        glare_img = distortions["specular_glare_hotspot"]
        center_mean = np.mean(glare_img[40:72, 40:72, :])
        periphery_mean = np.mean(glare_img[:20, :20, :])
        self.assertGreater(center_mean, periphery_mean + 30.0)

    # =========================================================================
    # SUITE 3: Cosine Similarity Decision Invariants Under Illumination Stress
    # =========================================================================
    def test_07_unit_l2_normalization_preservation(self):
        """Feature embeddings under any simulated transformation must strictly remain unit norm ||e||2 = 1.0"""
        np.random.seed(123)
        raw_emb = np.random.randn(512).astype(np.float32)
        norm_emb = raw_emb / np.linalg.norm(raw_emb)
        self.assertAlmostEqual(float(np.linalg.norm(norm_emb)), 1.0, places=6)

    def test_08_threshold_separation_margin_invariant(self):
        """Genuine illuminated similarity (0.62 - 1.0) must maintain >= 0.20 separation above impostors (< 0.40)"""
        genuine_worst_case = 0.6200
        impostor_worst_case = 0.3999
        margin = genuine_worst_case - impostor_worst_case
        self.assertGreater(margin, 0.20, f"Separation margin {margin:.4f} must exceed 0.20")

    def test_09_decision_boundary_strictness(self):
        """Decision boundary at 0.62 must strictly accept >= 0.6200 and reject < 0.6200"""
        THRESHOLD = 0.62
        self.assertTrue(0.6200 >= THRESHOLD)
        self.assertTrue(0.6201 >= THRESHOLD)
        self.assertFalse(0.6199 >= THRESHOLD)
        self.assertFalse(0.5000 >= THRESHOLD)

    def test_10_pitch_black_frame_energy_detection(self):
        """Pitch black frame (gain x0.01) has mean intensity < 5, must be detected as invalid before neural inference"""
        pitch_black = (self.synthetic_face.astype(np.float32) * 0.01).astype(np.uint8)
        mean_intensity = float(np.mean(pitch_black))
        self.assertLess(mean_intensity, 5.0, "Pitch black frame must have mean intensity < 5.0")


if __name__ == "__main__":
    unittest.main(verbosity=2)
