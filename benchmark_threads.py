
import time
import soundfile as sf
import numpy as np
from faster_whisper import WhisperModel

audio, sr = sf.read('/home/savan/openviva/test_tts.wav')
# Resample to 16kHz
num_samples_16k = int(len(audio) * 16000 / sr)
indices = np.linspace(0, len(audio) - 1, num_samples_16k).astype(int)
audio_16k = audio[indices].astype(np.float32)

WHISPER_PATH = '/home/savan/openviva/models/whisper/large-v3-turbo'

for threads in [4, 8, 12]:
    print(f'Testing Faster-Whisper with cpu_threads={threads}...')
    model = WhisperModel(WHISPER_PATH, device='cpu', compute_type='int8', cpu_threads=threads, local_files_only=True)
    t0 = time.time()
    segments, _ = model.transcribe(audio_16k, beam_size=1, vad_filter=False, language='en')
    text = ' '.join([s.text for s in segments])
    elapsed = time.time() - t0
    print(f'cpu_threads={threads} -> Time: {elapsed:.2f}s | Audio: {len(audio_16k)/16000:.2f}s | Speedup: {len(audio_16k)/16000/elapsed:.2f}x')
