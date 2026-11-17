import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/apiAuth";

const VLLM_API_URL = process.env.VLLM_API_URL || "http://10.10.16.13:8000/v1/chat/completions";
const VLLM_MODEL = process.env.VLLM_MODEL || "thesven/Phi-3.5-mini-instruct-awq";

interface ClusterQuestionsRequest {
  rawText: string;
  courseTitle?: string;
}

export async function POST(req: NextRequest) {
  const authResult = await authenticateApiRequest(req, {
    allowedRoles: ["INSTRUCTOR", "INTERNAL"],
    rateLimit: { max: 30 },
  });
  if (!authResult.success) {
    return authResult.response;
  }

  try {
    const body: ClusterQuestionsRequest = await req.json();
    const { rawText = "", courseTitle = "Oral Examination" } = body;

    if (!rawText.trim()) {
      return NextResponse.json({ topics: [] });
    }

    const systemPrompt = `You are an expert curriculum architect and oral examination designer.
Analyze the input questions and answers. Look at the answer text to identify the core technical concept being tested, then organize them into a clean 2-level hierarchy:

Rules:
1. TWO-LEVEL HIERARCHY (Domain -> Questions):
   - Level 1: Concise, academic domain titles (e.g. "Transformer Architectures", "Convolutional Neural Networks", "Optimization Techniques").
   - Level 2: The exact examination questions placed directly under their matching domain.
2. STRICT DISCIPLINARY ISOLATION: Never combine fundamentally different academic disciplines or fields under the same parent topic.
3. DOMAIN HOMOGENEITY: Group all questions testing the same domain together under that Level 1 topic.
4. PRESERVE GROUND TRUTH: For every Level 2 question, preserve the instructor's exact answer in the "comment" field as "Ground Truth: <answer>".
5. NO DUPLICATES: Each question must appear exactly once in the entire tree.
6. ESCAPE INTERNAL QUOTES: In JSON strings, any internal quotation marks must be escaped as \" or replaced with single quotes.
7. Output MUST be 100% pure JSON matching the schema below.
8. Do NOT output markdown code blocks (do NOT use \`\`\`json or \`\`\`).
9. Do NOT include greetings, intro text, or explanation. Output JSON ONLY.

JSON Schema:
{
  "topics": [
    {
      "id": "1",
      "title": "Academic Domain Name",
      "level": 1,
      "children": [
        {
          "id": "1.1",
          "title": "Exact Question Text",
          "level": 2,
          "comment": "Ground Truth: <Instructor's exact answer>"
        }
      ]
    }
  ]
}`;

    const userPrompt = `Course/Subject: "${courseTitle}"
Analyze and hierarchically cluster these questions and answers into distinct topics:
"""
${rawText.slice(0, 4000)}
"""

Output JSON ONLY:`;

    const vllmRes = await fetch(VLLM_API_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        model: VLLM_MODEL,
        messages: [
          {"role": "system", "content": systemPrompt},
          {"role": "user", "content": userPrompt}
        ],
        temperature: 0.0,
        max_tokens: 1500,
        stream: false,
      }),
      signal: AbortSignal.timeout(25000),
    });

    if (!vllmRes.ok) {
      const errText = await vllmRes.text();
      console.error("vLLM error in cluster-questions:", errText);
      return NextResponse.json({ error: `LLM service returned error: ${vllmRes.status}` }, { status: 502 });
    }

    const data = await vllmRes.json();
    const rawContent = data?.choices?.[0]?.message?.content?.trim() || "";

    // Clean any markdown formatting if present
    let clean = rawContent.trim();
    if (clean.startsWith("```json")) clean = clean.slice(7);
    else if (clean.startsWith("```")) clean = clean.slice(3);
    if (clean.endsWith("```")) clean = clean.slice(0, -3);
    clean = clean.trim();

    // Find JSON boundaries
    const firstBrace = clean.indexOf("{");
    const lastBrace = clean.lastIndexOf("}");
    if (firstBrace !== -1 && lastBrace !== -1 && lastBrace > firstBrace) {
      clean = clean.substring(firstBrace, lastBrace + 1);
    }

    let topics: any[] = [];
    try {
      const parsed = JSON.parse(clean);
      topics = Array.isArray(parsed?.topics) ? parsed.topics : (Array.isArray(parsed) ? parsed : []);
    } catch (parseErr) {
      console.warn("Direct JSON.parse failed, attempting unescaped quote repair:", parseErr);
      try {
        const repaired = clean.replace(/\\'/g, "'");
        const parsed = JSON.parse(repaired);
        topics = Array.isArray(parsed?.topics) ? parsed.topics : (Array.isArray(parsed) ? parsed : []);
      } catch (fallbackErr) {
        throw parseErr;
      }
    }

    // Recursive ID and level assignment supporting arbitrary nesting depth
    const assignHierarchyRecursively = (nodes: any[], prefix = "", currentLevel = 1): any[] => {
      return nodes.map((node, idx) => {
        const id = prefix ? `${prefix}.${idx + 1}` : String(idx + 1);
        const children = Array.isArray(node.children) && node.children.length > 0
          ? assignHierarchyRecursively(node.children, id, currentLevel + 1)
          : [];
        return {
          ...node,
          id,
          level: currentLevel,
          children,
        };
      });
    };

    // Consolidate top-level domains by title & recursively deduplicate leaf questions
    const consolidatedMap = new Map<string, any>();
    const seenLeafQuestions = new Set<string>();

    const deduplicateLeaves = (childrenList: any[]): any[] => {
      const result: any[] = [];
      for (const item of childrenList) {
        if (!item || !item.title) continue;
        if (Array.isArray(item.children) && item.children.length > 0) {
          const filteredChildren = deduplicateLeaves(item.children);
          if (filteredChildren.length > 0) {
            result.push({ ...item, children: filteredChildren });
          }
        } else {
          const qKey = item.title.trim().toLowerCase();
          if (!seenLeafQuestions.has(qKey)) {
            seenLeafQuestions.add(qKey);
            result.push(item);
          }
        }
      }
      return result;
    };

    for (const topic of topics) {
      if (!topic || typeof topic !== "object") continue;
      const normalizedTitle = (topic.title || "General").trim();
      const key = normalizedTitle.toLowerCase();

      if (!consolidatedMap.has(key)) {
        consolidatedMap.set(key, {
          ...topic,
          title: normalizedTitle,
          children: [],
        });
      }

      const target = consolidatedMap.get(key);
      const rawChildren = Array.isArray(topic.children) ? topic.children : [];
      const cleanChildren = deduplicateLeaves(rawChildren);
      target.children.push(...cleanChildren);
    }

    const rawConsolidated = Array.from(consolidatedMap.values()).filter((t) => t.children.length > 0);
    const finalTopics = assignHierarchyRecursively(rawConsolidated, "", 1);

    return NextResponse.json({ topics: finalTopics.length > 0 ? finalTopics : topics, source: "vllm" });
  } catch (error: any) {
    console.error("Error in cluster-questions route:", error);
    return NextResponse.json({ error: error.message || "Failed to cluster questions" }, { status: 500 });
  }
}

