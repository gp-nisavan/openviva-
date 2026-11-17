"""
Open-Viva Full Voice Agent Worker (Air-Gapped GPU Node)
Architecture:
- Inbound: LiveKit WebRTC AudioStream (resampled to 16kHz float32 mono via np.interp)
- VAD: Silero VAD ONNX (512-sample chunks / 32ms) with barge-in support
- STT: Faster-Whisper (Large-v3-Turbo) on GPU (CUDA FP16)
- Brain: vLLM (Meta-Llama-3.1-8B-Instruct) on localhost:8088
- TTS: Kokoro-82M ONNX (24kHz PCM chunks streamed to LiveKit AudioSource)
- Signaling: LiveKit DataChannel for live turn transcripts and session configuration
"""

import os
import sys
import json
import time
import asyncio
import numpy as np
from collections import deque
import aiohttp
import onnxruntime as ort
from faster_whisper import WhisperModel
import kokoro_onnx
from livekit import rtc, api

# =========================================================================
# CONFIGURATION & CONSTANTS
# =========================================================================
LIVEKIT_URL = "http://10.10.16.13:7880"
API_KEY = "devkey"
API_SECRET = "secret_openviva_key_2026_at_least_32_chars!"
ROOM_NAME = "openviva-exam-room"
VLLM_URL = "http://127.0.0.1:8088/v1/chat/completions"
VLLM_MODEL = "hugging-quants/Meta-Llama-3.1-8B-Instruct-AWQ-INT4"

WHISPER_MODEL_PATH = "/home/savan/openviva/models/whisper/large-v3-turbo"
VAD_MODEL_PATH = "/home/savan/openviva/models/vad/onnx/model.onnx"
KOKORO_MODEL_PATH = "/home/savan/openviva/models/kokoro/kokoro-v1.0.onnx"
KOKORO_VOICES_PATH = "/home/savan/openviva/models/kokoro/voices-v1.0.bin"
EXAMINER_VOICE = "bm_george"  # British male academic persona

# Fallback default Socratic prompt if none configured by UI
DEFAULT_SYSTEM_PROMPT = (
    "You are an elite, uncompromising Socratic Academic Examiner conducting a rigorous oral viva. "
    "Your objective is to evaluate the candidate's mastery, architectural depth, and truthfulness. "
    "RULES:\n"
    "1. Speak naturally as a human professor. Never use robotic phrases or conversational filler.\n"
    "2. Ask exactly ONE concise, probing, high-impact question per turn (under 30 words).\n"
    "3. Directly confront superficial answers, evasions, or hand-waving.\n"
    "4. When target examination budget is reached or candidate demonstrated mastery, conclude your turn with [EXAM_TERMINATED].\n"
    "5. Keep responses concise for natural low-latency voice synthesis."
)

STT_PROMPT = "Academic oral examination viva on computer systems, machine learning, and software engineering."
GREETING_MESSAGE = (
    "Good day. Welcome to your oral defense examination. I am your presiding academic examiner. "
    "To begin, please introduce yourself and summarize the core technical architecture of your work."
)

# Global session & pacing state
conversation_history = [{"role": "system", "content": DEFAULT_SYSTEM_PROMPT}]
is_agent_thinking = False
is_examiner_speaking = False
room_ref = None
audio_source = None
active_tracks = set()
greeted_participants = set()

# Pacing clock state
exam_start_time = None
target_duration_s = 600  # Default 10 minutes
has_asked_final_question = False
exam_completed = False

# =========================================================================
# INITIALIZE MODELS (SILERO, FASTER-WHISPER, KOKORO-TTS)
# =========================================================================
print("[INIT] Loading Silero VAD ONNX...")
vad_opts = ort.SessionOptions()
vad_opts.inter_op_num_threads = 1
vad_opts.intra_op_num_threads = 1
vad_opts.graph_optimization_level = ort.GraphOptimizationLevel.ORT_ENABLE_ALL
vad_session = ort.InferenceSession(VAD_MODEL_PATH, sess_options=vad_opts, providers=["CPUExecutionProvider"])
print("[INIT] Silero VAD loaded!")

print("[INIT] Loading Faster-Whisper Large-v3-Turbo on GPU (CUDA FP16)...")
stt_model = WhisperModel(
    WHISPER_MODEL_PATH,
    device="cuda",
    compute_type="float16",
    device_index=0,
    num_workers=1
)
print("[INIT] Faster-Whisper loaded on GPU!")

