import fs from "fs";
import path from "path";
import { spawn } from "child_process";
import { NextRequest, NextResponse } from "next/server";
import {
  getAllRecords,
  getRecordBySessionId,
  saveRecord,
  appendSessionTurn,
  updateSessionStatus,
  getRecordingsDir,
  getDB,
  queryRecords,
  validateInstructorSession,
  validateStudentSession,
} from "@/lib/db";
import { ExamSessionRecord, ExamSessionStatus } from "@/types/database";
import { evaluateTranscriptWithLLM } from "@/lib/evaluator";

interface AuthContext {
  role: "INSTRUCTOR" | "STUDENT" | "INTERNAL";
  instructorId?: string;
  studentRegNo?: string;
}

/**
 * Validates request authentication credentials across Bearer tokens,
 * session cookies, and internal service credentials.
 */
async function authenticateRequest(req: NextRequest): Promise<{
  auth: AuthContext | null;
  errorResponse?: NextResponse;
}> {
  // 1. Check Authorization Bearer header
  const authHeader = req.headers.get("authorization");
  const bearerToken = authHeader ? authHeader.replace(/^Bearer\s+/i, "").trim() : null;

  // 2. Check internal service key (strictly separated from WebRTC LiveKit secret)
  const internalSecret = req.headers.get("x-internal-secret");
  const envInternalKey = process.env.INTERNAL_SERVICE_KEY;
  const envAdminKey = process.env.INITIAL_ADMIN_KEY;
  const isInternalAuthorized = Boolean(
    (envInternalKey && ((internalSecret && internalSecret === envInternalKey) || (bearerToken && bearerToken === envInternalKey))) ||
    (envAdminKey && ((internalSecret && internalSecret === envAdminKey) || (bearerToken && bearerToken === envAdminKey)))
  );

  if (isInternalAuthorized) {
    return { auth: { role: "INTERNAL" } };
  }

  // 3. Resolve session token
  let token = bearerToken;
  if (!token) {
    token =
      req.cookies.get("openviva_session")?.value ||
      req.cookies.get("openviva_student_session")?.value ||
      req.cookies.get("openviva_student_temp")?.value ||
      null;
  }

  if (!token) {
    return {
      auth: null,
      errorResponse: NextResponse.json(
        { error: "Unauthorized: Missing authentication credentials." },
        { status: 401 }
      ),
    };
  }

  // 4. Validate instructor session first
  try {
    const instructor = await validateInstructorSession(token);
    if (instructor) {
      return {
        auth: {
          role: "INSTRUCTOR",
          instructorId: instructor.id,
        },
      };
    }
  } catch (err) {
    console.warn("Instructor session validation error:", err);
  }

  // 5. Validate student session
  try {
    const studentSession = await validateStudentSession(token);
    if (studentSession && studentSession.student) {
      return {
        auth: {
          role: "STUDENT",
          studentRegNo: studentSession.student.regNo,
        },
      };
    }
  } catch (err) {
    console.warn("Student session validation error:", err);
  }

  return {
    auth: null,
    errorResponse: NextResponse.json(
      { error: "Unauthorized: Invalid or expired session credentials." },
      { status: 401 }
    ),
  };
}

/**
 * Resolves the appropriate Python executable for the offline audio audit pipeline.
 * Prioritizes GPU host virtualenv (/home/savan/openviva/agent_env/bin/python) and custom env variables.
 */
