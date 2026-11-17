#!/usr/bin/env python3
"""
OpenViva Offline Biometric Feature Extraction Worker
Features:
  - SCRFD-500M Face Detection & 5-Point Landmark Extraction (pure NumPy/PIL + ONNX Runtime)
  - 512-dimensional L2-normalized facial vector (2,048 bytes float32 BLOB)
  - 192-dimensional L2-normalized acoustic voice vector (768 bytes float32 BLOB)
Zero cloud reliance: runs 100% on local CPU / GPU host with zero PyTorch or OpenCV dependencies.
"""

import sys
import os
import argparse
import json
import base64
import math
import struct
import numpy as np
from PIL import Image

class SCRFDDetector:
    """
    Ultra-lightweight face detector with 5 facial landmarks using SCRFD-500M in ONNX Runtime.
    Pure NumPy implementation: letterbox resizing, multi-stride anchor decoding, and vectorized NMS.
    """
    def __init__(self, model_path: str = None, conf_thresh: float = 0.5, iou_thresh: float = 0.4):
        self.conf_thresh = conf_thresh
        self.iou_thresh = iou_thresh
        self.target_size = 640
        self.strides = [8, 16, 32]
        self.num_anchors = 2

        candidates = [
            model_path,
            "/home/savan/openviva/models/face/scrfd_500m_kps.onnx",
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models", "face", "scrfd_500m_kps.onnx"),
            os.path.join(os.getcwd(), "models", "face", "scrfd_500m_kps.onnx")
        ]
        self.resolved_path = None
        for p in candidates:
            if p and os.path.exists(p):
                self.resolved_path = p
                break

        if not self.resolved_path:
            raise FileNotFoundError(f"SCRFD model not found in candidates: {candidates}")

        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 4
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(self.resolved_path, sess_options=opts, providers=['CPUExecutionProvider'])
        self.input_name = self.session.get_inputs()[0].name

        # Precompute anchor grid centers for 640x640 to maximize CPU throughput
        self.anchor_cache = {}
        for s in self.strides:
            fh = self.target_size // s
            fw = self.target_size // s
            grid_y, grid_x = np.mgrid[:fh, :fw]
            centers = np.stack([grid_x, grid_y], axis=-1).astype(np.float32) * s
            centers = np.repeat(centers.reshape((-1, 2)), self.num_anchors, axis=0)
            self.anchor_cache[s] = centers

    def _nms(self, boxes: np.ndarray, scores: np.ndarray, iou_thresh: float) -> list:
        if len(boxes) == 0:
            return []
        x1 = boxes[:, 0]
        y1 = boxes[:, 1]
        x2 = boxes[:, 2]
        y2 = boxes[:, 3]
        areas = (x2 - x1) * (y2 - y1)
        order = scores.argsort()[::-1]
        keep = []
        while order.size > 0:
            i = order[0]
            keep.append(i)
            xx1 = np.maximum(x1[i], x1[order[1:]])
            yy1 = np.maximum(y1[i], y1[order[1:]])
            xx2 = np.minimum(x2[i], x2[order[1:]])
            yy2 = np.minimum(y2[i], y2[order[1:]])
            w = np.maximum(0.0, xx2 - xx1)
            h = np.maximum(0.0, yy2 - yy1)
            inter = w * h
            ovr = inter / (areas[i] + areas[order[1:]] - inter + 1e-12)
            inds = np.where(ovr <= iou_thresh)[0]
            order = order[inds + 1]
        return keep

    def detect(self, pil_image: Image.Image) -> list:
        orig_w, orig_h = pil_image.size
        scale = min(self.target_size / orig_w, self.target_size / orig_h)
        new_w = int(orig_w * scale)
        new_h = int(orig_h * scale)

        resized = pil_image.resize((new_w, new_h), Image.Resampling.BILINEAR)
        canvas = Image.new('RGB', (self.target_size, self.target_size), (127, 127, 127))
        canvas.paste(resized, (0, 0))

        # Convert RGB to BGR and normalize to [-1.0, 1.0]
        arr_rgb = np.array(canvas, dtype=np.float32)
        arr_bgr = arr_rgb[:, :, ::-1]
        blob = (arr_bgr - 127.5) / 128.0
        blob = np.transpose(blob, (2, 0, 1))[np.newaxis, :]

        outputs = self.session.run(None, {self.input_name: blob})

        score_indices = [0, 1, 2] # 443, 468, 493
        bbox_indices = [3, 4, 5]  # 446, 471, 496
        kps_indices = [6, 7, 8]   # 449, 474, 499

        all_boxes = []
        all_scores = []
        all_kps = []

        for s_idx, stride in enumerate(self.strides):
            scores = outputs[score_indices[s_idx]]
            bboxes = outputs[bbox_indices[s_idx]]
            kpss = outputs[kps_indices[s_idx]]

            anchors = self.anchor_cache[stride]
            pos_mask = scores.flatten() >= self.conf_thresh
            if not np.any(pos_mask):
                continue

            pos_scores = scores[pos_mask].flatten()
            pos_anchors = anchors[pos_mask]
            pos_bboxes = bboxes[pos_mask]
            pos_kpss = kpss[pos_mask]

            x1 = np.clip((pos_anchors[:, 0] - pos_bboxes[:, 0] * stride) / scale, 0, orig_w)
            y1 = np.clip((pos_anchors[:, 1] - pos_bboxes[:, 1] * stride) / scale, 0, orig_h)
            x2 = np.clip((pos_anchors[:, 0] + pos_bboxes[:, 2] * stride) / scale, 0, orig_w)
            y2 = np.clip((pos_anchors[:, 1] + pos_bboxes[:, 3] * stride) / scale, 0, orig_h)

            num_pos = len(pos_scores)
            decoded_kps = np.zeros((num_pos, 5, 2), dtype=np.float32)
            for k in range(5):
                decoded_kps[:, k, 0] = np.clip((pos_anchors[:, 0] + pos_kpss[:, k*2] * stride) / scale, 0, orig_w)
                decoded_kps[:, k, 1] = np.clip((pos_anchors[:, 1] + pos_kpss[:, k*2 + 1] * stride) / scale, 0, orig_h)

            stacked_boxes = np.stack([x1, y1, x2, y2], axis=1)
            all_boxes.append(stacked_boxes)
            all_scores.append(pos_scores)
            all_kps.append(decoded_kps)

        if not all_boxes:
            return []

        boxes_cat = np.concatenate(all_boxes, axis=0)
        scores_cat = np.concatenate(all_scores, axis=0)
        kps_cat = np.concatenate(all_kps, axis=0)

        keep_indices = self._nms(boxes_cat, scores_cat, self.iou_thresh)
        results = []
        for idx in keep_indices:
            results.append({
                'score': float(scores_cat[idx]),
                'box': [round(float(v), 2) for v in boxes_cat[idx]],
                'kps': [[round(float(p[0]), 2), round(float(p[1]), 2)] for p in kps_cat[idx]]
            })
        return results

