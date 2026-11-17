import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/apiAuth";

const VLLM_API_URL = process.env.VLLM_API_URL || "http://10.10.16.13:8000/v1/chat/completions";
const VLLM_MODEL = process.env.VLLM_MODEL || "thesven/Phi-3.5-mini-instruct-awq";

interface GenerateTopicsRequest {
  mode: "root_topics" | "subtopics";
  courseTitle?: string;
  existingTopics?: string[];
  parentTopic?: string;
  hierarchyPath?: string[];
  steeringPrompt?: string;
  difficulty?: string;
  chosenFromBatch?: string[];
  rejectedFromBatch?: string[];
  comment?: string;
  existingSubtopics?: string[];
}

export async function POST(req: NextRequest) {
  const authResult = await authenticateApiRequest(req, {
    allowedRoles: ["INSTRUCTOR", "STUDENT", "INTERNAL"],
    rateLimit: { max: 30 },
  });
  if (!authResult.success) {
    return authResult.response;
  }

  try {
    const body: any = await req.json();
    const mode = body.mode || body.context_type || "subtopics";
    const courseTitle = body.courseTitle || body.course_title || "Oral Defense Examination";
    const existingTopics: string[] = body.existingTopics || body.existing_topics || [];
    const parentTopic: string = body.parentTopic || body.parent_topic || "";
    const hierarchyPath: string[] = body.hierarchyPath || body.hierarchy_path || (parentTopic ? [parentTopic] : []);
    const comment: string = body.comment || body.notes || "";
    const steeringPrompt: string = body.steeringPrompt || body.steering_prompt || comment || "";
    const difficulty: string = body.difficulty || "undergrad_3";
    const chosenFromBatch: string[] = body.chosenFromBatch || body.chosen_topics || [];
    const rejectedFromBatch: string[] = body.rejectedFromBatch || body.rejected_topics || [];
    const existingSubtopics: string[] = body.existingSubtopics || body.existing_subtopics || [];

    let systemPrompt = "You are a distinguished university professor designing an oral defense (viva voce) syllabus. Respond with ONLY a valid JSON array of 5 to 7 technically rigorous, mechanism-level examination topic titles (strings). Do not output markdown code blocks, reasoning, or preamble. Example: [\"Topic A\", \"Topic B\", \"Topic C\", \"Topic D\", \"Topic E\"]";

    let userPrompt = "";

    if (mode === "questions") {
      systemPrompt = `You are a distinguished university professor designing oral viva examination questions with gold-standard rubric answers.
Respond with ONLY a valid JSON array of 3 to 4 objects. Each object must have "question" and "answer" fields.
Example:
[
  {
    "question": "Why does the forget gate use a sigmoid activation rather than ReLU?",
    "answer": "Sigmoid squashes outputs strictly between 0 and 1, acting as an analog percentage filter to retain or discard cell state, whereas ReLU is unbounded and would cause state explosion."
  }
]
Do not output markdown code blocks or preamble. Output JSON ONLY.`;

      userPrompt = `You are designing challenging oral examination questions with technical ground truth answers for a viva voce.
Course / Subject: "${courseTitle}".
Target Topic: "${parentTopic}".
${hierarchyPath.length > 1 ? `Hierarchy Context: ${hierarchyPath.join(" > ")}\n` : ""}
${comment ? `Instructor Directive for this topic: "${comment}"\n` : ""}
${existingSubtopics.length > 0 ? `Already Added Questions under this topic:\n${existingSubtopics.map((s: string) => `  - ${s}`).join("\n")}\n` : ""}

CRITICAL INSTRUCTIONS:
1. FORMULATE ACTUAL ORAL QUESTIONS: Output full, technical questions ("Why...", "How...", "What happens when...", "Explain why...").
2. CONCISE GROUND TRUTH ANSWERS: Each answer must be a concise, 1-2 sentence technically rigorous explanation (under 50 words) that the examiner will use as the grading rubric.
3. Output ONLY a valid JSON array of 3 objects with "question" and "answer" keys:`;
    } else if (mode === "root_topics" || mode === "root_complementary" || mode === "candidate_suggestions") {
      userPrompt = `You are designing an oral PhD defense syllabus.
Course / Subject: "${courseTitle}".
Difficulty Rigor: ${difficulty}.
${steeringPrompt ? `Focus Directives / Comment: "${steeringPrompt}"\n` : ""}
${existingTopics.length > 0 ? `Already Selected Topics (DO NOT DUPLICATE THESE):\n${existingTopics.map((t: string, i: number) => `  ${i + 1}. ${t}`).join("\n")}\n` : ""}

CRITICAL INSTRUCTIONS:
1. DEEP TECHNICAL RIGOR (NO FLUFF): Strictly avoid generic survey topics or high-level filler (e.g. do NOT return 'Applications of ...', 'Evaluating Models', 'History of ...', or 'Introduction to ...').
2. DIRECT MECHANISM DECOMPOSITION: If a specific research paper, algorithm, or architecture is referenced (e.g. 'Attention Is All You Need' by Vaswani, 'ResNet', 'Raft Consensus', 'DINOv3', 'CNN'), extract the exact concrete mathematical equations, internal architectural blocks, and operational mechanics of that work.
3. ${steeringPrompt ? `Strictly prioritize and align with the focus directive: "${steeringPrompt}".` : "Cover the primary theoretical foundations, mathematical formalisms, and core structural components."}
4. Generate 5 to 7 concise, academically formal topic titles (2 to 6 words each).
${existingTopics.length > 0 ? `5. FORBIDDEN (DO NOT REPEAT): [${[...existingTopics, ...chosenFromBatch, ...rejectedFromBatch].join(", ")}]` : ""}
${chosenFromBatch.length > 0 ? `6. POSITIVE PREFERENCE: Match the technical depth of: [${chosenFromBatch.join(", ")}].` : ""}
${rejectedFromBatch.length > 0 ? `7. NEGATIVE PREFERENCE: Avoid the direction of: [${rejectedFromBatch.join(", ")}].` : ""}
Output ONLY a JSON array of strings:`;
    } else {
      const allExcludedTopics = Array.from(
        new Set([
          ...existingTopics,
          ...existingSubtopics,
          ...chosenFromBatch,
          ...rejectedFromBatch,
          parentTopic,
        ])
      ).filter(Boolean);

      userPrompt = `You are designing a university oral examination syllabus.
Course Title: "${courseTitle}".
Difficulty Rigor: ${difficulty}.

TARGET TOPIC TO DECOMPOSE: "${parentTopic}"
${hierarchyPath.length > 1 ? `Hierarchy Path: ${hierarchyPath.join(" > ")}\n` : ""}
${comment ? `Instructor Directive for "${parentTopic}": "${comment}"\n` : ""}
${existingSubtopics.length > 0 ? `Already Added Subtopics Under "${parentTopic}":\n${existingSubtopics.map((s: string) => `  - ${s}`).join("\n")}\n` : ""}

CRITICAL INSTRUCTIONS:
1. INTERNAL SCOPE ONLY: Generate 3-4 fine-grained internal mechanisms, architectural sub-components, mathematical formulations, or failure modes that belong SPECIFICALLY INSIDE "${parentTopic}".
2. STRICT PROHIBITION: Do NOT suggest other course chapters, historical antecedents, or peer topics (e.g. if the target is Vision Transformers, do NOT suggest CNNs, ResNets, or general neural networks—only internal ViT mechanics like Patch Projection, Multi-Head Self-Attention, Positional Embeddings, [CLS] Token).
3. ${comment ? `Carefully align with the instructor directive: "${comment}". Ensure generated subtopics directly reflect this focus.` : `Break "${parentTopic}" down into its essential technical working parts for an advanced oral viva.`}
4. FORBIDDEN (DO NOT DUPLICATE OR RESUGGEST ANY OF THESE):
[${allExcludedTopics.join(", ")}]
${chosenFromBatch.length > 0 ? `5. POSITIVE PREFERENCE: The instructor explicitly approved these subtopics: [${chosenFromBatch.join(", ")}]. Suggest more subtopics matching this granular technical level.` : ""}
${rejectedFromBatch.length > 0 ? `6. NEGATIVE PREFERENCE: The instructor rejected these subtopics: [${rejectedFromBatch.join(", ")}]. Avoid those directions.` : ""}
7. Output ONLY a valid JSON array of 3-4 succinct, highly specific technical strings (e.g. ["Patch Embeddings & Projection", "Multi-Head Self-Attention Mechanism", "Positional Encoding & [CLS] Token"]):`;
    }

    try {
      const vllmRes = await fetch(VLLM_API_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          model: VLLM_MODEL,
          messages: [
            { role: "system", content: systemPrompt },
            { role: "user", content: userPrompt },
          ],
          temperature: 0.3,
          max_tokens: mode === "questions" ? 650 : 512,
          stream: false,
        }),
        signal: AbortSignal.timeout(20000),
      });

      if (vllmRes.ok) {
        const data = await vllmRes.json();
        const rawContent = data?.choices?.[0]?.message?.content?.trim() || "";

        let topics: any[] = [];
        try {
          const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
          if (jsonMatch) {
            const parsed = JSON.parse(jsonMatch[0]);
            if (Array.isArray(parsed) && parsed.length > 0) {
              topics = parsed;
            }
          }
        } catch (parseErr) {
          // Robust fallback: recover completed objects using regex
          const itemMatches = [
            ...rawContent.matchAll(
              /\{\s*"question"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*,\s*"answer"\s*:\s*"([^"\\]*(?:\\.[^"\\]*)*)"\s*\}/g
            ),
          ];
          if (itemMatches.length > 0) {
            topics = itemMatches.map((m) => ({
              question: m[1].replace(/\\"/g, '"'),
              answer: m[2].replace(/\\"/g, '"'),
            }));
          }
        }

        if (topics.length > 0) {
          const formattedTopics = topics
            .map((t: any) => {
              if (typeof t === "object" && t !== null) {
                const title = String(t.question || t.title || "").trim();
                const answerText = t.answer || t.ground_truth || "";
                const comment = answerText
                  ? `Ground Truth: ${String(answerText).trim()}`
                  : t.comment || undefined;
                return { title, comment };
              }
              return String(t).trim();
            })
            .filter((t: any) => (typeof t === "object" ? t.title : t));

          if (formattedTopics.length > 0) {
            return NextResponse.json({
              topics: formattedTopics,
              source: "vllm",
            });
          }
        }
      }
    } catch (llmErr) {
      console.warn("vLLM direct call failed or timed out:", llmErr);
    }

    return NextResponse.json(
      {
        topics: [],
        error: "Can't do it now, please create it on your own",
        source: "unavailable",
      },
      { status: 503 }
    );

  } catch (error: any) {
    console.error("Error in generate-topics:", error);
    return NextResponse.json(
      {
        topics: [],
        error: "Can't do it now, please create it on your own",
      },
      { status: 500 }
    );
  }
}
