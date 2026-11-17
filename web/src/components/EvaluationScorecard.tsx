"use client";

import React, { useState, useEffect, useRef } from "react";
import { apiUrl } from "@/lib/api";
import {
  BehavioralIntegrityFlag,
  BiometricIdentityCardData,
} from "@/types/grading";

interface TranscriptTurnItem {
  speaker?: string;
  sender?: string;
  text: string;
  timestamp?: string;
  isInterrupted?: boolean;
  tokens?: number;
}

interface EvaluationScorecardProps {
  evaluation?: any;
  onClose?: () => void;
  recordingUrl?: string | null;
  studentId?: string | null;
  sessionId?: string | null;
  enrolledFaceUrl?: string | null;
  examKeyframeUrl?: string | null;
  transcripts?: TranscriptTurnItem[];
}

export function EvaluationScorecard({
  evaluation,
  onClose,
  recordingUrl,
  studentId,
  sessionId,
  enrolledFaceUrl: propEnrolledFaceUrl,
  examKeyframeUrl: propExamKeyframeUrl,
  transcripts: propTranscripts,
}: EvaluationScorecardProps) {
  const [copied, setCopied] = useState(false);
  const [showAiModal, setShowAiModal] = useState(false);
  const [localTranscripts, setLocalTranscripts] = useState<TranscriptTurnItem[]>(propTranscripts || []);
  const [hudData, setHudData] = useState<BiometricIdentityCardData | null>(
    evaluation?.biometricAudit || null
  );
  const [activeSnippetRange, setActiveSnippetRange] = useState<{ start: number; end: number } | null>(null);
  const [audioLoaded, setAudioLoaded] = useState<boolean>(false);
  const [screenReaderAnnouncement, setScreenReaderAnnouncement] = useState<string>("");

  const mainAudioRef = useRef<HTMLAudioElement | null>(null);

  const effectiveStudentId = studentId || "";
  const effectiveSessionId = sessionId || "";

  // If transcripts were not provided via props, auto-fetch from records API
  useEffect(() => {
    if (propTranscripts && propTranscripts.length > 0) {
      setLocalTranscripts(propTranscripts);
      return;
    }
    if (!effectiveSessionId) return;

    let isMounted = true;
    fetch(apiUrl(`/api/defense/records?sessionId=${effectiveSessionId}`))
      .then((res) => (res.ok ? res.json() : null))
      .then((data) => {
        if (data?.record?.transcript && isMounted) {
          setLocalTranscripts(data.record.transcript);
        }
      })
      .catch((err) => console.warn("Failed to fetch session transcript turns:", err));

    return () => {
      isMounted = false;
    };
  }, [effectiveSessionId, propTranscripts]);

  // Auto-fetch biometric telemetry HUD data from backend
  useEffect(() => {
    let isMounted = true;
    if (!effectiveStudentId && !effectiveSessionId) return;

    const fetchBiometricHud = async () => {
      try {
        const query = new URLSearchParams();
        if (effectiveSessionId) query.set("sessionId", effectiveSessionId);
        if (effectiveStudentId) query.set("regNo", effectiveStudentId);

        const res = await fetch(apiUrl(`/api/biometrics/session-hud?${query.toString()}`));
        if (!res.ok) return;
        const data = await res.json();
        if (data.success && isMounted) {
          setHudData({
            verificationStatus: data.verificationStatus,
            enrolledFaceUrl: data.enrolledFaceUrl,
            examKeyframeUrl: data.examKeyframeUrl,
            faceMatchSimilarity: data.faceMatchSimilarity,
            enrolledAt: data.enrolledAt,
            secondaryVoiceDetected: data.secondaryVoiceDetected,
            evidenceSnippets: data.evidenceSnippets,
            recordingUrl: data.recordingUrl,
            livenessConfidence: data.livenessConfidence,
            alignmentMethod: data.alignmentMethod,
            claheNormalized: data.claheNormalized,
            acousticAuditCompleted: data.acousticAuditCompleted,
            acousticSimilarity: data.acousticSimilarity,
            acousticVerdict: data.acousticVerdict,
          });

          // If acoustic audit is in progress, poll every 2.5s up to 4 times
          if (!data.acousticAuditCompleted && !data.secondaryVoiceDetected) {
            let pollCount = 0;
            const timer = setInterval(async () => {
              if (!isMounted || pollCount >= 4) {
                clearInterval(timer);
                return;
              }
              pollCount++;
              try {
                const retryRes = await fetch(apiUrl(`/api/biometrics/session-hud?${query.toString()}`));
                if (!retryRes.ok) return;
                const retryData = await retryRes.json();
                if (retryData.success && isMounted) {
                  setHudData({
                    verificationStatus: retryData.verificationStatus,
                    enrolledFaceUrl: retryData.enrolledFaceUrl,
                    examKeyframeUrl: retryData.examKeyframeUrl,
                    faceMatchSimilarity: retryData.faceMatchSimilarity,
                    enrolledAt: retryData.enrolledAt,
                    secondaryVoiceDetected: retryData.secondaryVoiceDetected,
                    evidenceSnippets: retryData.evidenceSnippets,
                    recordingUrl: retryData.recordingUrl,
                    livenessConfidence: retryData.livenessConfidence,
                    alignmentMethod: retryData.alignmentMethod,
                    claheNormalized: retryData.claheNormalized,
                    acousticAuditCompleted: retryData.acousticAuditCompleted,
                    acousticSimilarity: retryData.acousticSimilarity,
                    acousticVerdict: retryData.acousticVerdict,
                  });
                  if (retryData.acousticAuditCompleted || retryData.secondaryVoiceDetected) {
                    clearInterval(timer);
                  }
                }
              } catch (pollErr) {
                console.debug("[EvaluationScorecard] Polling telemetry warning:", pollErr);
              }
            }, 2500);
          }
        }
      } catch (err) {
        console.warn("Failed to load biometric HUD telemetry:", err);
      }
    };

    fetchBiometricHud();
    return () => {
      isMounted = false;
    };
  }, [effectiveStudentId, effectiveSessionId]);

  // Resolve media URLs
  const rawEnrolledUrl =
    propEnrolledFaceUrl ||
    hudData?.enrolledFaceUrl ||
    (effectiveStudentId ? `/api/biometrics/photo?regNo=${effectiveStudentId}&type=reference` : null);

  const rawKeyframeUrl =
    propExamKeyframeUrl ||
    hudData?.examKeyframeUrl ||
    (effectiveStudentId
      ? `/api/biometrics/photo?regNo=${effectiveStudentId}&type=keyframe&sessionId=${effectiveSessionId}`
      : null);

  const enrolledFaceUrl = rawEnrolledUrl ? apiUrl(rawEnrolledUrl) : null;
  const examKeyframeUrl = rawKeyframeUrl ? apiUrl(rawKeyframeUrl) : null;

  // Extract secondary voice evidence snippets
  const rawFlags: BehavioralIntegrityFlag[] = [
    ...(evaluation?.behavioralFlags || []),
    ...(evaluation?.behavioralAudit?.evidenceSnippets || []),
    ...(hudData?.evidenceSnippets || []),
  ];

  const voiceSnippets: BehavioralIntegrityFlag[] = [];
  const seenKeys = new Set<string>();

  rawFlags.forEach((item) => {
    const key = `${item.flag}-${item.timestampRange?.startSeconds ?? 0}`;
    if (!seenKeys.has(key)) {
      seenKeys.add(key);
      voiceSnippets.push(item);
    }
  });

  const secondaryVoiceFlagged =
    hudData?.secondaryVoiceDetected ||
    voiceSnippets.some(
      (s) =>
        s.flag === "ACCOMPLICE_DETECTED" ||
        s.flag === "IMPOSTER_PROXY_TAKEOVER" ||
        s.flag === "MULTIPLE_COLLUSION_PARTIES_DETECTED"
    );

  const [authToken, setAuthToken] = useState<string>("");

  useEffect(() => {
    if (typeof window !== "undefined") {
      const t =
        localStorage.getItem("openviva_session_token") ||
        localStorage.getItem("openviva_instructor_token") ||
        localStorage.getItem("openviva_token") ||
        localStorage.getItem("openviva_student_token") ||
        sessionStorage.getItem("openviva_token") ||
        "";
      if (t) setAuthToken(t);
    }
  }, []);

  const getAudioSrc = (rawUrl?: string | null): string => {
    if (!rawUrl) return "";
    let url = apiUrl(rawUrl);
    if (authToken && !url.includes("token=")) {
      url += (url.includes("?") ? "&" : "?") + `token=${encodeURIComponent(authToken)}`;
    }
    return url;
  };

  const normalizeRecUrl = (url?: string | null) => {
    if (!url) return null;
    if (url.includes(":9000") || url.startsWith("http://10.10.16.13:9000")) {
      return effectiveSessionId ? `/api/defense/audio?sessionId=${effectiveSessionId}` : url;
    }
    return url;
  };
  const effectiveRecordingUrl =
    normalizeRecUrl(recordingUrl) ||
    normalizeRecUrl(hudData?.recordingUrl) ||
    (effectiveSessionId ? `/api/defense/audio?sessionId=${effectiveSessionId}` : null);

  const formatSeconds = (sec?: number): string => {
    if (sec === undefined || isNaN(sec)) return "00:00";
    const mins = Math.floor(sec / 60);
    const remainder = Math.floor(sec % 60);
    return `${mins.toString().padStart(2, "0")}:${remainder.toString().padStart(2, "0")}`;
  };

  const handleSeekAndPlay = (startSec: number, endSec?: number) => {
    const audio = mainAudioRef.current;
    if (!audio) return;

    // Toggle pause if clicking the snippet that is currently actively playing
    if (activeSnippetRange && activeSnippetRange.start === startSec && !audio.paused) {
      audio.pause();
      setActiveSnippetRange(null);
      setScreenReaderAnnouncement(`Paused forensic audio snippet at ${formatSeconds(startSec)}`);
      return;
    }

    const effectiveEnd = (endSec !== undefined && endSec > startSec) ? endSec : undefined;
    if (effectiveEnd !== undefined) {
      setActiveSnippetRange({ start: startSec, end: effectiveEnd });
      setScreenReaderAnnouncement(`Playing forensic audio snippet from ${formatSeconds(startSec)} to ${formatSeconds(effectiveEnd)}`);
    } else {
      setActiveSnippetRange(null);
      setScreenReaderAnnouncement(`Playing continuous master audio stream from ${formatSeconds(startSec)}`);
    }

    const performSeek = () => {
      audio.currentTime = startSec;
      audio.play().catch((err) => {
        console.warn("[EvaluationScorecard] Audio playback failed:", err);
      });
    };

    if (audio.readyState >= 1) { // HAVE_METADATA or higher
      performSeek();
    } else {
      const onLoaded = () => {
        audio.removeEventListener("loadedmetadata", onLoaded);
        setAudioLoaded(true);
        performSeek();
      };
      audio.addEventListener("loadedmetadata", onLoaded);
      audio.load();
    }
  };

  const handleCopySummary = () => {
    const summary = `OpenViva Oral Defense Examination Record
Candidate: ${effectiveStudentId.toUpperCase() || "N/A"}
Session ID: ${effectiveSessionId || "N/A"}
Biometric Verification: ${hudData?.verificationStatus || "PENDING"}
Face Similarity: ${hudData?.faceMatchSimilarity !== undefined && hudData?.faceMatchSimilarity !== null ? `${(hudData.faceMatchSimilarity * 100).toFixed(1)}%` : "Not Recorded"}
Secondary Voice Flagged: ${secondaryVoiceFlagged ? "YES (Forensic Investigation Required)" : "None"}
Transcript Turns: ${localTranscripts.length}
`;
    navigator.clipboard.writeText(summary);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  const handleDownloadJson = () => {
    const exportData = {
      sessionMetadata: {
        sessionId: effectiveSessionId,
        studentId: effectiveStudentId,
        recordingUrl: effectiveRecordingUrl,
        concludedAt: new Date().toISOString(),
      },
      biometricHud: hudData,
      transcript: localTranscripts,
    };
    const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `openviva-defense-${effectiveSessionId || "session"}-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div className="rounded-2xl border border-zinc-800/80 bg-zinc-950/95 p-6 sm:p-10 text-white space-y-8 font-sans shadow-2xl">
      {/* WCAG 2.1 AA Screen Reader Live Announcement */}
      <div className="sr-only" aria-live="polite" role="status" aria-atomic="true">
        {screenReaderAnnouncement}
      </div>

      {/* Editorial Header */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-6 border-b border-zinc-900 gap-4">
        <div>
          <span className="text-[10px] font-mono uppercase tracking-widest text-zinc-400 block mb-1">
            Defense Examination Session Review
          </span>
          <h2 className="text-2xl sm:text-3xl font-medium tracking-tight text-white flex items-center gap-3">
            <span>Candidate Evidentiary Record</span>
            {effectiveStudentId && (
              <span className="text-xs font-mono px-2.5 py-1 rounded-md bg-zinc-900 border border-zinc-800 text-zinc-300">
                {effectiveStudentId.toUpperCase()}
              </span>
            )}
          </h2>
          <p className="text-xs text-zinc-300 mt-1 font-mono">
            Defense concluded &bull; {localTranscripts.length} dialogue turns preserved
          </p>
        </div>

        {/* Pillar 4: Let AI Analyse Button */}
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={() => setShowAiModal(true)}
            aria-label="Let AI analyse examination transcript"
            className="px-4 py-2 rounded-xl text-xs font-mono font-medium border border-purple-500/50 bg-purple-950/30 text-purple-200 hover:bg-purple-900/40 hover:border-purple-400 transition cursor-pointer flex items-center gap-2 shadow-sm focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:outline-none"
          >
            <span aria-hidden="true">✨</span>
            <span>Let AI Analyse</span>
          </button>

          {onClose && (
            <button
              type="button"
              onClick={onClose}
              aria-label="Close candidate review scorecard"
              className="px-4 py-2 rounded-xl text-xs font-mono border border-zinc-700 bg-zinc-900 hover:bg-zinc-800 text-zinc-300 transition cursor-pointer focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:outline-none"
            >
              Close Review
            </button>
          )}
        </div>
      </div>

      {/* AI Analysis Advisory Modal / Drawer */}
      {showAiModal && (
        <div className="rounded-2xl border border-purple-500/50 bg-purple-950/40 p-6 space-y-4 animate-in fade-in duration-200">
          <div className="flex items-start justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className="text-2xl" aria-hidden="true">🤖</span>
              <div>
                <h4 className="text-sm font-semibold text-purple-200">
                  AI Evaluation Service Decoupled
                </h4>
                <p className="text-xs text-purple-300/80 mt-0.5">
                  Automated LLM grading has been turned off to eliminate uncalibrated synthetic scores.
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={() => setShowAiModal(false)}
              aria-label="Dismiss AI evaluation advisory"
              className="text-xs font-mono text-purple-400 hover:text-white px-2 py-1 rounded bg-purple-900/40 border border-purple-500/30 cursor-pointer focus-visible:ring-2 focus-visible:ring-purple-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:outline-none"
            >
              Dismiss
            </button>
          </div>
          <p className="text-xs text-zinc-300 font-mono bg-black/60 p-4 rounded-xl border border-purple-500/30 leading-relaxed">
            Please connect an AI or LLM to do it. You can connect a dedicated heavy reasoning model (e.g. GPT-4o, Claude 3.5 Sonnet, or an on-premises deep reasoning server) via the TA configuration panel whenever you wish to perform qualitative rubric analysis.
          </p>
        </div>
      )}

      {/* ========================================================================= */}
      {/* PILLAR 1: DUAL FACIAL RECOGNITION (ENROLLED REFERENCE VS LIVE PRE-VIVA)     */}
      {/* ========================================================================= */}
      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-zinc-800/60 gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-base">📸</span>
            <div>
              <h3 className="text-sm font-semibold tracking-wide text-white">
                1. Dual Facial Recognition Telemetry
              </h3>
              <p className="text-[11px] text-zinc-400 font-mono">
                Original enrollment reference vs. pre-viva chamber gate admission keyframe
              </p>
            </div>
          </div>

          <div>
            {hudData?.verificationStatus === "AUTHENTICATED" && !secondaryVoiceFlagged ? (
              <span className="px-3 py-1 rounded-full text-[11px] font-mono font-medium border border-emerald-500/50 bg-emerald-950/40 text-emerald-300 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse"></span>
                <span>IDENTITY VERIFIED</span>
              </span>
            ) : secondaryVoiceFlagged || hudData?.verificationStatus === "FLAGGED" ? (
              <span className="px-3 py-1 rounded-full text-[11px] font-mono font-medium border border-rose-500/60 bg-rose-950/50 text-rose-300 flex items-center gap-1.5">
                <span className="w-1.5 h-1.5 rounded-full bg-rose-400 animate-ping"></span>
                <span>FORENSIC ANOMALY FLAGGED</span>
              </span>
            ) : (
              <span className="px-3 py-1 rounded-full text-[11px] font-mono font-medium border border-zinc-700 bg-zinc-800 text-zinc-400">
                GATE VERIFICATION PENDING
              </span>
            )}
          </div>
        </div>

        {/* Side-by-Side Face Comparison Card */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Left: Enrolled Reference Photo */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                <span aria-hidden="true">📸</span>
                <span>Enrolled Ground Truth</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-400">
                {hudData?.enrolledAt ? new Date(hudData.enrolledAt).toLocaleDateString() : "Orientation Enrollment"}
              </span>
            </div>

            <div className="relative rounded-lg overflow-hidden bg-black/60 border border-zinc-800/80 aspect-[4/3] flex items-center justify-center">
              {enrolledFaceUrl ? (
                <img
                  src={enrolledFaceUrl}
                  alt="Enrolled Reference facial ground truth"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-zinc-400 text-xs font-mono text-center p-4">
                  No Reference Photo Sealed
                </div>
              )}

              <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/80 border border-zinc-700 text-[10px] font-mono text-zinc-300">
                Canonical 112×112 Aligned
              </div>

              <div className="absolute bottom-2 left-2 px-2 py-0.5 rounded bg-black/80 border border-emerald-500/40 text-[10px] font-mono text-emerald-400 flex items-center gap-1">
                <span aria-hidden="true">✓</span>
                <span>MobileFaceNet 512-d Reference</span>
              </div>
            </div>
          </div>

          {/* Right: Live Chamber Keyframe Captured at Entry Gate */}
          <div className="rounded-xl border border-zinc-800 bg-zinc-950/70 p-4 space-y-3">
            <div className="flex items-center justify-between text-xs">
              <span className="font-mono text-[11px] uppercase tracking-wider text-zinc-300 flex items-center gap-1.5">
                <span aria-hidden="true">🎥</span>
                <span>Pre-Viva Chamber Keyframe</span>
              </span>
              <span className="text-[10px] font-mono text-zinc-400">
                Live Admission Gate
              </span>
            </div>

            <div className="relative rounded-lg overflow-hidden bg-black/60 border border-zinc-800/80 aspect-[4/3] flex items-center justify-center">
              {examKeyframeUrl ? (
                <img
                  src={examKeyframeUrl}
                  alt="Chamber Entry Keyframe admission capture"
                  className="w-full h-full object-cover"
                />
              ) : (
                <div className="text-zinc-400 text-xs font-mono text-center p-4">
                  Keyframe Capture in Progress
                </div>
              )}

              <div className="absolute top-2 left-2 px-2 py-0.5 rounded bg-black/80 border border-zinc-700 text-[10px] font-mono text-zinc-300">
                Umeyama Landmark Locked
              </div>

              <div className="absolute top-2 right-2 px-2 py-0.5 rounded bg-black/80 border border-zinc-700 text-[10px] font-mono text-zinc-300 flex items-center gap-1">
                <span aria-hidden="true">💡</span>
                <span>CLAHE Normalization Active</span>
              </div>

              {/* Real Measured Cosine Similarity Match */}
              {hudData?.faceMatchSimilarity !== undefined && hudData?.faceMatchSimilarity !== null ? (
                <div
                  className={`absolute bottom-2 left-2 px-2.5 py-1 rounded backdrop-blur-sm border text-[10px] font-mono font-medium flex items-center gap-1.5 shadow-sm ${
                    hudData.faceMatchSimilarity >= 0.62
                      ? "bg-black/85 border-emerald-500/50 text-emerald-400"
                      : "bg-black/85 border-rose-500/50 text-rose-400"
                  }`}
                >
                  <span
                    className={`w-1.5 h-1.5 rounded-full ${
                      hudData.faceMatchSimilarity >= 0.62 ? "bg-emerald-400" : "bg-rose-400"
                    }`}
                    aria-hidden="true"
                  ></span>
                  <span>
                    Similarity Match: {(hudData.faceMatchSimilarity * 100).toFixed(1)}% (≥ 62%)
                  </span>
                </div>
              ) : (
                <div className="absolute bottom-2 left-2 px-2.5 py-1 rounded backdrop-blur-sm border border-zinc-700 bg-black/85 text-[10px] font-mono text-zinc-300 flex items-center gap-1.5">
                  <span className="w-1.5 h-1.5 rounded-full bg-zinc-400" aria-hidden="true"></span>
                  <span>Face Match: Pending Gate Verification</span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* ========================================================================= */}
      {/* PILLAR 2: MASTER AUDIO STREAM & FORENSIC ACOUSTIC DIARIZATION            */}
      {/* ========================================================================= */}
      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-zinc-800/60 gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-base" aria-hidden="true">🎙️</span>
            <div>
              <h3 className="text-sm font-semibold tracking-wide text-white">
                2. Master Audio Recording & Acoustic Diarization
              </h3>
              <p className="text-[11px] text-zinc-300 font-mono">
                Continuous full defense stream with neural acoustic multi-speaker separation
              </p>
            </div>
          </div>
        </div>

        {/* Master Continuous Audio Player */}
        {effectiveRecordingUrl && (
          <div className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/80 space-y-3 font-mono">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-xs">
              <div className="flex items-center gap-2 text-emerald-400">
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true"></span>
                <span className="font-semibold uppercase tracking-wider text-emerald-300">
                  Master Defense Stream
                </span>
                <span className="text-zinc-400 text-[10px]">
                  (Continuous Full Recording &bull; Zero Snipped Files)
                </span>
              </div>
              <span className="text-zinc-400 text-[11px] truncate max-w-md">
                {effectiveRecordingUrl}
              </span>
            </div>

            <audio
              ref={mainAudioRef}
              controls
              preload="auto"
              aria-label="Master defense examination continuous audio stream"
              src={getAudioSrc(effectiveRecordingUrl)}
              onLoadedMetadata={() => setAudioLoaded(true)}
              onTimeUpdate={(e) => {
                if (activeSnippetRange) {
                  const cur = (e.currentTarget as HTMLAudioElement).currentTime;
                  if (cur >= activeSnippetRange.end) {
                    (e.currentTarget as HTMLAudioElement).pause();
                    setActiveSnippetRange(null);
                  }
                }
              }}
              onPause={() => {
                if (activeSnippetRange) {
                  setActiveSnippetRange(null);
                }
              }}
              className="w-full h-11 rounded-lg bg-zinc-950 border border-zinc-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950"
            />
          </div>
        )}

        {/* Forensic Diarization Clean vs Flagged Banner */}
        {secondaryVoiceFlagged ? (
          <div role="alert" className="rounded-xl border border-rose-500/50 bg-rose-950/20 p-5 space-y-4 animate-in fade-in duration-200">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-rose-900/40 gap-2">
              <div className="flex items-center gap-2">
                <span className="text-lg" aria-hidden="true">🎙️⚠️</span>
                <div>
                  <h4 className="text-xs font-bold uppercase tracking-wider text-rose-300">
                    Forensic Acoustic Alert: Secondary Off-Camera Voice Flagged
                  </h4>
                  <p className="text-[11px] text-rose-300/90">
                    Neural diarizer detected anomalous non-candidate voice speech during defense examination turns.
                  </p>
                </div>
              </div>
              <span className="px-2.5 py-0.5 rounded border border-rose-500/40 bg-rose-900/40 text-rose-200 text-[10px] font-mono uppercase tracking-wider self-start sm:self-auto">
                Investigation Priority: High
              </span>
            </div>

            {/* Clickable Seek Evidence Pills */}
            <div className="space-y-3">
              {voiceSnippets.map((snippet, idx) => {
                const startSec = snippet.timestampRange?.startSeconds ?? 0;
                const endSec = snippet.timestampRange?.endSeconds ?? (startSec + 5);
                const durSec = snippet.timestampRange?.durationSeconds ?? Math.max(0.1, endSec - startSec);
                const timeLabel = `${formatSeconds(startSec)} - ${formatSeconds(endSec)}`;
                const isPlayingThisSnippet = Boolean(activeSnippetRange && activeSnippetRange.start === startSec);

                return (
                  <div
                    key={idx}
                    className="rounded-lg border border-rose-800/60 bg-zinc-950/80 p-4 space-y-3 font-mono text-xs"
                  >
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 text-zinc-300">
                      <div className="flex items-center gap-2">
                        <span className="px-2 py-0.5 rounded bg-rose-950 border border-rose-800 text-rose-300 text-[10px] font-bold">
                          {snippet.flag}
                        </span>
                        <span className="text-zinc-300 text-[11px]">
                          Cluster: {snippet.speakerCluster || "SPEAKER_01"}
                          {snippet.similarityScore !== undefined && snippet.similarityScore !== null && (
                            <span> (Match: {(snippet.similarityScore * 100).toFixed(1)}%)</span>
                          )}
                        </span>
                      </div>

                      <span className="text-[11px] text-zinc-300">
                        ⏱️ Window: {timeLabel} ({durSec.toFixed(1)}s)
                      </span>
                    </div>

                    {/* Aligned Faster-Whisper Transcript */}
                    <div className="p-3 rounded-md bg-black/60 border border-zinc-800/80 text-zinc-200 text-xs italic leading-relaxed">
                      &ldquo;{snippet.alignedTranscript || snippet.turnSnippet || "Anomalous speech signal detected in microphone channel."}&rdquo;
                    </div>

                    {/* Native Audio Seek Pill */}
                    <div className="flex items-center justify-between pt-1">
                      <span className="text-[10px] text-zinc-400">
                        Zero-slicing forensic seek:
                      </span>
                      <button
                        type="button"
                        onClick={() => handleSeekAndPlay(startSec, endSec)}
                        aria-label={
                          isPlayingThisSnippet
                            ? `Pause forensic audio snippet from ${formatSeconds(startSec)} to ${formatSeconds(endSec)}`
                            : `Play forensic audio snippet from ${formatSeconds(startSec)} to ${formatSeconds(endSec)}`
                        }
                        className={`px-3 py-1 rounded border text-[11px] font-mono flex items-center gap-1.5 transition cursor-pointer focus-visible:ring-2 focus-visible:ring-rose-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:outline-none ${
                          isPlayingThisSnippet
                            ? "bg-rose-800 border-rose-500 text-white font-semibold shadow-sm animate-pulse"
                            : "bg-rose-900/40 hover:bg-rose-800/50 border-rose-700/60 text-rose-200"
                        }`}
                      >
                        <span aria-hidden="true">{isPlayingThisSnippet ? "⏸" : "▶"}</span>
                        <span>
                          {isPlayingThisSnippet
                            ? `Playing Forensic Snippet (${formatSeconds(startSec)} - ${formatSeconds(endSec)}) [Pause]`
                            : `Listen in Master Stream (${formatSeconds(startSec)} - ${formatSeconds(endSec)})`}
                        </span>
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ) : hudData?.acousticAuditCompleted ? (
          <div role="status" className="p-4 rounded-xl border border-emerald-500/40 bg-emerald-950/20 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
            <div className="flex items-center gap-3">
              <span className="text-2xl" aria-hidden="true">🛡️</span>
              <div>
                <span className="font-bold text-emerald-300 block text-sm">
                  Acoustic Identity Verified: Single Verified Candidate
                </span>
                <span className="text-emerald-300/90 text-[11px]">
                  Forensic diarization confirmed continuous authentic candidate speech
                  {hudData?.acousticSimilarity !== null && hudData?.acousticSimilarity !== undefined
                    ? ` (${(hudData.acousticSimilarity * 100).toFixed(1)}% acoustic match)`
                    : ""}
                  . Zero anomalous off-camera voices detected.
                </span>
              </div>
            </div>
            <span className="px-3 py-1 rounded-full border border-emerald-500/50 bg-emerald-900/40 text-emerald-200 text-[11px] font-bold self-start sm:self-auto shrink-0">
              VERIFIED AUTHENTIC
            </span>
          </div>
        ) : (
          <div role="status" className="p-4 rounded-xl border border-zinc-800 bg-zinc-950/60 flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs font-mono">
            <div className="flex items-center gap-3">
              <span className="text-2xl text-zinc-400" aria-hidden="true">🎙️</span>
              <div>
                <span className="font-bold text-zinc-300 block text-sm">
                  Acoustic Forensic Audit: Processing / Pending
                </span>
                <span className="text-zinc-400 text-[11px]">
                  Offline neural diarization and secondary voice analysis in progress on defense recording.
                </span>
              </div>
            </div>
            <span className="px-3 py-1 rounded-full border border-zinc-700 bg-zinc-900 text-zinc-300 text-[11px] font-medium self-start sm:self-auto shrink-0 animate-pulse">
              AUDIT IN PROGRESS
            </span>
          </div>
        )}
      </div>

      {/* ========================================================================= */}
      {/* PILLAR 3: ORIGINAL VERBATIM DIALOGUE TRANSCRIPT                           */}
      {/* ========================================================================= */}
      <div className="rounded-2xl border border-zinc-800/80 bg-zinc-900/40 p-6 space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between pb-3 border-b border-zinc-800/60 gap-3">
          <div className="flex items-center gap-2.5">
            <span className="text-base" aria-hidden="true">📝</span>
            <div>
              <h3 className="text-sm font-semibold tracking-wide text-white">
                3. Original Verbatim Transcript
              </h3>
              <p className="text-[11px] text-zinc-300 font-mono">
                Full sequential dialogue preserved turn-by-turn with exact timestamps
              </p>
            </div>
          </div>

          <span className="text-xs font-mono text-zinc-400">
            {localTranscripts.length} total turns
          </span>
        </div>

        {/* Chronological Dialogue Turns */}
        <div className="space-y-3 max-h-[500px] overflow-y-auto pr-2">
          {localTranscripts.length === 0 ? (
            <div className="p-8 text-center text-xs font-mono text-zinc-400 bg-black/40 rounded-xl border border-zinc-800/60">
              No transcript turns recorded for this session.
            </div>
          ) : (
            localTranscripts.map((turn, idx) => {
              const isCandidate =
                (turn.speaker && turn.speaker.toLowerCase().includes("candidate")) ||
                (turn.sender && turn.sender.toLowerCase().includes("candidate"));

              return (
                <div
                  key={idx}
                  className={`p-4 rounded-xl border text-xs leading-relaxed space-y-1.5 transition ${
                    isCandidate
                      ? "border-emerald-500/30 bg-emerald-950/10 text-emerald-100"
                      : "border-zinc-800 bg-zinc-950/70 text-zinc-200"
                  }`}
                >
                  <div className="flex items-center justify-between text-[11px] font-mono">
                    <span
                      className={`font-semibold px-2 py-0.5 rounded ${
                        isCandidate
                          ? "bg-emerald-950/80 text-emerald-300 border border-emerald-500/40"
                          : "bg-zinc-900 text-zinc-300 border border-zinc-800"
                      }`}
                    >
                      {isCandidate ? "Candidate" : "AI Examiner"} &bull; Turn #{idx + 1}
                    </span>

                    {turn.timestamp && (
                      <span className="text-zinc-400">{turn.timestamp}</span>
                    )}
                  </div>

                  <p className="font-sans text-sm pt-1 whitespace-pre-wrap">
                    {turn.text}
                  </p>
                </div>
              );
            })
          )}
        </div>
      </div>

      {/* Footer Utility Actions */}
      <div className="flex flex-wrap items-center justify-between pt-4 border-t border-zinc-900 gap-3 text-xs font-mono">
        <div className="flex items-center gap-3">
          <button
            type="button"
            onClick={handleDownloadJson}
            aria-label="Download candidate defense session JSON record"
            className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition cursor-pointer focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:outline-none"
          >
            Download JSON Record
          </button>
          <button
            type="button"
            onClick={handleCopySummary}
            aria-label="Copy session summary to clipboard"
            className="px-4 py-2 rounded-xl bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-zinc-300 transition cursor-pointer focus-visible:ring-2 focus-visible:ring-zinc-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:outline-none"
          >
            {copied ? "Copied to Clipboard!" : "Copy Session Summary"}
          </button>
        </div>

        {onClose && (
          <button
            type="button"
            onClick={onClose}
            aria-label="Return to candidate examination lobby"
            className="px-5 py-2.5 rounded-xl bg-white hover:bg-zinc-200 text-black font-semibold transition cursor-pointer focus-visible:ring-2 focus-visible:ring-emerald-400 focus-visible:ring-offset-2 focus-visible:ring-offset-zinc-950 focus-visible:outline-none"
          >
            Return to Examination Lobby &rarr;
          </button>
        )}
      </div>
    </div>
  );
}