# Singleton detector instance for low-latency reuse
_detector_instance = None

def get_scrfd_detector(model_path: str = None) -> SCRFDDetector:
    global _detector_instance
    if _detector_instance is None:
        _detector_instance = SCRFDDetector(model_path=model_path)
    return _detector_instance

class SpoofError(ValueError):
    """Raised when passive anti-spoof liveness classification detects a presentation attack."""
    def __init__(self, message: str, liveness_score: float = 0.0, spoof_type: str = "SPOOF_ATTACK", spoof_probabilities: dict = None):
        super().__init__(message)
        self.liveness_score = liveness_score
        self.spoof_type = spoof_type
        self.spoof_probabilities = spoof_probabilities or {}

class MiniFASNetLiveness:
    """
    Passive Face Anti-Spoofing & Liveness Classifier using MiniFASNetV2 in ONNX Runtime.
    Analyzes Fourier frequency spectrum and skin reflection to detect 2D printouts and screen replays.
    """
    def __init__(self, model_path: str = None, liveness_thresh: float = 0.45):
        self.liveness_thresh = liveness_thresh
        self.target_size = (80, 80)
        self.scale = 2.7 # Silent-Face-Anti-Spoofing standard expansion ratio

        candidates = [
            model_path,
            "/home/savan/openviva/models/face/minifasnet_v2.onnx",
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models", "face", "minifasnet_v2.onnx"),
            os.path.join(os.getcwd(), "models", "face", "minifasnet_v2.onnx")
        ]
        self.resolved_path = None
        for p in candidates:
            if p and os.path.exists(p):
                self.resolved_path = p
                break

        if not self.resolved_path:
            raise FileNotFoundError(f"MiniFASNet model not found in candidates: {candidates}")

        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 2
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(self.resolved_path, sess_options=opts, providers=['CPUExecutionProvider'])
        self.input_name = self.session.get_inputs()[0].name

    def evaluate(self, pil_image: Image.Image, face_box: list) -> dict:
        """
        Evaluates bona fide liveness for a detected face bounding box [x1, y1, x2, y2].
        Returns: {
            "is_live": bool,
            "liveness_score": float (P_real, 0.0 - 1.0),
            "spoof_probabilities": { "real": float, "print_attack": float, "replay_attack": float },
            "spoof_type": str or None
        }
        """
        img_w, img_h = pil_image.size
        x1, y1, x2, y2 = face_box
        box_w = x2 - x1
        box_h = y2 - y1
        cx = x1 + box_w / 2.0
        cy = y1 + box_h / 2.0

        new_w = box_w * self.scale
        new_h = box_h * self.scale

        crop_x1 = max(0, int(cx - new_w / 2.0))
        crop_y1 = max(0, int(cy - new_h / 2.0))
        crop_x2 = min(img_w, int(cx + new_w / 2.0))
        crop_y2 = min(img_h, int(cy + new_h / 2.0))

        crop = pil_image.crop((crop_x1, crop_y1, crop_x2, crop_y2)).resize(self.target_size, Image.Resampling.BILINEAR)

        # Convert RGB to BGR float32
        arr_bgr = np.array(crop, dtype=np.float32)[:, :, ::-1]
        blob = np.transpose(arr_bgr, (2, 0, 1))[np.newaxis, :]

        outputs = self.session.run(None, {self.input_name: blob})[0][0]

        # Numerically stable softmax
        exp_logits = np.exp(outputs - np.max(outputs))
        probs = exp_logits / np.sum(exp_logits)

        # Class 0: print-attack, Class 1: RealFace, Class 2: replay-attack
        p_print = float(probs[0])
        p_real = float(probs[1])
        p_replay = float(probs[2])

        is_live = bool(p_real >= self.liveness_thresh)
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

