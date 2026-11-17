
from huggingface_hub import hf_hub_download
import numpy as np

path = hf_hub_download(
    repo_id="onnx-community/Kokoro-82M-v1.0-ONNX",
    filename="voices/af_heart.bin"
)
print("Downloaded voice file to:", path)
try:
    arr = np.load(path)
    print("Loaded array shape:", arr.shape, arr.dtype)
except Exception as e:
    print("Error loading as numpy:", e)
