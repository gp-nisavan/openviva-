import sqlite3
import requests
import base64

# Extract embedding from daemon
res = requests.post("http://127.0.0.1:8002/extract-biometrics", json={
    "face_image_path": "/home/savan/openviva/storage/biometrics/faces/reg1.jpg",
    "voice_audio_path": "/home/savan/openviva/storage/biometrics/voices/reg1.wav",
    "verify_liveness": True
})
data = res.json()
assert data.get("success"), f"Extraction failed: {data}"

face_bytes = base64.b64decode(data["face_embedding_base64"])
voice_bytes = base64.b64decode(data["voice_embedding_base64"])

con = sqlite3.connect("/home/savan/openviva/storage/openviva.db")
cur = con.cursor()
cur.execute("""
    UPDATE student_biometrics
    SET face_embedding = ?, voice_embedding = ?, verification_status = 'AUTHENTICATED'
    WHERE reg_no = 'reg1'
""", (face_bytes, voice_bytes))
con.commit()
con.close()
print("Restored reg1 biometric ground truth!")