print("[INIT] Loading Kokoro-82M TTS...")
kokoro_tts = kokoro_onnx.Kokoro(KOKORO_MODEL_PATH, KOKORO_VOICES_PATH)
print("[INIT] Kokoro-82M TTS loaded!")

# GPU Pre-warmup
print("[WARMUP] Priming Faster-Whisper GPU kernels with synthetic silence...")
t_warm = time.time()
dummy_silence = np.zeros(16000 * 2, dtype=np.float32)
stt_model.transcribe(dummy_silence, beam_size=1, language="en", condition_on_previous_text=False)
print(f"[WARMUP] Faster-Whisper GPU primed in {time.time()-t_warm:.2f}s!")

# =========================================================================
# HELPER FUNCTIONS & PACING
# =========================================================================

async def broadcast_status(state: str, message: str = ""):
    """Broadcasts examiner status to UI: 'listening', 'thinking', 'speaking', 'concluded'."""
    global room_ref
    if room_ref:
        try:
            pkt = json.dumps({
                "type": "agent_status",
                "state": state,
                "message": message,
                "timestamp": time.time()
            }).encode()
            await room_ref.local_participant.publish_data(pkt, reliable=True)
        except Exception:
            pass

async def stream_audio_to_livekit(text: str, turn_id: str = None):
    """Synthesizes text in memory and streams PCM chunks to WebRTC track with interruption support."""
    global room_ref, audio_source, is_examiner_speaking
    if not text.strip() or not room_ref or not audio_source:
        return

    is_examiner_speaking = True
    await broadcast_status("speaking", "Examiner is speaking...")
    print(f"\n[TTS SPEAKING] '{text}'")

    t0 = time.time()
    was_interrupted = False
    words = text.split()
    try:
        stream = kokoro_tts.create_stream(text, voice=EXAMINER_VOICE, speed=1.0, lang="en-us")
        CHUNK_SIZE = 480  # 20ms at 24000 Hz
        total_chunks = 0

        async for chunk, sr in stream:
            if not is_examiner_speaking:
                print("[TTS INTERRUPTED] Candidate barged in, halting audio playback.")
                was_interrupted = True
                break

            pcm_int16 = (np.clip(chunk, -1.0, 1.0) * 32767.0).astype(np.int16)
            for i in range(0, len(pcm_int16), CHUNK_SIZE):
                if not is_examiner_speaking:
                    was_interrupted = True
                    break
                sub = pcm_int16[i:i + CHUNK_SIZE]
                if len(sub) < CHUNK_SIZE:
                    sub = np.pad(sub, (0, CHUNK_SIZE - len(sub)))
                frame = rtc.AudioFrame(
                    data=sub.tobytes(),
                    sample_rate=24000,
                    num_channels=1,
                    samples_per_channel=CHUNK_SIZE
                )
                await audio_source.capture_frame(frame)
                total_chunks += 1
                await asyncio.sleep(0.015)

        if was_interrupted:
            seconds_spoken = total_chunks * 0.02
            spoken_count = max(1, min(len(words), int(seconds_spoken * 2.8)))
            truncated_text = " ".join(words[:spoken_count]) + "..."
            print(f"[BARGE-IN TRUNCATION] Assistant speech truncated to: '{truncated_text}'")

            # Update LLM conversation history so examiner knows it was cut off mid-thought
            if conversation_history and conversation_history[-1]["role"] == "assistant":
                conversation_history[-1]["content"] = f"{truncated_text} [Candidate interrupted mid-sentence]"

            # Broadcast update to UI transcript
            if room_ref and turn_id:
                trunc_pkt = json.dumps({
                    "type": "turn_interrupted",
                    "id": turn_id,
                    "truncated_text": truncated_text,
                    "interrupted": True
                }).encode()
                asyncio.create_task(room_ref.local_participant.publish_data(trunc_pkt, reliable=True))
        else:
            print(f"[TTS FINISHED] Streamed {total_chunks} frames ({time.time()-t0:.2f}s).")
    except Exception as e:
        print(f"[TTS ERROR] {e}")
    finally:
        is_examiner_speaking = False
        await broadcast_status("listening", "Examiner is listening — candidate may speak.")