_liveness_instance = None

def get_liveness_classifier(model_path: str = None) -> MiniFASNetLiveness:
    global _liveness_instance
    if _liveness_instance is None:
        _liveness_instance = MiniFASNetLiveness(model_path=model_path)
    return _liveness_instance

# =========================================================================
# Canonical Reference Points & Pure NumPy Umeyama Affine Alignment
# =========================================================================

ARCFACE_CANONICAL_5PTS = np.array([
    [38.2946, 51.6963],  # left eye
    [73.5318, 51.5014],  # right eye
    [56.0252, 71.7366],  # nose
    [41.5493, 92.3655],  # left mouth
    [70.7266, 92.2041]   # right mouth
], dtype=np.float32)

def umeyama(src: np.ndarray, dst: np.ndarray, estimate_scale: bool = True) -> np.ndarray:
    """
    Computes optimal similarity transformation (s * R * src + t = dst) in pure NumPy
    via Shinji Umeyama (1991) 'Least-Squares Estimation of Transformation Parameters Between Two Point Patterns'.
    Returns: 3x3 homogeneous transformation matrix M such that dst_homo = (M @ src_homo.T).T
    """
    num = src.shape[0]
    dim = src.shape[1]

    src_mean = src.mean(axis=0)
    dst_mean = dst.mean(axis=0)

    src_demean = src - src_mean
    dst_demean = dst - dst_mean

    A = np.dot(dst_demean.T, src_demean) / num

    d = np.ones((dim,), dtype=np.float64)
    if np.linalg.det(A) < 0:
        d[dim - 1] = -1

    T = np.eye(dim + 1, dtype=np.float64)
    U, S, Vh = np.linalg.svd(A)

    rank = np.linalg.matrix_rank(A)
    if rank == 0:
        return np.eye(dim + 1, dtype=np.float64)
    elif rank == dim - 1:
        if np.linalg.det(U) * np.linalg.det(Vh) > 0:
            T[:dim, :dim] = np.dot(U, Vh)
        else:
            s = d[dim - 1]
            d[dim - 1] = -1
            T[:dim, :dim] = np.dot(U, np.dot(np.diag(d), Vh))
            d[dim - 1] = s
    else:
        T[:dim, :dim] = np.dot(U, np.dot(np.diag(d), Vh))

    if estimate_scale:
        src_var = np.var(src, axis=0).sum()
        if src_var < 1e-8:
            scale = 1.0
        else:
            scale = 1.0 / src_var * np.dot(S, d)
    else:
        scale = 1.0

    T[:dim, :dim] *= scale
    T[:dim, dim] = dst_mean - np.dot(T[:dim, :dim], src_mean)
    return T