function resolveAuditPythonExecutable(workspaceRoot: string): string {
  if (process.env.OPENVIVA_PYTHON_PATH && fs.existsSync(process.env.OPENVIVA_PYTHON_PATH)) {
    return process.env.OPENVIVA_PYTHON_PATH;
  }
  const candidates = [
    "/home/savan/openviva/agent_env/bin/python",
    path.join(workspaceRoot, "agent_env", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
    path.join(workspaceRoot, ".venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
    path.join(workspaceRoot, "venv", process.platform === "win32" ? "Scripts/python.exe" : "bin/python"),
  ];

  for (const c of candidates) {
    if (c && fs.existsSync(c)) {
      return c;
    }
  }

  return process.platform === "win32" ? "python" : "python3";
}

/**
 * Asynchronous, non-blocking fallback trigger for post-viva voice biometric auditing (Finding 5).
 * Checks whether evaluations.behavioral_audit_json is already populated.
 * If null or empty, spawns scripts/audit_session_biometrics.py as a detached background worker.
 */
async function triggerAsynchronousAudioAudit(sessionId: string): Promise<void> {
  const SAFE_ID_REGEX = /^[a-zA-Z0-9_\-]{1,64}$/;
  if (!sessionId || !SAFE_ID_REGEX.test(sessionId)) {
    return;
  }

  try {
    // 1. Query evaluations table to see if audit is already completed
    const db = await getDB();
    const evalRes = db.exec(
      "SELECT behavioral_audit_json FROM evaluations WHERE session_id = ?",
      [sessionId]
    );

    if (evalRes.length > 0 && evalRes[0].values && evalRes[0].values.length > 0) {
      const rawAudit = evalRes[0].values[0][0];
      if (rawAudit && typeof rawAudit === "string" && rawAudit.trim().length > 10) {
        console.log(`[Audio Diarization Fallback] Session ${sessionId} already audited. No action needed.`);
        return;
      }
    }

    // 2. Resolve workspace root and python script path
    const candidateRoots = [
      path.resolve(process.cwd(), ".."),
      process.cwd(),
      "/home/savan/openviva",
    ];

    let workspaceRoot = process.cwd();
    let scriptPath = "";

    for (const root of candidateRoots) {
      const p = path.join(root, "scripts", "audit_session_biometrics.py");
      if (fs.existsSync(p)) {
        workspaceRoot = root;
        scriptPath = p;
        break;
      }
    }

    if (!scriptPath || !fs.existsSync(scriptPath)) {
      console.warn(`[Audio Diarization Fallback] Could not locate audit_session_biometrics.py for session ${sessionId}.`);
      return;
    }

    const pyExe = resolveAuditPythonExecutable(workspaceRoot);

    // 3. Spawn detached unreferenced child process (never blocks HTTP lifecycle)
    const child = spawn(pyExe, [scriptPath, "--session-id", sessionId], {
      detached: true,
      stdio: "ignore",
      cwd: workspaceRoot,
    });

    child.unref();
    console.log(`[Audio Diarization Fallback] Spawned background audit worker (PID: ${child.pid}) for session ${sessionId}.`);
  } catch (err) {
    console.warn(`[Audio Diarization Fallback] Unexpected trigger error for session ${sessionId}:`, err);
  }
}

// GET /api/defense/records
// Query parameters:
// - ?sessionId=<sessionId> (fetch single record)
// - ?studentId=<studentId> (filter by student)
// - ?examId=<examId> (filter by exam)
// - ?courseTitle=<courseTitle> (filter by course title substring)
// - ?status=<IN_PROGRESS | PENDING_EVALUATION | COMPLETED | EVALUATION_FAILED | ALL>
// - ?startDate=<ISO date>
// - ?endDate=<ISO date>
export async function GET(req: NextRequest) {
  try {
    const { auth, errorResponse } = await authenticateRequest(req);
    if (!auth || errorResponse) {
      return errorResponse!;
    }

    const { searchParams } = new URL(req.url);
    const sessionId = searchParams.get("sessionId");
    const requestedStudentId = searchParams.get("studentId") || undefined;
    const examId = searchParams.get("examId") || undefined;
    const courseTitle = searchParams.get("courseTitle") || undefined;
    const supervisingTaId =
      searchParams.get("supervisingTaId") ||
      searchParams.get("taId") ||
      searchParams.get("ta_id") ||
      undefined;
    const status = (searchParams.get("status") as ExamSessionStatus) || undefined;
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;
    const includeTranscriptParam = searchParams.get("includeTranscript");
    const summaryParam = searchParams.get("summary");
    const includeTranscript =
      includeTranscriptParam !== null
        ? includeTranscriptParam === "true" || includeTranscriptParam === "1"
        : summaryParam === "true" || summaryParam === "1"
        ? false
        : true;

    // A) Single Session Lookup by sessionId
    if (sessionId) {
      const record = await getRecordBySessionId(sessionId);
      if (!record) {
        return NextResponse.json({ error: "Session record not found" }, { status: 404 });
      }

      // Authorization guard: Candidates can strictly access their own defense records
      if (
        auth.role === "STUDENT" &&
        auth.studentRegNo &&
        record.studentId.trim().toLowerCase() !== auth.studentRegNo.trim().toLowerCase()
      ) {
        return NextResponse.json(
          { error: "Forbidden: Candidates can only access their own defense records." },
          { status: 403 }
        );
      }

      return NextResponse.json({ record });
    }

    // B) Records List Query
    let effectiveStudentId = requestedStudentId;
    if (auth.role === "STUDENT") {
      // If candidate explicitly requests peer records, reject with 403 Forbidden
      if (
        requestedStudentId &&
        auth.studentRegNo &&
        requestedStudentId.trim().toLowerCase() !== auth.studentRegNo.trim().toLowerCase()
      ) {
        return NextResponse.json(
          { error: "Forbidden: Candidates cannot inspect peer defense records." },
          { status: 403 }
        );
      }
      // Force filter strictly to this candidate's own records
      effectiveStudentId = auth.studentRegNo;
    }

    const records = await queryRecords({
      studentId: effectiveStudentId,
      examId,
      courseTitle,
      supervisingTaId,
      status,
      startDate,
      endDate,
      includeTranscript,
    });

    return NextResponse.json({ records, total: records.length });
  } catch (err: any) {
    console.error("GET /api/defense/records error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to fetch defense records" },
      { status: 500 }
    );
  }
}

// POST /api/defense/records
// Supports actions:
// 1. action: "append_turn" -> Write-Ahead Log: appends single turn incrementally to disk
// 2. action: "commit_session" -> Locks transcript as PENDING_EVALUATION before grading pass
// 3. action: "complete_evaluation" -> Updates session to COMPLETED with final score & quotes
// 4. action: "fail_evaluation" -> Updates session to EVALUATION_FAILED, keeping transcript intact
// 5. action: "retry_evaluation" -> Error recovery: runs evaluation on stored transcript without re-test
// 6. default legacy -> Full atomic record save
export async function POST(req: NextRequest) {
  try {
    const { auth, errorResponse } = await authenticateRequest(req);
    if (!auth || errorResponse) {
      return errorResponse!;
    }

    const body = await req.json();
    const action = body.action;

    // 1. Incremental Turn Persistence (Write-Ahead Log)
    if (action === "append_turn") {
      const {
        sessionId,
        studentId,
        examId,
        courseTitle,
        instructorId,
        leadProfessor,
        supervisingTaId,
        supervisingTaName,
        systemPrompt,
        turn,
        elapsedSeconds,
      } = body;

      if (!sessionId || !studentId || !turn) {
        return NextResponse.json(
          { error: "sessionId, studentId, and turn are required for append_turn." },
          { status: 400 }
        );
      }

      // Authorization guard: Student can ONLY append turns to their own session
      if (auth.role === "STUDENT") {
        if (
          auth.studentRegNo &&
          studentId.trim().toLowerCase() !== auth.studentRegNo.trim().toLowerCase()
        ) {
          return NextResponse.json(
            { error: "Forbidden: Candidates can only append turns to their own defense sessions." },
            { status: 403 }
          );
        }

        const existingRecord = await getRecordBySessionId(sessionId);
        if (existingRecord) {
          if (
            auth.studentRegNo &&
            existingRecord.studentId.trim().toLowerCase() !== auth.studentRegNo.trim().toLowerCase()
          ) {
            return NextResponse.json(
              { error: "Forbidden: Session ID belongs to another candidate." },
              { status: 403 }
            );
          }
          if (existingRecord.status === "COMPLETED") {
            return NextResponse.json(
              { error: "Forbidden: Cannot append turns to an already completed session." },
              { status: 403 }
            );
          }
        }
      }

      const updated = await appendSessionTurn({
        sessionId,
        studentId,
        examId: examId || courseTitle || "Oral Defense Examination",
        courseTitle: courseTitle || "Oral Defense Examination",
        instructorId,
        leadProfessor,
        supervisingTaId,
        supervisingTaName,
        systemPrompt,
        turn,
        elapsedSeconds,
      });

      return NextResponse.json({ success: true, record: updated });
    }

    // 2. Phase 1 Commit: Lock transcript prior to evaluation
    if (action === "commit_session") {
      const { sessionId, actualDurationSeconds, endedAt, recordingUrl } = body;
      if (!sessionId) {
        return NextResponse.json({ error: "sessionId is required to commit session." }, { status: 400 });
      }

      if (auth.role === "STUDENT") {
        const existingRecord = await getRecordBySessionId(sessionId);
        if (
          existingRecord &&
          auth.studentRegNo &&
          existingRecord.studentId.trim().toLowerCase() !== auth.studentRegNo.trim().toLowerCase()
        ) {
          return NextResponse.json(
            { error: "Forbidden: Cannot commit another candidate's session." },
            { status: 403 }
          );
        }
      }

      const locked = await updateSessionStatus({
        sessionId,
        status: "PENDING_EVALUATION",
        actualDurationSeconds,
        endedAt: endedAt || new Date().toISOString(),
        recordingUrl,
      });

      if (!locked) {
        return NextResponse.json({ error: `Session ${sessionId} not found.` }, { status: 404 });
      }

      return NextResponse.json({ success: true, record: locked });
    }

    // 3. Complete Session / Evaluation: Seal session as COMPLETED directly
    if (action === "complete_evaluation" || action === "complete_session") {
      const { sessionId, evaluationResult, actualDurationSeconds, endedAt, recordingUrl, chamberId } = body;
      if (!sessionId) {
        return NextResponse.json(
          { error: "sessionId is required to complete session." },
          { status: 400 }
        );
      }

      // GRADE TAMPERING DEFENSE:
      // Candidates can seal their own session when concluding, but are strictly forbidden
      // from supplying or altering evaluation grades (evaluationResult).
      if (auth.role === "STUDENT") {
        const existingRecord = await getRecordBySessionId(sessionId);
        if (
          existingRecord &&
          auth.studentRegNo &&
          existingRecord.studentId.trim().toLowerCase() !== auth.studentRegNo.trim().toLowerCase()
        ) {
          return NextResponse.json(
            { error: "Forbidden: Candidates cannot seal peer sessions." },
            { status: 403 }
          );
        }

        if (evaluationResult !== undefined && evaluationResult !== null) {
          return NextResponse.json(
            { error: "Forbidden: Candidates are strictly unauthorized to submit or tamper with evaluation grades." },
            { status: 403 }
          );
        }
      }

      // Audio Persistence from RAM (/dev/shm) to Disk (storage/recordings)
      let finalRecordingUrl = recordingUrl;
      try {
        const recordingsDir = getRecordingsDir();
        const targetWav = path.join(recordingsDir, `${sessionId}.wav`);

        const cleanChamber = chamberId ? chamberId.replace(/[^a-zA-Z0-9_\-]/g, "_") : "stack2-chamber-01";
        const shmCandidates = [
          `/dev/shm/savan_openviva/shadow_raw_${cleanChamber}.wav`,
          `/dev/shm/savan_openviva/shadow_raw_stack2-chamber-01.wav`,
          path.join(recordingsDir, `${sessionId}.wav`),
        ];

        let copied = false;
        for (const candidate of shmCandidates) {
          if (candidate !== targetWav && fs.existsSync(candidate) && fs.statSync(candidate).size > 1000) {
            fs.copyFileSync(candidate, targetWav);
            console.log(`[Audio Persistence] Copied ${candidate} -> ${targetWav} (${fs.statSync(targetWav).size} bytes)`);
            copied = true;
            break;
          }
        }

        const targetM4a = path.join(recordingsDir, `${sessionId}.m4a`);
        if (copied || fs.existsSync(targetWav) || fs.existsSync(targetM4a)) {
          finalRecordingUrl = `/openviva/api/defense/audio?sessionId=${sessionId}`;
        }
      } catch (audioErr) {
        console.warn("[Audio Persistence Warning]:", audioErr);
      }

      // Candidates cannot inject evaluationResult
      const effectiveEvaluationResult = auth.role === "STUDENT" ? undefined : evaluationResult;

      const sealed = await updateSessionStatus({
        sessionId,
        status: "COMPLETED",
        evaluationResult: effectiveEvaluationResult,
        actualDurationSeconds,
        endedAt: endedAt || new Date().toISOString(),
        recordingUrl: finalRecordingUrl,
      });

      if (!sealed) {
        return NextResponse.json({ error: `Session ${sessionId} not found.` }, { status: 404 });
      }

      console.log(`[Audio Diarization] Delegated forensic audit coordination for session ${sessionId} to agent worker universal daemon.`);

      // Finding 5 Remediation: Reliable Asynchronous Fallback for Post-Viva Audits
      triggerAsynchronousAudioAudit(sessionId).catch((err) => {
        console.warn(`[Audio Diarization Fallback] Error triggering fallback audit for session ${sessionId}:`, err);
      });

      return NextResponse.json({ success: true, record: sealed });
    }

    // 3b. Finalize Recording URL
    if (action === "finalize_recording") {
      const { sessionId, recordingUrl } = body;
      if (!sessionId || !recordingUrl) {
        return NextResponse.json(
          { error: "sessionId and recordingUrl are required to finalize recording." },
          { status: 400 }
        );
      }

      if (auth.role === "STUDENT") {
        const existingRecord = await getRecordBySessionId(sessionId);
        if (
          existingRecord &&
          auth.studentRegNo &&
          existingRecord.studentId.trim().toLowerCase() !== auth.studentRegNo.trim().toLowerCase()
        ) {
          return NextResponse.json(
            { error: "Forbidden: Cannot finalize recording for another candidate's session." },
            { status: 403 }
          );
        }
      }

      const updated = await updateSessionStatus({
        sessionId,
        status: "COMPLETED",
        recordingUrl,
      });

      // Finding 5 Remediation: Ensure recording finalization triggers audit fallback if needed
      triggerAsynchronousAudioAudit(sessionId).catch((err) => {
        console.warn(`[Audio Diarization Fallback] Error triggering fallback audit for session ${sessionId}:`, err);
      });

      return NextResponse.json({ success: true, record: updated });
    }

    // 4. Phase 2 Error: Mark evaluation as failed with reason (preserves raw transcript on disk)
    if (action === "fail_evaluation") {
      if (auth.role === "STUDENT") {
        return NextResponse.json(
          { error: "Forbidden: Candidates are not authorized to fail evaluations." },
          { status: 403 }
        );
      }

      const { sessionId, error } = body;
      if (!sessionId) {
        return NextResponse.json({ error: "sessionId is required." }, { status: 400 });
      }

      const record = await updateSessionStatus({
        sessionId,
        status: "EVALUATION_FAILED",
        error: error || "Evaluation pass failed",
      });

      return NextResponse.json({ success: true, record });
    }

    // 5. Error Recovery: Retry failed evaluation pass without candidate re-test
    if (action === "retry_evaluation") {
      if (auth.role === "STUDENT") {
        return NextResponse.json(
          { error: "Forbidden: Candidates are not authorized to trigger re-evaluation." },
          { status: 403 }
        );
      }

      const { sessionId, rigorTier, syllabusTopics, durationMinutes } = body;
      if (!sessionId) {
        return NextResponse.json({ error: "sessionId is required to retry evaluation." }, { status: 400 });
      }

      const record = await getRecordBySessionId(sessionId);
      if (!record) {
        return NextResponse.json({ error: `Session ${sessionId} not found.` }, { status: 404 });
      }

      if (!Array.isArray(record.transcript) || record.transcript.length === 0) {
        return NextResponse.json(
          { error: `Session ${sessionId} has no recorded transcript turns to evaluate.` },
          { status: 400 }
        );
      }

      // Mark status as PENDING_EVALUATION while retrying
      await updateSessionStatus({
        sessionId,
        status: "PENDING_EVALUATION",
      });

      try {
        const evaluationResult = await evaluateTranscriptWithLLM({
          transcripts: record.transcript,
          courseTitle: record.courseTitle,
          rigorTier: rigorTier || "undergrad_3",
          syllabusTopics: syllabusTopics || [],
          durationMinutes: durationMinutes || Math.max(1, Math.round(record.actualDurationSeconds / 60)),
        });

        // Attach evaluation and mark COMPLETED
        const completed = await updateSessionStatus({
          sessionId,
          status: "COMPLETED",
          evaluationResult,
        });

        // Finding 5 Remediation: Ensure retry evaluation triggers audit fallback if needed
        triggerAsynchronousAudioAudit(sessionId).catch((err) => {
          console.warn(`[Audio Diarization Fallback] Error triggering fallback audit for session ${sessionId}:`, err);
        });

        return NextResponse.json({
          success: true,
          message: "Evaluation pass successfully completed and persisted.",
          record: completed,
          evaluation: evaluationResult,
        });
      } catch (evalErr: any) {
        console.error(`Retry evaluation failed for session ${sessionId}:`, evalErr);
        const failed = await updateSessionStatus({
          sessionId,
          status: "EVALUATION_FAILED",
          error: evalErr.message || "Retry evaluation pass failed",
        });

        return NextResponse.json(
          {
            error: `Retry evaluation pass failed: ${evalErr.message}`,
            record: failed,
          },
          { status: 502 }
        );
      }
    }

    // Default: Full session record save
    // Candidates are forbidden from creating or overwriting full records directly
    if (auth.role === "STUDENT") {
      return NextResponse.json(
        { error: "Forbidden: Direct exam record creation or overwrite is restricted to instructors." },
        { status: 403 }
      );
    }

    const {
      sessionId,
      examId,
      courseTitle,
      instructorId,
      leadProfessor,
      supervisingTaId,
      supervisingTaName,
      studentId,
      startedAt,
      endedAt,
      actualDurationSeconds,
      transcript = [],
      evaluationResult,
    } = body;

    if (!studentId || !studentId.trim()) {
      return NextResponse.json(
        { error: "Student ID is mandatory to save session record." },
        { status: 400 }
      );
    }

    if (!examId || !examId.trim()) {
      return NextResponse.json(
        { error: "Exam ID reference is mandatory to link record." },
        { status: 400 }
      );
    }

    const cleanSessionId =
      sessionId && sessionId.trim()
        ? sessionId.trim()
        : `sess_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`;

    const newRecord: ExamSessionRecord = {
      sessionId: cleanSessionId,
      examId: examId.trim(),
      courseTitle: courseTitle ? courseTitle.trim() : "Oral Defense Examination",
      instructorId: instructorId ? instructorId.trim() : undefined,
      leadProfessor: leadProfessor ? String(leadProfessor).trim() : undefined,
      supervisingTaId: supervisingTaId ? String(supervisingTaId).trim() : undefined,
      supervisingTaName: supervisingTaName ? String(supervisingTaName).trim() : undefined,
      studentId: studentId.trim(),
      status: evaluationResult ? "COMPLETED" : "IN_PROGRESS",
      startedAt: startedAt || new Date().toISOString(),
      endedAt: endedAt || new Date().toISOString(),
      actualDurationSeconds: Number(actualDurationSeconds) || 0,
      turnCount: Array.isArray(transcript) ? transcript.length : 0,
      transcript: Array.isArray(transcript) ? transcript : [],
      evaluationResult,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    const saved = await saveRecord(newRecord);
    return NextResponse.json({ success: true, record: saved }, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/defense/records error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to process defense record" },
      { status: 500 }
    );
  }
}
