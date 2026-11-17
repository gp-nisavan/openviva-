import { SqlValue } from "sql.js";
import { DBConnection, getDB, persistDatabase } from "./connection";
import { ExamSessionRecord, ExamSessionStatus, TranscriptTurn } from "@/types/database";
import { ExamEvaluationResult } from "@/types/grading";

// ============================================================================
// STUDENT RESULTS DATABASE OPERATIONS (Table: exam_sessions, transcript_turns, evaluations)
// ============================================================================

export function parseEvaluationRow(eRow: any): ExamEvaluationResult {
  const parseJSON = (s: string | null, def: any) => {
    if (!s) return def;
    try {
      return JSON.parse(s);
    } catch (_) {
      return def;
    }
  };

  return {
    overallScore: eRow.overall_score,
    verdict: eRow.verdict,
    conceptualRigorScore: eRow.conceptual_rigor_score,
    clarityScore: eRow.clarity_score,
    adversarialResistanceScore: eRow.adversarial_resistance_score,
    dimensionScores:
      eRow.question_adherence_score !== null || eRow.spoken_conciseness_score !== null
        ? {
            questionAdherence: eRow.question_adherence_score || 0,
            conceptualRigor: eRow.conceptual_rigor_score || 0,
            adversarialResistance: eRow.adversarial_resistance_score || 0,
            spokenConciseness: eRow.spoken_conciseness_score || 0,
          }
        : undefined,
    subtopicBreakdown: parseJSON(eRow.subtopic_breakdown_json, []),
    strengths: parseJSON(eRow.strengths_json, []),
    weaknesses: parseJSON(eRow.weaknesses_json, []),
    candidateStrengths: parseJSON(eRow.candidate_strengths_json, undefined),
    diagnosticWeaknesses: parseJSON(eRow.diagnostic_weaknesses_json, undefined),
    behavioralFlags: parseJSON(eRow.behavioral_flags_json, []),
    behavioralAudit: parseJSON(eRow.behavioral_audit_json, undefined),
    committeeRemarks: eRow.committee_remarks || "",
    improvementFeedback: eRow.improvement_feedback || undefined,
    durationMinutes: eRow.duration_minutes || undefined,
    evaluatedAt: eRow.evaluated_at,
  };
}

export function batchRowsToRecords(
  db: DBConnection,
  sessionRows: any[],
  includeTranscript = true
): ExamSessionRecord[] {
  if (!sessionRows || sessionRows.length === 0) return [];

  const sessionIds = sessionRows.map((r) => r.session_id);

  // 1. Batch fetch all evaluations in chunks of 200 (eliminates N+1 query loop)
  const evaluationsMap = new Map<string, ExamEvaluationResult>();
  for (let i = 0; i < sessionIds.length; i += 200) {
    const chunk = sessionIds.slice(i, i + 200);
    const placeholders = chunk.map(() => "?").join(",");
    const evalRes = db.exec(
      `SELECT * FROM evaluations WHERE session_id IN (${placeholders})`,
      chunk
    );
    if (evalRes.length > 0 && evalRes[0].values) {
      const eCols = evalRes[0].columns;
      for (const eVal of evalRes[0].values) {
        const eRow: any = {};
        eCols.forEach((c, idx) => (eRow[c] = eVal[idx]));
        evaluationsMap.set(eRow.session_id, parseEvaluationRow(eRow));
      }
    }
  }

  // 2. Batch fetch all transcript turns in chunks of 200 (eliminates N+1 query loop)
  const transcriptMap = new Map<string, TranscriptTurn[]>();
  if (includeTranscript) {
    for (let i = 0; i < sessionIds.length; i += 200) {
      const chunk = sessionIds.slice(i, i + 200);
      const placeholders = chunk.map(() => "?").join(",");
      const turnsRes = db.exec(
        `SELECT * FROM transcript_turns WHERE session_id IN (${placeholders}) ORDER BY turn_index ASC`,
        chunk
      );
      if (turnsRes.length > 0 && turnsRes[0].values) {
        const cols = turnsRes[0].columns;
        for (const val of turnsRes[0].values) {
          const tRow: any = {};
          cols.forEach((c, idx) => (tRow[c] = val[idx]));
          const sid = tRow.session_id;
          let list = transcriptMap.get(sid);
          if (!list) {
            list = [];
            transcriptMap.set(sid, list);
          }
          list.push({
            id: tRow.id,
            speaker: tRow.speaker as "examiner" | "candidate" | "system",
            text: tRow.text,
            timestamp: tRow.timestamp,
            isInterrupted: Boolean(tRow.is_interrupted),
            tokens: tRow.tokens,
            cumulativeTokens: tRow.cumulative_tokens,
          });
        }
      }
    }
  }

  // 3. Assemble ExamSessionRecord objects in-memory with constant O(1) database queries
  return sessionRows.map((row) => {
    const transcript = transcriptMap.get(row.session_id) || [];
    const evaluationResult = evaluationsMap.get(row.session_id);
    return {
      sessionId: row.session_id,
      examId: row.exam_id,
      courseTitle: row.course_title,
      instructorId: row.instructor_id || undefined,
      leadProfessor: row.lead_professor || undefined,
      supervisingTaId: row.supervising_ta_id || undefined,
      supervisingTaName: row.supervising_ta_name || undefined,
      studentId: row.student_id,
      status: row.status as ExamSessionStatus,
      startedAt: row.started_at,
      endedAt: row.ended_at || undefined,
      actualDurationSeconds: row.actual_duration_seconds || 0,
      recordingUrl: (row.recording_url && !row.recording_url.includes(":9000"))
        ? row.recording_url
        : `/openviva/api/defense/audio?sessionId=${row.session_id}`,
      turnCount: row.turn_count || transcript.length,
      transcript,
      evaluationResult,
      error: row.error || undefined,
      tokenMetrics: {
        systemPromptTokens: row.system_prompt_tokens || 0,
        totalConversationTokens: row.total_conversation_tokens || 0,
        peakContextTokens: row.peak_context_tokens || 0,
        averageTokensPerTurn: row.average_tokens_per_turn || 0,
        totalTurns: row.turn_count || transcript.length,
      },
      createdAt: row.created_at,
      updatedAt: row.updated_at || undefined,
    };
  });
}

