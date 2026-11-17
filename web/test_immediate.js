
const Database = require('better-sqlite3');
const dbPath = '/home/savan/openviva/storage/openviva.db';

// Test BEGIN IMMEDIATE with better-sqlite3
const db = new Database(dbPath, { timeout: 5000 });
db.pragma('journal_mode = WAL');
db.pragma('busy_timeout = 5000');

console.log('Testing BEGIN IMMEDIATE...');
db.exec('BEGIN IMMEDIATE;');
db.exec('UPDATE exam_sessions SET actual_duration_seconds = actual_duration_seconds + 0 WHERE 1=0;');
db.exec('COMMIT;');
console.log('BEGIN IMMEDIATE succeeded!');

db.close();
