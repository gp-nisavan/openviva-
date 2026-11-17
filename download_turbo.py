
import os
from huggingface_hub import snapshot_download

target_dir = "/home/savan/openviva/models/whisper/large-v3-turbo"
os.makedirs(target_dir, exist_ok=True)

print("Downloading Systran/faster-whisper-large-v3-turbo to:", target_dir)
snapshot_download(
    repo_id="Systran/faster-whisper-large-v3-turbo",
    local_dir=target_dir,
    local_dir_use_symlinks=False
)
print("Download complete!")

# Quick verification load
from faster_whisper import WhisperModel
print("Verifying offline load with INT8 on CPU...")
model = WhisperModel(target_dir, device="cpu", compute_type="int8", local_files_only=True)
print("Model loaded successfully offline!")
