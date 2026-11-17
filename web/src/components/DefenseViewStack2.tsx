"use client";

import React, { useState, useEffect, useRef } from "react";
import {
  LiveKitRoom,
  RoomAudioRenderer,
  StartAudio,
  useAudioPlayback,
  useConnectionState,
  useLocalParticipant,
  useRemoteParticipants,
  useRoomContext,
  TrackToggle,
} from "@livekit/components-react";
import { ConnectionState, RoomEvent, Track, RemoteTrack, RemoteTrackPublication, RemoteParticipant } from "livekit-client";
import { EvaluationScorecard } from "@/components/EvaluationScorecard";
import { ExamEvaluationResult } from "@/types/grading";
import { apiUrl } from "@/lib/api";

export interface DefenseViewStack2Props {
  initialRoom?: string;
  initialStudentId?: string;
  systemPrompt?: string;
  durationMinutes?: number;
  examId?: string;
  courseTitle?: string;
  leadProfessor?: string;
  supervisingTaId?: string;
  supervisingTaName?: string;
  syllabusTopics?: string[];
  syllabusItems?: any[];
  stackName?: string;
}

export interface ChamberInfo {
  id: string;
  number: number;
  label: string;
  isOccupied: boolean;
}

function ArchitecturalHeroGraphic() {
  return (
    <div className="relative w-full h-40 sm:h-48 md:h-52 overflow-hidden rounded-2xl border border-zinc-800/80 bg-gradient-to-br from-zinc-950 via-[#0a0a14] to-black shadow-lg">
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
          <linearGradient id="chamberWallGrad1" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#1e1e28" />
            <stop offset="50%" stopColor="#13131c" />
            <stop offset="100%" stopColor="#0b0b12" />
          </linearGradient>
          <linearGradient id="chamberWallGrad2" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="#2c2c3c" />
            <stop offset="100%" stopColor="#111118" />
          </linearGradient>
          <linearGradient id="chamberBeamRay" x1="0%" y1="0%" x2="100%" y2="100%">
            <stop offset="0%" stopColor="rgba(168, 85, 247, 0.45)" />
            <stop offset="100%" stopColor="rgba(99, 102, 241, 0)" />
          </linearGradient>
          <linearGradient id="chamberEdgeGlow" x1="0%" y1="0%" x2="100%" y2="0%">
            <stop offset="0%" stopColor="#c084fc" stopOpacity="0.9" />
            <stop offset="100%" stopColor="#6366f1" stopOpacity="0.1" />
          </linearGradient>
        </defs>

        {/* Horizon Grid Lines */}
        <line x1="0" y1="210" x2="500" y2="210" stroke="#27272a" strokeWidth="0.75" strokeOpacity="0.4" />
        <line x1="0" y1="225" x2="500" y2="225" stroke="#27272a" strokeWidth="0.5" strokeOpacity="0.25" />

        {/* Volumetric Light Cone across the roof */}
        <polygon points="340,20 180,240 480,240" fill="url(#chamberBeamRay)" opacity="0.35" />

        {/* Building Block 1: Right Monolith */}
        <polygon points="360,20 490,60 490,240 360,240" fill="url(#chamberWallGrad1)" stroke="#3f3f46" strokeWidth="0.75" />
        {/* Monolith Windows */}
        <rect x="385" y="70" width="22" height="42" fill="#08080c" stroke="#27272a" strokeWidth="0.5" />
        <rect x="425" y="85" width="22" height="42" fill="#08080c" stroke="#27272a" strokeWidth="0.5" />
        <rect x="385" y="135" width="22" height="42" fill="#08080c" stroke="#27272a" strokeWidth="0.5" />
        <rect x="425" y="150" width="22" height="42" fill="#08080c" stroke="#27272a" strokeWidth="0.5" />

        {/* Building Block 2: Center Main Facade with Perspective */}
        <polygon points="260,75 360,20 360,240 260,240" fill="url(#chamberWallGrad2)" stroke="#52525b" strokeWidth="0.75" />
        {/* Recessed Vertical Slot Windows */}
        <line x1="285" y1="100" x2="285" y2="210" stroke="#18181b" strokeWidth="3" />
        <line x1="315" y1="80" x2="315" y2="210" stroke="#18181b" strokeWidth="3" />
        <line x1="340" y1="60" x2="340" y2="210" stroke="#18181b" strokeWidth="3" />

        {/* Building Block 3: Lower Left Wing */}
        <polygon points="170,135 260,75 260,240 170,240" fill="url(#chamberWallGrad1)" stroke="#3f3f46" strokeWidth="0.75" />
        <rect x="195" y="150" width="38" height="26" fill="#0a0b12" stroke="#27272a" strokeWidth="0.5" />

        {/* Roof Highlight Line with Violet Glow */}
        <line x1="260" y1="75" x2="360" y2="20" stroke="url(#chamberEdgeGlow)" strokeWidth="1.5" />
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

export function DefenseViewStack2({
  initialRoom = "stack2-chamber-01",
  initialStudentId = "student_stack2",
  systemPrompt,
  durationMinutes = 10,
  examId,
  courseTitle,
  leadProfessor,
  supervisingTaId,
  supervisingTaName,
  syllabusTopics = [],
  syllabusItems = [],
  stackName = "Main Stack",
}: DefenseViewStack2Props) {
  const [chambers, setChambers] = useState<ChamberInfo[]>([]);
  const [chambersLoading, setChambersLoading] = useState<boolean>(true);
  const [selectedChamber, setSelectedChamber] = useState<string>(initialRoom);
  const [roomName, setRoomName] = useState(initialRoom);
  const [studentId, setStudentId] = useState(initialStudentId);
  const [token, setToken] = useState<string | null>(null);
  const [serverUrl, setServerUrl] = useState<string>(() => {
    if (typeof window !== "undefined") {
      if (window.location.protocol === "https:" || window.location.hostname.includes("iiitviva.online")) {
        return "wss://livekit.iiitviva.online";
      }
      return `http://${window.location.hostname || "10.10.16.13"}:7880`;
    }
    return "http://10.10.16.13:7880";
  });
  const [loading, setLoading] = useState<boolean>(false);
  const [error, setError] = useState<string | null>(null);
  const [showPromptDrawer, setShowPromptDrawer] = useState<boolean>(false);
  const [showDiagnostics, setShowDiagnostics] = useState<boolean>(false);
  const [sessionId, setSessionId] = useState<string>("");

  // Poll 100 chambers every 1s when not inside room for near-instant occupancy updates
  useEffect(() => {
    if (token) return;
    let isMounted = true;

    const fetchChambers = async () => {
      try {
        const res = await fetch(apiUrl("/api/defense/chambers"));
        if (!res.ok) return;
        const data = await res.json();
        if (isMounted && data.chambers && Array.isArray(data.chambers)) {
          setChambers(data.chambers);
          // If current selected chamber is occupied or invalid, auto-route to first free chamber
          setSelectedChamber((prev) => {
            const current = data.chambers.find((c: ChamberInfo) => c.id === prev);
            if (!prev || !current || current.isOccupied) {
              const firstFree = data.chambers.find((c: ChamberInfo) => !c.isOccupied);
              const nextId = firstFree ? firstFree.id : data.chambers[0]?.id || "stack2-chamber-01";
              setRoomName(nextId);
              return nextId;
            }
            return prev;
          });
        }
      } catch (err) {
        console.warn("Failed to poll chambers:", err);
      } finally {
        if (isMounted) setChambersLoading(false);
      }
    };

    fetchChambers();
    const interval = setInterval(fetchChambers, 1000);
    return () => {
      isMounted = false;
      clearInterval(interval);
    };
  }, [token]);

  // Keep chamber lock alive while student is in session
  useEffect(() => {
    if (!token) return;
    const currentRoom = roomName || selectedChamber;
    if (!currentRoom) return;

    const hbInterval = setInterval(() => {
      fetch(apiUrl("/api/defense/chambers/release"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ roomName: currentRoom, studentId, action: "heartbeat" }),
      }).catch(() => { });
    }, 10000);

    const handleUnload = () => {
      const hasActive = typeof window !== "undefined" ? localStorage.getItem("openviva_active_defense_stack2") : null;
      if (!hasActive) {
        navigator.sendBeacon?.(
          apiUrl("/api/defense/chambers/release"),
          JSON.stringify({ roomName: currentRoom, studentId })
        );
      }
    };
    window.addEventListener("beforeunload", handleUnload);

    return () => {
      clearInterval(hbInterval);
      window.removeEventListener("beforeunload", handleUnload);
    };
  }, [token, roomName, selectedChamber, studentId]);

  // Automatic recovery on mount: re-enter active defense chamber if session was interrupted
  useEffect(() => {
    try {
      const savedRaw = localStorage.getItem("openviva_active_defense_stack2");
      if (savedRaw) {
        const saved = JSON.parse(savedRaw);
        if (saved && saved.chamberId && Date.now() - (saved.timestamp || 0) < 300000) {
          console.log("[DefenseView] Reconnecting to active defense session in:", saved.chamberId);
          setSelectedChamber(saved.chamberId);
          setRoomName(saved.chamberId);
          if (saved.studentId) setStudentId(saved.studentId);
          if (saved.sessionId) setSessionId(saved.sessionId);
          handleJoin(saved.chamberId, saved.studentId, saved.sessionId);
        }
      }
    } catch (e) {
      console.debug("[DefenseViewStack2] Auto-rejoin warning:", e);
    }
  }, []);

  const handleJoin = async (overrideRoom?: string, overrideStudentId?: string, overrideSessionId?: string) => {
    setLoading(true);
    setError(null);
    try {
      const targetRoom = overrideRoom || selectedChamber || roomName || "stack2-chamber-01";
      const targetStudent = overrideStudentId || studentId;
      setRoomName(targetRoom);
      setSelectedChamber(targetRoom);
      if (overrideStudentId) setStudentId(targetStudent);

      const sid =
        overrideSessionId ||
        sessionId ||
        `sess_${targetStudent.trim().replace(/[^a-zA-Z0-9_-]/g, "")}_${Date.now()}`;
      setSessionId(sid);

      // Instant optimistic local occupancy update (0ms UI latency)
      setChambers((prev) =>
        prev.map((c) => (c.id === targetRoom ? { ...c, isOccupied: true } : c))
      );

      const res = await fetch(apiUrl("/api/defense/token"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ roomName: targetRoom, studentId: targetStudent, sessionId: sid }),
      });
      const data = await res.json();
      if (!res.ok || data.error) {
        throw new Error(data.error || "Failed to obtain room token");
      }
      setToken(data.token);
      if (data.url && !data.url.includes("shiksha.iiit.ac.in")) {
        setServerUrl(data.url);
      }
    } catch (err: any) {
      setError(err?.message || "Connection error");
    } finally {
      setLoading(false);
    }
  };

  const handleLeave = () => {
    const currentRoom = roomName || selectedChamber;
    if (currentRoom) {
      fetch(apiUrl("/api/defense/chambers/release"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify({ roomName: currentRoom, studentId }),
        keepalive: true,
      }).catch(() => { });
    }
    setToken(null);
  };

  return (
    <div className="max-w-5xl w-full mx-auto font-sans text-white space-y-6 py-6 px-4 sm:px-6">
      {/* Top Editorial Header & Hero Section matching Mockup */}
      {!token && (
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-center pb-1">
          {/* Left Column: Chamber Title & Subtitle */}
          <div className="lg:col-span-7 space-y-2">
            <div className="text-[11px] font-mono tracking-widest text-zinc-500 uppercase flex items-center gap-1.5 mb-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
              <span>CHAMBER STATION</span>
            </div>
            <h1 className="text-4xl sm:text-5xl font-black tracking-tight text-white leading-tight">
              Oral defense <span className="text-purple-400">chamber.</span>
            </h1>
            <p className="text-xs sm:text-sm text-zinc-400 font-mono">
              Verify your identity and enter the live defense session.
            </p>
          </div>

          {/* Right Column: Architectural Hero Monolith Graphic */}
          <div className="lg:col-span-5">
            <ArchitecturalHeroGraphic />
          </div>
        </div>
      )}

      {/* Socratic Persona & Active Scope Overview Card */}
      {!token && (
        <div className="relative rounded-2xl border border-purple-500/30 bg-zinc-950/70 p-5 sm:p-6 backdrop-blur-md space-y-3.5 shadow-sm overflow-hidden before:absolute before:inset-x-0 before:top-0 before:h-px before:bg-gradient-to-r before:from-transparent before:via-purple-500/60 before:to-transparent">
          <div className="flex items-center justify-between text-xs">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-purple-400 animate-pulse" />
              <span className="font-semibold text-white tracking-tight text-sm">
                {systemPrompt
                  ? "Standard Socratic Super Prompt"
                  : "Standard Socratic Super Prompt"}
              </span>
            </div>
            {systemPrompt && (
              <button
                onClick={() => setShowPromptDrawer(!showPromptDrawer)}
                className="text-[11px] text-zinc-500 hover:text-zinc-300 transition font-mono cursor-pointer"
              >
                {showPromptDrawer ? "Hide prompt" : "Inspect prompt"}
              </button>
            )}
          </div>

          <div className="text-xs text-zinc-400 font-mono">
            <span>Subject: {courseTitle || "deeplearning"}</span>
            <span className="mx-2 text-zinc-600">•</span>
            <span>Target Budget: {durationMinutes} min</span>
            {syllabusTopics.length > 0 && (
              <>
                <span className="mx-2 text-zinc-600">•</span>
                <span>{syllabusTopics.length} topics in scope</span>
              </>
            )}
          </div>

          <div>
            <span className="inline-flex items-center gap-2 px-3 py-1.5 rounded-full bg-emerald-950/30 border border-emerald-500/30 text-emerald-400 text-[11px] font-mono">
              <span className="text-xs font-bold font-mono">∿||∿</span>
              <span>Main Stack: Zero Added VRAM (0 MB) • Clause Streamer Active • Target ~400ms</span>
            </span>
          </div>

          {/* Expandable Prompt Drawer */}
          {showPromptDrawer && systemPrompt && (
            <div className="pt-3 border-t border-zinc-900 space-y-2">
              <div className="flex items-center justify-between text-[10px] font-mono text-zinc-500 uppercase tracking-widest">
                <span>Synthesized Socratic Prompt ({systemPrompt.length} chars)</span>
                <span>Model: {process.env.NEXT_PUBLIC_VLLM_MODEL || "Phi-3.5-mini-instruct"}</span>
              </div>
              <pre className="p-3.5 bg-black border border-zinc-800/80 rounded-xl text-[11px] text-zinc-400 font-mono overflow-x-auto whitespace-pre-wrap max-h-52 overflow-y-auto leading-relaxed">
                {systemPrompt}
              </pre>
            </div>
          )}
        </div>
      )}

      {error && (
        <div className="p-4 rounded-xl border border-red-900/60 bg-red-950/20 text-xs text-red-300 font-mono">
          {error}
        </div>
      )}

      {/* Pre-Join Screen: Prominent Candidate Authorization Panel */}
      {!token ? (
        <div className="relative rounded-2xl border border-purple-500/30 bg-zinc-950/80 p-6 sm:p-8 space-y-6 backdrop-blur-md shadow-[0_0_40px_-10px_rgba(168,85,247,0.15)] overflow-hidden before:absolute before:left-0 before:top-6 before:bottom-6 before:w-1.5 before:bg-purple-500 before:rounded-r before:shadow-[0_0_12px_rgba(168,85,247,0.8)]">
          {/* Header Row with Shield */}
          <div className="flex items-start gap-4">
            <div className="w-11 h-11 rounded-xl bg-purple-950/50 border border-purple-500/40 flex items-center justify-center text-purple-400 text-lg shrink-0 shadow-inner">
              <svg
                className="w-5 h-5"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                <path d="m9 12 2 2 4-4" />
              </svg>
            </div>
            <div>
              <h2 className="text-xl sm:text-2xl font-bold tracking-tight text-white">
                Candidate authorization.
              </h2>
              <p className="text-xs text-zinc-400 mt-0.5 leading-relaxed font-mono">
                Verify your candidate ID and local station parameters before entering the oral defense.
              </p>
            </div>
          </div>

          {/* Form Fields Grid */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-5">
            <div>
              <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-2 font-medium">
                CANDIDATE ID
              </label>
              <input
                type="text"
                value={studentId}
                onChange={(e) => setStudentId(e.target.value)}
                className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-white font-mono placeholder-zinc-600 focus:outline-none focus:border-purple-500/80 transition shadow-inner"
              />
            </div>

            <div>
              <div className="flex items-center justify-between mb-2">
                <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 font-medium">
                  CHAMBER DROPDOWN (100 ROOMS)
                </label>
                <div className="flex items-center gap-1.5 text-[10px] font-mono">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
                  <span className="text-emerald-400">
                    {chambers.length > 0
                      ? `${chambers.filter((c) => !c.isOccupied).length} Free`
                      : "100 Free"}
                  </span>
                  {chambers.some((c) => c.isOccupied) && (
                    <>
                      <span className="text-zinc-600">•</span>
                      <span className="text-amber-400">
                        {chambers.filter((c) => c.isOccupied).length} In Use
                      </span>
                    </>
                  )}
                </div>
              </div>

              <div className="relative">
                <select
                  value={selectedChamber}
                  onChange={(e) => {
                    setSelectedChamber(e.target.value);
                    setRoomName(e.target.value);
                  }}
                  disabled={loading || chambersLoading}
                  className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-200 font-mono focus:outline-none focus:border-purple-500/80 transition appearance-none cursor-pointer shadow-inner pr-10"
                >
                  {chambers.length === 0 ? (
                    <option value={selectedChamber}>
                      {chambersLoading ? "Scanning 100 chambers..." : "Chamber 01 • [AVAILABLE]"}
                    </option>
                  ) : (
                    chambers.map((ch) => (
                      <option
                        key={ch.id}
                        value={ch.id}
                        disabled={ch.isOccupied}
                        className={ch.isOccupied ? "bg-zinc-950 text-zinc-600" : "bg-zinc-900 text-white"}
                      >
                        {ch.label} {ch.isOccupied ? "• [OCCUPIED — IN USE]" : "• [AVAILABLE]"}
                      </option>
                    ))
                  )}
                </select>
                <div className="pointer-events-none absolute inset-y-0 right-0 flex items-center px-3.5 text-zinc-500 text-xs">
                  ▼
                </div>
              </div>
            </div>

            <div className="sm:col-span-2">
              <label className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-2 font-medium">
                LIVEKIT GATEWAY MODE
              </label>
              <input
                type="text"
                value={serverUrl}
                onChange={(e) => setServerUrl(e.target.value)}
                className="w-full bg-zinc-900/80 border border-zinc-800 rounded-xl px-4 py-3 text-xs text-zinc-300 font-mono placeholder-zinc-600 focus:outline-none focus:border-purple-500/80 transition shadow-inner"
              />
            </div>
          </div>

          {/* Footer Bar */}
          <div className="pt-4 border-t border-zinc-900 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <span className="text-xs font-mono text-zinc-500 flex items-center gap-2">
              <span className="text-sm">🎙</span>
              <span>WebRTC Audio Link: Microphone & Headset Required</span>
            </span>

            <button
              onClick={() => handleJoin()}
              disabled={loading || !studentId.trim()}
              className="group flex items-center gap-2 px-6 py-3 rounded-xl bg-purple-600 hover:bg-purple-500 text-white font-mono text-xs font-semibold shadow-[0_0_20px_rgba(147,51,234,0.4)] hover:shadow-[0_0_30px_rgba(147,51,234,0.6)] transition-all cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
            >
              <span>{loading ? "Connecting to node..." : "Enter live defense"}</span>
              <span className="text-sm group-hover:translate-x-1 transition-transform duration-200">
                →
              </span>
            </button>
          </div>
        </div>
      ) : (
        /* In-Chamber LiveKit Audio Room */
        <LiveKitRoom
          serverUrl={serverUrl}
          token={token}
          connect={true}
          audio={{
            echoCancellation: true,
            noiseSuppression: true,
            autoGainControl: true,
          }}
          video={false}
          onDisconnected={() => {
            console.warn("[LiveKitRoom] Disconnected from chamber:", serverUrl);
            handleLeave();
          }}
          onError={(err: Error) => {
            console.error("[LiveKitRoom] Connection Error:", err);
            setError(`Chamber WebRTC connection error (${serverUrl}): ${err?.message || err}. Verify gateway availability.`);
            handleLeave();
          }}
          className="space-y-6"
        >
          <RoomControls
            onLeave={handleLeave}
            roomName={roomName}
            examId={examId}
            systemPrompt={systemPrompt}
            durationMinutes={durationMinutes}
            courseTitle={courseTitle}
            leadProfessor={leadProfessor}
            supervisingTaId={supervisingTaId}
            supervisingTaName={supervisingTaName}
            syllabusTopics={syllabusTopics}
            syllabusItems={syllabusItems}
            sessionId={sessionId}
            studentId={studentId}
          />
          <RoomAudioRenderer />
          <StartAudio label="Click to unlock examiner audio playback" />
        </LiveKitRoom>
      )}

      {/* Understated Diagnostic Console Accordion */}
      <div className="pt-4 border-t border-zinc-900">

      </div>
    </div>
  );
}

