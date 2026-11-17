import { ExamEvaluationResult, DefenseVerdict, PerformanceTier } from "@/types/grading";
import { TranscriptTurn } from "@/types/database";

const VLLM_API_URL = process.env.VLLM_API_URL || "http://10.10.16.13:8000/v1/chat/completions";
const VLLM_MODEL = process.env.VLLM_MODEL || "thesven/Phi-3.5-mini-instruct-awq";

export interface EvaluationOptions {
  transcripts: Array<{ sender?: string; speaker?: string; text: string; [key: string]: any } | TranscriptTurn>;
  courseTitle?: string;
  rigorTier?: string;
  syllabusTopics?: string[];
  durationMinutes?: number;
}

function safeParseEvaluationJson(rawContent: string): any {
  if (!rawContent || !rawContent.trim()) return null;

  // 1. Strip markdown fences if present
  let clean = rawContent.replace(/```(?:json)?/gi, "").replace(/```/g, "").trim();

  // 2. Direct JSON parse
  try {
    const direct = JSON.parse(clean);
    if (direct && typeof direct === "object") return direct;
  } catch (jsonErr) {
    console.debug("[evaluator] Direct JSON parse failed:", jsonErr);
  }

  // 3. Extract substring between first '{' and last '}'
  const firstBrace = clean.indexOf("{");
  if (firstBrace === -1) return null;
  const lastBrace = clean.lastIndexOf("}");
  if (lastBrace > firstBrace) {
    const candidate = clean.slice(firstBrace, lastBrace + 1);
    try {
      const parsed = JSON.parse(candidate);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (candErr) {
      console.debug("[evaluator] Substring JSON parse failed:", candErr);
    }

    // Try removing trailing commas
    try {
      const fixedCommas = candidate.replace(/,(\s*[}\]])/g, "$1");
      const parsed = JSON.parse(fixedCommas);
      if (parsed && typeof parsed === "object") return parsed;
    } catch (commaErr) {
      console.debug("[evaluator] Comma fix JSON parse failed:", commaErr);
    }
  }

  // 4. Auto-repair truncated JSON (e.g. if cut off mid-property due to max_tokens ceiling)
  try {
    let fragment = clean.slice(firstBrace);
    let inString = false;
    let escaped = false;
    const stack: string[] = [];

    for (let i = 0; i < fragment.length; i++) {
      const ch = fragment[i];
      if (escaped) {
        escaped = false;
        continue;
      }
      if (ch === "\\") {
        escaped = true;
        continue;
      }
      if (ch === '"') {
        inString = !inString;
        continue;
      }
      if (!inString) {
        if (ch === "{" || ch === "[") stack.push(ch);
        else if (ch === "}" && stack[stack.length - 1] === "{") stack.pop();
        else if (ch === "]" && stack[stack.length - 1] === "[") stack.pop();
      }
    }

    if (inString) {
      fragment += '"';
    }

    // Strip trailing incomplete key or dangling comma
    fragment = fragment.replace(/,\s*"[^"]*"?\s*:\s*[^,}\]]*$/, "");
    fragment = fragment.replace(/,\s*"[^"]*"?\s*$/, "");
    fragment = fragment.replace(/,\s*$/, "");

    // Close remaining open brackets in reverse order
    while (stack.length > 0) {
      const open = stack.pop();
      fragment += open === "{" ? "}" : "]";
    }

    // Clean trailing commas before closing braces
    fragment = fragment.replace(/,(\s*[}\]])/g, "$1");

    const repaired = JSON.parse(fragment);
    if (repaired && typeof repaired === "object") {
      console.log("[Evaluator] Successfully repaired truncated JSON from vLLM!");
      return repaired;
    }
  } catch (repairErr) {
    console.warn("[Evaluator] Truncated JSON auto-repair attempt failed:", repairErr);
  }

  // 5. Ultimate Fallback: Regex extraction from partial text
  const extractNum = (regex: RegExp, def: number): number => {
    const m = clean.match(regex);
    return m && m[1] ? parseInt(m[1], 10) : def;
  };

  const extractStr = (regex: RegExp, def: string): string => {
    const m = clean.match(regex);
    return m && m[1] ? m[1].replace(/\\"/g, '"').trim() : def;
  };

  const overallScore = extractNum(/"overallScore"\s*:\s*(\d+)/i, 50);
  const questionAdherence = extractNum(/"questionAdherence"\s*:\s*(\d+)/i, 60);
  const conceptualRigor = extractNum(/"conceptualRigor"\s*:\s*(\d+)/i, 50);
  const adversarialResistance = extractNum(/"adversarialResistance"\s*:\s*(\d+)/i, 50);
  const spokenConciseness = extractNum(/"spokenConciseness"\s*:\s*(\d+)/i, 60);
  const improvementFeedback = extractStr(
    /"improvementFeedback"\s*:\s*"([^"]+)"/i,
    "The defense concluded with preliminary discussion. Focus on deepening technical depth across foundational derivations and answering examiner inquiries thoroughly."
  );

  return {
    overallScore,
    dimensionScores: {
      questionAdherence,
      conceptualRigor,
      adversarialResistance,
      spokenConciseness,
    },
    candidateStrengths: [],
    diagnosticWeaknesses: [],
    subtopicBreakdown: [],
    improvementFeedback,
    behavioralIntegrityAudit: {
      filibusterDetected: false,
      evasionAttempted: false,
      selfCorrectionDemonstrated: false,
      observations: "Oral defense concluded with limited dialogue recorded.",
    },
  };
}

