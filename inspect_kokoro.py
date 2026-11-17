
import inspect
from kokoro_onnx import Kokoro
print(inspect.signature(Kokoro.__init__))
print(Kokoro.__doc__)
