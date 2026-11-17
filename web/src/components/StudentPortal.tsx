"use client";

import React, { useState, useEffect, useMemo } from "react";
import { ExamPreset } from "@/types/database";
import { DocumentTOCResponse } from "@/types/toc";
import { StudentCustomViva } from "./StudentCustomViva";
import { BiometricEnrollmentModal } from "./BiometricEnrollmentModal";
import { BiometricGateModal } from "./BiometricGateModal";
import { StudentAuthModal, StudentAuthData } from "./StudentAuthModal";

interface StudentPortalProps {
  onLaunchPresetExam: (preset: ExamPreset, studentId: string) => void;
  onLaunchCustomExam: (
    toc: DocumentTOCResponse,
    prompt?: string,
    duration?: number,
    studentId?: string
  ) => void;
  onBackToGateway: () => void;
  defaultStudentId?: string;
}

const RIGOR_LABELS: Record<string, string> = {
  undergrad_1: "Year 1 Introductory",
  undergrad_2: "Year 2 Foundational",
  undergrad_3: "Year 3 Intermediate",
  undergrad_4: "Year 4 Advanced",
  grad: "Graduate / Master's",
  advanced: "Doctorate / PhD Defense",
};

function ArchitecturalHeroGraphic() {
  return (
    <div className="relative w-full h-44 sm:h-52 md:h-56 overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-br from-zinc-950 via-[#0a0a14] to-black shadow-lg">
      {/* Volumetric Shifting Architectural Lighting Beam */}
      <div
        className="pointer-events-none absolute -top-16 -right-12 w-80 h-80 sm:w-96 sm:h-96 rounded-full bg-gradient-to-br from-purple-600/35 via-indigo-600/25 to-transparent blur-3xl animate-architectural-light"
      />
      
      {/* Secondary gentle violet highlight */}
      <div
        className="pointer-events-none absolute top-1/4 right-1/3 w-48 h-48 rounded-full bg-violet-500/15 blur-2xl"
      />

      {/* SVG Modern Brutalist Architectural Building Facade */}
      <svg
        viewBox="0 0 500 240"
        fill="none"
        preserveAspectRatio="xMidYMid meet"
        className="absolute inset-0 w-full h-full opacity-85 select-none"
      >
        <defs>
          <linearGradient id="wallGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1e1e28" />
            <stop offset="50%" stopColor="#13131c" />
            <stop offset="100%" stopColor="#0b0b12" />
          </linearGradient>
          <linearGradient id="wallGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2c2c3c" />
            <stop offset="100%" stopColor="#111118" />
          </linearGradient>
          <linearGradient id="beamRay" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(168, 85, 247, 0.45)" />
            <stop offset="100%" stopColor="rgba(99, 102, 241, 0)" />
          </linearGradient>
          <linearGradient id="edgeGlow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#c084fc" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {/* Horizon Grid Lines */}
        <line x1="0" y1="210" x2="500" y2="210" stroke="#27272a" strokeWidth="0.75" strokeOpacity="0.4" />
        <line x1="0" y1="225" x2="500" y2="225" stroke="#27272a" strokeWidth="0.5" strokeOpacity="0.25" />

        {/* Volumetric Light Cone across the roof */}
        <polygon points="340,20 180,240 480,240" fill="url(#beamRay)" opacity="0.35" />

        {/* Building Block 1: Right Monolith */}
        <polygon points="360,20 490,60 490,240 360,240" fill="url(#wallGrad1)" stroke="#3f3f46" strokeWidth="0.75" />
        {/* Monolith Windows */}
        <rect x="385" y="70" width="22" height="42" fill="#08080c" stroke="#27272a" strokeWidth="0.5" />
        <rect x="425" y="85" width="22" height="42" fill="#08080c" stroke="#27272a" strokeWidth="0.5" />
        <rect x="385" y="135" width="22" height="42" fill="#08080c" stroke="#27272a" strokeWidth="0.5" />
        <rect x="425" y="150" width="22" height="42" fill="#08080c" stroke="#27272a" strokeWidth="0.5" />

        {/* Building Block 2: Center Main Facade with Perspective */}
        <polygon points="260,75 360,20 360,240 260,240" fill="url(#wallGrad2)" stroke="#52525b" strokeWidth="0.75" />
        {/* Recessed Vertical Slot Windows */}
        <line x1="285" y1="100" x2="285" y2="210" stroke="#18181b" strokeWidth="3" />
        <line x1="315" y1="80" x2="315" y2="210" stroke="#18181b" strokeWidth="3" />
        <line x1="340" y1="60" x2="340" y2="210" stroke="#18181b" strokeWidth="3" />

        {/* Building Block 3: Lower Left Wing */}
        <polygon points="170,135 260,75 260,240 170,240" fill="url(#wallGrad1)" stroke="#3f3f46" strokeWidth="0.75" />
        <rect x="195" y="150" width="38" height="26" fill="#0a0b12" stroke="#27272a" strokeWidth="0.5" />

        {/* Roof Highlight Line with Violet Glow */}
        <line x1="260" y1="75" x2="360" y2="20" stroke="url(#edgeGlow)" strokeWidth="1.5" />
        <circle cx="360" cy="20" r="3.5" fill="#a855f7" filter="drop-shadow(0 0 6px #c084fc)" />

        {/* Architectural Perspective Grid Rays */}
        <line x1="360" y1="20" x2="100" y2="170" stroke="#a855f7" strokeWidth="0.5" strokeDasharray="3 4" opacity="0.3" />
        <line x1="360" y1="20" x2="50" y2="230" stroke="#a855f7" strokeWidth="0.5" strokeDasharray="3 4" opacity="0.2" />
      </svg>

      {/* Floating Modern Subtitle in bottom-right corner */}
      <div className="absolute right-4 bottom-3 z-10 font-mono text-[9px] uppercase tracking-[0.25em] text-zinc-500/80 bg-zinc-950/70 px-2 py-0.5 rounded border border-zinc-800/40 backdrop-blur-xs">
        OPENVIVA // EXAMINATION PORTAL
      </div>
    </div>
  );
}

