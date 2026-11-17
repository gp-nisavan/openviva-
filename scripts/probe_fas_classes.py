import os, sys, time
import numpy as np
from PIL import Image
import onnxruntime as ort

model_path = '/home/savan/openviva/models/face/minifasnet_v2.onnx'
sess = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])

# Test real images
real_paths = [
    '/home/savan/openviva/storage/biometrics/faces/reg1.jpg',
    '/home/savan/openviva/storage/biometrics/faces/master_e2e_1793867311.jpg',
    '/home/savan/openviva/storage/biometrics/faces/reg1_keyframe.jpg'
]

for p in real_paths:
    img = Image.open(p).convert('RGB')
    w, h = img.size
    
    # Simple center 80x80 crop scaled
    crop = img.crop((w//4, h//4, 3*w//4, 3*h//4)).resize((80, 80), Image.Resampling.BILINEAR)
    arr_bgr = np.array(crop, dtype=np.float32)[:, :, ::-1] # BGR
    
    # 1. / 255.0
    blob1 = np.transpose(arr_bgr / 255.0, (2, 0, 1))[np.newaxis, :]
    out1 = sess.run(None, {'input': blob1})[0][0]
    sm1 = np.exp(out1) / np.sum(np.exp(out1))
    
    # 2. raw (0..255)
    blob2 = np.transpose(arr_bgr, (2, 0, 1))[np.newaxis, :]
    out2 = sess.run(None, {'input': blob2})[0][0]
    sm2 = np.exp(out2) / np.sum(np.exp(out2))
    
    print(f"=== {os.path.basename(p)} ===")
    print("  /255 -> logits:", [round(x, 3) for x in out1], "softmax:", [round(x, 4) for x in sm1])
    print("  raw  -> logits:", [round(x, 3) for x in out2], "softmax:", [round(x, 4) for x in sm2])

# Test synthetic spoof: periodic moire / printed halftone pattern
spoof_img = np.zeros((80, 80, 3), dtype=np.float32)
# Add periodic high-frequency stripe moire
for y in range(80):
    for x in range(80):
        spoof_img[y, x, :] = (np.sin(x * 1.5) * 50 + np.sin(y * 1.5) * 50 + 128)
blob_spoof = np.transpose(spoof_img / 255.0, (2, 0, 1))[np.newaxis, :]
out_spoof = sess.run(None, {'input': blob_spoof})[0][0]
sm_spoof = np.exp(out_spoof) / np.sum(np.exp(out_spoof))
print("=== Synthetic Moiré Spoof ===")
print("  /255 -> logits:", [round(x, 3) for x in out_spoof], "softmax:", [round(x, 4) for x in sm_spoof])
