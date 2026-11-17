
from huggingface_hub import HfApi
api = HfApi()
models = api.list_models(search="faster-whisper large-v3")
for m in list(models)[:10]:
    print(m.id)
