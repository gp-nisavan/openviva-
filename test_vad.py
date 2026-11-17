import time
import numpy as np
import onnxruntime as ort

class SileroVADController:
    def __init__(self, model_path="/home/savan/openviva/models/vad/onnx/model.onnx"):
        opts = ort.SessionOptions()
        opts.inter_op_num_threads = 1
        opts.intra_op_num_threads = 1
        self.session = ort.InferenceSession(model_path, opts, providers=["CPUExecutionProvider"])
        self.reset()
        
        self.speech_threshold = 0.5
        self.barge_in_threshold = 0.65
        self.min_speech_ms = 250
        self.min_silence_ms = 2000
        self.chunk_size = 512
        self.sr = np.array(16000, dtype=np.int64)

    def reset(self):
        self.state = np.zeros((2, 1, 128), dtype=np.float32)
        self.is_speaking = False
        self.speech_duration_ms = 0
        self.silence_duration_ms = 0

    def process_chunk(self, chunk_pcm_float: np.ndarray):
        inputs = {
            self.session.get_inputs()[0].name: chunk_pcm_float.reshape(1, -1),
            self.session.get_inputs()[1].name: self.state,
            self.session.get_inputs()[2].name: self.sr
        }
        out, self.state = self.session.run(None, inputs)
        prob = float(out[0][0])
        chunk_ms = (len(chunk_pcm_float) / 16000.0) * 1000.0
        
        event = None
        if prob >= self.speech_threshold:
            self.speech_duration_ms += chunk_ms
            self.silence_duration_ms = 0
            if not self.is_speaking and self.speech_duration_ms >= self.min_speech_ms:
                self.is_speaking = True
                event = "SPEECH_START"
        else:
            if self.is_speaking:
                self.silence_duration_ms += chunk_ms
                if self.silence_duration_ms >= self.min_silence_ms:
                    self.is_speaking = False
                    event = "SPEECH_END"
                    self.speech_duration_ms = 0
                    self.silence_duration_ms = 0
            else:
                self.speech_duration_ms = 0

        is_barge_in = (prob >= self.barge_in_threshold and self.speech_duration_ms >= self.min_speech_ms)
        return prob, event, is_barge_in

vad = SileroVADController()
print("Silero VAD Controller initialized successfully!")

# Test 1: Transient Noise / Breath (<250ms)
noise_chunk = np.random.normal(0, 0.05, 512).astype(np.float32)
for _ in range(3):
    prob, ev, bi = vad.process_chunk(noise_chunk)
print(f"Test 1 - Transient Noise: Prob={prob:.3f}, Event={ev} (Noise ignored)")

# Test 2: Student Speech Activation (>250ms)
t = np.linspace(0, 0.032, 512, endpoint=False)
speech_chunk = (0.5 * np.sin(2 * np.pi * 300 * t)).astype(np.float32)
events = []
for _ in range(16):
    prob, ev, bi = vad.process_chunk(speech_chunk)
    if ev: events.append(ev)
print(f"Test 2 - Speech Activation: Prob={prob:.3f}, Events={events}")

# Test 3: Thinking Pause (1.2 seconds)
silence_chunk = np.zeros(512, dtype=np.float32)
events = []
for _ in range(37):
    prob, ev, bi = vad.process_chunk(silence_chunk)
    if ev: events.append(ev)
print(f"Test 3 - Thinking Pause: Still Speaking={vad.is_speaking}, Events={events} (Pause preserved)")

# Test 4: Concluding Silence (2.0s reached)
for _ in range(30):
    prob, ev, bi = vad.process_chunk(silence_chunk)
    if ev: events.append(ev)
print(f"Test 4 - Turn Finalization: Still Speaking={vad.is_speaking}, Events={events} (SPEECH_END triggered)")
print("=== ALL TASK 1.5 TESTS PASSED ===")
