import os, sys
import numpy as np
from PIL import Image

sys.path.insert(0, '/home/savan/openviva/scripts')
from extract_biometrics import get_scrfd_detector, get_liveness_classifier

detector = get_scrfd_detector()
liveness = get_liveness_classifier()

img = Image.open('/home/savan/openviva/storage/biometrics/faces/reg1.jpg').convert('RGB')
box = detector.detect(img)[0]['box']
x1, y1, x2, y2 = box
cx = (x1 + x2) / 2.0
cy = (y1 + y2) / 2.0
w = x2 - x1
h = y2 - y1

# Scale 2.7 area (the actual presentation area, e.g. the phone screen or paper sheet held by student)
px1 = max(0, int(cx - w * 1.35))
py1 = max(0, int(cy - h * 1.35))
px2 = min(img.width, int(cx + w * 1.35))
py2 = min(img.height, int(cy + h * 1.35))

# 1. Print presentation attack:
# The student holds an A4 sheet. Across the entire A4 sheet (the 2.7x crop):
img_p = img.copy()
arr_p = np.array(img_p, dtype=np.float32)
sheet = arr_p[py1:py2, px1:px2]
sh, sw, _ = sheet.shape

# Add printer half-tone raster grid
grid = np.zeros((sh, sw, 3), dtype=np.float32)
for y in range(sh):
    for x in range(sw):
        # 2D periodic printing dots
        if (x % 4 == 0) or (y % 4 == 0):
            grid[y, x, :] = 35.0
sheet_printed = np.clip(sheet * 0.85 + grid, 0, 255)
# Add visible paper margin / boundary line
sheet_printed[:4, :, :] = 250
sheet_printed[-4:, :, :] = 250
sheet_printed[:, :4, :] = 250
sheet_printed[:, -4:, :] = 250
arr_p[py1:py2, px1:px2] = sheet_printed

img_p_obj = Image.fromarray(arr_p.astype(np.uint8))
faces_p = detector.detect(img_p_obj)
print("Print sheet detected faces:", len(faces_p), "Score:", faces_p[0]['score'] if faces_p else None)
if faces_p:
    live_p = liveness.evaluate(img_p_obj, faces_p[0]['box'])
    print("Print sheet liveness:", live_p)

# 2. Screen presentation attack:
# The student holds an iPad/iPhone screen.
# Across the entire screen display:
img_s = img.copy()
arr_s = np.array(img_s, dtype=np.float32)
screen = arr_s[py1:py2, px1:px2]
sh, sw, _ = screen.shape
for y in range(sh):
    for x in range(sw):
        # Moiré interference pattern from LCD subpixel grid
        moire = np.sin(x * 0.45) * 35.0 + np.sin(y * 0.45) * 35.0
        screen[y, x] = np.clip(screen[y, x] + moire, 0, 255)
# Add dark tablet bezel
screen[:6, :, :] = 10
screen[-6:, :, :] = 10
screen[:, :6, :] = 10
screen[:, -6:, :] = 10
arr_s[py1:py2, px1:px2] = screen

img_s_obj = Image.fromarray(arr_s.astype(np.uint8))
faces_s = detector.detect(img_s_obj)
print("Screen replay detected faces:", len(faces_s), "Score:", faces_s[0]['score'] if faces_s else None)
if faces_s:
    live_s = liveness.evaluate(img_s_obj, faces_s[0]['box'])
    print("Screen replay liveness:", live_s)
