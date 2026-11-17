
import os
from huggingface_hub import HfApi
api = HfApi()
models = api.list_models(search="silero-vad")
for m in list(models)[:5]:
    print(m.id)
