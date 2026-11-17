import asyncio
import time
import numpy as np
from kokoro_onnx import Kokoro

KOKORO_MODEL = "/home/savan/openviva/models/kokoro/kokoro-v1.0.onnx"
KOKORO_VOICES = "/home/savan/openviva/models/kokoro/voices-v1.0.bin"

async def test_kokoro_stream():
    kokoro = Kokoro(KOKORO_MODEL, KOKORO_VOICES)
    sentence = "Please clarify what LoRA is and how it was applied in this context."
    t0 = time.time()
    stream = kokoro.create_stream(sentence, voice="hm_omega", speed=1.0, lang="en-us")
    first_chunk_t = None
    total_samples = 0
    async for chunk, sr in stream:
        if first_chunk_t is None:
            first_chunk_t = time.time()
        total_samples += len(chunk)
    duration_audio = total_samples / sr
    total_t = time.time() - t0
    print(f"First audio chunk: {(first_chunk_t - t0)*1000:.1f}ms")
    print(f"Total synthesis time: {total_t*1000:.1f}ms for {duration_audio:.2f}s audio (RTF: {total_t/duration_audio:.3f})")

if __name__ == "__main__":
    asyncio.run(test_kokoro_stream())