async def exam_clock_watchdog():
    """Hard-deadline watchdog: Enforces 0 seconds overtime. Shuts down exam at exact limit."""
    global exam_start_time, target_duration_s, exam_completed, room_ref
    print(f"[WATCHDOG STARTED] Enforcing hard deadline at {target_duration_s}s...")
    while not exam_completed:
        await asyncio.sleep(1)
        if exam_start_time and not exam_completed:
            elapsed = time.time() - exam_start_time
            if elapsed >= target_duration_s:
                print(f"[WATCHDOG] Hard cutoff reached ({elapsed:.1f}s >= {target_duration_s}s).")
                exam_completed = True
                await broadcast_status("concluded", "Examination time elapsed. Defense concluded.")
                closing_remark = "This concludes your oral defense examination. The committee will review your results."
                if room_ref:
                    pkt = json.dumps({
                        "id": f"turn_watchdog_{int(time.time()*1000)}",
                        "sender": "AI Examiner",
                        "text": f"{closing_remark} [EXAM_TERMINATED]",
                        "terminated": True
                    }).encode()
                    await room_ref.local_participant.publish_data(pkt, reliable=True)
                await stream_audio_to_livekit(closing_remark)
                break

has_greeted = False

async def start_system_greeting(custom_greeting: str = None):
    """Proactively initiates the oral examination conversation exactly once per session."""
    global room_ref, exam_start_time, target_duration_s, conversation_history
    global is_examiner_speaking, has_greeted

    if has_greeted or is_examiner_speaking:
        print("[GREETING SKIPPED] Examiner has already greeted or is currently speaking.")
        return

    has_greeted = True
    await asyncio.sleep(0.4)

    if exam_start_time is None:
        exam_start_time = time.time()
        print(f"\n[CLOCK STARTED] Oral defense session clock active at t=0s (Target: {target_duration_s}s / {target_duration_s//60}m).")
        asyncio.create_task(exam_clock_watchdog())

    greeting_text = custom_greeting or GREETING_MESSAGE
    turn_id = f"turn_greet_{int(time.time()*1000)}"

    print(f"\n[EXAMINER OPENING FIRST] Speaking opening probe: '{greeting_text}'")
    if room_ref:
        pkt = json.dumps({
            "id": turn_id,
            "sender": "AI Examiner",
            "text": greeting_text
        }).encode()
        try:
            await room_ref.local_participant.publish_data(pkt, reliable=True)
        except Exception as e:
            print("[GREETING PUBLISH ERROR]", e)

    conversation_history.append({"role": "assistant", "content": greeting_text})
    await stream_audio_to_livekit(greeting_text, turn_id=turn_id)

