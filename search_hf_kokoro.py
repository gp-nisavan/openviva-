
from huggingface_hub import HfApi
api = HfApi()
models = api.list_models(search="kokoro-v0_19.onnx")
for m in list(models)[:5]:
    print(m.id)
models2 = api.list_models(search="voices-v1.0.bin")
for m in list(models2)[:5]:
    print(m.id)