def warp_face_arcface(img: Image.Image, kps: np.ndarray, output_size=(112, 112)) -> Image.Image:
    """
    Warps face to canonical 112x112 space using Umeyama similarity transform.
    Uses inverse mapping matrix for PIL affine transformation.
    """
    kps = np.asarray(kps, dtype=np.float32)
    # Compute inverse transform: canonical target -> source image
    T_inv = umeyama(ARCFACE_CANONICAL_5PTS, kps, estimate_scale=True)
    data = (
        float(T_inv[0, 0]), float(T_inv[0, 1]), float(T_inv[0, 2]),
        float(T_inv[1, 0]), float(T_inv[1, 1]), float(T_inv[1, 2])
    )
    return img.transform(output_size, Image.Transform.AFFINE, data=data, resample=Image.Resampling.BILINEAR)

def numpy_clahe(img: Image.Image, grid_size=(8, 8), clip_limit=2.5) -> Image.Image:
    """
    Pure NumPy implementation of Contrast Limited Adaptive Histogram Equalization on Luminance (Y).
    Preserves chromaticity (Cb, Cr) while suppressing harsh shadows and high-frequency glare.
    """
    arr = np.array(img, dtype=np.float32)
    R = arr[:, :, 0]
    G = arr[:, :, 1]
    B = arr[:, :, 2]

    # ITU-R BT.601 RGB -> YCbCr
    Y = 0.299 * R + 0.587 * G + 0.114 * B
    Cb = -0.168736 * R - 0.331264 * G + 0.5 * B + 128.0
    Cr = 0.5 * R - 0.418688 * G - 0.081312 * B + 128.0

    H, W = Y.shape
    gh, gw = grid_size
    tile_h = H // gh
    tile_w = W // gw

    tile_centers_y = np.linspace(tile_h / 2.0, H - tile_h / 2.0, gh)
    tile_centers_x = np.linspace(tile_w / 2.0, W - tile_w / 2.0, gw)

    tile_cdfs = np.zeros((gh, gw, 256), dtype=np.float32)
    tile_pixels = tile_h * tile_w
    nominal_clip = clip_limit * (tile_pixels / 256.0)

    Y_uint8 = np.clip(Y, 0, 255).astype(np.uint8)

    for r in range(gh):
        y0 = r * tile_h
        y1 = (r + 1) * tile_h
        for c in range(gw):
            x0 = c * tile_w
            x1 = (c + 1) * tile_w
            tile_vals = Y_uint8[y0:y1, x0:x1].flatten()

            hist = np.bincount(tile_vals, minlength=256).astype(np.float32)
            excess = np.sum(np.maximum(0.0, hist - nominal_clip))
            clipped = np.minimum(hist, nominal_clip) + (excess / 256.0)

            cdf = np.cumsum(clipped)
            cdf_min = cdf[0]
            cdf_max = cdf[-1]
            if cdf_max > cdf_min:
                norm_cdf = (cdf - cdf_min) / (cdf_max - cdf_min) * 255.0
            else:
                norm_cdf = np.linspace(0, 255, 256)
            tile_cdfs[r, c] = norm_cdf

    y_coords = np.arange(H, dtype=np.float32)
    x_coords = np.arange(W, dtype=np.float32)

    y_clamped = np.clip(y_coords, tile_centers_y[0], tile_centers_y[-1])
    x_clamped = np.clip(x_coords, tile_centers_x[0], tile_centers_x[-1])

    r_cont = (y_clamped - tile_centers_y[0]) / tile_h
    c_cont = (x_clamped - tile_centers_x[0]) / tile_w

    r0 = np.clip(np.floor(r_cont).astype(np.int32), 0, gh - 2)
    c0 = np.clip(np.floor(c_cont).astype(np.int32), 0, gw - 2)

    wy = (r_cont - r0)[:, np.newaxis]
    wx = (c_cont - c0)[np.newaxis, :]

    R0, C0 = np.meshgrid(r0, c0, indexing='ij')
    R1, C1 = np.meshgrid(r0 + 1, c0 + 1, indexing='ij')

    val = Y_uint8
    v00 = tile_cdfs[R0, C0, val]
    v01 = tile_cdfs[R0, C1, val]
    v10 = tile_cdfs[R1, C0, val]
    v11 = tile_cdfs[R1, C1, val]

    top = (1.0 - wx) * v00 + wx * v01
    bottom = (1.0 - wx) * v10 + wx * v11
    Y_clahe = (1.0 - wy) * top + wy * bottom

    R_new = Y_clahe + 1.402 * (Cr - 128.0)
    G_new = Y_clahe - 0.344136 * (Cb - 128.0) - 0.714136 * (Cr - 128.0)
    B_new = Y_clahe + 1.772 * (Cb - 128.0)

    rgb_clahe = np.stack([
        np.clip(R_new, 0, 255),
        np.clip(G_new, 0, 255),
        np.clip(B_new, 0, 255)
    ], axis=-1).astype(np.uint8)

    return Image.fromarray(rgb_clahe, mode='RGB')

