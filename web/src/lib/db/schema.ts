import fs from "fs";
import path from "path";
import * as crypto from "crypto";
import { DBConnection, getStorageBaseDir } from "./connection";
import { hashPassword, verifyPassword } from "../auth";
import { ExamPreset } from "@/types/database";

// ============================================================================
// SCHEMA DDL, MIGRATIONS & SEEDING
// ============================================================================

export function ensureColumnExists(db: DBConnection, table: string, column: string, def: string): void {
  try {
    const res = db.exec(`PRAGMA table_info(${table})`);
    if (res.length > 0 && res[0].values) {
      const colNames = res[0].values.map((v: any[]) => v[1]);
      if (!colNames.includes(column)) {
        db.run(`ALTER TABLE ${table} ADD COLUMN ${column} ${def};`);
      }
    }
  } catch (err) {
    console.warn(`Could not add column ${column} to ${table}:`, err);
  }
}

export function seedDefaultInstructorsIfEmpty(db: DBConnection): void {
  try {
    // Task 11.1 & 11.2: Strictly disable default demo/test instructor auto-seeding in production
    if (process.env.NODE_ENV === "production") {
      return;
    }

    // Development / Test environments only below:
    // Delete prof1 so ta1 is strictly the sole default seed in the entire database
    db.run("DELETE FROM instructors WHERE username = 'prof1';");
    db.run("DELETE FROM instructor_sessions WHERE instructor_id = 'inst_prof1';");

    const taRes = db.exec("SELECT COUNT(*) FROM instructors WHERE username = 'ta1'");
    const hasTa1 = (taRes[0]?.values[0]?.[0] as number) || 0;
    if (hasTa1 === 0) {
      const now = new Date().toISOString();
      const taCreds = hashPassword("password");

      db.run(
        `INSERT INTO instructors (id, username, display_name, password_hash, salt, role, department, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          "inst_ta1",
          "ta1",
          "TA 1 (Teaching Assistant)",
          taCreds.hash,
          taCreds.salt,
          "TA",
          "Computer Science & Systems Lab",
          now,
        ]
      );
    }

    // Ensure all existing courses in the dataset are attributed to ta1 as the supervising TA
    db.run(`
      UPDATE exams SET
        supervising_ta_id = 'inst_ta1',
        supervising_ta_name = 'TA 1 (Teaching Assistant)'
      WHERE supervising_ta_id IS NULL OR supervising_ta_id = '' OR supervising_ta_id = 'inst_prof1';
    `);

    db.run(`
      UPDATE exams SET
        lead_professor = COALESCE(lead_professor, instructor_id, 'Lead Faculty')
      WHERE lead_professor IS NULL OR lead_professor = '';
    `);

    db.run(`
      UPDATE exam_sessions SET
        supervising_ta_id = 'inst_ta1',
        supervising_ta_name = 'TA 1 (Teaching Assistant)'
      WHERE supervising_ta_id IS NULL OR supervising_ta_id = '' OR supervising_ta_id = 'inst_prof1';
    `);

    db.run(`
      UPDATE exam_sessions SET
        lead_professor = COALESCE(lead_professor, instructor_id, 'Lead Faculty')
      WHERE lead_professor IS NULL OR lead_professor = '';
    `);
  } catch (err) {
    console.error("seedDefaultInstructorsIfEmpty error:", err);
  }
}

export function seedDefaultStudentsIfEmpty(db: DBConnection): void {
  // Strictly disabled in production
  if (process.env.NODE_ENV === "production") {
    return;
  }
  try {
    const studentRes = db.exec("SELECT COUNT(*) FROM students");
    const studentCount = (studentRes[0]?.values[0]?.[0] as number) || 0;
    if (studentCount === 0) {
      console.log("[OpenViva DB] Auto-seeding default 10 test students (reg1 to reg10)...");
      const now = new Date().toISOString();
      for (let i = 1; i <= 10; i++) {
        const regNo = `reg${i}`;
        const name = `student ${i}`;
        const { hash, salt } = hashPassword(regNo);
        db.run(
          `INSERT INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at)
           VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)`,
          [regNo, name, "Computer Science", "2026", hash, salt, now]
        );
      }
      console.log("[OpenViva DB] 10 test students auto-seeded successfully.");
    }
  } catch (err) {
    console.error("seedDefaultStudentsIfEmpty error:", err);
  }
}

export function migrateLegacyPresetsIfEmpty(db: DBConnection): void {
  try {
    const res = db.exec("SELECT COUNT(*) AS c FROM exams");
    const count = (res[0]?.values[0]?.[0] as number) || 0;
    if (count > 0) return;

    const baseDir = getStorageBaseDir();
    const presetsDir = path.join(baseDir, "presets");
    if (!fs.existsSync(presetsDir)) return;

    const files = fs.readdirSync(presetsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(presetsDir, file), "utf-8");
        const preset: ExamPreset = JSON.parse(content);
        if (!preset.id || !preset.courseTitle) continue;

        const accessType = preset.accessControl?.type || "OPEN";
        db.run(
          `INSERT OR REPLACE INTO exams (
            id, course_title, instructor_id, lead_professor, supervising_ta_id, supervising_ta_name,
            difficulty_tier, duration_minutes,
            student_decides_weightage, global_directive, access_type, total_topics,
            system_prompt, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            preset.id,
            preset.courseTitle,
            preset.instructorId || "Instructor",
            preset.leadProfessor || preset.instructorId || "Course Faculty In-Charge",
            "inst_ta1",
            "TA 1 (Teaching Assistant)",
            preset.difficultyTier || "undergrad_3",
            preset.durationMinutes || 10,
            preset.studentDecidesWeightage !== false ? 1 : 0,
            preset.globalDirective || null,
            accessType,
            preset.totalTopics || (preset.topics?.length || 0),
            preset.systemPrompt || "",
            preset.createdAt || new Date().toISOString(),
            preset.updatedAt || null,
          ]
        );

        if (Array.isArray(preset.topics)) {
          preset.topics.forEach((topic, idx) => {
            db.run(
              `INSERT OR REPLACE INTO exam_topics (
                id, exam_id, section_number, title, level, page, bbox, selected, comment, sort_order
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                topic.id || `topic_${idx}`,
                preset.id,
                topic.section_number || null,
                topic.title || `Topic ${idx + 1}`,
                topic.level || 1,
                topic.page || 1,
                topic.bbox ? JSON.stringify(topic.bbox) : null,
                topic.selected !== false ? 1 : 0,
                topic.comment || null,
                idx,
              ]
            );
          });
        }

        if (accessType === "RESTRICTED" && Array.isArray(preset.accessControl?.allowedStudents)) {
          for (const s of preset.accessControl.allowedStudents) {
            if (s.name && s.regNo) {
              db.run(
                `INSERT OR IGNORE INTO allowed_students (exam_id, student_name, reg_no) VALUES (?, ?, ?)`,
                [preset.id, s.name.trim(), s.regNo.trim().toUpperCase()]
              );
            }
          }
        }
      } catch (err) {
        console.warn(`Failed to migrate preset file ${file}:`, err);
      }
    }
  } catch (err) {
    console.error("Preset migration error:", err);
  }
}

export function migrateLegacyRecordsIfEmpty(db: DBConnection): void {
  try {
    const res = db.exec("SELECT COUNT(*) AS c FROM exam_sessions");
    const count = (res[0]?.values[0]?.[0] as number) || 0;
    if (count > 0) return;

    const baseDir = getStorageBaseDir();
    const recordsDir = path.join(baseDir, "records");
    if (!fs.existsSync(recordsDir)) return;

    const files = fs.readdirSync(recordsDir).filter((f) => f.endsWith(".json"));
    for (const file of files) {
      try {
        const content = fs.readFileSync(path.join(recordsDir, file), "utf-8");
        const r: any = JSON.parse(content);
        if (!r.sessionId) continue;

        db.run(
          `INSERT OR REPLACE INTO exam_sessions (
            session_id, exam_id, course_title, instructor_id, lead_professor, supervising_ta_id, supervising_ta_name,
            student_id, status, started_at, ended_at, actual_duration_seconds, turn_count,
            recording_url, error, system_prompt_tokens, total_conversation_tokens,
            peak_context_tokens, average_tokens_per_turn, created_at, updated_at
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            r.sessionId,
            r.examId || "unknown_exam",
            r.courseTitle || "Oral Defense Examination",
            r.instructorId || "Instructor",
            r.leadProfessor || r.instructorId || "Course Faculty In-Charge",
            "inst_ta1",
            "TA 1 (Teaching Assistant)",
            r.studentId || "unknown_student",
            r.status || "COMPLETED",
            r.startedAt || new Date().toISOString(),
            r.endedAt || null,
            r.actualDurationSeconds || 0,
            r.turnCount || (r.transcript?.length || 0),
            r.recordingUrl || null,
            r.error || null,
            r.tokenMetrics?.systemPromptTokens || 0,
            r.tokenMetrics?.totalConversationTokens || 0,
            r.tokenMetrics?.peakContextTokens || 0,
            r.tokenMetrics?.averageTokensPerTurn || 0,
            r.createdAt || new Date().toISOString(),
            r.updatedAt || null,
          ]
        );

        if (Array.isArray(r.transcript)) {
          r.transcript.forEach((t: any, idx: number) => {
            db.run(
              `INSERT OR REPLACE INTO transcript_turns (
                id, session_id, turn_index, speaker, text, timestamp, is_interrupted, tokens, cumulative_tokens
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
              [
                t.id || `turn_${idx}`,
                r.sessionId,
                idx,
                t.speaker || "examiner",
                t.text || "",
                t.timestamp || new Date().toISOString(),
                t.isInterrupted ? 1 : 0,
                t.tokens || 0,
                t.cumulativeTokens || 0,
              ]
            );
          });
        }

        if (r.evaluationResult) {
          const ev = r.evaluationResult;
          db.run(
            `INSERT OR REPLACE INTO evaluations (
              session_id, overall_score, verdict, conceptual_rigor_score, clarity_score,
              adversarial_resistance_score, question_adherence_score, spoken_conciseness_score,
              subtopic_breakdown_json, strengths_json, weaknesses_json,
              candidate_strengths_json, diagnostic_weaknesses_json, behavioral_flags_json,
              behavioral_audit_json, committee_remarks, improvement_feedback,
              duration_minutes, evaluated_at, evaluated_by_ta_id, evaluated_by_ta_name
            ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
            [
              r.sessionId,
              ev.overallScore || 0,
              ev.verdict || "PASS",
              ev.conceptualRigorScore || 0,
              ev.clarityScore || 0,
              ev.adversarialResistanceScore || 0,
              ev.dimensionScores?.questionAdherence || null,
              ev.dimensionScores?.spokenConciseness || null,
              ev.subtopicBreakdown ? JSON.stringify(ev.subtopicBreakdown) : null,
              ev.strengths ? JSON.stringify(ev.strengths) : null,
              ev.weaknesses ? JSON.stringify(ev.weaknesses) : null,
              ev.candidateStrengths ? JSON.stringify(ev.candidateStrengths) : null,
              ev.diagnosticWeaknesses ? JSON.stringify(ev.diagnosticWeaknesses) : null,
              ev.behavioralFlags ? JSON.stringify(ev.behavioralFlags) : null,
              ev.behavioralAudit ? JSON.stringify(ev.behavioralAudit) : null,
              ev.committeeRemarks || "",
              ev.improvementFeedback || null,
              ev.durationMinutes || null,
              ev.evaluatedAt || new Date().toISOString(),
              "inst_ta1",
              "TA 1 (Teaching Assistant)",
            ]
          );
        }
      } catch (err) {
        console.warn(`Failed to migrate record file ${file}:`, err);
      }
    }
  } catch (err) {
    console.error("Record migration error:", err);
  }
}

export function initDatabaseSchema(db: DBConnection): void {
  // Enable foreign keys
  db.run("PRAGMA foreign_keys = ON;");

  // DDL: Create the relational tables
  db.run(`
    CREATE TABLE IF NOT EXISTS instructors (
      id TEXT PRIMARY KEY,
      username TEXT UNIQUE NOT NULL,
      display_name TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      role TEXT NOT NULL DEFAULT 'TA',
      department TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS instructor_sessions (
      token TEXT PRIMARY KEY,
      instructor_id TEXT NOT NULL REFERENCES instructors(id) ON DELETE CASCADE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS staff_audit_logs (
      id TEXT PRIMARY KEY,
      event_type TEXT NOT NULL,
      actor_id TEXT,
      actor_username TEXT,
      actor_role TEXT,
      target_user_id TEXT,
      target_username TEXT,
      target_role TEXT,
      ip_address TEXT,
      details_json TEXT,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS students (
      reg_no TEXT PRIMARY KEY,
      student_name TEXT NOT NULL,
      department TEXT NOT NULL,
      cohort TEXT NOT NULL,
      password_hash TEXT NOT NULL,
      salt TEXT NOT NULL,
      must_change_password INTEGER NOT NULL DEFAULT 1,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS student_sessions (
      token TEXT PRIMARY KEY,
      reg_no TEXT NOT NULL REFERENCES students(reg_no) ON DELETE CASCADE,
      is_temp INTEGER NOT NULL DEFAULT 0,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS student_biometrics (
      reg_no TEXT PRIMARY KEY REFERENCES students(reg_no) ON DELETE CASCADE,
      student_name TEXT NOT NULL,
      face_image_path TEXT,
      face_embedding BLOB,
      face_enrolled_at TEXT,
      voice_sample_path TEXT,
      voice_embedding BLOB,
      voice_enrolled_at TEXT,
      enrolled_ip_address TEXT,
      enrolled_user_agent TEXT,
      verified_by_ta_id TEXT REFERENCES instructors(id),
      verification_status TEXT NOT NULL DEFAULT 'PENDING',
      last_face_similarity REAL,
      last_liveness_score REAL
    );

    CREATE TABLE IF NOT EXISTS exams (
      id TEXT PRIMARY KEY,
      course_title TEXT NOT NULL,
      instructor_id TEXT NOT NULL,
      lead_professor TEXT,
      supervising_ta_id TEXT,
      supervising_ta_name TEXT,
      difficulty_tier TEXT NOT NULL DEFAULT 'undergrad_3',
      duration_minutes INTEGER NOT NULL DEFAULT 10,
      student_decides_weightage INTEGER NOT NULL DEFAULT 1,
      global_directive TEXT,
      access_type TEXT NOT NULL DEFAULT 'OPEN',
      total_topics INTEGER NOT NULL DEFAULT 0,
      system_prompt TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS exam_topics (
      id TEXT NOT NULL,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      section_number TEXT,
      title TEXT NOT NULL,
      level INTEGER NOT NULL DEFAULT 1,
      page INTEGER NOT NULL DEFAULT 1,
      bbox TEXT,
      selected INTEGER NOT NULL DEFAULT 1,
      comment TEXT,
      sort_order INTEGER NOT NULL DEFAULT 0,
      PRIMARY KEY (exam_id, id)
    );

    CREATE TABLE IF NOT EXISTS allowed_students (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      exam_id TEXT NOT NULL REFERENCES exams(id) ON DELETE CASCADE,
      student_name TEXT NOT NULL,
      reg_no TEXT NOT NULL,
      UNIQUE(exam_id, reg_no)
    );

    CREATE TABLE IF NOT EXISTS exam_sessions (
      session_id TEXT PRIMARY KEY,
      exam_id TEXT NOT NULL,
      course_title TEXT NOT NULL,
      instructor_id TEXT,
      lead_professor TEXT,
      supervising_ta_id TEXT,
      supervising_ta_name TEXT,
      student_id TEXT NOT NULL,
      status TEXT NOT NULL,
      started_at TEXT NOT NULL,
      ended_at TEXT,
      actual_duration_seconds INTEGER NOT NULL DEFAULT 0,
      turn_count INTEGER NOT NULL DEFAULT 0,
      recording_url TEXT,
      error TEXT,
      system_prompt_tokens INTEGER DEFAULT 0,
      total_conversation_tokens INTEGER DEFAULT 0,
      peak_context_tokens INTEGER DEFAULT 0,
      average_tokens_per_turn INTEGER DEFAULT 0,
      created_at TEXT NOT NULL,
      updated_at TEXT
    );

    CREATE TABLE IF NOT EXISTS transcript_turns (
      id TEXT PRIMARY KEY,
      session_id TEXT NOT NULL REFERENCES exam_sessions(session_id) ON DELETE CASCADE,
      turn_index INTEGER NOT NULL,
      speaker TEXT NOT NULL,
      text TEXT NOT NULL,
      timestamp TEXT NOT NULL,
      is_interrupted INTEGER NOT NULL DEFAULT 0,
      tokens INTEGER NOT NULL DEFAULT 0,
      cumulative_tokens INTEGER NOT NULL DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS evaluations (
      session_id TEXT PRIMARY KEY REFERENCES exam_sessions(session_id) ON DELETE CASCADE,
      overall_score INTEGER NOT NULL,
      verdict TEXT NOT NULL,
      conceptual_rigor_score INTEGER NOT NULL DEFAULT 0,
      clarity_score INTEGER NOT NULL DEFAULT 0,
      adversarial_resistance_score INTEGER NOT NULL DEFAULT 0,
      question_adherence_score INTEGER,
      spoken_conciseness_score INTEGER,
      subtopic_breakdown_json TEXT,
      strengths_json TEXT,
      weaknesses_json TEXT,
      candidate_strengths_json TEXT,
      diagnostic_weaknesses_json TEXT,
      behavioral_flags_json TEXT,
      behavioral_audit_json TEXT,
      committee_remarks TEXT,
      improvement_feedback TEXT,
      duration_minutes INTEGER,
      evaluated_at TEXT NOT NULL,
      evaluated_by_ta_id TEXT,
      evaluated_by_ta_name TEXT
    );

    CREATE TABLE IF NOT EXISTS chamber_leases (
      room_name TEXT PRIMARY KEY,
      claimed_by TEXT NOT NULL,
      claimed_at TEXT NOT NULL,
      heartbeat_at TEXT NOT NULL,
      expires_at TEXT NOT NULL
    );

    CREATE INDEX IF NOT EXISTS idx_chamber_leases_expires ON chamber_leases(expires_at);

    CREATE INDEX IF NOT EXISTS idx_instructors_user ON instructors(username);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON instructor_sessions(token);
    CREATE INDEX IF NOT EXISTS idx_students_reg ON students(reg_no);
    CREATE INDEX IF NOT EXISTS idx_student_sessions_token ON student_sessions(token);
    CREATE INDEX IF NOT EXISTS idx_student_sessions_reg ON student_sessions(reg_no);
    CREATE INDEX IF NOT EXISTS idx_biometrics_status ON student_biometrics(verification_status);
    CREATE INDEX IF NOT EXISTS idx_topics_exam ON exam_topics(exam_id, sort_order);
    CREATE INDEX IF NOT EXISTS idx_students_exam ON allowed_students(exam_id, reg_no);
    CREATE INDEX IF NOT EXISTS idx_sessions_exam ON exam_sessions(exam_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_student ON exam_sessions(student_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_status ON exam_sessions(status);
    CREATE INDEX IF NOT EXISTS idx_sessions_started_desc ON exam_sessions(started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_student_started ON exam_sessions(student_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_ta_started ON exam_sessions(supervising_ta_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_sessions_exam_started ON exam_sessions(exam_id, started_at DESC);
    CREATE INDEX IF NOT EXISTS idx_exams_created_desc ON exams(created_at DESC);
    CREATE INDEX IF NOT EXISTS idx_evaluations_verdict ON evaluations(verdict);
    CREATE INDEX IF NOT EXISTS idx_turns_session ON transcript_turns(session_id, turn_index);
  `);

  // Ensure safe column additions if database file was created on an older schema
  ensureColumnExists(db, "exams", "lead_professor", "TEXT");
  ensureColumnExists(db, "exams", "supervising_ta_id", "TEXT");
  ensureColumnExists(db, "exams", "supervising_ta_name", "TEXT");

  ensureColumnExists(db, "exam_sessions", "lead_professor", "TEXT");
  ensureColumnExists(db, "exam_sessions", "supervising_ta_id", "TEXT");
  ensureColumnExists(db, "exam_sessions", "supervising_ta_name", "TEXT");
  ensureColumnExists(db, "exam_sessions", "recording_url", "TEXT");

  ensureColumnExists(db, "evaluations", "evaluated_by_ta_id", "TEXT");
  ensureColumnExists(db, "evaluations", "evaluated_by_ta_name", "TEXT");

  ensureColumnExists(db, "student_biometrics", "last_face_similarity", "REAL");
  ensureColumnExists(db, "student_biometrics", "last_liveness_score", "REAL");

  // Now safely create indices on newly ensured columns
  db.run(`
    CREATE INDEX IF NOT EXISTS idx_exams_ta ON exams(supervising_ta_id);
    CREATE INDEX IF NOT EXISTS idx_sessions_ta ON exam_sessions(supervising_ta_id);
  `);

  // Auto-seed default offline TA credentials if empty
  seedDefaultInstructorsIfEmpty(db);

  // Self-healing referential integrity: purge historical orphan test rows
  try {
    db.run("DELETE FROM instructor_sessions WHERE instructor_id NOT IN (SELECT id FROM instructors);");
    db.run("DELETE FROM student_sessions WHERE reg_no NOT IN (SELECT reg_no FROM students);");
    db.run("DELETE FROM student_biometrics WHERE reg_no NOT IN (SELECT reg_no FROM students);");
    db.run("DELETE FROM exam_topics WHERE exam_id NOT IN (SELECT id FROM exams);");
    db.run("DELETE FROM allowed_students WHERE exam_id NOT IN (SELECT id FROM exams);");
    db.run("DELETE FROM transcript_turns WHERE session_id NOT IN (SELECT session_id FROM exam_sessions);");
    db.run("DELETE FROM evaluations WHERE session_id NOT IN (SELECT session_id FROM exam_sessions);");
  } catch (purgeErr) {
    console.warn("[OpenViva DB] Non-fatal orphan cleanup warning:", purgeErr);
  }

  // Ingest existing JSON files if SQLite tables are empty
  migrateLegacyPresetsIfEmpty(db);
  migrateLegacyRecordsIfEmpty(db);
}

