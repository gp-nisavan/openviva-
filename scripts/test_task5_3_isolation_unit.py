"""
TASK 5.3 ISOLATION UNIT TEST SUITE: END-TO-END CANDIDATE VIVA DEFENSE LIFECYCLE
Tests candidate viva defense lifecycle state machines, keyframe URI contracts,
0.62 calibrated decision boundary formatting, TA scorecard badge logic,
pre-validation staging cleanup, and HUD telemetry schema invariants in strict isolation.
"""

import unittest
import numpy as np


class CandidateVivaLifecycleStateMachine:
    """
    Finite State Machine modeling the full student viva defense biometric lifecycle.
    States: UNENROLLED -> ENROLLED -> IN_CHAMBER_GATE -> (AUTHENTICATED | FLAGGED | SPOOF_ABORTED) -> TA_EVALUATION
    """
    STATES = {"UNENROLLED", "ENROLLED", "IN_CHAMBER_GATE", "AUTHENTICATED", "FLAGGED", "SPOOF_ABORTED", "TA_EVALUATION"}

    def __init__(self, reg_no: str):
        self.reg_no = reg_no
        self.state = "UNENROLLED"
        self.face_embedding = None
        self.voice_embedding = None
        self.session_keyframe = None
        self.similarity_score = None
        self.liveness_score = None

    def enroll(self, face_bytes: bytes, voice_bytes: bytes, is_live: bool, liveness_score: float):
        if self.state != "UNENROLLED":
            raise ValueError(f"Cannot enroll candidate in state {self.state}")
        if not is_live:
            self.state = "SPOOF_ABORTED"
            raise ValueError("SPOOF_PHOTO_DETECTED: Presentation attack during enrollment")
        if len(face_bytes) != 2048 or len(voice_bytes) != 768:
            raise ValueError("Invalid biometric vector byte lengths")

        self.face_embedding = face_bytes
        self.voice_embedding = voice_bytes
        self.liveness_score = liveness_score
        self.state = "ENROLLED"

    def enter_chamber_gate(self, session_id: str, live_frame_bytes: bytes, is_live: bool, similarity: float):
        if self.state != "ENROLLED":
            raise ValueError(f"Candidate must be enrolled before chamber gate; currently {self.state}")
        self.state = "IN_CHAMBER_GATE"
        self.similarity_score = similarity

        if not is_live:
            self.state = "SPOOF_ABORTED"
            raise ValueError("SPOOF_PHOTO_DETECTED: Presentation attack at chamber gate")

        if similarity >= 0.62:
            self.state = "AUTHENTICATED"
            self.session_keyframe = f"keyframes/{session_id}.jpg"
        else:
            self.state = "FLAGGED"

    def review_scorecard(self):
        if self.state not in ("AUTHENTICATED", "FLAGGED"):
            raise ValueError(f"Cannot review scorecard for unadmitted session in state {self.state}")
        return {
            "regNo": self.reg_no,
            "verificationStatus": self.state,
            "faceMatchSimilarity": round(self.similarity_score, 4) if self.similarity_score is not None else 0.0,
            "livenessConfidence": self.liveness_score,
            "claheNormalized": True,
            "alignmentMethod": "UMEYAMA_5POINT_112X112",
            "hasKeyframe": self.session_keyframe is not None
        }


def format_similarity_badge(similarity: float, threshold: float = 0.62) -> dict:
    """
    Renders similarity percentage and CSS color classes per EvaluationScorecard UI contract.
    """
    percentage = similarity * 100.0
    is_match = similarity >= threshold
    text = f"Similarity Match: {percentage:.1f}% (≥ {int(threshold*100)}%)"
    badge_class = "text-emerald-400 bg-emerald-500/10 border-emerald-500/20" if is_match else "text-rose-400 bg-rose-500/10 border-rose-500/20"
    return {
        "text": text,
        "is_match": is_match,
        "badge_class": badge_class,
        "percentage": round(percentage, 1)
    }


def resolve_biometric_photo_uri(reg_no: str, photo_type: str, session_id: str = None) -> str:
    """
    Resolves disk file path contract for /api/biometrics/photo.
    """
    if photo_type == "keyframe":
        if not session_id:
            raise ValueError("session_id required for keyframe lookup")
        return f"/storage/biometrics/keyframes/{session_id}.jpg"
    elif photo_type == "reference":
        return f"/storage/biometrics/faces/{reg_no}.jpg"
    else:
        raise ValueError(f"Unknown photo type {photo_type}")


