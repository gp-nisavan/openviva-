"use client";

import React from "react";

interface PreJoinGatewayProps {
  onSelectStudentPortal: () => void;
  onSelectTAPortal: () => void;
}

export function PreJoinGateway({
  onSelectStudentPortal,
  onSelectTAPortal,
}: PreJoinGatewayProps) {
  return (
    <div className="min-h-[75vh] flex flex-col justify-between py-6 px-2 sm:px-4 font-sans text-white">
      {/* Massive OpenAI-Style Editorial Headline */}
      <div className="space-y-2 pt-6 sm:pt-12">
        <h1 className="text-4xl sm:text-6xl font-medium tracking-tight text-white">
          Oral examinations.
        </h1>
        <p className="text-2xl sm:text-4xl font-normal tracking-tight text-zinc-500">
          Select your role to begin.
        </p>
      </div>

      {/* Choice Cards: Clean Dual-Role Gateway */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-auto py-10 max-w-3xl">
        {/* Option 1: Teaching Assistant */}
        <button
          type="button"
          onClick={onSelectTAPortal}
          className="group text-left p-8 sm:p-10 rounded-2xl border border-zinc-800/80 bg-zinc-950/60 hover:bg-zinc-900/40 hover:border-zinc-500 active:bg-zinc-900 transition-colors duration-150 flex flex-col justify-between h-72 cursor-pointer shadow-sm touch-manipulation w-full"
        >
          <div>
            <span className="text-[11px] font-mono uppercase tracking-widest text-zinc-500 block mb-2">
              Faculty / Examiner
            </span>
            <h2 className="text-2xl sm:text-3xl font-medium text-white tracking-tight group-hover:text-zinc-100">
              Teaching Assistant
            </h2>
            <p className="text-sm text-zinc-400 mt-3 font-normal leading-relaxed">
              Course syllabus ingestion, difficulty rigor calibration, and examination presets.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 group-hover:text-white transition">
            <span>Configure syllabus</span>
            <span className="group-hover:translate-x-1.5 transition-transform duration-200 text-sm">
              →
            </span>
          </div>
        </button>

        {/* Option 2: Student */}
        <button
          type="button"
          onClick={onSelectStudentPortal}
          className="group text-left p-8 sm:p-10 rounded-2xl border border-zinc-800/80 bg-zinc-950/60 hover:bg-zinc-900/40 hover:border-zinc-500 active:bg-zinc-900 transition-colors duration-150 flex flex-col justify-between h-72 cursor-pointer shadow-sm touch-manipulation w-full"
        >
          <div>
            <span className="text-[11px] font-mono uppercase tracking-widest text-zinc-500 block mb-2">
              Candidate / Examinee
            </span>
            <h2 className="text-2xl sm:text-3xl font-medium text-white tracking-tight group-hover:text-zinc-100">
              Student
            </h2>
            <p className="text-sm text-zinc-400 mt-3 font-normal leading-relaxed">
              Enter your scheduled viva voce defense examination chamber.
            </p>
          </div>

          <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 group-hover:text-white transition">
            <span>Enter student portal</span>
            <span className="group-hover:translate-x-1.5 transition-transform duration-200 text-sm">
              →
            </span>
          </div>
        </button>
      </div>

      {/* Understated Minimalist Status Bar */}
      <div className="flex flex-col sm:flex-row items-center justify-between text-xs text-zinc-600 font-mono pt-8 border-t border-zinc-900 gap-2">
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
          <span>Autonomous Socratic Oral Defense</span>
          <span className="text-zinc-700">•</span>
          {/* iiitviva production identifier */}
          <span className="text-emerald-500/90 font-medium">iiitviva</span>
        </div>
        <div>
          <span>Local Node: 10.10.16.13 (Air-Gapped)</span>
        </div>
      </div>
    </div>
  );
}