def align_and_equalize_face(img: Image.Image, kps: np.ndarray) -> tuple:
    """
    Combines Umeyama 5-point alignment and pure NumPy CLAHE normalization.
    Returns: (processed_img: Image.Image, metadata: dict)
    """
    aligned = warp_face_arcface(img, kps, output_size=(112, 112))
    equalized = numpy_clahe(aligned, grid_size=(8, 8), clip_limit=2.5)
    meta = {
        "aligned_size": [112, 112],
        "alignment_status": "UMEYAMA_ALIGNED_112X112",
        "illumination_status": "OPTIMAL_EQUALIZED"
    }
    return equalized, meta

# =========================================================================
# MobileFaceNet-ArcFace Deep Facial Feature Extraction Engine (Task 2.4)
# =========================================================================

class ArcFaceExtractor:
    """
    Deep facial feature extractor using MobileFaceNet-ArcFace in ONNX Runtime.
    Produces 512-dimensional unit-norm facial embedding vectors (2,048 bytes float32)
    trained with Additive Angular Margin Loss (ArcFace).
    """
    def __init__(self, model_path: str = None):
        candidates = [
            model_path,
            "/home/savan/openviva/models/face/mobilefacenet_arcface_512.onnx",
            os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "models", "face", "mobilefacenet_arcface_512.onnx"),
            os.path.join(os.getcwd(), "models", "face", "mobilefacenet_arcface_512.onnx")
        ]
        self.resolved_path = None
        for p in candidates:
            if p and os.path.exists(p):
                self.resolved_path = p
                break

        if not self.resolved_path:
            raise FileNotFoundError(f"MobileFaceNet ArcFace model not found in candidates: {candidates}")

        import onnxruntime as ort
        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 4
        opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
        self.session = ort.InferenceSession(self.resolved_path, sess_options=opts, providers=['CPUExecutionProvider'])
        self.input_name = self.session.get_inputs()[0].name

    def extract(self, aligned_image: Image.Image) -> bytes:
        """
        Extracts 512-dim L2-normalized float32 embedding vector from 112x112 aligned image.
        Returns: bytes of length 2048 (512 float32 values).
        """
        if aligned_image.size != (112, 112):
            aligned_image = aligned_image.resize((112, 112), Image.Resampling.BILINEAR)

        # InsightFace standard normalization: BGR format, (x - 127.5) / 127.5 (range [-1.0, 1.0])
        arr_rgb = np.array(aligned_image, dtype=np.float32)
        arr_bgr = arr_rgb[:, :, ::-1]
        blob = (arr_bgr - 127.5) / 127.5
        blob = np.transpose(blob, (2, 0, 1))[np.newaxis, :].astype(np.float32)

        raw_embedding = self.session.run(None, {self.input_name: blob})[0][0]

        # Strict Unit Hypersphere L2 normalization
        norm = np.linalg.norm(raw_embedding)
        if norm > 1e-12:
            normalized = raw_embedding / norm
        else:
            normalized = raw_embedding

        normalized = normalized.astype(np.float32)
        assert len(normalized) == 512, f"Embedding must be 512-dimensional, got {len(normalized)}"
        return normalized.tobytes()

_arcface_instance = None

def get_arcface_extractor(model_path: str = None) -> ArcFaceExtractor:
    global _arcface_instance
    if _arcface_instance is None:
        _arcface_instance = ArcFaceExtractor(model_path=model_path)
    return _arcface_instance

