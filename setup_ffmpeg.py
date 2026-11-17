
import os
import sys
import imageio_ffmpeg

ffmpeg_exe = imageio_ffmpeg.get_ffmpeg_exe()
print("Found imageio ffmpeg:", ffmpeg_exe)

target_dirs = [
    os.path.expanduser("~/.local/bin"),
    "/home/savan/openviva/bin"
]

for d in target_dirs:
    os.makedirs(d, exist_ok=True)
    link_path = os.path.join(d, "ffmpeg")
    try:
        if os.path.islink(link_path) or os.path.exists(link_path):
            os.remove(link_path)
        os.symlink(ffmpeg_exe, link_path)
        print("Created symlink:", link_path, "->", ffmpeg_exe)
    except Exception as e:
        print("Failed symlink in", d, ":", e)