export function rowToRecord(db: DBConnection, row: any): ExamSessionRecord {
  return batchRowsToRecords(db, [row], true)[0];
}

export async function getAllRecords(includeTranscript = true): Promise<ExamSessionRecord[]> {
  const db = await getDB();
  const res = db.exec("SELECT * FROM exam_sessions ORDER BY started_at DESC");
  if (!res.length || !res[0].values) return [];

  const cols = res[0].columns;
  const sessionRows = res[0].values.map((val) => {
    const row: any = {};
    cols.forEach((c, i) => (row[c] = val[i]));
    return row;
  });

  return batchRowsToRecords(db, sessionRows, includeTranscript);
}

export async function getRecordBySessionId(sessionId: string): Promise<ExamSessionRecord | null> {
  if (!sessionId) return null;
  let db = await getDB();
  let res = db.exec("SELECT * FROM exam_sessions WHERE session_id = ?", [sessionId]);
  if (!res.length || !res[0].values || !res[0].values.length) {
    db = await getDB(true);
    res = db.exec("SELECT * FROM exam_sessions WHERE session_id = ?", [sessionId]);
    if (!res.length || !res[0].values || !res[0].values.length) return null;
  }

  const cols = res[0].columns;
  const val = res[0].values[0];
  const row: any = {};
  cols.forEach((c, i) => (row[c] = val[i]));
  return rowToRecord(db, row);
}

export async function getRecordsByStudentId(studentId: string, includeTranscript = true): Promise<ExamSessionRecord[]> {
  if (!studentId) return [];
  const db = await getDB();
  const res = db.exec("SELECT * FROM exam_sessions WHERE LOWER(student_id) = LOWER(?) ORDER BY started_at DESC", [
    studentId.trim(),
  ]);
  if (!res.length || !res[0].values) return [];

  const cols = res[0].columns;
  const sessionRows = res[0].values.map((val) => {
    const row: any = {};
    cols.forEach((c, i) => (row[c] = val[i]));
    return row;
  });

  return batchRowsToRecords(db, sessionRows, includeTranscript);
}

export async function getRecordsByExamId(examId: string, includeTranscript = true): Promise<ExamSessionRecord[]> {
  if (!examId) return [];
  const db = await getDB();
  const res = db.exec("SELECT * FROM exam_sessions WHERE exam_id = ? ORDER BY started_at DESC", [examId]);
  if (!res.length || !res[0].values) return [];

  const cols = res[0].columns;
  const sessionRows = res[0].values.map((val) => {
    const row: any = {};
    cols.forEach((c, i) => (row[c] = val[i]));
    return row;
  });

  return batchRowsToRecords(db, sessionRows, includeTranscript);
}

