import { SqlValue } from "sql.js";
import { DBConnection, getDB, persistDatabase } from "./connection";
import { ExamPreset, AccessControl, AllowedStudent } from "@/types/database";
import { TOCItem } from "@/types/toc";

// ============================================================================
// EXAMS DATABASE OPERATIONS (Table: exams, exam_topics, allowed_students)
// ============================================================================

export function rowToExam(db: DBConnection, row: any): ExamPreset {
  const topicsRes = db.exec(
    "SELECT * FROM exam_topics WHERE exam_id = ? ORDER BY sort_order ASC",
    [row.id]
  );
  const topics: TOCItem[] = [];
  if (topicsRes.length > 0 && topicsRes[0].values) {
    const cols = topicsRes[0].columns;
    for (const val of topicsRes[0].values) {
      const tRow: any = {};
      cols.forEach((c, i) => (tRow[c] = val[i]));
      let bbox: [number, number, number, number] = [0, 0, 0, 0];
      if (tRow.bbox) {
        try {
          bbox = JSON.parse(tRow.bbox);
        } catch (parseErr) {
          console.debug("[OpenViva DB] Failed to parse exam topic bbox:", parseErr);
        }
      }
      topics.push({
        id: tRow.id,
        section_number: tRow.section_number || undefined,
        title: tRow.title,
        level: tRow.level,
        page: tRow.page,
        bbox,
        selected: Boolean(tRow.selected),
        comment: tRow.comment || undefined,
      });
    }
  }

  const accessControl: AccessControl = {
    type: row.access_type === "RESTRICTED" ? "RESTRICTED" : "OPEN",
  };

  if (row.access_type === "RESTRICTED") {
    const studentsRes = db.exec(
      "SELECT student_name, reg_no FROM allowed_students WHERE exam_id = ? ORDER BY id ASC",
      [row.id]
    );
    const allowed: AllowedStudent[] = [];
    if (studentsRes.length > 0 && studentsRes[0].values) {
      for (const val of studentsRes[0].values) {
        allowed.push({
          name: val[0] as string,
          regNo: val[1] as string,
        });
      }
    }
    accessControl.allowedStudents = allowed;
  }

  return {
    id: row.id,
    courseTitle: row.course_title,
    instructorId: row.instructor_id,
    leadProfessor: row.lead_professor || undefined,
    supervisingTaId: row.supervising_ta_id || undefined,
    supervisingTaName: row.supervising_ta_name || undefined,
    difficultyTier: row.difficulty_tier,
    durationMinutes: row.duration_minutes,
    studentDecidesWeightage: Boolean(row.student_decides_weightage),
    globalDirective: row.global_directive || undefined,
    accessControl,
    totalTopics: row.total_topics || topics.length,
    topics,
    systemPrompt: row.system_prompt,
    createdAt: row.created_at,
    updatedAt: row.updated_at || undefined,
  };
}

export async function getAllExams(supervisingTaId?: string): Promise<ExamPreset[]> {
  const db = await getDB();
  let query = "SELECT * FROM exams";
  const params: SqlValue[] = [];
  if (supervisingTaId) {
    const clean = supervisingTaId.replace(/^inst_/, "");
    query += " WHERE (supervising_ta_id = ? OR supervising_ta_id = 'inst_' || ? OR LOWER(supervising_ta_name) LIKE ? OR LOWER(supervising_ta_name) LIKE ? OR instructor_id = ? OR instructor_id = 'inst_' || ? OR LOWER(instructor_id) LIKE ? OR LOWER(lead_professor) LIKE ? OR LOWER(lead_professor) LIKE ?)";
    params.push(supervisingTaId);
    params.push(clean);
    params.push(`%${clean.toLowerCase()}%`);
    params.push(`%${supervisingTaId.toLowerCase()}%`);
    params.push(supervisingTaId);
    params.push(clean);
    params.push(`%${clean.toLowerCase()}%`);
    params.push(`%${clean.toLowerCase()}%`);
    params.push(`%${supervisingTaId.toLowerCase()}%`);
  }
  query += " ORDER BY created_at DESC";
  const res = db.exec(query, params);
  if (!res.length || !res[0].values) return [];

  const cols = res[0].columns;
  const exams: ExamPreset[] = [];
  for (const val of res[0].values) {
    const row: any = {};
    cols.forEach((c, i) => (row[c] = val[i]));
    exams.push(rowToExam(db, row));
  }
  return exams;
}

