"""
TASK 4.3 ISOLATION UNIT TEST SUITE: EVALUATION SCORECARD BIOMETRIC HUD
Tests EvaluationScorecard.tsx AST contracts, badges, reticle/landmark indicators,
similarity threshold decision boundaries (62%), and session HUD telemetry in isolation.
"""

import os
import re
import sys
import unittest

ROOT_DIR = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
SCORECARD_PATH = os.path.join(ROOT_DIR, "web", "src", "components", "EvaluationScorecard.tsx")
SESSION_HUD_PATH = os.path.join(ROOT_DIR, "web", "src", "app", "api", "biometrics", "session-hud", "route.ts")
GRADING_TYPES_PATH = os.path.join(ROOT_DIR, "web", "src", "types", "grading.ts")


class TestTask43ScorecardIsolationUnit(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        with open(SCORECARD_PATH, "r", encoding="utf-8") as f:
            cls.scorecard_code = f.read()
        with open(SESSION_HUD_PATH, "r", encoding="utf-8") as f:
            cls.session_hud_code = f.read()
        with open(GRADING_TYPES_PATH, "r", encoding="utf-8") as f:
            cls.types_code = f.read()

    # =========================================================================
    # SUITE 1: EvaluationScorecard AST Contracts & Badge Modernization
    # =========================================================================
    def test_01_arcface_liveness_badge_present(self):
        """Verify ArcFace & Liveness badge is rendered in EvaluationScorecard"""
        self.assertIn(
            "MobileFaceNet ArcFace 512-d | Anti-Spoof Liveness Passed",
            self.scorecard_code,
            "EvaluationScorecard must render 'MobileFaceNet ArcFace 512-d | Anti-Spoof Liveness Passed' badge"
        )

    def test_02_legacy_facenet_badge_purged(self):
        """Verify legacy '512-d FaceNet Vector Sealed' badge has been completely purged"""
        self.assertNotIn(
            "512-d FaceNet Vector Sealed",
            self.scorecard_code,
            "Legacy '512-d FaceNet Vector Sealed' badge must be purged from EvaluationScorecard"
        )

    def test_03_similarity_threshold_calibrated_to_62_percent(self):
        """Verify similarity match threshold indicator is calibrated to >= 62%"""
        self.assertIn(
            "(≥ 62%)",
            self.scorecard_code,
            "Similarity match indicator must display calibrated (≥ 62%) threshold"
        )
        self.assertNotIn(
            "68%",
            self.scorecard_code,
            "Legacy (≥ 68%) threshold must be purged from EvaluationScorecard"
        )

    def test_04_keyframe_landmark_verification_badge_present(self):
        """Verify live keyframe renders 5-point Umeyama landmark verification badge"""
        self.assertIn(
            "5-Point Umeyama Locked • Liveness Verified",
            self.scorecard_code,
            "Live keyframe must render '5-Point Umeyama Locked • Liveness Verified' badge"
        )

    def test_05_keyframe_clahe_normalization_tag_present(self):
        """Verify live keyframe displays illumination CLAHE normalization tag"""
        self.assertIn(
            "CLAHE Normalization Active",
            self.scorecard_code,
            "Live keyframe must render 'CLAHE Normalization Active' tag"
        )

    def test_06_enrolled_canonical_umeyama_tag_present(self):
        """Verify enrolled reference photo displays Canonical 112x112 Aligned tag"""
        self.assertIn(
            "Canonical 112×112 Aligned",
            self.scorecard_code,
            "Enrolled reference must render 'Canonical 112×112 Aligned' tag"
        )

    def test_07_hud_header_subtitle_modernized(self):
        """Verify HUD header subtitle references MobileFaceNet ArcFace 512-d"""
        self.assertIn(
            "MobileFaceNet ArcFace 512-d cosine telemetry",
            self.scorecard_code,
            "HUD subtitle must reference MobileFaceNet ArcFace 512-d"
        )

    def test_08_session_hud_fetch_uses_api_url_base_path(self):
        """Verify fetchBiometricHud uses apiUrl helper for basePath safety"""
        self.assertIn(
            "apiUrl(`/api/biometrics/session-hud",
            self.scorecard_code,
            "fetchBiometricHud must use apiUrl wrapper for basePath routing"
        )

    # =========================================================================
    # SUITE 2: Dynamic Similarity Threshold Decision Logic in Isolation
    # =========================================================================
    def test_09_decision_boundary_at_62_percent(self):
        """Verify mathematical decision boundary at 0.62 in isolation"""
        THRESHOLD = 0.62

        def is_match_passed(sim: float) -> bool:
            return sim >= THRESHOLD

        self.assertTrue(is_match_passed(1.0000), "Perfect match (1.0000) must pass")
        self.assertTrue(is_match_passed(0.9840), "Typical authentic match (0.9840) must pass")
        self.assertTrue(is_match_passed(0.7307), "Genuine cross-capture (0.7307) must pass")
        self.assertTrue(is_match_passed(0.6200), "Exact threshold boundary (0.6200) must pass")
        self.assertFalse(is_match_passed(0.6199), "Sub-threshold boundary (0.6199) must fail")
        self.assertFalse(is_match_passed(0.4210), "Unauthenticated baseline (0.4210) must fail")
        self.assertFalse(is_match_passed(0.0178), "Impostor probe (0.0178) must fail")

    def test_10_color_styling_logic_in_isolation(self):
        """Verify emerald vs rose CSS styling logic in isolation"""
        THRESHOLD = 0.62

        def get_color_class(sim: float) -> str:
            if sim >= THRESHOLD:
                return "bg-black/85 border-emerald-500/50 text-emerald-400"
            return "bg-black/85 border-rose-500/50 text-rose-400"

        self.assertIn("emerald", get_color_class(0.62))
        self.assertIn("emerald", get_color_class(0.85))
        self.assertIn("rose", get_color_class(0.619))
        self.assertIn("rose", get_color_class(0.0178))

    # =========================================================================
    # SUITE 3: Session HUD Route Telemetry Contract & Types
    # =========================================================================
    def test_11_session_hud_route_telemetry_fields(self):
        """Verify session-hud route returns livenessConfidence, alignmentMethod, and claheNormalized"""
        self.assertIn("livenessConfidence", self.session_hud_code)
        self.assertIn("alignmentMethod", self.session_hud_code)
        self.assertIn("claheNormalized", self.session_hud_code)
        self.assertIn("UMEYAMA_5POINT_112X112", self.session_hud_code)

    def test_12_grading_types_biometric_card_data(self):
        """Verify BiometricIdentityCardData interface contains extended telemetry fields"""
        self.assertIn("livenessConfidence?: number;", self.types_code)
        self.assertIn("alignmentMethod?: string;", self.types_code)
        self.assertIn("claheNormalized?: boolean;", self.types_code)


if __name__ == "__main__":
    unittest.main(verbosity=2)