function GeometricCardPattern({ index }: { index: number }) {
  const patternType = index % 5;

  if (patternType === 0) {
    // Wave Mesh / Undulating Terrain
    return (
      <svg
        className="absolute right-0 bottom-0 w-44 h-28 pointer-events-none opacity-20 group-hover:opacity-55 text-purple-400 group-hover:text-purple-300 transition-all duration-500"
        viewBox="0 0 180 110"
        fill="none"
      >
        <path d="M0,90 Q45,30 90,80 T180,50" stroke="currentColor" strokeWidth="0.8" />
        <path d="M0,95 Q45,40 90,85 T180,60" stroke="currentColor" strokeWidth="0.8" />
        <path d="M0,100 Q45,50 90,90 T180,70" stroke="currentColor" strokeWidth="0.8" />
        <path d="M0,105 Q45,60 90,95 T180,80" stroke="currentColor" strokeWidth="0.8" />
        <path d="M30,75 L30,110 M60,65 L60,110 M90,85 L90,110 M120,70 L120,110 M150,60 L150,110" stroke="currentColor" strokeWidth="0.5" strokeDasharray="2 3" opacity="0.5" />
      </svg>
    );
  }

  if (patternType === 1) {
    // Constellation / Distributed Graph
    return (
      <svg
        className="absolute right-0 bottom-0 w-44 h-28 pointer-events-none opacity-20 group-hover:opacity-55 text-indigo-400 group-hover:text-indigo-300 transition-all duration-500"
        viewBox="0 0 180 110"
        fill="none"
      >
        <line x1="30" y1="40" x2="80" y2="25" stroke="currentColor" strokeWidth="0.8" />
        <line x1="80" y1="25" x2="140" y2="45" stroke="currentColor" strokeWidth="0.8" />
        <line x1="80" y1="25" x2="105" y2="80" stroke="currentColor" strokeWidth="0.8" />
        <line x1="30" y1="40" x2="60" y2="90" stroke="currentColor" strokeWidth="0.8" />
        <line x1="60" y1="90" x2="105" y2="80" stroke="currentColor" strokeWidth="0.8" />
        <line x1="105" y1="80" x2="160" y2="90" stroke="currentColor" strokeWidth="0.8" />
        <line x1="140" y1="45" x2="160" y2="90" stroke="currentColor" strokeWidth="0.8" />
        <circle cx="30" cy="40" r="2.5" fill="currentColor" />
        <circle cx="80" cy="25" r="3" fill="currentColor" />
        <circle cx="140" cy="45" r="2.5" fill="currentColor" />
        <circle cx="60" cy="90" r="2.5" fill="currentColor" />
        <circle cx="105" cy="80" r="3" fill="currentColor" />
        <circle cx="160" cy="90" r="2" fill="currentColor" />
      </svg>
    );
  }

  if (patternType === 2) {
    // Concentric Sonar / Radar Arcs
    return (
      <svg
        className="absolute right-0 bottom-0 w-44 h-28 pointer-events-none opacity-20 group-hover:opacity-55 text-violet-400 group-hover:text-violet-300 transition-all duration-500"
        viewBox="0 0 180 110"
        fill="none"
      >
        <circle cx="170" cy="100" r="30" stroke="currentColor" strokeWidth="0.8" strokeDasharray="3 3" />
        <circle cx="170" cy="100" r="60" stroke="currentColor" strokeWidth="0.8" />
        <circle cx="170" cy="100" r="90" stroke="currentColor" strokeWidth="0.8" strokeDasharray="4 4" />
        <circle cx="170" cy="100" r="120" stroke="currentColor" strokeWidth="0.8" />
        <line x1="70" y1="100" x2="170" y2="100" stroke="currentColor" strokeWidth="0.6" opacity="0.6" />
        <line x1="170" y1="0" x2="170" y2="100" stroke="currentColor" strokeWidth="0.6" opacity="0.6" />
      </svg>
    );
  }

  if (patternType === 3) {
    // Dot Matrix Grid
    return (
      <svg
        className="absolute right-0 bottom-0 w-44 h-28 pointer-events-none opacity-20 group-hover:opacity-55 text-sky-400 group-hover:text-sky-300 transition-all duration-500"
        viewBox="0 0 180 110"
        fill="none"
      >
        <g opacity="0.5">
          {[...Array(6)].map((_, r) => (
            <g key={r}>
              {[...Array(10)].map((_, c) => (
                <circle key={c} cx={40 + c * 14} cy={20 + r * 14} r="1" fill="currentColor" />
              ))}
            </g>
          ))}
        </g>
        <circle cx="68" cy="48" r="2.5" fill="currentColor" opacity="0.9" />
        <circle cx="124" cy="62" r="2.5" fill="currentColor" opacity="0.9" />
        <circle cx="96" cy="90" r="2.5" fill="currentColor" opacity="0.9" />
      </svg>
    );
  }

  // Hex Circuit Technical Lines
  return (
    <svg
      className="absolute right-0 bottom-0 w-44 h-28 pointer-events-none opacity-20 group-hover:opacity-55 text-purple-400 group-hover:text-purple-300 transition-all duration-500"
      viewBox="0 0 180 110"
      fill="none"
    >
      <path d="M40,110 L70,80 L110,80 L130,60 L180,60" stroke="currentColor" strokeWidth="0.8" />
      <path d="M80,110 L100,90 L140,90 L160,70 L180,70" stroke="currentColor" strokeWidth="0.8" />
      <path d="M20,110 L50,80 L50,50 L80,20 L130,20" stroke="currentColor" strokeWidth="0.8" strokeDasharray="3 3" />
      <circle cx="110" cy="80" r="2.5" fill="currentColor" />
      <circle cx="130" cy="20" r="2.5" fill="currentColor" />
      <circle cx="140" cy="90" r="2.5" fill="currentColor" />
    </svg>
  );
}

