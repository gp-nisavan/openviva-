#!/usr/bin/env python3
"""
OpenViva Neural Diarization Pipeline (Task 4.2)
Zero external cloud reliance: Runs 100% offline on local GPU host.

Capabilities:
1. Speech Activity Detection & Segmentation using Silero ONNX VAD
   (/home/savan/openviva/models/vad/onnx/model.onnx).
2. AI Examiner Speech Masking:
   - Identifies and masks out time intervals where the AI Examiner (Kokoro TTS) was speaking
     (via session turn timestamps and/or Kokoro acoustic voice fingerprint matching).
3. Speaker Clustering & Centroid Computation:
   - Groups active speech segments into distinct speaker clusters (Candidate vs. Accomplice).
   - Computes 192-dimensional L2-normalized acoustic centroid embeddings for each cluster.
4. Generates a forensic diarization timeline with precise start/end timestamps and speech metrics.
"""

import os
import sys

_ROOT_DIR = "/home/savan/openviva"
if _ROOT_DIR not in sys.path:
    sys.path.insert(0, _ROOT_DIR)
_SCRIPTS_DIR = os.path.join(_ROOT_DIR, "scripts")
if _SCRIPTS_DIR not in sys.path:
    sys.path.insert(0, _SCRIPTS_DIR)
import math
import struct
from typing import List, Dict, Any, Optional, Tuple

import numpy as np

# Default model paths on GPU host
DEFAULT_VAD_MODEL = "/home/savan/openviva/models/vad/onnx/model.onnx"

def resample_to_16k(audio: np.ndarray, orig_sr: int) -> np.ndarray:
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
    """
    Computes 192-dimensional acoustic timbre & pitch representation (LTAS + delta spectrum).
    Standardized with scripts/extract_biometrics.py and scripts/audit_session_biometrics.py.
    """
    if len(audio.shape) > 1:
        audio = audio.mean(axis=1)

    if orig_sr != 16000:
        audio_16k = resample_to_16k(audio, orig_sr)
    else:
        audio_16k = audio.astype(np.float32)

    # Pre-emphasis filter: y[t] = x[t] - 0.97 * x[t-1]
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
            spec = np.abs(np.fft.rfft(frame * window)) # 257 bins (0 to 8000 Hz, 31.25 Hz/bin)
            log_spec = np.log10(spec + 1e-4)
            voiced_specs.append(log_spec)

    if not voiced_specs:
        for i in range(num_frames):
            start = i * hop_size
            frame = emphasized[start:start + frame_size]
            spec = np.abs(np.fft.rfft(frame * window))
            voiced_specs.append(np.log10(spec + 1e-4))

    mean_spec = np.mean(voiced_specs, axis=0) # shape (257,)

    # Focus on human vocal tract band: ~100 Hz to 6000 Hz (bins 3:195 -> 192 bins)
    band = mean_spec[3:195]
    if len(band) < 192:
        band = np.pad(band, (0, 192 - len(band)))
    else:
        band = band[:192]

    # Spectral derivative (captures formant transitions and pitch peaks)
    diff = np.diff(band, prepend=band[0])

    # 96 bins band + 96 bins derivative = exactly 192 dimensions
    feat = np.concatenate([band[:96] - np.mean(band[:96]), diff[:96] - np.mean(diff[:96])])

    norm = np.linalg.norm(feat)
    if norm > 0:
        feat = feat / norm
    return feat.astype(np.float32)

def cosine_similarity(v1: np.ndarray, v2: np.ndarray) -> float:
    n1 = np.linalg.norm(v1)
    n2 = np.linalg.norm(v2)
    if n1 == 0 or n2 == 0:
        return 0.0
    return float(np.dot(v1, v2) / (n1 * n2))

