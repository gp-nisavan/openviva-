import { DBConnection, getDB, persistDatabase } from "./connection";
import { hashPassword, generateSessionToken } from "../auth";
import {
  InstructorAccount,
  InstructorRole,
  StudentAccount,
  StudentBiometricsRecord,
} from "@/types/database";

// ============================================================================
// INSTRUCTOR AUTHENTICATION & SESSION DATABASE OPERATIONS
// ============================================================================

export async function getInstructorByUsername(username: string): Promise<any | null> {
  if (!username) return null;
  const db = await getDB();
  const res = db.exec("SELECT * FROM instructors WHERE LOWER(username) = LOWER(?)", [username.trim()]);
  if (!res.length || !res[0].values || !res[0].values.length) return null;
  const cols = res[0].columns;
  const val = res[0].values[0];
  const row: any = {};
  cols.forEach((c, i) => (row[c] = val[i]));
  return row;
}

export async function getInstructorById(id: string): Promise<InstructorAccount | null> {
  if (!id) return null;
  const db = await getDB();
  const res = db.exec("SELECT id, username, display_name, role, department, created_at FROM instructors WHERE id = ?", [id.trim()]);
  if (!res.length || !res[0].values || !res[0].values.length) return null;
  const cols = res[0].columns;
  const val = res[0].values[0];
  const row: any = {};
  cols.forEach((c, i) => (row[c] = val[i]));
  return {
    id: row.id,
    username: row.username,
    displayName: row.display_name,
    role: row.role as InstructorRole,
    department: row.department || undefined,
    createdAt: row.created_at,
  };
}

