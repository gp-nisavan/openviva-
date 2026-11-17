
const path = require('path');
const Database = require('better-sqlite3');

const dbPath = '/home/savan/openviva/storage/openviva.db';
const db = new Database(dbPath, { timeout: 5000 });

console.log('[TEST] Checking Pragmas on live openviva.db...');
console.log('journal_mode:', db.pragma('journal_mode', { simple: true }));
console.log('synchronous:', db.pragma('synchronous', { simple: true }));
console.log('busy_timeout:', db.pragma('busy_timeout', { simple: true }));
console.log('foreign_keys:', db.pragma('foreign_keys', { simple: true }));

console.log('[TEST] Checking table count...');
const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name;").all();
console.log('Tables found (' + tables.length + '):', tables.map(t => t.name).join(', '));

console.log('[TEST] Checking student row...');
const student = db.prepare('SELECT reg_no, student_name, department FROM students LIMIT 1;').get();
console.log('Sample student:', student);

console.log('[TEST] Checking biometric BLOB length...');
const bio = db.prepare('SELECT reg_no, LENGTH(face_embedding) as face_len, LENGTH(voice_embedding) as voice_len FROM student_biometrics WHERE face_embedding IS NOT NULL LIMIT 1;').get();
console.log('Sample biometric BLOB:', bio);

db.close();
console.log('[TEST] Native better-sqlite3 test complete!');
