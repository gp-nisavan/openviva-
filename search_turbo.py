
from huggingface_hub import HfApi
api = HfApi()
models = api.list_models(search="turbo", filter="ctranslate2")
for m in list(models)[:10]:
    print(m.id)