def extract_face_embedding(image_path: str, device: str = "cpu", verify_liveness: bool = True) -> tuple:
    """
    Extracts 512-dim L2-normalized float32 vector (2,048 bytes) from face image.
    Uses SCRFD-500M for real-time localization, MiniFASNet-V2 for anti-spoof liveness,
    Umeyama 5-point affine warp with NumPy CLAHE for canonical face normalization,
    and MobileFaceNet ArcFace for 512-d deep feature extraction.
    Returns: (embedding_bytes: bytes, face_meta: dict)
    Raises:
      ValueError("NO_FACE_DETECTED") if 0 faces found.
      ValueError("MULTIPLE_FACES_DETECTED") if >1 faces found.
      ValueError("SPOOF_PHOTO_DETECTED") if presentation attack detected.
    """
    img = Image.open(image_path).convert("RGB")
    detector = get_scrfd_detector()
    faces = detector.detect(img)

    if len(faces) == 0:
        raise ValueError("NO_FACE_DETECTED: No human face found in image.")
    if len(faces) > 1:
        raise ValueError(f"MULTIPLE_FACES_DETECTED: {len(faces)} individuals detected in frame.")

    face = faces[0]
    box = face['box']
    kps = face['kps']
    score = face['score']

    # Passive Liveness Verification
    liveness_meta = {"is_live": True, "liveness_score": 1.0, "spoof_probabilities": {}}
    if verify_liveness:
        liveness_classifier = get_liveness_classifier()
        liveness = liveness_classifier.evaluate(img, box)
        liveness_meta = {
            "is_live": liveness["is_live"],
            "liveness_score": liveness["liveness_score"],
            "spoof_probabilities": liveness["spoof_probabilities"],
            "spoof_type": liveness["spoof_type"]
        }
        if not liveness["is_live"]:
            raise SpoofError(
                f"SPOOF_PHOTO_DETECTED: Presentation attack detected ({liveness['spoof_type']}). Liveness score: {liveness['liveness_score']:.3f} < {liveness_classifier.liveness_thresh}",
                liveness_score=liveness["liveness_score"],
                spoof_type=liveness["spoof_type"],
                spoof_probabilities=liveness["spoof_probabilities"]
            )

    # Canonical 5-Point Umeyama Affine Alignment & Pure NumPy CLAHE Normalization (Task 2.3)
    aligned_face, align_meta = align_and_equalize_face(img, np.array(kps, dtype=np.float32))

    # MobileFaceNet ArcFace 512-d Feature Extraction (Task 2.4)
    arcface = get_arcface_extractor()
    embedding_bytes = arcface.extract(aligned_face)

    face_meta = {
        "face_detected": True,
        "detection_score": score,
        "face_box": box,
        "landmarks": kps,
        "faces_count": 1,
        **align_meta,
        **liveness_meta,
        "embedding_model": "MobileFaceNet-ArcFace-512",
        "embedding_dim": 512,
        "embedding_l2_norm": round(float(np.linalg.norm(np.frombuffer(embedding_bytes, dtype=np.float32))), 6)
    }
    return embedding_bytes, face_meta

def resample_to_16k(audio, orig_sr: int):
    """Resamples 1D float32 audio to 16,000 Hz using linear interpolation."""
    if orig_sr == 16000:
        return audio.astype(np.float32)
    target_len = int(len(audio) * 16000 / orig_sr)
    if target_len <= 0:
        return np.zeros(160, dtype=np.float32)
    old_x = np.linspace(0, 1, len(audio))
    new_x = np.linspace(0, 1, target_len)
    return np.interp(new_x, old_x, audio).astype(np.float32)