export function StudentPortal({
  onLaunchPresetExam,
  onLaunchCustomExam,
  onBackToGateway,
  defaultStudentId = "",
}: StudentPortalProps) {
  const [viewMode, setViewMode] = useState<"choice" | "preset_list" | "custom">("choice");
  const [studentId, setStudentId] = useState<string>(defaultStudentId);
  const [presets, setPresets] = useState<ExamPreset[]>([]);
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);

  // Gentle tactile ripple / click flash state
  const [clickedCard, setClickedCard] = useState<"preset" | "custom" | null>(null);

  const handleCardClick = (card: "preset" | "custom", callback: () => void) => {
    setClickedCard(card);
    setTimeout(() => {
      callback();
    }, 120);
  };

  // Search & Filters
  const [searchQuery, setSearchQuery] = useState<string>("");
  const [selectedInstructor, setSelectedInstructor] = useState<string>("all");
  const [selectedCourse, setSelectedCourse] = useState<string>("all");
  const [selectedPresetId, setSelectedPresetId] = useState<string | null>(null);
  const [justSelectedId, setJustSelectedId] = useState<string | null>(null);
  const [sortBy, setSortBy] = useState<"recent" | "topics" | "title">("recent");
  const [accessError, setAccessError] = useState<string | null>(null);
  const searchInputRef = React.useRef<HTMLInputElement | null>(null);

  // Keyboard shortcut '/' to focus search input
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "/" && document.activeElement !== searchInputRef.current && viewMode === "preset_list") {
        e.preventDefault();
        searchInputRef.current?.focus();
      }
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [viewMode]);

  const handleSelectCard = (id: string) => {
    setSelectedPresetId(id);
    setJustSelectedId(id);
    if (accessError) setAccessError(null);
  };

  // Candidate Authentication & Biometrics Ground Truth
  const [studentAccount, setStudentAccount] = useState<StudentAuthData | null>(null);
  const [studentToken, setStudentToken] = useState<string>("");
  const [biometricsEnrolled, setBiometricsEnrolled] = useState<boolean>(false);
  const [showAuthModal, setShowAuthModal] = useState<boolean>(false);
  const [showBiometricsModal, setShowBiometricsModal] = useState<boolean>(false);
  const [showGateModal, setShowGateModal] = useState<boolean>(false);
  const [pendingGateSessionId, setPendingGateSessionId] = useState<string>("");

  // Check active student session on mount
  const checkStudentSession = async () => {
    try {
      const res = await fetch("/api/auth/student-me");
      if (res.ok) {
        const data = await res.json();
        if (data.authenticated && data.student) {
          setStudentAccount(data.student);
          setStudentId(data.student.regNo);
          setStudentToken(data.token || "");
          setBiometricsEnrolled(!!data.biometricsEnrolled);
        } else {
          setStudentAccount(null);
          setBiometricsEnrolled(false);
        }
      }
    } catch (err) {
      console.error("Failed to verify student session:", err);
    }
  };

  useEffect(() => {
    checkStudentSession();
  }, []);

  const handleStudentLogout = async () => {
    try {
      await fetch("/api/auth/student-logout", { method: "POST" });
    } catch (logoutErr) {
      console.debug("[StudentPortal] Non-fatal logout fetch error:", logoutErr);
    }
    setStudentAccount(null);
    setStudentToken("");
    setBiometricsEnrolled(false);
  };

  // Sync viewMode with browser history (popstate)
  useEffect(() => {
    const parseUrl = () => {
      if (typeof window === "undefined") return;
      const params = new URLSearchParams(window.location.search);
      const subMode = params.get("mode");
      if (subMode === "preset") {
        setViewMode("preset_list");
      } else if (subMode === "custom") {
        setViewMode("custom");
      } else {
        setViewMode("choice");
      }
    };

    parseUrl();
    window.addEventListener("popstate", parseUrl);
    return () => window.removeEventListener("popstate", parseUrl);
  }, []);

  const navigateToSubMode = (mode: "choice" | "preset_list" | "custom") => {
    setViewMode(mode);
    setAccessError(null);
    if (typeof window !== "undefined") {
      const url = new URL(window.location.href);
      url.searchParams.set("view", "student");
      if (mode === "preset_list") {
        url.searchParams.set("mode", "preset");
        url.searchParams.delete("step");
      } else if (mode === "custom") {
        url.searchParams.set("mode", "custom");
        url.searchParams.set("step", "1");
      } else {
        url.searchParams.delete("mode");
        url.searchParams.delete("step");
      }
      window.history.pushState({ viewMode: mode }, "", url.toString());
    }
  };

  const handleStepBack = () => {
    setAccessError(null);
    if (typeof window !== "undefined" && window.history.length > 1) {
      window.history.back();
    } else {
      if (viewMode === "preset_list") {
        navigateToSubMode("choice");
      } else {
        onBackToGateway();
      }
    }
  };

  // Fetch presets from server database
  const fetchPresets = async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/presets");
      const data = await res.json();
      if (!res.ok) throw new Error(data.error || "Failed to load exams");
      const list: ExamPreset[] = data.exams || [];
      setPresets(list);
      if (list.length > 0 && !selectedPresetId) {
        setSelectedPresetId(list[0].id);
      }
    } catch (err: any) {
      console.error(err);
      setError(err.message || "Failed to fetch presets");
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (viewMode === "preset_list") {
      fetchPresets();
    }
  }, [viewMode]);

  // Unique instructors and courses for dropdown filter options
  const uniqueInstructors = useMemo(() => {
    const set = new Set<string>();
    presets.forEach((p) => {
      if (p.instructorId) set.add(p.instructorId.trim());
    });
    return Array.from(set).sort();
  }, [presets]);

  const uniqueCourses = useMemo(() => {
    const set = new Set<string>();
    presets.forEach((p) => {
      if (p.courseTitle) set.add(p.courseTitle.trim());
    });
    return Array.from(set).sort();
  }, [presets]);

  // Natural language query filter matching course title, instructor, or syllabus topics
  const filteredPresets = useMemo(() => {
    const query = searchQuery.trim().toLowerCase();

    return presets.filter((p) => {
      if (selectedInstructor !== "all" && p.instructorId !== selectedInstructor) {
        return false;
      }
      if (selectedCourse !== "all" && p.courseTitle !== selectedCourse) {
        return false;
      }
      if (!query) return true;

      const titleMatch = p.courseTitle?.toLowerCase().includes(query);
      const instructorMatch = p.instructorId?.toLowerCase().includes(query);
      const directiveMatch = p.globalDirective?.toLowerCase().includes(query);
      const topicMatch = p.topics?.some((t) =>
        t.title?.toLowerCase().includes(query) ||
        t.comment?.toLowerCase().includes(query)
      );

      return titleMatch || instructorMatch || directiveMatch || topicMatch;
    });
  }, [presets, searchQuery, selectedInstructor, selectedCourse]);

  const sortedAndFilteredPresets = useMemo(() => {
    const list = [...filteredPresets];
    if (sortBy === "recent") {
      list.sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
    } else if (sortBy === "topics") {
      list.sort((a, b) => (b.totalTopics || 0) - (a.totalTopics || 0));
    } else if (sortBy === "title") {
      list.sort((a, b) => (a.courseTitle || "").localeCompare(b.courseTitle || ""));
    }
    return list;
  }, [filteredPresets, sortBy]);

  const selectedPreset = useMemo(() => {
    return presets.find((p) => p.id === selectedPresetId) || null;
  }, [presets, selectedPresetId]);

  const handleLaunch = () => {
    if (!selectedPreset) return;
    const finalStudentId = (studentAccount?.regNo || studentId).trim();
    if (!finalStudentId) {
      setAccessError("Please enter your Registration Number / Candidate ID to begin the examination.");
      return;
    }

    // Require authentication
    if (!studentAccount) {
      setShowAuthModal(true);
      return;
    }

    // Require biometric enrollment ground truth
    if (!biometricsEnrolled) {
      setShowBiometricsModal(true);
      return;
    }

    // Access control verification
    if (selectedPreset.accessControl?.type === "RESTRICTED") {
      const allowed = selectedPreset.accessControl.allowedStudents || [];
      const query = finalStudentId.toLowerCase();
      const isAuthorized = allowed.some(
        (s) =>
          s.regNo.toLowerCase() === query ||
          s.name.toLowerCase() === query
      );

      if (!isAuthorized) {
        setAccessError(
          `Access restricted: Registration number "${finalStudentId}" was not found on the course authorization roster. Please check your Registration Number or contact your TA (${selectedPreset.instructorId}).`
        );
        return;
      }
    }

    setAccessError(null);
    const pendingSid = `sess_${finalStudentId.toLowerCase().replace(/[^a-z0-9_-]/g, "")}_${Date.now()}`;
    setPendingGateSessionId(pendingSid);
    setShowGateModal(true);
  };

  // Candidate Status Header Bar
  const renderCandidateAuthBar = () => (
    <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 rounded-2xl bg-zinc-950/80 border border-zinc-800/80 shadow-sm text-xs">
      <div className="flex items-center gap-3">
        {studentAccount ? (
          <div className="flex items-center gap-2.5">
            <span className="w-2 h-2 rounded-full bg-emerald-500" />
            <span className="font-medium text-white">{studentAccount.studentName}</span>
            <span className="font-mono text-[11px] px-2 py-0.5 rounded bg-zinc-900 border border-zinc-800 text-zinc-400">
              {studentAccount.regNo.toUpperCase()}
            </span>
            <span className="text-zinc-600 font-mono hidden sm:inline">•</span>
            <span className="text-zinc-400 text-[11px] hidden sm:inline">{studentAccount.department}</span>
          </div>
        ) : (
          <div className="flex items-center gap-2 text-zinc-400">
            <span className="w-2 h-2 rounded-full bg-zinc-600" />
            <span>Candidate Not Signed In</span>
            <span className="text-zinc-600 text-[11px] hidden sm:inline">(Sign in or register below)</span>
          </div>
        )}
      </div>

      <div className="flex items-center gap-2.5">
        {studentAccount ? (
          <>
            {biometricsEnrolled ? (
              <button
                type="button"
                onClick={() => setShowBiometricsModal(true)}
                className="px-2.5 py-1 rounded-full bg-emerald-950/60 border border-emerald-800/80 text-emerald-400 text-[10px] font-mono flex items-center gap-1.5 hover:bg-emerald-900/40 transition cursor-pointer"
                title="Ground truth sealed. Click to view or re-enroll reference biometrics."
              >
                <span>✓</span>
                <span>Ground Truth Sealed</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => setShowBiometricsModal(true)}
                className="px-3 py-1 rounded-full bg-amber-950/70 border border-amber-800 text-amber-300 text-[10px] font-mono font-medium flex items-center gap-1.5 hover:bg-amber-900/50 transition cursor-pointer animate-pulse"
                title="Biometric enrollment mandatory for examination"
              >
                <span>⚠️</span>
                <span>Enroll Biometrics</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleStudentLogout}
              className="text-[11px] font-mono text-zinc-500 hover:text-zinc-300 transition cursor-pointer px-2 py-1"
            >
              Sign Out
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setShowAuthModal(true)}
            className="px-3 py-1.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-medium text-xs font-mono transition shadow cursor-pointer flex items-center gap-1.5"
          >
            <span>🔑</span>
            <span>Candidate Sign In</span>
          </button>
        )}
      </div>
    </div>
  );

  return (
    <>
      {/* ========================================================================= */}
      {/* VIEW 1: DUAL SCULPTURAL CHOICE CARDS (HOMEPAGE PARITY)                    */}
      {/* ========================================================================= */}
      {viewMode === "choice" && (
        <div className="flex flex-col justify-between py-2 sm:py-4 px-2 sm:px-4 font-sans text-white select-none">
          {/* Editorial Headline Section & Candidate Auth */}
          <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-4 pt-2 sm:pt-6 max-w-4xl w-full">
            <div className="space-y-2">
              <h1 className="text-5xl sm:text-6xl md:text-7xl font-semibold tracking-tight text-white leading-[1.06]">
                Oral examinations.
              </h1>
              <p className="text-2xl sm:text-3xl md:text-4xl font-normal tracking-tight text-zinc-400">
                Select preset or custom defense.
              </p>
            </div>

            {/* Candidate Auth Status Pill */}
            <div className="pt-2 sm:pt-4 shrink-0">
              {studentAccount ? (
                <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-zinc-900/90 border border-zinc-800 text-xs font-mono">
                  <span className="w-2 h-2 rounded-full bg-emerald-500 shrink-0" />
                  <span className="font-medium text-zinc-200 truncate max-w-[130px]" title={studentAccount.studentName}>
                    {studentAccount.studentName}
                  </span>
                  <span className="text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-950 border border-zinc-800 text-zinc-400">
                    {studentAccount.regNo.toUpperCase()}
                  </span>
                  {biometricsEnrolled ? (
                    <button
                      type="button"
                      onClick={() => setShowBiometricsModal(true)}
                      className="text-emerald-400 text-[10px] hover:underline cursor-pointer ml-0.5"
                      title="Ground Truth Sealed"
                    >
                      ✓ Sealed
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setShowBiometricsModal(true)}
                      className="text-amber-400 text-[10px] hover:underline cursor-pointer animate-pulse ml-0.5"
                      title="Biometrics Required"
                    >
                      ⚠️ Enroll
                    </button>
                  )}
                  <button
                    type="button"
                    onClick={handleStudentLogout}
                    className="text-[10px] text-zinc-500 hover:text-red-400 cursor-pointer transition ml-1"
                    title="Sign Out"
                  >
                    Sign Out
                  </button>
                </div>
              ) : (
                <button
                  type="button"
                  onClick={() => setShowAuthModal(true)}
                  className="px-3.5 py-1.5 rounded-full bg-zinc-900/90 hover:bg-zinc-800/90 border border-zinc-800 hover:border-zinc-700 text-zinc-300 hover:text-white text-xs font-mono transition flex items-center gap-2 cursor-pointer shadow-sm active:scale-95"
                >
                  <span className="w-2 h-2 rounded-full bg-zinc-600" />
                  <span>Candidate Sign In</span>
                </button>
              )}
            </div>
          </div>

          {/* Choice Cards: Clean Dual-Card Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-6 my-auto py-6 sm:py-8 max-w-4xl w-full">
            {/* =================================================================== */}
            {/* CARD 1: JOIN PRESET VIVA                                            */}
            {/* =================================================================== */}
            <button
              type="button"
              onClick={() => handleCardClick("preset", () => navigateToSubMode("preset_list"))}
              className={`group relative text-left p-7 sm:p-8 rounded-2xl border transition-all duration-300 flex flex-col justify-between min-h-[260px] cursor-pointer overflow-hidden touch-manipulation w-full active:scale-[0.985] ${
                clickedCard === "preset"
                  ? "bg-zinc-800/80 border-sky-400 shadow-[0_0_30px_rgba(56,189,248,0.2)]"
                  : "bg-zinc-950/60 border-zinc-800/80 hover:bg-zinc-900/60 hover:border-zinc-500/80 hover:shadow-[0_0_30px_rgba(255,255,255,0.04)]"
              }`}
            >
              {/* Subtle Ambient Hover Sheen */}
              <div className="pointer-events-none absolute -top-24 -right-24 w-64 h-64 bg-sky-500/5 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

              {/* Top & Middle Content with Watermark Icon */}
              <div className="relative z-10 flex items-start justify-between gap-4">
                <div className="space-y-2 pr-4">
                  <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-500 font-medium block">
                    OPTION 1 / SCHEDULED COURSE
                  </span>
                  <h2 className="text-2xl sm:text-3xl font-medium text-white tracking-tight group-hover:text-zinc-50 transition-colors">
                    Join Preset Viva
                  </h2>
                  <p className="text-sm text-zinc-400/90 font-normal leading-relaxed pt-1 max-w-[280px] sm:max-w-[310px]">
                    Sit for a scheduled exam configured by your course instructor.
                  </p>
                </div>

                {/* Subtle Role Watermark: Book / Syllabus Icon */}
                <div className="shrink-0 text-zinc-700/60 group-hover:text-zinc-500/80 transition-colors duration-300 pt-1">
                  <svg
                    className="w-14 h-14 sm:w-16 sm:h-16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <path d="M4 19.5v-15A2.5 2.5 0 0 1 6.5 2H20v20H6.5a2.5 2.5 0 0 1-2.5-2.5Z" />
                    <path d="M6 6h10" />
                    <path d="M6 10h10" />
                    <path d="M6 14h6" />
                  </svg>
                </div>
              </div>

              {/* Bottom Action CTA */}
              <div className="relative z-10 pt-6 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 group-hover:text-white transition-colors duration-200">
                  <span>View scheduled vivas</span>
                  <span className="text-sm transition-transform duration-200 group-hover:translate-x-1.5">
                    →
                  </span>
                </div>
              </div>
            </button>

            {/* =================================================================== */}
            {/* CARD 2: CUSTOM VIVA                                                 */}
            {/* =================================================================== */}
            <button
              type="button"
              onClick={() => handleCardClick("custom", () => navigateToSubMode("custom"))}
              className={`group relative text-left p-7 sm:p-8 rounded-2xl border transition-all duration-300 flex flex-col justify-between min-h-[260px] cursor-pointer overflow-hidden touch-manipulation w-full active:scale-[0.985] ${
                clickedCard === "custom"
                  ? "bg-zinc-800/80 border-sky-400 shadow-[0_0_30px_rgba(56,189,248,0.2)]"
                  : "bg-zinc-950/60 border-zinc-800/80 hover:bg-zinc-900/60 hover:border-zinc-500/80 hover:shadow-[0_0_30px_rgba(56,189,248,0.06)]"
              }`}
            >
              {/* Subtle Ambient Hover Sheen */}
              <div className="pointer-events-none absolute -top-24 -right-24 w-64 h-64 bg-indigo-500/5 rounded-full blur-3xl opacity-0 group-hover:opacity-100 transition-opacity duration-500" />

              {/* Top & Middle Content with Watermark Icon */}
              <div className="relative z-10 flex items-start justify-between gap-4">
                <div className="space-y-2 pr-4">
                  <span className="text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-500 font-medium block">
                    OPTION 2 / AD-HOC PRACTICE
                  </span>
                  <h2 className="text-2xl sm:text-3xl font-medium text-white tracking-tight group-hover:text-zinc-50 transition-colors">
                    Custom Viva
                  </h2>
                  <p className="text-sm text-zinc-400/90 font-normal leading-relaxed pt-1 max-w-[280px] sm:max-w-[310px]">
                    Configure your own topics and practice oral defense on demand.
                  </p>
                </div>

                {/* Subtle Role Watermark: Sliders / Settings Icon */}
                <div className="shrink-0 text-zinc-700/60 group-hover:text-zinc-500/80 transition-colors duration-300 pt-2">
                  <svg
                    className="w-14 h-14 sm:w-16 sm:h-16"
                    viewBox="0 0 24 24"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="1.25"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    aria-hidden="true"
                  >
                    <line x1="4" y1="21" x2="4" y2="14" />
                    <line x1="4" y1="10" x2="4" y2="3" />
                    <line x1="12" y1="21" x2="12" y2="12" />
                    <line x1="12" y1="8" x2="12" y2="3" />
                    <line x1="20" y1="21" x2="20" y2="16" />
                    <line x1="20" y1="12" x2="20" y2="3" />
                    <line x1="1" y1="14" x2="7" y2="14" />
                    <line x1="9" y1="8" x2="15" y2="8" />
                    <line x1="17" y1="16" x2="23" y2="16" />
                  </svg>
                </div>
              </div>

              {/* Bottom Action CTA with Circular Button Accent */}
              <div className="relative z-10 pt-6 flex items-center justify-between">
                <div className="flex items-center gap-2 text-xs font-medium text-zinc-400 group-hover:text-white transition-colors duration-200">
                  <span>Start custom session</span>
                  <span className="text-sm transition-transform duration-200 group-hover:translate-x-1.5">
                    →
                  </span>
                </div>

                {/* Circular Action Badge */}
                <div className="w-8 h-8 rounded-full bg-zinc-900/80 border border-zinc-800 flex items-center justify-center text-zinc-500 group-hover:text-white group-hover:border-zinc-600 group-hover:bg-zinc-800 transition-all duration-200">
                  <span className="text-xs transition-transform duration-200 group-hover:translate-x-0.5">
                    →
                  </span>
                </div>
              </div>
            </button>
          </div>

          {/* More Intentional Footer: Clear Status Indicator & System Info */}
          <div className="flex flex-col sm:flex-row items-center justify-between text-xs font-mono pt-8 pb-2 gap-3 max-w-4xl w-full">
            <div className="flex items-center gap-2.5">
              <span className="relative flex h-2 w-2">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-60" />
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500" />
              </span>
              <span className="text-zinc-400 font-normal">
                Autonomous Socratic Oral Defense
              </span>
            </div>

            <div className="flex items-center gap-4 text-zinc-500">
              <button
                type="button"
                onClick={onBackToGateway}
                className="hover:text-zinc-300 transition cursor-pointer"
              >
                ← Back to role selection
              </button>
              <span>•</span>
              <span>Local Node: 10.10.16.13 (Air-Gapped)</span>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* VIEW 3: STUDENT CUSTOM VIVA BUILDER                                       */}
      {/* ========================================================================= */}
      {viewMode === "custom" && (
        <StudentCustomViva
          defaultStudentId={studentAccount?.regNo || studentId}
          onBackToModes={() => navigateToSubMode("choice")}
          onLaunchExamRoom={(toc, prompt, duration, customStudentId) => {
            onLaunchCustomExam(toc, prompt, duration, customStudentId || studentAccount?.regNo || studentId);
          }}
        />
      )}

      {/* ========================================================================= */}
      {/* VIEW 2: PRESET VIVA EXPLORER (ARCHITECTURAL HERO & SUBTLE INTERACTIONS)    */}
      {/* ========================================================================= */}
      {viewMode === "preset_list" && (
        <div className="min-h-[85vh] flex flex-col justify-between py-2 sm:py-4 px-2 sm:px-4 font-sans text-white max-w-6xl mx-auto space-y-6">
          <div className="space-y-6">
            {/* Hero Section with Architectural Lighting Shift */}
            <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center">
              {/* Left Column: Heading & Context */}
              <div className="lg:col-span-7 space-y-2">
                <div className="flex items-center gap-2 text-[11px] font-mono uppercase tracking-[0.2em] text-zinc-400">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                  <span>CANDIDATE PORTAL</span>
                  <span className="text-zinc-700">•</span>
                  <span>ONLINE</span>
                </div>

                <h1 className="text-4xl sm:text-5xl md:text-6xl font-bold tracking-tight text-white leading-[1.08]">
                  Select your<br />course viva.
                </h1>

                <p className="text-sm sm:text-base text-zinc-400 max-w-xl font-normal leading-relaxed pt-2">
                  Choose from exams published on the server database or search in natural language.
                </p>
              </div>

              {/* Right Column: Architectural Hero Silhouette with Shifting Lighting */}
              <div className="lg:col-span-5">
                <ArchitecturalHeroGraphic />
              </div>
            </div>

            {/* Candidate ID & Search Bar Controls (Dual-Column Glass Toolbar) */}
            <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/60 p-5 space-y-4 backdrop-blur-xs">
              <div className="grid grid-cols-1 lg:grid-cols-2 gap-6 items-start">
                {/* Column 1: Candidate ID / Reg No */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block">
                      CANDIDATE ID / REG NO
                    </label>
                    {studentAccount && (
                      <span className="text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                        <span>●</span>
                        <span>{studentAccount.studentName}</span>
                      </span>
                    )}
                  </div>

                  <div className="relative flex items-center gap-2">
                    <div className="relative flex-1">
                      <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">
                        👤
                      </span>
                      <input
                        type="text"
                        placeholder="Enter registration number..."
                        value={studentAccount ? studentAccount.regNo.toUpperCase() : studentId}
                        disabled={!!studentAccount}
                        onChange={(e) => {
                          setStudentId(e.target.value);
                          if (accessError) setAccessError(null);
                        }}
                        className={`w-full bg-zinc-900/80 border rounded-xl pl-9 pr-3.5 py-2.5 text-xs text-white placeholder-zinc-600 font-mono focus:outline-none transition ${
                          accessError
                            ? "border-red-500/80 focus:border-red-400"
                            : "border-zinc-800 focus:border-purple-500/80"
                        } ${studentAccount ? "opacity-90 cursor-default" : ""}`}
                      />
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        if (studentAccount) {
                          handleStudentLogout();
                        } else {
                          setShowAuthModal(true);
                        }
                      }}
                      className="px-4 py-2.5 rounded-xl bg-purple-900/60 hover:bg-purple-800/80 border border-purple-500/50 text-purple-200 hover:text-white text-xs font-mono font-medium transition cursor-pointer shadow-sm shrink-0"
                    >
                      {studentAccount ? "Sign Out" : "Verify"}
                    </button>
                  </div>

                  {/* Filter Dropdowns row */}
                  <div className="grid grid-cols-2 gap-3 pt-1">
                    <select
                      value={selectedInstructor}
                      onChange={(e) => setSelectedInstructor(e.target.value)}
                      className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-purple-500/80 cursor-pointer appearance-none transition font-mono"
                    >
                      <option value="all" className="bg-zinc-950 text-zinc-300">
                        All Instructors ({uniqueInstructors.length}) ⌵
                      </option>
                      {uniqueInstructors.map((inst) => (
                        <option key={inst} value={inst} className="bg-zinc-950 text-zinc-300">
                          {inst}
                        </option>
                      ))}
                    </select>

                    <select
                      value={selectedCourse}
                      onChange={(e) => setSelectedCourse(e.target.value)}
                      className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-purple-500/80 cursor-pointer appearance-none transition font-mono"
                    >
                      <option value="all" className="bg-zinc-950 text-zinc-300">
                        All Courses ({uniqueCourses.length}) ⌵
                      </option>
                      {uniqueCourses.map((c) => (
                        <option key={c} value={c} className="bg-zinc-950 text-zinc-300">
                          {c}
                        </option>
                      ))}
                    </select>
                  </div>
                </div>

                {/* Column 2: Search Courses */}
                <div className="space-y-3">
                  <div className="flex items-center justify-between">
                    <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block">
                      SEARCH COURSES
                    </label>
                    <span className="text-[10px] font-mono text-zinc-600">
                      {sortedAndFilteredPresets.length} of {presets.length} vivas
                    </span>
                  </div>

                  <div className="relative">
                    <span className="absolute left-3.5 top-1/2 -translate-y-1/2 text-zinc-500 text-xs">
                      🔍
                    </span>
                    <input
                      ref={searchInputRef}
                      type="text"
                      placeholder="Search by course title, instructor, or topic keywords..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl pl-9 pr-8 py-2.5 text-xs text-white placeholder-zinc-600 focus:outline-none focus:border-purple-500/80 transition"
                    />
                    <span className="absolute right-3 top-1/2 -translate-y-1/2 text-[10px] font-mono px-1.5 py-0.5 rounded bg-zinc-800 text-zinc-400 border border-zinc-700 pointer-events-none">
                      /
                    </span>
                  </div>

                  {/* Sort Dropdown row */}
                  <div className="flex justify-end pt-1">
                    <select
                      value={sortBy}
                      onChange={(e) => setSortBy(e.target.value as any)}
                      className="bg-zinc-900/80 border border-zinc-800 rounded-xl px-3 py-2 text-xs text-zinc-300 focus:outline-none focus:border-purple-500/80 cursor-pointer appearance-none transition font-mono min-w-[180px]"
                    >
                      <option value="recent" className="bg-zinc-950 text-zinc-300">
                        Sort by: Most Recent ⌵
                      </option>
                      <option value="topics" className="bg-zinc-950 text-zinc-300">
                        Sort by: Most Topics ⌵
                      </option>
                      <option value="title" className="bg-zinc-950 text-zinc-300">
                        Sort by: Title (A-Z) ⌵
                      </option>
                    </select>
                  </div>
                </div>
              </div>

              {/* Access Error Alert */}
              {accessError && (
                <div className="p-3.5 rounded-xl border border-red-500/50 bg-red-950/40 text-xs text-red-200 font-mono flex items-start gap-2.5 shadow-sm">
                  <span className="text-red-400 font-bold shrink-0 mt-0.5">✕</span>
                  <div className="flex-1">
                    <span className="font-semibold text-red-300 block mb-0.5">Authorization Failed</span>
                    <span className="leading-relaxed text-red-200/90">{accessError}</span>
                  </div>
                </div>
              )}
            </div>

            {/* Presets Cards Grid */}
            {loading && (
              <div className="p-16 text-center text-xs text-zinc-500 font-mono">
                Querying database presets...
              </div>
            )}

            {error && (
              <div className="p-4 rounded-xl border border-red-500/50 bg-red-950/30 text-xs text-red-300 font-mono">
                {error}
              </div>
            )}

            {!loading && !error && sortedAndFilteredPresets.length === 0 && (
              <div className="p-16 rounded-2xl border border-zinc-800/80 bg-zinc-950/40 text-center space-y-2">
                <span className="text-zinc-500 font-mono text-xs block">No examinations match query</span>
                <p className="text-xs text-zinc-600">
                  Try clearing your search query or instructor filters.
                </p>
              </div>
            )}

            {!loading && !error && sortedAndFilteredPresets.length > 0 && (
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4 sm:gap-5">
                {sortedAndFilteredPresets.map((preset, idx) => {
                  const isSelected = selectedPresetId === preset.id;
                  const rigorLabel = RIGOR_LABELS[preset.difficultyTier] || preset.difficultyTier || "Standard";

                  return (
                    <div
                      key={preset.id}
                      onClick={() => handleSelectCard(preset.id)}
                      onDoubleClick={() => {
                        handleSelectCard(preset.id);
                        handleLaunch();
                      }}
                      className={`group relative text-left p-6 sm:p-7 rounded-2xl border transition-all duration-300 flex flex-col justify-between min-h-[190px] cursor-pointer overflow-hidden touch-manipulation select-none ${
                        isSelected
                          ? "bg-gradient-to-b from-purple-950/30 via-zinc-950/90 to-zinc-950 border-purple-500/80 shadow-[0_0_24px_rgba(168,85,247,0.22)]"
                          : "bg-zinc-950/60 border-zinc-800/80 hover:bg-zinc-900/40 hover:border-zinc-700/80"
                      }`}
                    >
                      {/* Traveling Violet Edge Animation on Card Selection */}
                      {isSelected && (
                        <svg
                          key={`edge_${preset.id}_${justSelectedId === preset.id ? "anim" : "static"}`}
                          className="absolute inset-0 w-full h-full pointer-events-none rounded-2xl z-20"
                        >
                          <rect
                            x="1"
                            y="1"
                            width="calc(100% - 2px)"
                            height="calc(100% - 2px)"
                            rx="16"
                            fill="none"
                            stroke="#a855f7"
                            strokeWidth="1.75"
                            pathLength="100"
                            className={justSelectedId === preset.id ? "animate-violet-edge-travel" : ""}
                            style={{
                              filter: "drop-shadow(0 0 8px rgba(168, 85, 247, 0.6))",
                            }}
                          />
                        </svg>
                      )}

                      {/* Subtle Geometric Background Pattern */}
                      <GeometricCardPattern index={idx} />

                      {/* Top Row: Instructor tag & Access Badges */}
                      <div className="relative z-10 flex items-center justify-between gap-2 mb-3">
                        <div className="flex items-center gap-2 truncate">
                          {isSelected && (
                            <span className="w-4 h-4 rounded-full bg-violet-600 text-white flex items-center justify-center text-[10px] font-bold shadow-[0_0_8px_rgba(147,51,234,0.6)] shrink-0">
                              ✓
                            </span>
                          )}
                          <span className="text-[11px] font-mono uppercase tracking-wider text-zinc-400 font-medium truncate">
                            INST {preset.instructorId ? preset.instructorId.toUpperCase() : "PROF"}
                          </span>
                        </div>

                        <div className="flex items-center gap-1.5 shrink-0">
                          {preset.accessControl?.type === "RESTRICTED" ? (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-amber-800/80 bg-amber-950/40 text-amber-400 flex items-center gap-1">
                              <span>🔒</span>
                              <span>Restricted</span>
                            </span>
                          ) : (
                            <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-zinc-800 bg-zinc-900/80 text-zinc-400 flex items-center gap-1">
                              <span>🔒</span>
                              <span>Open Access</span>
                            </span>
                          )}
                          <span className="text-[10px] font-mono px-2 py-0.5 rounded-full border border-zinc-800 bg-zinc-900/80 text-zinc-400 flex items-center gap-1">
                            <span>⏱</span>
                            <span>{preset.durationMinutes || 10} min</span>
                          </span>
                        </div>
                      </div>

                      {/* Middle Row: Title & Metadata */}
                      <div className="relative z-10 space-y-1.5">
                        <h3 className="text-xl sm:text-2xl font-bold text-white tracking-tight leading-snug group-hover:text-zinc-50 transition-colors">
                          {preset.courseTitle}
                        </h3>

                        <div className="flex flex-wrap items-center gap-2 text-xs text-zinc-400 font-mono">
                          <span className="text-zinc-400">{rigorLabel}</span>
                          <span className="text-zinc-600">•</span>
                          <span className="text-zinc-400">
                            {preset.totalTopics || (preset.topics ? preset.topics.length : 0)} topics
                          </span>
                        </div>
                      </div>

                      {/* Bottom Row: Date & Action CTA */}
                      <div className="relative z-10 flex items-center justify-between pt-4 mt-2 border-t border-zinc-900/80 text-xs">
                        <div className="flex items-center gap-1.5 text-[11px] font-mono text-zinc-500">
                          <span>🗓</span>
                          <span>{new Date(preset.createdAt).toLocaleDateString()}</span>
                        </div>

                        <div
                          onClick={(e) => {
                            if (isSelected) {
                              e.stopPropagation();
                              handleLaunch();
                            }
                          }}
                          className="flex items-center gap-1.5 font-medium text-xs cursor-pointer"
                        >
                          <span className={isSelected ? "text-purple-300 font-medium" : "text-zinc-400 group-hover:text-white transition-colors"}>
                            {isSelected ? "Selected" : "Select"}
                          </span>
                          <span
                            className={`transition-transform duration-300 ease-out text-sm ${
                              isSelected
                                ? "text-purple-300 translate-x-1"
                                : "text-zinc-500 group-hover:translate-x-1.5 group-hover:text-white"
                            }`}
                          >
                            →
                          </span>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          {/* Action & Launch Bar */}
          <div className="flex items-center justify-between pt-6 border-t border-zinc-900/80">
            <button
              type="button"
              onClick={handleStepBack}
              className="text-xs text-zinc-500 hover:text-white transition flex items-center gap-1.5 cursor-pointer font-mono"
            >
              <span>←</span>
              <span>Modes</span>
            </button>

            <button
              type="button"
              onClick={handleLaunch}
              disabled={!selectedPreset || !(studentAccount?.regNo || studentId).trim()}
              className="group flex items-center gap-2 px-6 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white text-xs font-mono font-medium transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-[0_0_20px_rgba(147,51,234,0.3)]"
            >
              <span>Enter defense chamber</span>
              <span className="text-sm group-hover:translate-x-1 transition-transform duration-200">
                →
              </span>
            </button>
          </div>

          {/* Bottom Divider with Diamond & System Info */}
          <div className="pt-6 border-t border-zinc-900/80 flex items-center justify-between text-xs font-mono text-zinc-500">
            <div className="flex items-center gap-2">
              <span className="text-purple-400">✦</span>
              <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
              <span className="text-zinc-400">OpenViva</span>
              <span className="text-zinc-700">•</span>
              <span>v3.0.0</span>
            </div>

            <div>
              <span>[Local] Node: 10.10.16.13 (Air-Gapped)</span>
            </div>
          </div>
        </div>
      )}

      {/* ========================================================================= */}
      {/* STUDENT AUTHENTICATION MODAL                                              */}
      {/* ========================================================================= */}
      <StudentAuthModal
        isOpen={showAuthModal}
        onClose={() => setShowAuthModal(false)}
        initialRegNo={studentId}
        onAuthSuccess={async ({ student, token, biometricsEnrolled: bioEnrolled }) => {
          setStudentAccount(student);
          setStudentId(student.regNo);
          setStudentToken(token);

          let isEnrolled = !!bioEnrolled;
          if (!isEnrolled) {
            try {
              const meRes = await fetch("/api/auth/student-me");
              if (meRes.ok) {
                const meData = await meRes.json();
                if (meData.biometricsEnrolled) {
                  isEnrolled = true;
                }
              }
            } catch (err) {
              console.debug("Failed to re-verify student-me biometrics:", err);
            }
          }

          setBiometricsEnrolled(isEnrolled);
          setShowAuthModal(false);
          // Streamlined progression:
          if (!isEnrolled) {
            setShowBiometricsModal(true);
          } else if (selectedPreset) {
            const finalStudentId = student.regNo.trim();
            const pendingSid = `sess_${finalStudentId.toLowerCase().replace(/[^a-z0-9_-]/g, "")}_${Date.now()}`;
            setPendingGateSessionId(pendingSid);
            setShowGateModal(true);
          }
        }}
      />

      {/* ========================================================================= */}
      {/* BIOMETRIC GROUND TRUTH ENROLLMENT MODAL                                   */}
      {/* ========================================================================= */}
      <BiometricEnrollmentModal
        isOpen={showBiometricsModal}
        regNo={studentAccount?.regNo || studentId}
        studentName={studentAccount?.studentName || "Candidate"}
        authToken={studentToken}
        onEnrollmentComplete={() => {
          setBiometricsEnrolled(true);
          setShowBiometricsModal(false);
          if (selectedPreset) {
            const finalStudentId = (studentAccount?.regNo || studentId).trim();
            const pendingSid = `sess_${finalStudentId.toLowerCase().replace(/[^a-z0-9_-]/g, "")}_${Date.now()}`;
            setPendingGateSessionId(pendingSid);
            setShowGateModal(true);
          }
        }}
        onCancel={() => setShowBiometricsModal(false)}
      />

      {/* ========================================================================= */}
      {/* PRE-VIVA BIOMETRIC IDENTITY GATE MODAL                                    */}
      {/* ========================================================================= */}
      <BiometricGateModal
        isOpen={showGateModal}
        regNo={studentAccount?.regNo || studentId}
        studentName={studentAccount?.studentName || "Candidate"}
        authToken={studentToken}
        sessionId={pendingGateSessionId}
        onVerified={() => {
          setShowGateModal(false);
          const finalStudentId = (studentAccount?.regNo || studentId).trim();
          if (selectedPreset) {
            onLaunchPresetExam(selectedPreset, finalStudentId);
          }
        }}
        onCancel={() => setShowGateModal(false)}
      />
    </>
  );
}
