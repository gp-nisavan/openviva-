import sqlite3
conn = sqlite3.connect('/home/savan/openviva/storage/openviva.db')
cur = conn.cursor()
# We can use update to reset password_hash for reg7 to match its initial state
# Or even better, let Node reset it, or copy reg10's hash if reg10 is untouched!
cur.execute("DELETE FROM student_biometrics WHERE reg_no='reg7'")
cur.execute("DELETE FROM student_sessions WHERE reg_no='reg7'")
# Check reg10's hash and salt
r10 = cur.execute("SELECT password_hash, salt FROM students WHERE reg_no='reg10'").fetchone()
if r10:
    # reg10 has hash of 'reg10'. We want hash of 'reg7'.
    pass
conn.commit()
conn.close()