// =========================================================================
// IN-ROOM MINIMALIST AUDIO CONTROLS, COUNTDOWN & TRANSCRIPT STREAM
// =========================================================================
function RoomControls({
  onLeave,
  roomName,
  examId,
  systemPrompt,
  durationMinutes = 10,
  courseTitle,
  leadProfessor,
  supervisingTaId,
  supervisingTaName,
  syllabusTopics = [],
  syllabusItems = [],
  sessionId,
  studentId,
}: {
  onLeave: () => void;
  roomName: string;
  examId?: string;
  systemPrompt?: string;
  durationMinutes?: number;
  courseTitle?: string;
  leadProfessor?: string;
  supervisingTaId?: string;
  supervisingTaName?: string;
  syllabusTopics?: string[];
  syllabusItems?: any[];
  sessionId: string;
  studentId: string;
}) {
  const room = useRoomContext();
  const connectionState = useConnectionState();
  const { isMicrophoneEnabled, localParticipant } = useLocalParticipant();
  const remoteParticipants = useRemoteParticipants();
  const { canPlayAudio, startAudio } = useAudioPlayback(room);
  const [transcripts, setTranscripts] = useState<
    Array<{
      id?: string;
      sender: string;
      text: string;
      time: string;
      isInterrupted?: boolean;
      isPartial?: boolean;
      verdict?: string;
      reasoning?: string;
      topicTitle?: string;
      latencyMs?: number;
      conductStrikes?: number;
    }>
  >(() => {
    try {
      const savedRaw = typeof window !== "undefined" ? localStorage.getItem("openviva_active_defense_stack2") : null;
      if (savedRaw) {
        const saved = JSON.parse(savedRaw);
        if (saved && Array.isArray(saved.transcripts) && saved.transcripts.length > 0) {
          return saved.transcripts;
        }
      }
    } catch (e) {
      console.debug("[DefenseViewStack2] Session storage transcripts warning:", e);
    }
    return [];
  });
  const [candInput, setCandInput] = useState<string>("");
  const [candSending, setCandSending] = useState<boolean>(false);
  const [agentState, setAgentState] = useState<
    "connecting" | "listening" | "thinking" | "speaking" | "concluded"
  >("listening");
  const [agentStatusMsg, setAgentStatusMsg] = useState<string>(
    "Examiner is ready — candidate may speak."
  );
  const [isConfigVerified, setIsConfigVerified] = useState<boolean>(false);
  const seenIdsRef = useRef<Set<string>>(new Set());
  const transcriptEndRef = useRef<HTMLDivElement | null>(null);

  // Examination lifecycle and evaluation state
  const [isExamCompleted, setIsExamCompleted] = useState<boolean>(false);
  const [evaluation, setEvaluation] = useState<ExamEvaluationResult | null>(null);
  const [isEvaluating, setIsEvaluating] = useState<boolean>(false);
  const [evalError, setEvalError] = useState<string | null>(null);
  const [recordingUrl, setRecordingUrl] = useState<string | null>(null);

  // Interaction lock: active during evaluation and permanently sealed after scorecard is generated
  const isInteractionLocked = isExamCompleted || isEvaluating || Boolean(evaluation);
  const isInteractionLockedRef = useRef<boolean>(false);
  useEffect(() => {
    isInteractionLockedRef.current = isInteractionLocked;
  }, [isInteractionLocked]);

  // Reactive audio & microphone lockout enforcement
  useEffect(() => {
    if (isInteractionLocked && localParticipant && isMicrophoneEnabled) {
      localParticipant.setMicrophoneEnabled(false).catch(() => { });
    }
  }, [isInteractionLocked, localParticipant, isMicrophoneEnabled]);

  // Phase 2: Real-time 3-Stage Smart-Turn telemetry (driven purely by model states)
  interface TurnDecisionTelemetry {
    type?: string;
    stage?: "STAGE_1_VAD" | "STAGE_2_ACOUSTIC" | "STAGE_3_SEMANTIC" | "STAGE_TIMEOUT" | "STAGE_BARGE_IN";
    vad_state?: "speaking" | "paused" | "timeout_commit" | "barge_in";
    acoustic_prob?: number;
    acoustic_verdict?: "COMPLETE" | "INCOMPLETE" | "TIMEOUT";
    threshold?: number;
    semantic_prob?: number;
    semantic_verdict?: string;
    buffer_text?: string;
    action?: "RESUMED_SPEAKING" | "HOLDING_FLOOR" | "DISPATCHING" | "TIMEOUT_COMMITTED" | "BARGE_IN_TRIGGERED" | "AWAITING_STAGE_3_SNAPSHOT";
    timestamp?: number;
  }

  const [lastTurnDecision, setLastTurnDecision] = useState<TurnDecisionTelemetry | null>(null);
  const [decisionHistory, setDecisionHistory] = useState<TurnDecisionTelemetry[]>([]);
  const [showDecisionHistory, setShowDecisionHistory] = useState<boolean>(false);
  const [showConcludeModal, setShowConcludeModal] = useState<boolean>(false);

  // Auto-disarm candidate speaking watchdog if no voice updates within 3.5s
  useEffect(() => {
    if (lastTurnDecision?.action === "RESUMED_SPEAKING") {
      const timer = setTimeout(() => {
        setLastTurnDecision(null);
      }, 3500);
      return () => clearTimeout(timer);
    }
  }, [lastTurnDecision]);

  // Autoplay and audio unlock helper
  const ensureAudioUnlocked = () => {
    if (typeof startAudio === "function") {
      startAudio().catch(() => { });
    }
    document.querySelectorAll("audio").forEach((el) => {
      el.muted = false;
      el.volume = 1.0;
      el.play().catch(() => { });
    });
  };



  // Backend session clock & pacing state
  const targetDurationSeconds = Math.max(60, (durationMinutes || 10) * 60);
  const [elapsedSeconds, setElapsedSeconds] = useState<number>(() => {
    try {
      const savedRaw = typeof window !== "undefined" ? localStorage.getItem("openviva_active_defense_stack2") : null;
      if (savedRaw) {
        const saved = JSON.parse(savedRaw);
        if (saved && typeof saved.elapsedSeconds === "number") {
          return saved.elapsedSeconds;
        }
      }
    } catch (e) {
      console.debug("[DefenseViewStack2] Session storage timer warning:", e);
    }
    return 0;
  });

  // Continuous auto-save of active defense session to localStorage for seamless refresh resilience
  useEffect(() => {
    if (transcripts.length > 0 && !isExamCompleted) {
      try {
        localStorage.setItem(
          "openviva_active_defense_stack2",
          JSON.stringify({
            sessionId,
            chamberId: roomName,
            courseTitle: courseTitle || "Oral Defense Examination",
            durationMinutes: durationMinutes || 10,
            systemPrompt: systemPrompt || "",
            syllabusTopics: syllabusTopics || [],
            transcripts,
            elapsedSeconds,
            timestamp: Date.now(),
          })
        );
      } catch (e) {
        console.debug("[DefenseViewStack2] Session storage save warning:", e);
      }
    }
  }, [transcripts, elapsedSeconds, roomName, courseTitle, durationMinutes, systemPrompt, syllabusTopics, isExamCompleted, sessionId]);

  // Write-Ahead Logging: Asynchronous background persistence per completed dialogue turn
  const persistedTurnsRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    if (!sessionId || transcripts.length === 0) return;

    transcripts.forEach((t) => {
      if (!t.id || t.isPartial || !t.text || !t.text.trim()) return;
      if (persistedTurnsRef.current.has(t.id)) return;

      persistedTurnsRef.current.add(t.id);

      fetch(apiUrl("/api/defense/records"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "append_turn",
          sessionId,
          studentId: studentId || localParticipant?.identity || "Candidate",
          examId: examId || (courseTitle ? `exam_${courseTitle.toLowerCase().replace(/[^a-z0-9]+/g, '_')}` : "exam_default"),
          courseTitle: courseTitle || "Oral Defense Examination",
          leadProfessor: leadProfessor || undefined,
          supervisingTaId: supervisingTaId || undefined,
          supervisingTaName: supervisingTaName || undefined,
          systemPrompt: systemPrompt || "",
          turn: {
            id: t.id,
            speaker: t.sender === "examiner" ? "examiner" : (t.sender === "system" ? "system" : "candidate"),
            sender: t.sender,
            text: t.text,
            timestamp: new Date().toISOString(),
            isInterrupted: Boolean(t.isInterrupted),
          },
          elapsedSeconds,
        }),
      }).catch((err) => {
        console.warn("[WAL] Background append_turn failed:", err);
      });
    });
  }, [transcripts, sessionId, studentId, courseTitle, leadProfessor, supervisingTaId, supervisingTaName, elapsedSeconds, localParticipant]);

  // Auto-scroll transcript container on new turns
  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcripts]);

  // Two-Phase Commit Evaluation Pipeline
  const handleRunGrading = async () => {
    if (isEvaluating) return;
    setIsEvaluating(true);
    setEvalError(null);

    // FIX 1 & INPUT LOCK: Silence in-flight Kokoro audio and mute microphone immediately
    if (room) {
      try {
        const pInt = new TextEncoder().encode(JSON.stringify({ type: "interrupt" }));
        room.localParticipant.publishData(pInt, { reliable: true });
        const pConc = new TextEncoder().encode(JSON.stringify({ type: "conclude_defense" }));
        room.localParticipant.publishData(pConc, { reliable: true });
      } catch (e) {
        console.debug("[DefenseViewStack2] Data packet dispatch warning:", e);
      }
    }
    if (localParticipant) {
      localParticipant.setMicrophoneEnabled(false).catch(() => { });
    }
    try {
      // Direct Single-Step Sealing to COMPLETED (Decoupled from LLM Grading)
      console.log("[Conclude Defense] Sealing exam session as COMPLETED directly (Zero grading lag)...");
      await fetch(apiUrl("/api/defense/records"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "complete_session",
          sessionId,
          chamberId: roomName,
          actualDurationSeconds: elapsedSeconds,
          endedAt: new Date().toISOString(),
          recordingUrl: recordingUrl || undefined,
        }),
      });

      localStorage.removeItem("openviva_active_defense_stack2");
      console.log("[Conclude Defense] Session sealed. Opening evidence and biometric review.");
    } catch (err: any) {
      console.error("[Conclude Defense] Error sealing session:", err);
    } finally {
      setIsEvaluating(false);
    }
  };

  // Manual conclusion handler with confirmation
  const handleInitiateConclusion = () => {
    if (isExamCompleted || isEvaluating) return;
    if (remainingSeconds > 10) {
      setShowConcludeModal(true);
    } else {
      executeConclusion();
    }
  };

  const executeConclusion = () => {
    setShowConcludeModal(false);
    setIsExamCompleted(true);
    setAgentState("concluded");
    setAgentStatusMsg("Examination manually concluded by candidate. Generating evaluation report...");

    // FIX 1: Immediately silence in-flight Kokoro TTS audio on viva conclusion (<15ms)
    if (room) {
      try {
        const payloadInterrupt = new TextEncoder().encode(
          JSON.stringify({ type: "interrupt" })
        );
        room.localParticipant.publishData(payloadInterrupt, { reliable: true });

        const payloadConclude = new TextEncoder().encode(
          JSON.stringify({ type: "conclude_defense" })
        );
        room.localParticipant.publishData(payloadConclude, { reliable: true });
        console.log("[DefenseView] Dispatched interrupt & conclude_defense signals on conclusion.");
      } catch (err) {
        console.warn("Failed to publish conclusion signals:", err);
      }
    }

    // BLOCK ALL USER INPUTS: Immediately mute candidate microphone
    if (localParticipant) {
      localParticipant.setMicrophoneEnabled(false).catch((err) => {
        console.warn("Failed to mute microphone on conclusion:", err);
      });
    }
  };

  // Trigger automated committee second-pass grading upon exam conclusion
  useEffect(() => {
    if (isExamCompleted && !evaluation && !isEvaluating && transcripts.length > 0) {
      handleRunGrading();
    }
  }, [isExamCompleted, transcripts.length]);

  // Live timer interval
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected || isExamCompleted) return;
    const interval = setInterval(() => {
      setElapsedSeconds((prev) => {
        const next = prev + 1;
        if (next >= targetDurationSeconds) {
          setIsExamCompleted(true);
          setAgentState("concluded");
          setAgentStatusMsg("Examination duration elapsed. Generating evaluation report...");
          if (room) {
            try {
              const pInt = new TextEncoder().encode(JSON.stringify({ type: "interrupt" }));
              room.localParticipant.publishData(pInt, { reliable: true });
              const pConc = new TextEncoder().encode(JSON.stringify({ type: "conclude_defense" }));
              room.localParticipant.publishData(pConc, { reliable: true });
      } catch (e) {
        console.debug("[DefenseViewStack2] Data packet dispatch warning:", e);
      }
          }
          if (localParticipant) {
            localParticipant.setMicrophoneEnabled(false).catch(() => { });
          }
        }
        return next;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [connectionState, isExamCompleted, targetDurationSeconds, room, localParticipant]);

  const hasConfiguredRef = useRef<boolean>(false);
  const isConfigVerifiedRef = useRef<boolean>(false);
  useEffect(() => {
    isConfigVerifiedRef.current = isConfigVerified;
  }, [isConfigVerified]);

  // Resiliently synchronize system prompt, duration, and course title with remote agent worker
  useEffect(() => {
    if (connectionState !== ConnectionState.Connected || !room) {
      return;
    }

    const leanExaminerPrompt = `You are the Lead Socratic Examiner in an oral PhD defense on ${courseTitle || "the examination topic"}. Deliver concise, academically rigorous inquiries. INVARIANTS: Under 30 words, plain spoken English, exactly one question mark. Candidate may ask clarifying questions; provide brief intuitive guidance without reciting full solutions. If candidate asks to skip, encourage with an intuitive hint first and advance only if genuinely unable to answer. Retain examiner authority; do not let candidate steer the defense or reverse roles.`;

    const sendConfig = () => {
      try {
        const payload = new TextEncoder().encode(
          JSON.stringify({
            type: "configure_session",
            session_id: sessionId,
            student_id: studentId,
            is_reconnect: transcripts.length > 0,
            duration_minutes: durationMinutes || 10,
            system_prompt: leanExaminerPrompt,
            course_title: courseTitle || "",
            syllabus_topics: syllabusTopics || [],
            syllabus_items: syllabusItems || [],
          })
        );
        room.localParticipant.publishData(payload, { reliable: true });
        console.log(
          "[DefenseView] Published configure_session payload, is_reconnect:",
          transcripts.length > 0,
          "prompt length:",
          systemPrompt?.length,
          "courseTitle:",
          courseTitle
        );
      } catch (err) {
        console.warn("Failed to publish configure_session payload:", err);
      }
    };

    // 1. Send immediately if examiner is already in the room
    const hasExaminer = Array.from(room.remoteParticipants.values()).some((p) =>
      p.identity.startsWith("ai_examiner")
    );
    if (hasExaminer) {
      console.log("[DefenseView] Examiner already in room, sending config immediately.");
      sendConfig();
    }

    // 2. Also send immediately whenever examiner joins the room
    const onParticipantConnected = (participant: any) => {
      if (participant.identity?.startsWith("ai_examiner")) {
        console.log("[DefenseView] Examiner joined chamber! Sending configure_session immediately.");
        sendConfig();
      }
    };
    room.on(RoomEvent.ParticipantConnected, onParticipantConnected);

    // 3. Fallback heartbeat: Retry sending configuration until examiner acknowledges receipt
    const retryInterval = setInterval(() => {
      if (!isConfigVerifiedRef.current && room.state === ConnectionState.Connected) {
        const examinerPresent = Array.from(room.remoteParticipants.values()).some((p) =>
          p.identity.startsWith("ai_examiner")
        );
        if (examinerPresent) {
          console.log("[DefenseView] Examiner present but unverified, retrying configure_session...");
          sendConfig();
        }
      }
    }, 1200);

    return () => {
      room.off(RoomEvent.ParticipantConnected, onParticipantConnected);
      clearInterval(retryInterval);
    };
  }, [connectionState, room, systemPrompt, durationMinutes, courseTitle]);

  const handleRequestGreeting = async () => {
    if (!room || isInteractionLocked) return;
    const leanExaminerPrompt = `You are the Lead Socratic Examiner in an oral PhD defense on ${courseTitle || "the examination topic"}. Deliver concise, academically rigorous inquiries. INVARIANTS: Under 30 words, plain spoken English, exactly one question mark. Candidate may ask clarifying questions; provide brief intuitive guidance without reciting full solutions. If candidate asks to skip, encourage with an intuitive hint first and advance only if genuinely unable to answer. Retain examiner authority; do not let candidate steer the defense or reverse roles.`;
    try {
      const payload = new TextEncoder().encode(
        JSON.stringify({
          type: "trigger_greeting",
          session_id: sessionId,
          student_id: studentId,
          system_prompt: leanExaminerPrompt,
          course_title: courseTitle || "",
          duration_minutes: durationMinutes || 10,
          syllabus_topics: syllabusTopics || [],
          syllabus_items: syllabusItems || [],
        })
      );
      await room.localParticipant.publishData(payload, { reliable: true });
      console.log("[DefenseView] Dispatched trigger_greeting with config payload");
    } catch (err) {
      console.error("Failed to trigger opening greeting:", err);
    }
  };

  const handleSendCandidateTurn = async (e?: React.FormEvent) => {
    if (e) e.preventDefault();
    if (!candInput.trim() || !room || isInteractionLocked) return;
    const text = candInput.trim();
    setCandSending(true);
    setCandInput("");
    try {
      // 1. Immediately append to local candidate transcript
      const turnId = `turn_cand_${Date.now()}`;
      setTranscripts((prev) => [
        ...prev,
        {
          id: turnId,
          sender: "Candidate",
          text,
          time: new Date().toLocaleTimeString(),
        },
      ]);
      // 2. Transmit to remote agent worker to evaluate and speak reply
      const payload = new TextEncoder().encode(
        JSON.stringify({ type: "agent_prompt", text })
      );
      await room.localParticipant.publishData(payload, { reliable: true });
    } catch (err) {
      console.error("Failed to send candidate turn:", err);
    } finally {
      setCandSending(false);
    }
  };

  const handleInterrupt = async () => {
    if (!room || isInteractionLocked) return;
    try {
      const payload = new TextEncoder().encode(
        JSON.stringify({ type: "interrupt" })
      );
      await room.localParticipant.publishData(payload, { reliable: true });
      setAgentState("listening");
      setAgentStatusMsg("Examiner interrupted. Floor yielded to candidate.");
    } catch (err) {
      console.error("Failed to send interrupt signal:", err);
    }
  };

  const handleExitChamber = async () => {
    try {
      localStorage.removeItem("openviva_active_defense_stack2");
      if (room) {
        if (localParticipant) {
          try {
            await localParticipant.setMicrophoneEnabled(false);
          } catch (e) {
            console.debug("[DefenseViewStack2] Microphone disable warning:", e);
          }
        }
        const payload = new TextEncoder().encode(
          JSON.stringify({ type: "leave_chamber" })
        );
        await room.localParticipant.publishData(payload, { reliable: true });
        await room.disconnect();
      }
    } catch (err) {
      console.warn("Chamber exit error:", err);
    } finally {
      // 100% complete wipe of all transcripts, telemetry snapshots, and turn states
      setTranscripts([]);
      setLastTurnDecision(null);
      setDecisionHistory([]);
      seenIdsRef.current.clear();
      setElapsedSeconds(0);
      setIsExamCompleted(false);
      setEvaluation(null);
      setEvalError(null);
      setCandInput("");
      setAgentState("listening");
      setAgentStatusMsg("Examiner is ready — candidate may speak.");
      setIsConfigVerified(false);
      onLeave();
    }
  };



  useEffect(() => {
    if (!room) return;
    const handleData = (payload: Uint8Array, participant?: any) => {
      try {
        const str = new TextDecoder().decode(payload);
        const data = JSON.parse(str);

        // Strict guard: Block and drop all LLM / examiner emissions during and after evaluation
        if (isInteractionLockedRef.current) {
          if (
            data.type === "clause_emitted" ||
            data.type === "agent_status" ||
            data.type === "agent_turn" ||
            data.type === "turn_interrupted" ||
            data.type === "turn_decision_telemetry" ||
            data.text
          ) {
            console.log(
              `[DefenseView] Blocked LLM emission (${data.type || "text"}) - session locked/evaluating.`
            );
            return;
          }
        }

        // Reconnection: Handle session_resumed packet from backend
        if (data.type === "session_resumed") {
          console.log("[DefenseView] Reconnected to active session on backend:", data);
          setIsConfigVerified(true);
          if (typeof data.elapsed_s === "number" && data.elapsed_s > 0) {
            setElapsedSeconds(data.elapsed_s);
          }
          if (Array.isArray(data.history) && data.history.length > 0 && transcripts.length === 0) {
            const restoredTurns = data.history.map((m: any, idx: number) => ({
              id: `restored_${idx}`,
              sender: m.role === "assistant" ? "AI Examiner" : "Candidate",
              text: m.content,
              time: new Date().toLocaleTimeString(),
            }));
            setTranscripts(restoredTurns);
          }
          setAgentState("listening");
          setAgentStatusMsg("Reconnected. Floor yielded to candidate.");
          return;
        }

        // Wipe local display upon explicit session_purged signal from backend
        if (data.type === "session_purged") {
          setTranscripts([]);
          setLastTurnDecision(null);
          setDecisionHistory([]);
          seenIdsRef.current.clear();
          return;
        }

        // Phase 2: Real-time Turn Decision Telemetry from backend 3-stage engine
        if (data.type === "turn_decision_telemetry") {
          setLastTurnDecision(data);
          setDecisionHistory((prev) => [data, ...prev].slice(0, 10));
          return;
        }

        // Real-time Socratic Conductor Diagnostic Classification from Tier 1
        if (data.type === "conductor_evaluation") {
          console.log("[DefenseView] Conductor Evaluation received:", data.verdict, data.reasoning);
          setTranscripts((prev) => {
            const updated = [...prev];
            for (let i = updated.length - 1; i >= 0; i--) {
              const s = updated[i].sender;
              if (s === "Candidate" || s === "student_01" || s === localParticipant?.identity) {
                updated[i] = {
                  ...updated[i],
                  verdict: data.verdict,
                  reasoning: data.reasoning,
                  topicTitle: data.topic_title,
                  latencyMs: data.latency_ms,
                  conductStrikes: data.conduct_strikes,
                };
                break;
              }
            }
            return updated;
          });
          return;
        }

        // Session configured ACK from backend
        if (data.type === "session_configured") {
          setIsConfigVerified(true);
          return;
        }

        // Real-time examiner agent turn status
        if (data.type === "agent_status") {
          setIsConfigVerified(true);
          if (data.state) {
            setAgentState(data.state);
            if (data.state === "speaking" || data.state === "thinking" || data.state === "concluded") {
              setLastTurnDecision((prev) => (prev?.action === "RESUMED_SPEAKING" ? null : prev));
            }
          }
          if (data.message) setAgentStatusMsg(data.message);
          return;
        }

        // Progressive clause streaming (Stack 2 sub-sentence emergence)
        if (data.type === "clause_emitted" && data.id && data.clause) {
          setTranscripts((prev) => {
            const existing = prev.find((t) => t.id === data.id);
            if (existing) {
              const updatedText = existing.text.endsWith(" ")
                ? existing.text + data.clause
                : existing.text + " " + data.clause;
              return prev.map((t) =>
                t.id === data.id ? { ...t, text: updatedText } : t
              );
            } else {
              return [
                ...prev,
                {
                  id: data.id,
                  sender: "AI Examiner",
                  text: data.clause,
                  time: new Date().toLocaleTimeString(),
                },
              ];
            }
          });
          return;
        }

        // Handle mid-sentence interruption truncation
        if (data.type === "turn_interrupted" && data.id) {
          setTranscripts((prev) =>
            prev.map((t) =>
              t.id === data.id
                ? { ...t, text: data.truncated_text, isInterrupted: true }
                : t
            )
          );
          setAgentState("listening");
          setAgentStatusMsg("Examiner interrupted. Candidate may speak.");
          return;
        }

        // Voice worker confirmation of configured session
        if (data.type === "session_configured") {
          setIsConfigVerified(true);
          return;
        }

        // Voice worker recording status & S3 URL update
        if (data.type === "recording_status") {
          if (data.recording_url) {
            console.log("[Egress] Received recording URL:", data.recording_url);
            setRecordingUrl(data.recording_url);
          }
          return;
        }

        // Handle forced disconnect / exam termination quit
        if (data.type === "force_disconnect") {
          setIsExamCompleted(true);
          setAgentState("concluded");
          setAgentStatusMsg("Examination concluded. Exiting chamber...");
          handleExitChamber();
          return;
        }

        // Handle examination termination
        const isTerminated = Boolean(
          data.terminated ||
          data.type === "exam_completed" ||
          (data.text && data.text.includes("[EXAM_TERMINATED]"))
        );
        if (isTerminated) {
          setIsExamCompleted(true);
          setAgentState("concluded");
          setAgentStatusMsg("Examination complete. Committee evaluation under review.");
        }

        // Turn message deduplication
        if (data.id) {
          if (seenIdsRef.current.has(data.id)) {
            return;
          }
          seenIdsRef.current.add(data.id);
        }

        if (data.text) {
          const time = new Date().toLocaleTimeString();
          const cleanText = data.text.replace("[EXAM_TERMINATED]", "").trim();
          const isPartial = Boolean(data.is_partial);
          setTranscripts((prev) => {
            // In-place update: If message with same id already exists, update unless interrupted
            const existingIndex = prev.findIndex((p) => p.id === data.id);
            if (existingIndex !== -1) {
              if (prev[existingIndex].isInterrupted) {
                return prev;
              }
              const updated = [...prev];
              updated[existingIndex] = {
                ...updated[existingIndex],
                text: cleanText,
                isPartial,
              };
              return updated;
            }

            // In-place update: If previous message was a candidate partial from this same turn, update it cleanly
            const lastTurn = prev[prev.length - 1];
            if (lastTurn && lastTurn.sender === "Candidate" && lastTurn.isPartial) {
              const updated = [...prev];
              updated[updated.length - 1] = {
                id: data.id,
                sender: data.sender || participant?.identity || "Candidate",
                text: cleanText,
                time,
                isPartial,
              };
              return updated;
            }

            // Deduplicate if identical turn exists anywhere in recent turns
            if (prev.some((p) => p.text === cleanText)) {
              return prev;
            }
            return [
              ...prev,
              {
                id: data.id,
                sender: data.sender || participant?.identity || "AI Examiner",
                text: cleanText,
                time,
                isPartial,
              },
            ];
          });
        }
      } catch {
        const text = new TextDecoder().decode(payload);
        if (text.trim()) {
          const time = new Date().toLocaleTimeString();
          const cleanText = text.replace("[EXAM_TERMINATED]", "").trim();
          setTranscripts((prev) => [
            ...prev,
            { sender: participant?.identity || "Speaker", text: cleanText, time },
          ]);
        }
      }
    };

    room.on(RoomEvent.DataReceived, handleData);
    return () => {
      room.off(RoomEvent.DataReceived, handleData);
    };
  }, [room]);

  const remainingSeconds = Math.max(0, targetDurationSeconds - elapsedSeconds);
  const formatTime = (secs: number) => {
    const m = Math.floor(secs / 60);
    const s = secs % 60;
    return `${m.toString().padStart(2, "0")}:${s.toString().padStart(2, "0")}`;
  };

  const progressPct = Math.min(100, (elapsedSeconds / targetDurationSeconds) * 100);

  const leanPromptStr = `You are the Lead Socratic Examiner in an oral PhD defense on ${courseTitle || "the examination topic"}. Deliver concise, academically rigorous inquiries based strictly on pedagogical steering directives. INVARIANTS: Under 30 words, plain spoken English, exactly one question mark.`;
  const estimatedSystemTokens = Math.ceil(leanPromptStr.length / 3.8);
  const estimatedConversationTokens = transcripts.reduce(
    (acc, t) => acc + Math.ceil((t.text || "").length / 3.8),
    0
  );
  const totalEstimatedContextTokens = estimatedSystemTokens + estimatedConversationTokens;

  // Radial orbital clock calculations
  const clockRadius = 78;
  const clockCircumference = 2 * Math.PI * clockRadius;
  const timeRemainingFraction = Math.max(0, Math.min(1, remainingSeconds / targetDurationSeconds));
  const clockDashoffset = clockCircumference * (1 - timeRemainingFraction);
  const clockElapsedFraction = 1 - timeRemainingFraction;
  const beadAngle = -Math.PI / 2 + 2 * Math.PI * clockElapsedFraction;
  const beadX = 100 + clockRadius * Math.cos(beadAngle);
  const beadY = 100 + clockRadius * Math.sin(beadAngle);
  const isUnder60 = remainingSeconds <= 60 && remainingSeconds > 0;

  const isCandidateTurn = (t: { sender: string }) =>
    t.sender === "Candidate" ||
    t.sender === "student_01" ||
    t.sender === localParticipant?.identity;

  const waveformBars = [
    18, 28, 48, 72, 94, 68, 42, 88, 100, 78, 52, 92, 62, 38,
    38, 62, 92, 52, 78, 100, 88, 42, 68, 94, 72, 48, 28, 18
  ];

  return (
    <div
      className="space-y-6"
      onClick={() => {
        ensureAudioUnlocked();
      }}
    >
      {/* Prominent Autoplay Unblock Banner */}
      {!canPlayAudio && (
        <div
          onClick={(e) => {
            e.stopPropagation();
            if (typeof startAudio === "function") startAudio().catch(() => { });
          }}
          className="p-4 rounded-2xl border border-amber-500/50 bg-amber-950/40 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-amber-200 font-mono cursor-pointer hover:bg-amber-950/60 transition shadow-lg animate-pulse"
        >
          <div className="flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-amber-400"></span>
            <span className="font-semibold text-white">Browser Audio Autoplay Muted:</span>
            <span>Click here or anywhere in the chamber to enable Examiner speech.</span>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              ensureAudioUnlocked();
            }}
            className="px-4 py-2 bg-amber-400 hover:bg-amber-300 text-black text-xs font-semibold rounded-xl transition cursor-pointer"
          >
            Unmute Examiner Voice →
          </button>
        </div>
      )}

      {/* Post-Defense Evaluation Dashboard & Locked State */}
      {isInteractionLocked && (
        <div className="space-y-4">
          <div className="p-5 rounded-2xl border border-zinc-800 bg-zinc-950/80 flex flex-col sm:flex-row sm:items-center justify-between gap-4">
            <div>
              <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-500 block mb-1">
                Oral Defense Terminated
              </span>
              <h3 className="text-lg font-medium text-white tracking-tight">
                Candidate examination concluded.
              </h3>
              <p className="text-xs text-zinc-400 mt-0.5">
                The session inputs are locked. The academic committee is evaluating candidate performance.
              </p>
            </div>
            <button
              onClick={handleExitChamber}
              className="px-4 py-2 rounded-xl border border-zinc-800 hover:border-zinc-600 text-xs text-zinc-300 hover:text-white transition font-mono cursor-pointer shrink-0"
            >
              Exit Chamber
            </button>
          </div>

          <EvaluationScorecard
            onClose={handleExitChamber}
            recordingUrl={recordingUrl}
            studentId={studentId}
            sessionId={sessionId}
            transcripts={transcripts}
          />
        </div>
      )}

      {/* Microphone Inactivity Advisory */}
      {!isMicrophoneEnabled && !isInteractionLocked && (
        <div className="p-3.5 rounded-xl border border-amber-900/40 bg-amber-950/20 text-xs font-mono text-amber-300 flex flex-col sm:flex-row sm:items-center justify-between gap-2.5">
          <span>Microphone is currently muted or blocked. Allow browser microphone access or toggle mic active to speak.</span>
          <button
            onClick={() => localParticipant?.setMicrophoneEnabled(true)}
            className="px-3 py-1.5 bg-amber-400 hover:bg-amber-300 text-black rounded-lg font-medium text-[11px] transition cursor-pointer self-start sm:self-auto shrink-0 shadow-sm"
          >
            Activate Microphone
          </button>
        </div>
      )}

      {/* ========================================================================= */}
      {/* MAIN EXAMINATION STAGE: AI EXAMINER | RADIAL CLOCK | CANDIDATE FEED */}
      {/* ========================================================================= */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* LEFT COLUMN: AI EXAMINER (5 COLS) */}
        <div className="lg:col-span-5 rounded-2xl border border-zinc-800/80 bg-zinc-950/70 p-5 sm:p-6 space-y-4 backdrop-blur-md shadow-2xl">
          {/* Card Header */}
          <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
            <div className="flex items-center gap-2">
              <span className="text-violet-400 text-sm">✦</span>
              <span className="font-mono text-xs font-bold tracking-wider text-violet-300 uppercase">
                AI Examiner
              </span>
            </div>

            {/* Ripple Audio Pulse Pill */}
            {agentState === "speaking" ? (
              <div className="px-3 py-1 rounded-full border border-violet-500/50 bg-violet-950/50 text-violet-300 font-mono text-[11px] flex items-center gap-2 animate-audio-pulse-wave">
                <div className="flex items-center gap-0.5 h-3">
                  {[40, 90, 60, 100].map((h, i) => (
                    <span
                      key={i}
                      className="w-0.5 rounded-full bg-violet-400 animate-pulse"
                      style={{ height: `${h}%`, animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
                <span className="font-medium">Speaking...</span>
              </div>
            ) : agentState === "thinking" ? (
              <div className="px-3 py-1 rounded-full border border-zinc-700 bg-zinc-900/60 text-zinc-300 font-mono text-[11px] flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-400 animate-ping" />
                <span>Evaluating...</span>
              </div>
            ) : (
              <div className="px-2.5 py-0.5 rounded-full border border-zinc-800 bg-zinc-900/40 text-zinc-500 font-mono text-[11px] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-zinc-600" />
                <span>Idle / Listening</span>
              </div>
            )}
          </div>

          {/* AI Dialogue Turns & Chronological Spacers */}
          <div className="space-y-4 min-h-[320px]">
            {transcripts.length === 0 ? (
              <div className="py-14 text-center space-y-3">
                <div className="w-2 h-2 bg-violet-400 rounded-full mx-auto animate-ping" />
                <p className="text-xs font-mono text-zinc-500">
                  Examiner is initializing opening defense inquiry...
                </p>
                {!isInteractionLocked && (
                  <button
                    onClick={handleRequestGreeting}
                    className="inline-flex items-center gap-2 px-3.5 py-1.5 rounded-lg border border-violet-900/60 bg-violet-950/30 text-violet-300 hover:text-white text-[11px] font-mono transition cursor-pointer"
                  >
                    Trigger opening examiner greeting now →
                  </button>
                )}
              </div>
            ) : (
              transcripts.map((t, idx) => {
                const isCand = isCandidateTurn(t);
                if (isCand) {
                  // Chronological Waterfall Gap: Candidate turn happened here
                  return (
                    <div
                      key={t.id || `spacer_${idx}`}
                      className="p-3.5 rounded-xl border border-dashed border-zinc-800/40 bg-zinc-950/20 text-zinc-600 font-mono text-[11px] flex items-center justify-between select-none"
                    >
                      <span className="text-zinc-600">
                        Candidate response • TURN {(idx + 1).toString().padStart(2, "0")}
                      </span>
                      <span className="text-zinc-700 font-mono">──→</span>
                    </div>
                  );
                }

                // AI Examiner Speech Bubble
                return (
                  <div
                    key={t.id || `turn_${idx}`}
                    className="p-4 sm:p-5 rounded-2xl border border-violet-500/30 bg-[#0d0e1a]/95 text-white shadow-[0_0_25px_rgba(139,92,246,0.12)] relative animate-turn-slide-in space-y-2 transition-all hover:border-violet-500/50"
                  >
                    <div className="flex items-center justify-between text-[10px] font-mono text-violet-400/90 pb-1 border-b border-violet-950/60">
                      <div className="flex items-center gap-1.5">
                        <span>✦</span>
                        <span className="font-semibold uppercase tracking-wider">
                          TURN {(idx + 1).toString().padStart(2, "0")}
                        </span>
                        <span className="text-zinc-600">•</span>
                        <span className="text-zinc-500">{t.time}</span>
                      </div>
                      {t.isInterrupted && (
                        <span className="text-[9px] font-mono uppercase tracking-wider text-amber-400 border border-amber-900/60 bg-amber-950/40 px-1.5 py-0.5 rounded">
                          Interrupted
                        </span>
                      )}
                    </div>
                    <p className="text-sm leading-relaxed text-zinc-100 font-sans">
                      {t.text}
                    </p>
                  </div>
                );
              })
            )}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        {/* CENTER COLUMN: RADIAL ORBITAL CLOCK & TELEMETRY (2 COLS) */}
        <div className="lg:col-span-2 flex flex-col items-center justify-start pt-2 space-y-4">
          {/* Radial Countdown Clock */}
          <div className="relative w-[210px] h-[210px] flex items-center justify-center">
            <svg
              width="210"
              height="210"
              viewBox="0 0 200 200"
              className="transform rotate-0"
            >
              {/* Background Orbit Ring */}
              <circle
                cx="100"
                cy="100"
                r={clockRadius}
                fill="none"
                stroke="#18181b"
                strokeWidth="8"
              />
              {/* Glowing Purple / Amber Progress Sweep */}
              <circle
                cx="100"
                cy="100"
                r={clockRadius}
                fill="none"
                stroke={isUnder60 ? "#f59e0b" : "#a855f7"}
                strokeWidth="8"
                strokeLinecap="round"
                strokeDasharray={clockCircumference}
                strokeDashoffset={clockDashoffset}
                transform="rotate(-90 100 100)"
                className={isUnder60 ? "animate-pulse" : "transition-all duration-1000"}
                style={{
                  filter: isUnder60
                    ? "drop-shadow(0 0 10px rgba(245, 158, 11, 0.7))"
                    : "drop-shadow(0 0 12px rgba(168, 85, 247, 0.6))",
                }}
              />
              {/* Traveling Orbital Bead */}
              <circle
                cx={beadX}
                cy={beadY}
                r="6"
                fill={isUnder60 ? "#f59e0b" : "#c084fc"}
                stroke="#090a14"
                strokeWidth="2"
                className={isUnder60 ? "animate-pulse" : ""}
                style={{
                  filter: isUnder60
                    ? "drop-shadow(0 0 8px #f59e0b)"
                    : "drop-shadow(0 0 8px #c084fc)",
                }}
              />
            </svg>

            {/* Inner Digits and Budget Subtitle */}
            <div className="absolute inset-0 flex flex-col items-center justify-center pointer-events-none">
              <span
                className={`text-3xl sm:text-4xl font-mono font-bold tracking-tight ${
                  isUnder60 ? "text-amber-400 animate-pulse" : "text-white"
                }`}
              >
                {formatTime(remainingSeconds)}
              </span>
              <span className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase mt-0.5">
                OF {formatTime(targetDurationSeconds)} MIN
              </span>
            </div>
          </div>

          {/* Telemetry Scope & Tokens */}
          <div className="text-center font-mono text-[11px] text-zinc-400 space-y-1">
            <div>
              <span className="text-zinc-300">{(syllabusTopics && syllabusTopics.length) || 9}</span> topics in scope
              <span className="text-zinc-600 mx-1.5">•</span>
              <span className="text-zinc-300">{totalEstimatedContextTokens.toLocaleString()}</span> / 4,096 tokens
            </div>

            {remainingSeconds <= 30 && (
              <span className="inline-block px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded bg-rose-950/80 border border-rose-800 text-rose-300 animate-pulse">
                Concluding Turn
              </span>
            )}
            {remainingSeconds > 30 && remainingSeconds <= 60 && (
              <span className="inline-block px-2.5 py-0.5 text-[10px] font-mono uppercase tracking-wider rounded bg-amber-950/80 border border-amber-800 text-amber-300 animate-pulse">
                Final 60 Seconds
              </span>
            )}
          </div>
        </div>

        {/* RIGHT COLUMN: CANDIDATE FEED & LIVE VOICE BOX (5 COLS) */}
        <div className="lg:col-span-5 rounded-2xl border border-zinc-800/80 bg-zinc-950/70 p-5 sm:p-6 space-y-4 backdrop-blur-md shadow-2xl">
          {/* Card Header */}
          <div className="flex items-center justify-between pb-3 border-b border-zinc-900">
            <div className="flex items-center gap-2">
              <span className="text-emerald-400 text-sm">👤</span>
              <span className="font-mono text-xs font-bold tracking-wider text-emerald-400 uppercase">
                Candidate
              </span>
            </div>

            {/* Listening / Microphone State Pill */}
            {agentState === "listening" ? (
              <div className="px-3 py-1 rounded-full border border-emerald-500/50 bg-emerald-950/50 text-emerald-300 font-mono text-[11px] flex items-center gap-2">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-ping" />
                <span className="font-medium">Listening...</span>
                <div className="flex items-center gap-0.5 h-3">
                  {[30, 80, 50].map((h, i) => (
                    <span
                      key={i}
                      className="w-0.5 rounded-full bg-emerald-400 animate-pulse"
                      style={{ height: `${h}%`, animationDelay: `${i * 0.2}s` }}
                    />
                  ))}
                </div>
              </div>
            ) : agentState === "speaking" ? (
              <div className="px-2.5 py-0.5 rounded-full border border-zinc-800 bg-zinc-900/40 text-zinc-500 font-mono text-[11px] flex items-center gap-1.5">
                <span>Awaiting Turn</span>
              </div>
            ) : (
              <div className="px-2.5 py-0.5 rounded-full border border-zinc-800 bg-zinc-900/40 text-zinc-400 font-mono text-[11px] flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500" />
                <span>Ready</span>
              </div>
            )}
          </div>

          {/* Candidate Dialogue Turns & Chronological Spacers */}
          <div className="space-y-4 min-h-[160px]">
            {transcripts.map((t, idx) => {
              const isCand = isCandidateTurn(t);
              if (!isCand) {
                // Chronological Waterfall Gap: AI Examiner inquiry happened here
                return (
                  <div
                    key={t.id || `spacer_ai_${idx}`}
                    className="p-3.5 rounded-xl border border-dashed border-zinc-800/40 bg-zinc-950/20 text-zinc-600 font-mono text-[11px] flex items-center justify-between select-none"
                  >
                    <span className="text-zinc-700 font-mono">←──</span>
                    <span className="text-zinc-600">
                      AI Examiner inquiry • TURN {(idx + 1).toString().padStart(2, "0")}
                    </span>
                  </div>
                );
              }

              // Candidate Speech Bubble
              return (
                <div
                  key={t.id || `turn_cand_${idx}`}
                  className="p-4 sm:p-5 rounded-2xl border border-emerald-500/30 bg-[#061412]/95 text-white shadow-[0_0_25px_rgba(16,185,129,0.12)] relative animate-turn-slide-in space-y-2 transition-all hover:border-emerald-500/50"
                >
                  <div className="flex items-center justify-between text-[10px] font-mono text-emerald-400/90 pb-1 border-b border-emerald-950/60">
                    <div className="flex items-center gap-1.5">
                      <span className="font-semibold uppercase tracking-wider">
                        TURN {(idx + 1).toString().padStart(2, "0")}
                      </span>
                      <span className="text-zinc-600">•</span>
                      <span className="text-zinc-500">{t.time}</span>
                    </div>
                    {t.verdict && (
                      <span
                        className={`px-2 py-0.5 rounded text-[9px] font-mono font-medium border uppercase tracking-wider ${
                          t.verdict === "HOSTILE"
                            ? "bg-rose-950/90 text-rose-300 border-rose-500 font-bold animate-pulse shadow-sm shadow-rose-950"
                            : t.verdict === "MASTERED"
                              ? "bg-emerald-500/20 text-emerald-300 border-emerald-500/40"
                              : t.verdict === "ON_RIGHT_PATH"
                                ? "bg-sky-500/20 text-sky-300 border-sky-500/40"
                                : t.verdict === "SHALLOW"
                                  ? "bg-amber-500/20 text-amber-300 border-amber-500/40"
                                  : t.verdict === "MISCONCEPTION"
                                    ? "bg-orange-500/20 text-orange-300 border-orange-500/40"
                                    : t.verdict === "STUCK"
                                      ? "bg-purple-500/20 text-purple-300 border-purple-500/40"
                                      : "bg-red-500/20 text-red-300 border-red-500/40"
                        }`}
                      >
                        {t.verdict}
                      </span>
                    )}
                  </div>
                  <p className="text-sm leading-relaxed text-zinc-100 font-sans">
                    {t.text}
                  </p>
                  {t.reasoning && (
                    <div className="mt-2.5 pt-2 border-t border-emerald-900/40 flex items-start gap-2 text-[11px] font-mono text-emerald-300/80">
                      <span className="text-emerald-500 uppercase tracking-wider shrink-0 text-[10px]">Evaluator:</span>
                      <span className="leading-snug">{t.reasoning}</span>
                    </div>
                  )}
                </div>
              );
            })}
          </div>

          {/* Candidate Voice Box: Speak Now & Dancing Waveform */}
          <div className="p-5 rounded-2xl border border-dashed border-emerald-900/50 bg-emerald-950/10 flex flex-col items-center justify-center space-y-3">
            <div className="flex items-center gap-2 text-emerald-400">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth="2" d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
              </svg>
              <span className="text-xs font-mono font-medium tracking-wide">
                {isMicrophoneEnabled ? "Speak now..." : "Microphone muted"}
              </span>
            </div>

            {/* Symmetrical Waveform Bars Dancing */}
            <div className="flex items-end justify-center gap-1 h-9 w-full max-w-sm px-4">
              {waveformBars.map((baseH, i) => {
                const isActive = isMicrophoneEnabled && (agentState === "listening" || lastTurnDecision?.vad_state === "speaking");
                return (
                  <span
                    key={i}
                    className={`w-1 rounded-full transition-all ${
                      isActive ? "bg-emerald-400 animate-wave-bar" : "bg-zinc-800"
                    }`}
                    style={{
                      height: isActive ? `${baseH}%` : `${Math.max(15, baseH * 0.25)}%`,
                      animationDelay: `${(i % 7) * 0.12}s`,
                      animationDuration: `${0.8 + (i % 5) * 0.1}s`,
                    }}
                  />
                );
              })}
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* UNIFIED CONTROL DOCK */}
      {/* ========================================================================= */}
      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/90 backdrop-blur-xl p-3 sm:p-4 space-y-3 shadow-2xl">
        {/* Upper Control Bar */}
        <div className="flex flex-wrap items-center justify-between gap-3">
          {/* Left: Microphone status & toggle */}
          <div className="flex items-center gap-3">
            <button
              onClick={() => {
                if (!isInteractionLocked && localParticipant) {
                  localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled).catch(() => {});
                }
              }}
              disabled={isInteractionLocked}
              className={`px-3 py-1.5 rounded-xl border flex items-center gap-2 font-mono text-xs transition cursor-pointer ${
                isInteractionLocked
                  ? "border-zinc-800 bg-zinc-900/40 text-zinc-600 cursor-not-allowed"
                  : isMicrophoneEnabled
                    ? "border-emerald-500/40 bg-emerald-950/30 text-emerald-300 hover:bg-emerald-900/40 shadow-sm"
                    : "border-zinc-800 bg-zinc-900/70 text-zinc-400 hover:text-white"
              }`}
            >
              <span className={`w-2 h-2 rounded-full ${isMicrophoneEnabled ? "bg-emerald-400 animate-pulse" : "bg-zinc-600"}`} />
              <span>{isMicrophoneEnabled ? "Microphone active" : "Microphone muted"}</span>
              <span className={`px-2 py-0.5 rounded-full text-[10px] uppercase font-bold tracking-wider ${
                isMicrophoneEnabled ? "bg-emerald-500/20 text-emerald-300 border border-emerald-500/40" : "bg-zinc-800 text-zinc-500"
              }`}>
                {isMicrophoneEnabled ? "LIVE" : "OFF"}
              </span>
            </button>
          </div>

          {/* Center & Actions */}
          <div className="flex flex-wrap items-center gap-2.5">
            {/* Interrupt Examiner */}
            {agentState === "speaking" && !isInteractionLocked && (
              <button
                onClick={handleInterrupt}
                className="px-3.5 py-1.5 rounded-xl border border-amber-500/50 bg-amber-950/40 hover:bg-amber-900/60 text-amber-300 text-xs font-mono transition cursor-pointer flex items-center gap-2 shadow-sm animate-pulse"
                title="Stop examiner speech immediately and yield floor"
              >
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                <span>! Interrupt Examiner</span>
              </button>
            )}

            {/* Repeat Question */}
            {!isInteractionLocked && (
              <button
                onClick={handleRequestGreeting}
                title="Ask the examiner to repeat the question"
                className="px-3.5 py-1.5 rounded-xl border border-zinc-800 hover:border-violet-500/40 bg-zinc-900/70 text-xs font-mono text-zinc-300 hover:text-white transition cursor-pointer flex items-center gap-2"
              >
                <span>🔄 Repeat Question</span>
              </button>
            )}

            {/* Conclude & Grade */}
            {!isExamCompleted && (
              <button
                onClick={handleInitiateConclusion}
                disabled={isEvaluating || transcripts.length === 0}
                title="Conclude oral defense and generate performance evaluation"
                className="px-4 py-1.5 rounded-xl border border-emerald-500/50 bg-emerald-950/50 hover:bg-emerald-900/60 text-emerald-300 text-xs font-mono font-medium transition cursor-pointer flex items-center gap-2 shadow-sm disabled:opacity-40 disabled:cursor-not-allowed"
              >
                <span>✓ Conclude &amp; Grade ⌵</span>
              </button>
            )}

            {/* Leave Chamber */}
            <button
              onClick={handleExitChamber}
              className="px-3.5 py-1.5 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-900/50 text-xs font-mono text-zinc-400 hover:text-zinc-200 transition cursor-pointer flex items-center gap-1.5"
            >
              <span>🚪 Leave</span>
            </button>
          </div>
        </div>

        {/* Lower: Fallback typed answer input form */}
        <form onSubmit={handleSendCandidateTurn} className="flex items-center gap-2.5 pt-2 border-t border-zinc-900/80">
          <div className="flex-1 flex items-center gap-2 px-3 py-1.5 rounded-xl bg-zinc-900/50 border border-zinc-800 focus-within:border-violet-500/50 transition">
            <span className="text-zinc-500 text-xs">⌨️</span>
            <input
              type="text"
              value={candInput}
              onChange={(e) => setCandInput(e.target.value)}
              placeholder={
                isInteractionLocked
                  ? "Defense concluded — candidate inputs locked."
                  : "Type response if microphone is unavailable..."
              }
              disabled={isInteractionLocked}
              className="w-full bg-transparent text-xs text-white placeholder-zinc-500 font-mono focus:outline-none disabled:opacity-40"
            />
          </div>
          <button
            type="submit"
            disabled={isInteractionLocked || candSending || !candInput.trim()}
            className="px-4 py-2 rounded-xl bg-gradient-to-r from-violet-600 to-purple-600 hover:from-violet-500 hover:to-purple-500 text-white text-xs font-medium font-mono transition cursor-pointer disabled:opacity-40 disabled:cursor-not-allowed shadow-md shrink-0 flex items-center gap-1.5"
          >
            <span>Submit</span>
            <span>✈</span>
          </button>
        </form>
      </div>

      {/* ========================================================================= */}
      {/* 3-STAGE ENGINE DIAGNOSTIC DRAWER (COLLAPSIBLE TELEMETRY ACCORDION) */}
      {/* ========================================================================= */}
      <div className="pt-2 border-t border-zinc-900">
        <button
          onClick={() => setShowDecisionHistory(!showDecisionHistory)}
          className="text-[11px] font-mono text-zinc-500 hover:text-zinc-300 transition flex items-center gap-2 cursor-pointer"
        >
          <span className="w-1.5 h-1.5 rounded-full bg-cyan-400" />
          <span>3-Stage Smart-Turn Engine &amp; Telemetry Log ({showDecisionHistory ? "Hide" : "Inspect"}) ⌵</span>
        </button>

        {showDecisionHistory && (
          <div className="mt-3 rounded-2xl border border-zinc-800/80 bg-zinc-950/80 p-5 space-y-4">
            <div className="grid grid-cols-1 md:grid-cols-3 gap-3.5">
              {/* STAGE 1: Silero VAD */}
              <div className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/30 space-y-2">
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block">Stage 1 • VAD</span>
                <span className="text-xs font-mono font-medium text-white block">
                  {lastTurnDecision?.vad_state === "speaking" ? "Speaking Active" : "Idle / Listening"}
                </span>
                <p className="text-[11px] text-zinc-400 font-sans">Instant sub-30ms barge-in cutoff.</p>
              </div>

              {/* STAGE 2: Smart-Turn v3 Acoustic */}
              <div className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/30 space-y-2">
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block">Stage 2 • Acoustic</span>
                <span className="text-xs font-mono font-medium text-white block">
                  {lastTurnDecision?.acoustic_prob !== undefined
                    ? `${(lastTurnDecision.acoustic_prob * 100).toFixed(1)}%`
                    : "0.0%"}
                </span>
                <p className="text-[11px] text-zinc-400 font-sans">Acoustic pitch &amp; hesitation classification.</p>
              </div>

              {/* STAGE 3: Semantic EOU */}
              <div className="p-4 rounded-xl border border-zinc-800/80 bg-zinc-900/30 space-y-2">
                <span className="text-[10px] font-mono text-zinc-500 uppercase tracking-wider block">Stage 3 • Semantic</span>
                <span className="text-xs font-mono font-medium text-white block">
                  {lastTurnDecision?.semantic_prob !== undefined
                    ? `${(lastTurnDecision.semantic_prob * 100).toFixed(2)}%`
                    : "0.00%"}
                </span>
                <p className="text-[11px] text-zinc-400 font-sans">Dedicated LiveKit EOU ONNX inference.</p>
              </div>
            </div>

            {decisionHistory.length > 0 && (
              <div className="space-y-1 max-h-36 overflow-y-auto font-mono text-xs text-zinc-400 pt-2 border-t border-zinc-900">
                {decisionHistory.map((item, idx) => (
                  <div key={idx} className="p-2 rounded bg-zinc-900/40 flex items-center justify-between text-[11px]">
                    <span>{new Date((item.timestamp || 0) * 1000).toLocaleTimeString()} - {item.stage}</span>
                    <span className="text-zinc-500">{item.action}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Confirmation Modal for Manual Conclusion */}
      {showConcludeModal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4">
          <div className="w-full max-w-md rounded-2xl border border-zinc-800 bg-zinc-950 p-6 space-y-4 shadow-2xl">
            <div className="space-y-1">
              <span className="text-[10px] font-mono uppercase tracking-widest text-amber-400 block">
                Confirm Examination Conclusion
              </span>
              <h3 className="text-lg font-medium text-white tracking-tight">
                Conclude defense &amp; submit for grading?
              </h3>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed font-mono">
              You still have <span className="text-white font-medium">{formatTime(remainingSeconds)}</span> remaining in your defense budget.
              Concluding now will immediately lock your dialogue on disk and run the committee evaluation pass.
            </p>
            <div className="pt-2 flex items-center justify-end gap-3 font-mono text-xs">
              <button
                onClick={() => setShowConcludeModal(false)}
                className="px-4 py-2 rounded-xl border border-zinc-800 hover:border-zinc-700 bg-zinc-900/60 text-zinc-300 hover:text-white transition cursor-pointer"
              >
                Continue Defense
              </button>
              <button
                onClick={executeConclusion}
                className="px-4 py-2 rounded-xl bg-emerald-500 hover:bg-emerald-400 text-black font-semibold transition cursor-pointer shadow"
              >
                Yes, Conclude &amp; Grade
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
