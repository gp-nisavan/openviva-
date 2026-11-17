import os, sys
import numpy as np
from PIL import Image
import onnxruntime as ort

model_path = '/home/savan/openviva/models/face/minifasnet_v2.onnx'
sess = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])

def predict_crop(crop_img):
    arr_bgr = np.array(crop_img.resize((80, 80), Image.Resampling.BILINEAR), dtype=np.float32)[:, :, ::-1]
    blob = np.transpose(arr_bgr, (2, 0, 1))[np.newaxis, :]
    logits = sess.run(None, {'input': blob})[0][0]
    sm = np.exp(logits - np.max(logits))
    probs = sm / np.sum(sm)
    return float(probs[1]), float(probs[0]), float(probs[2]), logits

# 1. Base real face
real_crop = Image.open('/home/savan/openviva/storage/biometrics/faces/reg1.jpg').convert('RGB').crop((150, 100, 450, 450))
p_real, p_print, p_replay, _ = predict_crop(real_crop)
print(f"Real Face Crop -> Real: {p_real:.4f} | Print: {p_print:.4f} | Replay: {p_replay:.4f}")

# 2. Simulated Screen Replay Attack (Moiré Grid Artifacts across face)
moire_arr = np.array(real_crop, dtype=np.float32)
h, w, _ = moire_arr.shape
for y in range(h):
    for x in range(w):
        # Moiré interference pattern from LCD screen subpixel raster
        moire = np.sin(x * 0.8) * 45.0 + np.sin(y * 0.8) * 45.0
        moire_arr[y, x] = np.clip(moire_arr[y, x] + moire, 0, 255)
moire_img = Image.fromarray(moire_arr.astype(np.uint8))
p_real_m, p_print_m, p_replay_m, _ = predict_crop(moire_img)
print(f"Screen Replay Spoof (Moiré) -> Real: {p_real_m:.4f} | Print: {p_print_m:.4f} | Replay: {p_replay_m:.4f}")

# 3. Simulated Paper Print Attack (High-frequency paper dither / halftone noise + paper border)
print_arr = np.array(real_crop, dtype=np.float32)
# High-frequency 2D grid noise from printing dots
noise = np.random.normal(0, 35, (h, w, 3))
print_arr = np.clip(print_arr * 0.85 + noise + 20, 0, 255)
# Add flat paper white border
print_arr[:15, :, :] = 245
print_arr[-15:, :, :] = 245
print_arr[:, :15, :] = 245
print_arr[:, -15:, :] = 245
print_img = Image.fromarray(print_arr.astype(np.uint8))
p_real_p, p_print_p, p_replay_p, _ = predict_crop(print_img)
print(f"Paper Print Spoof (Halftone+Border) -> Real: {p_real_p:.4f} | Print: {p_print_p:.4f} | Replay: {p_replay_p:.4f}")
