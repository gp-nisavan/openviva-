
import sys
# Check if silero or livekit-plugins-silero is installed
try:
    import livekit.plugins.silero as silero
    print("livekit.plugins.silero is installed:", silero)
except ImportError:
    print("livekit.plugins.silero NOT installed")

try:
    import silero_vad
    print("silero_vad is installed")
except ImportError:
    print("silero_vad NOT installed")
