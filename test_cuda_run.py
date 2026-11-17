
import os
import glob
import time
import soundfile as sf
import numpy as np

# Find nvidia dynamic library directories
site_packages = "/home/savan/openviva/agent_env/lib/python3.10/site-packages"
nvidia_dirs = glob.glob(f"{site_packages}/nvidia/*/lib")
print("Found nvidia lib dirs:", nvidia_dirs)

ld_paths = ":".join(nvidia_dirs) + ":" + os.environ.get("LD_LIBRARY_PATH", "")
os.environ["LD_LIBRARY_PATH"] = ld_paths

from faster_whisper import WhisperModel

WHISPER_PATH = '/home/savan/openviva/models/whisper/large-v3-turbo'
print("Initializing Faster-Whisper on RTX 6000 Ada (CUDA FP16)...")
t0 = time.time()
model_gpu = WhisperModel(WHISPER_PATH, device="cuda", compute_type="float16", local_files_only=True)
print(f"Loaded on GPU in {time.time()-t0:.2f}s!")

audio, sr = sf.read('/home/savan/openviva/test_tts.wav')
num_samples_16k = int(len(audio) * 16000 / sr)
indices = np.linspace(0, len(audio) - 1, num_samples_16k).astype(int)
audio_16k = audio[indices].astype(np.float32)

t_infer = time.time()
segments, _ = model_gpu.transcribe(audio_16k, beam_size=1, vad_filter=False, language="en")
text = " ".join([s.text for s in segments])
elapsed = time.time() - t_infer
print(f"*** RTX 6000 Ada GPU Transcription Time: {elapsed*1000:.1f} ms! (Audio length: {len(audio_16k)/16000:.2f}s) ***")
print("Text:", text[:60])
print("=== GPU ACCELERATION FULLY VERIFIED ===")
