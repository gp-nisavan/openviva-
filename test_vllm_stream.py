import asyncio
import aiohttp
import json
import time

async def test_vllm_stream():
    url = "http://10.10.16.13:8088/v1/chat/completions"
    messages = [
        {"role": "system", "content": "You are a concise academic examiner. Respond in 2 short sentences."},
        {"role": "user", "content": "Candidate: 'I used LoRA rank 8 to fine-tune the model.'"}
    ]
    payload = {
        "model": "hugging-quants/Meta-Llama-3.1-8B-Instruct-AWQ-INT4",
        "messages": messages,
        "temperature": 0.6,
        "max_tokens": 80,
        "stream": True
    }
    print("Testing aiohttp streaming to vLLM...")
    t0 = time.time()
    first_token_t = None
    accumulated = ""
    async with aiohttp.ClientSession() as session:
        async with session.post(url, json=payload) as resp:
            async for line in resp.content:
                line_str = line.decode('utf-8').strip()
                if line_str.startswith("data: ") and line_str != "data: [DONE]":
                    data = json.loads(line_str[6:])
                    delta = data["choices"][0]["delta"].get("content", "")
                    if delta:
                        if first_token_t is None:
                            first_token_t = time.time()
                        accumulated += delta
                        print(delta, end="", flush=True)
    print(f"\n\nDone! TTFT: {(first_token_t - t0)*1000:.1f}ms, Total: {(time.time() - t0)*1000:.1f}ms")

if __name__ == "__main__":
    asyncio.run(test_vllm_stream())
