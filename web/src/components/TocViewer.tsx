import React, { useState, useMemo } from "react";
import { TOCItem } from "@/types/toc";

interface TocViewerProps {
  items: TOCItem[];
  selectedIds: Set<string>;
  onToggleSelect: (id: string) => void;
  onSelectAll: () => void;
  onClearAll: () => void;
}

export const TocViewer: React.FC<TocViewerProps> = ({
  items,
  selectedIds,
  onToggleSelect,
  onSelectAll,
  onClearAll,
}) => {
  const [searchTerm, setSearchTerm] = useState("");
  const [levelFilter, setLevelFilter] = useState<number | null>(null);

  const filteredItems = useMemo(() => {
    return items.filter((item) => {
      const matchesSearch =
        item.title.toLowerCase().includes(searchTerm.toLowerCase()) ||
        (item.section_number && item.section_number.includes(searchTerm));
      const matchesLevel = levelFilter === null || item.level === levelFilter;
      return matchesSearch && matchesLevel;
    });
  }, [items, searchTerm, levelFilter]);

  const getIndentClass = (level: number) => {
    switch (level) {
      case 1:
        return "ml-0 bg-slate-900/90 font-bold border-l-4 border-l-cyan-500 text-slate-100 text-sm py-2.5 px-3";
      case 2:
        return "ml-4 bg-slate-950/70 font-semibold border-l-2 border-l-indigo-500/60 text-slate-200 text-xs py-2 px-3";
      case 3:
        return "ml-8 font-medium text-slate-300 text-xs py-1.5 px-3";
      case 4:
        return "ml-12 text-slate-400 text-xs py-1.5 px-3";
      case 5:
        return "ml-16 text-slate-500 text-xs py-1 px-3";
      default:
        return "ml-0 text-slate-200 text-xs py-1.5 px-3";
    }
  };

  return (
    <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-xl shadow-xl flex flex-col h-[650px]">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-4 pb-4 border-b border-slate-800/80">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-indigo-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M4 6h16M4 10h16M4 14h16M4 18h16" />
            </svg>
            Extracted Table of Contents
          </h2>
          <p className="text-xs text-slate-400">
            {selectedIds.size} of {items.length} topics selected for Viva Rubric
          </p>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={onSelectAll}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-indigo-500/10 text-indigo-300 border border-indigo-500/20 hover:bg-indigo-500/20 transition-colors"
          >
            Select All
          </button>
          <button
            onClick={onClearAll}
            className="text-xs font-semibold px-3 py-1.5 rounded-lg bg-slate-800 text-slate-400 hover:text-slate-200 border border-slate-700/80 transition-colors"
          >
            Clear
          </button>
        </div>
      </div>

      {/* Filter & Search Toolbar */}
      <div className="flex flex-col md:flex-row gap-3 mb-4">
        <div className="relative flex-1">
          <input
            type="text"
            placeholder="Search chapters or topics..."
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            className="w-full bg-slate-950/80 border border-slate-800 rounded-xl px-3.5 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:border-cyan-500/60 transition-colors pl-9"
          />
          <svg className="w-4 h-4 text-slate-500 absolute left-3 top-2.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z" />
          </svg>
        </div>

        <div className="flex items-center gap-1.5 bg-slate-950/80 border border-slate-800 p-1 rounded-xl">
          <button
            onClick={() => setLevelFilter(null)}
            className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${
              levelFilter === null ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-slate-200"
            }`}
          >
            All
          </button>
          {[1, 2, 3].map((lvl) => (
            <button
              key={lvl}
              onClick={() => setLevelFilter(levelFilter === lvl ? null : lvl)}
              className={`text-[11px] font-semibold px-2.5 py-1 rounded-lg transition-colors ${
                levelFilter === lvl ? "bg-cyan-500/20 text-cyan-300" : "text-slate-400 hover:text-slate-200"
              }`}
            >
              H{lvl}
            </button>
          ))}
        </div>
      </div>

      {/* Scrollable Tree View */}
      <div className="flex-1 overflow-y-auto space-y-1.5 pr-2 custom-scrollbar">
        {filteredItems.length === 0 ? (
          <div className="h-full flex flex-col items-center justify-center text-slate-500 py-12">
            <svg className="w-10 h-10 mb-2 opacity-40" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9.172 16.172a4 4 0 015.656 0M9 10h.01M15 10h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
            </svg>
            <p className="text-xs font-medium">No topics found matching criteria</p>
          </div>
        ) : (
          filteredItems.map((item) => {
            const isSelected = selectedIds.has(item.id);
            const indentStyle = getIndentClass(item.level);

            return (
              <div
                key={item.id}
                onClick={() => onToggleSelect(item.id)}
                className={`group rounded-xl border transition-all duration-200 cursor-pointer flex items-center justify-between gap-3 ${indentStyle} ${
                  isSelected
                    ? "bg-cyan-950/30 border-cyan-500/40 text-cyan-200"
                    : "border-slate-800/40 hover:border-slate-700 hover:bg-slate-800/40"
                }`}
              >
                <div className="flex items-center gap-3 min-w-0 flex-1">
                  <input
                    type="checkbox"
                    checked={isSelected}
                    onChange={() => {}} // handled by parent onClick
                    className="w-4 h-4 rounded border-slate-700 text-cyan-500 focus:ring-cyan-500/20 bg-slate-950 cursor-pointer"
                  />
                  <span className="truncate tracking-tight">
                    {item.section_number && (
                      <span className="font-mono text-[11px] text-cyan-400 mr-2 font-semibold">
                        {item.section_number}
                      </span>
                    )}
                    {item.title}
                  </span>
                </div>

                <div className="flex items-center gap-2 flex-shrink-0">
                  {/* Bounding Box Badge */}
                  <span
                    className="text-[10px] font-mono px-2 py-0.5 rounded bg-slate-950/80 border border-slate-800 text-slate-400 group-hover:border-cyan-500/30 group-hover:text-cyan-300 transition-colors"
                    title={`Bounding Box Coordinates [x0, y0, x1, y1]: ${item.bbox.join(", ")}`}
                  >
                    [{item.bbox.join(", ")}]
                  </span>

                  {/* Page Anchor Badge */}
                  <span className="text-[11px] font-semibold px-2 py-0.5 rounded-md bg-indigo-950/50 border border-indigo-800/40 text-indigo-300">
                    p. {item.page}
                  </span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
