
from huggingface_hub import HfApi
api = HfApi()
models = api.list_models(search="thewh1teagle")
for m in list(models)[:5]:
    print("thewh1teagle model:", m.id)