async def handle_agent_turn(candidate_text: str, is_filibuster: bool = False):
    """End-to-End Voice Agent pipeline with 4-stage backend clock pacing and termination enforcement."""
    global conversation_history, is_agent_thinking, room_ref
    global exam_start_time, target_duration_s, exam_completed, has_asked_final_question
    if is_agent_thinking or not candidate_text.strip() or exam_completed:
        return

    is_agent_thinking = True
    await broadcast_status("thinking", "Examiner is evaluating your answer...")
    try:
        now = time.time()
        if exam_start_time is None:
            exam_start_time = now
            asyncio.create_task(exam_clock_watchdog())

        elapsed_s = now - exam_start_time
        remaining_s = max(0, target_duration_s - elapsed_s)

        # 4-Stage Clock Signal Schedule
        stage2_threshold = target_duration_s * 0.80
        stage3_remaining = min(180, max(60, target_duration_s * 0.15))
        stage4_remaining = min(60, max(30, target_duration_s * 0.08))

        clock_directive = ""
        if is_filibuster:
            clock_directive += (
                "\n\n[SYSTEM DIRECTIVE (FILIBUSTER INTERRUPTED): The candidate spoke continuously for over 45 seconds without yielding or addressing the core question. "
                "You must INTERRUPT firmly: deliver an academic admonition ('Pardon the interruption. You are spending excessive time on preamble. State your direct answer to the pending question.') and re-anchor them directly.]"
            )
        elif remaining_s <= stage4_remaining or has_asked_final_question:
            clock_directive = (
                "\n\n[SYSTEM CLOCK DIRECTIVE: Final turn before hard cutoff. Do NOT ask any follow-up question. "
                "Conclude the defense immediately with your formal closing remark and append [EXAM_TERMINATED].]"
            )
        elif remaining_s <= stage3_remaining:
            clock_directive = (
                f"\n\n[SYSTEM CLOCK DIRECTIVE: {int(remaining_s)}s remaining before hard deadline. "
                "You MUST ask your final comprehensive synthesis question NOW. Do not open new topics.]"
            )
            has_asked_final_question = True
        elif elapsed_s >= stage2_threshold:
            clock_directive = (
                f"\n\n[SYSTEM CLOCK DIRECTIVE: {int(elapsed_s // 60)}m elapsed of {int(target_duration_s // 60)}m budget. "
                "If the candidate has demonstrated clear mastery across target domains, conclude the defense now with [EXAM_TERMINATED]. "
                "Otherwise, proceed to your next probe.]"
            )

        cand_lower = candidate_text.lower().strip().strip(".?!")
        if cand_lower in ["hello", "hi", "hey", "what", "can you hear me", "pardon"]:
            clock_directive += (
                "\n\n[SYSTEM DIRECTIVE: The candidate offered only a brief greeting or asked if you hear them. "
                "Confirm directly ('I hear you clearly.') and demand that they directly answer the pending question without deflection.]"
            )

        user_content = candidate_text + clock_directive
        conversation_history.append({"role": "user", "content": user_content})
        if len(conversation_history) > 15:
            conversation_history = [conversation_history[0]] + conversation_history[-10:]

        print(f"\n[LLM QUERY ({int(elapsed_s)}s/{int(target_duration_s)}s)] Sending turn to vLLM ({VLLM_MODEL})...")
        t_llm_start = time.time()
        full_reply = ""
        first_token_time = None

        payload = {
            "model": VLLM_MODEL,
            "messages": conversation_history,
            "temperature": 0.6,
            "max_tokens": 100,
            "stream": True
        }

        async with aiohttp.ClientSession() as session:
            async with session.post(VLLM_URL, json=payload, timeout=aiohttp.ClientTimeout(total=20)) as resp:
                if resp.status != 200:
                    err_txt = await resp.text()
                    print(f"[vLLM ERROR HTTP {resp.status}]: {err_txt}")
                else:
                    async for line in resp.content:
                        line_str = line.decode('utf-8', errors='ignore').strip()
                        if line_str.startswith("data: ") and line_str != "data: [DONE]":
                            try:
                                data = json.loads(line_str[6:])
                                delta = data["choices"][0]["delta"].get("content", "")
                                if delta:
                                    if first_token_time is None:
                                        first_token_time = time.time()
                                    full_reply += delta
                            except Exception:
                                pass

        clean_reply = full_reply.strip()
        silence_tokens = ["[silence]", "(silence)", "[pause]", "(pause)", "silence", "...", "[no speech]"]
        if clean_reply.lower() in silence_tokens or not clean_reply:
            print("[LLM SILENCE/EMPTY] Replacing with academic voice probe.")
            clean_reply = "I am listening. Please present your defense and answer the pending question directly."

        print(f"[LLM REPLY ({(time.time()-t_llm_start):.2f}s)]: {clean_reply}")

        if clean_reply:
            is_terminated = "[EXAM_TERMINATED]" in clean_reply
            if is_terminated:
                exam_completed = True
                print(f"[EXAM FINISHED] Examiner concluded at {int(elapsed_s)}s (under {int(target_duration_s)}s limit).")

            conversation_history.append({"role": "assistant", "content": clean_reply})

            # Strip termination tag for Kokoro speech
            spoken_text = clean_reply.replace("[EXAM_TERMINATED]", "").strip()

            turn_id = f"turn_examiner_{int(time.time()*1000)}"
            if room_ref:
                pkt = json.dumps({
                    "id": turn_id,
                    "sender": "AI Examiner",
                    "text": clean_reply,
                    "terminated": is_terminated
                }).encode()
                await room_ref.local_participant.publish_data(pkt, reliable=True)

            if is_terminated:
                await broadcast_status("concluded", "Examination complete. Committee evaluation under review.")
                await stream_audio_to_livekit(spoken_text, turn_id=turn_id)
                print("[EXAM LOCKED] Final remark streamed. Oral defense complete.")
                return

            await stream_audio_to_livekit(spoken_text, turn_id=turn_id)

    except Exception as e:
        print(f"[AGENT ERROR] Error during agent turn: {e}")
        await broadcast_status("listening", "Examiner is listening — candidate may speak.")
    finally:
        is_agent_thinking = False

