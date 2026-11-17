#!/usr/bin/env python3
"""
OpenViva Persistent In-Memory Biometric Daemon (Issue 9 Remediation)
Zero cold-start latency: Models (SCRFD-500M, MiniFASNet-V2, MobileFaceNet-ArcFace)
are loaded once into RAM at process startup and kept warm in memory.
Serves high-throughput inference requests over local HTTP (127.0.0.1:8002).
"""

import sys
import os
import time
import base64
import json
import asyncio
import traceback
from typing import Optional
from PIL import Image
import numpy as np
from aiohttp import web

# Ensure openviva root and scripts are in sys.path
_ROOT_DIR = "/home/savan/openviva"
if _ROOT_DIR not in sys.path:
    sys.path.insert(0, _ROOT_DIR)
_SCRIPTS_DIR = os.path.join(_ROOT_DIR, "scripts")
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)

# Also support local repo execution if run in dev
_LOCAL_SCRIPTS = os.path.dirname(os.path.abspath(__file__))
if _LOCAL_SCRIPTS not in sys.path:
    sys.path.insert(0, _LOCAL_SCRIPTS)

try:
    from extract_biometrics import (
        get_scrfd_detector,
        get_liveness_classifier,
        get_arcface_extractor,
        extract_face_embedding,
        extract_voice_embedding,
        SpoofError,
    )
except ImportError:
    from scripts.extract_biometrics import (
        get_scrfd_detector,
        get_liveness_classifier,
        get_arcface_extractor,
        extract_face_embedding,
        extract_voice_embedding,
        SpoofError,
    )

START_TIME = time.time()
PORT = int(os.environ.get("BIOMETRIC_DAEMON_PORT", 8002))
HOST = os.environ.get("BIOMETRIC_DAEMON_HOST", "127.0.0.1")

def warm_models():
    """Pre-warms all ONNX models so subsequent HTTP inferences take < 50ms."""
    t0 = time.time()
    print("[Bio Daemon] Pre-warming SCRFD-500M Face Detector...", flush=True)
    get_scrfd_detector()
    print("[Bio Daemon] Pre-warming MiniFASNet-V2 Anti-Spoof Liveness Classifier...", flush=True)
    get_liveness_classifier()
    print("[Bio Daemon] Pre-warming MobileFaceNet ArcFace 512-d Feature Extractor...", flush=True)
    get_arcface_extractor()
    print(f"[Bio Daemon] All biometric neural models primed in {time.time() - t0:.2f}s!", flush=True)

async def handle_health(request: web.Request) -> web.Response:
    uptime = time.time() - START_TIME
    return web.json_response({
        "status": "ok",
        "service": "openviva-biometric-daemon",
        "uptime_seconds": round(uptime, 2),
        "models_warmed": True
    })

def _process_face_extraction(image_path: str, verify_liveness: bool = True) -> dict:
    try:
        t0 = time.time()
        embedding_bytes, face_meta = extract_face_embedding(
            image_path=image_path,
            device="cpu",
            verify_liveness=verify_liveness
        )
        elapsed_ms = (time.time() - t0) * 1000.0

        return {
            "success": True,
            "inference_ms": round(elapsed_ms, 2),
            "face_embedding_base64": base64.b64encode(embedding_bytes).decode("ascii"),
            "face_detected": face_meta.get("face_detected", True),
            "detection_score": face_meta.get("detection_score"),
            "face_box": face_meta.get("face_box"),
            "landmarks": face_meta.get("landmarks"),
            "faces_count": face_meta.get("faces_count", 1),
            "is_live": face_meta.get("is_live", True),
            "liveness_score": face_meta.get("liveness_score"),
            "spoof_type": face_meta.get("spoof_type"),
            "spoof_probabilities": face_meta.get("spoof_probabilities"),
            "aligned_size": face_meta.get("aligned_size"),
            "alignment_status": face_meta.get("alignment_status"),
            "illumination_status": face_meta.get("illumination_status"),
            "embedding_model": face_meta.get("embedding_model"),
            "embedding_dim": face_meta.get("embedding_dim"),
            "embedding_l2_norm": face_meta.get("embedding_l2_norm")
        }
    except SpoofError as se:
        return {
            "success": False,
            "error": "SPOOF_PHOTO_DETECTED",
            "message": str(se),
            "liveness_score": getattr(se, "liveness_score", getattr(se, "livenessScore", 0.0)),
            "spoof_type": getattr(se, "spoof_type", getattr(se, "spoofType", "SPOOF_ATTACK")),
            "spoof_probabilities": getattr(se, "spoof_probabilities", getattr(se, "spoofProbabilities", {}))
        }
    except ValueError as ve:
        msg = str(ve)
        err_code = "NO_FACE_DETECTED" if "NO_FACE_DETECTED" in msg else (
            "MULTIPLE_FACES_DETECTED" if "MULTIPLE_FACES_DETECTED" in msg else "DETECTION_ERROR"
        )
        return {
            "success": False,
            "error": err_code,
            "message": msg
        }
    except Exception as ex:
        return {
            "success": False,
            "error": "EXTRACTION_FAILURE",
            "message": str(ex),
            "traceback": traceback.format_exc()
        }

