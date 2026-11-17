
import livekit.rtc as rtc
import inspect
print("AudioSource:", dir(rtc.AudioSource))
print("AudioSource.__init__:", inspect.signature(rtc.AudioSource.__init__))
print("capture_frame:", inspect.signature(rtc.AudioSource.capture_frame))
print("LocalAudioTrack.create_audio_track:", inspect.signature(rtc.LocalAudioTrack.create_audio_track))