# =========================================================================
# VAD & AUDIO INGESTION PIPELINE
# =========================================================================

class CandidateVADTracker:
    def __init__(self):
        self.state = np.zeros((2, 1, 128), dtype=np.float32)
        self.sr = np.array(16000, dtype=np.int64)
        self.is_speaking = False
        self.speech_duration_ms = 0
        self.silence_duration_ms = 0

        # Calibrated VAD parameters:
        self.speech_threshold = 0.20
        self.min_speech_ms = 120
        self.min_silence_ms = 900  # 900ms silence window for natural, responsive turn transitions
        self.max_continuous_speech_ms = 45000

    def process_512(self, chunk_pcm_float: np.ndarray, is_examiner_speaking: bool = False):
        inputs = {
            vad_session.get_inputs()[0].name: chunk_pcm_float.reshape(1, -1),
            vad_session.get_inputs()[1].name: self.state,
            vad_session.get_inputs()[2].name: self.sr
        }
        out, self.state = vad_session.run(None, inputs)
        prob = float(out[0][0])
        chunk_ms = 32.0

        # Anti-Echo Protection: When examiner is speaking, require high confidence (>0.85) and sustained speech (>500ms)
        active_threshold = 0.85 if is_examiner_speaking else self.speech_threshold
        active_min_speech = 500 if is_examiner_speaking else self.min_speech_ms

        event = None
        if prob >= active_threshold:
            self.silence_duration_ms = 0
            self.speech_duration_ms += chunk_ms

            if not self.is_speaking and self.speech_duration_ms >= active_min_speech:
                self.is_speaking = True
                event = "speech_start"
            elif self.is_speaking and self.speech_duration_ms >= self.max_continuous_speech_ms:
                self.is_speaking = False
                self.speech_duration_ms = 0
                event = "filibuster_triggered"
        else:
            if self.is_speaking:
                self.silence_duration_ms += chunk_ms
                if self.silence_duration_ms >= self.min_silence_ms:
                    self.is_speaking = False
                    self.speech_duration_ms = 0
                    self.silence_duration_ms = 0
                    event = "speech_end"
            else:
                self.speech_duration_ms = 0

        return event, prob

