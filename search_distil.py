
from huggingface_hub import HfApi
api = HfApi()
models = api.list_models(search="faster-distil-whisper-large-v3")
for m in list(models)[:5]:
    print(m.id)
