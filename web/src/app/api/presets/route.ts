import { NextRequest, NextResponse } from "next/server";
import {
  getAllExams,
  getExamById,
  saveExam,
  deleteExam,
  validateInstructorSession,
} from "@/lib/db";
import { ExamPreset, InstructorAccount } from "@/types/database";

/**
 * Extracts and validates instructor session from Bearer Authorization header or session cookie.
 */
async function getInstructorSessionFromReq(req: NextRequest): Promise<InstructorAccount | null> {
  const authHeader = req.headers.get("authorization");
  const cookieToken = req.cookies.get("openviva_session")?.value;
  const token = authHeader?.replace(/^Bearer\s+/i, "") || cookieToken;
  if (!token) return null;
  try {
    return await validateInstructorSession(token);
  } catch {
    return null;
  }
}

// Helper: Redact secret prompts and candidate rosters for unauthenticated / candidate clients
function sanitizeExamForClient(exam: ExamPreset): ExamPreset {
  return {
    ...exam,
    systemPrompt: "",
    globalDirective: undefined,
    accessControl: {
      type: exam.accessControl?.type || "OPEN",
    },
  };
}

// GET /api/presets
// Returns all saved exams, or a single exam if ?id=<id> is supplied
export async function GET(req: NextRequest) {
  try {
    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");
    const taId =
      searchParams.get("supervisingTaId") ||
      searchParams.get("supervising_ta_id") ||
      searchParams.get("taId") ||
      searchParams.get("ta_id") ||
      undefined;

    // Check if caller is an authenticated instructor/TA
    const instructorSession = await getInstructorSessionFromReq(req);
    const isPrivileged = Boolean(instructorSession);

    if (id) {
      const exam = await getExamById(id);
      if (!exam) {
        return NextResponse.json({ error: "Exam preset not found" }, { status: 404 });
      }
      return NextResponse.json({
        exam: isPrivileged ? exam : sanitizeExamForClient(exam),
      });
    }

    const exams = await getAllExams(taId);
    return NextResponse.json({
      exams: isPrivileged ? exams : exams.map(sanitizeExamForClient),
    });
  } catch (err: any) {
    console.error("GET /api/presets error:", err);
    return NextResponse.json({ error: err.message || "Failed to fetch exams" }, { status: 500 });
  }
}

