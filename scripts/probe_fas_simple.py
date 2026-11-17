
import os, sys, time
print("Step 1: start", flush=True)
import numpy as np
from PIL import Image
import onnxruntime as ort
print("Step 2: imports ok", flush=True)

model_path = '/home/savan/openviva/models/face/minifasnet_v2.onnx'
sess = ort.InferenceSession(model_path, providers=['CPUExecutionProvider'])
print("Step 3: session loaded ok", [(i.name, i.shape) for i in sess.get_inputs()], [(o.name, o.shape) for o in sess.get_outputs()], flush=True)

# Generate dummy 80x80 BGR image
dummy = np.random.rand(1, 3, 80, 80).astype(np.float32)
out = sess.run(None, {sess.get_inputs()[0].name: dummy})[0]
print("Step 4: dummy forward pass ok, shape:", out.shape, "values:", out, flush=True)
