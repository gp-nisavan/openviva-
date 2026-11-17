import os
import sys
import urllib.request
import hashlib

models_dir = "/home/savan/openviva/models/face"
os.makedirs(models_dir, exist_ok=True)

models = {
    "mobilefacenet_arcface_512.onnx": "https://huggingface.co/WePrompt/buffalo_sc/resolve/main/w600k_mbf.onnx",
    "minifasnet_v2.onnx": "https://huggingface.co/garciafido/minifasnet-v2-anti-spoofing-onnx/resolve/main/minifasnet_v2.onnx"
}

headers = {"User-Agent": "Mozilla/5.0"}

for name, url in models.items():
    dest = os.path.join(models_dir, name)
    if not os.path.exists(dest) or os.path.getsize(dest) < 100000:
        print(f"Downloading {name} from {url}...")
        req = urllib.request.Request(url, headers=headers)
        with urllib.request.urlopen(req) as resp, open(dest, "wb") as f:
            while True:
                chunk = resp.read(65536)
                if not chunk:
                    break
                f.write(chunk)
    size = os.path.getsize(dest)
    print(f"Verified {name}: {size:,} bytes")

print("\nFinal listing of /home/savan/openviva/models/face:")
for f in sorted(os.listdir(models_dir)):
    fp = os.path.join(models_dir, f)
    h = hashlib.sha256()
    with open(fp, "rb") as fl:
        while True:
            c = fl.read(65536)
            if not c:
                break
            h.update(c)
    print(f"  {f:32s} | Size: {os.path.getsize(fp):10,d} bytes | SHA256: {h.hexdigest()[:16]}...")
