import sqlite3
from collections import Counter

con = sqlite3.connect('/home/savan/openviva/storage/openviva.db')
cur = con.cursor()
cur.execute('PRAGMA foreign_key_check;')
rows = cur.fetchall()
print(f'Total FK violations: {len(rows)}')
counts = Counter(r[0] for r in rows)
print(f'Violations per table: {dict(counts)}')

for r in rows[:15]:
    table = r[0]
    rowid = r[1]
    parent = r[2]
    fkid = r[3]
    cur.execute(f"SELECT * FROM {table} WHERE rowid = ?", (rowid,))
    row_data = cur.fetchone()
    print(f'Table: {table}, Rowid: {rowid}, Parent: {parent}, FKID: {fkid}')
    print(f'   Row data: {row_data}')
