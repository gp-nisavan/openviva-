import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/apiAuth";

const VLLM_API_URL = process.env.VLLM_API_URL || "http://10.10.16.13:8000/v1/chat/completions";
const VLLM_MODEL = process.env.VLLM_MODEL || "thesven/Phi-3.5-mini-instruct-awq";

interface NormalizeSyllabusRequest {
  rawText: string;
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
    const body: NormalizeSyllabusRequest = await req.json();
    const { rawText = "" } = body;

    if (!rawText.trim()) {
      return NextResponse.json({ topics: [] });
    }

    const systemPrompt = `You are a strict text hierarchy parser. Your ONLY job is to parse the user's outline into a JSON tree of topics and subtopics.
RULES:
1. Use outline numbering, bullets, and indentation (e.g. '1.', '1 ', '1.1', '-', tabs) to determine parent vs child hierarchy.
2. STRIP leading list markers and numbering (e.g. '1.', '1 ', '1.1', '-', '*') from the 'title'. The title must be ONLY the clean topic name (e.g. '1 abc' -> title: 'abc').
3. NEVER invent, hallucinate, or inject external topics. Use ONLY the user's text.
4. Output ONLY a valid JSON array of objects: [{"title": "...", "children": [...]}]
5. No markdown backticks, no explanations.`;

    const userPrompt = `Parse the following text into a hierarchical JSON array of topics. Strip outline numbering from titles:
"""
${rawText.slice(0, 3000)}
"""

Output JSON array:`;

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
          temperature: 0.2,
          max_tokens: 800,
          stream: false,
        }),
        signal: AbortSignal.timeout(7000),
      });

      if (vllmRes.ok) {
        const data = await vllmRes.json();
        const rawContent = data?.choices?.[0]?.message?.content?.trim() || "";
        const jsonMatch = rawContent.match(/\[[\s\S]*\]/);
        if (jsonMatch) {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed) && parsed.length > 0) {
            return NextResponse.json({ topics: parsed, source: "vllm" });
          }
        }
      }
    } catch (llmErr) {
      console.warn("vLLM call failed for syllabus normalization, using heuristic line parser:", llmErr);
    }

    // Heuristic fallback: line-by-line cleaner
    const lines = rawText
      .split("\n")
      .map((l) => l.trim().replace(/^[-*•#\d\.\s]+/, "").trim())
      .filter((l) => l.length > 2 && l.length < 80);

    const fallbackTopics = lines.slice(0, 6).map((line) => ({
      title: line,
      children: [],
    }));

    return NextResponse.json({ topics: fallbackTopics, source: "heuristic" });
  } catch (error: any) {
    console.error("Error in normalize-syllabus:", error);
    return NextResponse.json({ error: error.message || "Failed to normalize syllabus" }, { status: 500 });
  }
}
