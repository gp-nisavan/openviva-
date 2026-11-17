
import time
from faster_whisper import WhisperModel

target_dir = "/home/savan/openviva/models/whisper/large-v3-turbo"
print("Loading large-v3-turbo model offline...")
t0 = time.time()
model = WhisperModel(target_dir, device="cpu", compute_type="int8", local_files_only=True)
print(f"Model loaded successfully in {time.time()-t0:.2f}s!")

# Test synthetic audio transcription
import numpy as np
dummy_audio = np.zeros(16000 * 2, dtype=np.float32)
segments, info = model.transcribe(dummy_audio, beam_size=1, vad_filter=True, initial_prompt="Viva examination computer science.")
print("Transcribed dummy audio:", list(segments))
print("All systems verified for large-v3-turbo!")
