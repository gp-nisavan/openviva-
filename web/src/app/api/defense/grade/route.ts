import { NextRequest, NextResponse } from "next/server";
import { evaluateTranscriptWithLLM } from "@/lib/evaluator";
import { authenticateApiRequest } from "@/lib/apiAuth";

export async function POST(req: NextRequest) {
  const authResult = await authenticateApiRequest(req, {
    allowedRoles: ["INSTRUCTOR", "STUDENT", "INTERNAL"],
    rateLimit: { max: 30 },
  });
  if (!authResult.success) {
    return authResult.response;
  }

  try {
    const body = await req.json();
    const {
      transcripts = [],
      courseTitle = "Oral Defense Examination",
      rigorTier = "undergrad_3",
      syllabusTopics = [],
      durationMinutes = 10,
    } = body;

    if (!Array.isArray(transcripts) || transcripts.length === 0) {
      return NextResponse.json(
        { error: "Transcript is empty or missing" },
        { status: 400 }
      );
    }

    const evaluation = await evaluateTranscriptWithLLM({
      transcripts,
      courseTitle,
      rigorTier,
      syllabusTopics,
      durationMinutes,
    });

    return NextResponse.json({
      success: true,
      evaluation,
    });
  } catch (error: any) {
    console.error("Error in /api/defense/grade:", error);
    return NextResponse.json(
      { error: error.message || "Failed to evaluate defense" },
      { status: 500 }
    );
  }
}
