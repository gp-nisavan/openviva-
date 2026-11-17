import os, sys
import numpy as np
from PIL import Image, ImageFilter

sys.path.insert(0, '/home/savan/openviva/scripts')
from extract_biometrics import get_scrfd_detector, get_liveness_classifier

detector = get_scrfd_detector()
liveness = get_liveness_classifier()

img = Image.open('/home/savan/openviva/storage/biometrics/faces/reg1.jpg').convert('RGB')

# Let's test different subtle paper / screen transformations:
# 1. Subtle blur (printed paper diffusion / camera re-capture defocus)
for radius in [0.5, 1.0, 1.5]:
    blurred = img.filter(ImageFilter.GaussianBlur(radius=radius))
    faces = detector.detect(blurred)
    if faces:
        live = liveness.evaluate(blurred, faces[0]['box'])
        print(f"Blur radius={radius}: FaceScore={faces[0]['score']:.3f}, Liveness={live['liveness_score']:.4f}, Live={live['is_live']}")
    else:
        print(f"Blur radius={radius}: 0 faces")

# 2. Add subtle high-frequency dither (amplitude 4)
arr = np.array(img, dtype=np.float32)
h, w, _ = arr.shape
dither = np.random.choice([-4.0, 4.0], size=(h, w, 1))
dithered_img = Image.fromarray(np.clip(arr + dither, 0, 255).astype(np.uint8))
faces_d = detector.detect(dithered_img)
if faces_d:
    live_d = liveness.evaluate(dithered_img, faces_d[0]['box'])
    print(f"Subtle dither (+/-4): FaceScore={faces_d[0]['score']:.3f}, Liveness={live_d['liveness_score']:.4f}, Live={live_d['is_live']}")
