
import os
from huggingface_hub import snapshot_download

target_dir = "/home/savan/openviva/models/whisper/large-v3-turbo"
os.makedirs(target_dir, exist_ok=True)

print("Starting download of deepdml/faster-whisper-large-v3-turbo-ct2...")
snapshot_download(
    repo_id="deepdml/faster-whisper-large-v3-turbo-ct2",
    local_dir=target_dir
)
print("Download complete!")

from faster_whisper import WhisperModel
print("Verifying offline load with INT8 on CPU...")
model = WhisperModel(target_dir, device="cpu", compute_type="int8", local_files_only=True)
print("Large-v3-Turbo model loaded successfully offline!")
