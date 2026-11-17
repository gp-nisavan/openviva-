
import os
import sys
import numpy as np
from PIL import Image
import onnxruntime as ort

sys.path.insert(0, '/home/savan/openviva/scripts')
from extract_biometrics import get_scrfd_detector

model_path = '/home/savan/openviva/models/face/minifasnet_v2.onnx'
sess = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])
print("Inputs:", [(i.name, i.shape, i.type) for i in sess.get_inputs()])
print("Outputs:", [(o.name, o.shape, o.type) for o in sess.get_outputs()])

# Load real face
detector = get_scrfd_detector()
img = Image.open('/home/savan/openviva/storage/biometrics/faces/reg1.jpg').convert('RGB')
faces = detector.detect(img)
face = faces[0]
box = face['box']
print("Detected face box:", box)

# Standard Silent-Face-Anti-Spoofing crop:
# Crop with expansion scale (typically 2.7x or 1.5x) around face center
x1, y1, x2, y2 = box
cx = (x1 + x2) / 2
cy = (y1 + y2) / 2
w = x2 - x1
h = y2 - y1
scale = 2.7 # Silent-Face-Anti-Spoofing uses scale=2.7 for 80x80
w_scaled = w * scale
h_scaled = h * scale

img_w, img_h = img.size
crop_x1 = max(0, int(cx - w_scaled / 2))
crop_y1 = max(0, int(cy - h_scaled / 2))
crop_x2 = min(img_w, int(cx + w_scaled / 2))
crop_y2 = min(img_h, int(cy + h_scaled / 2))

face_crop = img.crop((crop_x1, crop_y1, crop_x2, crop_y2))
face_resized = face_crop.resize((80, 80), Image.Resampling.BILINEAR)

# Check input normalization:
# Silent-Face-Anti-Spoofing uses:
# arr BGR, float32, / 255.0 or raw?
# Let's test both!
arr_rgb = np.array(face_resized, dtype=np.float32)
arr_bgr = arr_rgb[:, :, ::-1]

# Try / 255.0:
blob_norm = np.transpose(arr_bgr / 255.0, (2, 0, 1))[np.newaxis, :]
out_norm = sess.run(None, {sess.get_inputs()[0].name: blob_norm})[0]
print("Logits (/ 255.0):", out_norm)
softmax_norm = np.exp(out_norm) / np.sum(np.exp(out_norm), axis=-1, keepdims=True)
print("Softmax (/ 255.0):", softmax_norm)

# Try unnormalized (0..255):
blob_raw = np.transpose(arr_bgr, (2, 0, 1))[np.newaxis, :]
out_raw = sess.run(None, {sess.get_inputs()[0].name: blob_raw})[0]
print("Logits (raw 0..255):", out_raw)
softmax_raw = np.exp(out_raw) / np.sum(np.exp(out_raw), axis=-1, keepdims=True)
print("Softmax (raw 0..255):", softmax_raw)

# Try standard (x - 127.5) / 128.0:
blob_std = np.transpose((arr_bgr - 127.5) / 128.0, (2, 0, 1))[np.newaxis, :]
out_std = sess.run(None, {sess.get_inputs()[0].name: blob_std})[0]
print("Logits (std norm):", out_std)
softmax_std = np.exp(out_std) / np.sum(np.exp(out_std), axis=-1, keepdims=True)
print("Softmax (std norm):", softmax_std)