export async function evaluateTranscriptWithLLM(
  options: EvaluationOptions
): Promise<ExamEvaluationResult> {
  const {
    transcripts = [],
    courseTitle = "Oral Defense Examination",
    rigorTier = "undergrad_3",
    syllabusTopics = [],
    durationMinutes = 10,
  } = options;

  if (!Array.isArray(transcripts) || transcripts.length === 0) {
    throw new Error("Transcript is empty or missing. Cannot evaluate session.");
  }

  // Estimate tokens to dynamically adapt to vLLM's 4,096 context window
  function estimateTokens(text: string): number {
    if (!text) return 0;
    const cleaned = text.trim();
    if (!cleaned) return 0;
    const charEst = Math.ceil(cleaned.length / 3.8);
    const wordsAndPunct = cleaned.match(/[\w']+|[^\w\s]/g) || [];
    const wordEst = Math.ceil(wordsAndPunct.length * 1.25);
    return Math.max(1, Math.round(charEst * 0.6 + wordEst * 0.4));
  }

  // Format transcript into clean dialog lines, dynamically pruning middle turns if needed
  let activeTurns = [...transcripts];
  let formattedTranscript = activeTurns
    .map((t) => {
      const speakerLabel = ("speaker" in t ? t.speaker : (t as any).sender) || "Participant";
      return `${speakerLabel}: ${t.text}`;
    })
    .join("\n\n");

  while (estimateTokens(formattedTranscript) > 2300 && activeTurns.length > 6) {
    // Keep initial opening turns and recent conclusion, prune middle turns to fit comfortably
    activeTurns.splice(2, 1);
    formattedTranscript = activeTurns
      .map((t) => {
        const speakerLabel = ("speaker" in t ? t.speaker : (t as any).sender) || "Participant";
        return `${speakerLabel}: ${t.text}`;
      })
      .join("\n\n");
  }

  const systemPrompt = `You are the Senior Technical Evaluator and Committee Chair.
Your mandate is to impartially, rigorously, and diagnostically evaluate the candidate's oral defense transcript.
Your primary goal is to score the defense objectively out of 100 and provide concrete, actionable feedback on how to improve.

CRITICAL INSTRUCTION - NO PASS/FAIL LABELS:
Do NOT issue a "PASS", "FAIL", "CONDITIONAL_PASS", or "DISTINCTION" verdict. This assessment does not use pass/fail verdicts.
Instead, evaluate performance strictly as an objective score between 0 and 100, accompanied by detailed, diagnostic feedback on how the candidate can improve.

You must strictly enforce these operational evaluation laws:

1. EVIDENCE-BEFORE-SCORE (G-Eval & MT-Bench Rule):
   Never award a score based on a general impression. You must first extract verbatim quotes of the candidate's claims and analyze their causal mechanisms before deciding on any number.

2. SCORE OUT OF 100:
   Assign an objective overall score between 0 and 100 based on technical depth, precision, and foundational clarity:
   - 90-100: Explains foundational principles and causal links with high precision; handles edge cases without prompting.
   - 70-89: Solid grasp of core mechanisms; minor gaps on extreme edge cases or mathematical rigor.
   - 60-69: Relies on high-level analogies or buzzwords; lacks implementation depth or precision.
   - 0-59: Fundamental misconceptions, contradictory logic, or missing foundational definitions.

3. INDEPENDENT DIMENSIONALITY (Auto-J Standard):
   Evaluate Question Adherence, Technical Rigor, and Adversarial Resilience as separate metrics out of 100.

4. MANDATORY VERBATIM CITATIONS (OpenAI Evals Standard):
   Every documented strength or weakness MUST include a direct, word-for-word quote from the transcript. If you cannot quote it, you cannot grade it.

5. ACTIONABLE IMPROVEMENT FEEDBACK (Pedagogical Actionability):
   Provide specific, detailed feedback on how the candidate can improve:
   - Identify the exact conceptual gap or missing mechanism.
   - Specify the exact textbook chapter, architectural invariant, or derivation the student must study.
   - Advise on how they should structure their explanations to be clearer and more rigorous next time.

6. DETERMINISTIC JSON OUTPUT & CONCISE BREAKDOWN:
   - Output ONLY a valid, parseable JSON object matching the requested schema. Do not generate markdown backticks or conversational preamble.
   - In "subtopicBreakdown", ONLY include 1 to 3 topics that were actively discussed in the transcript. Do NOT list unaddressed syllabus topics.
   - Keep all text fields concise (under 2 sentences per topic).`;

  const userPrompt = `Course Title: "${courseTitle}"
Target Rigor Tier: ${rigorTier}

Syllabus Scope & Target Topics:
${syllabusTopics.length > 0 ? syllabusTopics.map((s) => `• ${s}`).join("\n") : "Topics assessed during defense"}

---
FULL EXAMINATION TRANSCRIPT:
${formattedTranscript}
---

Evaluate this transcript with an objective score out of 100 and detailed feedback on how to improve (do NOT use pass/fail verdicts).
Return ONLY a valid JSON object matching this schema:
{
  "overallScore": <integer between 0 and 100>,
  "verdict": "EVALUATED",
  "dimensionScores": {
    "questionAdherence": <integer 0-100>,
    "conceptualRigor": <integer 0-100>,
    "adversarialResistance": <integer 0-100>,
    "spokenConciseness": <integer 0-100>
  },
  "candidateStrengths": [
    {
      "area": "<specific topic or concept>",
      "evidenceQuote": "<direct verbatim quote of candidate's best spoken explanation>",
      "facultyAppraisal": "<why this was technically sound>"
    }
  ],
  "diagnosticWeaknesses": [
    {
      "topic": "<specific topic>",
      "flawedClaimQuote": "<quote where candidate faltered, gave vague answers, or made errors>",
      "underlyingMisconception": "<precise theoretical error or missing mechanism>",
      "remediationPrescription": "<concrete advice on how to improve: exact topic, textbook chapter, or invariant to study>"
    }
  ],
  "subtopicBreakdown": [
    {
      "subtopic": "<topic title - ONLY include 1 to 3 topics actually discussed in the transcript>",
      "score": <integer 0-100>,
      "performanceTier": "EVALUATED",
      "evidenceCitation": "<verbatim excerpt or 'Candidate did not provide substantive response' if brief>",
      "detailedAssessment": "<concise 1-2 sentence assessment>"
    }
  ],
  "behavioralIntegrityAudit": {
    "filibusterDetected": <boolean>,
    "evasionAttempted": <boolean>,
    "selfCorrectionDemonstrated": <boolean>,
    "observations": "<concise note on candidate cadence and technical communication>"
  },
  "improvementFeedback": "<comprehensive 2-4 sentence diagnostic coaching feedback explaining the top priorities for the candidate to improve their technical mastery>",
  "committeeChairFeedback": "<constructive feedback addressing the student on how to strengthen their technical depth and viva performance>"
}`;

  const estimatedInputTokens = estimateTokens(systemPrompt + userPrompt);
  // Guarantee (input_tokens + max_tokens) <= 3950 < 4096 hardware ceiling
  const dynamicMaxTokens = Math.min(1500, Math.max(500, 3950 - estimatedInputTokens));

  const vllmRes = await fetch(VLLM_API_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      model: VLLM_MODEL,
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.1,
      max_tokens: dynamicMaxTokens,
      response_format: { type: "json_object" },
      stream: false,
    }),
    signal: AbortSignal.timeout(35000),
  });

  if (!vllmRes.ok) {
    const errorText = await vllmRes.text().catch(() => "");
    throw new Error(`vLLM evaluation failed with HTTP status ${vllmRes.status}: ${errorText}`);
  }

  const data = await vllmRes.json();
  const rawContent = data?.choices?.[0]?.message?.content?.trim() || "";
  console.log(
    `[Evaluator] vLLM raw response (${rawContent.length} chars). Finish reason: ${data?.choices?.[0]?.finish_reason}`
  );

  const parsed = safeParseEvaluationJson(rawContent);
  if (!parsed || (typeof parsed.overallScore !== "number" && typeof parsed.overall_score !== "number")) {
    throw new Error(
      `vLLM output did not contain a valid overallScore numeric field. Raw output: ${rawContent.slice(0, 300)}`
    );
  }

  const overall = Math.min(100, Math.max(0, parsed.overallScore ?? parsed.overall_score ?? 70));
  const dimScores = parsed.dimensionScores || parsed.dimension_scores || {};
  const adherence = Math.min(100, Math.max(0, dimScores.questionAdherence ?? dimScores.question_adherence ?? 75));
  const rigor = Math.min(100, Math.max(0, dimScores.conceptualRigor ?? dimScores.conceptual_rigor ?? 70));
  const resistance = Math.min(100, Math.max(0, dimScores.adversarialResistance ?? dimScores.adversarial_resistance ?? 70));
  const conciseness = Math.min(100, Math.max(0, dimScores.spokenConciseness ?? dimScores.spoken_conciseness ?? 75));

  const verdict: DefenseVerdict = "EVALUATED";
  const improvementFeedback =
    parsed.improvementFeedback ||
    parsed.improvement_feedback ||
    parsed.committeeChairFeedback ||
    parsed.committee_chair_feedback ||
    "Continue strengthening technical explanations with direct mathematical and architectural mechanics.";

  const evaluation: ExamEvaluationResult = {
    overallScore: overall,
    verdict,
    improvementFeedback,
    dimensionScores: {
      questionAdherence: adherence,
      conceptualRigor: rigor,
      adversarialResistance: resistance,
      spokenConciseness: conciseness,
    },
    conceptualRigorScore: rigor,
    clarityScore: conciseness,
    adversarialResistanceScore: resistance,
    candidateStrengths: Array.isArray(parsed.candidateStrengths || parsed.candidate_strengths)
      ? (parsed.candidateStrengths || parsed.candidate_strengths).map((s: any) => ({
        area: s.area || s.topic || "Core Domain Knowledge",
        evidenceQuote: s.evidenceQuote || s.evidence_quote || "Spoken response in transcript",
        facultyAppraisal: s.facultyAppraisal || s.faculty_appraisal || "Accurate demonstration of domain principles.",
      }))
      : [],
    diagnosticWeaknesses: Array.isArray(parsed.diagnosticWeaknesses || parsed.diagnostic_weaknesses)
      ? (parsed.diagnosticWeaknesses || parsed.diagnostic_weaknesses).map((w: any) => ({
        topic: w.topic || "Technical Mechanism",
        flawedClaimQuote: w.flawedClaimQuote || w.flawed_claim_quote || "Spoken response in transcript",
        underlyingMisconception: w.underlyingMisconception || w.underlying_misconception || "Conceptual gap identified under questioning.",
        remediationPrescription: w.remediationPrescription || w.remediation_prescription || "Review foundational derivations and causal invariants.",
      }))
      : [],
    subtopicBreakdown: Array.isArray(parsed.subtopicBreakdown || parsed.subtopic_breakdown)
      ? (parsed.subtopicBreakdown || parsed.subtopic_breakdown).map((item: any) => ({
        subtopic: item.subtopic || "Core Curriculum Topic",
        score: Math.min(100, Math.max(0, item.score ?? 70)),
        performanceTier: (item.performanceTier || item.performance_tier || "COMPETENT") as PerformanceTier,
        evidenceQuote: item.evidenceCitation || item.evidence_citation || item.evidenceQuote || "Spoken response in transcript",
        assessment: item.detailedAssessment || item.detailed_assessment || item.assessment || "Evaluated by committee.",
      }))
      : [],
    strengths: Array.isArray(parsed.candidateStrengths)
      ? parsed.candidateStrengths.map((s: any) => s.facultyAppraisal || s.area)
      : ["Solid grounding in core technical concepts."],
    weaknesses: Array.isArray(parsed.diagnosticWeaknesses)
      ? parsed.diagnosticWeaknesses.map((w: any) => `${w.topic}: ${w.underlyingMisconception}`)
      : ["Could deepen precision under adversarial counter-probing."],
    behavioralFlags: [],
    behavioralAudit: parsed.behavioralIntegrityAudit || parsed.behavioral_integrity_audit || {
      filibusterDetected: false,
      evasionAttempted: false,
      selfCorrectionDemonstrated: true,
      observations: "Normal academic conversational cadence maintained.",
    },
    committeeRemarks: parsed.committeeChairFeedback || parsed.committee_chair_feedback || parsed.committeeRemarks || "The candidate has completed the oral defense in good academic standing.",
    evaluatedAt: new Date().toISOString(),
    durationMinutes,
  };

  return evaluation;
}
