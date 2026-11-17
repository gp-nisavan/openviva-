"use client";

import React, { useState, useEffect, useRef } from "react";
import { apiUrl } from "@/lib/api";

interface Message {
  role: "user" | "assistant";
  content: string;
}

export default function BarebonesLLMChat() {
  const [endpoint, setEndpoint] = useState("http://10.10.16.13:8000/v1");
  const [model, setModel] = useState("thesven/Phi-3.5-mini-instruct-awq");
  const [availableModels, setAvailableModels] = useState<string[]>([
    "thesven/Phi-3.5-mini-instruct-awq",
    "microsoft/Phi-3.5-mini-instruct",
  ]);
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [status, setStatus] = useState("Checking...");
  const endRef = useRef<HTMLDivElement>(null);

  // Fetch available models on mount
  useEffect(() => {
    fetch(apiUrl(`/api/llm?endpoint=${encodeURIComponent(endpoint)}`), { credentials: "include" })
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.data && Array.isArray(data.data)) {
          const ids = data.data.map((m: { id: string }) => m.id);
          if (ids.length > 0) {
            setAvailableModels(ids);
            setModel(ids[0]);
          }
          setStatus("Online");
        } else {
          setStatus("Online");
        }
      })
      .catch(() => setStatus("Offline"));
  }, [endpoint]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, loading]);

  const send = async (textToSend?: string) => {
    const text = textToSend || input;
    if (!text.trim() || loading) return;

    const newMsgs: Message[] = [...messages, { role: "user", content: text }];
    setMessages(newMsgs);
    setInput("");
    setLoading(true);

    try {
      const res = await fetch(apiUrl("/api/llm"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({
          endpoint,
          model,
          messages: newMsgs,
          temperature: 0.7,
          max_tokens: 512,
        }),
      });

      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed");

      const reply = data.choices?.[0]?.message?.content || "(No response)";
      setMessages([...newMsgs, { role: "assistant", content: reply }]);
      setStatus("Online");
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "Error";
      setMessages([...newMsgs, { role: "assistant", content: `[Error: ${msg}]` }]);
      setStatus("Error");
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="flex flex-col h-screen max-w-3xl mx-auto p-4 font-mono text-sm">
      {/* Barebones Header */}
      <div className="flex items-center gap-2 border-b border-slate-800 pb-3 mb-3 text-xs flex-wrap">
        <span className="font-bold text-white">LLM Lab</span>
        <span className="text-slate-500">|</span>
        <span className={status === "Online" ? "text-emerald-400" : "text-rose-400"}>
          ● {status}
        </span>
        <span className="text-slate-500">|</span>

        <label className="text-slate-400">Host:</label>
        <input
          value={endpoint}
          onChange={(e) => setEndpoint(e.target.value)}
          className="bg-slate-900 border border-slate-800 px-2 py-1 rounded text-slate-200 w-48 text-xs"
        />

        <label className="text-slate-400 ml-2">Model:</label>
        <select
          value={model}
          onChange={(e) => setModel(e.target.value)}
          className="bg-slate-900 border border-slate-800 px-2 py-1 rounded text-slate-200 text-xs"
        >
          {availableModels.map((m) => (
            <option key={m} value={m}>
              {m}
            </option>
          ))}
        </select>

        {messages.length > 0 && (
          <button
            onClick={() => setMessages([])}
            className="ml-auto text-slate-500 hover:text-white"
          >
            Clear
          </button>
        )}
      </div>

      {/* Messages Feed */}
      <div className="flex-1 overflow-y-auto space-y-3 pr-2">
        {messages.length === 0 && (
          <div className="text-slate-600 text-center mt-20 text-xs">
            No messages yet. Send a prompt below to test {model}.
          </div>
        )}

        {messages.map((m, i) => (
          <div
            key={i}
            className={`p-3 rounded border text-xs leading-relaxed ${m.role === "user"
              ? "bg-slate-900/90 border-slate-700 text-cyan-200 ml-8"
              : "bg-black/60 border-slate-800 text-slate-200 mr-8"
              }`}
          >
            <div className="text-[10px] uppercase text-slate-500 mb-1 font-bold">
              {m.role === "user" ? "You" : model}
            </div>
            <div className="whitespace-pre-wrap">{m.content}</div>
          </div>
        ))}

        {loading && (
          <div className="text-slate-500 text-xs p-3 font-mono animate-pulse">
            Generating response...
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Quick Prompts */}
      <div className="flex gap-2 py-2 text-[11px] overflow-x-auto text-slate-400 border-t border-slate-800/50 mt-2">
        <button
          onClick={() => send("Confirm you are online and name one prominent Kannada author.")}
          className="hover:text-cyan-400 underline"
        >
          [Kannada Author]
        </button>
        <button
          onClick={() => send("Give me a one-sentence conceptual oral viva question on operating systems.")}
          className="hover:text-cyan-400 underline"
        >
          [Viva Question]
        </button>
        <button
          onClick={() => send("Explain python GIL in 2 bullet points.")}
          className="hover:text-cyan-400 underline"
        >
          [Python GIL]
        </button>
      </div>

      {/* Input */}
      <form
        onSubmit={(e) => {
          e.preventDefault();
          send();
        }}
        className="flex gap-2 pt-2"
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Type message..."
          className="flex-1 bg-slate-900 border border-slate-800 px-3 py-2 rounded text-slate-100 text-xs focus:outline-none focus:border-cyan-500"
        />
        <button
          type="submit"
          disabled={!input.trim() || loading}
          className="bg-slate-800 hover:bg-slate-700 disabled:opacity-30 text-white px-4 py-2 rounded text-xs"
        >
          Send
        </button>
      </form>
    </div>
  );
}
