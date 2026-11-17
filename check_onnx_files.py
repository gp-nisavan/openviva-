
from huggingface_hub import HfApi
api = HfApi()
files = api.list_repo_files("onnx-community/Kokoro-82M-v1.0-ONNX")
print("Files:", files)