// POST /api/presets
// Validates, checks RBAC permissions, and saves an exam preset
export async function POST(req: NextRequest) {
  try {
    // 1. Enforce Instructor Session Authentication
    const session = await getInstructorSessionFromReq(req);
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized: Valid instructor session required to create or modify exam presets." },
        { status: 401 }
      );
    }

    const body = await req.json();
    const {
      id,
      courseTitle,
      instructorId,
      leadProfessor,
      supervisingTaId,
      supervisingTaName,
      difficultyTier = "undergrad_3",
      durationMinutes = 10,
      studentDecidesWeightage = false,
      globalDirective = "",
      accessControl,
      totalTopics = 0,
      topics = [],
      systemPrompt = "",
    } = body;

    // Strict validation: Course Title is mandatory
    if (!courseTitle || !courseTitle.trim()) {
      return NextResponse.json(
        { error: "Course title is mandatory and cannot be empty." },
        { status: 400 }
      );
    }

    // 2. Enforce Role Hierarchy & Exam Ownership
    const targetExamId = id && String(id).trim() ? String(id).trim() : null;
    if (targetExamId) {
      const existingExam = await getExamById(targetExamId);
      if (existingExam && session.role === "TA") {
        // If an existing exam has a supervising TA assigned, only that TA (or Professor/Admin) may modify it
        if (existingExam.supervisingTaId && existingExam.supervisingTaId !== session.id) {
          return NextResponse.json(
            { error: "Forbidden: Teaching Assistants can only modify exam presets they supervise." },
            { status: 403 }
          );
        }
      }
    }

    // Determine effective instructor details
    let effectiveSupervisingTaId = supervisingTaId ? String(supervisingTaId).trim() : undefined;
    let effectiveSupervisingTaName = supervisingTaName ? String(supervisingTaName).trim() : undefined;

    // If a TA is creating the exam, assign them as supervising TA by default
    if (session.role === "TA") {
      effectiveSupervisingTaId = session.id;
      effectiveSupervisingTaName = `${session.displayName} (${session.username})`;
    }

    const effectiveInstructor =
      instructorId && instructorId.trim()
        ? instructorId.trim()
        : leadProfessor && leadProfessor.trim()
        ? leadProfessor.trim()
        : effectiveSupervisingTaName || session.displayName;

    // Generate clean unique ID if not provided
    const cleanCourseKey = courseTitle
      .trim()
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "_")
      .slice(0, 32);
    const examId = targetExamId || `exam_${cleanCourseKey}_${Date.now().toString(36)}`;

    const presetData: ExamPreset = {
      id: examId,
      courseTitle: courseTitle.trim(),
      instructorId: effectiveInstructor,
      leadProfessor: leadProfessor ? String(leadProfessor).trim() : undefined,
      supervisingTaId: effectiveSupervisingTaId,
      supervisingTaName: effectiveSupervisingTaName,
      difficultyTier,
      durationMinutes: Number(durationMinutes) || 10,
      studentDecidesWeightage: Boolean(studentDecidesWeightage),
      globalDirective: globalDirective ? String(globalDirective).trim() : undefined,
      accessControl: accessControl && accessControl.type ? {
        type: accessControl.type === "RESTRICTED" ? "RESTRICTED" : "OPEN",
        allowedStudents: Array.isArray(accessControl.allowedStudents)
          ? accessControl.allowedStudents
              .map((s: any) => ({
                name: String(s?.name || "").trim(),
                regNo: String(s?.regNo || "").trim(),
              }))
              .filter((s: any) => s.regNo.length > 0)
          : undefined,
      } : undefined,
      totalTopics: topics.length || totalTopics || 0,
      topics: Array.isArray(topics) ? topics : [],
      systemPrompt: systemPrompt || "",
      createdAt: body.createdAt || new Date().toISOString(),
    };

    const saved = await saveExam(presetData);
    return NextResponse.json({ success: true, exam: saved }, { status: 201 });
  } catch (err: any) {
    console.error("POST /api/presets error:", err);
    return NextResponse.json({ error: err.message || "Failed to save exam preset" }, { status: 500 });
  }
}

// DELETE /api/presets?id=<id>
// Enforces that only PROFESSOR or ADMIN roles can delete exam presets
export async function DELETE(req: NextRequest) {
  try {
    // 1. Enforce Instructor Session Authentication
    const session = await getInstructorSessionFromReq(req);
    if (!session) {
      return NextResponse.json(
        { error: "Unauthorized: Valid instructor session required to delete exam presets." },
        { status: 401 }
      );
    }

    // 2. Enforce Role Hierarchy: Only PROFESSOR or ADMIN can delete
    if (session.role !== "ADMIN" && session.role !== "PROFESSOR") {
      return NextResponse.json(
        { error: "Forbidden: Deleting exam presets requires PROFESSOR or ADMIN privileges." },
        { status: 403 }
      );
    }

    const { searchParams } = new URL(req.url);
    const id = searchParams.get("id");

    if (!id || !id.trim()) {
      return NextResponse.json({ error: "Missing exam ID to delete" }, { status: 400 });
    }

    const existing = await getExamById(id.trim());
    if (!existing) {
      return NextResponse.json({ error: "Exam preset not found" }, { status: 404 });
    }

    const success = await deleteExam(id.trim());
    return NextResponse.json({ success });
  } catch (err: any) {
    console.error("DELETE /api/presets error:", err);
    return NextResponse.json({ error: err.message || "Failed to delete exam" }, { status: 500 });
  }
}