export async function createInstructor(data: {
  username: string;
  displayName: string;
  password: string;
  role?: InstructorRole;
  department?: string;
}): Promise<InstructorAccount> {
  const { username, displayName, password, role = "TA", department } = data;
  if (!username.trim() || !displayName.trim() || !password) {
    throw new Error("Username, display name, and password are required.");
  }
  const db = await getDB();
  const existing = await getInstructorByUsername(username);
  if (existing) {
    throw new Error(`Username "${username}" is already registered.`);
  }

  const { hash, salt } = hashPassword(password);
  const id = `inst_${username.trim().toLowerCase().replace(/[^a-z0-9]/g, "_")}_${Date.now().toString(36)}`;
  const now = new Date().toISOString();

  db.run(
    `INSERT INTO instructors (id, username, display_name, password_hash, salt, role, department, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    [id, username.trim().toLowerCase(), displayName.trim(), hash, salt, role, department || null, now]
  );
  persistDatabase();

  return {
    id,
    username: username.trim().toLowerCase(),
    displayName: displayName.trim(),
    role,
    department,
    createdAt: now,
  };
}

export async function createInstructorSession(instructorId: string, daysValid = 7): Promise<string> {
  const db = await getDB();
  const token = generateSessionToken();
  const now = new Date();
  const expires = new Date(now.getTime() + daysValid * 24 * 60 * 60 * 1000).toISOString();

  db.run(
    `INSERT INTO instructor_sessions (token, instructor_id, expires_at, created_at) VALUES (?, ?, ?, ?)`,
    [token, instructorId, expires, now.toISOString()]
  );
  persistDatabase();
  return token;
}

export async function validateInstructorSession(token: string): Promise<InstructorAccount | null> {
  if (!token) return null;
  const db = await getDB();
  const now = new Date().toISOString();
  const res = db.exec(
    `SELECT i.id, i.username, i.display_name, i.role, i.department, i.created_at
     FROM instructor_sessions s
     JOIN instructors i ON s.instructor_id = i.id
     WHERE s.token = ? AND s.expires_at > ?`,
    [token, now]
  );
  if (!res.length || !res[0].values || !res[0].values.length) return null;

  const row = res[0].values[0];
  return {
    id: row[0] as string,
    username: row[1] as string,
    displayName: row[2] as string,
    role: row[3] as InstructorRole,
    department: (row[4] as string) || undefined,
    createdAt: row[5] as string,
  };
}

export async function deleteInstructorSession(token: string): Promise<boolean> {
  if (!token) return false;
  const db = await getDB();
  db.run("DELETE FROM instructor_sessions WHERE token = ?", [token]);
  persistDatabase();
  return true;
}

export async function getAllInstructors(): Promise<InstructorAccount[]> {
  const db = await getDB();
  const res = db.exec("SELECT id, username, display_name, role, department, created_at FROM instructors ORDER BY role ASC, display_name ASC");
  if (!res.length || !res[0].values) return [];
  return res[0].values.map((v) => ({
    id: v[0] as string,
    username: v[1] as string,
    displayName: v[2] as string,
    role: v[3] as InstructorRole,
    department: (v[4] as string) || undefined,
    createdAt: v[5] as string,
  }));
}

export async function deleteInstructor(instructorId: string): Promise<boolean> {
  if (!instructorId) return false;
  const db = await getDB();
  // 1. Invalidate all active session tokens in instructor_sessions
  db.run("DELETE FROM instructor_sessions WHERE instructor_id = ?", [instructorId]);
  // 2. Remove instructor record
  db.run("DELETE FROM instructors WHERE id = ?", [instructorId]);
  persistDatabase();
  return true;
}

// ============================================================================
// STUDENT ROSTER & AUTHENTICATION HELPERS
// ============================================================================

export async function getStudentByRegNo(regNo: string): Promise<StudentAccount | null> {
  const db = await getDB();
  const stmt = db.prepare(
    "SELECT reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at, updated_at FROM students WHERE reg_no = ?"
  );
  stmt.bind([regNo.trim().toLowerCase()]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject();
  stmt.free();
  return {
    regNo: row.reg_no as string,
    studentName: row.student_name as string,
    department: row.department as string,
    cohort: row.cohort as string,
    passwordHash: row.password_hash as string,
    salt: row.salt as string,
    mustChangePassword: Boolean(row.must_change_password),
    isActive: Boolean(row.is_active),
    createdAt: row.created_at as string,
    updatedAt: (row.updated_at as string) || undefined,
  };
}

export async function upsertStudent(
  regNo: string,
  studentName: string,
  department = "Computer Science",
  cohort = "2026"
): Promise<void> {
  const db = await getDB();
  const normalizedReg = regNo.trim().toLowerCase();
  const existing = await getStudentByRegNo(normalizedReg);
  const now = new Date().toISOString();

  if (existing) {
    db.run(
      `UPDATE students SET student_name = ?, department = ?, cohort = ?, updated_at = ? WHERE reg_no = ?`,
      [studentName.trim(), department.trim(), cohort.trim(), now, normalizedReg]
    );
  } else {
    const { hash, salt } = hashPassword(normalizedReg);
    db.run(
      `INSERT INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at)
       VALUES (?, ?, ?, ?, ?, ?, 1, 1, ?)`,
      [normalizedReg, studentName.trim(), department.trim(), cohort.trim(), hash, salt, now]
    );
  }
  persistDatabase();
}

export async function registerStudent(
  regNo: string,
  studentName: string,
  password: string,
  department = "Computer Science",
  cohort = "2026"
): Promise<StudentAccount> {
  const db = await getDB();
  const normalizedReg = regNo.trim().toLowerCase();
  const existing = await getStudentByRegNo(normalizedReg);
  if (existing) {
    throw new Error(`Registration number "${normalizedReg.toUpperCase()}" is already registered.`);
  }

  const { hash, salt } = hashPassword(password);
  const now = new Date().toISOString();
  db.run(
    `INSERT INTO students (reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at)
     VALUES (?, ?, ?, ?, ?, ?, 0, 1, ?)`,
    [normalizedReg, studentName.trim(), department.trim(), cohort.trim(), hash, salt, now]
  );
  persistDatabase();
  const created = await getStudentByRegNo(normalizedReg);
  if (!created) {
    throw new Error("Failed to persist student record.");
  }
  return created;
}

export async function bulkUpsertStudents(
  students: Array<{ regNo: string; studentName: string; department?: string; cohort?: string }>
): Promise<number> {
  for (const s of students) {
    await upsertStudent(s.regNo, s.studentName, s.department, s.cohort);
  }
  return students.length;
}

export async function getAllStudents(): Promise<StudentAccount[]> {
  const db = await getDB();
  const res = db.exec(
    "SELECT reg_no, student_name, department, cohort, password_hash, salt, must_change_password, is_active, created_at, updated_at FROM students ORDER BY reg_no ASC"
  );
  if (!res.length || !res[0].values) return [];
  return res[0].values.map((v) => ({
    regNo: v[0] as string,
    studentName: v[1] as string,
    department: v[2] as string,
    cohort: v[3] as string,
    passwordHash: v[4] as string,
    salt: v[5] as string,
    mustChangePassword: Boolean(v[6]),
    isActive: Boolean(v[7]),
    createdAt: v[8] as string,
    updatedAt: (v[9] as string) || undefined,
  }));
}

export async function updateStudentPassword(regNo: string, newPassword: string): Promise<boolean> {
  const db = await getDB();
  const normalizedReg = regNo.trim().toLowerCase();
  const { hash, salt } = hashPassword(newPassword);
  const now = new Date().toISOString();

  db.run(
    `UPDATE students SET password_hash = ?, salt = ?, must_change_password = 0, updated_at = ? WHERE reg_no = ?`,
    [hash, salt, now, normalizedReg]
  );
  persistDatabase();
  return true;
}

export async function resetStudentPasswordToDefault(regNo: string): Promise<boolean> {
  const db = await getDB();
  const normalizedReg = regNo.trim().toLowerCase();
  const existing = await getStudentByRegNo(normalizedReg);
  if (!existing) return false;

  const { hash, salt } = hashPassword(normalizedReg);
  const now = new Date().toISOString();

  db.run("BEGIN IMMEDIATE;");
  try {
    db.run(
      `UPDATE students SET password_hash = ?, salt = ?, must_change_password = 1, updated_at = ? WHERE reg_no = ?`,
      [hash, salt, now, normalizedReg]
    );
    // Invalidate any active student sessions upon reset
    db.run(`DELETE FROM student_sessions WHERE reg_no = ?`, [normalizedReg]);
    db.run("COMMIT;");
  } catch (err) {
    try { db.run("ROLLBACK;"); } catch (rbErr) {
      console.debug("[OpenViva DB] Rollback warning in auth:", rbErr);
    }
    throw err;
  }

  persistDatabase();
  return true;
}

export async function createStudentSession(
  regNo: string,
  isTemp: boolean = false,
  durationHours: number = 24 * 7
): Promise<string> {
  const db = await getDB();
  const token = generateSessionToken();
  const now = new Date();
  const expires = new Date(now.getTime() + durationHours * 60 * 60 * 1000).toISOString();

  db.run(
    `INSERT INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, ?, ?, ?, ?)`,
    [token, regNo.trim().toLowerCase(), isTemp ? 1 : 0, expires, now.toISOString()]
  );
  persistDatabase();
  return token;
}

export async function createBiometricResetSession(regNo: string): Promise<string> {
  const db = await getDB();
  const normalizedReg = regNo.trim().toLowerCase();
  const token = generateSessionToken();
  const now = new Date();
  const expires = new Date(now.getTime() + 5 * 60 * 1000).toISOString(); // 5-minute temporary reset window

  db.run("BEGIN IMMEDIATE;");
  try {
    // 1. Invalidate any existing student sessions to mitigate stale session reuse
    db.run("DELETE FROM student_sessions WHERE reg_no = ?", [normalizedReg]);
    // 2. Enforce must_change_password = 1 so credentials are reset upon completion
    db.run(
      "UPDATE students SET must_change_password = 1, updated_at = ? WHERE reg_no = ?",
      [now.toISOString(), normalizedReg]
    );
    // 3. Issue 5-minute temporary session token (is_temp = 1)
    db.run(
      "INSERT INTO student_sessions (token, reg_no, is_temp, expires_at, created_at) VALUES (?, ?, 1, ?, ?)",
      [token, normalizedReg, expires, now.toISOString()]
    );
    db.run("COMMIT;");
  } catch (err) {
    try { db.run("ROLLBACK;"); } catch (rbErr) {
      console.debug("[OpenViva DB] Rollback warning in auth:", rbErr);
    }
    throw err;
  }

  persistDatabase();
  return token;
}

export async function validateStudentSession(
  token: string
): Promise<{ student: StudentAccount; isTemp: boolean } | null> {
  if (!token) return null;
  const db = await getDB();
  const now = new Date().toISOString();
  const res = db.exec(
    `SELECT s.reg_no, s.student_name, s.department, s.cohort, s.password_hash, s.salt, s.must_change_password, s.is_active, s.created_at, s.updated_at, ss.is_temp
     FROM student_sessions ss
     JOIN students s ON ss.reg_no = s.reg_no
     WHERE ss.token = ? AND ss.expires_at > ? AND s.is_active = 1`,
    [token, now]
  );
  if (!res.length || !res[0].values || !res[0].values.length) return null;

  const v = res[0].values[0];
  return {
    student: {
      regNo: v[0] as string,
      studentName: v[1] as string,
      department: v[2] as string,
      cohort: v[3] as string,
      passwordHash: v[4] as string,
      salt: v[5] as string,
      mustChangePassword: Boolean(v[6]),
      isActive: Boolean(v[7]),
      createdAt: v[8] as string,
      updatedAt: (v[9] as string) || undefined,
    },
    isTemp: Boolean(v[10]),
  };
}

export async function deleteStudentSession(token: string): Promise<boolean> {
  if (!token) return false;
  const db = await getDB();
  db.run("DELETE FROM student_sessions WHERE token = ?", [token]);
  persistDatabase();
  return true;
}

// ============================================================================
// STUDENT BIOMETRICS HELPERS
// ============================================================================

export async function getStudentBiometrics(regNo: string): Promise<StudentBiometricsRecord | null> {
  const db = await getDB();
  const normalizedReg = regNo.trim().toLowerCase();
  const stmt = db.prepare(
    `SELECT reg_no, student_name, face_image_path, face_embedding, face_enrolled_at,
            voice_sample_path, voice_embedding, voice_enrolled_at, enrolled_ip_address,
            enrolled_user_agent, verified_by_ta_id, verification_status,
            last_face_similarity, last_liveness_score
     FROM student_biometrics WHERE reg_no = ?`
  );
  stmt.bind([normalizedReg]);
  if (!stmt.step()) {
    stmt.free();
    return null;
  }
  const row = stmt.getAsObject();
  stmt.free();

  return {
    regNo: row.reg_no as string,
    studentName: row.student_name as string,
    faceImagePath: (row.face_image_path as string) || undefined,
    faceEmbedding: row.face_embedding ? (row.face_embedding as Uint8Array) : null,
    faceEnrolledAt: (row.face_enrolled_at as string) || undefined,
    voiceSamplePath: (row.voice_sample_path as string) || undefined,
    voiceEmbedding: row.voice_embedding ? (row.voice_embedding as Uint8Array) : null,
    voiceEnrolledAt: (row.voice_enrolled_at as string) || undefined,
    enrolledIpAddress: (row.enrolled_ip_address as string) || undefined,
    enrolledUserAgent: (row.enrolled_user_agent as string) || undefined,
    verifiedByTaId: (row.verified_by_ta_id as string) || undefined,
    verificationStatus: (row.verification_status as any) || "PENDING",
    lastFaceSimilarity: typeof row.last_face_similarity === "number" ? row.last_face_similarity : undefined,
    lastLivenessScore: typeof row.last_liveness_score === "number" ? row.last_liveness_score : undefined,
  };
}

export async function upsertStudentBiometrics(data: {
  regNo: string;
  studentName: string;
  faceImagePath?: string;
  faceEmbedding?: Uint8Array | Buffer | null;
  faceEnrolledAt?: string;
  voiceSamplePath?: string;
  voiceEmbedding?: Uint8Array | Buffer | null;
  voiceEnrolledAt?: string;
  enrolledIpAddress?: string;
  enrolledUserAgent?: string;
  verifiedByTaId?: string;
  verificationStatus?: "PENDING" | "AUTHENTICATED" | "FLAGGED";
  lastFaceSimilarity?: number;
  lastLivenessScore?: number;
}): Promise<void> {
  const db = await getDB();
  const normalizedReg = data.regNo.trim().toLowerCase();
  const existing = await getStudentBiometrics(normalizedReg);

  if (existing) {
    db.run(
      `UPDATE student_biometrics SET
         student_name = COALESCE(?, student_name),
         face_image_path = COALESCE(?, face_image_path),
         face_embedding = COALESCE(?, face_embedding),
         face_enrolled_at = COALESCE(?, face_enrolled_at),
         voice_sample_path = COALESCE(?, voice_sample_path),
         voice_embedding = COALESCE(?, voice_embedding),
         voice_enrolled_at = COALESCE(?, voice_enrolled_at),
         enrolled_ip_address = COALESCE(?, enrolled_ip_address),
         enrolled_user_agent = COALESCE(?, enrolled_user_agent),
         verified_by_ta_id = COALESCE(?, verified_by_ta_id),
         verification_status = COALESCE(?, verification_status),
         last_face_similarity = COALESCE(?, last_face_similarity),
         last_liveness_score = COALESCE(?, last_liveness_score)
       WHERE reg_no = ?`,
      [
        data.studentName,
        data.faceImagePath || null,
        data.faceEmbedding || null,
        data.faceEnrolledAt || null,
        data.voiceSamplePath || null,
        data.voiceEmbedding || null,
        data.voiceEnrolledAt || null,
        data.enrolledIpAddress || null,
        data.enrolledUserAgent || null,
        data.verifiedByTaId || null,
        data.verificationStatus || null,
        data.lastFaceSimilarity !== undefined ? data.lastFaceSimilarity : null,
        data.lastLivenessScore !== undefined ? data.lastLivenessScore : null,
        normalizedReg,
      ]
    );
  } else {
    db.run(
      `INSERT INTO student_biometrics (
         reg_no, student_name, face_image_path, face_embedding, face_enrolled_at,
         voice_sample_path, voice_embedding, voice_enrolled_at, enrolled_ip_address,
         enrolled_user_agent, verified_by_ta_id, verification_status,
         last_face_similarity, last_liveness_score
       ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        normalizedReg,
        data.studentName,
        data.faceImagePath || null,
        data.faceEmbedding || null,
        data.faceEnrolledAt || null,
        data.voiceSamplePath || null,
        data.voiceEmbedding || null,
        data.voiceEnrolledAt || null,
        data.enrolledIpAddress || null,
        data.enrolledUserAgent || null,
        data.verifiedByTaId || null,
        data.verificationStatus || null,
        data.lastFaceSimilarity !== undefined ? data.lastFaceSimilarity : null,
        data.lastLivenessScore !== undefined ? data.lastLivenessScore : null,
      ]
    );
  }
  persistDatabase();
}

