import asyncio
import json
import time
from collections import deque
import numpy as np
import onnxruntime as ort
from livekit import api, rtc
from faster_whisper import WhisperModel
from kokoro_onnx import Kokoro

LIVEKIT_URL = "http://10.10.16.13:7880"
API_KEY = "devkey"
API_SECRET = "secret_openviva_key_2026_at_least_32_chars!"
ROOM_NAME = "openviva-exam-room"

WHISPER_PATH = "/home/savan/openviva/models/whisper/large-v3-turbo"
KOKORO_MODEL = "/home/savan/openviva/models/kokoro/kokoro-v1.0.onnx"
KOKORO_VOICES = "/home/savan/openviva/models/kokoro/voices-v1.0.bin"
VAD_MODEL = "/home/savan/openviva/models/vad/onnx/model.onnx"

EXAMINER_VOICE = "hm_omega"
STT_PROMPT = "Viva voce oral examination defense: computer science, software engineering, algorithms, technical definitions."

# 1. Load Silero VAD
print("Loading Silero VAD ONNX...")
vad_opts = ort.SessionOptions()
vad_opts.inter_op_num_threads = 1
vad_opts.intra_op_num_threads = 1
vad_session = ort.InferenceSession(VAD_MODEL, vad_opts, providers=["CPUExecutionProvider"])
print("Silero VAD loaded!")

# 2. Load Whisper on RTX 6000 Ada GPU
print("Loading Faster-Whisper Large-v3-Turbo on RTX 6000 Ada GPU (CUDA FP16)...")
stt_model = WhisperModel(WHISPER_PATH, device="cuda", compute_type="float16", local_files_only=True)
print("Faster-Whisper loaded on GPU!")

# 3. Load Kokoro TTS
print("Loading Kokoro-82M TTS...")
kokoro_tts = Kokoro(KOKORO_MODEL, KOKORO_VOICES)
print("Kokoro-82M TTS loaded!")

room_ref = None
audio_source = None
is_examiner_speaking = False
active_tracks = set()

async def speak_text(text: str):
    global room_ref, audio_source, is_examiner_speaking
    if not text.strip() or not room_ref or not audio_source:
        return
        
    is_examiner_speaking = True
    print(f"\n[TTS STREAM START] Synthesizing: '{text}' (Voice: {EXAMINER_VOICE})")
    
    transcript_pkt = json.dumps({"sender": "AI Examiner (Spoken)", "text": text}).encode()
    await room_ref.local_participant.publish_data(transcript_pkt, reliable=True)
    
    t0 = time.time()
    try:
        stream = kokoro_tts.create_stream(text, voice=EXAMINER_VOICE, speed=1.0, lang="en-us")
        CHUNK_SIZE = 480 # 20 ms at 24000 Hz
        total_chunks = 0
        
        async for chunk, sr in stream:
            if not is_examiner_speaking:
                print("[TTS INTERRUPTED] Student barged in, stopping playback.")
                break
                
            pcm_int16 = (np.clip(chunk, -1.0, 1.0) * 32767.0).astype(np.int16)
            for i in range(0, len(pcm_int16), CHUNK_SIZE):
                if not is_examiner_speaking:
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
                
        print(f"[TTS STREAM COMPLETE] Sent {total_chunks} frames in {time.time()-t0:.2f}s.")
    except Exception as e:
        print(f"Error during TTS streaming: {e}")
    finally:
        is_examiner_speaking = False

class CandidateVADTracker:
    def __init__(self):
        self.state = np.zeros((2, 1, 128), dtype=np.float32)
        self.sr = np.array(16000, dtype=np.int64)
        self.is_speaking = False
        self.speech_duration_ms = 0
        self.silence_duration_ms = 0
        
        # Calibrated for natural speech capture without clipping
        self.speech_threshold = 0.30  # SENSITIVE: easily catches conversational speech (0.30 vs 0.50)
        self.min_speech_ms = 120     # Quick start (120ms)
        self.min_silence_ms = 850    # Comfortable natural pause before finishing turn

    def process_512(self, chunk_pcm_float: np.ndarray):
        inputs = {
            vad_session.get_inputs()[0].name: chunk_pcm_float.reshape(1, -1),
            vad_session.get_inputs()[1].name: self.state,
            vad_session.get_inputs()[2].name: self.sr
        }
        out, self.state = vad_session.run(None, inputs)
        prob = float(out[0][0])
        chunk_ms = 32.0 # 512 / 16000 * 1000
        
        event = None
        if prob >= self.speech_threshold:
            self.speech_duration_ms += chunk_ms
            self.silence_duration_ms = 0
            if not self.is_speaking and self.speech_duration_ms >= self.min_speech_ms:
                self.is_speaking = True
                event = "SPEECH_START"
        else:
            if self.is_speaking:
                self.silence_duration_ms += chunk_ms
                if self.silence_duration_ms >= self.min_silence_ms:
                    self.is_speaking = False
                    event = "SPEECH_END"
                    self.speech_duration_ms = 0
                    self.silence_duration_ms = 0
            else:
                self.speech_duration_ms = 0

        is_barge_in = (prob >= 0.55 and self.speech_duration_ms >= self.min_speech_ms)
        return prob, event, is_barge_in

