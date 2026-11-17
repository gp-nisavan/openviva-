import React, { useRef, useState } from "react";
import { DocumentTOCResponse } from "@/types/toc";

interface PdfUploaderProps {
  onExtract: (data: DocumentTOCResponse) => void;
  loading: boolean;
  setLoading: (l: boolean) => void;
  tocData: DocumentTOCResponse | null;
}

export const PdfUploader: React.FC<PdfUploaderProps> = ({
  onExtract,
  loading,
  setLoading,
  tocData,
}) => {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const [selectedFileName, setSelectedFileName] = useState<string | null>(null);

  const handleFileUpload = async (file?: File) => {
    setLoading(true);
    try {
      const formData = new FormData();
      if (file) {
        formData.append("file", file);
        setSelectedFileName(file.name);
      }

      const res = await fetch("/api/extract-toc", {
        method: "POST",
        body: file ? formData : undefined,
      });

      if (!res.ok) throw new Error("TOC Extraction Failed");

      const data: DocumentTOCResponse = await res.json();
      onExtract(data);
    } catch (err: any) {
      console.error(err);
      alert("Failed to extract TOC from PDF: " + err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="bg-slate-900/60 border border-slate-800/80 rounded-2xl p-6 backdrop-blur-xl shadow-xl">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-base font-semibold text-slate-100 flex items-center gap-2">
            <svg className="w-5 h-5 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12" />
            </svg>
            Textbook PDF Ingestion
          </h2>
          <p className="text-xs text-slate-400">Upload any course PDF to run MinerU / PyMuPDF spatial coordinate extraction</p>
        </div>
      </div>

      <div
        onClick={() => fileInputRef.current?.click()}
        className={`border-2 border-dashed rounded-xl p-8 text-center cursor-pointer transition-all duration-300 ${
          loading
            ? "border-cyan-500/50 bg-cyan-950/20"
            : "border-slate-800 hover:border-cyan-500/40 hover:bg-slate-800/30"
        }`}
      >
        <input
          ref={fileInputRef}
          type="file"
          accept=".pdf"
          className="hidden"
          onChange={(e) => {
            const file = e.target.files?.[0];
            if (file) handleFileUpload(file);
          }}
        />

        {loading ? (
          <div className="flex flex-col items-center justify-center py-4 gap-3">
            <div className="w-10 h-10 border-4 border-cyan-500/20 border-t-cyan-400 rounded-full animate-spin"></div>
            <p className="text-sm font-medium text-cyan-300">Extracting TOC & Spatial Coordinates [x0, y0, x1, y1]...</p>
            <p className="text-xs text-slate-400 font-mono">Running PyMuPDF Layout Engine</p>
          </div>
        ) : (
          <div className="flex flex-col items-center justify-center gap-2">
            <div className="w-12 h-12 rounded-full bg-slate-800/80 flex items-center justify-center text-slate-400 mb-1 border border-slate-700/50">
              <svg className="w-6 h-6 text-cyan-400" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="1.5" d="M9 12h6m-6 4h6m2 5H7a2 2 0 01-2-2V5a2 2 0 012-2h5.586a1 1 0 01.707.293l5.414 5.414a1 1 0 01.293.707V19a2 2 0 01-2 2z" />
              </svg>
            </div>
            <p className="text-sm font-medium text-slate-200">
              {selectedFileName ? (
                <span className="text-cyan-400 font-semibold">{selectedFileName}</span>
              ) : (
                <>Drop textbook PDF here or <span className="text-cyan-400 hover:underline">browse</span></>
              )}
            </p>
            <p className="text-xs text-slate-400">Supports PDF format up to 200 MB</p>
          </div>
        )}
      </div>

      {tocData && (
        <div className="mt-4 pt-4 border-t border-slate-800/60 grid grid-cols-2 md:grid-cols-4 gap-3">
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/60">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Active PDF</p>
            <p className="text-xs font-semibold text-slate-200 truncate mt-0.5" title={tocData.filename}>
              {tocData.filename}
            </p>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/60">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Total Pages</p>
            <p className="text-xs font-bold text-cyan-400 mt-0.5">{tocData.total_pages} Pages</p>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/60">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Extracted Topics</p>
            <p className="text-xs font-bold text-indigo-400 mt-0.5">{tocData.total_items} Headings</p>
          </div>
          <div className="bg-slate-950/60 p-3 rounded-xl border border-slate-800/60">
            <p className="text-[10px] font-semibold uppercase tracking-wider text-slate-400">Pipeline Mode</p>
            <p className="text-[11px] font-medium text-emerald-400 truncate mt-0.5" title={tocData.extraction_mode}>
              {tocData.extraction_mode}
            </p>
          </div>
        </div>
      )}
    </div>
  );
};
