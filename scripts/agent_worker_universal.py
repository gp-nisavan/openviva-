"""
Open-Viva Multi-Room Universal Voice Agent Worker
Connects to all 3 rooms simultaneously:
- openviva-exam-room (Stack 1 Baseline)
- openviva-stack2-room (Stack 2 Clause-Streaming Engine)
- openviva-stack3-room (Stack 3 Room)
Guarantees the examiner is present in EVERY room without collision.
"""

import sys
import os
import ctypes

# Pre-load NVIDIA CUDA/cuBLAS/cuDNN runtime libraries for CTranslate2
nvidia_paths = [
    "/home/savan/openviva/agent_env/lib/python3.10/site-packages/nvidia/cublas/lib",
    "/home/savan/openviva/agent_env/lib/python3.10/site-packages/nvidia/cudnn/lib",
    "/home/savan/openviva/agent_env/lib/python3.10/site-packages/nvidia/cuda_nvrtc/lib",
]
for p in nvidia_paths:
    if os.path.exists(p):
        cur = os.environ.get("LD_LIBRARY_PATH", "")
        if p not in cur:
            os.environ["LD_LIBRARY_PATH"] = f"{p}:{cur}" if cur else p
        for fn in sorted(os.listdir(p)):
            if fn.endswith(".so.12") or fn.endswith(".so.9") or fn.endswith(".so"):
                try:
                    ctypes.CDLL(os.path.join(p, fn), mode=ctypes.RTLD_GLOBAL)
                except Exception:
                    pass

import json
import time
import re
import asyncio
import threading
import traceback
import wave
import sqlite3
from datetime import datetime
from collections import deque
from typing import Optional, List, Tuple, Any

import numpy as np
import aiohttp
import onnxruntime as ort
from tokenizers import Tokenizer
from faster_whisper import WhisperModel
import kokoro_onnx
from livekit import rtc, api
from livekit.protocol import egress as egress_proto

# Ensure directory is on sys.path for socratic_conductor import
for _p in ["/dev/shm/savan_openviva", os.path.dirname(os.path.abspath(__file__)), os.getcwd()]:
    if _p and os.path.exists(_p) and _p not in sys.path:
        sys.path.insert(0, _p)

from socratic_conductor import SocraticConductor, UniversalSyllabus, DINOv3Syllabus, SubtopicNode
print("[INIT] SocraticConductor and UniversalSyllabus imported successfully!", flush=True)

sys.stdout.reconfigure(line_buffering=True)

# =========================================================================
# PASSIVE FLIGHT RECORDER & SHADOW OBSERVABILITY (ZERO LOGIC MODIFICATION)
# =========================================================================
FLIGHT_RECORDER_DIR = "/dev/shm/savan_openviva"
try:
    os.makedirs(FLIGHT_RECORDER_DIR, exist_ok=True)
except Exception:
    pass
FLIGHT_EVENTS_PATH = os.path.join(FLIGHT_RECORDER_DIR, "pipeline_events.jsonl")

def record_flight_event(event_type: str, details: dict):
    """
    PASSIVE OBSERVATION ONLY: Zero impact on execution logic or latency.
    Appends high-resolution timestamped telemetry to Linux tmpfs (/dev/shm).
    """
    try:
        now = time.time()
        record = {
            "ts": now,
            "iso": datetime.utcnow().strftime("%Y-%m-%dT%H:%M:%S.%f")[:-3] + "Z",
            "event": event_type,
            **details
        }
        with open(FLIGHT_EVENTS_PATH, "a", encoding="utf-8") as f:
            f.write(json.dumps(record) + "\n")
    except Exception:
        pass

def cleanup_stale_shadow_recordings(max_age_seconds: float = 1800.0):
    """
    Issue 30.1: Clean up orphaned or stale shadow recordings in /dev/shm.
    Unlinks temporary shadow WAV files older than max_age_seconds to prevent
    unbounded tmpfs RAM disk consumption.
    """
    try:
        if not os.path.exists(FLIGHT_RECORDER_DIR):
            return
        now = time.time()
        for f in os.listdir(FLIGHT_RECORDER_DIR):
            if f.startswith("shadow_raw_") and f.endswith(".wav"):
                full_p = os.path.join(FLIGHT_RECORDER_DIR, f)
                try:
                    mtime = os.path.getmtime(full_p)
                    if (now - mtime) > max_age_seconds:
                        os.remove(full_p)
                        print(f"[SHM CLEANUP] Purged stale shadow audio: {full_p} (age {int(now - mtime)}s)", flush=True)
                except Exception:
                    pass
    except Exception as e:
        print(f"[SHM CLEANUP WARNING]: {e}", flush=True)

# Run initial tmpfs hygiene sweep on daemon launch
cleanup_stale_shadow_recordings()


LIVEKIT_URL = os.environ.get("LIVEKIT_URL", "http://10.10.16.13:7880")
API_KEY = os.environ.get("LIVEKIT_API_KEY", "devkey")
API_SECRET = os.environ.get("LIVEKIT_API_SECRET", "your_livekit_api_secret_here")
VLLM_URL = os.environ.get("VLLM_URL", "http://127.0.0.1:8000/v1/chat/completions")
VLLM_MODEL = os.environ.get("VLLM_MODEL", "thesven/Phi-3.5-mini-instruct-awq")

# MinIO / S3 Object Storage & LiveKit Egress Configuration (Task 3.1, 3.2, 3.3)
S3_ENDPOINT = os.environ.get("S3_ENDPOINT", "http://10.10.16.13:9000")
EGRESS_S3_ENDPOINT = os.environ.get("EGRESS_S3_ENDPOINT", "http://minio:9000")
S3_BUCKET = os.environ.get("S3_BUCKET", "viva-recordings")
S3_ACCESS_KEY = os.environ.get("S3_ACCESS_KEY", "minioadmin")
S3_SECRET_KEY = os.environ.get("S3_SECRET_KEY", "minioadmin")

def get_openviva_db_path() -> str:
    candidates = [
        os.path.join(os.getcwd(), "storage", "openviva.db"),
        "/home/savan/openviva/storage/openviva.db",
        os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "storage", "openviva.db"),
    ]
    for c in candidates:
        if os.path.exists(c):
            return c
    return candidates[0]

WHISPER_MODEL_PATH = "/home/savan/openviva/models/whisper/large-v3-turbo"
VAD_MODEL_PATH = "/home/savan/openviva/models/vad/onnx/model.onnx"
KOKORO_MODEL_PATH = "/home/savan/openviva/models/kokoro/kokoro-v1.0.onnx"
KOKORO_VOICES_PATH = "/home/savan/openviva/models/kokoro/voices-v1.0.bin"
SMART_TURN_MODEL_PATH = "/home/savan/openviva/models/smart_turn/model.onnx" if os.path.exists("/home/savan/openviva/models/smart_turn/model.onnx") else ("/dev/shm/savan_openviva/smart_turn/model.onnx" if os.path.exists("/dev/shm/savan_openviva/smart_turn/model.onnx") else "/tmp/savan_openviva/models/smart_turn/model.onnx")
EOU_MODEL_PATH = "/home/savan/openviva/models/turn_detector/model_quantized.onnx" if os.path.exists("/home/savan/openviva/models/turn_detector/model_quantized.onnx") else ("/dev/shm/savan_openviva/turn_detector/model_quantized.onnx" if os.path.exists("/dev/shm/savan_openviva/turn_detector/model_quantized.onnx") else "/tmp/savan_openviva/models/turn_detector/model_quantized.onnx")
EOU_TOKENIZER_PATH = "/home/savan/openviva/models/turn_detector/tokenizer.json" if os.path.exists("/home/savan/openviva/models/turn_detector/tokenizer.json") else ("/dev/shm/savan_openviva/turn_detector/tokenizer.json" if os.path.exists("/dev/shm/savan_openviva/turn_detector/tokenizer.json") else "/tmp/savan_openviva/models/turn_detector/tokenizer.json")
EXAMINER_VOICE = "bm_george"

STT_PROMPT = "Oral PhD viva defense examination. Accurate technical transcription."


NEWLINE_TOKEN_ID = 198  # BPE token for '\n' in LiveKit turn detector vocabulary
IM_END_TOKEN_ID = 2     # BPE token for '<|im_end|>' in LiveKit turn detector vocabulary

DANGLING_CONNECTORS = {
    # Articles & Determiners (never end a sentence)
    "the", "a", "an",
    # Prepositions (almost never end a complete sentence in formal speech)
    "of", "to", "at", "for", "with", "into", "onto", "from",
    # Conjunctions (always introduce a clause)
    "and", "or", "but", "nor", "so", "because", "although", "since", "unless",
    "while", "whereas", "if", "whether", "which", "who", "whom", "whose",
    # Comparatives / Modifiers
    "than", "such as", "as well as", "due to", "in order to"
}

def classify_eou_onnx(text: str) -> Tuple[bool, str, float]:
    """
    Dedicated Stage 3 LiveKit EOU Classifier (model_quantized.onnx).
    Evaluates trailing speech window (up to 35 words) structured in LiveKit ChatML format.
    Returns (is_complete, verdict_reason, p_eou).
    """
    t = text.strip()
    if not t:
        return False, "EMPTY", 0.0

    # 1. Structural Incompleteness Check:
    # If text ends with an ellipsis ('...' or '..'), it is trailing speech mid-thought!
    if t.endswith("...") or t.endswith(".."):
        return False, "TRAILING_ELLIPSIS_INCOMPLETE", 0.0

    words = t.split()
    import re
    last_word = re.sub(r'[^\w]', '', words[-1].lower())
    if last_word in DANGLING_CONNECTORS:
        return False, f"DANGLING_{last_word.upper()}_INCOMPLETE", 0.0

    # 2. Neural classification via LiveKit turn detector ONNX
    tail_text = " ".join(words[-35:]).strip()
    prompt = f"<|im_start|>user\n{tail_text}"
    enc = eou_tokenizer.encode(prompt)
    input_ids = np.array([enc.ids], dtype=np.int64)
    outputs = eou_session.run(None, {"input_ids": input_ids})
    logits = outputs[0][0, -1, :]

    # Softmax over logits
    exp_l = np.exp(logits - np.max(logits))
    probs = exp_l / np.sum(exp_l)

    p_im_end = float(probs[IM_END_TOKEN_ID])
    p_newline = float(probs[NEWLINE_TOKEN_ID])
    p_eou = p_im_end + p_newline
    top_token = int(np.argmax(logits))

    # LiveKit turn detector signals completion via <|im_end|> or \n with high probability
    is_complete = bool(top_token in (IM_END_TOKEN_ID, NEWLINE_TOKEN_ID) or p_eou >= 0.05)
    verdict = "EOU_COMPLETE" if is_complete else "EOU_INCOMPLETE"
    return is_complete, verdict, p_eou

# =========================================================================
# INITIALIZE MODELS
# =========================================================================
print("[INIT] Loading Silero VAD ONNX...", flush=True)
vad_opts = ort.SessionOptions()
vad_opts.inter_op_num_threads = 1
vad_opts.intra_op_num_threads = 1
vad_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
vad_session = ort.InferenceSession(VAD_MODEL_PATH, sess_options=vad_opts, providers=["CPUExecutionProvider"])

print("[INIT] Loading Faster-Whisper Large-v3-Turbo...", flush=True)
try:
    stt_model = WhisperModel(WHISPER_MODEL_PATH, device="cuda", compute_type="int8_float16", device_index=0, num_workers=1)
    print("[INIT] Faster-Whisper loaded on GPU (CUDA int8_float16)!", flush=True)
except Exception as e:
    print(f"[INIT] GPU memory busy ({e}), running Faster-Whisper on CPU (int8, 8 threads)...", flush=True)
    stt_model = WhisperModel(WHISPER_MODEL_PATH, device="cpu", compute_type="int8", cpu_threads=8)
    print("[INIT] Faster-Whisper loaded on CPU!", flush=True)

print("[INIT] Loading Kokoro-82M TTS...", flush=True)
kokoro_tts = kokoro_onnx.Kokoro(KOKORO_MODEL_PATH, KOKORO_VOICES_PATH)
print("[INIT] Kokoro-82M TTS loaded!", flush=True)

try:
    dummy_silence = np.zeros(16000 * 2, dtype=np.float32)
    stt_model.transcribe(dummy_silence, beam_size=1, language="en", condition_on_previous_text=False)
    print("[WARMUP] Faster-Whisper primed!", flush=True)
except Exception:
    pass

print("[INIT] Loading Neural Smart-Turn v3 ONNX Model...", flush=True)
try:
    from faster_whisper.feature_extractor import FeatureExtractor
    smart_turn_fe = FeatureExtractor(feature_size=80)
    smart_turn_opts = ort.SessionOptions()
    smart_turn_opts.inter_op_num_threads = 1
    smart_turn_opts.intra_op_num_threads = 2
    smart_turn_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    smart_turn_session = ort.InferenceSession(SMART_TURN_MODEL_PATH, sess_options=smart_turn_opts, providers=["CPUExecutionProvider"])
    print("[INIT] Real Neural Smart-Turn v3 ONNX Model Loaded Successfully!", flush=True)
except Exception as e:
    raise RuntimeError(f"[FATAL ZERO-FALLBACK] Neural Smart-Turn v3 ONNX model failed to load from {SMART_TURN_MODEL_PATH}: {e}")

print("[INIT] Loading Dedicated LiveKit EOU Turn-Detector ONNX Model...", flush=True)
try:
    eou_opts = ort.SessionOptions()
    eou_opts.inter_op_num_threads = 1
    eou_opts.intra_op_num_threads = 2
    eou_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
    eou_session = ort.InferenceSession(EOU_MODEL_PATH, sess_options=eou_opts, providers=["CPUExecutionProvider"])
    eou_tokenizer = Tokenizer.from_file(EOU_TOKENIZER_PATH)
    print("[INIT] LiveKit Dedicated EOU Turn-Detector ONNX Model Loaded Successfully!", flush=True)
except Exception as e:
    raise RuntimeError(f"[FATAL ZERO-FALLBACK] LiveKit EOU ONNX model failed to load from {EOU_MODEL_PATH}: {e}")


_stt_semaphore: Optional[asyncio.Semaphore] = None

def get_stt_lock() -> asyncio.Semaphore:
    global _stt_semaphore
    if _stt_semaphore is None:
        # Bounded concurrency: allows up to 3 concurrent Faster-Whisper transcription streams across chambers
        _stt_semaphore = asyncio.Semaphore(value=3)
    return _stt_semaphore


# =========================================================================
# CLAUSE STREAM PIPELINER & REAL-TIME SPEECH SANITIZER
# =========================================================================

def sanitize_spoken_text(text: str) -> str:
    """
    Community-standard text sanitizer for real-time TTS voice agents.
    Eliminates Markdown syntax, bullet markers, list item prefixes, LaTeX,
    and unpronounceable characters before streaming to the phonemizer.
    """
    if not text:
        return ""

    # 1. Strip termination tag
    text = text.replace("[EXAM_TERMINATED]", "").strip()

    # 2. Strip markdown bold/italics: **text** or *text* or __text__ or _text_
    text = re.sub(r'[*_]{1,3}(.*?)[*_]{1,3}', r'\1', text)

    # 3. Strip markdown headers: ### Header -> Header
    text = re.sub(r'#{1,6}\s*', '', text)

    # 4. Strip bullet points and list numbering (e.g., "1. ", "2. ", "- ", "• ")
    text = re.sub(r'(?:^|[\r\n]+)\s*(?:[-*•]|\d+\.)\s+', ' ', text)
    text = re.sub(r'(?<=[.!?])\s+(?:[-*•]|\d+\.)\s+', ' ', text)

    # 5. Strip backticks and code fence blocks
    text = re.sub(r'```.*?```', '', text, flags=re.DOTALL)
    text = re.sub(r'`+', '', text)

    # 6. Clean LaTeX math delimiters
    text = re.sub(r'\$(.*?)\$', r'\1', text)

    # 7. Spoken symbol normalizations for natural TTS
    text = text.replace('&', ' and ')
    text = text.replace('%', ' percent ')
    text = text.replace('^2', ' squared').replace('^3', ' cubed')
    text = text.replace(' -> ', ' to ').replace(' => ', ' implies ')
    text = text.replace(' <= ', ' less than or equal to ').replace(' >= ', ' greater than or equal to ')
    text = text.replace(' != ', ' does not equal ').replace(' = ', ' equals ')
    # 8. Strip isolated numeric citation brackets
    text = re.sub(r'\[\d+\]', '', text)
    text = re.sub(r'[<>{}\[\]]', ' ', text)

    # 9. Collapse excess whitespace
    text = re.sub(r'\s+', ' ', text).strip()
    return text


def phonetic_spoken_expansion(text: str) -> str:
    """
    Applied SOLELY to audio synthesis pipeline immediately before Kokoro TTS.
    Leaves UI text and written transcripts pristine with standard academic spelling.
    """
    if not text:
        return ""
    expanded = text
    expanded = re.sub(r'\bk-means\b', 'kay-means', expanded, flags=re.IGNORECASE)
    expanded = re.sub(r'\bViT\b', 'V I T', expanded)
    expanded = re.sub(r'\bViTs\b', 'V I Ts', expanded)
    expanded = re.sub(r'\bDINOv3\b', 'Dino vee three', expanded, flags=re.IGNORECASE)
    expanded = re.sub(r'\bDINO\b', 'Dino', expanded)
    expanded = re.sub(r'\bL2\b', 'L-two', expanded)
    expanded = re.sub(r'\bL1\b', 'L-one', expanded)
    expanded = re.sub(r'\bpdqhash\b', 'P D Q hash', expanded, flags=re.IGNORECASE)
    return expanded


class ClauseBuffer:
    def __init__(self):
        self.buffer = ""
        self.split_regex = re.compile(r"([,;:—–\.\?!]+(?:\s+|$))")

    def feed(self, delta: str) -> List[str]:
        self.buffer += delta
        clauses = []
        while True:
            match = self.split_regex.search(self.buffer)
            if match:
                end_pos = match.end()
                raw_clause = self.buffer[:end_pos].strip()
                self.buffer = self.buffer[end_pos:]
                clause = sanitize_spoken_text(raw_clause)
                if clause:
                    clauses.append(clause)
            else:
                words = self.buffer.split()
                if len(words) >= 9:
                    raw_clause = " ".join(words[:8])
                    self.buffer = " ".join(words[8:])
                    clause = sanitize_spoken_text(raw_clause)
                    if clause:
                        clauses.append(clause)
                break
        return clauses

    def flush(self) -> List[str]:
        rem = sanitize_spoken_text(self.buffer.strip())
        self.buffer = ""
        return [rem] if rem else []



