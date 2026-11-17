
import time
import soundfile as sf
import numpy as np
from faster_whisper import WhisperModel

audio, sr = sf.read('/home/savan/openviva/test_tts.wav')
num_samples_16k = int(len(audio) * 16000 / sr)
indices = np.linspace(0, len(audio) - 1, num_samples_16k).astype(int)
audio_16k = audio[indices].astype(np.float32)

WHISPER_PATH = '/home/savan/openviva/models/whisper/large-v3-turbo'

print("Testing Faster-Whisper on CUDA...")
try:
    model_gpu = WhisperModel(WHISPER_PATH, device="cuda", compute_type="float16", local_files_only=True)
    t0 = time.time()
    segments, _ = model_gpu.transcribe(audio_16k, beam_size=1, vad_filter=False, language="en")
    text = " ".join([s.text for s in segments])
    elapsed = time.time() - t0
    print(f"CUDA Inference: {elapsed*1000:.1f} ms! (Audio length: {len(audio_16k)/16000:.2f}s)")
    print("CUDA Whisper SUCCESS!")
except Exception as e:
    print("CUDA Whisper failed:", e)
