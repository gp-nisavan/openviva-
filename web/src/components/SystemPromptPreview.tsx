import React, { useState, useEffect } from "react";
import { TOCItem, SystemPromptResponse } from "@/types/toc";

interface SystemPromptPreviewProps {
  selectedItems: TOCItem[];
  courseTitle: string;
}

export const SystemPromptPreview: React.FC<SystemPromptPreviewProps> = ({
  selectedItems,
  courseTitle,
}) => {
  const [promptText, setPromptText] = useState<string>("");
  const [loading, setLoading] = useState<boolean>(false);
  const [copied, setCopied] = useState<boolean>(false);

  useEffect(() => {
    const fetchPrompt = async () => {
      if (selectedItems.length === 0) {
        setPromptText(
          "# OpenViva Socratic Viva System Prompt\n\n[Select chapters or topics from the Table of Contents on the left to generate the examination system prompt with spatial coordinates...]"
        );
        return;
      }

      setLoading(true);
      try {
        const res = await fetch("/api/generate-prompt", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            course_title: courseTitle,
            selected_chapters: Array.from(
              new Set(selectedItems.map((i) => i.section_number?.split(".")[0] || i.title))
            ),
            items: selectedItems,
          }),
        });

        if (!res.ok) throw new Error("Failed to generate prompt");
        const data: SystemPromptResponse = await res.json();
        setPromptText(data.system_prompt);
      } catch (err) {
        console.error(err);
      } finally {
        setLoading(false);
      }
    };

    fetchPrompt();
  }, [selectedItems, courseTitle]);

  const handleCopy = () => {
    navigator.clipboard.writeText(promptText);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownload = () => {
    const blob = new Blob([promptText], { type: "text/plain;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "viva_system_prompt.txt";
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-xl shadow-xl flex flex-col h-[650px]">
      <div className="flex items-center justify-between mb-4 pb-4 border-b border-slate-800/80">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
            </svg>
            Generated Socratic System Prompt
          </h2>
          <p className="text-xs text-slate-400">
            {selectedItems.length} spatial bounding boxes included in prompt context
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleCopy}
            disabled={selectedItems.length === 0}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-emerald-500/10 text-emerald-300 border border-emerald-500/20 hover:bg-emerald-500/20 transition-colors flex items-center gap-1.5 disabled:opacity-50"
          >
            {copied ? (
              <>
                <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M5 13l4 4L19 7" />
                </svg>
                Copied!
              </>
            ) : (
              <>
                <svg className="w-3.5 h-3.5 text-emerald-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M8 5H6a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2v-1M8 5a2 2 0 002 2h2a2 2 0 002-2M8 5a2 2 0 012-2h2a2 2 0 012 2" />
                </svg>
                Copy Prompt
              </>
            )}
          </button>
          <button
            onClick={handleDownload}
            disabled={selectedItems.length === 0}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 text-slate-300 hover:text-white border border-slate-700/80 transition-colors disabled:opacity-50"
          >
            Download .txt
          </button>
        </div>
      </div>

      <div className="flex-1 bg-slate-950/90 border border-slate-800/80 rounded-xl p-4 overflow-y-auto font-mono text-xs text-slate-300 relative custom-scrollbar">
        {loading && (
          <div className="absolute inset-0 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center gap-2 text-cyan-400">
            <div className="w-5 h-5 border-2 border-cyan-500 border-t-transparent rounded-full animate-spin"></div>
            <span>Updating System Prompt...</span>
          </div>
        )}
        <pre className="whitespace-pre-wrap font-mono text-[11px] leading-relaxed text-slate-300">
          {promptText}
        </pre>
      </div>
    </div>
  );
};