async def process_student_audio(track: rtc.RemoteAudioTrack, participant: rtc.RemoteParticipant, room: rtc.Room):
    """Processes incoming student WebRTC stream: handles any sample rate (48k, 44.1k, 16k) and channels."""
    global is_examiner_speaking
    print(f"\n[AUDIO TRACK] Subscribed to candidate audio: {participant.identity} (Track: {track.sid})")
    active_tracks.add(track.sid)

    audio_stream = rtc.AudioStream(track)
    vad_tracker = CandidateVADTracker()

    ring_buffer_16k = deque(maxlen=16000 * 60)
    audio_accumulator_16k = []
    last_diag_log = 0

    try:
        async for event in audio_stream:
            frame = event.frame

            now_t = time.time()
            if now_t - last_diag_log > 6.0:
                last_diag_log = now_t
                print(f"[AUDIO STREAM] Receiving audio frames: rate={frame.sample_rate}Hz, channels={frame.num_channels}, samples_per_channel={frame.samples_per_channel}")

            # 1. Convert 16-bit PCM bytes to float32 normalized [-1.0, 1.0]
            raw_pcm = np.frombuffer(frame.data, dtype=np.int16).astype(np.float32) / 32768.0

            # 2. Downmix multi-channel to mono if stereo
            if frame.num_channels > 1:
                raw_pcm = raw_pcm.reshape(-1, frame.num_channels).mean(axis=1)

            # 3. Resample to 16000 Hz if not already 16000
            if frame.sample_rate != 16000:
                target_len = int(len(raw_pcm) * 16000 / frame.sample_rate)
                if target_len <= 0:
                    continue
                resampled = np.interp(
                    np.linspace(0, len(raw_pcm), target_len, endpoint=False),
                    np.arange(len(raw_pcm)),
                    raw_pcm
                )
            else:
                resampled = raw_pcm

            # 4. Feed resampled 16kHz audio to ring buffer and 512-sample VAD chunks
            for sample in resampled:
                ring_buffer_16k.append(sample)
                audio_accumulator_16k.append(sample)

                if len(audio_accumulator_16k) >= 512:
                    chunk_512 = np.array(audio_accumulator_16k[:512], dtype=np.float32)
                    audio_accumulator_16k = audio_accumulator_16k[512:]

                    vad_ev, prob = vad_tracker.process_512(chunk_512, is_examiner_speaking=is_examiner_speaking)

                    if vad_ev == "speech_start":
                        print(f"\n[VAD EVENT] Candidate voice detected (prob={prob:.2f})")

                    # Anti-Echo: While examiner speaks, flush candidate buffer so speaker audio never leaks into candidate turn
                    if is_examiner_speaking:
                        ring_buffer_16k.clear()

                    elif vad_ev in ("speech_end", "filibuster_triggered"):
                        is_filibuster = (vad_ev == "filibuster_triggered")
                        print(f"\n[VAD EVENT] Candidate turn complete ({'FILIBUSTER CUTOFF' if is_filibuster else 'natural pause'})")

                        full_turn_audio = np.array(list(ring_buffer_16k), dtype=np.float32)
                        ring_buffer_16k.clear()

                        if len(full_turn_audio) >= 16000 * 0.35:
                            try:
                                loop = asyncio.get_event_loop()
                                def run_transcribe():
                                    t_start = time.time()
                                    segments, _ = stt_model.transcribe(
                                        full_turn_audio,
                                        beam_size=1,
                                        vad_filter=False,
                                        language="en",
                                        initial_prompt=STT_PROMPT,
                                        condition_on_previous_text=False,
                                        repetition_penalty=1.2,
                                        no_speech_threshold=0.6,
                                        compression_ratio_threshold=2.4
                                    )
                                    t_text = " ".join([s.text.strip() for s in segments]).strip()
                                    return t_text, time.time() - t_start

                                text, elapsed = await loop.run_in_executor(None, run_transcribe)

                                hallucination_phrases = ["thank you.", "thank you", "for more information", "subtitles"]
                                if text and not any(h in text.lower() and len(text) < 25 for h in hallucination_phrases):
                                    print(f"\n[GPU STT ({elapsed:.2f}s)] {participant.identity}: {text}")
                                    turn_id = f"turn_student_{int(time.time()*1000)}"
                                    payload = json.dumps({
                                        "id": turn_id,
                                        "sender": "Candidate",
                                        "text": text
                                    }).encode()
                                    await room.local_participant.publish_data(payload, reliable=True)

                                    asyncio.create_task(handle_agent_turn(text, is_filibuster=is_filibuster))
                            except Exception as e:
                                print(f"[STT ERROR] Transcription failed: {e}")
    finally:
        active_tracks.discard(track.sid)

# =========================================================================
# MAIN WEBRTC EVENT LOOP
# =========================================================================