# =========================================================================
# NEURAL SMART-TURN ACOUSTIC ENDPOINTING CLASSIFIER (STACK 3)
# =========================================================================

class NeuralSmartTurnDetector:
    """
    Real neural network acoustic turn-taking classifier (pipecat-ai/smart-turn-v3).
    Evaluates 80-channel log-mel spectrogram across the recent audio buffer
    (up to 8s) using Whisper-Tiny encoder backbone and linear head.
    Output logit is converted to probability via sigmoid.
    """
    def __init__(self):
        self.session = smart_turn_session
        self.fe = smart_turn_fe

    def predict(self, recent_pcm_audio: np.ndarray, threshold: float = 0.55) -> Tuple[bool, float]:
        """Evaluates candidate audio buffer. Returns (is_turn_boundary, probability)."""
        if self.session is None or self.fe is None or len(recent_pcm_audio) < 16000 * 0.4:
            return False, 0.0

        try:
            # Use up to 8 seconds of recent speech audio
            max_samples = 16000 * 8
            audio = recent_pcm_audio[-max_samples:]

            # Extract 80-channel log-mel spectrogram
            mel = self.fe(audio)  # shape (80, frames)

            # Reshape / pad to exactly 800 temporal frames
            if mel.shape[-1] > 800:
                mel = mel[:, -800:]
            elif mel.shape[-1] < 800:
                mel = np.pad(mel, ((0, 0), (0, 800 - mel.shape[-1])))

            input_features = np.expand_dims(mel, axis=0).astype(np.float32)  # shape [1, 80, 800]
            outputs = self.session.run(None, {"input_features": input_features})
            logit = float(outputs[0][0][0])
            prob = 1.0 / (1.0 + np.exp(-logit))

            # When neural probability >= threshold, candidate has finished their turn
            is_turn_complete = (prob >= threshold)
            return is_turn_complete, prob
        except Exception as ex:
            return False, 0.0


class CandidateVADTracker:
    def __init__(self):
        self.state = np.zeros((2, 1, 128), dtype=np.float32)
        self.sr = np.array(16000, dtype=np.int64)
        self.is_speaking = False
        self.speech_duration_ms = 0
        self.silence_duration_ms = 0
        self.tentative_speech_ms = 0
        self.speech_threshold = 0.50
        self.min_speech_ms = 160
        self.max_continuous_speech_ms = 60000
        self.neural_smart_turn = NeuralSmartTurnDetector()
        self.smart_turn_fired = False
        self.last_neural_prob = 0.0
        self.just_evaluated_smart_turn = False
        self._pause_evaluated = False

    def compute_dynamic_silence_threshold(self, trailing_text: str, has_pending_fragment: bool = False) -> int:
        if self.smart_turn_fired:
            return 850
        return 2000 if has_pending_fragment else 1500

    def process_512(self, chunk_pcm_float: np.ndarray, recent_audio_buf: np.ndarray = None, is_examiner_speaking: bool = False, trailing_text: str = "", has_pending_fragment: bool = False) -> Tuple[Optional[str], float]:
        inputs = {
            vad_session.get_inputs()[0].name: chunk_pcm_float.reshape(1, -1),
            vad_session.get_inputs()[1].name: self.state,
            vad_session.get_inputs()[2].name: self.sr
        }
        out, self.state = vad_session.run(None, inputs)
        prob = float(out[0][0])
        chunk_ms = 32.0
        event = None

        # Voice Barge-In vs Backchannel:
        # Acknowledgment murmurs ("hmm", "yeah", "ok") last <250ms and duck examiner volume without stopping.
        # Intentional speech interruptions last >=280ms and halt examiner speech immediately.
        active_threshold = 0.45 if is_examiner_speaking else self.speech_threshold
        active_min_speech = 280 if is_examiner_speaking else self.min_speech_ms
        active_min_silence = self.compute_dynamic_silence_threshold(trailing_text, has_pending_fragment=has_pending_fragment)

        if self.is_speaking and prob < 0.45 and self.silence_duration_ms >= 250 and self.speech_duration_ms >= 400:
            if not self._pause_evaluated and recent_audio_buf is not None and len(recent_audio_buf) >= 16000 * 0.4:
                is_boundary, neural_prob = self.neural_smart_turn.predict(recent_audio_buf, threshold=0.65)
                self.last_neural_prob = neural_prob
                if is_boundary:
                    self.smart_turn_fired = True
                self.just_evaluated_smart_turn = True
                self._pause_evaluated = True
        elif not self.is_speaking:
            self.smart_turn_fired = False
            self._pause_evaluated = False

        if prob >= active_threshold:
            self.silence_duration_ms = 0
            self.speech_duration_ms += chunk_ms
            self.smart_turn_fired = False
            self._pause_evaluated = False

            if not self.is_speaking and self.speech_duration_ms >= active_min_speech:
                self.is_speaking = True
                event = "speech_start"
            elif self.is_speaking and self.speech_duration_ms >= self.max_continuous_speech_ms:
                self.is_speaking = False
                self.speech_duration_ms = 0
                event = "filibuster_triggered"
        else:
            if not self.is_speaking:
                self.silence_duration_ms += chunk_ms
                if self.silence_duration_ms >= 500:
                    self.speech_duration_ms = 0
            else:
                self.silence_duration_ms += chunk_ms
                if self.silence_duration_ms >= active_min_silence:
                    self.is_speaking = False
                    self.speech_duration_ms = 0
                    self.silence_duration_ms = 0
                    event = "smart_turn_endpoint" if self.smart_turn_fired else "speech_end"
                    self.smart_turn_fired = False

        return event, prob


# =========================================================================
# OPTION 3: ADAPTIVE SOCRATIC KNOWLEDGE GRAPH TOPIC SELECTION
# =========================================================================

def select_adaptive_node(conductor: Any, prev_node: Optional[Any] = None) -> Optional[Any]:
    """
    Option 3: Adaptive Knowledge Graph Topic Selection.
    Selects the next unasked topic dynamically across domains and conceptual clusters.
    Guarantees:
    1. Zero repetition: Topics are permanently popped from unasked_nodes and appended to asked_nodes.
    2. Non-linear knowledge graph traversal: Alternates between Math/Stability, Architecture, and Inference/Memory.
    3. Session variety: No two candidates receive the same linear question sequence or starting topic.
    """
    unasked = getattr(conductor, "unasked_nodes", [])
    if not unasked:
        return None

    import random

    # Opening turn: pick dynamically across all available syllabus topics
    if prev_node is None:
        chosen = random.choice(unasked)
        conductor.unasked_nodes.remove(chosen)
        conductor.active_node = chosen
        conductor.asked_nodes.append(chosen)
        return chosen

    # 1. If explicit domain titles exist and differ
    prev_domain = getattr(prev_node, "domain_title", "")
    diff_domain = [n for n in unasked if getattr(n, "domain_title", "") != prev_domain]
    if diff_domain:
        chosen = random.choice(diff_domain)
        conductor.unasked_nodes.remove(chosen)
        conductor.active_node = chosen
        conductor.asked_nodes.append(chosen)
        return chosen

    # 2. Conceptual clustering for flat syllabi (e.g., 10 questions under one chapter)
    # Math/Stability: sqrt(d_k), softmax max shift, cross-entropy gradient, Pre-LN
    # Architecture: Multi-Head, FFN, Positional Encodings
    # Inference/Memory: O(N^2) complexity, KV Caching, GQA
    math_keywords = {"sqrt", "softmax", "gradient", "loss", "norm", "pre-ln", "post-ln", "shift"}
    arch_keywords = {"multi-head", "head", "feed-forward", "ffn", "positional", "encoding", "layer"}
    inf_keywords = {"complexity", "o(n", "cache", "kv", "bandwidth", "gqa", "hardware", "memory"}

    def get_cluster(node):
        if not node:
            return "general"
        title = (getattr(node, "title", "") + " " + getattr(node, "directive", "")).lower()
        if any(k in title for k in inf_keywords):
            return "inference"
        if any(k in title for k in arch_keywords):
            return "architecture"
        if any(k in title for k in math_keywords):
            return "math"
        return "general"

    prev_cluster = get_cluster(prev_node)
    diff_cluster = [n for n in unasked if get_cluster(n) != prev_cluster]

    if diff_cluster:
        chosen = random.choice(diff_cluster)
    else:
        chosen = random.choice(unasked)

    conductor.unasked_nodes.remove(chosen)
    conductor.active_node = chosen
    conductor.asked_nodes.append(chosen)
    return chosen


def resolve_chosen_topic(reply_text: str, candidate_nodes: list) -> Any:
    """
    Identifies which syllabus SubtopicNode from candidate_nodes the LLM transitioned to.
    Computes lexical and semantic overlap against node titles and expected answers.
    Guarantees zero-failure fallback to candidate_nodes[0].
    """
    if not candidate_nodes:
        return None
    if len(candidate_nodes) == 1:
        return candidate_nodes[0]

    reply_lower = reply_text.lower()
    stop_words = {
        "what", "how", "why", "when", "where", "which", "who", "does", "do", "is", "are",
        "can", "could", "would", "should", "the", "a", "an", "and", "or", "in", "on",
        "at", "to", "for", "with", "from", "by", "that", "this", "these", "those",
        "into", "about", "like", "through", "over", "between", "under", "against"
    }

    best_node = None
    best_score = -1

    for node in candidate_nodes:
        title = getattr(node, "title", "").lower()
        directive = getattr(node, "directive", "").lower()
        expected = getattr(node, "expected_answer", "").lower()

        score = 0
        # Title exact substring match (high confidence)
        if len(title) > 5 and title in reply_lower:
            score += 25

        # Title token overlap (excluding punctuation and stop words)
        title_tokens = [w.strip(".,;:?!'\"()[]{}") for w in title.split() if len(w.strip(".,;:?!'\"()[]{}")) >= 3]
        title_tokens = [w for w in title_tokens if w not in stop_words]
        for token in title_tokens:
            if token in reply_lower:
                score += 5

        # Key phrases / keywords from directive & expected answer
        extra_tokens = [w.strip(".,;:?!'\"()[]{}") for w in (directive + " " + expected).split() if len(w.strip(".,;:?!'\"()[]{}")) >= 4]
        extra_tokens = [w for w in extra_tokens if w not in stop_words and w not in title_tokens]
        for token in extra_tokens[:10]:
            if token in reply_lower:
                score += 1

        if score > best_score:
            best_score = score
            best_node = node

    if best_score <= 0:
        return candidate_nodes[0]
    return best_node


# =========================================================================
# CHAMBER SESSION CONTROLLER (PER ROOM - UNIVERSAL EOU ONNX ENGINE)
# =========================================================================

