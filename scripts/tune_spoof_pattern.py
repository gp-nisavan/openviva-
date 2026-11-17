import os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, '/home/savan/openviva/scripts')
from extract_biometrics import get_scrfd_detector, get_liveness_classifier

detector = get_scrfd_detector()
liveness = get_liveness_classifier()

img = Image.open('/home/savan/openviva/storage/biometrics/faces/reg1.jpg').convert('RGB')
faces = detector.detect(img)
box = faces[0]['box']
print("Base score:", faces[0]['score'])

# Let's add slight moire modulation to the image that preserves facial contours (eyes/nose/mouth)
# but adds the high-frequency Fourier grid that MiniFASNet detects:
arr = np.array(img, dtype=np.float32)
h, w, _ = arr.shape
x = np.arange(w)
y = np.arange(h)
xx, yy = np.meshgrid(x, y)

# A fine-pitch LCD screen subpixel pattern: period of 4 pixels (frequency = 2*pi / 4 = 1.57)
fine_moire = (np.sin(xx * 1.57) * 15.0 + np.sin(yy * 1.57) * 15.0).astype(np.float32)[:, :, np.newaxis]
arr_spoof = np.clip(arr + fine_moire, 0, 255).astype(np.uint8)

img_spoof = Image.fromarray(arr_spoof)
faces_sp = detector.detect(img_spoof)
print("Spoof image faces:", len(faces_sp))
if faces_sp:
    box_sp = faces_sp[0]['box']
    score_sp = faces_sp[0]['score']
    print(f"Face detected with score: {score_sp:.3f}")
    live_sp = liveness.evaluate(img_spoof, box_sp)
    print("Liveness evaluation:", live_sp)
