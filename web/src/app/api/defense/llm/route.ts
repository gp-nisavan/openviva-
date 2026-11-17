import { NextRequest, NextResponse } from "next/server";
import { authenticateApiRequest } from "@/lib/apiAuth";

const VLLM_API_URL = process.env.VLLM_API_URL || "http://10.10.16.13:8000/v1/chat/completions";
const VLLM_MODEL = process.env.VLLM_MODEL || "thesven/Phi-3.5-mini-instruct-awq";

export async function GET(req: NextRequest) {
  const authResult = await authenticateApiRequest(req, {
    allowedRoles: ["INSTRUCTOR", "STUDENT", "INTERNAL"],
    rateLimit: { max: 30 },
  });
  if (!authResult.success) {
    return authResult.response;
  }

  try {
    const modelsUrl = VLLM_API_URL.replace("/chat/completions", "/models");
    const res = await fetch(modelsUrl, { cache: "no-store" });
    const data = await res.json();
    return NextResponse.json({
      status: "online",
      targetModel: VLLM_MODEL,
      endpoint: VLLM_API_URL,
      availableModels: data?.data?.map((m: any) => m.id) || [],
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        status: "offline",
        endpoint: VLLM_API_URL,
        error: err?.message || "Failed to reach vLLM service",
      },
      { status: 502 }
    );
  }
}

export async function POST(req: NextRequest) {
  const authResult = await authenticateApiRequest(req, {
    allowedRoles: ["INSTRUCTOR", "STUDENT", "INTERNAL"],
    rateLimit: { max: 30 },
  });
  if (!authResult.success) {
    return authResult.response;
  }

  const startTime = Date.now();
  try {
    const body = await req.json().catch(() => ({}));
    const {
      prompt,
      systemPrompt = "You are an expert academic examiner conducting a rigorous oral defense (viva voce). Ask direct, concise questions or respond succinctly.",
      messages: inputMessages,
      temperature = 0.7,
      max_tokens = 512,
      stream = true,
    } = body;

    let messages = inputMessages;
    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      if (!prompt) {
        return NextResponse.json({ error: "Missing prompt or messages" }, { status: 400 });
      }
      messages = [
        { role: "system", content: systemPrompt },
        { role: "user", content: prompt },
      ];
    }

    const vllmPayload = {
      model: VLLM_MODEL,
      messages,
      temperature,
      max_tokens,
      stream,
    };

    const vllmRes = await fetch(VLLM_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify(vllmPayload),
    });

    if (!vllmRes.ok) {
      const errText = await vllmRes.text();
      return NextResponse.json(
        { error: `vLLM error (${vllmRes.status}): ${errText}` },
        { status: vllmRes.status }
      );
    }

    if (stream && vllmRes.body) {
      return new Response(vllmRes.body, {
        headers: {
          "Content-Type": "text/event-stream",
          "Cache-Control": "no-cache",
          "Connection": "keep-alive",
          "X-VLLM-Model": VLLM_MODEL,
        },
      });
    }

    const data = await vllmRes.json();
    const durationMs = Date.now() - startTime;
    return NextResponse.json({
      text: data?.choices?.[0]?.message?.content || "",
      model: data?.model || VLLM_MODEL,
      usage: data?.usage,
      durationMs,
    });
  } catch (err: any) {
    console.error("vLLM proxy error:", err);
    return NextResponse.json(
      { error: err?.message || "Internal vLLM proxy failure" },
      { status: 500 }
    );
  }
}
