import sqlite3

con = sqlite3.connect('/home/savan/openviva/storage/openviva.db')
cur = con.cursor()

# 1. Instructor sessions
cur.execute("SELECT token, instructor_id, expires_at FROM instructor_sessions WHERE instructor_id NOT IN (SELECT id FROM instructors)")
inst_orphans = cur.fetchall()
print(f"Orphan instructor_sessions count: {len(inst_orphans)}")
for o in inst_orphans:
    print("   ", o)

# 2. Evaluations
cur.execute("SELECT session_id, overall_score, evaluated_at FROM evaluations WHERE session_id NOT IN (SELECT session_id FROM exam_sessions)")
eval_orphans = cur.fetchall()
print(f"\nOrphan evaluations count: {len(eval_orphans)}")
for o in eval_orphans[:10]:
    print("   ", o)

# 3. Transcript turns
cur.execute("SELECT DISTINCT session_id FROM transcript_turns WHERE session_id NOT IN (SELECT session_id FROM exam_sessions)")
turn_orphans = cur.fetchall()
print(f"\nDistinct orphan session_ids in transcript_turns: {len(turn_orphans)}")
for o in turn_orphans[:10]:
    print("   ", o)

con.close()
