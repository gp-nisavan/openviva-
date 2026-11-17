import asyncio
import json
import time
import numpy as np
from livekit import api, rtc
from faster_whisper import WhisperModel

LIVEKIT_URL = "http://10.10.16.13:7880"
API_KEY = "devkey"
API_SECRET = "secret_openviva_key_2026_at_least_32_chars!"
ROOM_NAME = "openviva-exam-room"
MODEL_PATH = "/home/savan/openviva/models/whisper/large-v3-turbo"

INITIAL_PROMPT = "Viva voce oral examination defense: computer science, software engineering, algorithms, technical definitions."

print("Loading Faster-Whisper Large-v3-Turbo model...")
t0 = time.time()
model = WhisperModel(MODEL_PATH, device="cpu", compute_type="int8", local_files_only=True)
print(f"Large-v3-Turbo model loaded in {time.time()-t0:.2f}s!")

async def process_audio_stream(track: rtc.RemoteAudioTrack, participant: rtc.RemoteParticipant, room: rtc.Room):
    print(f"Started audio stream listener for {participant.identity}")
    audio_stream = rtc.AudioStream(track, sample_rate=16000, num_channels=1)
    
    buffer = []
    total_samples = 0
    SILENCE_THRESHOLD = 0.01
    silence_frames = 0
    speech_detected = False
    
    async for event in audio_stream:
        frame = event.frame
        # Convert audio frame to float32 normalized between -1.0 and 1.0
        data = np.frombuffer(frame.data, dtype=np.int16).astype(np.float32) / 32768.0
        buffer.append(data)
        total_samples += len(data)
        
        # Audio energy
        energy = np.mean(np.abs(data))
        if energy > SILENCE_THRESHOLD:
            speech_detected = True
            silence_frames = 0
        else:
            if speech_detected:
                silence_frames += 1
                
        # If we have speech and pause of ~1.2s, or buffer reached 5.0s
        if (speech_detected and silence_frames >= 20 and total_samples >= 16000 * 1.2) or total_samples >= 16000 * 5.0:
            full_audio = np.concatenate(buffer)
            buffer = []
            total_samples = 0
            speech_detected = False
            silence_frames = 0
            
            # Transcribe in executor to not block asyncio event loop
            try:
                loop = asyncio.get_event_loop()
                def run_transcribe():
                    t_start = time.time()
                    segments, _ = model.transcribe(
                        full_audio,
                        beam_size=1,
                        vad_filter=True,
                        language="en",
                        initial_prompt=INITIAL_PROMPT
                    )
                    text = " ".join([s.text.strip() for s in segments]).strip()
                    elapsed = time.time() - t_start
                    return text, elapsed
                
                text, elapsed = await loop.run_in_executor(None, run_transcribe)
                if text:
                    print(f"\n[TRANSCRIPT ({elapsed:.2f}s)] {participant.identity}: {text}")
                    payload = json.dumps({"sender": participant.identity or "Candidate", "text": text}).encode()
                    await room.local_participant.publish_data(payload, reliable=True)
            except Exception as e:
                print(f"Transcription error: {e}")

async def main():
    print(f"Connecting to room '{ROOM_NAME}' on {LIVEKIT_URL}...")
    token = api.AccessToken(API_KEY, API_SECRET) \
        .with_identity("stt_bridge_worker") \
        .with_name("AI Examiner STT (Large-v3-Turbo)") \
        .with_grants(api.VideoGrants(room_join=True, room=ROOM_NAME, can_subscribe=True, can_publish_data=True)) \
        .to_jwt()
        
    room = rtc.Room()
    
    @room.on("track_subscribed")
    def on_track_subscribed(track: rtc.Track, publication: rtc.RemoteTrackPublication, participant: rtc.RemoteParticipant):
        print(f"Track subscribed: {track.sid} (kind: {track.kind}) from {participant.identity}")
        if track.kind == rtc.TrackKind.KIND_AUDIO:
            asyncio.create_task(process_audio_stream(track, participant, room))
            
    @room.on("participant_connected")
    def on_participant_connected(participant: rtc.RemoteParticipant):
        print(f"Participant joined room: {participant.identity}")
        
    @room.on("participant_disconnected")
    def on_participant_disconnected(participant: rtc.RemoteParticipant):
        print(f"Participant left room: {participant.identity}")
        
    await room.connect(LIVEKIT_URL, token)
    print(f"Connected to LiveKit room '{ROOM_NAME}' as 'stt_bridge_worker'! Listening for audio...")
    
    # Check if participant already in room with tracks
    for participant in room.remote_participants.values():
        for publication in participant.track_publications.values():
            if publication.track and publication.track.kind == rtc.TrackKind.KIND_AUDIO:
                print(f"Found existing audio track for {participant.identity}")
                asyncio.create_task(process_audio_stream(publication.track, participant, room))
    
    while True:
        await asyncio.sleep(1)

if __name__ == "__main__":
    asyncio.run(main())
