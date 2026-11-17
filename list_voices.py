from kokoro_onnx import Kokoro
kokoro = Kokoro("/home/savan/openviva/models/kokoro/kokoro-v1.0.onnx", "/home/savan/openviva/models/kokoro/voices-v1.0.bin")
voices = kokoro.get_voices()
indian = [v for v in voices if v.startswith("h") or "in" in v]
british = [v for v in voices if v.startswith("b")]
american = [v for v in voices if v.startswith("a")]
print("Hindi/Indian voices:", indian)
print("British voices:", british)
print("American voices (sample):", american[:6])
