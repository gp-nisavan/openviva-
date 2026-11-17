
from huggingface_hub import HfApi
api = HfApi()
files = api.list_repo_files(repo_id="deepdml/faster-whisper-large-v3-turbo-ct2")
print("Files:", files)
