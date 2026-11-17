
import os
import urllib.request

KOKORO_DIR = "/home/savan/openviva/models/kokoro"
os.makedirs(KOKORO_DIR, exist_ok=True)

ONNX_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/kokoro-v1.0.onnx"
VOICES_URL = "https://github.com/thewh1teagle/kokoro-onnx/releases/download/model-files-v1.0/voices-v1.0.bin"

onnx_dest = os.path.join(KOKORO_DIR, "kokoro-v1.0.onnx")
voices_dest = os.path.join(KOKORO_DIR, "voices-v1.0.bin")

def download(url, dest):
    if not os.path.exists(dest) or os.path.getsize(dest) == 0:
        print(f"Downloading {url} -> {dest}...")
        urllib.request.urlretrieve(url, dest)
        print(f"Done: {dest} ({os.path.getsize(dest)/1024/1024:.2f} MB)")
    else:
        print(f"Already exists: {dest} ({os.path.getsize(dest)/1024/1024:.2f} MB)")

download(ONNX_URL, onnx_dest)
download(VOICES_URL, voices_dest)
print("All Kokoro model files ready!")
