
import sqlite3

con = sqlite3.connect('/home/savan/openviva/storage/openviva.db')
cur = con.cursor()

print("Purging historical orphan test rows...")
cur.execute("DELETE FROM instructor_sessions WHERE instructor_id NOT IN (SELECT id FROM instructors);")
print("  Purged orphan instructor_sessions:", cur.rowcount)

cur.execute("DELETE FROM student_sessions WHERE reg_no NOT IN (SELECT reg_no FROM students);")
print("  Purged orphan student_sessions:", cur.rowcount)

cur.execute("DELETE FROM student_biometrics WHERE reg_no NOT IN (SELECT reg_no FROM students);")
print("  Purged orphan student_biometrics:", cur.rowcount)

cur.execute("DELETE FROM exam_topics WHERE exam_id NOT IN (SELECT id FROM exams);")
print("  Purged orphan exam_topics:", cur.rowcount)

cur.execute("DELETE FROM allowed_students WHERE exam_id NOT IN (SELECT id FROM exams);")
print("  Purged orphan allowed_students:", cur.rowcount)

cur.execute("DELETE FROM transcript_turns WHERE session_id NOT IN (SELECT session_id FROM exam_sessions);")
print("  Purged orphan transcript_turns:", cur.rowcount)

cur.execute("DELETE FROM evaluations WHERE session_id NOT IN (SELECT session_id FROM exam_sessions);")
print("  Purged orphan evaluations:", cur.rowcount)

con.commit()

cur.execute("PRAGMA foreign_key_check;")
violations = cur.fetchall()
print(f"\nRemaining foreign key violations: {len(violations)}")
assert len(violations) == 0, f"Expected 0 violations, got {len(violations)}"

con.close()
print("Database referential integrity restored to 100%!")
