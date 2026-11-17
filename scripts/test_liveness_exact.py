import os, sys
import numpy as np
from PIL import Image
import onnxruntime as ort

sys.path.insert(0, '/home/savan/openviva/scripts')
from extract_biometrics import get_scrfd_detector

model_path = '/home/savan/openviva/models/face/minifasnet_v2.onnx'
sess = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])
detector = get_scrfd_detector()

def evaluate_liveness(img_path):
    img = Image.open(img_path).convert('RGB')
    src_w, src_h = img.size
    faces = detector.detect(img)
    if not faces:
        return "NO_FACE"
    
    box = faces[0]['box']
    x1, y1, x2, y2 = box
    box_w = x2 - x1
    box_h = y2 - y1
    cx = x1 + box_w / 2.0
    cy = y1 + box_h / 2.0
    
    scale = 2.7
    new_w = box_w * scale
    new_h = box_h * scale
    
    crop_x1 = max(0, int(cx - new_w / 2.0))
    crop_y1 = max(0, int(cy - new_h / 2.0))
    crop_x2 = min(src_w, int(cx + new_w / 2.0))
    crop_y2 = min(src_h, int(cy + new_h / 2.0))
    
    crop = img.crop((crop_x1, crop_y1, crop_x2, crop_y2)).resize((80, 80), Image.Resampling.BILINEAR)
    arr_bgr = np.array(crop, dtype=np.float32)[:, :, ::-1]
    blob = np.transpose(arr_bgr, (2, 0, 1))[np.newaxis, :]
    
    logits = sess.run(None, {'input': blob})[0][0]
    sm = np.exp(logits - np.max(logits))
    probs = sm / np.sum(sm)
    
    p_print = float(probs[0])
    p_real = float(probs[1])
    p_replay = float(probs[2])
    return p_real, p_print, p_replay, logits

test_images = [
    '/home/savan/openviva/storage/biometrics/faces/reg1.jpg',
    '/home/savan/openviva/storage/biometrics/faces/reg1_keyframe.jpg',
    '/home/savan/openviva/storage/biometrics/faces/master_e2e_1793867311.jpg'
]

for p in test_images:
    res = evaluate_liveness(p)
    print(f"{os.path.basename(p)} -> Real: {res[0]:.4f} | PrintSpoof: {res[1]:.4f} | ReplaySpoof: {res[2]:.4f} | Logits: {[round(x, 2) for x in res[3]]}")