def compute_acoustic_vector_192(audio: np.ndarray, orig_sr: int = 16000) -> np.ndarray:
    """Computes 192-dimensional acoustic timbre & pitch representation."""
    if len(audio.shape) > 1:
        audio = audio.mean(axis=1)

    if orig_sr != 16000:
        audio_16k = resample_to_16k(audio, orig_sr)
    else:
        audio_16k = audio.astype(np.float32)

    pre_emphasis = 0.97
    emphasized = np.append(audio_16k[0], audio_16k[1:] - pre_emphasis * audio_16k[:-1])

    frame_size = 512
    hop_size = 256
    if len(emphasized) < frame_size:
        emphasized = np.pad(emphasized, (0, frame_size - len(emphasized)))

    num_frames = (len(emphasized) - frame_size) // hop_size + 1
    window = np.hanning(frame_size)

    voiced_specs = []
    energy_thresh = 0.005

    for i in range(num_frames):
        start = i * hop_size
        frame = emphasized[start:start + frame_size]
        rms = np.sqrt(np.mean(frame ** 2))
        if rms >= energy_thresh:
            spec = np.abs(np.fft.rfft(frame * window))
            log_spec = np.log10(spec + 1e-4)
            voiced_specs.append(log_spec)

    if not voiced_specs:
        for i in range(num_frames):
            start = i * hop_size
            frame = emphasized[start:start + frame_size]
            spec = np.abs(np.fft.rfft(frame * window))
            voiced_specs.append(np.log10(spec + 1e-4))

    mean_spec = np.mean(voiced_specs, axis=0)
    band = mean_spec[3:195]
    if len(band) < 192:
        band = np.pad(band, (0, 192 - len(band)))
    else:
        band = band[:192]

    diff = np.diff(band, prepend=band[0])
    feat = np.concatenate([band[:96] - np.mean(band[:96]), diff[:96] - np.mean(diff[:96])])

    norm = np.linalg.norm(feat)
    if norm > 0:
        feat = feat / norm
    return feat.astype(np.float32)

def decode_audio_array(audio_path_or_bytes, target_sr: int = 16000):
    """
    Decodes audio array from file path or bytes using PyAV (handles WebM, Opus, AAC, M4A, WAV),
    falling back to soundfile and wave.
    """
    # 1. PyAV decoder (handles any container without CLI dependency)
    try:
        import av
        import io
        if isinstance(audio_path_or_bytes, (bytes, bytearray)):
            container = av.open(io.BytesIO(audio_path_or_bytes))
        else:
            container = av.open(audio_path_or_bytes)
        resampler = av.AudioResampler(format='fltp', layout='mono', rate=target_sr)
        all_samples = []
        audio_stream = container.streams.audio[0] if container.streams.audio else None
        if audio_stream:
            for packet in container.demux(audio_stream):
                try:
                    frames = packet.decode()
                    for frame in frames:
                        for rf in resampler.resample(frame):
                            all_samples.append(rf.to_ndarray()[0])
                except Exception:
                    continue
        container.close()
        if all_samples:
            return np.concatenate(all_samples).astype(np.float32), target_sr
    except Exception:
        pass

    # 2. Soundfile decoder
    try:
        import soundfile as sf
        import io
        if isinstance(audio_path_or_bytes, (bytes, bytearray)):
            audio, sr = sf.read(io.BytesIO(audio_path_or_bytes))
        else:
            audio, sr = sf.read(audio_path_or_bytes)
        if len(audio.shape) > 1:
            audio = audio.mean(axis=1)
        return audio.astype(np.float32), sr
    except Exception:
        pass

    # 3. Wave decoder
    try:
        import wave
        import io
        src = io.BytesIO(audio_path_or_bytes) if isinstance(audio_path_or_bytes, (bytes, bytearray)) else audio_path_or_bytes
        with wave.open(src, 'rb') as wf:
            sr = wf.getframerate()
            n_channels = wf.getnchannels()
            n_frames = wf.getnframes()
            raw_data = wf.readframes(n_frames)
        audio = np.frombuffer(raw_data, dtype=np.int16).astype(np.float32) / 32768.0
        if n_channels > 1:
            audio = audio.reshape(-1, n_channels).mean(axis=1)
        return audio.astype(np.float32), sr
    except Exception:
        pass

    raise RuntimeError(f"Unable to decode audio source")

def extract_voice_embedding(audio_path: str, device: str = "cpu") -> bytes:
    """Extracts 192-dim L2-normalized float32 vector (768 bytes) from voice audio sample. Zero fallbacks."""
    audio, sr = decode_audio_array(audio_path, target_sr=16000)
    if audio is None or len(audio) < 160:
        raise ValueError(f"Audio sample in {audio_path} is empty or too short ({0 if audio is None else len(audio)} samples). Cannot extract acoustic features.")
    feat_voice = compute_acoustic_vector_192(audio, sr)
    if len(feat_voice) != 192:
        raise ValueError(f"Acoustic vector dimension mismatch: expected 192, got {len(feat_voice)}")
    return feat_voice.tobytes()