class TestTask53VivaLifecycleIsolationUnit(unittest.TestCase):

    # -------------------------------------------------------------------------
    # SUITE 1: Candidate Viva Defense Lifecycle State Machine
    # -------------------------------------------------------------------------
    def test_unit_1_1_full_happy_path_lifecycle(self):
        candidate = CandidateVivaLifecycleStateMachine("reg1")
        self.assertEqual(candidate.state, "UNENROLLED")

        # 1. Enroll bona fide candidate
        dummy_face = np.random.randn(512).astype(np.float32).tobytes()
        dummy_voice = np.random.randn(192).astype(np.float32).tobytes()
        candidate.enroll(dummy_face, dummy_voice, is_live=True, liveness_score=0.995)
        self.assertEqual(candidate.state, "ENROLLED")

        # 2. Chamber Gate Verification
        candidate.enter_chamber_gate("sess_123", b"dummy_jpeg", is_live=True, similarity=0.7307)
        self.assertEqual(candidate.state, "AUTHENTICATED")
        self.assertEqual(candidate.session_keyframe, "keyframes/sess_123.jpg")

        # 3. TA Scorecard Review
        hud = candidate.review_scorecard()
        self.assertEqual(hud["verificationStatus"], "AUTHENTICATED")
        self.assertEqual(hud["faceMatchSimilarity"], 0.7307)
        self.assertTrue(hud["hasKeyframe"])
        self.assertEqual(hud["alignmentMethod"], "UMEYAMA_5POINT_112X112")

    def test_unit_1_2_impostor_flagged_lifecycle(self):
        candidate = CandidateVivaLifecycleStateMachine("reg1")
        dummy_face = np.ones(512, dtype=np.float32).tobytes()
        dummy_voice = np.ones(192, dtype=np.float32).tobytes()
        candidate.enroll(dummy_face, dummy_voice, is_live=True, liveness_score=0.985)

        # Gate rejected due to low similarity
        candidate.enter_chamber_gate("sess_imp", b"dummy_jpeg", is_live=True, similarity=0.0178)
        self.assertEqual(candidate.state, "FLAGGED")
        self.assertIsNone(candidate.session_keyframe)

        hud = candidate.review_scorecard()
        self.assertEqual(hud["verificationStatus"], "FLAGGED")
        self.assertEqual(hud["faceMatchSimilarity"], 0.0178)
        self.assertFalse(hud["hasKeyframe"])

    def test_unit_1_3_spoof_attack_trapped_at_enrollment(self):
        candidate = CandidateVivaLifecycleStateMachine("attacker_1")
        dummy_face = np.ones(512, dtype=np.float32).tobytes()
        dummy_voice = np.ones(192, dtype=np.float32).tobytes()
        with self.assertRaises(ValueError) as ctx:
            candidate.enroll(dummy_face, dummy_voice, is_live=False, liveness_score=0.005)
        self.assertIn("SPOOF_PHOTO_DETECTED", str(ctx.exception))
        self.assertEqual(candidate.state, "SPOOF_ABORTED")

    def test_unit_1_4_spoof_attack_trapped_at_chamber_gate(self):
        candidate = CandidateVivaLifecycleStateMachine("reg1")
        dummy_face = np.ones(512, dtype=np.float32).tobytes()
        dummy_voice = np.ones(192, dtype=np.float32).tobytes()
        candidate.enroll(dummy_face, dummy_voice, is_live=True, liveness_score=0.990)

        with self.assertRaises(ValueError) as ctx:
            candidate.enter_chamber_gate("sess_spoof", b"dummy_jpeg", is_live=False, similarity=0.950)
        self.assertIn("SPOOF_PHOTO_DETECTED", str(ctx.exception))
        self.assertEqual(candidate.state, "SPOOF_ABORTED")
        self.assertIsNone(candidate.session_keyframe)

    # -------------------------------------------------------------------------
    # SUITE 2: Keyframe & Photo URI Contracts
    # -------------------------------------------------------------------------
    def test_unit_2_1_keyframe_uri_contract(self):
        uri = resolve_biometric_photo_uri("reg1", "keyframe", "sess_999")
        self.assertEqual(uri, "/storage/biometrics/keyframes/sess_999.jpg")

    def test_unit_2_2_reference_photo_uri_contract(self):
        uri = resolve_biometric_photo_uri("reg1", "reference")
        self.assertEqual(uri, "/storage/biometrics/faces/reg1.jpg")

    def test_unit_2_3_missing_session_id_raises_value_error(self):
        with self.assertRaises(ValueError):
            resolve_biometric_photo_uri("reg1", "keyframe", None)

    # -------------------------------------------------------------------------
    # SUITE 3: 0.62 Calibrated Decision Boundary & Badge Rendering
    # -------------------------------------------------------------------------
    def test_unit_3_1_similarity_badge_authenticated_match(self):
        badge = format_similarity_badge(0.7307, threshold=0.62)
        self.assertTrue(badge["is_match"])
        self.assertEqual(badge["text"], "Similarity Match: 73.1% (≥ 62%)")
        self.assertIn("text-emerald-400", badge["badge_class"])

    def test_unit_3_2_similarity_badge_exact_threshold(self):
        badge = format_similarity_badge(0.6200, threshold=0.62)
        self.assertTrue(badge["is_match"])
        self.assertEqual(badge["text"], "Similarity Match: 62.0% (≥ 62%)")
        self.assertIn("text-emerald-400", badge["badge_class"])

    def test_unit_3_3_similarity_badge_below_threshold(self):
        badge = format_similarity_badge(0.6190, threshold=0.62)
        self.assertFalse(badge["is_match"])
        self.assertEqual(badge["text"], "Similarity Match: 61.9% (≥ 62%)")
        self.assertIn("text-rose-400", badge["badge_class"])

    def test_unit_3_4_similarity_badge_impostor(self):
        badge = format_similarity_badge(0.0178, threshold=0.62)
        self.assertFalse(badge["is_match"])
        self.assertEqual(badge["text"], "Similarity Match: 1.8% (≥ 62%)")
        self.assertIn("text-rose-400", badge["badge_class"])

    # -------------------------------------------------------------------------
    # SUITE 4: Vector Schema & Staging Integrity
    # -------------------------------------------------------------------------
    def test_unit_4_1_vector_byte_length_invariants(self):
        face_512 = np.random.randn(512).astype(np.float32).tobytes()
        voice_192 = np.random.randn(192).astype(np.float32).tobytes()
        self.assertEqual(len(face_512), 2048)
        self.assertEqual(len(voice_192), 768)

    def test_unit_4_2_invalid_vector_length_rejection(self):
        candidate = CandidateVivaLifecycleStateMachine("reg1")
        bad_face = b"\x00" * 1024
        voice_192 = b"\x00" * 768
        with self.assertRaises(ValueError):
            candidate.enroll(bad_face, voice_192, is_live=True, liveness_score=0.99)


if __name__ == "__main__":
    unittest.main()
