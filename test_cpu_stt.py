
import time
from faster_whisper import WhisperModel

model_path = "/home/savan/openviva/models/whisper/base.en"
wav_path = "/home/savan/openviva/models/whisper/test_tone.wav"

print("Loading model on CPU with int8 precision (local_files_only=True)...")
start = time.time()
model = WhisperModel(model_path, device="cpu", compute_type="int8", local_files_only=True)
load_time = time.time() - start
print(f"Model loaded in {load_time:.3f}s")

print("Transcribing test audio...")
t0 = time.time()
segments, info = model.transcribe(wav_path, beam_size=1)
seg_list = list(segments)
transcribe_time = time.time() - t0

print(f"Transcription finished in {transcribe_time:.3f}s")
print(f"Detected language: {info.language}")
print(f"Segments: {len(seg_list)}")
print("OFFLINE SPEECH-TO-TEXT VERIFICATION SUCCEEDED!")