async def process_student_audio(track: rtc.RemoteAudioTrack, participant: rtc.RemoteParticipant, room: rtc.Room):
    global is_examiner_speaking, active_tracks
    if track.sid in active_tracks:
        return
    active_tracks.add(track.sid)
    print(f"Tracking student speech via Silero VAD (sensitive 0.30): {participant.identity} [{track.sid}]")
    
    audio_stream = rtc.AudioStream(track, sample_rate=16000, num_channels=1)
    vad_tracker = CandidateVADTracker()
    vad_sub_buffer = []
    
    # 300ms pre-roll buffer (10 slices of 512 = 320ms) to ensure words are NEVER cut off at start
    pre_roll_buffer = deque(maxlen=10)
    audio_turn_buffer = []
    
    try:
        async for event in audio_stream:
            frame = event.frame
            data = np.frombuffer(frame.data, dtype=np.int16).astype(np.float32) / 32768.0
            vad_sub_buffer.extend(data)
            
            while len(vad_sub_buffer) >= 512:
                slice_512 = np.array(vad_sub_buffer[:512], dtype=np.float32)
                vad_sub_buffer = vad_sub_buffer[512:]
                
                prob, vad_event, is_barge_in = vad_tracker.process_512(slice_512)
                
                # Barge-in
                if is_barge_in and is_examiner_speaking:
                    print(f"[BARGE-IN TRIGGERED] Candidate spoke during examiner output.")
                    is_examiner_speaking = False
                    
                if vad_event == "SPEECH_START":
                    # Prepend pre-roll buffer so starting syllables are never lost!
                    audio_turn_buffer = list(pre_roll_buffer)
                    audio_turn_buffer.append(slice_512)
                elif vad_tracker.is_speaking:
                    audio_turn_buffer.append(slice_512)
                else:
                    pre_roll_buffer.append(slice_512)
                    
                if vad_event == "SPEECH_END" and len(audio_turn_buffer) > 0:
                    full_turn_audio = np.concatenate(audio_turn_buffer)
                    audio_turn_buffer = []
                    
                    if len(full_turn_audio) >= 16000 * 0.4:
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
                                    repetition_penalty=1.2, # PREVENT REPETITION LOOPS
                                    no_speech_threshold=0.6,
                                    compression_ratio_threshold=2.4
                                )
                                t_text = " ".join([s.text.strip() for s in segments]).strip()
                                return t_text, time.time() - t_start
                                
                            text, elapsed = await loop.run_in_executor(None, run_transcribe)
                            
                            hallucination_phrases = ["thank you.", "thank you", "for more information", "subtitles"]
                            if text and not any(h in text.lower() and len(text) < 25 for h in hallucination_phrases):
                                print(f"\n[GPU TRANSCRIPT ({elapsed:.2f}s)] {participant.identity}: {text}")
                                payload = json.dumps({"sender": participant.identity or "Candidate", "text": text}).encode()
                                await room.local_participant.publish_data(payload, reliable=True)
                        except Exception as e:
                            print(f"Transcription error: {e}")
    finally:
        active_tracks.discard(track.sid)

async def main():
    global room_ref, audio_source
    print(f"Connecting to LiveKit room '{ROOM_NAME}' on {LIVEKIT_URL}...")
    
    token = api.AccessToken(API_KEY, API_SECRET) \
        .with_identity("ai_examiner") \
        .with_name("AI Examiner (Voice & STT)") \
        .with_grants(api.VideoGrants(room_join=True, room=ROOM_NAME, can_subscribe=True, can_publish=True, can_publish_data=True)) \
        .to_jwt()
        
    room = rtc.Room()
    room_ref = room
    
    audio_source = rtc.AudioSource(sample_rate=24000, num_channels=1, queue_size_ms=5000)
    audio_track = rtc.LocalAudioTrack.create_audio_track("examiner_voice", audio_source)
    
    @room.on("track_subscribed")
    def on_track_subscribed(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
        if track.kind == rtc.TrackKind.KIND_AUDIO and participant.identity != "ai_examiner":
            asyncio.create_task(process_student_audio(track, participant, room))
            
    @room.on("participant_connected")
    def on_participant_connected(participant: rtc.RemoteParticipant):
        print(f"Participant joined: {participant.identity}")
        
    @room.on("participant_disconnected")
    def on_participant_disconnected(participant: rtc.RemoteParticipant):
        print(f"Participant left: {participant.identity}")
        
    @room.on("data_received")
    def on_data_received(dp: rtc.DataPacket):
        try:
            payload = json.loads(dp.data.decode("utf-8"))
            if payload.get("type") == "tts_speak":
                text = payload.get("text", "")
                if text:
                    asyncio.create_task(speak_text(text))
        except Exception as e:
            print("Error parsing data packet:", e)

    await room.connect(LIVEKIT_URL, token)
    print(f"Connected to room '{ROOM_NAME}' as 'ai_examiner'!")
    
    options = rtc.TrackPublishOptions(source=rtc.TrackSource.SOURCE_MICROPHONE)
    publication = await room.local_participant.publish_track(audio_track, options)
    print(f"Published examiner audio track: {publication.sid}")
    
    for p in room.remote_participants.values():
        if p.identity != "ai_examiner":
            for pub in p.track_publications.values():
                if pub.track and pub.track.kind == rtc.TrackKind.KIND_AUDIO:
                    asyncio.create_task(process_student_audio(pub.track, p, room))
                    
    print("\nAI Examiner ready on RTX 6000 Ada with sensitive VAD (0.30) & pre-roll buffering!")
    while True:
        await asyncio.sleep(1)

if __name__ == "__main__":
    asyncio.run(main())