export async function saveRecord(record: ExamSessionRecord): Promise<ExamSessionRecord> {
  if (!record.sessionId) throw new Error("Session ID is required");
  if (!record.studentId || !record.studentId.trim()) throw new Error("Student ID is mandatory");
  if (!record.examId) throw new Error("Exam ID reference is mandatory");

  const db = await getDB();
  const now = new Date().toISOString();
  const status = record.status || (record.evaluationResult ? "COMPLETED" : "IN_PROGRESS");
  const turnCount = Array.isArray(record.transcript) ? record.transcript.length : 0;

  db.run("BEGIN IMMEDIATE;");
  try {
    const clean = (arr: any[]) => arr.map((v) => (v === undefined ? null : v));

    db.run(
      `INSERT OR REPLACE INTO exam_sessions (
        session_id, exam_id, course_title, instructor_id, lead_professor, supervising_ta_id, supervising_ta_name,
        student_id, status, started_at, ended_at, actual_duration_seconds, turn_count, recording_url,
        error, system_prompt_tokens, total_conversation_tokens, peak_context_tokens,
        average_tokens_per_turn, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      clean([
        record.sessionId,
        record.examId || "Oral Defense Examination",
        record.courseTitle || "Oral Defense Examination",
        record.instructorId || null,
        record.leadProfessor || "Lead Faculty",
        record.supervisingTaId || "inst_ta1",
        record.supervisingTaName || "TA 1 (Teaching Assistant)",
        record.studentId ? record.studentId.trim() : "Candidate",
        status,
        record.startedAt || now,
        record.endedAt || null,
        record.actualDurationSeconds || 0,
        turnCount,
        record.recordingUrl || null,
        record.error || null,
        record.tokenMetrics?.systemPromptTokens || 0,
        record.tokenMetrics?.totalConversationTokens || 0,
        record.tokenMetrics?.peakContextTokens || 0,
        record.tokenMetrics?.averageTokensPerTurn || 0,
        record.createdAt || now,
        now,
      ])
    );

    if (Array.isArray(record.transcript)) {
      db.run("DELETE FROM transcript_turns WHERE session_id = ?", [record.sessionId]);
      record.transcript.forEach((t, idx) => {
        const spk = t.speaker || (t as any).sender || "candidate";
        db.run(
          `INSERT INTO transcript_turns (
            id, session_id, turn_index, speaker, text, timestamp,
            is_interrupted, tokens, cumulative_tokens
          ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
          clean([
            t.id || `turn_${Date.now()}_${idx}`,
            record.sessionId,
            idx,
            spk,
            t.text || "",
            t.timestamp || now,
            t.isInterrupted ? 1 : 0,
            t.tokens || 0,
            t.cumulativeTokens || 0,
          ])
        );
      });
    }

    if (record.evaluationResult) {
      const ev = record.evaluationResult;
      db.run(
        `INSERT OR REPLACE INTO evaluations (
          session_id, overall_score, verdict, conceptual_rigor_score, clarity_score,
          adversarial_resistance_score, question_adherence_score, spoken_conciseness_score,
          subtopic_breakdown_json, strengths_json, weaknesses_json, candidate_strengths_json,
          diagnostic_weaknesses_json, behavioral_flags_json, behavioral_audit_json,
          committee_remarks, improvement_feedback, duration_minutes, evaluated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        clean([
          record.sessionId,
          ev.overallScore,
          ev.verdict,
          ev.conceptualRigorScore,
          ev.clarityScore,
          ev.adversarialResistanceScore,
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
          ev.evaluatedAt || now,
        ])
      );
    }

    db.run("COMMIT;");
  } catch (err) {
    try { db.run("ROLLBACK;"); } catch (rbErr) {
      console.debug("[OpenViva DB] Rollback warning in sessions:", rbErr);
    }
    throw err;
  }

  persistDatabase();
  const saved = await getRecordBySessionId(record.sessionId);
  if (!saved) throw new Error("Failed to retrieve saved session record");
  return saved;
}

export function estimateLlamaTokens(text: string): number {
  if (!text) return 0;
  const cleaned = text.trim();
  if (!cleaned) return 0;
  const charEst = Math.ceil(cleaned.length / 3.8);
  const wordsAndPunct = cleaned.match(/[\w']+|[^\w\s]/g) || [];
  const wordEst = Math.ceil(wordsAndPunct.length * 1.25);
  return Math.max(1, Math.round(charEst * 0.6 + wordEst * 0.4));
}

export interface AppendTurnParams {
  sessionId: string;
  studentId: string;
  examId?: string;
  courseTitle?: string;
  instructorId?: string;
  leadProfessor?: string;
  supervisingTaId?: string;
  supervisingTaName?: string;
  systemPrompt?: string;
  turn: {
    id?: string;
    speaker: "examiner" | "candidate" | "system";
    text: string;
    timestamp?: string;
    isInterrupted?: boolean;
    tokens?: number;
  };
  elapsedSeconds?: number;
}

export async function appendSessionTurn(params: AppendTurnParams): Promise<ExamSessionRecord> {
  const { sessionId, studentId, examId, courseTitle, instructorId, leadProfessor, supervisingTaId, supervisingTaName, systemPrompt, turn, elapsedSeconds = 0 } = params;
  if (!sessionId) throw new Error("sessionId is required");

  const db = await getDB();
  const now = new Date().toISOString();
  const turnTokens = turn.tokens || estimateLlamaTokens(turn.text);
  const turnId = turn.id || `turn_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`;
  const turnSpeaker = turn.speaker || (turn as any).sender || "candidate";

  const clean = (arr: any[]) => arr.map((v) => (v === undefined ? null : v));

  db.run("BEGIN IMMEDIATE;");
  try {
    const sessionRes = db.exec("SELECT * FROM exam_sessions WHERE session_id = ?", [sessionId]);
    let existingSession = sessionRes.length > 0 && sessionRes[0].values && sessionRes[0].values.length > 0;

    if (!existingSession) {
      let effectiveExamId = examId;
      let effectiveInstructorId = instructorId;
      let effectiveLeadProf = leadProfessor;
      let effectiveTaId = supervisingTaId;
      let effectiveTaName = supervisingTaName;

      // Subtask 3.2.2: Canonical relational lookup from exams table
      const presetRes = db.exec(
        "SELECT id, instructor_id, lead_professor, supervising_ta_id, supervising_ta_name FROM exams WHERE id = ? OR LOWER(course_title) = LOWER(?) LIMIT 1",
        [examId || "", courseTitle || ""]
      );
      if (presetRes.length && presetRes[0].values && presetRes[0].values.length) {
        const row = presetRes[0].values[0];
        effectiveExamId = String(row[0]);
        effectiveInstructorId = effectiveInstructorId || (row[1] ? String(row[1]) : undefined);
        effectiveLeadProf = effectiveLeadProf || (row[2] ? String(row[2]) : "Lead Faculty");
        effectiveTaId = effectiveTaId || (row[3] ? String(row[3]) : "inst_ta1");
        effectiveTaName = effectiveTaName || (row[4] ? String(row[4]) : "TA 1 (Teaching Assistant)");
      } else if (!effectiveExamId || !effectiveExamId.startsWith("exam_")) {
        effectiveExamId = courseTitle
          ? `exam_${courseTitle.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`
          : "exam_default";
      }

      const sysTokens = systemPrompt ? estimateLlamaTokens(systemPrompt) : 0;
      db.run(
        `INSERT INTO exam_sessions (
          session_id, exam_id, course_title, instructor_id, lead_professor, supervising_ta_id, supervising_ta_name,
          student_id, status, started_at, actual_duration_seconds, turn_count,
          system_prompt_tokens, total_conversation_tokens, peak_context_tokens,
          average_tokens_per_turn, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'IN_PROGRESS', ?, ?, 0, ?, 0, ?, 0, ?, ?)`,
        clean([
          sessionId,
          effectiveExamId,
          courseTitle || "Oral Defense Examination",
          effectiveInstructorId || null,
          effectiveLeadProf || "Lead Faculty",
          effectiveTaId || "inst_ta1",
          effectiveTaName || "TA 1 (Teaching Assistant)",
          studentId,
          now,
          elapsedSeconds,
          sysTokens,
          sysTokens,
          now,
          now,
        ])
      );
    }

    const turnsCountRes = db.exec("SELECT COUNT(*) FROM transcript_turns WHERE session_id = ?", [sessionId]);
    const currentTurnCount = (turnsCountRes[0]?.values[0]?.[0] as number) || 0;

    const dupRes = db.exec(
      "SELECT id FROM transcript_turns WHERE session_id = ? AND (id = ? OR (text = ? AND speaker = ?))",
      clean([sessionId, turnId, turn.text.trim(), turnSpeaker])
    );

    if (!dupRes.length || !dupRes[0].values || !dupRes[0].values.length) {
      const cumRes = db.exec(
        "SELECT cumulative_tokens FROM transcript_turns WHERE session_id = ? ORDER BY turn_index DESC LIMIT 1",
        [sessionId]
      );
      const prevCum = (cumRes[0]?.values[0]?.[0] as number) || 0;
      const newCum = prevCum + turnTokens;

      db.run(
        `INSERT OR REPLACE INTO transcript_turns (
          id, session_id, turn_index, speaker, text, timestamp,
          is_interrupted, tokens, cumulative_tokens
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        clean([
          turnId,
          sessionId,
          currentTurnCount,
          turnSpeaker,
          turn.text.trim(),
          turn.timestamp || now,
          turn.isInterrupted ? 1 : 0,
          turnTokens,
          newCum,
        ])
      );

      const sysRes = db.exec("SELECT system_prompt_tokens FROM exam_sessions WHERE session_id = ?", [sessionId]);
      let sysTokens = (sysRes[0]?.values[0]?.[0] as number) || 0;
      if (sysTokens === 0 && systemPrompt) {
        sysTokens = estimateLlamaTokens(systemPrompt);
      }

      const totalTurns = currentTurnCount + 1;
      const avgTokens = Math.round(newCum / totalTurns);

      db.run(
        `UPDATE exam_sessions SET
          actual_duration_seconds = MAX(actual_duration_seconds, ?),
          turn_count = ?,
          system_prompt_tokens = ?,
          total_conversation_tokens = ?,
          peak_context_tokens = ?,
          average_tokens_per_turn = ?,
          updated_at = ?
        WHERE session_id = ?`,
        clean([elapsedSeconds, totalTurns, sysTokens, newCum, sysTokens + newCum, avgTokens, now, sessionId])
      );
    }

    db.run("COMMIT;");
  } catch (err) {
    try { db.run("ROLLBACK;"); } catch (rbErr) {
      console.debug("[OpenViva DB] Rollback warning in sessions:", rbErr);
    }
    throw err;
  }

  persistDatabase();
  const updated = await getRecordBySessionId(sessionId);
  if (!updated) throw new Error("Failed to retrieve updated session");
  return updated;
}

