
import inspect
from kokoro_onnx import Kokoro
print(inspect.getsource(Kokoro.__init__))
print(inspect.getsource(Kokoro.get_voice_names) if hasattr(Kokoro, 'get_voice_names') else 'No get_voice_names')
