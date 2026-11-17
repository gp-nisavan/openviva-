
import livekit.rtc as rtc
import inspect
import numpy as np

print("AudioFrame.__init__:", inspect.signature(rtc.AudioFrame.__init__))
# Test creating dummy frame
pcm = np.zeros(480, dtype=np.int16).tobytes()
frame = rtc.AudioFrame(data=pcm, sample_rate=24000, num_channels=1, samples_per_channel=480)
print("Created AudioFrame successfully:", frame)