export interface UpdateStatusParams {
  sessionId: string;
  status: ExamSessionStatus;
  evaluationResult?: any;
  actualDurationSeconds?: number;
  endedAt?: string;
  error?: string;
  recordingUrl?: string;
}

export async function updateSessionStatus(params: UpdateStatusParams): Promise<ExamSessionRecord | null> {
  const { sessionId, status, evaluationResult, actualDurationSeconds, endedAt, error, recordingUrl } = params;
  if (!sessionId) throw new Error("sessionId is required");

  const db = await getDB();
  const now = new Date().toISOString();

  db.run("BEGIN IMMEDIATE;");
  try {
    const existing = db.exec("SELECT session_id, ended_at FROM exam_sessions WHERE session_id = ?", [sessionId]);
    if (!existing.length || !existing[0].values || !existing[0].values.length) {
      try { db.run("ROLLBACK;"); } catch (rbErr) {
      console.debug("[OpenViva DB] Rollback warning in sessions:", rbErr);
    }
      return null;
    }

    const prevEndedAt = existing[0].values[0][1] as string | null;
    const finalEndedAt = endedAt || (status === "COMPLETED" || status === "PENDING_EVALUATION" ? prevEndedAt || now : null);

    db.run(
      `UPDATE exam_sessions SET
        status = ?,
        actual_duration_seconds = COALESCE(?, actual_duration_seconds),
        ended_at = COALESCE(?, ended_at),
        error = COALESCE(?, error),
        recording_url = COALESCE(?, recording_url),
        updated_at = ?
      WHERE session_id = ?`,
      [
        status,
        actualDurationSeconds !== undefined ? actualDurationSeconds : null,
        finalEndedAt,
        error || null,
        recordingUrl || null,
        now,
        sessionId,
      ]
    );

    if (evaluationResult) {
      const ev = evaluationResult;
      db.run(
        `INSERT OR REPLACE INTO evaluations (
          session_id, overall_score, verdict, conceptual_rigor_score, clarity_score,
          adversarial_resistance_score, question_adherence_score, spoken_conciseness_score,
          subtopic_breakdown_json, strengths_json, weaknesses_json, candidate_strengths_json,
          diagnostic_weaknesses_json, behavioral_flags_json, behavioral_audit_json,
          committee_remarks, improvement_feedback, duration_minutes, evaluated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        [
          sessionId,
          ev.overallScore || 0,
          ev.verdict || "EVALUATED",
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
          ev.evaluatedAt || now,
        ]
      );
    }

    db.run("COMMIT;");
  } catch (err) {
    try { db.run("ROLLBACK;"); } catch (rbErr) {
      console.debug("[OpenViva DB] Rollback warning in sessions:", rbErr);
    }
    throw err;
  }

  persistDatabase();
  return getRecordBySessionId(sessionId);
}

export async function updateSessionRecordingUrl(sessionId: string, recordingUrl: string): Promise<boolean> {
  if (!sessionId || !recordingUrl) return false;
  const db = await getDB();
  const now = new Date().toISOString();
  try {
    db.run("UPDATE exam_sessions SET recording_url = ?, updated_at = ? WHERE session_id = ?", [
      recordingUrl,
      now,
      sessionId,
    ]);
    persistDatabase();
    return true;
  } catch (err) {
    console.error("Failed to update recording_url for session:", sessionId, err);
    return false;
  }
}

export interface RecordFilterOptions {
  studentId?: string;
  examId?: string;
  courseTitle?: string;
  supervisingTaId?: string;
  status?: ExamSessionStatus | "ALL";
  startDate?: string;
  endDate?: string;
  includeTranscript?: boolean;
}

export async function queryRecords(filters: RecordFilterOptions = {}): Promise<ExamSessionRecord[]> {
  const db = await getDB();
  const whereClauses: string[] = [];
  const params: SqlValue[] = [];

  if (filters.studentId) {
    whereClauses.push("LOWER(student_id) = LOWER(?)");
    params.push(filters.studentId.trim());
  }
  if (filters.examId) {
    whereClauses.push("exam_id = ?");
    params.push(filters.examId);
  }
  if (filters.courseTitle) {
    whereClauses.push("LOWER(course_title) LIKE ?");
    params.push(`%${filters.courseTitle.trim().toLowerCase()}%`);
  }
  if (filters.supervisingTaId) {
    whereClauses.push("(supervising_ta_id = ? OR supervising_ta_id = 'inst_' || ? OR LOWER(supervising_ta_name) LIKE ? OR instructor_id = ? OR instructor_id = 'inst_' || ? OR LOWER(lead_professor) LIKE ?)");
    params.push(filters.supervisingTaId);
    params.push(filters.supervisingTaId);
    params.push(`%${filters.supervisingTaId.trim().toLowerCase()}%`);
    params.push(filters.supervisingTaId);
    params.push(filters.supervisingTaId);
    params.push(`%${filters.supervisingTaId.trim().toLowerCase()}%`);
  }
  if (filters.status && filters.status !== "ALL") {
    whereClauses.push("status = ?");
    params.push(filters.status);
  }
  if (filters.startDate) {
    whereClauses.push("started_at >= ?");
    params.push(filters.startDate);
  }
  if (filters.endDate) {
    whereClauses.push("started_at <= ?");
    params.push(filters.endDate);
  }

  const whereSQL = whereClauses.length > 0 ? `WHERE ${whereClauses.join(" AND ")}` : "";
  const query = `SELECT * FROM exam_sessions ${whereSQL} ORDER BY started_at DESC`;

  const res = db.exec(query, params);
  if (!res.length || !res[0].values) return [];

  const cols = res[0].columns;
  const sessionRows = res[0].values.map((val) => {
    const row: any = {};
    cols.forEach((c, i) => (row[c] = val[i]));
    return row;
  });

  const includeTranscript = filters.includeTranscript !== undefined ? filters.includeTranscript : true;
  return batchRowsToRecords(db, sessionRows, includeTranscript);
}