class SileroVADSegmenter:
    """Runs Silero ONNX VAD to detect precise speech segments in 16kHz audio."""
    def __init__(self, model_path: str = DEFAULT_VAD_MODEL):
        self.model_path = model_path
        self.session = None
        if os.path.exists(model_path):
            try:
                import onnxruntime as ort
                opts = ort.SessionOptions()
                opts.inter_op_num_threads = 1
                opts.intra_op_num_threads = 1
                self.session = ort.InferenceSession(model_path, sess_options=opts, providers=['CPUExecutionProvider'])
            except Exception as e:
                print(f"[SileroVAD] Warning: Could not initialize ONNX session: {e}", file=sys.stderr)

    def segment(
        self,
        audio_16k: np.ndarray,
        threshold: float = 0.50,
        min_speech_s: float = 0.30,
        min_silence_s: float = 0.35,
        max_segment_s: float = 2.0,
        hop_s: float = 1.0
    ) -> List[Tuple[float, float]]:
        """
        Returns list of (start_seconds, end_seconds) tuples for active speech.
        Long continuous speech blocks are subdivided into max_segment_s windows with hop_s
        to enable precise speaker diarization and turn-level masking.
        """
        raw_intervals = []
        if self.session is None:
            raw_intervals = self._energy_vad_segment(audio_16k, min_speech_s, min_silence_s)
        else:
            sr = np.array(16000, dtype=np.int64)
            state = np.zeros((2, 1, 128), dtype=np.float32)
            chunk_size = 512 # 32ms at 16kHz
            time_per_chunk = chunk_size / 16000.0
            num_chunks = len(audio_16k) // chunk_size

            is_speaking = False
            start_s = 0.0
            silence_accum_s = 0.0

            for i in range(num_chunks):
                chunk = audio_16k[i * chunk_size:(i + 1) * chunk_size].reshape(1, -1)
                t_curr = i * time_per_chunk

                out, state = self.session.run(None, {
                    "input": chunk,
                    "state": state,
                    "sr": sr
                })
                prob = float(out[0][0])

                if prob >= threshold:
                    if not is_speaking:
                        is_speaking = True
                        start_s = max(0.0, t_curr - 0.1)
                    silence_accum_s = 0.0
                else:
                    if is_speaking:
                        silence_accum_s += time_per_chunk
                        if silence_accum_s >= min_silence_s:
                            end_s = t_curr - silence_accum_s
                            if (end_s - start_s) >= min_speech_s:
                                raw_intervals.append((round(start_s, 3), round(end_s, 3)))
                            is_speaking = False
                            silence_accum_s = 0.0

            if is_speaking:
                end_s = len(audio_16k) / 16000.0
                if (end_s - start_s) >= min_speech_s:
                    raw_intervals.append((round(start_s, 3), round(end_s, 3)))

        # Subdivide long continuous segments into non-overlapping windows of up to max_segment_s
        speech_segments = []
        for st, en in raw_intervals:
            dur = en - st
            if dur <= max_segment_s:
                speech_segments.append((st, en))
            else:
                curr = st
                while curr < en:
                    sub_en = min(en, curr + max_segment_s)
                    if (sub_en - curr) >= min_speech_s:
                        speech_segments.append((round(curr, 3), round(sub_en, 3)))
                    curr += max_segment_s

        return speech_segments

    def _energy_vad_segment(self, audio_16k: np.ndarray, min_speech_s: float, min_silence_s: float) -> List[Tuple[float, float]]:
        chunk_size = 512
        num_chunks = len(audio_16k) // chunk_size
        time_per_chunk = chunk_size / 16000.0
        energy_thresh = 0.008

        speech_segments = []
        is_speaking = False
        start_s = 0.0
        silence_accum_s = 0.0

        for i in range(num_chunks):
            chunk = audio_16k[i * chunk_size:(i + 1) * chunk_size]
            rms = np.sqrt(np.mean(chunk ** 2))
            t_curr = i * time_per_chunk

            if rms >= energy_thresh:
                if not is_speaking:
                    is_speaking = True
                    start_s = max(0.0, t_curr - 0.1)
                silence_accum_s = 0.0
            else:
                if is_speaking:
                    silence_accum_s += time_per_chunk
                    if silence_accum_s >= min_silence_s:
                        end_s = t_curr - silence_accum_s
                        if (end_s - start_s) >= min_speech_s:
                            speech_segments.append((round(start_s, 3), round(end_s, 3)))
                        is_speaking = False
                        silence_accum_s = 0.0

        if is_speaking:
            end_s = len(audio_16k) / 16000.0
            if (end_s - start_s) >= min_speech_s:
                speech_segments.append((round(start_s, 3), round(end_s, 3)))

        return speech_segments

