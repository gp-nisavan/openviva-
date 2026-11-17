
from huggingface_hub import HfApi
api = HfApi()
files = api.list_repo_files("leonelhs/kokoro-thewh1teagle")
print("Files in leonelhs/kokoro-thewh1teagle:", files)