export async function getExamById(id: string): Promise<ExamPreset | null> {
  if (!id) return null;
  const db = await getDB();
  const res = db.exec("SELECT * FROM exams WHERE id = ?", [id]);
  if (!res.length || !res[0].values || !res[0].values.length) return null;

  const cols = res[0].columns;
  const val = res[0].values[0];
  const row: any = {};
  cols.forEach((c, i) => (row[c] = val[i]));
  return rowToExam(db, row);
}

export async function saveExam(exam: ExamPreset): Promise<ExamPreset> {
  if (!exam.id) throw new Error("Exam ID is required");
  if (!exam.courseTitle || !exam.courseTitle.trim()) throw new Error("Course title is mandatory");
  if (!exam.instructorId || !exam.instructorId.trim()) throw new Error("Instructor name is mandatory");

  const db = await getDB();
  const now = new Date().toISOString();
  const createdAt = exam.createdAt || now;
  const accessType = exam.accessControl?.type || "OPEN";
  const totalTopics = exam.totalTopics || (Array.isArray(exam.topics) ? exam.topics.length : 0);

  db.run("BEGIN IMMEDIATE;");
  try {
    db.run(
      `INSERT OR REPLACE INTO exams (
        id, course_title, instructor_id, lead_professor, supervising_ta_id, supervising_ta_name,
        difficulty_tier, duration_minutes,
        student_decides_weightage, global_directive, access_type, total_topics,
        system_prompt, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        exam.id,
        exam.courseTitle.trim(),
        exam.instructorId ? exam.instructorId.trim() : (exam.leadProfessor || "Lead Faculty"),
        exam.leadProfessor ? exam.leadProfessor.trim() : "Lead Faculty",
        exam.supervisingTaId || "inst_ta1",
        exam.supervisingTaName || "TA 1 (Teaching Assistant)",
        exam.difficultyTier || "undergrad_3",
        exam.durationMinutes || 10,
        exam.studentDecidesWeightage !== false ? 1 : 0,
        exam.globalDirective || null,
        accessType,
        totalTopics,
        exam.systemPrompt || "",
        createdAt,
        now,
      ]
    );

    db.run("DELETE FROM exam_topics WHERE exam_id = ?", [exam.id]);
    if (Array.isArray(exam.topics)) {
      exam.topics.forEach((topic, idx) => {
        db.run(
          `INSERT INTO exam_topics (
            id, exam_id, section_number, title, level, page, bbox, selected, comment, sort_order
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          [
            topic.id || `topic_${idx}`,
            exam.id,
            topic.section_number || null,
            topic.title,
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

    db.run("DELETE FROM allowed_students WHERE exam_id = ?", [exam.id]);
    if (accessType === "RESTRICTED" && Array.isArray(exam.accessControl?.allowedStudents)) {
      for (const s of exam.accessControl.allowedStudents) {
        if (s.name && s.regNo) {
          db.run(
            `INSERT OR IGNORE INTO allowed_students (exam_id, student_name, reg_no) VALUES (?, ?, ?)`,
            [exam.id, s.name.trim(), s.regNo.trim().toUpperCase()]
          );
        }
      }
    }

    db.run("COMMIT;");
  } catch (err) {
    try { db.run("ROLLBACK;"); } catch (rbErr) {
      console.debug("[OpenViva DB] Rollback warning in exams:", rbErr);
    }
    throw err;
  }

  persistDatabase();
  const saved = await getExamById(exam.id);
  if (!saved) throw new Error("Failed to retrieve saved exam");
  return saved;
}

export async function deleteExam(id: string): Promise<boolean> {
  if (!id) return false;
  const db = await getDB();
  db.run("BEGIN IMMEDIATE;");
  try {
    db.run("DELETE FROM exams WHERE id = ?", [id]);
    db.run("COMMIT;");
    persistDatabase();
    return true;
  } catch (err) {
    try { db.run("ROLLBACK;"); } catch (rbErr) {
      console.debug("[OpenViva DB] Rollback warning in exams:", rbErr);
    }
    console.error(`Failed to delete exam ${id}:`, err);
    return false;
  }
}