class NeuralDiarizer:
    """
    High-Performance Offline Neural Diarization Pipeline (Task 4.2).
    Features Silero VAD segmentation, AI Examiner speech masking, and acoustic centroid clustering.
    """
    def __init__(self, vad_model_path: str = DEFAULT_VAD_MODEL):
        self.vad_segmenter = SileroVADSegmenter(vad_model_path)

    def diarize(
        self,
        audio_data: np.ndarray,
        sample_rate: int,
        examiner_intervals: Optional[List[Tuple[float, float]]] = None,
        kokoro_examiner_embedding: Optional[np.ndarray] = None,
        reference_embedding: Optional[np.ndarray] = None,
        min_cluster_similarity: float = 0.40,
        min_secondary_duration_s: float = 1.0
    ) -> Dict[str, Any]:
        """
        Diarizes full audio recording into speaker intervals and clusters.

        Args:
            audio_data: 1D or 2D audio array.
            sample_rate: Input audio sample rate (e.g. 16000, 24000, 48000).
            examiner_intervals: Known time intervals (start_s, end_s) where AI Examiner spoke.
            kokoro_examiner_embedding: Optional 192-dim reference vector of AI Examiner voice for acoustic masking.
            reference_embedding: Optional 192-dim candidate reference embedding from SQLite student_biometrics.
            min_cluster_similarity: Cosine threshold above which segments belong to the candidate.

        Returns:
            Structured diarization dictionary with timeline, clusters, and masked statistics.
        """
        # 1. Resample to 16kHz
        if len(audio_data.shape) > 1:
            audio_data = audio_data.mean(axis=1)
        audio_16k = resample_to_16k(audio_data, sample_rate)
        total_audio_duration = len(audio_16k) / 16000.0

        examiner_intervals = examiner_intervals or []

        # 2. Extract active speech segments via Silero VAD
        raw_segments = self.vad_segmenter.segment(audio_16k)

        if not raw_segments:
            return {
                "totalAudioDurationSeconds": round(total_audio_duration, 2),
                "totalSpeechDurationSeconds": 0.0,
                "examinerMaskedDurationSeconds": 0.0,
                "candidateSpeechDurationSeconds": 0.0,
                "numHumanSpeakers": 0,
                "timeline": [],
                "clusters": []
            }

        # 3. Classify and mask AI Examiner speech
        classified_segments = []
        for start_s, end_s in raw_segments:
            dur = end_s - start_s
            start_idx = int(start_s * 16000)
            end_idx = int(end_s * 16000)
            segment_audio = audio_16k[start_idx:end_idx]
            vec = compute_acoustic_vector_192(segment_audio)

            # Check if this segment overlaps with known examiner intervals
            is_examiner_masked = False
            for ex_start, ex_end in examiner_intervals:
                overlap = max(0.0, min(end_s, ex_end) - max(start_s, ex_start))
                if overlap > 0.3 * dur:
                    is_examiner_masked = True
                    break

            # Acoustic examiner check (if reference Kokoro embedding provided)
            if not is_examiner_masked and kokoro_examiner_embedding is not None:
                sim_to_kokoro = cosine_similarity(vec, kokoro_examiner_embedding)
                if sim_to_kokoro >= 0.70:
                    is_examiner_masked = True

            classified_segments.append({
                "start": round(start_s, 3),
                "end": round(end_s, 3),
                "duration": round(dur, 3),
                "embedding": vec,
                "is_examiner_masked": is_examiner_masked
            })

        # 4. Separate masked AI speech from human candidate speech
        masked_duration = sum(s["duration"] for s in classified_segments if s["is_examiner_masked"])
        human_segments = [s for s in classified_segments if not s["is_examiner_masked"]]
        human_duration = sum(s["duration"] for s in human_segments)
        total_speech_duration = masked_duration + human_duration

        # 5. Cluster human speech segments into distinct speakers
        clusters_dict: Dict[int, List[Dict[str, Any]]] = {}

        if human_segments:
            if reference_embedding is not None:
                # Guided clustering anchored to candidate ground truth
                ref_norm = reference_embedding / (np.linalg.norm(reference_embedding) or 1.0)
                clusters_dict[0] = [] # Candidate
                clusters_dict[1] = [] # Accomplice / secondary

                for seg in human_segments:
                    sim = cosine_similarity(seg["embedding"], ref_norm)
                    seg["candidateSimilarity"] = round(sim, 4)
                    if sim >= min_cluster_similarity:
                        clusters_dict[0].append(seg)
                        seg["clusterId"] = 0
                    else:
                        clusters_dict[1].append(seg)
                        seg["clusterId"] = 1

                # Filter out short residual fragments (< min_secondary_duration_s)
                if 1 in clusters_dict and clusters_dict[1]:
                    sec_dur = sum(s["duration"] for s in clusters_dict[1])
                    if sec_dur < min_secondary_duration_s and 0 in clusters_dict:
                        clusters_dict[0].extend(clusters_dict[1])
                        for s in clusters_dict[1]:
                            s["clusterId"] = 0
                        del clusters_dict[1]

                # Clean up empty clusters
                if 1 in clusters_dict and not clusters_dict[1]:
                    del clusters_dict[1]
                if 0 in clusters_dict and not clusters_dict[0]:
                    del clusters_dict[0]
            else:
                # Unsupervised centroid clustering
                for seg in human_segments:
                    best_cluster_id = None
                    best_sim = -1.0

                    for c_id, c_segs in clusters_dict.items():
                        c_vecs = np.array([s["embedding"] for s in c_segs])
                        centroid = c_vecs.mean(axis=0)
                        centroid = centroid / (np.linalg.norm(centroid) or 1.0)
                        sim = cosine_similarity(seg["embedding"], centroid)

                        if sim > best_sim:
                            best_sim = sim
                            best_cluster_id = c_id

                    if best_sim >= min_cluster_similarity and best_cluster_id is not None:
                        clusters_dict[best_cluster_id].append(seg)
                        seg["clusterId"] = best_cluster_id
                    else:
                        new_id = len(clusters_dict)
                        clusters_dict[new_id] = [seg]
                        seg["clusterId"] = new_id

        # 6. Format Clusters Breakdown & Centroids
        clusters_report = []
        # Sort clusters by cumulative speech duration (Cluster 0 = Dominant Speaker)
        sorted_clusters = sorted(clusters_dict.items(), key=lambda item: sum(s["duration"] for s in item[1]), reverse=True)

        for rank, (orig_id, segs) in enumerate(sorted_clusters):
            c_dur = sum(s["duration"] for s in segs)
            c_vecs = np.array([s["embedding"] for s in segs])
            centroid = c_vecs.mean(axis=0)
            centroid = centroid / (np.linalg.norm(centroid) or 1.0)
            pct = (c_dur / (human_duration or 1.0)) * 100.0

            sim_to_ref = 0.0
            if reference_embedding is not None:
                sim_to_ref = cosine_similarity(centroid, reference_embedding)
                if rank == 0:
                    label = "Dominant Candidate"
                    classification = "AUTHENTIC_CANDIDATE" if sim_to_ref >= 0.65 else ("IMPOSTER_PROXY" if sim_to_ref < 0.50 else "BORDERLINE_CANDIDATE")
                else:
                    label = f"Secondary Speaker {rank}"
                    classification = "ANOMALOUS_OFF_CAMERA_SPEECH" if sim_to_ref < 0.45 else "CANDIDATE_SECONDARY_SEGMENT"
            else:
                label = "Dominant Candidate" if rank == 0 else f"Secondary Speaker {rank}"
                classification = "PRIMARY_CANDIDATE" if rank == 0 else "OFF_CAMERA_SPEECH"

            # Update segment labels with normalized rank
            for s in segs:
                s["speakerLabel"] = f"SPEAKER_{rank:02d}"

            clusters_report.append({
                "clusterId": rank,
                "speakerLabel": f"SPEAKER_{rank:02d}",
                "label": label,
                "classification": classification,
                "similarity": round(sim_to_ref, 4),
                "similarityToEnrolled": round(sim_to_ref, 4),
                "speechDurationSeconds": round(c_dur, 2),
                "speechPercentage": round(pct, 1),
                "segmentCount": len(segs),
                "centroidEmbedding": centroid.tolist()
            })

        # Add masked AI Examiner summary if present
        if masked_duration > 0:
            clusters_report.append({
                "clusterId": -1,
                "speakerLabel": "SPEAKER_AI_EXAMINER",
                "label": "AI Examiner (Kokoro TTS)",
                "classification": "MASKED_EXAMINER_SPEECH",
                "speechDurationSeconds": round(masked_duration, 2),
                "speechPercentage": round((masked_duration / total_speech_duration) * 100.0, 1),
                "segmentCount": len([s for s in classified_segments if s["is_examiner_masked"]]),
                "centroidEmbedding": None
            })

        # 7. Format Clean Timeline
        timeline = []
        for s in classified_segments:
            if s["is_examiner_masked"]:
                speaker = "SPEAKER_AI_EXAMINER"
            else:
                speaker = s.get("speakerLabel", "SPEAKER_00")

            timeline.append({
                "start": s["start"],
                "end": s["end"],
                "duration": s["duration"],
                "speaker": speaker,
                "isExaminerMasked": s["is_examiner_masked"]
            })

        return {
            "totalAudioDurationSeconds": round(total_audio_duration, 2),
            "totalSpeechDurationSeconds": round(total_speech_duration, 2),
            "examinerMaskedDurationSeconds": round(masked_duration, 2),
            "candidateSpeechDurationSeconds": round(human_duration, 2),
            "numHumanSpeakers": len(sorted_clusters),
            "timeline": timeline,
            "clusters": clusters_report
        }
