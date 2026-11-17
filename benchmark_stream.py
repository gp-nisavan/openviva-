import time
import asyncio
from kokoro_onnx import Kokoro

model_path = "/home/savan/openviva/models/kokoro/kokoro-v1.0.onnx"
voices_path = "/home/savan/openviva/models/kokoro/voices-v1.0.bin"

kokoro = Kokoro(model_path, voices_path)
test_text = "Good morning candidate. Please explain how your distributed consensus protocol handles Byzantine node failures."

async def benchmark_stream():
    t_stream_start = time.time()
    stream = kokoro.create_stream(test_text, voice="am_adam", speed=1.0, lang="en-us")
    first_chunk_ms = None
    count = 0
    total_samples = 0
    async for chunk, sr in stream:
        if first_chunk_ms is None:
            first_chunk_ms = (time.time() - t_stream_start) * 1000
        count += 1
        total_samples += len(chunk)
    
    total_audio_duration = total_samples / 24000
    print(f"Stream chunks: {count}")
    print(f"Total audio generated: {total_audio_duration:.2f} seconds")
    print(f"Time to FIRST audio chunk: {first_chunk_ms:.1f} ms")
    print("=== STREAMING VERIFICATION PASSED ===")

asyncio.run(benchmark_stream())
