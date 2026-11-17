
import os
import sys
import numpy as np
from PIL import Image
import onnxruntime as ort

model_path = '/home/savan/openviva/models/face/scrfd_500m_kps.onnx'
sess = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])

img_path = '/home/savan/openviva/storage/biometrics/faces/reg1.jpg'
pil_img = Image.open(img_path).convert('RGB')
orig_w, orig_h = pil_img.size
print(f"Loaded {img_path}: {orig_w}x{orig_h}")

# Target input shape 640x640 letterbox
target_size = 640
scale = min(target_size / orig_w, target_size / orig_h)
new_w = int(orig_w * scale)
new_h = int(orig_h * scale)

resized = pil_img.resize((new_w, new_h), Image.Resampling.BILINEAR)
pad_w = target_size - new_w
pad_h = target_size - new_h

canvas = Image.new('RGB', (target_size, target_size), (127, 127, 127))
canvas.paste(resized, (0, 0))

# Normalize: (pixel - 127.5) / 128.0
# Note: check if BGR or RGB is standard for SCRFD. Insightface uses BGR.
arr_rgb = np.array(canvas, dtype=np.float32)
arr_bgr = arr_rgb[:, :, ::-1] # RGB to BGR
blob = (arr_bgr - 127.5) / 128.0
blob = np.transpose(blob, (2, 0, 1))[np.newaxis, :] # NCHW

input_name = sess.get_inputs()[0].name
outputs = sess.run(None, {input_name: blob})

print("Raw Output Summary:")
for idx, o in enumerate(outputs):
    print(f"  Out {idx} ({sess.get_outputs()[idx].name}): shape={o.shape}, min={o.min():.4f}, max={o.max():.4f}, mean={o.mean():.4f}")

# Strides: 8, 16, 32
# Outputs map:
# 443: score_8 [12800, 1]
# 468: score_16 [3200, 1]
# 493: score_32 [800, 1]
# 446: bbox_8 [12800, 4]
# 471: bbox_16 [3200, 4]
# 496: bbox_32 [800, 4]
# 449: kps_8 [12800, 10]
# 474: kps_16 [3200, 10]
# 499: kps_32 [800, 10]

strides = [8, 16, 32]
score_indices = [0, 1, 2] # 443, 468, 493
bbox_indices = [3, 4, 5]  # 446, 471, 496
kps_indices = [6, 7, 8]   # 449, 474, 499

conf_thresh = 0.5
proposals = []

for s_idx, stride in enumerate(strides):
    scores = outputs[score_indices[s_idx]] # [N, 1]
    bboxes = outputs[bbox_indices[s_idx]] # [N, 4]
    kpss = outputs[kps_indices[s_idx]]    # [N, 10]
    
    feat_h = target_size // stride
    feat_w = target_size // stride
    
    # Anchor centers
    grid_y, grid_x = np.mgrid[:feat_h, :feat_w]
    anchor_centers = np.stack([grid_x, grid_y], axis=-1).astype(np.float32) * stride
    anchor_centers = np.repeat(anchor_centers.reshape((-1, 2)), 2, axis=0) # 2 anchors per cell
    
    pos_mask = scores.flatten() >= conf_thresh
    num_pos = np.sum(pos_mask)
    print(f"Stride {stride}: {num_pos} proposals with score >= {conf_thresh}")
    
    if num_pos > 0:
        pos_scores = scores[pos_mask].flatten()
        pos_anchors = anchor_centers[pos_mask]
        pos_bboxes = bboxes[pos_mask]
        pos_kpss = kpss[pos_mask]
        
        # Decode bboxes
        x1 = (pos_anchors[:, 0] - pos_bboxes[:, 0] * stride) / scale
        y1 = (pos_anchors[:, 1] - pos_bboxes[:, 1] * stride) / scale
        x2 = (pos_anchors[:, 0] + pos_bboxes[:, 2] * stride) / scale
        y2 = (pos_anchors[:, 1] + pos_bboxes[:, 3] * stride) / scale
        
        # Decode 5 keypoints
        decoded_kps = np.zeros((num_pos, 5, 2), dtype=np.float32)
        for k in range(5):
            decoded_kps[:, k, 0] = (pos_anchors[:, 0] + pos_kpss[:, k*2] * stride) / scale
            decoded_kps[:, k, 1] = (pos_anchors[:, 1] + pos_kpss[:, k*2 + 1] * stride) / scale
            
        for i in range(num_pos):
            proposals.append({
                'score': float(pos_scores[i]),
                'box': [float(x1[i]), float(y1[i]), float(x2[i]), float(y2[i])],
                'kps': decoded_kps[i].tolist()
            })

print(f"Total proposals before NMS: {len(proposals)}")
proposals.sort(key=lambda p: p['score'], reverse=True)
if proposals:
    top = proposals[0]
    print(f"Top Proposal: score={top['score']:.4f}")
    print(f"  Box: {top['box']}")
    print(f"  Landmarks: {top['kps']}")
