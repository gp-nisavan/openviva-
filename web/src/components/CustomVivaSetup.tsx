"use client";

import React, { useState } from "react";
import { DocumentTOCResponse, TOCItem } from "@/types/toc";

interface CustomVivaSetupProps {
  onBackToGateway: () => void;
  onEnterRoom: (tocData: DocumentTOCResponse) => void;
}

export function CustomVivaSetup({ onBackToGateway, onEnterRoom }: CustomVivaSetupProps) {
  const [file, setFile] = useState<File | null>(null);
  const [sampleName, setSampleName] = useState<string>("");
  const [samplePages, setSamplePages] = useState<string>("5");
  const [engine, setEngine] = useState<"mineru" | "pymupdf">("mineru");
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [rawTocData, setRawTocData] = useState<(DocumentTOCResponse & { storage_path?: string }) | null>(null);
  const [filterQuery, setFilterQuery] = useState<string>("");

  const handleExtract = async (overrideSample?: string) => {
    const activeSample = overrideSample !== undefined ? overrideSample : sampleName;
    if (!file && !activeSample) {
      setError("Please select a PDF file or a sample textbook.");
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const formData = new FormData();
      if (file) {
        formData.append("file", file);
      } else if (activeSample) {
        formData.append("sample", activeSample);
      }

      formData.append("engine", engine);

      if (samplePages && parseInt(samplePages, 10) > 0) {
        formData.append("sample_pages", samplePages);
      }

      const res = await fetch("/api/extract-toc", {
        method: "POST",
        body: formData,
      });

      const data = await res.json();
      if (!res.ok) {
        throw new Error(data.details || data.error || "TOC Extraction failed");
      }

      setRawTocData(data);
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to extract headings.");
    } finally {
      setLoading(false);
    }
  };

  const filteredItems = rawTocData?.items.filter((item) => {
    if (!filterQuery) return true;
    const q = filterQuery.toLowerCase();
    return (
      item.title.toLowerCase().includes(q) ||
      (item.section_number && item.section_number.toLowerCase().includes(q)) ||
      String(item.page).includes(q)
    );
  }) || [];

  return (
    <div className="max-w-4xl mx-auto space-y-4 font-mono text-xs text-gray-200">
      {/* Navigation & Header */}
      <div className="flex items-center justify-between border-b border-gray-800 pb-2">
        <div className="space-y-0.5">
          <div className="text-sm font-bold text-gray-100">
            Task 2.1a: Document Parsing & Raw Heading/TOC Extraction
          </div>
          <div className="text-[11px] text-gray-400">
            Ingest candidate PDF offline using .venv_mineru • Extract layout blocks, headings, pages & spatial [x0, y0, x1, y1] coordinates
          </div>
        </div>
        <button
          onClick={onBackToGateway}
          className="text-blue-400 hover:underline"
        >
          &larr; Back to Mode Selection
        </button>
      </div>

      {/* PDF Selection & Ingestion Card */}
      <div className="p-3 bg-gray-950 border border-gray-800 rounded space-y-3">
        <div className="font-bold text-gray-300 uppercase tracking-wider text-[11px]">
          1. Select Candidate Document (Offline)
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          {/* File Upload Option */}
          <div className="p-2.5 bg-gray-900 border border-gray-800 rounded space-y-2">
            <div className="font-semibold text-gray-300">Upload Local PDF:</div>
            <input
              type="file"
              accept=".pdf"
              onChange={(e) => {
                const f = e.target.files?.[0] || null;
                setFile(f);
                if (f) setSampleName("");
              }}
              className="w-full text-xs text-gray-400 file:mr-2 file:py-1 file:px-2 file:rounded file:border-0 file:text-xs file:bg-gray-800 file:text-gray-200 hover:file:bg-gray-700 cursor-pointer"
            />
            {file && (
              <div className="text-[11px] text-green-400">
                Selected: {file.name} ({(file.size / 1024 / 1024).toFixed(2)} MB)
              </div>
            )}
          </div>

          {/* Preset Test Documents Option */}
          <div className="p-2.5 bg-gray-900 border border-gray-800 rounded space-y-2">
            <div className="font-semibold text-gray-300">Or Select Repository PDF:</div>
            <div className="flex flex-wrap gap-1.5">
              <button
                type="button"
                onClick={() => {
                  setSampleName("textbook.pdf");
                  setFile(null);
                }}
                className={`px-2 py-1 rounded border text-[11px] ${
                  sampleName === "textbook.pdf"
                    ? "bg-blue-900/60 border-blue-500 text-blue-200"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
                }`}
              >
                textbook.pdf (33 Bookmarks)
              </button>
              <button
                type="button"
                onClick={() => {
                  setSampleName("Deep+Learning+Ian+Goodfellow.pdf");
                  setFile(null);
                }}
                className={`px-2 py-1 rounded border text-[11px] ${
                  sampleName === "Deep+Learning+Ian+Goodfellow.pdf"
                    ? "bg-blue-900/60 border-blue-500 text-blue-200"
                    : "bg-gray-800 border-gray-700 text-gray-300 hover:bg-gray-700"
                }`}
              >
                Goodfellow Deep Learning (Layout Scan)
              </button>
            </div>
            {sampleName && (
              <div className="text-[11px] text-cyan-400">
                Using repository file: data/{sampleName}
              </div>
            )}
          </div>
        </div>

        {/* Engine Selection */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 pt-2 border-t border-gray-900 text-[11px]">
          <div className="flex items-center gap-2">
            <span className="text-gray-400 font-semibold">Parser Engine:</span>
            <button
              type="button"
              onClick={() => setEngine("mineru")}
              className={`px-2 py-1 rounded border ${
                engine === "mineru"
                  ? "bg-purple-900/60 border-purple-500 text-purple-200 font-bold"
                  : "bg-gray-900 border-gray-800 text-gray-400 hover:bg-gray-800"
              }`}
            >
              Full MinerU (DocLayout-YOLO + MFD + OCR)
            </button>
            <button
              type="button"
              onClick={() => setEngine("pymupdf")}
              className={`px-2 py-1 rounded border ${
                engine === "pymupdf"
                  ? "bg-blue-900/60 border-blue-500 text-blue-200 font-bold"
                  : "bg-gray-900 border-gray-800 text-gray-400 hover:bg-gray-800"
              }`}
            >
              Fast PyMuPDF Scan (&lt;100ms)
            </button>
          </div>
          <div className="text-[10px] text-gray-500 font-mono">
            {engine === "mineru" ? "Neural Vision Model Active" : "Heuristic Regex Scanner Active"}
          </div>
        </div>

        {/* Scan Tuning Options */}
        <div className="flex items-center gap-3 pt-1 border-t border-gray-900 text-[11px] text-gray-400">
          <label className="flex items-center gap-1.5">
            <span>Sample Pages Limit (0 = full doc):</span>
            <input
              type="number"
              min="0"
              max="1000"
              value={samplePages}
              onChange={(e) => setSamplePages(e.target.value)}
              className="w-16 bg-gray-900 border border-gray-700 rounded px-1.5 py-0.5 text-gray-200"
            />
          </label>
          <span className="text-gray-500">•</span>
          <span>Environment: <code className="text-gray-300">.venv_mineru/Scripts/python.exe</code></span>
        </div>

        {/* Action Button */}
        <button
          onClick={() => handleExtract()}
          disabled={loading || (!file && !sampleName)}
          className={`w-full py-2 rounded font-bold text-xs uppercase tracking-wider transition ${
            loading || (!file && !sampleName)
              ? "bg-gray-800 text-gray-500 cursor-not-allowed"
              : "bg-blue-600 hover:bg-blue-500 text-white"
          }`}
        >
          {loading ? "Extracting Raw Document Headings & Coordinates..." : "Execute Offline Extraction (extract_toc_with_coords.py)"}
        </button>

        {error && (
          <div className="p-2 bg-red-950/80 border border-red-800 text-red-300 rounded text-[11px]">
            Error: {error}
          </div>
        )}
      </div>

      {/* Extraction Results */}
      {rawTocData && (
        <div className="p-3 bg-gray-950 border border-gray-800 rounded space-y-3">
          <div className="flex items-center justify-between border-b border-gray-800 pb-2">
            <div className="font-bold text-gray-300 uppercase tracking-wider text-[11px]">
              2. Raw Extracted Headings Stream ({rawTocData.total_items} candidates)
            </div>
            <div className="text-[11px] text-green-400">
              Extraction Complete
            </div>
          </div>

          {/* Metadata Summary Banner */}
          <div className="grid grid-cols-2 md:grid-cols-4 gap-2 text-[11px]">
            <div className="p-2 bg-gray-900 border border-gray-800 rounded">
              <div className="text-gray-400">Document</div>
              <div className="font-bold text-gray-200 truncate">{rawTocData.filename}</div>
            </div>
            <div className="p-2 bg-gray-900 border border-gray-800 rounded">
              <div className="text-gray-400">Total Pages</div>
              <div className="font-bold text-gray-200">{rawTocData.total_pages}</div>
            </div>
            <div className="p-2 bg-gray-900 border border-gray-800 rounded">
              <div className="text-gray-400">Extraction Mode</div>
              <div className="font-bold text-cyan-300 truncate" title={rawTocData.extraction_mode}>
                {rawTocData.extraction_mode}
              </div>
            </div>
            <div className="p-2 bg-gray-900 border border-gray-800 rounded">
              <div className="text-gray-400">Storage Destination</div>
              <div className="font-bold text-yellow-300 truncate" title={rawTocData.storage_path}>
                {rawTocData.storage_path || "storage/toc_output"}
              </div>
            </div>
          </div>

          {/* Search Filter */}
          <div className="flex items-center justify-between gap-2">
            <input
              type="text"
              placeholder="Filter raw headings by title or section number..."
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              className="flex-1 bg-gray-900 border border-gray-800 rounded px-2 py-1 text-xs text-gray-200 placeholder-gray-500"
            />
            <div className="text-gray-400 text-[11px]">
              Showing {filteredItems.length} of {rawTocData.items.length}
            </div>
          </div>

          {/* Raw Headings Table */}
          <div className="border border-gray-800 rounded overflow-x-auto max-h-72 overflow-y-auto">
            <table className="w-full text-left text-[11px] border-collapse">
              <thead className="bg-gray-900 text-gray-400 sticky top-0 border-b border-gray-800">
                <tr>
                  <th className="p-1.5 border-r border-gray-800 w-12">ID</th>
                  <th className="p-1.5 border-r border-gray-800 w-10">Lvl</th>
                  <th className="p-1.5 border-r border-gray-800 w-16">Sec #</th>
                  <th className="p-1.5 border-r border-gray-800">Heading Title</th>
                  <th className="p-1.5 border-r border-gray-800 w-12">Page</th>
                  <th className="p-1.5">Bounding Box [x0, y0, x1, y1]</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-gray-900 text-gray-300">
                {filteredItems.map((item) => (
                  <tr key={item.id} className="hover:bg-gray-900/50">
                    <td className="p-1.5 border-r border-gray-800 text-gray-500 font-mono">
                      {item.id.replace("raw-toc-", "#")}
                    </td>
                    <td className="p-1.5 border-r border-gray-800 text-cyan-400 font-bold">
                      H{item.level}
                    </td>
                    <td className="p-1.5 border-r border-gray-800 font-semibold text-gray-300">
                      {item.section_number || "-"}
                    </td>
                    <td className="p-1.5 border-r border-gray-800 font-medium">
                      <span className={item.level === 1 ? "text-white font-bold" : "text-gray-300"}>
                        {item.title}
                      </span>
                    </td>
                    <td className="p-1.5 border-r border-gray-800 text-yellow-400 font-mono">
                      p.{item.page}
                    </td>
                    <td className="p-1.5 text-gray-400 font-mono text-[10px]">
                      [{item.bbox.join(", ")}]
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Action Row */}
          <div className="flex items-center justify-between pt-2 border-t border-gray-800">
            <div className="text-[11px] text-gray-400">
              Raw stream saved to <code className="text-gray-200">{rawTocData.storage_path}</code>
            </div>
            <div className="flex items-center gap-2">
              <button
                onClick={() => {
                  const blob = new Blob([JSON.stringify(rawTocData, null, 2)], { type: "application/json" });
                  const url = URL.createObjectURL(blob);
                  const a = document.createElement("a");
                  a.href = url;
                  a.download = `${rawTocData.filename}_raw_toc.json`;
                  a.click();
                  URL.revokeObjectURL(url);
                }}
                className="bg-gray-800 hover:bg-gray-700 text-gray-300 px-3 py-1.5 rounded text-xs border border-gray-700"
              >
                Export Raw JSON
              </button>
              <button
                onClick={() => onEnterRoom(rawTocData)}
                className="bg-green-700 hover:bg-green-600 text-white px-3 py-1.5 rounded text-xs font-bold"
              >
                Enter Defense Room with this Document &rarr;
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