export async function deleteStudentBiometrics(regNo: string): Promise<void> {
  const db = await getDB();
  const normalizedReg = regNo.trim().toLowerCase();
  db.run("DELETE FROM student_biometrics WHERE reg_no = ?", [normalizedReg]);
  persistDatabase();
}

export interface StaffAuditLogEntry {
  eventType: string;
  actorId?: string | null;
  actorUsername?: string | null;
  actorRole?: string | null;
  targetUserId?: string | null;
  targetUsername?: string | null;
  targetRole?: string | null;
  ipAddress?: string | null;
  details?: Record<string, any>;
}

export async function recordStaffAuditLog(entry: StaffAuditLogEntry): Promise<void> {
  try {
    const db = await getDB();
    const id = `audit_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`;
    const now = new Date().toISOString();
    db.run(
      `INSERT INTO staff_audit_logs 
       (id, event_type, actor_id, actor_username, actor_role, target_user_id, target_username, target_role, ip_address, details_json, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        id,
        entry.eventType,
        entry.actorId || null,
        entry.actorUsername || null,
        entry.actorRole || null,
        entry.targetUserId || null,
        entry.targetUsername || null,
        entry.targetRole || null,
        entry.ipAddress || null,
        entry.details ? JSON.stringify(entry.details) : null,
        now,
      ]
    );
    persistDatabase();
    console.log(
      `[OpenViva Staff Audit] [${entry.eventType}] Actor: ${entry.actorUsername || "ANONYMOUS"} -> Target: ${entry.targetUsername || "N/A"} (${entry.targetRole || "N/A"}) IP: ${entry.ipAddress}`
    );
  } catch (err) {
    console.error("[OpenViva Staff Audit Error]:", err);
  }
}