class ChamberSession:
    def __init__(self, room_name: str):
        self.room_name = room_name
        self.room: Optional[rtc.Room] = None
        self.audio_source: Optional[rtc.AudioSource] = None
        self.audio_track: Optional[rtc.LocalAudioTrack] = None

        self.conversation_history: list[dict] = []
        self.is_configured: bool = False
        self.is_agent_thinking = False
        self.is_examiner_speaking = False
        self.examiner_audio_start_time = 0.0
        self.last_candidate_turn_time = 0.0
        self.cancel_event = asyncio.Event()
        self.speech_lock = asyncio.Lock()
        self.active_speech_task: Optional[asyncio.Task] = None
        self.active_turn_task: Optional[asyncio.Task] = None

        self.exam_start_time = None
        self.target_duration_s = 900
        self.has_asked_final_question = False
        self.exam_completed = False
        self.has_greeted = False
        self.greeted_participants = set()
        self.active_tracks = set()
        self.active_audio_tasks: set[asyncio.Task] = set()
        self.session_config: dict = {}

        # Socratic Conductor Two-Tier Pipeline (Zero Fallback)
        self.conductor: Optional[Any] = None
        self.active_question: str = ""
        self.has_asked_first_question: bool = False
        self.topic_subturn_count: int = 0
        self.stt_prompt: str = STT_PROMPT
        self.course_title: str = ""

        # Turn continuation accumulator state
        self.pending_candidate_text = ""
        self.current_evaluating_text = ""
        self.pending_dispatch_task: Optional[asyncio.Task] = None

        # Dead-air silence watchdog state
        self.floor_opened_time: float = 0.0
        self.dead_air_tier: int = 0
        self.dead_air_task: Optional[asyncio.Task] = None
        self.output_volume_factor: float = 1.0
        self.needs_vad_reset: bool = False
        self.last_audio_frame_time: float = 0.0
        self.candidate_disconnected_time: Optional[float] = None
        self.is_reconnecting: bool = False
        self.paused_elapsed_s: float = 0.0
        self.disconnect_grace_s: float = 90.0
        self.last_candidate_speech_time: float = 0.0
        self.is_candidate_speaking: bool = False

        # Passive Independent Shadow Audio Recorder
        self.shadow_wav_file: Optional[wave.Wave_write] = None
        self.shadow_wav_path: str = ""
        self.session_id: Optional[str] = None

        # Task 3.3: LiveKit Egress Audio Recording Hook State
        self.egress_id: Optional[str] = None
        self.candidate_audio_s3_url: Optional[str] = None
        self.candidate_identity: Optional[str] = None
        self.candidate_track_sid: Optional[str] = None
        self.livekit_api_client: Optional[api.LiveKitAPI] = None
        self.egress_starting: bool = False
        self.audit_triggered: bool = False
        self.audit_lock = threading.Lock()

    def on_floor_opened(self):
        """Called whenever the examiner finishes speaking and cedes the floor to the candidate."""
        self.floor_opened_time = time.time()
        self.needs_vad_reset = True

    async def start_candidate_egress(self, track: rtc.Track, participant: rtc.RemoteParticipant):
        """
        Task 3.3: LiveKit Egress Audio Recording Hook.
        Initiates TrackEgress to capture the candidate's audio stream directly into MinIO
        bucket 'viva-recordings' at exams/2026/{room_name}/{candidate_id}_mic.ogg.
        """
        if self.egress_id or self.egress_starting:
            return
        if not self.livekit_api_client:
            self.livekit_api_client = api.LiveKitAPI(LIVEKIT_URL, API_KEY, API_SECRET)

        self.egress_starting = True
        try:
            self.candidate_identity = participant.identity
            if participant.metadata and not self.session_id:
                try:
                    p_meta = json.loads(participant.metadata)
                    if isinstance(p_meta, dict):
                        s_id = p_meta.get("sessionId")
                        if s_id:
                            self.session_id = str(s_id).strip()
                            print(f"[{self.room_name}] Egress bound session_id '{self.session_id}' from participant metadata.", flush=True)
                except Exception:
                    pass
            self.candidate_track_sid = track.sid
            raw_id = participant.identity.replace("candidate_", "")
            clean_id = re.sub(r'[^a-zA-Z0-9_\-]', '_', raw_id) or "candidate"
            s3_path = f"exams/2026/{self.room_name}/{clean_id}_mic.ogg"

            s3_upload = egress_proto.S3Upload(
                endpoint=EGRESS_S3_ENDPOINT,
                access_key=S3_ACCESS_KEY,
                secret=S3_SECRET_KEY,
                bucket=S3_BUCKET,
                force_path_style=True
            )
            file_output = egress_proto.DirectFileOutput(
                filepath=s3_path,
                s3=s3_upload
            )
            request = egress_proto.TrackEgressRequest(
                room_name=self.room_name,
                track_id=track.sid,
                file=file_output
            )

            print(f"[{self.room_name}] Dispatching LiveKit TrackEgress for {participant.identity} (track: {track.sid})...", flush=True)
            info = await self.livekit_api_client.egress.start_track_egress(request)
            self.egress_id = info.egress_id
            self.candidate_audio_s3_url = f"{S3_ENDPOINT}/{S3_BUCKET}/{s3_path}"
            print(f"[{self.room_name}] Audio Egress started: ID={info.egress_id} -> {self.candidate_audio_s3_url}", flush=True)

            record_flight_event("EGRESS_RECORDING_STARTED", {
                "room": self.room_name,
                "egress_id": info.egress_id,
                "participant": participant.identity,
                "track_id": track.sid,
                "s3_path": s3_path,
                "s3_url": self.candidate_audio_s3_url
            })

            # Broadcast recording active status to client UI
            if self.room:
                try:
                    pkt = json.dumps({
                        "type": "recording_status",
                        "status": "recording",
                        "egress_id": info.egress_id,
                        "recording_url": self.candidate_audio_s3_url,
                        "timestamp": time.time()
                    }).encode()
                    asyncio.create_task(self.room.local_participant.publish_data(pkt, reliable=True))
                except Exception:
                    pass

        except Exception as e:
            print(f"[{self.room_name} EGRESS START ERROR]: {e}", flush=True)
            record_flight_event("EGRESS_START_ERROR", {
                "room": self.room_name,
                "error": str(e),
                "track_id": track.sid if track else ""
            })
        finally:
            self.egress_starting = False

    async def stop_candidate_egress(self):
        """
        Task 3.3: Cleanly terminates active LiveKit Egress recording job and
        persists recording URL to SQLite database (storage/openviva.db).
        """
        if not self.egress_id:
            self.persist_recording_to_database()
            return

        eid = self.egress_id
        self.egress_id = None
        try:
            print(f"[{self.room_name}] Stopping LiveKit Audio Egress {eid}...", flush=True)
            if self.livekit_api_client:
                stop_req = egress_proto.StopEgressRequest(egress_id=eid)
                await self.livekit_api_client.egress.stop_egress(stop_req)
                print(f"[{self.room_name}] LiveKit Egress {eid} stopped cleanly.", flush=True)

            record_flight_event("EGRESS_RECORDING_STOPPED", {
                "room": self.room_name,
                "egress_id": eid,
                "recording_url": self.candidate_audio_s3_url
            })

            # Persist recording URL to database first
            self.persist_recording_to_database()

            # Broadcast recording stopped to client UI
            if self.room:
                try:
                    pkt = json.dumps({
                        "type": "recording_status",
                        "status": "stopped",
                        "egress_id": eid,
                        "recording_url": self.candidate_audio_s3_url,
                        "timestamp": time.time()
                    }).encode()
                    asyncio.create_task(self.room.local_participant.publish_data(pkt, reliable=True))
                except Exception:
                    pass

        except Exception as e:
            print(f"[{self.room_name} EGRESS STOP ERROR]: {e}", flush=True)
            record_flight_event("EGRESS_STOP_ERROR", {
                "room": self.room_name,
                "egress_id": eid,
                "error": str(e)
            })

    def persist_recording_to_database(self):
        db_path = get_openviva_db_path()
        if not db_path or not os.path.exists(db_path):
            return
        try:
            # Task 1.1: Guaranteed copy of shadow WAV into persistent storage/recordings
            target_url = self.candidate_audio_s3_url
            recordings_dir = os.path.join(os.path.dirname(db_path), "recordings")
            os.makedirs(recordings_dir, exist_ok=True)

            cand_id = (self.candidate_identity or "").replace("candidate_", "").strip()

            # Ensure session_id and candidate_id are accurately known from DB if missing from wire handshake
            if not self.session_id and cand_id:
                try:
                    c_temp = sqlite3.connect(db_path, timeout=5.0)
                    cur_temp = c_temp.cursor()
                    cur_temp.execute(
                        "SELECT session_id FROM exam_sessions WHERE LOWER(student_id) = LOWER(?) ORDER BY started_at DESC LIMIT 1",
                        (cand_id,)
                    )
                    s_row = cur_temp.fetchone()
                    if s_row and s_row[0]:
                        self.session_id = s_row[0]
                        print(f"[{self.room_name}] Resolved official session_id '{self.session_id}' from database for candidate '{cand_id}'.", flush=True)
                    c_temp.close()
                except Exception as s_err:
                    print(f"[{self.room_name} DB RESOLVE WARN]: {s_err}", flush=True)
            elif self.session_id and not cand_id:
                try:
                    c_temp = sqlite3.connect(db_path, timeout=5.0)
                    cur_temp = c_temp.cursor()
                    cur_temp.execute(
                        "SELECT student_id FROM exam_sessions WHERE session_id = ?",
                        (self.session_id,)
                    )
                    s_row = cur_temp.fetchone()
                    if s_row and s_row[0]:
                        cand_id = s_row[0]
                        self.candidate_identity = f"candidate_{cand_id}"
                        print(f"[{self.room_name}] Resolved candidate_id '{cand_id}' from database for session '{self.session_id}'.", flush=True)
                    c_temp.close()
                except Exception as s_err:
                    print(f"[{self.room_name} DB RESOLVE WARN]: {s_err}", flush=True)

            clean_name = f"{self.session_id}.wav" if self.session_id else f"{self.room_name}_{cand_id or 'cand'}.wav"
            dest_wav = os.path.join(recordings_dir, clean_name)

            # Subtask 2.1: Pre-Copy Audio Stream Sealing & RIFF Header Finalization
            # Explicitly flush stdio buffers and write final RIFF chunk sizes (bytes 4-7, 40-43) BEFORE copying
            if getattr(self, "shadow_wav_file", None):
                try:
                    self.shadow_wav_file.close()
                    print(f"[{self.room_name}] Shadow WAV cleanly sealed & RIFF header finalized: {self.shadow_wav_path}", flush=True)
                except Exception as close_err:
                    print(f"[{self.room_name} WAV CLOSE WARN]: {close_err}", flush=True)
                self.shadow_wav_file = None

            if self.shadow_wav_path and os.path.exists(self.shadow_wav_path) and os.path.getsize(self.shadow_wav_path) > 1000:
                try:
                    import shutil
                    src_size = os.path.getsize(self.shadow_wav_path)

                    # Subtask 2.2: Atomic copy via tmp file + rename to prevent partial reads by concurrent processes
                    dest_wav_tmp = dest_wav + f".tmp.{os.getpid()}"
                    shutil.copyfile(self.shadow_wav_path, dest_wav_tmp)
                    os.replace(dest_wav_tmp, dest_wav)
                    persisted_size = os.path.getsize(dest_wav)
                    print(f"[{self.room_name}] Persisted {self.shadow_wav_path} -> {dest_wav} ({persisted_size} bytes, matches source: {persisted_size == src_size})", flush=True)

                    # Subtask 2.2: Transcode WAV to AAC M4A for low-latency browser scrubbing
                    clean_m4a = clean_name.rsplit(".", 1)[0] + ".m4a"
                    dest_m4a = os.path.join(recordings_dir, clean_m4a)
                    dest_m4a_tmp = os.path.join(recordings_dir, f"{clean_name.rsplit('.', 1)[0]}_tmp_{os.getpid()}.m4a")
                    try:
                        import subprocess
                        ffmpeg_bin = (
                            "/home/savan/openviva/bin/ffmpeg"
                            if os.path.exists("/home/savan/openviva/bin/ffmpeg")
                            else "/home/savan/.local/bin/ffmpeg"
                            if os.path.exists("/home/savan/.local/bin/ffmpeg")
                            else "ffmpeg"
                        )
                        ff_res = subprocess.run(
                            [ffmpeg_bin, "-y", "-i", dest_wav, "-c:a", "aac", "-b:a", "64k", "-f", "mp4", "-movflags", "+faststart", dest_m4a_tmp],
                            stdout=subprocess.PIPE,
                            stderr=subprocess.PIPE,
                            timeout=60,
                            check=False,
                        )
                        if ff_res.returncode == 0 and os.path.exists(dest_m4a_tmp) and os.path.getsize(dest_m4a_tmp) > 500:
                            os.replace(dest_m4a_tmp, dest_m4a)
                            print(f"[{self.room_name}] Transcoded {dest_wav} -> {dest_m4a} ({os.path.getsize(dest_m4a)} bytes)", flush=True)
                        else:
                            if os.path.exists(dest_m4a_tmp):
                                try:
                                    os.remove(dest_m4a_tmp)
                                except Exception:
                                    pass
                            err_msg = ff_res.stderr.decode('utf-8', errors='replace')[-300:] if ff_res.stderr else "unknown"
                            print(f"[{self.room_name} FFMPEG WARN]: Transcode failed (code {ff_res.returncode}): {err_msg}", flush=True)
                    except Exception as ffmpeg_err:
                        if os.path.exists(dest_m4a_tmp):
                            try:
                                os.remove(dest_m4a_tmp)
                            except Exception:
                                pass
                        print(f"[{self.room_name} FFMPEG ERR]: {ffmpeg_err}", flush=True)

                    if not target_url:
                        target_url = f"/openviva/api/defense/audio?sessionId={self.session_id or clean_name}"

                    # Subtask 2.2: Safely unlink shadow WAV from /dev/shm strictly AFTER verifying size match
                    if os.path.exists(dest_wav) and os.path.getsize(dest_wav) >= src_size:
                        if self.shadow_wav_path and (self.shadow_wav_path.startswith("/dev/shm") or "savan_openviva" in self.shadow_wav_path):
                            try:
                                if os.path.exists(self.shadow_wav_path):
                                    os.remove(self.shadow_wav_path)
                                    print(f"[{self.room_name}] Successfully unlinked shadow audio from RAM disk: {self.shadow_wav_path}", flush=True)
                                    self.shadow_wav_path = ""
                            except Exception as rm_err:
                                print(f"[{self.room_name} SHM UNLINK WARN]: {rm_err}", flush=True)
                    else:
                        print(f"[{self.room_name} PERSIST RETENTION WARN]: Retaining shadow WAV in RAM disk because dest size ({os.path.getsize(dest_wav) if os.path.exists(dest_wav) else 0}) < source size ({src_size})", flush=True)
                except Exception as cp_err:
                    print(f"[{self.room_name} AUDIO PERSIST ERR]: {cp_err}", flush=True)
                except Exception as cp_err:
                    print(f"[{self.room_name} AUDIO PERSIST ERR]: {cp_err}", flush=True)

            if not target_url and not os.path.exists(dest_wav):
                return

            conn = sqlite3.connect(db_path, timeout=10.0)
            cursor = conn.cursor()
            cursor.execute("PRAGMA table_info(exam_sessions)")
            cols = [col[1] for col in cursor.fetchall()]
            if cols and "recording_url" not in cols:
                cursor.execute("ALTER TABLE exam_sessions ADD COLUMN recording_url TEXT")

            if cand_id or self.session_id:
                now_iso = datetime.utcnow().isoformat() + "Z"
                if self.session_id:
                    cursor.execute(
                        """UPDATE exam_sessions
                           SET recording_url = ?,
                               ended_at = COALESCE(ended_at, ?),
                               updated_at = ?
                           WHERE session_id = ?""",
                        (target_url, now_iso, now_iso, self.session_id)
                    )
                else:
                    cursor.execute(
                        """UPDATE exam_sessions
                           SET recording_url = ?,
                               ended_at = COALESCE(ended_at, ?),
                               updated_at = ?
                           WHERE LOWER(student_id) = LOWER(?)
                             AND status IN ('IN_PROGRESS', 'PENDING_EVALUATION', 'COMPLETED')""",
                        (target_url, now_iso, now_iso, cand_id)
                    )
                conn.commit()
                print(f"[{self.room_name}] Persisted recording URL to database for '{cand_id or self.session_id}': {target_url}", flush=True)

                # Single Audit Ownership (Remediation Issue 8):
                # Ensure the forensic audit worker is triggered strictly once per chamber session
                should_trigger = False
                with getattr(self, "audit_lock", threading.Lock()):
                    if not getattr(self, "audit_triggered", False):
                        self.audit_triggered = True
                        should_trigger = True

                if should_trigger:
                    try:
                        if "/home/savan/openviva" not in sys.path:
                            sys.path.insert(0, "/home/savan/openviva")
                        if "/home/savan/openviva/scripts" not in sys.path:
                            sys.path.insert(0, "/home/savan/openviva/scripts")
                        from scripts.audit_session_biometrics import audit_session
                        def _run_bg_audit():
                            try:
                                time.sleep(2.0) # Wait for local disk audio file to finish flushing
                                rec_target = dest_wav if (dest_wav and os.path.exists(dest_wav)) else self.candidate_audio_s3_url
                                audit_sid = self.session_id
                                if not audit_sid and cand_id:
                                    try:
                                        c_bg = sqlite3.connect(db_path, timeout=5.0)
                                        r_bg = c_bg.cursor().execute(
                                            "SELECT session_id FROM exam_sessions WHERE LOWER(student_id) = LOWER(?) ORDER BY started_at DESC LIMIT 1",
                                            (cand_id,)
                                        ).fetchone()
                                        if r_bg and r_bg[0]:
                                            audit_sid = r_bg[0]
                                        c_bg.close()
                                    except Exception:
                                        pass

                                if not audit_sid:
                                    print(f"[{self.room_name} AUDIT SKIP]: No session_id bound for candidate '{cand_id}'. Aborting audit.", flush=True)
                                    return

                                res = audit_session(
                                    session_id=audit_sid,
                                    student_id=cand_id,
                                    audio_path_or_url=rec_target,
                                    room_name=self.room_name,
                                    db_path=db_path
                                )
                                print(f"[{self.room_name}] Forensic voice audit finished for session '{audit_sid}': verdict={res.get('verdict')}, flags={res.get('flags')}", flush=True)
                            except Exception as a_err:
                                print(f"[{self.room_name} AUDIT BG ERROR]: {a_err}\n{traceback.format_exc()}", flush=True)

                        threading.Thread(target=_run_bg_audit, daemon=True).start()
                    except Exception as hook_err:
                        print(f"[{self.room_name} AUDIT HOOK ERROR]: {hook_err}", flush=True)
                else:
                    print(f"[{self.room_name}] Forensic voice audit already triggered for session. Skipping duplicate.", flush=True)
            conn.close()
        except Exception as db_err:
            print(f"[{self.room_name} DB PERSIST ERROR]: {db_err}", flush=True)

    def stop_current_speech(self):
        """Immediately and cleanly stop any ongoing Kokoro TTS audio generation, thinking, and turn tasks."""
        self.cancel_event.set()
        if self.active_speech_task and not self.active_speech_task.done():
            self.active_speech_task.cancel()
            self.active_speech_task = None
        if self.active_turn_task and not self.active_turn_task.done():
            self.active_turn_task.cancel()
            self.active_turn_task = None
        self.is_agent_thinking = False
        self.is_examiner_speaking = False
        self.floor_opened_time = time.time()
        self.output_volume_factor = 1.0
        # CRITICAL FIX: Do NOT set self.needs_vad_reset = True here!
        # The candidate is actively speaking their interruption. Setting needs_vad_reset
        # would wipe ring_buffer on the next audio frame, destroying the candidate's speech!
        if self.audio_source:
            try:
                silence_frame = rtc.AudioFrame(
                    data=np.zeros(480, dtype=np.int16).tobytes(),
                    sample_rate=24000,
                    num_channels=1,
                    samples_per_channel=480
                )
                asyncio.create_task(self.audio_source.capture_frame(silence_frame))
            except Exception:
                pass

    def dispatch_candidate_turn(self, candidate_text: str, is_filibuster: bool = False, is_system_nudge: bool = False):
        """Dispatches a candidate utterance to the examiner, aggregating context if candidate spoke while thinking."""
        clean_text = candidate_text.strip()
        if not clean_text or self.exam_completed or not self.is_configured or not self.conversation_history:
            return

        self.floor_opened_time = 0.0
        if not is_system_nudge:
            self.dead_air_tier = 0

        if self.is_examiner_speaking:
            self.stop_current_speech()

        if self.is_agent_thinking and self.active_turn_task and not self.active_turn_task.done():
            if self.current_evaluating_text and not is_system_nudge:
                clean_text = f"{self.current_evaluating_text}. {clean_text}"
            print(f"[{self.room_name}] Aggregating candidate continuation during thinking phase: '{clean_text}'", flush=True)
            record_flight_event("TURN_PREEMPTED_BY_CONTINUATION", {
                "room": self.room_name,
                "previous_evaluating": self.current_evaluating_text,
                "aggregated_text": clean_text
            })
            self.active_turn_task.cancel()

        record_flight_event("DISPATCH_CANDIDATE_TURN", {
            "room": self.room_name,
            "text": clean_text,
            "is_filibuster": is_filibuster,
            "is_system_nudge": is_system_nudge
        })
        self.current_evaluating_text = clean_text
        self.is_agent_thinking = False
        self.active_turn_task = asyncio.create_task(self.handle_agent_turn(clean_text, is_filibuster, is_system_nudge))

    def reset_exam_session(self, preserve_greeting: bool = False, wipe_history: bool = True, preserve_audio: bool = False, is_reconnect: bool = False):
        print(f"[{self.room_name}] PURGE: Wiping session state (preserve_audio={preserve_audio}).", flush=True)
        self.stop_current_speech()
        if self.pending_dispatch_task and not self.pending_dispatch_task.done():
            self.pending_dispatch_task.cancel()
            self.pending_dispatch_task = None

        if not preserve_audio:
            # Cleanly cancel all active audio ingestion & transcription tasks when leaving/closing room
            for t in list(self.active_audio_tasks):
                if not t.done():
                    t.cancel()
            self.active_audio_tasks.clear()
            self.active_tracks.clear()
            if self.egress_id:
                asyncio.create_task(self.stop_candidate_egress())
        else:
            # Keep active audio pipe alive during viva configuration and reset VAD buffers cleanly
            self.needs_vad_reset = True

        self.exam_completed = False
        self.has_asked_final_question = False
        self.exam_start_time = None
        self.is_agent_thinking = False
        self.current_evaluating_text = ""
        self.examiner_audio_start_time = 0.0
        self.last_candidate_turn_time = 0.0
        if not preserve_greeting:
            self.has_greeted = False
        self.has_asked_first_question = False
        self.topic_subturn_count = 0
        self.cancel_event.clear()
        self.pending_candidate_text = ""
        self.floor_opened_time = 0.0
        self.dead_air_tier = 0
        self.greeted_participants.clear()
        if wipe_history:
            self.conversation_history = []
            self.is_configured = False
            self.session_config = {}
            self.is_reconnecting = False
            self.candidate_disconnected_time = None
            self.paused_elapsed_s = 0.0

        if not is_reconnect:
            self.conductor = None
            self.active_question = ""
            self.has_asked_first_question = False
        elif self.conductor:
            self.conductor.cursor = 0
            self.conductor.subturn_history.clear()
            self.conductor.prior_verdicts.clear()
            self.conductor.is_terminated = False
            self.active_question = self.conductor.get_initial_question()

        # Broadcast session purged signal to room to wipe client UI displays
        if self.room:
            try:
                purge_pkt = json.dumps({"type": "session_purged", "room": self.room_name}).encode()
                asyncio.create_task(self.room.local_participant.publish_data(purge_pkt, reliable=True))
            except Exception:
                pass

    async def broadcast_status(self, state: str, message: str = ""):
        if self.room:
            try:
                pkt = json.dumps({
                    "type": "agent_status",
                    "state": state,
                    "message": message,
                    "timestamp": time.time(),
                    "room": self.room_name
                }).encode()
                await self.room.local_participant.publish_data(pkt, reliable=True)
            except Exception:
                pass

    async def broadcast_telemetry(self, event: str, details: str):
        if self.room:
            try:
                pkt = json.dumps({
                    "type": "telemetry_event",
                    "event": event,
                    "details": details,
                    "timestamp": time.time(),
                    "room": self.room_name
                }).encode()
                await self.room.local_participant.publish_data(pkt, reliable=True)
            except Exception:
                pass

    async def broadcast_turn_decision(self, telemetry: dict):
        if self.room:
            try:
                pkt = json.dumps({
                    "type": "turn_decision_telemetry",
                    "timestamp": time.time(),
                    "room": self.room_name,
                    **telemetry
                }).encode()
                await self.room.local_participant.publish_data(pkt, reliable=True)
            except Exception:
                pass

    async def broadcast_clause(self, turn_id: str, clause: str, is_final: bool = False):
        if self.room:
            try:
                pkt = json.dumps({
                    "type": "clause_emitted",
                    "id": turn_id,
                    "clause": clause,
                    "is_final": is_final,
                    "timestamp": time.time()
                }).encode()
                await self.room.local_participant.publish_data(pkt, reliable=True)
            except Exception:
                pass

    async def stream_audio_clauses(self, clause_queue: asyncio.Queue, turn_id: str) -> Tuple[bool, str]:
        async with self.speech_lock:
            CHUNK_SIZE = 480
            spoken_clauses = []
            was_interrupted = False
            has_started_audio = False

            try:
                while True:
                    if self.cancel_event.is_set():
                        was_interrupted = True
                        break

                    try:
                        clause = await asyncio.wait_for(clause_queue.get(), timeout=0.1)
                    except asyncio.TimeoutError:
                        if self.cancel_event.is_set():
                            was_interrupted = True
                            break
                        continue

                    if clause is None:
                        break

                    clean_clause = clause.strip()
                    if not clean_clause:
                        clause_queue.task_done()
                        continue

                    await self.broadcast_clause(turn_id, clean_clause)
                    spoken_clauses.append(clean_clause)

                    try:
                        tts_spoken_text = phonetic_spoken_expansion(clean_clause)
                        stream = kokoro_tts.create_stream(tts_spoken_text, voice=EXAMINER_VOICE, speed=1.0, lang="en-us")
                        stream_start_time = None
                        frames_sent = 0
                        async for chunk, sr in stream:
                            if not has_started_audio:
                                has_started_audio = True
                                self.is_examiner_speaking = True
                                self.examiner_audio_start_time = time.time()
                                await self.broadcast_status("speaking", "Examiner is speaking...")

                            if self.cancel_event.is_set():
                                was_interrupted = True
                                break

                            pcm_int16 = (np.clip(chunk, -1.0, 1.0) * 32767.0).astype(np.int16)
                            for i in range(0, len(pcm_int16), CHUNK_SIZE):
                                if self.cancel_event.is_set():
                                    was_interrupted = True
                                    break
                                sub = pcm_int16[i:i + CHUNK_SIZE]
                                if len(sub) < CHUNK_SIZE:
                                    sub = np.pad(sub, (0, CHUNK_SIZE - len(sub)))
                                if self.output_volume_factor < 0.99:
                                    sub = (sub * self.output_volume_factor).astype(np.int16)
                                frame = rtc.AudioFrame(
                                    data=sub.tobytes(),
                                    sample_rate=24000,
                                    num_channels=1,
                                    samples_per_channel=CHUNK_SIZE
                                )

                                if not any(not p.identity.startswith("ai_examiner") for p in self.room.remote_participants.values()):
                                    was_interrupted = True
                                    break

                                if self.audio_source:
                                    try:
                                        await asyncio.wait_for(self.audio_source.capture_frame(frame), timeout=0.25)
                                    except asyncio.TimeoutError:
                                        pass

                                if stream_start_time is None:
                                    stream_start_time = time.monotonic()
                                frames_sent += 1
                                target_time = stream_start_time + (frames_sent * 0.020)
                                sleep_sec = target_time - time.monotonic()
                                if sleep_sec > 0:
                                    await asyncio.sleep(sleep_sec)

                            if was_interrupted:
                                break
                    except Exception as ex:
                        print(f"[{self.room_name} TTS ERROR]: {ex}", flush=True)

                    clause_queue.task_done()
                    if was_interrupted:
                        break

            finally:
                self.is_examiner_speaking = False
                self.examiner_audio_start_time = 0.0
                self.output_volume_factor = 1.0
                full_spoken_text = " ".join(spoken_clauses)
                if was_interrupted:
                    record_flight_event("EXAMINER_SPEECH_INTERRUPTED", {
                        "room": self.room_name,
                        "turn_id": turn_id,
                        "spoken_text": full_spoken_text
                    })
                    print(f"[{self.room_name} BARGE-IN] Speech cut off at: '{full_spoken_text}'", flush=True)
                    if self.room:
                        trunc_pkt = json.dumps({
                            "type": "turn_interrupted",
                            "id": turn_id,
                            "truncated_text": full_spoken_text + "...",
                            "interrupted": True
                        }).encode()
                        asyncio.create_task(self.room.local_participant.publish_data(trunc_pkt, reliable=True))
                if not self.exam_completed and not was_interrupted:
                    record_flight_event("EXAMINER_SPEECH_COMPLETED", {
                        "room": self.room_name,
                        "turn_id": turn_id,
                        "spoken_text": full_spoken_text
                    })
                    await self.broadcast_status("listening", "Examiner is listening — candidate may speak.")
                    self.on_floor_opened()
                elif was_interrupted:
                    await self.broadcast_status("listening", "Examiner interrupted — candidate has the floor.")
                else:
                    await self.broadcast_status("concluded", "Examination complete.")

            return was_interrupted, full_spoken_text

    async def handle_agent_turn(self, candidate_text: str, is_filibuster: bool = False, is_system_nudge: bool = False):
        if not candidate_text.strip() or self.exam_completed:
            return

        self.is_agent_thinking = True
        self.cancel_event.clear()
        if not is_system_nudge:
            await self.broadcast_status("thinking", "Examiner is evaluating your answer...")

        turn_id = f"turn_examiner_{int(time.time()*1000)}"
        print(f"\n[{self.room_name} EXAMINER EVALUATING] {'System Nudge' if is_system_nudge else 'Candidate turn'}: '{candidate_text}'", flush=True)

        try:
            now = time.time()
            self.last_candidate_turn_time = now
            if self.exam_start_time is None:
                self.exam_start_time = now

            elapsed_s = now - self.exam_start_time
            remaining_s = max(0, self.target_duration_s - elapsed_s)

            if self.conductor is None:
                ct = getattr(self, "course_title", "") or self.session_config.get("course_title", "") or "Oral Defense"
                self.conductor = SocraticConductor(UniversalSyllabus([f"Core Foundations of {ct}"], course_title=ct), vllm_url=VLLM_URL, model=VLLM_MODEL)
                self.conductor.unasked_nodes = list(self.conductor.syllabus.nodes)
                self.conductor.asked_nodes = []
                self.conductor.active_node = None
                self.active_question = self.conductor.get_initial_question()
                print(f"[{self.room_name} CONDUCTOR INIT] Dynamically loaded {len(self.conductor.syllabus.nodes)} topics for '{ct}'. Initial Q: {self.active_question}", flush=True)
            elif not hasattr(self.conductor, "unasked_nodes") or self.conductor.unasked_nodes is None:
                self.conductor.unasked_nodes = list(self.conductor.syllabus.nodes) if (self.conductor.syllabus and self.conductor.syllabus.nodes) else []
                self.conductor.asked_nodes = []
                self.conductor.active_node = None

            ct = getattr(self, "course_title", "") or self.session_config.get("course_title", "") or "Oral Viva Defense"
            academic_field = ct if ct and ct.lower() not in ["random bullshit", "bullshit", "test", "none", "oral viva defense"] else "the curriculum"

            nodes = self.conductor.syllabus.nodes if (self.conductor and self.conductor.syllabus and self.conductor.syllabus.nodes) else []
            cursor = self.conductor.cursor if self.conductor else 0

            is_misconduct_termination = bool(self.conductor and getattr(self.conductor, "conduct_strikes", 0) >= 3)
            is_time_up = remaining_s <= 30 or self.has_asked_final_question
            is_concluding_turn = False
            is_transition_turn = False
            transition_candidates = []

            if is_misconduct_termination:
                system_prompt = (
                    "You are the Lead Professor terminating an oral PhD viva defense due to academic misconduct.\n"
                    "Deliver a stern, formal, authoritative statement terminating the examination immediately and stating that their conduct will be officially reported to the academic committee.\n"
                    "MANDATORY INVARIANTS:\n"
                    "1. Maximum 1 to 2 short authoritative sentences (under 30 words total).\n"
                    "2. Zero question marks. You are terminating the exam; do NOT ask any questions.\n"
                    "3. Spoken prose only: No markdown, no bullet points, no quotes.\n"
                    "4. You MUST append [EXAM_TERMINATED] at the very end of your response."
                )
            elif is_time_up:
                is_concluding_turn = True
                self.exam_completed = True
                system_prompt = (
                    "You are the Lead Professor concluding an oral PhD viva defense as the allocated examination time has finished.\n"
                    "First, concisely acknowledge the candidate's final response in 2 to 4 words (e.g. 'Understood, fair perspective.', 'A solid concluding thought.').\n"
                    "Then, deliver a polite, formal closing statement indicating that our examination time has concluded and the academic committee will review their defense results.\n"
                    "MANDATORY INVARIANTS:\n"
                    "1. Maximum 1 to 2 short conversational sentences (under 30 words total).\n"
                    "2. Zero question marks. You are concluding the defense; do NOT ask any questions.\n"
                    "3. Spoken prose only: No markdown, no bullet points, no quotes.\n"
                    "4. You MUST append [EXAM_TERMINATED] at the very end of your response."
                )
            elif not self.has_asked_first_question:
                # Opening Turn: Initialize adaptive knowledge graph and select initial topic dynamically
                self.has_asked_first_question = True
                if not hasattr(self.conductor, "unasked_nodes") or self.conductor.unasked_nodes is None:
                    self.conductor.unasked_nodes = list(nodes)
                    self.conductor.asked_nodes = []
                    self.conductor.active_node = None

                first_node = select_adaptive_node(self.conductor, prev_node=None)
                if first_node:
                    first_q = first_node.title
                else:
                    first_q = self.active_question or f"What are the foundational principles of {academic_field}?"

                self.active_question = first_q
                self.topic_subturn_count = 0
                system_prompt = (
                    f"You are a senior Socratic professor conducting a live oral viva defense across an examination table in {academic_field}.\n"
                    f"You speak directly into the candidate's headphones.\n\n"
                    f"# INVARIANTS & EXAMINATION STEERING:\n"
                    f"1. Maximum 1 to 2 short conversational sentences (under 30 words total).\n"
                    f"2. Spoken conversational English only. Zero markdown, zero bullet points.\n"
                    f"3. Exactly ONE question mark '?' at the very end of your turn.\n"
                    f"4. ZERO REPETITION & NO SCRIPTED FORMULAS: Never repeat canned phrases (like 'I am assessing your knowledge' or 'Understood'). Invent fresh, authentic, spontaneous academic dialogue.\n"
                    f"5. DYNAMIC CLAP BACKS & ANTI-ROLE-REVERSAL: You are strictly the Lead Examiner. If the candidate asks you to define or explain the concept, or parrots your question back, NEVER answer it. CLAP BACK on your own with sharp academic authority and demand their answer.\n"
                    f"6. CANDIDATE CLARIFICATION: The candidate may only ask brief clarification on your question's premise. NEVER give away the answer or explain the core mechanism yourself.\n"
                    f"7. HANDLING SKIP REQUESTS: If the candidate asks to skip or says 'move on', do NOT immediately surrender. Encourage them to try by giving a brief intuitive hint or relatable analogy. If they still cannot answer, pivot firmly to the next topic.\n"
                    f"8. BANNED PHRASES: NEVER say 'Understood', 'Certainly', 'Sure', 'Of course', 'I appreciate', 'Feel free to', or 'Any more questions'.\n\n"
                    f"# OPENING TURN DIRECTIVE:\n"
                    f"The candidate has confirmed readiness to begin.\n"
                    f"Warmly acknowledge ('Excellent, let us commence.') and immediately ask Question 1:\n"
                    f"\"{first_q}\""
                )
            elif self.topic_subturn_count >= 3:
                # Topic fully explored (1 opening response + 3 Socratic probes = 4 turns total per topic) -> Check Runway Lockout or Option 3 Adaptive Knowledge Graph Branching
                self.topic_subturn_count = 0
                prev_node = getattr(self.conductor, "active_node", None)
                prev_q = prev_node.title if prev_node else "the previous topic"

                unasked = getattr(self.conductor, "unasked_nodes", [])
                asked = getattr(self.conductor, "asked_nodes", [])

                # GRACEFUL RUNWAY LOCKOUT: If less than 75s remain, DO NOT open a new topic that can't be finished. Conclude gracefully!
                is_runway_concluding = remaining_s <= 75 or not unasked or len(asked) >= min(10, len(nodes))
                if is_runway_concluding:
                    is_concluding_turn = True
                    self.exam_completed = True
                    system_prompt = (
                        "You are the Lead Professor concluding an oral PhD viva defense as the examination time has concluded.\n"
                        "First, concisely acknowledge the candidate's final response in 2 to 4 words (e.g. 'Understood, fair perspective.', 'A solid concluding thought.').\n"
                        "Then, deliver a polite, formal closing statement indicating that our examination time has concluded and the academic committee will review their defense results.\n"
                        "MANDATORY INVARIANTS:\n"
                        "1. Maximum 1 to 2 short conversational sentences (under 30 words total).\n"
                        "2. Zero question marks. You are concluding the defense; do NOT ask any questions.\n"
                        "3. Spoken prose only: No markdown, no bullet points, no quotes.\n"
                        "4. You MUST append [EXAM_TERMINATED] at the very end of your response."
                    )
                else:
                    # Adaptive Knowledge Graph Branching: LLM dynamically selects the next topic and delivers a seamless transition
                    self.topic_subturn_count = 0
                    candidate_nodes = list(unasked[:6]) if len(unasked) > 6 else list(unasked)
                    topic_bullet_list = "\n".join([f"- {n.title}" for n in candidate_nodes])

                    is_transition_turn = True
                    transition_candidates = candidate_nodes
                    self.active_question = candidate_nodes[0].title

                    system_prompt = (
                        f"You are a senior Socratic professor conducting a live oral viva defense across an examination table in {academic_field}.\n"
                        f"You speak directly into the candidate's headphones.\n\n"
                        f"# INVARIANTS & EXAMINATION STEERING:\n"
                        f"1. Maximum 1 to 2 short conversational sentences (under 30 words total).\n"
                        f"2. Spoken conversational English only. Zero markdown, zero bullet points.\n"
                        f"3. Exactly ONE question mark '?' at the very end of your turn.\n"
                        f"4. NEVER lecture or monologue. Do NOT re-discuss previous topics.\n"
                        f"5. ZERO REPETITION & NO CRUTCHES: NEVER use 'Understood', 'Fair point', or repetitive canned openers. Invent fresh, organic transitions.\n"
                        f"6. DYNAMIC TRANSITIONS BASED ON PERFORMANCE:\n"
                        f"   - If the candidate answered reasonably: transition organically by linking their intuition to the new topic.\n"
                        f"   - If the candidate was evading, dodging, or stalled: do NOT praise or say 'considering your interest'! Cut through the evasion with firm academic consequence (e.g., 'Leaving that unanswered, let us examine [topic].', 'We cannot stay stuck here. Moving to [topic]:') and ask your question.\n"
                        f"7. FORBIDDEN OPENERS: NEVER start with 'Understood', 'Certainly', 'Sure', 'Of course', or repeat prior phrases.\n\n"
                        f"# AVAILABLE SYLLABUS TOPICS:\n"
                        f"{topic_bullet_list}\n\n"
                        f"# SEAMLESS TOPIC TRANSITION DIRECTIVE:\n"
                        f"The candidate has concluded the discussion on '{prev_q}'.\n"
                        f"1. Select ONE topic from the available syllabus topics above that connects most logically or conceptually to the candidate's last response.\n"
                        f"2. Deliver a sharp, varied spoken transition into your chosen topic, and ask your opening question on that topic.\n"
                        f"3. Spoken dialogue ONLY. Do NOT output topic titles or labels as a header or prefix.\n"
                        f"4. FORBIDDEN WORDS: NEVER say 'Understood', 'Spot on', 'Precisely', 'Correct', 'Excellent', or 'Great job'.\n"
                    )
            else:
                # Candidate's first response to the active topic -> LLM evaluates and delivers ONE targeted Socratic probe
                self.topic_subturn_count += 1
                curr_node = getattr(self.conductor, "active_node", None)
                curr_q = curr_node.title if curr_node else self.active_question
                curr_target = curr_node.expected_answer if curr_node else ""
                is_final_probe = remaining_s <= 90 or self.topic_subturn_count >= 3

                if is_final_probe:
                    probe_directive = (
                        f"The candidate has responded to your inquiry on this topic. As examination time is entering its final runway, ask ONE targeted Socratic inquiry pushing them for their final synthesis on this core mechanism.\n"
                        f"- React naturally in 2 to 4 words without saying 'Understood'.\n"
                        f"- Ask ONE focused synthesis question pushing them to explain the underlying mechanism.\n"
                        f"- Under 30 words total. Exactly ONE question mark '?' at the very end."
                    )
                else:
                    probe_directive = (
                        f"Evaluate the candidate's turn and formulate your next spoken inquiry:\n"
                        f"- If the candidate gave a solid answer explaining the mechanism (e.g. effect on gradients, representations, or loss):\n"
                        f"  Acknowledge concisely ('Precisely.', 'Spot on.') and ask ONE follow-up Socratic inquiry probing deeper into the mathematical consequence or operational reason.\n"
                        f"- If the candidate gave a shallow guess, intuition, buzzword, or misconception:\n"
                        f"  React with fresh conversational poise ('Interesting premise.', 'Not quite the whole story.') and ask ONE targeted Socratic probe pushing them to explain the specific underlying mechanism.\n"
                        f"- If the candidate attempted role reversal, asks you to answer, repeats your question back, or evades (e.g. 'can you explain...', 'how does it utilize...', 'yes, you elaborate'):\n"
                        f"  DO NOT say 'Understood', 'Certainly', or use any passive filler. DO NOT repeat canned phrases like 'I am assessing your knowledge'.\n"
                        f"  CLAP BACK SPONTANEOUSLY with sharp, authoritative academic wit! Put the pressure squarely back on them.\n"
                        f"  - First dodge/reversal: Deliver a sharp, original academic pushback on their evasion (e.g., call out that they are on the podium, remind them that the panel asks the questions, or tell them dodging earns no marks), and demand their answer.\n"
                        f"  - Consecutive dodge/insistence: Escalate sternly. Call out their evasion directly (e.g., 'Evading the question won't get you through this defense. Tell me right now...', 'Echoing my inquiry is not an answer. Either you explain the core mechanism, or we record a zero and move on.').\n"
                        f"  - CRITICAL QUESTION VARIANCE: NEVER ask the same question words you used earlier! Pivot your angle: probe a specific sub-component (e.g. the error computation, the loss objective, or the ground truth comparison).\n"
                        f"- If the candidate asked a genuine, brief clarification on the question's premise:\n"
                        f"  Clarify the premise in under 10 words, and immediately demand their answer to the core inquiry.\n"
                        f"- If the candidate asked to skip, pass, or is stuck ('I don't know', 'skip this', 'move on'):\n"
                        f"  If this is their first difficulty on this topic: offer a brief intuitive hint, pushing them to give their best reasoned attempt.\n"
                        f"  If the candidate genuinely cannot answer after the hint: accept it firmly ('Fair enough, let us move to the next area.') and transition without getting stalled."
                    )

                system_prompt = (
                    f"You are a senior Socratic professor conducting a live oral viva defense across an examination table in {academic_field}.\n"
                    f"You speak directly into the candidate's headphones.\n\n"
                    f"# INVARIANTS & EXAMINATION STEERING:\n"
                    f"1. Maximum 1 to 2 short conversational sentences (under 30 words total).\n"
                    f"2. Spoken conversational English only. Zero markdown, zero bullet points.\n"
                    f"3. Exactly ONE question mark '?' at the very end of your turn.\n"
                    f"4. NEVER lecture, recite definitions, or explain the full solution yourself. Your goal is to guide the candidate to discover and explain the mechanism.\n"
                    f"5. ZERO REPETITION & NO SCRIPTED FORMULAS: Never repeat the exact same sentence, clap back, or question words you used in prior turns. Invent original, sharp academic dialogue on the fly.\n"
                    f"6. DYNAMIC CLAP BACKS: If the candidate tries to steer, asks you to answer, or parrots your words, do NOT be polite or subservient. Clap back with sharp academic authority and put the burden of proof back on them.\n"
                    f"7. BAN ON PASSIVE 'UNDERSTOOD' CRUTCHES: NEVER say 'Understood' when the candidate is dodging, deflecting, or asking you to answer. React directly to their evasion.\n"
                    f"8. QUESTION ANGLE VARIETY: If re-probing the same topic, attack it from a completely different angle or component rather than repeating prior questions.\n"
                    f"9. FORBIDDEN OPENERS: NEVER begin a turn with 'Understood', 'Certainly', 'Sure', 'Of course', 'I would be happy to', 'I appreciate', or 'Feel free to'.\n"
                    f"10. DO NOT transition to an unannounced topic prematurely. Keep focus on the active inquiry.\n\n"
                    f"# ACTIVE TOPIC:\n"
                    f"Question: {curr_q}\n"
                    f"Target Mechanism to Discover: {curr_target}\n\n"
                    f"# SOCRATIC PROBE DIRECTIVE:\n"
                    f"{probe_directive}"
                )

            # Build natural multi-turn chat messages from actual conversation history
            chat_messages = [{"role": "system", "content": system_prompt}]
            for msg in self.conversation_history[-8:]:
                role = msg.get("role")
                content = str(msg.get("content", "")).strip()
                if (
                    role in ("user", "assistant")
                    and content
                    and not content.startswith("[SYSTEM")
                    and not content.startswith("[MODALITY")
                    and not content.startswith("[CRITICAL")
                    and not content.startswith("The candidate has just")
                    and not content.startswith("[The candidate has entered")
                ):
                    chat_messages.append({"role": role, "content": content})

            chat_messages.append({"role": "user", "content": candidate_text.strip()})

            clause_queue: asyncio.Queue[Optional[str]] = asyncio.Queue()
            clause_buffer = ClauseBuffer()

            player_task = asyncio.create_task(self.stream_audio_clauses(clause_queue, turn_id))

            full_reply = ""
            payload = {
                "model": VLLM_MODEL,
                "messages": chat_messages,
                "temperature": 0.3,
                "max_tokens": 90,
                "stop": ["\n\n", "<|end|>", "<|assistant|>", "<|user|>", "<|endoftext|>", "\nCandidate:", "\nCandidate", "\nStudent:", "\nUser:", "\nAI Examiner:"],
                "stream": True
            }

            has_asked_question = False
            has_sent_first_clause = False
            async with aiohttp.ClientSession() as session:
                async with session.post(VLLM_URL, json=payload, timeout=aiohttp.ClientTimeout(total=20)) as resp:
                    if resp.status != 200:
                        err_text = await resp.text()
                        raise RuntimeError(f"vLLM HTTP {resp.status} failure: {err_text}")
                    async for line in resp.content:
                        if self.cancel_event.is_set():
                            break
                        line_str = line.decode('utf-8', errors='ignore').strip()
                        if line_str.startswith("data: ") and line_str != "data: [DONE]":
                            try:
                                data = json.loads(line_str[6:])
                                delta = data["choices"][0]["delta"].get("content", "")
                                if delta:
                                    full_reply += delta
                                    new_clauses = clause_buffer.feed(delta)
                                    for c in new_clauses:
                                        clean_c = c.replace("[EXAM_TERMINATED]", "").replace("[ADVANCE_TOPIC]", "").strip()
                                        if is_misconduct_termination and "?" in clean_c:
                                            continue
                                        if is_transition_turn and transition_candidates:
                                            for cand in transition_candidates:
                                                t_lower = cand.title.strip().lower()
                                                for sep in [":", "?", " -", " —"]:
                                                    prefix = t_lower + sep
                                                    if clean_c.lower().startswith(prefix):
                                                        clean_c = clean_c[len(prefix):].strip()
                                                        break
                                        if not has_sent_first_clause:
                                            for forbidden in ["Certainly.", "Certainly,", "Certainly", "Sure.", "Sure,", "Of course.", "Of course,", "Understood.", "Understood,", "Understood"]:
                                                if clean_c.startswith(forbidden):
                                                    clean_c = clean_c[len(forbidden):].strip()
                                                    break
                                        if clean_c:
                                            has_sent_first_clause = True
                                            await clause_queue.put(clean_c)
                                            # STRICT SINGLE-QUESTION HARD STOP:
                                            # Once the question is asked, immediately stop streaming to prevent rambling!
                                            if not is_misconduct_termination and not self.exam_completed and "?" in clean_c:
                                                has_asked_question = True
                                                break
                                    if has_asked_question:
                                        break
                            except Exception as ex:
                                print(f"[{self.room_name} JSON DELTA ERROR]: {ex}", flush=True)

            if not self.cancel_event.is_set() and not has_asked_question:
                for c in clause_buffer.flush():
                    clean_c = c.replace("[EXAM_TERMINATED]", "").replace("[ADVANCE_TOPIC]", "").strip()
                    if is_misconduct_termination and "?" in clean_c:
                        continue
                    if is_transition_turn and transition_candidates:
                        for cand in transition_candidates:
                            t_lower = cand.title.strip().lower()
                            for sep in [":", "?", " -", " —"]:
                                prefix = t_lower + sep
                                if clean_c.lower().startswith(prefix):
                                    clean_c = clean_c[len(prefix):].strip()
                                    break
                    if not has_sent_first_clause:
                        for forbidden in ["Certainly.", "Certainly,", "Certainly", "Sure.", "Sure,", "Of course.", "Of course,", "Understood.", "Understood,", "Understood"]:
                            if clean_c.startswith(forbidden):
                                clean_c = clean_c[len(forbidden):].strip()
                                break
                    if clean_c:
                        has_sent_first_clause = True
                        await clause_queue.put(clean_c)
                        if "?" in clean_c:
                            has_asked_question = True

                # Solution 2: Mandatory Terminal Question Enforcement
                if not is_misconduct_termination and not is_concluding_turn and not self.exam_completed and not has_asked_question:
                    curr_node = getattr(self.conductor, "active_node", None)
                    curr_q = curr_node.title if curr_node else self.active_question
                    fallback_probe = f"Specifically, {curr_q}" if (curr_q and "?" in curr_q) else "How does that mechanism operate in practice?"
                    full_reply += f" {fallback_probe}"
                    await clause_queue.put(fallback_probe)
                    has_asked_question = True
            elif has_asked_question:
                clause_buffer.flush()

            await clause_queue.put(None)
            was_interrupted, spoken_text = await player_task

            clean_reply = full_reply.strip()

            # Clean accidental topic title header prefix (e.g. "Layer Normalization: ..." or "Layer Normalization? ...")
            if is_transition_turn and transition_candidates:
                for cand in transition_candidates:
                    t_title = cand.title.strip().lower()
                    for sep in [":", "?", " -", " —"]:
                        prefix = t_title + sep
                        if clean_reply.lower().startswith(prefix):
                            clean_reply = clean_reply[len(prefix):].strip()
                            break
                clean_reply = re.sub(r'^(?:Topic\s*\d*[:?]\s*|Subtopic:?\s*)', '', clean_reply, flags=re.IGNORECASE).strip()

            if has_asked_question and "?" in clean_reply:
                q_pos = clean_reply.find("?")
                clean_reply = clean_reply[:q_pos + 1].strip()
            clean_reply = clean_reply.replace("[ADVANCE_TOPIC]", "").strip()

            if is_transition_turn and transition_candidates:
                chosen_node = resolve_chosen_topic(clean_reply, transition_candidates)
                if chosen_node:
                    if chosen_node in self.conductor.unasked_nodes:
                        self.conductor.unasked_nodes.remove(chosen_node)
                    if chosen_node not in self.conductor.asked_nodes:
                        self.conductor.asked_nodes.append(chosen_node)
                    self.conductor.active_node = chosen_node
                    self.active_question = chosen_node.title
                    print(f"[{self.room_name} SEAMLESS TRANSITION] LLM transitioned to topic '{chosen_node.title}' (remaining unasked: {len(self.conductor.unasked_nodes)})", flush=True)

            # Solution 1: Deterministic Pre-Speech Safety Filter against forbidden assistant pleasantries
            FORBIDDEN_ASSISTANT_PATTERNS = [
                "you're welcome",
                "you are welcome",
                "feel free to ask",
                "if you have any more questions",
                "if you have any questions",
                "any other topic, feel free",
                "guide you through the learning",
                "asking questions is a key part",
                "key part of learning",
                "don't hesitate to ask",
                "happy to help",
                "how can i assist",
                "how can i help",
            ]
            lower_reply = clean_reply.lower()
            if any(fp in lower_reply for fp in FORBIDDEN_ASSISTANT_PATTERNS):
                curr_node = getattr(self.conductor, "active_node", None)
                reanchor_q = curr_node.title if curr_node else self.active_question
                if not reanchor_q or not reanchor_q.strip():
                    reanchor_q = f"Let us proceed with the viva. What are the key mathematical mechanisms of {academic_field}?"
                print(f"[{self.room_name} SAFETY FILTER]: Caught forbidden assistant pleasantry in examiner speech ('{clean_reply}'). Replacing with authoritative re-anchor.", flush=True)
                clean_reply = f"Let us keep our focus on the examination. {reanchor_q}"

            # Solution 2 (Post-Processing): Ensure active turn ends in question mark
            if not self.exam_completed and not is_concluding_turn and not is_misconduct_termination and "?" not in clean_reply:
                curr_node = getattr(self.conductor, "active_node", None)
                curr_q = curr_node.title if curr_node else self.active_question
                if curr_q and "?" in curr_q:
                    clean_reply = f"{clean_reply.rstrip('. ')}. Specifically, {curr_q}"
                else:
                    clean_reply = f"{clean_reply.rstrip('. ')} — how does that mechanism operate?"

            if is_misconduct_termination:
                self.exam_completed = True
                if "?" in clean_reply or "[EXAM_TERMINATED]" not in clean_reply or len(clean_reply) < 10:
                    clean_reply = "The examination is terminated as the student has been hostile for the third time. This conduct will be officially reported to the academic committee. [EXAM_TERMINATED]"
            elif is_concluding_turn:
                self.exam_completed = True
                if "[EXAM_TERMINATED]" not in clean_reply:
                    clean_reply = clean_reply.rstrip(". ") + ". [EXAM_TERMINATED]"
            elif "[EXAM_TERMINATED]" in clean_reply:
                self.exam_completed = True

            final_spoken = clean_reply if clean_reply else spoken_text
            record_flight_event("EXAMINER_REPLY_GENERATED", {
                "room": self.room_name,
                "turn_id": turn_id,
                "text": final_spoken,
                "was_interrupted": was_interrupted
            })
            print(f"[{self.room_name} EXAMINER GENERATED]: '{final_spoken}'", flush=True)

            if self.room and not was_interrupted:
                reply_pkt = json.dumps({
                    "id": turn_id,
                    "sender": "AI Examiner",
                    "text": final_spoken,
                    "terminated": self.exam_completed,
                    "type": "exam_completed" if self.exam_completed else "agent_turn"
                }).encode()
                asyncio.create_task(self.room.local_participant.publish_data(reply_pkt, reliable=True))

            self.conversation_history.append({
                "role": "user",
                "content": candidate_text.strip()
            })
            self.has_asked_first_question = True
            if was_interrupted:
                # Solution 4: Rollback subturn count so candidate's barge-in does not falsely advance topic state
                if self.topic_subturn_count > 0:
                    self.topic_subturn_count -= 1
                self.conversation_history.append({
                    "role": "assistant",
                    "content": f"{spoken_text.strip()} [CUT OFF BY CANDIDATE BARGE-IN]"
                })
                if not self.exam_completed and clean_reply:
                    self.active_question = clean_reply
            else:
                final_text_content = clean_reply if clean_reply else spoken_text
                self.conversation_history.append({
                    "role": "assistant",
                    "content": final_text_content
                })
                if not self.exam_completed and final_text_content:
                    self.active_question = final_text_content
                if self.conductor:
                    self.conductor.subturn_history.append({"role": "candidate", "text": candidate_text})
                    self.conductor.subturn_history.append({"role": "examiner", "text": final_text_content})

                if self.exam_completed:
                    print(f"[{self.room_name}] Exam concluded in handle_agent_turn. Finalizing LiveKit Egress recording...", flush=True)
                    await self.broadcast_status("concluded", "Examination complete. Committee evaluation under review.")
                    await self.stop_candidate_egress()
                    cand_clean = (self.candidate_identity or "").replace("candidate_", "").strip()
                    record_flight_event("EXAM_RECORDING_FINALIZED", {
                        "room": self.room_name,
                        "candidate": cand_clean,
                        "recording_url": self.candidate_audio_s3_url
                    })

        except asyncio.CancelledError:
            print(f"[{self.room_name}] Turn evaluation cleanly preempted by candidate continuation.", flush=True)
        except Exception as e:
            if "CancelledError" in str(e) or isinstance(e, asyncio.CancelledError):
                print(f"[{self.room_name}] Turn evaluation cleanly preempted by candidate continuation.", flush=True)
            else:
                print(f"[{self.room_name} AGENT ERROR]: {type(e).__name__} - {e}", flush=True)
                traceback.print_exc()
                await self.broadcast_status("error", f"Examiner Failure: {str(e)}")
                if self.room:
                    err_pkt = json.dumps({
                        "id": turn_id,
                        "sender": "AI Examiner (SYSTEM ERROR)",
                        "text": f"[CRITICAL FAILURE: {type(e).__name__} - {str(e)}]"
                    }).encode()
                    try:
                        await self.room.local_participant.publish_data(err_pkt, reliable=True)
                    except Exception:
                        pass
        finally:
            self.is_agent_thinking = False
            self.current_evaluating_text = ""

    async def start_greeting(self, course_title: str = ""):
        if not self.is_configured or not self.conversation_history:
            print(f"[{self.room_name} ERROR]: Cannot start greeting: session is NOT configured! Zero-fallback policy in effect.", flush=True)
            return

        if self.is_examiner_speaking:
            print(f"[{self.room_name}] Preempting ongoing speech for fresh opening greeting...", flush=True)
            self.stop_current_speech()
            await asyncio.sleep(0.15)
        self.is_examiner_speaking = False
        self.examiner_audio_start_time = 0.0
        self.has_greeted = True
        self.cancel_event.clear()
        await asyncio.sleep(0.1)

        if self.exam_start_time is None:
            self.exam_start_time = time.time()

        turn_id = f"turn_greet_{int(time.time()*1000)}"
        title = course_title or self.session_config.get("course_title", "the examination topic")

        # DYNAMIC LLM OPENING: Warm Greeting + Readiness Check (Technical questions begin on turn 2)
        await self.broadcast_status("thinking", "Examiner is initializing opening defense greeting...")
        print(f"\n[{self.room_name} GREETING] Streaming dynamic LLM opening greeting for '{title}'...", flush=True)

        prompt_instruction = (
            "The candidate has just connected to the viva chamber across an examination table. "
            "Welcome them with brief, reassuring academic composure, invite them to take a seat, and ask them to let you know when they are ready to commence. "
            "MANDATORY LIMITS: Do NOT ask any technical or subject questions yet. Under 25 words. Plain spoken prose only. Exactly 2 short sentences."
        )
        greeting_system = (
            "You are the Lead Socratic Examiner in an oral PhD defense examination. "
            "Speak with composed, reassuring academic composure directly to the candidate. Output plain spoken prose only."
        )

        clause_queue: asyncio.Queue[Optional[str]] = asyncio.Queue()
        clause_buffer = ClauseBuffer()
        player_task = asyncio.create_task(self.stream_audio_clauses(clause_queue, turn_id))

        full_reply = ""

        try:
            payload = {
                "model": VLLM_MODEL,
                "messages": [
                    {"role": "system", "content": greeting_system},
                    {"role": "user", "content": prompt_instruction}
                ],
                "temperature": 0.5,
                "max_tokens": 60,
                "stream": True
            }

            async with aiohttp.ClientSession() as session:
                async with session.post(VLLM_URL, json=payload, timeout=aiohttp.ClientTimeout(total=15)) as resp:
                    if resp.status != 200:
                        raise RuntimeError(f"vLLM HTTP {resp.status}")
                    async for line in resp.content:
                        if self.cancel_event.is_set():
                            break
                        line_str = line.decode('utf-8', errors='ignore').strip()
                        if line_str.startswith("data: ") and line_str != "data: [DONE]":
                            try:
                                data = json.loads(line_str[6:])
                                delta = data["choices"][0]["delta"].get("content", "")
                                if delta:
                                    full_reply += delta
                                    new_clauses = clause_buffer.feed(delta)
                                    for c in new_clauses:
                                        clean_c = c.replace("[EXAM_TERMINATED]", "").strip()
                                        if clean_c:
                                            await clause_queue.put(clean_c)
                            except Exception:
                                pass

            if not self.cancel_event.is_set():
                for c in clause_buffer.flush():
                    clean_c = c.replace("[EXAM_TERMINATED]", "").strip()
                    if clean_c:
                        await clause_queue.put(clean_c)

        except asyncio.CancelledError:
            print(f"[{self.room_name} GREETING]: Cancelled by candidate barge-in. Committing opening turn...", flush=True)
            if not any(msg.get("role") == "assistant" for msg in self.conversation_history):
                self.conversation_history.append({"role": "assistant", "content": "Welcome to the viva chamber. Please take a seat. Let me know when you are ready to begin. [CUT OFF BY CANDIDATE BARGE-IN]"})
            try:
                await clause_queue.put(None)
            except Exception:
                pass
            return
        except Exception as e:
            print(f"[{self.room_name} GREET LLM ERROR]: {e}", flush=True)
            self.has_greeted = False
            if self.room:
                err_pkt = json.dumps({"type": "examiner_error", "error": f"LLM generation failed: {e}"}).encode()
                asyncio.create_task(self.room.local_participant.publish_data(err_pkt, reliable=True))
            await clause_queue.put(None)
            await player_task
            await self.broadcast_status("error", f"Examiner initialization failed: {e}")
            return

        if not full_reply.strip():
            print(f"[{self.room_name} GREET ERROR]: LLM returned empty greeting. Zero-fallback policy in effect.", flush=True)
            self.has_greeted = False
            await clause_queue.put(None)
            await player_task
            await self.broadcast_status("error", "Examiner generated empty greeting.")
            return

        await clause_queue.put(None)
        was_interrupted, spoken_text = await player_task

        final_greeting = spoken_text.strip() if was_interrupted else (full_reply.strip() or spoken_text.strip())
        if not final_greeting:
            final_greeting = "Welcome to the viva chamber. Please take a seat. Let me know when you are ready to begin."
        print(f"[{self.room_name} GREETING COMPLETED]: '{final_greeting}' (was_interrupted={was_interrupted})", flush=True)

        if self.room and not was_interrupted:
            pkt = json.dumps({
                "id": turn_id,
                "sender": "AI Examiner",
                "text": final_greeting
            }).encode()
            try:
                await self.room.local_participant.publish_data(pkt, reliable=True)
            except Exception as e:
                print(f"[{self.room_name} GREET ERROR]: {e}", flush=True)

        if was_interrupted:
            self.conversation_history.append({"role": "assistant", "content": f"{spoken_text.strip()} [CUT OFF BY CANDIDATE BARGE-IN]"})
        else:
            self.conversation_history.append({"role": "assistant", "content": final_greeting})

    async def terminate_session_afk(self):
        """Immediately announces exam termination via TTS, alerts UI, and marks session as terminated."""
        self.exam_completed = True
        self.stop_current_speech()
        turn_id = f"turn_examiner_term_{int(time.time()*1000)}"
        conclusion_text = "Due to continued inactivity, this oral defense examination is now concluded."
        print(f"\n[{self.room_name} DEAD-AIR TIER 5] Announcing final termination: '{conclusion_text}'", flush=True)

        if self.room:
            reply_pkt = json.dumps({
                "id": turn_id,
                "sender": "AI Examiner",
                "text": conclusion_text,
                "terminated": True,
                "type": "exam_completed"
            }).encode()
            try:
                await self.room.local_participant.publish_data(reply_pkt, reliable=True)
            except Exception as e:
                print(f"[{self.room_name} TERMINATION DATA ERROR]: {e}", flush=True)

        self.conversation_history.append({"role": "assistant", "content": conclusion_text})

        # Speak the conclusion text via Kokoro TTS
        try:
            q: asyncio.Queue[Optional[str]] = asyncio.Queue()
            c_buf = ClauseBuffer()
            for c in c_buf.feed(conclusion_text) + c_buf.flush():
                await q.put(c)
            await q.put(None)
            await self.stream_audio_clauses(q, turn_id)
        except Exception as e:
            print(f"[{self.room_name} TERMINATION TTS ERROR]: {e}", flush=True)

        await self.broadcast_status("concluded", "Examination concluded due to inactivity.")
        await self.stop_candidate_egress()
        print(f"[{self.room_name}] Examination formally concluded and sealed.", flush=True)

        # Wait 3.5 seconds after audio finishes, then send force_disconnect so client exits room
        await asyncio.sleep(3.5)
        if self.room:
            try:
                quit_pkt = json.dumps({
                    "type": "force_disconnect",
                    "reason": "inactivity_timeout"
                }).encode()
                await self.room.local_participant.publish_data(quit_pkt, reliable=True)
                print(f"[{self.room_name}] Sent force_disconnect to client.", flush=True)
            except Exception as e:
                print(f"[{self.room_name} FORCE DISCONNECT ERROR]: {e}", flush=True)

    async def process_audio(self, track: rtc.Track, participant: rtc.RemoteParticipant):
        if track.sid in self.active_tracks:
            return
        self.active_tracks.add(track.sid)

        # Native LiveKit WebRTC anti-aliased resampling to 16,000 Hz Mono
        audio_stream = rtc.AudioStream(track, sample_rate=16000, num_channels=1)
        vad_tracker = CandidateVADTracker()
        ring_buffer = deque(maxlen=16000 * 60)
        accumulator = np.array([], dtype=np.float32)
        trailing_text = ""

        # Open shadow WAV recorder for ground-truth audio tracking (zero gating, zero filtering)
        try:
            clean_room = re.sub(r'[^a-zA-Z0-9_\-]', '_', self.room_name)
            self.shadow_wav_path = os.path.join(FLIGHT_RECORDER_DIR, f"shadow_raw_{clean_room}.wav")
            self.shadow_wav_file = wave.open(self.shadow_wav_path, "wb")
            self.shadow_wav_file.setnchannels(1)
            self.shadow_wav_file.setsampwidth(2)
            self.shadow_wav_file.setframerate(16000)
            record_flight_event("SHADOW_RECORDER_OPENED", {
                "room": self.room_name,
                "participant": participant.identity,
                "wav_path": self.shadow_wav_path
            })
        except Exception as e:
            self.shadow_wav_file = None

        try:
            async for event in audio_stream:
                if self.exam_completed:
                    continue
                frame = event.frame
                self.last_audio_frame_time = time.time()
                # Passive Shadow Recording: Capture exact raw frame data directly from WebRTC C++ layer
                if self.shadow_wav_file:
                    try:
                        self.shadow_wav_file.writeframes(frame.data)
                    except Exception:
                        pass

                # Guaranteed pristine 16kHz mono audio directly from WebRTC C++ pipeline
                raw_pcm = np.frombuffer(frame.data, dtype=np.int16).astype(np.float32) / 32768.0

                if self.needs_vad_reset:
                    self.needs_vad_reset = False
                    # Only reset VAD buffers if candidate is NOT actively speaking!
                    if not vad_tracker.is_speaking:
                        vad_tracker.speech_duration_ms = 0
                        vad_tracker.silence_duration_ms = 0
                        vad_tracker.tentative_speech_ms = 0
                        vad_tracker.smart_turn_fired = False
                        vad_tracker.state = np.zeros((2, 1, 128), dtype=np.float32)
                        ring_buffer.clear()
                        accumulator = np.array([], dtype=np.float32)

                # Vectorized NumPy frame extension (bypasses 16,000 Python loop iterations/sec)
                ring_buffer.extend(raw_pcm)
                accumulator = np.concatenate([accumulator, raw_pcm]) if len(accumulator) > 0 else raw_pcm

                while len(accumulator) >= 512:
                    chunk_512 = accumulator[:512]
                    accumulator = accumulator[512:]

                    has_pending = bool(self.pending_candidate_text)
                    vad_ev, prob = vad_tracker.process_512(
                        chunk_512,
                        recent_audio_buf=np.array(list(ring_buffer), dtype=np.float32),
                        is_examiner_speaking=self.is_examiner_speaking,
                        trailing_text=trailing_text,
                        has_pending_fragment=has_pending
                    )

                    if vad_tracker.is_speaking:
                        self.is_candidate_speaking = True
                        self.last_candidate_speech_time = time.time()

                    if vad_tracker.just_evaluated_smart_turn:
                        vad_tracker.just_evaluated_smart_turn = False
                        asyncio.create_task(self.broadcast_turn_decision({
                            "stage": "STAGE_2_ACOUSTIC",
                            "vad_state": "paused",
                            "acoustic_prob": float(vad_tracker.last_neural_prob),
                            "acoustic_verdict": "COMPLETE" if vad_tracker.smart_turn_fired else "INCOMPLETE",
                            "threshold": 0.65,
                            "action": "AWAITING_STAGE_3_SNAPSHOT" if vad_tracker.smart_turn_fired else "HOLDING_FLOOR"
                        }))

                    # Dynamic soft ducking: If candidate utters an acknowledgment ("hmm", "yeah", "ok") during examiner speech,
                    # duck volume slightly (0.35) so candidate hears themselves, but examiner keeps speaking!
                    if self.is_examiner_speaking:
                        if vad_tracker.speech_duration_ms >= 64 and not vad_tracker.is_speaking:
                            self.output_volume_factor = 0.35
                        elif not vad_tracker.is_speaking:
                            self.output_volume_factor = 1.0

                    if vad_ev == "speech_start":
                        self.is_candidate_speaking = True
                        self.last_candidate_speech_time = time.time()
                        self.floor_opened_time = 0.0
                        self.dead_air_tier = 0
                        self.output_volume_factor = 1.0
                        record_flight_event("SPEECH_START", {
                            "room": self.room_name,
                            "prob": float(prob),
                            "is_examiner_speaking": self.is_examiner_speaking
                        })
                        asyncio.create_task(self.broadcast_telemetry("SPEECH_START", "Candidate voice activity detected"))
                        asyncio.create_task(self.broadcast_turn_decision({
                            "stage": "STAGE_1_VAD",
                            "vad_state": "speaking",
                            "action": "RESUMED_SPEAKING"
                        }))
                        if self.pending_dispatch_task and not self.pending_dispatch_task.done():
                            self.pending_dispatch_task.cancel()
                            self.pending_dispatch_task = None
                            print(f"[{self.room_name}] Candidate resumed speaking — watchdog cancelled.", flush=True)

                        if self.is_examiner_speaking:
                            record_flight_event("VOICE_BARGE_IN_TRIGGERED", {
                                "room": self.room_name,
                                "speech_duration_ms": vad_tracker.speech_duration_ms,
                                "prob": float(prob)
                            })
                            print(f"[{self.room_name} VOICE BARGE-IN] Candidate interrupted ({vad_tracker.speech_duration_ms}ms, prob {prob:.2f})! Halting examiner speech immediately.", flush=True)
                            asyncio.create_task(self.broadcast_turn_decision({
                                "stage": "STAGE_BARGE_IN",
                                "vad_state": "barge_in",
                                "action": "BARGE_IN_TRIGGERED"
                            }))
                            self.stop_current_speech()

                    # While examiner is speaking and candidate is completely quiet (prob < 0.25), retain 400ms pre-roll
                    if self.is_examiner_speaking and not self.cancel_event.is_set() and not vad_tracker.is_speaking and prob < 0.25:
                        while len(ring_buffer) > 16000 * 0.40:
                            ring_buffer.popleft()

                    if vad_ev in ("speech_end", "smart_turn_endpoint", "filibuster_triggered"):
                        self.is_candidate_speaking = False
                        self.last_candidate_speech_time = time.time()
                        is_filibuster = (vad_ev == "filibuster_triggered")

                        if not is_filibuster:
                            # =========================================================
                            # UNIVERSAL: NON-GUILLOTINE 3-STAGE TURN DECISION ENGINE
                            # =========================================================
                            snapshot_audio = np.array(list(ring_buffer), dtype=np.float32)
                            # Non-destructive snapshot: ring_buffer is NOT cleared!

                            if len(snapshot_audio) >= 16000 * 0.35:
                                try:
                                    loop = asyncio.get_event_loop()
                                    def transcribe():
                                         global stt_model
                                         rms = float(np.sqrt(np.mean(snapshot_audio ** 2)))
                                         if rms < 0.0015:
                                             record_flight_event("RMS_GATE_DROPPED", {
                                                 "room": self.room_name,
                                                 "rms": rms,
                                                 "threshold": 0.0015,
                                                 "buffer_len_s": len(snapshot_audio) / 16000.0
                                             })
                                             return ""
                                         try:
                                             segs, _ = stt_model.transcribe(
                                                 snapshot_audio,
                                                 beam_size=5,
                                                 best_of=5,
                                                 language="en",
                                                 vad_filter=False,
                                                 initial_prompt=getattr(self, "stt_prompt", STT_PROMPT),
                                                 condition_on_previous_text=False,
                                                 temperature=0.0,
                                                 no_speech_threshold=0.60,
                                                 log_prob_threshold=-1.35
                                             )
                                         except Exception as cuda_ex:
                                             if "out of memory" in str(cuda_ex).lower() or "invalid device" in str(cuda_ex).lower():
                                                 print(f"[{self.room_name} STT RECOVERY] CUDA OOM. Switching Whisper to CPU (int8, 8 threads)...", flush=True)
                                                 stt_model = WhisperModel(WHISPER_MODEL_PATH, device="cpu", compute_type="int8", cpu_threads=8)
                                                 segs, _ = stt_model.transcribe(
                                                     snapshot_audio,
                                                     beam_size=5,
                                                     best_of=5,
                                                     language="en",
                                                     vad_filter=False,
                                                     initial_prompt=getattr(self, "stt_prompt", STT_PROMPT),
                                                     condition_on_previous_text=False,
                                                     temperature=0.0,
                                                     no_speech_threshold=0.60,
                                                     log_prob_threshold=-1.35
                                                 )
                                             else:
                                                 raise cuda_ex
                                         clean_chunks = []
                                         for s in segs:
                                             if s.no_speech_prob > 0.60 or s.avg_logprob < -1.35:
                                                 continue
                                             t = s.text.strip()
                                             if t.lower().rstrip(".,!?") in [
                                                 "thank you", "thanks for watching", "spot balls", "you", "bye",
                                                 "i have no contact", "i have no more contact", "and you'll do it"
                                             ]:
                                                 continue
                                             clean_chunks.append(t)
                                         return " ".join(clean_chunks).strip()

                                    async with get_stt_lock():
                                        text = await loop.run_in_executor(None, transcribe)

                                    record_flight_event("WHISPER_RAW_OUTPUT", {
                                        "room": self.room_name,
                                        "text": text,
                                        "buffer_len_s": len(snapshot_audio) / 16000.0,
                                        "vad_is_speaking": vad_tracker.is_speaking
                                    })

                                    # Race Guard: If candidate resumed speaking during STT, hold floor and preserve text
                                    if vad_tracker.is_speaking:
                                        record_flight_event("STT_HELD_FLOOR_CONTINUATION", {
                                            "room": self.room_name,
                                            "text": text
                                        })
                                        print(f"[{self.room_name}] Candidate continuing speech during STT ('{text}'). Holding floor...", flush=True)
                                        self.pending_candidate_text = text
                                        continue

                                    if text and len(text) > 1:
                                        # Backchannel filter: Do NOT treat conversational acknowledgments ("hmm", "yeah", "ok") as exam answers!
                                        clean_ack = text.lower().strip(".,!?\"' ")
                                        BACKCHANNEL_TOKENS = {
                                             "hmm", "hm", "hmmm", "hmmmm", "yeah", "yea", "yeah yeah", "yes",
                                             "ok", "okay", "ojkkkkk", "right", "mhm", "uh-huh", "uh huh",
                                             "sure", "yep", "yup", "got it", "i see", "understood", "alright", "all right"
                                        }
                                        if clean_ack in BACKCHANNEL_TOKENS:
                                            if self.is_examiner_speaking:
                                                record_flight_event("DROPPED_BACKCHANNEL_FILTER", {
                                                    "room": self.room_name,
                                                    "token": text,
                                                    "is_examiner_speaking": self.is_examiner_speaking
                                                })
                                                print(f"[{self.room_name} ACKNOWLEDGMENT]: Candidate murmured backchannel ('{text}') during examiner speech. Examiner continues.", flush=True)
                                                continue
                                            else:
                                                # Candidate spoke while floor is open to candidate!
                                                num_assistant_turns = len([m for m in self.conversation_history if m.get("role") == "assistant"])
                                                if num_assistant_turns <= 1:
                                                    print(f"[{self.room_name} READINESS CONFIRMATION]: Candidate confirmed readiness ('{text}'). Dispatching turn!", flush=True)
                                                    ring_buffer.clear()
                                                    self.pending_candidate_text = ""
                                                    turn_id = f"turn_student_{int(time.time()*1000)}"
                                                    if self.room:
                                                        pkt = json.dumps({"id": turn_id, "sender": "Candidate", "text": text}).encode()
                                                        await self.room.local_participant.publish_data(pkt, reliable=True)
                                                    self.dispatch_candidate_turn(text, is_filibuster=False)
                                                    continue
                                                self.pending_candidate_text = text
                                                continue

                                        trailing_text = text
                                        is_complete, reason, eou_prob = classify_eou_onnx(text)
                                        record_flight_event("EOU_CLASSIFICATION", {
                                            "room": self.room_name,
                                            "text": text,
                                            "is_complete": is_complete,
                                            "reason": reason,
                                            "eou_prob": float(eou_prob),
                                            "acoustic_prob": float(vad_tracker.last_neural_prob)
                                        })
                                        print(f"\n[{self.room_name} EOU] Transcript: '{text}' -> {reason} (Complete: {is_complete}, EOUProb: {eou_prob:.4f}, AcousticProb: {vad_tracker.last_neural_prob:.2f})", flush=True)

                                        if self.pending_dispatch_task and not self.pending_dispatch_task.done():
                                            self.pending_dispatch_task.cancel()
                                            self.pending_dispatch_task = None

                                        # Broadcast rich turn decision telemetry for the UI
                                        asyncio.create_task(self.broadcast_turn_decision({
                                            "stage": "STAGE_3_SEMANTIC",
                                            "vad_state": "paused",
                                            "acoustic_prob": float(vad_tracker.last_neural_prob),
                                            "acoustic_verdict": "COMPLETE" if vad_tracker.smart_turn_fired else "INCOMPLETE",
                                            "semantic_verdict": reason,
                                            "semantic_prob": float(eou_prob),
                                            "buffer_text": text,
                                            "action": "DISPATCHING" if is_complete else "HOLDING_FLOOR"
                                        }))

                                        if not is_complete:
                                            self.pending_candidate_text = text
                                            print(f"[{self.room_name}] Holding floor for continuation (Reason: {reason}). 3.0s watchdog active...", flush=True)

                                            if self.room:
                                                part_id = f"turn_student_part_{int(time.time()*1000)}"
                                                pkt = json.dumps({"id": part_id, "sender": "Candidate", "text": text + "...", "is_partial": True}).encode()
                                                asyncio.create_task(self.room.local_participant.publish_data(pkt, reliable=True))

                                            async def watchdog_s2(final_text: str):
                                                try:
                                                    await asyncio.sleep(3.0)
                                                    print(f"[{self.room_name}] 3.0s silence elapsed. Finalizing turn: '{final_text}'", flush=True)
                                                    record_flight_event("EOU_WATCHDOG_COMMIT", {
                                                        "room": self.room_name,
                                                        "text": final_text
                                                    })
                                                    asyncio.create_task(self.broadcast_turn_decision({
                                                        "stage": "STAGE_TIMEOUT",
                                                        "vad_state": "timeout_commit",
                                                        "acoustic_prob": float(vad_tracker.last_neural_prob),
                                                        "acoustic_verdict": "TIMEOUT",
                                                        "semantic_verdict": "TIMEOUT_FORCE_COMMIT",
                                                        "semantic_prob": 1.0,
                                                        "buffer_text": final_text,
                                                        "action": "TIMEOUT_COMMITTED"
                                                    }))
                                                    ring_buffer.clear()
                                                    self.pending_candidate_text = ""
                                                    turn_id = f"turn_student_{int(time.time()*1000)}"
                                                    if self.room:
                                                        pkt = json.dumps({"id": turn_id, "sender": "Candidate", "text": final_text}).encode()
                                                        await self.room.local_participant.publish_data(pkt, reliable=True)
                                                    self.dispatch_candidate_turn(final_text, is_filibuster=False)
                                                except asyncio.CancelledError:
                                                    pass

                                            self.pending_dispatch_task = asyncio.create_task(watchdog_s2(text))
                                        else:
                                            # Thought is complete! Clear buffer and dispatch immediately!
                                            ring_buffer.clear()
                                            self.pending_candidate_text = ""
                                            turn_id = f"turn_student_{int(time.time()*1000)}"
                                            if self.room:
                                                pkt = json.dumps({"id": turn_id, "sender": "Candidate", "text": text}).encode()
                                                await self.room.local_participant.publish_data(pkt, reliable=True)
                                            self.dispatch_candidate_turn(text, is_filibuster=False)
                                except Exception as ex:
                                    print(f"[{self.room_name} STT ERROR]: {ex}", flush=True)
                        else:
                            # Filibuster timeout (>45s continuous speaking): force commit
                            full_turn_audio = np.array(list(ring_buffer), dtype=np.float32)
                            ring_buffer.clear()
                            if len(full_turn_audio) >= 16000 * 0.35:
                                try:
                                    loop = asyncio.get_event_loop()
                                    def transcribe_filibuster():
                                        segs, _ = stt_model.transcribe(full_turn_audio, beam_size=3, language="en")
                                        return " ".join([s.text.strip() for s in segs]).strip()
                                    async with get_stt_lock():
                                        text = await loop.run_in_executor(None, transcribe_filibuster)
                                    if text:
                                        self.pending_candidate_text = ""
                                        turn_id = f"turn_student_{int(time.time()*1000)}"
                                        if self.room:
                                            pkt = json.dumps({"id": turn_id, "sender": "Candidate", "text": text}).encode()
                                            await self.room.local_participant.publish_data(pkt, reliable=True)
                                        self.dispatch_candidate_turn(text, is_filibuster=True)
                                except Exception as ex:
                                    print(f"[{self.room_name} FILIBUSTER STT ERROR]: {ex}", flush=True)
        finally:
            if self.shadow_wav_file:
                try:
                    self.shadow_wav_file.close()
                    record_flight_event("SHADOW_RECORDER_CLOSED", {
                        "room": self.room_name,
                        "wav_path": self.shadow_wav_path
                    })
                except Exception:
                    pass
                self.shadow_wav_file = None
            self.active_tracks.discard(track.sid)


    def reconcile_audio_tracks(self):
        """
        Deterministic self-healing: Guarantees that every connected human candidate
        has an active, running process_audio task. Re-attaches immediately if missing.
        """
        if not self.room:
            return
        for p in self.room.remote_participants.values():
            if not p.identity.startswith("ai_examiner"):
                for pub in p.track_publications.values():
                    if pub.track and pub.track.kind == rtc.TrackKind.KIND_AUDIO:
                        if not self.egress_id and not self.egress_starting:
                            asyncio.create_task(self.start_candidate_egress(pub.track, p))
                        if pub.track.sid not in self.active_tracks:
                            print(f"[{self.room_name} RECONCILE] Auto-reconciling audio ingestion pipeline for {p.identity} ({pub.track.sid})", flush=True)
                            task = asyncio.create_task(self.process_audio(pub.track, p))
                            self.active_audio_tasks.add(task)
                            task.add_done_callback(self.active_audio_tasks.discard)

    async def connect_and_serve(self):
        if self.livekit_api_client is None:
            self.livekit_api_client = api.LiveKitAPI(LIVEKIT_URL, API_KEY, API_SECRET)

        token = (
            api.AccessToken(API_KEY, API_SECRET)
            .with_identity(f"ai_examiner_{self.room_name}")
            .with_name("AI Examiner")
            .with_grants(api.VideoGrants(room_join=True, room=self.room_name, can_subscribe=True, can_publish=True, can_publish_data=True))
            .to_jwt()
        )

        room = rtc.Room()
        self.room = room
        self.audio_source = rtc.AudioSource(sample_rate=24000, num_channels=1, queue_size_ms=500)
        self.audio_track = rtc.LocalAudioTrack.create_audio_track("examiner_voice", self.audio_source)

        @room.on("track_subscribed")
        def on_track_sub(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
            if track.kind == rtc.TrackKind.KIND_AUDIO and not participant.identity.startswith("ai_examiner"):
                print(f"[{self.room_name}] Audio subscribed: {participant.identity}", flush=True)
                asyncio.create_task(self.start_candidate_egress(track, participant))
                task = asyncio.create_task(self.process_audio(track, participant))
                self.active_audio_tasks.add(task)
                task.add_done_callback(self.active_audio_tasks.discard)

        @room.on("participant_connected")
        def on_p_connect(participant: rtc.RemoteParticipant):
            if not participant.identity.startswith("ai_examiner"):
                self.candidate_identity = participant.identity
                if participant.metadata:
                    try:
                        p_meta = json.loads(participant.metadata)
                        if isinstance(p_meta, dict):
                            s_id = p_meta.get("sessionId")
                            if s_id:
                                self.session_id = str(s_id).strip()
                                print(f"[{self.room_name}] Bound session_id '{self.session_id}' from participant metadata.", flush=True)
                    except Exception as meta_err:
                        print(f"[{self.room_name} META PARSE WARN]: {meta_err}", flush=True)
                # If an active defense was already in progress (e.g. browser reload / reconnect)
                if self.is_configured and len(self.conversation_history) > 1 and not self.exam_completed:
                    print(f"[{self.room_name}] Candidate {participant.identity} RECONNECTED! Resuming defense session.", flush=True)
                    if self.candidate_disconnected_time and self.exam_start_time:
                        pause_duration = time.time() - self.candidate_disconnected_time
                        self.exam_start_time += pause_duration
                    self.candidate_disconnected_time = None
                    self.is_reconnecting = False
                    self.reconcile_audio_tracks()
                    if self.room:
                        res_pkt = json.dumps({
                            "type": "session_resumed",
                            "status": "ok",
                            "room": self.room_name,
                            "elapsed_s": int(time.time() - self.exam_start_time) if self.exam_start_time else 0,
                            "target_duration_s": self.target_duration_s,
                            "course_title": self.session_config.get("course_title", ""),
                            "history": [
                                m for m in self.conversation_history
                                if m.get("role") in ("assistant", "user")
                                and not str(m.get("content", "")).startswith("[SYSTEM")
                                and not str(m.get("content", "")).startswith("[The candidate has entered")
                            ]
                        }).encode()
                        asyncio.create_task(self.room.local_participant.publish_data(res_pkt, reliable=True))
                else:
                    print(f"[{self.room_name}] Fresh candidate joined: {participant.identity}. Ready for room configuration.", flush=True)
                    self.reset_exam_session(preserve_greeting=False, wipe_history=True)

        @room.on("participant_disconnected")
        def on_p_disc(participant: rtc.RemoteParticipant):
            if not participant.identity.startswith("ai_examiner"):
                self.greeted_participants.discard(participant.identity)
                if self.is_configured and len(self.conversation_history) > 1 and not self.exam_completed:
                    # Accidental disconnect or reload: Start 90s grace window and pause clock
                    print(f"[{self.room_name}] Candidate disconnected during active defense. Pausing exam with 90s grace window.", flush=True)
                    self.stop_current_speech()
                    self.is_reconnecting = True
                    self.candidate_disconnected_time = time.time()
                    if self.exam_start_time:
                        self.paused_elapsed_s = time.time() - self.exam_start_time
                else:
                    print(f"[{self.room_name}] Candidate left unconfigured chamber: {participant.identity}. Destroying session.", flush=True)
                    asyncio.create_task(self.stop_candidate_egress())
                    self.reset_exam_session(preserve_greeting=False, wipe_history=True)

        @room.on("data_received")
        def on_data(dp: rtc.DataPacket):
            try:
                payload = json.loads(dp.data.decode("utf-8"))
                m_type = payload.get("type")
                print(f"[{self.room_name} DATA RECEIVED]: {m_type}", flush=True)
                if m_type == "leave_chamber":
                    print(f"[{self.room_name}] Received explicit leave_chamber signal. Destroying session 100%.", flush=True)
                    asyncio.create_task(self.stop_candidate_egress())
                    self.is_reconnecting = False
                    self.candidate_disconnected_time = None
                    self.reset_exam_session(preserve_greeting=False, wipe_history=True)
                elif m_type in ("interrupt", "conclude_defense"):
                    print(f"[{self.room_name} DATA RECEIVED]: {m_type}. Halting speech immediately.", flush=True)
                    self.stop_current_speech()
                    if m_type == "conclude_defense":
                        self.exam_completed = True
                        self.is_agent_thinking = False
                        self.is_examiner_speaking = False
                        if self.shadow_wav_file:
                            try:
                                self.shadow_wav_file.close()
                                print(f"[{self.room_name}] Shadow WAV file cleanly sealed on conclude: {self.shadow_wav_path}", flush=True)
                            except Exception as e:
                                print(f"[{self.room_name} SHADOW CLOSE ERROR]: {e}", flush=True)
                            self.shadow_wav_file = None
                        asyncio.create_task(self.stop_candidate_egress())
                elif m_type == "trigger_greeting":
                    if self.exam_completed:
                        return
                    self.session_id = payload.get("session_id", "").strip() or self.session_id
                    st_id = payload.get("student_id", "").strip()
                    if st_id:
                        self.candidate_identity = f"candidate_{st_id}"
                    course_title = payload.get("course_title", "").strip() or self.session_config.get("course_title", "")
                    self.course_title = course_title
                    syllabus_topics = payload.get("syllabus_topics", [])
                    syllabus_items = payload.get("syllabus_items", [])
                    if course_title:
                        self.stt_prompt = f"Oral defense on {course_title}. Technical academic transcription."
                    if not self.is_configured or not self.conversation_history:
                        sys_prompt = payload.get("system_prompt")
                        if sys_prompt:
                            print(f"[{self.room_name}] Configuring session via trigger_greeting payload.", flush=True)
                            self.conversation_history = [{"role": "system", "content": sys_prompt}]
                            self.is_configured = True
                            self.session_config = {"course_title": course_title}
                        else:
                            print(f"[{self.room_name} ERROR]: trigger_greeting rejected because session is unconfigured.", flush=True)
                            return

                    # Ensure conductor is initialized if not already
                    if self.conductor is None:
                        try:
                            if syllabus_items and len(syllabus_items) > 0:
                                syllabus = UniversalSyllabus(syllabus_items, course_title=course_title)
                            elif syllabus_topics and len(syllabus_topics) > 0:
                                syllabus = UniversalSyllabus(syllabus_topics, course_title=course_title)
                            else:
                                syllabus = UniversalSyllabus([f"Core Foundations of {course_title or 'the Subject'}"], course_title=course_title)
                            self.conductor = SocraticConductor(syllabus, vllm_url=VLLM_URL, model=VLLM_MODEL)
                            self.conductor.unasked_nodes = list(self.conductor.syllabus.nodes)
                            self.conductor.asked_nodes = []
                            self.conductor.active_node = None
                            self.active_question = self.conductor.get_initial_question()
                            print(f"[{self.room_name} CONDUCTOR INIT via trigger_greeting] Loaded {len(self.conductor.syllabus.nodes)} topics for '{course_title}'", flush=True)
                        except Exception as c_err:
                            print(f"[{self.room_name} CONDUCTOR INIT via trigger_greeting ERROR]: {c_err}", flush=True)

                    self.stop_current_speech()
                    self.has_greeted = False
                    self.cancel_event.clear()
                    if self.room:
                        conf_ack = json.dumps({"type": "session_configured", "status": "ok"}).encode()
                        asyncio.create_task(self.room.local_participant.publish_data(conf_ack, reliable=True))
                    self.active_speech_task = asyncio.create_task(self.start_greeting(course_title=course_title))
                elif m_type == "agent_prompt":
                    if not self.is_configured or self.exam_completed:
                        print(f"[{self.room_name} ERROR]: agent_prompt ignored because session is unconfigured or completed.", flush=True)
                        return
                    text = payload.get("text", "").strip()
                    if text:
                        self.floor_opened_time = 0.0
                        self.dead_air_tier = 0
                        self.dispatch_candidate_turn(text)
                elif m_type == "configure_session":
                    # Check if candidate is reconnecting to an ongoing active defense
                    is_reconnect = payload.get("is_reconnect", False)
                    if (is_reconnect or self.is_reconnecting) and self.is_configured and len(self.conversation_history) > 1 and not self.exam_completed:
                        print(f"[{self.room_name}] Reconnection configure_session verified. Resuming without restart.", flush=True)
                        self.is_reconnecting = False
                        if self.candidate_disconnected_time and self.exam_start_time:
                            self.exam_start_time += (time.time() - self.candidate_disconnected_time)
                        self.candidate_disconnected_time = None
                        self.reconcile_audio_tracks()
                        if self.room:
                            res_pkt = json.dumps({
                                "type": "session_resumed",
                                "status": "ok",
                                "room": self.room_name,
                                "elapsed_s": int(time.time() - self.exam_start_time) if self.exam_start_time else 0,
                                "target_duration_s": self.target_duration_s,
                                "course_title": self.session_config.get("course_title", ""),
                                "history": [
                                    m for m in self.conversation_history
                                    if m.get("role") in ("assistant", "user")
                                    and not str(m.get("content", "")).startswith("[SYSTEM")
                                    and not str(m.get("content", "")).startswith("[The candidate has entered")
                                ]
                            }).encode()
                            asyncio.create_task(self.room.local_participant.publish_data(res_pkt, reliable=True))
                        return

                    # 100% clean slate: purge existing residue while keeping active audio transport alive
                    self.reset_exam_session(preserve_greeting=False, wipe_history=True, preserve_audio=True, is_reconnect=is_reconnect)
                    self.reconcile_audio_tracks()

                    cfg_sid = payload.get("session_id", "").strip()
                    if cfg_sid:
                        self.session_id = cfg_sid
                        print(f"[{self.room_name}] Bound session_id '{self.session_id}' from configure_session.", flush=True)
                    st_id = payload.get("student_id", "").strip()
                    if st_id:
                        self.candidate_identity = f"candidate_{st_id}"
                    sys_prompt = payload.get("system_prompt")
                    course_title = payload.get("course_title", "").strip()
                    if not sys_prompt or not sys_prompt.strip():
                        print(f"[{self.room_name} ERROR]: configure_session missing system_prompt! Zero-fallback policy in effect.", flush=True)
                        if self.room:
                            err_pkt = json.dumps({"type": "session_error", "error": "Missing system prompt. ZERO FALLBACK policy in effect."}).encode()
                            asyncio.create_task(self.room.local_participant.publish_data(err_pkt, reliable=True))
                        return

                    self.session_config = {"course_title": course_title}
                    enhanced_prompt = sys_prompt.strip()
                    audio_modality_header = (
                        "[MODALITY: REAL-TIME SPOKEN AUDIO VIA SPEECH SYNTHESIS]\n"
                        "You are speaking live into the candidate's headphones across an oral examination table.\n"
                        "1. TELEPROMPTER CADENCE: Output strictly plain, continuous spoken prose. Express formulas and symbols as natural spoken words (e.g. 'scaled quadratically', 'patch size').\n"
                        "2. PUNCTUATION INVARIANT: Your entire response must contain EXACTLY ONE question mark. Never ask compound, multi-clause, or two-in-one questions.\n"
                        "3. CONCISE BREVITY: Keep your entire response under 35 words (1 to 2 short sentences). Never lecture, explain the answer yourself, or monologue.\n"
                        "4. SOCRATIC SCAFFOLDING: Acknowledge partial candidate insights constructively before asking the next targeted question.\n\n"
                    )
                    if "[MODALITY: REAL-TIME SPOKEN AUDIO VIA SPEECH SYNTHESIS]" not in enhanced_prompt and "[CRITICAL SYSTEM MODALITY" not in enhanced_prompt:
                        enhanced_prompt = audio_modality_header + enhanced_prompt

                    if "CRITICAL CONVERSATIONAL INVARIANTS" not in enhanced_prompt:
                        enhanced_prompt += (
                            "\n\nCRITICAL CONVERSATIONAL INVARIANTS:\n"
                            "1. EXACTLY ONE QUESTION MARK: Every turn must ask precisely one question. Do not join questions with 'and also'.\n"
                            "2. SOCRATIC GUIDANCE OVER BLUNT REJECTION: Never dismiss the candidate. If they touch on a relevant concept, validate their partial intuition ('You have the right intuition regarding clustering, but...'), then ask a targeted question pushing toward the exact mechanism.\n"
                            "3. CONSTRUCTIVE NUDGING: If the candidate is off-course, frame your response as a scaffold to guide them back to the syllabus.\n"
                            "4. ZERO ECHO / NO PARROTING: Do not repeat their words back to them. Seamlessly transition from brief acknowledgment directly into your guiding question.\n"
                            "5. TELEPROMPTER PROSE: Plain alphanumeric text only. Zero markdown, zero bullet points.\n"
                            "6. ZERO REPETITION & NO SCRIPTED CRUTCHES: Never repeat canned phrases (such as 'I am assessing your knowledge' or 'Understood'). Invent fresh, original dialogue.\n"
                            "7. DYNAMIC CLAP BACKS & ANTI-ROLE-REVERSAL: You are strictly the Lead Examiner. If the candidate asks you to define or explain the concept, or parrots your question back, NEVER answer it. CLAP BACK with sharp, spontaneous academic authority and demand their answer.\n"
                            "8. CANDIDATE CLARIFICATION: The candidate may only ask brief clarification on your question's premise. NEVER give away the answer or explain the core mechanism yourself.\n"
                            "9. HANDLING SKIP REQUESTS: If the candidate asks to skip or says 'move on', do NOT immediately surrender. Encourage them to try by giving a brief intuitive hint. If they still cannot answer, transition firmly to the next topic.\n"
                            "10. FORBIDDEN OPENERS: NEVER begin a turn with 'Understood', 'Certainly', 'Sure', 'Of course', 'I appreciate', 'Feel free to', or 'Any more questions'.\n"
                        )
                    self.conversation_history = [{"role": "system", "content": enhanced_prompt}]
                    self.is_configured = True
                    course_title = payload.get("course_title", "").strip()
                    self.course_title = course_title
                    syllabus_topics = payload.get("syllabus_topics", [])
                    syllabus_items = payload.get("syllabus_items", [])
                    self.stt_prompt = f"Oral defense on {course_title or 'academic viva'}. Technical academic transcription."

                    # Check for preset syllabus file matching course title
                    preset_path = None
                    ct_lower = course_title.lower()
                    if "dinov3" in ct_lower:
                        preset_path = "/dev/shm/savan_openviva/syllabus_dinov3.json"
                        if not os.path.exists(preset_path):
                            preset_path = "storage/legacy_json_backup/exam_dinov3_scaling_self_supervised.json"
                    elif "dinov2" in ct_lower:
                        preset_path = "/dev/shm/savan_openviva/syllabus_dinov2.json"
                        if not os.path.exists(preset_path):
                            preset_path = "storage/legacy_json_backup/exam_dinov2_robust_visual_features.json"
                    elif "dit" in ct_lower or "diffusion" in ct_lower:
                        preset_path = "/dev/shm/savan_openviva/syllabus_dit.json"
                        if not os.path.exists(preset_path):
                            preset_path = "storage/legacy_json_backup/exam_dit_diffusion_transformers.json"

                    try:
                        if syllabus_items and len(syllabus_items) > 0:
                            print(f"[{self.room_name} CONDUCTOR INIT] Using {len(syllabus_items)} syllabus_items for '{course_title}'", flush=True)
                            syllabus = UniversalSyllabus(syllabus_items, course_title=course_title)
                        elif preset_path and os.path.exists(preset_path):
                            print(f"[{self.room_name} CONDUCTOR INIT] Using preset syllabus file: {preset_path}", flush=True)
                            syllabus = UniversalSyllabus(preset_path, course_title=course_title)
                        elif syllabus_topics and len(syllabus_topics) > 0:
                            print(f"[{self.room_name} CONDUCTOR INIT] Using {len(syllabus_topics)} syllabus_topics for '{course_title}'", flush=True)
                            syllabus = UniversalSyllabus(syllabus_topics, course_title=course_title)
                        else:
                            print(f"[{self.room_name} CONDUCTOR INIT] Generating standalone syllabus node for '{course_title}'", flush=True)
                            syllabus = UniversalSyllabus([f"Core Architecture and Foundations of {course_title or 'the Subject'}"], course_title=course_title)

                        self.conductor = SocraticConductor(syllabus, vllm_url=VLLM_URL, model=VLLM_MODEL)
                        self.conductor.unasked_nodes = list(self.conductor.syllabus.nodes)
                        self.conductor.asked_nodes = []
                        self.conductor.active_node = None
                        self.active_question = self.conductor.get_initial_question()
                        print(f"[{self.room_name} CONDUCTOR INIT] Successfully loaded {len(self.conductor.syllabus.nodes)} syllabus topics for '{course_title}'. Initial Q: {self.active_question}", flush=True)
                    except Exception as cond_err:
                        print(f"[{self.room_name} CONDUCTOR INIT ERROR]: {cond_err}", flush=True)
                    dur = payload.get("duration_minutes")
                    if dur:
                        self.target_duration_s = int(dur) * 60

                    # 1. Immediately acknowledge configuration to UI
                    if self.room:
                        conf_ack = json.dumps({"type": "session_configured", "status": "ok"}).encode()
                        asyncio.create_task(self.room.local_participant.publish_data(conf_ack, reliable=True))

                    # 2. Launch dynamic opening examiner greeting via LLM
                    self.active_speech_task = asyncio.create_task(self.start_greeting(course_title=course_title))
            except Exception as e:
                print(f"[{self.room_name} DATA ERROR]: {type(e).__name__} - {e}", flush=True)
                traceback.print_exc()

        await room.connect(LIVEKIT_URL, token)
        options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
        await room.local_participant.publish_track(self.audio_track, options)
        print(f"[ONLINE] Examiner joined room '{self.room_name}'!", flush=True)

        for p in room.remote_participants.values():
            if not p.identity.startswith("ai_examiner"):
                print(f"[{self.room_name}] Remote candidate already present: {p.identity}. Subscribing audio tracks. Requesting session configuration.", flush=True)
                for pub in p.track_publications.values():
                    if pub.track and pub.track.kind == rtc.TrackKind.KIND_AUDIO:
                        asyncio.create_task(self.start_candidate_egress(pub.track, p))
                        asyncio.create_task(self.process_audio(pub.track, p))
                ready_pkt = json.dumps({"type": "examiner_ready_for_config", "room": self.room_name}).encode()
                asyncio.create_task(self.room.local_participant.publish_data(ready_pkt, reliable=True))

        await self.broadcast_status("listening", "Examiner is online — candidate may speak.")
        self.dead_air_task = asyncio.create_task(self.dead_air_watchdog_loop())

    async def dead_air_watchdog_loop(self):
        """State-aware 3-tier dead-air silence watchdog for candidate inactivity."""
        while self.room and self.room.connection_state == rtc.ConnectionState.CONN_CONNECTED:
            try:
                await asyncio.sleep(1.0)
                now = time.time()
                if (
                    self.exam_completed
                    or self.is_reconnecting
                    or not self.is_configured
                    or not self.has_greeted
                    or self.is_examiner_speaking
                    or self.is_agent_thinking
                    or bool(self.pending_candidate_text)
                    or self.floor_opened_time == 0.0
                    or self.is_candidate_speaking
                    or (now - self.last_candidate_speech_time < 5.0)
                ):
                    if self.is_candidate_speaking or (now - self.last_candidate_speech_time < 5.0):
                        self.floor_opened_time = now
                    continue

                # Hardware/Transport integrity guard: If WebRTC audio frames stopped arriving, auto-reconcile
                if self.last_audio_frame_time > 0 and (now - self.last_audio_frame_time >= 4.0):
                    self.reconcile_audio_tracks()
                    continue

                silence_duration = now - self.floor_opened_time

                # TIER 1: Warm Encouragement & Offer of Help at 10 seconds
                if self.dead_air_tier == 0 and silence_duration >= 10.0:
                    self.dead_air_tier = 1
                    is_pre_exam = len([m for m in self.conversation_history if m.get("role") == "assistant"]) <= 1
                    record_flight_event("DEAD_AIR_WATCHDOG_TIER_1", {
                        "room": self.room_name,
                        "silence_duration": silence_duration,
                        "is_pre_exam": is_pre_exam
                    })
                    if is_pre_exam:
                        print(f"[{self.room_name} DEAD-AIR TIER 1] 10s pre-defense silence detected. Gently checking readiness...", flush=True)
                        asyncio.create_task(self.broadcast_telemetry("DEAD_AIR_TIER_1", "10s silence: Checking candidate readiness"))
                        nudge_directive = (
                            "[SYSTEM DIRECTIVE: The candidate has not yet responded to your greeting. "
                            "Warmly encourage them and let them know whenever they are ready we can begin in under 20 words: "
                            "e.g. 'Take your time. Whenever you are ready, please let me know and we will begin.']"
                        )
                    else:
                        print(f"[{self.room_name} DEAD-AIR TIER 1] 10s candidate silence detected. Triggering warm encouragement and offer of help...", flush=True)
                        asyncio.create_task(self.broadcast_telemetry("DEAD_AIR_TIER_1", "10s silence: Encouragement & offer of help"))
                        nudge_directive = (
                            "[SYSTEM DIRECTIVE: The candidate has paused or stopped speaking for 10 seconds. "
                            "Warmly encourage them to share their thoughts, and ask if they would like a hint or any help with this question (in under 20 words). "
                            "e.g. 'Take your time—feel free to share your thoughts, or let me know if you would like a hint.']"
                        )
                    self.dispatch_candidate_turn(nudge_directive, is_system_nudge=True)

                # TIER 2: Scaffold / Helpful Hint at 12s after Tier 1 (22s cumulative silence)
                elif self.dead_air_tier == 1 and silence_duration >= 12.0:
                    self.dead_air_tier = 2
                    record_flight_event("DEAD_AIR_WATCHDOG_TIER_2", {
                        "room": self.room_name,
                        "silence_duration": silence_duration
                    })
                    print(f"[{self.room_name} DEAD-AIR TIER 2] Continued silence detected. Offering helpful conceptual hint...", flush=True)
                    asyncio.create_task(self.broadcast_telemetry("DEAD_AIR_TIER_2", "22s silence: Helpful hint"))
                    hint_directive = (
                        "[SYSTEM DIRECTIVE: The candidate is still silent and may be stuck. "
                        "Provide a helpful conceptual hint or break the question down into a simpler step in under 20 words.]"
                    )
                    self.dispatch_candidate_turn(hint_directive, is_system_nudge=True)

                # TIER 3: Topic Progression at 20s after Tier 2 (50s cumulative silence)
                elif self.dead_air_tier == 2 and silence_duration >= 20.0:
                    self.dead_air_tier = 3
                    record_flight_event("DEAD_AIR_WATCHDOG_TIER_3", {
                        "room": self.room_name,
                        "silence_duration": silence_duration
                    })
                    print(f"[{self.room_name} DEAD-AIR TIER 3] Prolonged silence detected. Moving forward to next syllabus topic...", flush=True)
                    asyncio.create_task(self.broadcast_telemetry("DEAD_AIR_TIER_3", "50s silence: Advancing topic"))
                    advance_directive = (
                        "[SYSTEM DIRECTIVE: The candidate has been silent for a long time and cannot answer. "
                        "Say 'Let us move forward,' note the topic, and immediately ask a new question on the next syllabus section in under 25 words.]"
                    )
                    self.dispatch_candidate_turn(advance_directive, is_system_nudge=True)

                # TIER 4: Final AFK Warning at 10s after Tier 3
                elif self.dead_air_tier == 3 and silence_duration >= 10.0:
                    self.dead_air_tier = 4
                    record_flight_event("DEAD_AIR_WATCHDOG_TIER_4", {
                        "room": self.room_name,
                        "silence_duration": silence_duration
                    })
                    print(f"[{self.room_name} DEAD-AIR TIER 4] 10s silence after Tier 3. Issuing final AFK warning...", flush=True)
                    asyncio.create_task(self.broadcast_telemetry("DEAD_AIR_TIER_4", "10s silence: Final AFK warning"))
                    warning_directive = (
                        "[SYSTEM DIRECTIVE: The candidate has not answered. State firmly and concisely: "
                        "'If you do not respond within 10 seconds, this examination will conclude.' Do not say anything else.]"
                    )
                    self.dispatch_candidate_turn(warning_directive, is_system_nudge=True)

                # TIER 5: AFK Quit / Termination at 10s after Tier 4 Warning
                elif self.dead_air_tier == 4 and silence_duration >= 10.0:
                    self.dead_air_tier = 5
                    record_flight_event("DEAD_AIR_WATCHDOG_TIER_5", {
                        "room": self.room_name,
                        "silence_duration": silence_duration
                    })
                    print(f"[{self.room_name} DEAD-AIR TIER 5] Final 10s silence elapsed without response. Terminating examination session.", flush=True)
                    asyncio.create_task(self.broadcast_telemetry("DEAD_AIR_QUIT", "Candidate AFK: Concluding examination"))
                    asyncio.create_task(self.terminate_session_afk())

            except asyncio.CancelledError:
                break
            except Exception as e:
                print(f"[{self.room_name} DEAD-AIR WATCHDOG ERROR]: {e}", flush=True)


# =========================================================================
# MAIN ENTRYPOINT: SERVE ALL 5 DEDICATED CHAMBERS ON STACK 2
# =========================================================================

active_sessions: dict[str, ChamberSession] = {}

async def chamber_supervisor():
    """
    Continuous supervisor loop that monitors LiveKit for student candidates
    entering any of the 5 dedicated chambers (stack2-chamber-01 to stack2-chamber-05).
    Immediately attaches an isolated Stack 2 Examiner session to each occupied room.
    Releases and disconnects when the candidate leaves so the chamber becomes free again.
    """
    lk = api.LiveKitAPI(LIVEKIT_URL, API_KEY, API_SECRET)
    print("[SUPERVISOR] 5-Chamber Dedicated Supervisor active! Monitoring chambers 01 to 05 on Stack 2...", flush=True)
    empty_grace_counters: dict[str, int] = {}

    while True:
        try:
            res = await lk.room.list_rooms(api.ListRoomsRequest())
            live_rooms = {r.name: r for r in res.rooms}

            # 1. Discover newly occupied chambers
            for r_name, r in live_rooms.items():
                if r_name.startswith("stack2-chamber-") or r_name.startswith("openviva-"):
                    if r_name not in active_sessions:
                        try:
                            parts = await lk.room.list_participants(api.ListParticipantsRequest(room=r_name))
                            has_human = any(not p.identity.startswith("ai_examiner") for p in parts.participants)
                        except Exception:
                            has_human = r.num_participants > 0

                        if has_human:
                            print(f"[SUPERVISOR] Candidate joined '{r_name}' ({r.num_participants} participants)! Launching Universal EOU Examiner...", flush=True)
                            session = ChamberSession(r_name)
                            active_sessions[r_name] = session
                            empty_grace_counters[r_name] = 0
                            asyncio.create_task(session.connect_and_serve())

            # 2. Monitor active chambers and release when candidates depart
            for r_name in list(active_sessions.keys()):
                # Keep static baseline rooms alive
                if r_name in ["openviva-stack2-room", "openviva-exam-room", "openviva-stack3-room"]:
                    continue

                if r_name not in live_rooms:
                    session = active_sessions.get(r_name)
                    if session and session.is_configured and (session.has_greeted or session.is_reconnecting):
                        if session.candidate_disconnected_time is None:
                            session.candidate_disconnected_time = time.time()
                            session.is_reconnecting = True
                        disconnect_age = time.time() - session.candidate_disconnected_time
                        if disconnect_age < session.disconnect_grace_s:
                            # Retain active defense session during 90s grace window even if LiveKit sweeps empty room
                            continue
                        else:
                            print(f"[SUPERVISOR] 90s reconnection grace expired for active defense in '{r_name}'. Cleaning up session.", flush=True)

                    print(f"[SUPERVISOR] Chamber '{r_name}' no longer exists in LiveKit. Cleaning up session.", flush=True)
                    session = active_sessions.pop(r_name, None)
                    empty_grace_counters.pop(r_name, None)
                    if session:
                        if session.egress_id:
                            try:
                                await session.stop_candidate_egress()
                            except Exception:
                                pass
                        if session.room:
                            try:
                                await session.room.disconnect()
                            except Exception:
                                pass
                else:
                    try:
                        parts = await lk.room.list_participants(api.ListParticipantsRequest(room=r_name))
                        has_human = any(not p.identity.startswith("ai_examiner") for p in parts.participants)
                        if not has_human:
                            session = active_sessions.get(r_name)
                            # 90-second reconnection grace period for active viva defenses
                            if session and session.is_configured and (session.has_greeted or session.is_reconnecting):
                                if session.candidate_disconnected_time is None:
                                    session.candidate_disconnected_time = time.time()
                                    session.is_reconnecting = True
                                disconnect_age = time.time() - session.candidate_disconnected_time
                                if disconnect_age < session.disconnect_grace_s:
                                    # Still within 90-second grace window! Keep examiner in room waiting for candidate
                                    continue
                                else:
                                    print(f"[SUPERVISOR] 90s reconnection grace expired for active defense in '{r_name}'. Cleaning up session.", flush=True)

                            empty_grace_counters[r_name] = empty_grace_counters.get(r_name, 0) + 1
                            # Disconnect after 2 consecutive empty checks (~1.5s) for unconfigured rooms
                            if empty_grace_counters[r_name] >= 2:
                                print(f"[SUPERVISOR] Candidate left unconfigured chamber '{r_name}'. Disconnecting examiner to free chamber.", flush=True)
                                session = active_sessions.pop(r_name, None)
                                empty_grace_counters.pop(r_name, None)
                                if session:
                                    if session.egress_id:
                                        try:
                                            await session.stop_candidate_egress()
                                        except Exception:
                                            pass
                                    if session.room:
                                        try:
                                            await session.room.disconnect()
                                        except Exception:
                                            pass
                        else:
                            empty_grace_counters[r_name] = 0
                    except Exception as ex:
                        pass

        except Exception as e:
            print(f"[SUPERVISOR EXCEPTION]: {e}", flush=True)

        await asyncio.sleep(0.75)


async def main():
    print("\n==========================================================================", flush=True)
    print(" UNIVERSAL OPEN-VIVA EXAMINER STARTING (5-CHAMBER EOU ONNX ENGINE)", flush=True)
    print(" Serving 5 Dedicated Chambers with Unified 3-Stage Turn Decision Architecture", flush=True)
    print(" Zero-VRAM Clause Streamer Active Across All Rooms", flush=True)
    print("==========================================================================\n", flush=True)

    # Baseline rooms mapped to the Universal EOU ONNX Engine
    session_stack1 = ChamberSession("openviva-exam-room")
    session_stack2 = ChamberSession("openviva-stack2-room")
    session_stack3 = ChamberSession("openviva-stack3-room")

    active_sessions["openviva-exam-room"] = session_stack1
    active_sessions["openviva-stack2-room"] = session_stack2
    active_sessions["openviva-stack3-room"] = session_stack3

    await asyncio.gather(
        session_stack1.connect_and_serve(),
        session_stack2.connect_and_serve(),
        session_stack3.connect_and_serve()
    )

    print("\n>>> ALL ROOMS ACTIVE AND ARMED WITH UNIVERSAL EOU STACK! <<<", flush=True)

    # Launch dynamic supervisor for 5 dedicated chambers
    asyncio.create_task(chamber_supervisor())

    while True:
        await asyncio.sleep(1)


if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[SHUTDOWN] Universal Examiner stopped.", flush=True)

