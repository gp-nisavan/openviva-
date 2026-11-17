import React from "react";

export const Header: React.FC = () => {
  return (
    <header className="w-full border-b border-slate-800/80 bg-slate-950/80 backdrop-blur-xl sticky top-0 z-50 px-6 py-4 flex items-center justify-between shadow-2xl shadow-cyan-950/20">
      <div className="flex items-center gap-3">
        <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-400 via-indigo-500 to-purple-600 p-[2px] shadow-lg shadow-cyan-500/20">
          <div className="w-full h-full bg-slate-950 rounded-[10px] flex items-center justify-center">
            <span className="font-extrabold text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-indigo-400 text-lg">OV</span>
          </div>
        </div>
        <div>
          <h1 className="font-bold text-slate-100 text-lg tracking-tight flex items-center gap-2">
            OpenViva <span className="text-xs font-semibold px-2 py-0.5 rounded-full bg-cyan-500/10 text-cyan-400 border border-cyan-500/20">TA Dashboard</span>
          </h1>
          <p className="text-xs text-slate-400 font-medium">Textbook Extraction & Socratic Examination Engine</p>
        </div>
      </div>

      <div className="flex items-center gap-4">
        <div className="flex items-center gap-2 text-xs font-mono bg-slate-900/90 border border-slate-800 px-3 py-1.5 rounded-lg text-slate-300">
          <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse"></span>
          <span>Phase 1: Extraction Bridge Active</span>
        </div>
        <a
          href="/proctor-lab"
          className="text-xs font-mono font-semibold text-violet-400 bg-violet-950/60 border border-violet-700/60 px-3 py-1.5 rounded hover:bg-violet-900/80 transition-colors"
        >
          👁️ MobileCLIP Lab
        </a>
        <a
          href="/defense"
          className="text-xs font-mono font-semibold text-emerald-400 bg-emerald-950/60 border border-emerald-700/60 px-3 py-1.5 rounded hover:bg-emerald-900/80 transition-colors"
        >
          🎙️ Oral Defense Room
        </a>
        <a
          href="https://github.com"
          target="_blank"
          rel="noreferrer"
          className="text-xs font-medium text-slate-400 hover:text-slate-200 transition-colors px-3 py-1.5 rounded-lg hover:bg-slate-900 border border-transparent hover:border-slate-800"
        >
          Docs
        </a>
      </div>
    </header>
  );
};