async def main():
    global room_ref, audio_source, greeted_participants
    print(f"\n[CONNECTING] LiveKit room '{ROOM_NAME}' on {LIVEKIT_URL}...")

    token = (
        api.AccessToken(API_KEY, API_SECRET)
        .with_identity("ai_examiner")
        .with_name("AI Examiner")
        .with_grants(api.VideoGrants(room_join=True, room=ROOM_NAME, can_subscribe=True, can_publish=True, can_publish_data=True))
        .to_jwt()
    )

    room = rtc.Room()
    room_ref = room

    audio_source = rtc.AudioSource(sample_rate=24000, num_channels=1, queue_size_ms=5000)
    audio_track = rtc.LocalAudioTrack.create_audio_track("examiner_voice", audio_source)

    @room.on("track_subscribed")
    def on_track_subscribed(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
        if track.kind == rtc.TrackKind.KIND_AUDIO and participant.identity != "ai_examiner":
            print(f"[EVENT track_subscribed] Candidate audio subscribed: {participant.identity}")
            asyncio.create_task(process_student_audio(track, participant, room))

    @room.on("participant_connected")
    def on_participant_connected(participant: rtc.RemoteParticipant):
        print(f"[EVENT participant_connected] Candidate joined: {participant.identity}")

    @room.on("participant_disconnected")
    def on_participant_disconnected(participant: rtc.RemoteParticipant):
        global has_greeted
        print(f"[EVENT participant_disconnected] Candidate left: {participant.identity}")
        greeted_participants.discard(participant.identity)
        has_greeted = False

    @room.on("data_received")
    def on_data_received(dp: rtc.DataPacket):
        global target_duration_s, exam_completed, has_asked_final_question, exam_start_time
        global is_agent_thinking, conversation_history, has_greeted
        try:
            payload = json.loads(dp.data.decode("utf-8"))
            msg_type = payload.get("type")

            if msg_type == "tts_speak":
                text = payload.get("text", "")
                if text:
                    asyncio.create_task(stream_audio_to_livekit(text))

            elif msg_type == "interrupt":
                global is_examiner_speaking
                print("[EVENT interrupt] Candidate requested immediate examiner halt.")
                is_examiner_speaking = False

            elif msg_type == "trigger_greeting":
                print("[EVENT trigger_greeting] Candidate manually requested examiner probe.")
                has_greeted = False
                asyncio.create_task(start_system_greeting())

            elif msg_type == "agent_prompt":
                # Typed candidate turn (immediate fallback / probe)
                text = payload.get("text", "").strip()
                if text:
                    print(f"\n[TYPED CANDIDATE TURN] '{text}'")
                    turn_id = f"turn_student_{int(time.time()*1000)}"
                    cand_pkt = json.dumps({
                        "id": turn_id,
                        "sender": "Candidate",
                        "text": text
                    }).encode()
                    if room_ref:
                        asyncio.create_task(room_ref.local_participant.publish_data(cand_pkt, reliable=True))
                    asyncio.create_task(handle_agent_turn(text))

            elif msg_type == "configure_session":
                # RESET STATE FOR FRESH EXAMINATION
                exam_completed = False
                has_asked_final_question = False
                exam_start_time = None
                is_agent_thinking = False
                greeted_participants.clear()

                dur = payload.get("duration_minutes")
                if dur:
                    target_duration_s = int(dur) * 60
                    print(f"[CONFIG] Exam target duration set to {dur} minutes ({target_duration_s}s)")

                sys_prompt = payload.get("system_prompt")
                course_title = payload.get("course_title", "").strip()
                if sys_prompt:
                    conversation_history = [{"role": "system", "content": sys_prompt}]
                    print(f"[CONFIG] Examiner system prompt updated ({len(sys_prompt)} chars)")

                # Acknowledge configuration to UI
                if room_ref:
                    ack = json.dumps({
                        "type": "session_configured",
                        "duration_minutes": dur or 10,
                        "course_title": course_title
                    }).encode()
                    asyncio.create_task(room_ref.local_participant.publish_data(ack, reliable=True))

                # Trigger single opening greeting with the exact course title
                if not has_greeted:
                    if course_title:
                        opening_greeting = f"Good day. Welcome to your oral defense examination in {course_title}. I am your presiding academic examiner. To begin, please introduce yourself and summarize your foundational technical contributions."
                    else:
                        opening_greeting = "Good day. Welcome to your oral defense examination. I am your presiding academic examiner. To begin, please introduce yourself and summarize the core technical architecture of your work."

                    print(f"[AUTO-GREET FIRST] Triggering opening probe: '{opening_greeting[:55]}...'")
                    asyncio.create_task(start_system_greeting(custom_greeting=opening_greeting))

        except Exception as e:
            print("[DATA ERROR]", e)

    # Connect to room
    await room.connect(LIVEKIT_URL, token)
    print(f"[CONNECTED] Joined room '{ROOM_NAME}' as 'ai_examiner'!")

    options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    publication = await room.local_participant.publish_track(audio_track, options)
    print(f"[TRACK PUBLISHED] Examiner audio track: {publication.sid}")

    # Check any already-present remote participants
    for p in room.remote_participants.values():
        if p.identity != "ai_examiner":
            for pub in p.track_publications.values():
                if pub.track and pub.track.kind == rtc.TrackKind.KIND_AUDIO:
                    asyncio.create_task(process_student_audio(pub.track, p, room))
            if p.identity not in greeted_participants:
                greeted_participants.add(p.identity)
                asyncio.create_task(start_system_greeting())

    await broadcast_status("listening", "Examiner is listening — candidate may speak.")

    print("\n==========================================================================")
    print(" 🎙️  OPEN-VIVA END-TO-END VOICE AGENT IS ACTIVE (UNIVERSAL RESAMPLING)  🎙️")
    print(" GPU Pre-Warmed | Universal 16kHz Ingest | AI Speaks First | Dual Transcripts")
    print("==========================================================================\n")

    while True:
        await asyncio.sleep(1)

if __name__ == "__main__":
    try:
        asyncio.run(main())
    except KeyboardInterrupt:
        print("\n[SHUTDOWN] Examiner stopped.")
