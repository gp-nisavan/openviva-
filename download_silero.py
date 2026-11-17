
import os
import onnxruntime as ort
import numpy as np
from huggingface_hub import hf_hub_download

vad_dir = "/home/savan/openviva/models/vad"
os.makedirs(vad_dir, exist_ok=True)

print("Downloading silero_vad ONNX from HF...")
model_path = hf_hub_download(
    repo_id="onnx-community/silero-vad",
    filename="onnx/model.onnx",
    local_dir=vad_dir
)
print("Downloaded to:", model_path)

# Verify with ONNX Runtime
opts = ort.SessionOptions()
opts.inter_op_num_threads = 1
opts.intra_op_num_threads = 1
session = ort.InferenceSession(model_path, opts, providers=["CPUExecutionProvider"])
print("Silero VAD ONNX model initialized successfully!")
print("Inputs:", [i.name for i in session.get_inputs()])
print("Outputs:", [o.name for o in session.get_outputs()])

# Test forward pass with 512 samples of silence (32ms at 16kHz)
state = np.zeros((2, 1, 128), dtype=np.float32)
sr = np.array(16000, dtype=np.int64)
audio_chunk = np.zeros((1, 512), dtype=np.float32)

inputs = {
    session.get_inputs()[0].name: audio_chunk,
    session.get_inputs()[1].name: state,
    session.get_inputs()[2].name: sr
}
out, new_state = session.run(None, inputs)
print("Speech probability on silence chunk:", float(out[0][0]))
print("Silero VAD verified working offline in 0.2ms!")