async def handle_extract_face(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"success": False, "error": "INVALID_JSON", "message": "Malformed JSON payload"}, status=400)

    image_path = body.get("image_path") or body.get("face_image_path")
    image_base64 = body.get("image_base64")
    verify_liveness = body.get("verify_liveness", True)

    temp_created = False
    temp_path = None
    try:
        if image_base64 and not image_path:
            # Decode image_base64 into /dev/shm
            temp_path = f"/dev/shm/bio_daemon_probe_{int(time.time()*1000)}_{os.getpid()}.jpg"
            img_data = base64.b64decode(image_base64.split(",")[-1])
            with open(temp_path, "wb") as f:
                f.write(img_data)
            image_path = temp_path
            temp_created = True

        if not image_path or not os.path.exists(image_path):
            return web.json_response({
                "success": False,
                "error": "FILE_NOT_FOUND",
                "message": f"Image file not found: {image_path}"
            }, status=400)

        loop = asyncio.get_event_loop()
        result = await loop.run_in_executor(None, _process_face_extraction, image_path, verify_liveness)
        status_code = 200 if result.get("success") else 422
        return web.json_response(result, status=status_code)
    finally:
        if temp_created and temp_path and os.path.exists(temp_path):
            try:
                os.remove(temp_path)
            except Exception:
                pass

async def handle_extract_biometrics(request: web.Request) -> web.Response:
    try:
        body = await request.json()
    except Exception:
        return web.json_response({"success": False, "error": "INVALID_JSON", "message": "Malformed JSON payload"}, status=400)

    face_path = body.get("face_image_path") or body.get("faceImagePath")
    voice_path = body.get("voice_audio_path") or body.get("voiceAudioPath")
    verify_liveness = body.get("verify_liveness", True)

    if not face_path or not os.path.exists(face_path):
        return web.json_response({"success": False, "error": "FILE_NOT_FOUND", "message": f"Face file not found: {face_path}"}, status=400)
    if not voice_path or not os.path.exists(voice_path):
        return web.json_response({"success": False, "error": "FILE_NOT_FOUND", "message": f"Voice file not found: {voice_path}"}, status=400)

    loop = asyncio.get_event_loop()
    # Run face extraction
    face_res = await loop.run_in_executor(None, _process_face_extraction, face_path, verify_liveness)
    if not face_res.get("success"):
        return web.json_response(face_res, status=422)

    # Run voice extraction
    try:
        def _get_voice():
            v_bytes = extract_voice_embedding(voice_path, device="cpu")
            return base64.b64encode(v_bytes).decode("ascii")

        v_b64 = await loop.run_in_executor(None, _get_voice)
        face_res["voice_embedding_base64"] = v_b64
        return web.json_response(face_res, status=200)
    except Exception as ex:
        return web.json_response({
            "success": False,
            "error": "VOICE_EXTRACTION_FAILURE",
            "message": str(ex)
        }, status=422)

def create_app() -> web.Application:
    app = web.Application()
    app.router.add_get("/health", handle_health)
    app.router.add_post("/extract-face", handle_extract_face)
    app.router.add_post("/extract-biometrics", handle_extract_biometrics)
    return app

if __name__ == "__main__":
    warm_models()
    app = create_app()
    print(f"[Bio Daemon] Starting Biometric Daemon on http://{HOST}:{PORT}...", flush=True)
    web.run_app(app, host=HOST, port=PORT)
