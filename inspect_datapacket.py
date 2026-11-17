
import livekit.rtc as rtc
import inspect
print(rtc.DataPacket if hasattr(rtc, 'DataPacket') else 'No DataPacket')
# check RoomEvent or Room callbacks
print([k for k in dir(rtc.Room) if not k.startswith('_')])
