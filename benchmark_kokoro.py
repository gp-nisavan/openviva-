import time
import os
import soundfile as sf
import numpy as np
from kokoro_onnx import Kokoro

model_path = "/home/savan/openviva/models/kokoro/kokoro-v1.0.onnx"
voices_path = "/home/savan/openviva/models/kokoro/voices-v1.0.bin"

print("Initializing Kokoro TTS...")
t0 = time.time()
kokoro = Kokoro(model_path, voices_path)
init_time = time.time() - t0
print(f"Kokoro initialized in {init_time:.2f}s!")

voices = kokoro.get_voices()
print(f"Total available voices: {len(voices)}")
print("Sample voices:", voices[:8])

test_text = "Good morning candidate. Please explain how your distributed consensus protocol handles Byzantine node failures."
selected_voice = "am_adam" if "am_adam" in voices else voices[0]
print(f"Synthesizing with voice: {selected_voice}")

t_start = time.time()
samples, sample_rate = kokoro.create(test_text, voice=selected_voice, speed=1.0, lang="en-us")
synth_time = time.time() - t_start

audio_duration = len(samples) / sample_rate
rtf = synth_time / audio_duration

print("=== Synthesis Benchmark Results ===")
print(f"Sample Rate: {sample_rate} Hz")
print(f"Audio Duration: {audio_duration:.2f} seconds")
print(f"Synthesis Time: {synth_time*1000:.1f} ms")
print(f"Real-Time Factor (RTF): {rtf:.3f}")

output_path = "/home/savan/openviva/test_tts.wav"
sf.write(output_path, samples, sample_rate)
print(f"Sample WAV saved to: {output_path} ({os.path.getsize(output_path)} bytes)")

print("Testing chunk streaming...")
t_stream_start = time.time()
stream = kokoro.create_stream(test_text, voice=selected_voice, speed=1.0, lang="en-us")
first_chunk_ms = None
count = 0
for chunk, sr in stream:
    if first_chunk_ms is None:
        first_chunk_ms = (time.time() - t_stream_start) * 1000
    count += 1

print(f"Stream yielded {count} chunks. First chunk latency: {first_chunk_ms:.1f} ms")
print("=== TASK 1.4 COMPLETE ===")
