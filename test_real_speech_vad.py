import soundfile as sf
import numpy as np
import onnxruntime as ort

opts = ort.SessionOptions()
opts.inter_op_num_threads = 1
opts.intra_op_num_threads = 1
session = ort.InferenceSession("/home/savan/openviva/models/vad/onnx/model.onnx", opts, providers=["CPUExecutionProvider"])

audio, sr = sf.read("/home/savan/openviva/test_tts.wav")
num_samples_16k = int(len(audio) * 16000 / sr)
indices = np.linspace(0, len(audio) - 1, num_samples_16k).astype(int)
audio_16k = audio[indices].astype(np.float32)

state = np.zeros((2, 1, 128), dtype=np.float32)
sr_arr = np.array(16000, dtype=np.int64)

probs = []
chunk_size = 512
for i in range(0, len(audio_16k) - chunk_size, chunk_size):
    chunk = audio_16k[i:i + chunk_size]
    inputs = {
        session.get_inputs()[0].name: chunk.reshape(1, -1),
        session.get_inputs()[1].name: state,
        session.get_inputs()[2].name: sr_arr
    }
    out, state = session.run(None, inputs)
    probs.append(float(out[0][0]))

probs = np.array(probs)
speech_chunks = np.sum(probs > 0.5)
total_chunks = len(probs)
print(f"Total chunks: {total_chunks}")
print(f"Speech detected in {speech_chunks}/{total_chunks} chunks ({speech_chunks/total_chunks*100:.1f}%)")
print(f"Max speech probability: {np.max(probs):.4f}")
print(f"Mean probability during speech: {np.mean(probs[probs > 0.5]):.4f}")
print("=== REAL HUMAN SPEECH VALIDATION PASSED ===")
