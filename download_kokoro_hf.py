
import os
import shutil
from huggingface_hub import hf_hub_download

dest_dir = "/home/savan/openviva/models/kokoro"
os.makedirs(dest_dir, exist_ok=True)

print("Downloading kokoro-v1.0.onnx from HF...")
onnx_path = hf_hub_download(
    repo_id="leonelhs/kokoro-thewh1teagle",
    filename="kokoro-v1.0.onnx",
    local_dir=dest_dir
)
print("ONNX model downloaded to:", onnx_path)

print("Downloading voices-v1.0.bin from HF...")
voices_path = hf_hub_download(
    repo_id="leonelhs/kokoro-thewh1teagle",
    filename="voices-v1.0.bin",
    local_dir=dest_dir
)
print("Voices downloaded to:", voices_path)

print("Testing Kokoro loading offline...")
from kokoro_onnx import Kokoro
kokoro = Kokoro(
    model_path=os.path.join(dest_dir, "kokoro-v1.0.onnx"),
    voices_path=os.path.join(dest_dir, "voices-v1.0.bin")
)
print("Kokoro loaded successfully offline!")
