import { NextRequest, NextResponse } from "next/server";
import { getRecordBySessionId, updateSessionStatus } from "@/lib/db";
import { evaluateTranscriptWithLLM } from "@/lib/evaluator";
import { authenticateApiRequest } from "@/lib/apiAuth";

// POST /api/defense/records/retry
// Dedicated error recovery endpoint allowing manual or automated retry of failed evaluation passes
// without requiring candidate re-test. Restricted exclusively to instructors & internal services.
export async function POST(req: NextRequest) {
  const authResult = await authenticateApiRequest(req, {
    allowedRoles: ["INSTRUCTOR", "INTERNAL"],
    rateLimit: { max: 30 },
  });
  if (!authResult.success) {
    return authResult.response;
  }

  try {
    const body = await req.json();
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

    // Set status to PENDING_EVALUATION before invoking LLM
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
  } catch (err: any) {
    console.error("POST /api/defense/records/retry error:", err);
    return NextResponse.json(
      { error: err.message || "Failed to retry defense evaluation" },
      { status: 500 }
    );
  }
}