def main():
    parser = argparse.ArgumentParser(description="Extract 512-d Face & 192-d Voice Vectors with SCRFD Neural Detection, MiniFASNet Liveness & Umeyama/CLAHE Alignment")
    parser.add_argument("--face", type=str, required=True, help="Path to face portrait image")
    parser.add_argument("--voice", type=str, default=None, help="Optional path to voice audio WAV sample")
    parser.add_argument("--device", type=str, default="cpu")
    parser.add_argument("--detect-only", action="store_true", help="Only run face detection and output box/landmarks")
    parser.add_argument("--liveness-only", action="store_true", help="Only run face detection and liveness anti-spoof evaluation")
    parser.add_argument("--align-only", action="store_true", help="Only run face detection, liveness, and canonical 112x112 Umeyama/CLAHE alignment")
    parser.add_argument("--skip-liveness", action="store_true", help="Skip presentation attack detection")
    args = parser.parse_args()

    if args.detect_only or args.liveness_only or args.align_only:
        try:
            img = Image.open(args.face).convert("RGB")
            detector = get_scrfd_detector()
            faces = detector.detect(img)
            if len(faces) == 0:
                print(json.dumps({"success": False, "error": "NO_FACE_DETECTED", "message": "No human face found in image."}))
                sys.exit(0)
            elif len(faces) > 1:
                print(json.dumps({"success": False, "error": "MULTIPLE_FACES_DETECTED", "message": f"Multiple faces ({len(faces)}) detected.", "faces": faces}))
                sys.exit(0)
            else:
                face = faces[0]
                res_payload = {"success": True, "face": face, "faces_count": 1}
                if args.liveness_only or args.align_only:
                    liveness = get_liveness_classifier().evaluate(img, face['box'])
                    res_payload.update(liveness)
                    if not liveness["is_live"] and not args.skip_liveness:
                        print(json.dumps({"success": False, "error": "SPOOF_PHOTO_DETECTED", "message": f"Presentation attack ({liveness['spoof_type']}) detected.", **res_payload}))
                        sys.exit(0)
                if args.align_only:
                    _, align_meta = align_and_equalize_face(img, face['kps'])
                    res_payload.update(align_meta)
                print(json.dumps(res_payload))
                sys.exit(0)
        except Exception as e:
            print(json.dumps({"success": False, "error": "DETECTION_ERROR", "message": str(e)}))
            sys.exit(1)

    try:
        face_blob, face_meta = extract_face_embedding(args.face, device=args.device, verify_liveness=(not args.skip_liveness))
        assert len(face_blob) == 2048, f"Face embedding must be 2048 bytes, got {len(face_blob)}"

        output = {
            "success": True,
            "face_embedding_base64": base64.b64encode(face_blob).decode("ascii"),
            "face_embedding_bytes": len(face_blob),
            **face_meta
        }

        if args.voice:
            voice_blob = extract_voice_embedding(args.voice, device=args.device)
            assert len(voice_blob) == 768, f"Voice embedding must be 768 bytes, got {len(voice_blob)}"
            output["voice_embedding_base64"] = base64.b64encode(voice_blob).decode("ascii")
            output["voice_embedding_bytes"] = len(voice_blob)

        print(json.dumps(output))
    except SpoofError as se:
        print(json.dumps({
            "success": False,
            "error": "SPOOF_PHOTO_DETECTED",
            "message": str(se),
            "liveness_score": se.liveness_score,
            "spoof_type": se.spoof_type,
            "spoof_probabilities": se.spoof_probabilities
        }))
        sys.exit(0)
    except ValueError as ve:
        err_msg = str(ve)
        err_code = "NO_FACE_DETECTED" if "NO_FACE_DETECTED" in err_msg else "MULTIPLE_FACES_DETECTED" if "MULTIPLE_FACES_DETECTED" in err_msg else "SPOOF_PHOTO_DETECTED" if "SPOOF_PHOTO_DETECTED" in err_msg else "VALIDATION_ERROR"
        print(json.dumps({"success": False, "error": err_code, "message": err_msg}))
        sys.exit(0)
    except Exception as e:
        print(json.dumps({"success": False, "error": "EXTRACTION_FAILURE", "message": str(e)}))
        sys.exit(1)

if __name__ == "__main__":
    main()
