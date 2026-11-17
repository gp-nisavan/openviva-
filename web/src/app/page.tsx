"use client";

import "@/lib/api";
import React, { useState } from "react";
import { PreJoinGateway } from "@/components/PreJoinGateway";
import { StudentPortal } from "@/components/StudentPortal";
import { CustomVivaSetup } from "@/components/CustomVivaSetup";
import { TAPortal } from "@/components/TAPortal";
import { DefenseViewStack2 } from "@/components/DefenseViewStack2";
import { DocumentTOCResponse } from "@/types/toc";
import { ExamPreset } from "@/types/database";


export default function HomePage() {
  const [mode, setMode] = useState<
    | "gateway"
    | "student_portal"
    | "custom_setup"
    | "ta_portal"
    | "room"
  >("gateway");
  const [activeStudentId, setActiveStudentId] = useState<string>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = sessionStorage.getItem("openviva_student_id");
        if (saved) return saved;
      } catch (err) {
        console.debug("[page] sessionStorage read studentId warning:", err);
      }
    }
    return "";
  });
  const [selectedToc, setSelectedToc] = useState<DocumentTOCResponse | null>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = sessionStorage.getItem("openviva_active_toc");
        if (saved) return JSON.parse(saved);
      } catch (err) {
        console.debug("[page] sessionStorage read toc warning:", err);
      }
    }
    return null;
  });
  const [selectedPrompt, setSelectedPrompt] = useState<string | undefined>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = sessionStorage.getItem("openviva_active_prompt");
        if (saved) return saved;
      } catch (err) {
        console.debug("[page] sessionStorage read prompt warning:", err);
      }
    }
    return undefined;
  });
  const [selectedDuration, setSelectedDuration] = useState<number | undefined>(() => {
    if (typeof window !== "undefined") {
      try {
        const saved = sessionStorage.getItem("openviva_active_duration");
        if (saved) return Number(saved);
      } catch (err) {
        console.debug("[page] sessionStorage read duration warning:", err);
      }
    }
    return undefined;
  });
  const [selectedLeadProf, setSelectedLeadProf] = useState<string | undefined>(() => {
    if (typeof window !== "undefined") {
      try {
        return sessionStorage.getItem("openviva_active_lead_prof") || undefined;
      } catch (err) {
        console.debug("[page] sessionStorage read leadProf warning:", err);
      }
    }
    return undefined;
  });
  const [selectedTaId, setSelectedTaId] = useState<string | undefined>(() => {
    if (typeof window !== "undefined") {
      try {
        return sessionStorage.getItem("openviva_active_ta_id") || undefined;
      } catch (err) {
        console.debug("[page] sessionStorage read taId warning:", err);
      }
    }
    return undefined;
  });
  const [selectedTaName, setSelectedTaName] = useState<string | undefined>(() => {
    if (typeof window !== "undefined") {
      try {
        return sessionStorage.getItem("openviva_active_ta_name") || undefined;
      } catch (err) {
        console.debug("[page] sessionStorage read taName warning:", err);
      }
    }
    return undefined;
  });

  // Fallback sync active defense session across storage events
  React.useEffect(() => {
    if (typeof window === "undefined") return;
    try {


      const savedPrompt = sessionStorage.getItem("openviva_active_prompt");
      if (savedPrompt && !selectedPrompt) setSelectedPrompt(savedPrompt);

      const savedDuration = sessionStorage.getItem("openviva_active_duration");
      if (savedDuration && !selectedDuration) setSelectedDuration(Number(savedDuration));

      const savedToc = sessionStorage.getItem("openviva_active_toc");
      if (savedToc && !selectedToc) setSelectedToc(JSON.parse(savedToc));

      const savedStudent = sessionStorage.getItem("openviva_student_id");
      if (savedStudent && activeStudentId === "student_01") setActiveStudentId(savedStudent);

      const savedLead = sessionStorage.getItem("openviva_active_lead_prof");
      if (savedLead && !selectedLeadProf) setSelectedLeadProf(savedLead);

      const savedTaId = sessionStorage.getItem("openviva_active_ta_id");
      if (savedTaId && !selectedTaId) setSelectedTaId(savedTaId);

      const savedTaName = sessionStorage.getItem("openviva_active_ta_name");
      if (savedTaName && !selectedTaName) setSelectedTaName(savedTaName);
    } catch (e) {
      console.error("Failed to restore session from sessionStorage:", e);
    }
  }, []);

  const updateActiveSession = (
    toc: DocumentTOCResponse | null,
    prompt?: string,
    duration?: number,
    studentId?: string,
    leadProf?: string,
    taId?: string,
    taName?: string
  ) => {
    setSelectedToc(toc);
    setSelectedPrompt(prompt);
    setSelectedDuration(duration);
    if (studentId) setActiveStudentId(studentId);
    setSelectedLeadProf(leadProf);
    setSelectedTaId(taId);
    setSelectedTaName(taName);

    if (typeof window !== "undefined") {
      try {
        if (prompt) sessionStorage.setItem("openviva_active_prompt", prompt);
        else sessionStorage.removeItem("openviva_active_prompt");

        if (duration) sessionStorage.setItem("openviva_active_duration", String(duration));
        else sessionStorage.removeItem("openviva_active_duration");

        if (toc) sessionStorage.setItem("openviva_active_toc", JSON.stringify(toc));
        else sessionStorage.removeItem("openviva_active_toc");

        if (studentId) sessionStorage.setItem("openviva_student_id", studentId);

        if (leadProf) sessionStorage.setItem("openviva_active_lead_prof", leadProf);
        else sessionStorage.removeItem("openviva_active_lead_prof");

        if (taId) sessionStorage.setItem("openviva_active_ta_id", taId);
        else sessionStorage.removeItem("openviva_active_ta_id");

        if (taName) sessionStorage.setItem("openviva_active_ta_name", taName);
        else sessionStorage.removeItem("openviva_active_ta_name");
      } catch (e) {
        console.error("Failed to write to sessionStorage:", e);
      }
    }
  };

  // Sync mode with browser history and handle browser Back/Forward buttons
  React.useEffect(() => {
    const parseUrl = () => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const view = params.get("view");
      if (view === "ta") {
        setMode("ta_portal");
      } else if (view === "student") {
        setMode("student_portal");
      } else if (view === "room") {
        setMode("room");
      } else if (view === "setup") {
        setMode("custom_setup");
      } else {
        setMode("gateway");
      }
    };

    parseUrl();
    window.addEventListener("popstate", parseUrl);
    return () => window.removeEventListener("popstate", parseUrl);
  }, []);

  const navigateToMode = (
    newMode:
      | "gateway"
      | "student_portal"
      | "custom_setup"
      | "ta_portal"
      | "room"
  ) => {
    setMode(newMode);
    if (typeof window !== "undefined") {
      let url = "/";
      if (newMode === "ta_portal") url = "/?view=ta";
      else if (newMode === "student_portal") url = "/?view=student";
      else if (newMode === "room") url = "/?view=room";
      else if (newMode === "custom_setup") url = "/?view=setup";
      window.history.pushState({ mode: newMode }, "", url);
    }
  };

  const handleBackToGateway = () => {
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      navigateToMode("gateway");
    }
  };

  return (
    <div className="min-h-screen bg-black text-white p-4 md:p-8 font-sans selection:bg-white selection:text-black flex flex-col justify-between">
      {/* OpenAI-Style Minimal Nav */}
      <header className="max-w-5xl w-full mx-auto flex items-center justify-between pb-4">
        <div className="flex items-center gap-2">
          <button
            onClick={() => navigateToMode("gateway")}
            className="text-base font-semibold tracking-tight text-white hover:text-zinc-300 transition cursor-pointer"
          >
            OpenViva
          </button>
          {/* iiitviva production deployment badge */}
          <span className="text-[10px] font-mono tracking-wider px-2 py-0.5 rounded-full bg-zinc-900 border border-zinc-700/60 text-emerald-400 font-medium">
            iiitviva
          </span>
        </div>

        <div className="flex items-center gap-3">
          {mode !== "gateway" && (
            <button
              onClick={handleBackToGateway}
              className="text-xs text-zinc-400 hover:text-white transition font-mono cursor-pointer"
            >
              ← Back
            </button>
          )}
          {mode === "room" && (
            <button
              onClick={() => navigateToMode("ta_portal")}
              className="text-xs text-zinc-400 hover:text-white transition font-mono cursor-pointer"
            >
              [TA Console]
            </button>
          )}

          <span className="text-[11px] text-zinc-600 font-mono hidden sm:inline">
            Node: 10.10.16.13
          </span>
        </div>
      </header>

      {/* Main Workspace */}
      <main className="max-w-5xl w-full mx-auto my-auto py-2">
        {mode === "gateway" && (
          <PreJoinGateway
            onSelectStudentPortal={() => navigateToMode("student_portal")}
            onSelectTAPortal={() => navigateToMode("ta_portal")}
          />
        )}
        {mode === "student_portal" && (
          <StudentPortal
            defaultStudentId={activeStudentId}
            onLaunchPresetExam={(preset: ExamPreset, studentId: string) => {
              const flatItems = preset.topics || [];
              const tocResponse: DocumentTOCResponse = {
                filename: `${preset.courseTitle}.syllabus`,
                total_pages: 1,
                extraction_mode: "Interactive Co-Pilot Curriculum Generator",
                total_items: flatItems.length,
                items: flatItems,
              };
              updateActiveSession(
                tocResponse,
                preset.systemPrompt,
                preset.durationMinutes,
                studentId,
                preset.leadProfessor,
                preset.supervisingTaId,
                preset.supervisingTaName
              );
              navigateToMode("room");
            }}
            onLaunchCustomExam={(toc, prompt, duration, studentId) => {
              updateActiveSession(toc, prompt, duration, studentId);
              navigateToMode("room");
            }}
            onBackToGateway={handleBackToGateway}
          />
        )}
        {mode === "ta_portal" && (
          <TAPortal
            onBackToGateway={handleBackToGateway}
            onLaunchExamRoom={(toc: DocumentTOCResponse, prompt?: string, duration?: number) => {
              updateActiveSession(toc, prompt, duration);
              navigateToMode("room");
            }}
          />
        )}
        {mode === "custom_setup" && (
          <CustomVivaSetup
            onBackToGateway={() => setMode("gateway")}
            onEnterRoom={(toc) => {
              updateActiveSession(toc, undefined, undefined);
              setMode("room");
            }}
          />
        )}
        {mode === "room" && (
          <DefenseViewStack2
            key={`room_${activeStudentId}_${selectedToc?.filename || ""}`}
            initialRoom="stack2-chamber-01"
            initialStudentId={activeStudentId}
            systemPrompt={selectedPrompt}
            durationMinutes={selectedDuration}
            courseTitle={
              selectedToc?.filename
                ? selectedToc.filename.replace(/\.(syllabus|practice\.syllabus)$/, "")
                : undefined
            }
            leadProfessor={selectedLeadProf}
            supervisingTaId={selectedTaId}
            supervisingTaName={selectedTaName}
            syllabusTopics={selectedToc?.items?.map((item) => item.title)}
            syllabusItems={selectedToc?.items}
            stackName="Main Stack"
          />
        )}

      </main>

      {/* Quiet Footer */}
      <footer className="max-w-5xl w-full mx-auto pt-6 text-[11px] text-zinc-700 font-mono flex items-center justify-between">
        <span>Autonomous Socratic Oral Defense</span>
        <span>Open-Source On-Premises Engine</span>
      </footer>
    </div>
  );
}
