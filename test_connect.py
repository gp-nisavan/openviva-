
import asyncio
from livekit import api, rtc

LIVEKIT_URL = 'http://10.10.16.13:7880'
API_KEY = 'devkey'
API_SECRET = 'secret_openviva_key_2026_at_least_32_chars!'
ROOM_NAME = 'openviva-exam-room'

async def test():
    token = api.AccessToken(API_KEY, API_SECRET) \
        .with_identity('test_worker') \
        .with_name('Test Worker') \
        .with_grants(api.VideoGrants(room_join=True, room=ROOM_NAME, can_subscribe=True, can_publish_data=True)) \
        .to_jwt()
    
    room = rtc.Room()
    print('Connecting to room...')
    await room.connect(LIVEKIT_URL, token)
    print('Connected successfully!')
    print('Room name:', room.name)
    print('Local participant:', room.local_participant.identity)
    print('Remote participants:', [p.identity for p in room.remote_participants.values()])
    await room.disconnect()
    print('Disconnected clean!')

asyncio.run(test())
