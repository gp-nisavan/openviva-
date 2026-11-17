import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/apiAuth";

const VLLM_API_URL = process.env.VLLM_API_URL || "http://10.10.16.13:8000/v1/chat/completions";
const VLLM_MODEL = process.env.VLLM_MODEL || "thesven/Phi-3.5-mini-instruct-awq";

interface PreviewQuestionsRequest {
  course_title?: string;
  topics: { title: string; comment?: string }[];
  difficulty?: string;
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
    const body: PreviewQuestionsRequest = await req.json();
    const { course_title = "Oral Defense Examination", topics = [], difficulty = "intermediate" } = body;

    if (!topics || topics.length === 0) {
      return NextResponse.json({ questions: [] });
    }

    // Select up to 4 representative topics to keep generation fast
    const sampleTopics = topics.slice(0, 4);

    const systemPrompt = "You are a distinguished university professor examining a graduate oral defense in AI and Computer Vision. Respond with ONLY a valid JSON array of objects. Each object must have keys: 'topic' (string), 'starter' (string: clear introductory Socratic question, 30-50 tokens), 'followUp' (string: probing architectural trade-off, failure case, or mathematical invariant, 30-50 tokens). No markdown code blocks, preamble, or commentary. Example: [{\"topic\":\"Vision Transformers\",\"starter\":\"Why do ViTs lack inductive bias compared to CNNs?\",\"followUp\":\"How does quadratic self-attention complexity scale if input resolution doubles from 224 to 448?\"}]";

    const topicLines = sampleTopics
      .map((t) => `- "${t.title}"${t.comment ? ` (Instructor Directive: "${t.comment}")` : ""}`)
      .join("\n");

    const userPrompt = `Course: "${course_title}".
Rigor Level: ${difficulty}.
Topics to generate viva questions for:
${topicLines}

CRITICAL RULES:
1. For each topic above, craft 1 starter question and 1 follow-up question.
2. If an Instructor Directive is present for a topic, the followUp question MUST strictly test that exact directive.
3. Keep questions technically rigorous, concise, and academic (AI & Computer Vision terminology).
Output ONLY the JSON array:`;

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
          max_tokens: 600,
          stream: false,
        }),
        signal: AbortSignal.timeout(6000),
      });

      if (vllmRes.ok) {
        const data = await vllmRes.json();
        const rawContent = data?.choices?.[0]?.message?.content?.trim() || "";
        const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return NextResponse.json({ questions: parsed, source: "vllm" });
          }
        }
      }
    } catch (llmErr) {
      console.warn("vLLM call failed for preview questions, using academic heuristics:", llmErr);
    }

    // Heuristic fallback for CV/AI topics
    const fallbackQuestions = sampleTopics.map((t) => {
      const titleLower = t.title.toLowerCase();
      let starter = `Explain the primary architectural principles and assumptions behind ${t.title}.`;
      let followUp = t.comment
        ? `Regarding your instructor directive: how do you address "${t.comment}" in a production deployment?`
        : `What are the critical failure modes, compute bottlenecks, and mathematical trade-offs in ${t.title}?`;

      if (titleLower.includes("transformer") || titleLower.includes("vit") || titleLower.includes("attention")) {
        starter = `How does ${t.title} learn global contextual token dependencies compared to local convolution filters?`;
        followUp = t.comment || `How does self-attention compute scale as sequence length increases, and how is positional inductive bias preserved?`;
      } else if (titleLower.includes("diffusion") || titleLower.includes("ddpm") || titleLower.includes("generative")) {
        starter = `What is the core formulation of ${t.title}, and how does the forward Markov chain differ from reverse denoising?`;
        followUp = t.comment || `Why does the reverse U-Net predict noise residual epsilon rather than predicting the clean data manifold directly?`;
      } else if (titleLower.includes("detection") || titleLower.includes("yolo") || titleLower.includes("rcnn")) {
        starter = `How does ${t.title} handle spatial feature bounding proposals and positive-versus-negative anchor imbalance?`;
        followUp = t.comment || `Explain why standard Non-Maximum Suppression (NMS) fails with heavy occlusion and how Soft-NMS mitigates false eliminations.`;
      }

      return {
        topic: t.title,
        starter,
        followUp,
      };
    });

    return NextResponse.json({ questions: fallbackQuestions, source: "heuristic" });
  } catch (error: any) {
    console.error("Error in preview-questions:", error);
    return NextResponse.json({ error: error.message || "Failed to generate preview questions" }, { status: 500 });
  }
}
