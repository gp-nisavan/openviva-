
from huggingface_hub import HfApi
api = HfApi()
models = api.list_models(search="kokoro-onnx")
for m in list(models)[:5]:
    print(m.id)
files = api.list_repo_files("hexgrad/Kokoro-82M")
onnx_files = [f for f in files if 'onnx' in f or 'voice' in f or 'json' in f]
print("hexgrad/Kokoro-82M files:", onnx_files)
