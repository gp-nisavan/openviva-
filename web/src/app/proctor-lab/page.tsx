"use client";

import React, { useRef, useEffect, useState, useCallback } from "react";
import { useMobileCLIP, HierarchicalClassResult } from "@/hooks/useMobileCLIP";

interface InfractionEvent {
  id: string;
  timestamp: string;
  label: string;
  score: number;
  bucketScore: number;
  snapshotUrl?: string;
}

export default function ProctorLabPage() {
  const { state, videoRef, startCamera, stopCamera } = useMobileCLIP();
  const [events, setEvents] = useState<InfractionEvent[]>([]);
  const [selectedSnapshot, setSelectedSnapshot] = useState<string | null>(null);
  const lastAlertTimeRef = useRef<number>(0);

  // Snapshot capture helper
  const captureSnapshot = useCallback((): string | undefined => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) return undefined;
    const canvas = document.createElement("canvas");
    canvas.width = video.videoWidth;
    canvas.height = video.videoHeight;
    const ctx = canvas.getContext("2d");
    if (!ctx) return undefined;
    ctx.drawImage(video, 0, 0);
    return canvas.toDataURL("image/jpeg", 0.85);
  }, [videoRef]);

  // Log infractions when sustained violation threshold is tripped
  useEffect(() => {
    if (state.isSustainedInfraction && state.activeThreat) {
      const now = performance.now();
      // Throttle logging to once every 4s per sustained event
      if (now - lastAlertTimeRef.current > 4000) {
        lastAlertTimeRef.current = now;
        const snap = captureSnapshot();
        const newEvent: InfractionEvent = {
          id: Math.random().toString(36).substring(2, 9),
          timestamp: new Date().toLocaleTimeString(),
          label: state.activeThreat.label,
          score: Math.round(state.activeThreat.score * 100),
          bucketScore: state.leakyBucketScore,
          snapshotUrl: snap,
        };
        setEvents((prev) => [newEvent, ...prev]);
      }
    }
  }, [state.isSustainedInfraction, state.activeThreat, state.leakyBucketScore, captureSnapshot]);

  const activeThreat = state.activeThreat;
  const bucketPercentage = Math.min(
    100,
    Math.round((state.leakyBucketScore / state.alertThreshold) * 100)
  );

  return (
    <div className="min-h-screen bg-zinc-950 text-zinc-100 p-6 md:p-10 font-sans relative">
      <div className="max-w-7xl mx-auto space-y-7">
        {/* Header */}
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-zinc-800 pb-5">
          <div>
            <div className="flex items-center gap-3">
              <div className="w-3.5 h-3.5 rounded-full bg-violet-500 animate-pulse" />
              <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
                MobileCLIP Hierarchical Proctor{" "}
                <span className="text-violet-400 font-mono text-xs px-2.5 py-1 border border-violet-500/30 rounded-full bg-violet-950/40">
                  PRE-SOFTMAX COSINE MARGIN + LEAKY BUCKET
                </span>
              </h1>
            </div>
            <p className="text-sm text-zinc-400 mt-1">
              Apple MobileCLIP-S0 (WebGPU) with Benign Absorber Classes, Relative Cosine Margin Gating & Micro-Glance Accumulation.
            </p>
          </div>

          {/* Telemetry Badges */}
          <div className="flex flex-wrap items-center gap-2 text-xs font-mono">
            <span
              className={`px-3 py-1 rounded-lg border font-semibold ${
                state.isReady
                  ? "bg-emerald-950/60 text-emerald-300 border-emerald-800"
                  : state.error
                  ? "bg-rose-950/60 text-rose-300 border-rose-800"
                  : "bg-amber-950/60 text-amber-300 border-amber-800"
              }`}
            >
              {state.isLoading
                ? "Loading Model..."
                : state.isReady
                ? "MobileCLIP-S0 Active"
                : state.error
                ? "Model Error"
                : "Initializing"}
            </span>

            {state.provider && (
              <span className="px-3 py-1 rounded-lg border bg-sky-950/60 text-sky-300 border-sky-800 font-semibold">
                Backend: {state.provider.toUpperCase()}
              </span>
            )}

            {state.isStreaming && (
              <>
                <span className="px-3 py-1 rounded-lg border bg-zinc-900 text-zinc-300 border-zinc-800">
                  Latency: {state.latencyMs} ms
                </span>
                <span className="px-3 py-1 rounded-lg border bg-zinc-900 text-zinc-300 border-zinc-800">
                  FPS: {state.fps}
                </span>
              </>
            )}
          </div>
        </div>

        {/* Environmental Lighting Warning (Non-Punitive) */}
        {state.lightingWarning && (
          <div className="p-4 rounded-2xl bg-amber-950/80 border border-amber-500/80 text-amber-200 text-sm flex items-center justify-between shadow-[0_0_25px_rgba(245,158,11,0.2)] animate-pulse">
            <div className="flex items-center gap-3">
              <span className="text-2xl">💡</span>
              <div>
                <h4 className="font-bold text-amber-100">ENVIRONMENTAL LIGHTING ISSUE DETECTED</h4>
                <p className="text-xs text-amber-300/90 mt-0.5">
                  Severe backlighting or dark silhouette detected. Please close the window blinds behind you or face an ambient light source.
                </p>
              </div>
            </div>
            <span className="text-[11px] font-mono px-2.5 py-1 rounded bg-amber-900 text-amber-100 uppercase font-semibold">
              Adjustment Needed
            </span>
          </div>
        )}

        {/* Sustained Violation Banner */}
        {state.isSustainedInfraction && activeThreat && (
          <div className="p-4 rounded-2xl bg-gradient-to-r from-rose-950/95 via-rose-900/80 to-zinc-950 border border-rose-500 shadow-[0_0_40px_rgba(244,63,94,0.4)] flex items-center justify-between animate-pulse">
            <div className="flex items-center gap-3">
              <span className="text-3xl">🚨</span>
              <div>
                <h3 className="font-bold text-base text-rose-100 flex items-center gap-2">
                  <span>SUSTAINED VIOLATION: {activeThreat.label.toUpperCase()}</span>
                  <span className="text-xs font-mono px-2.5 py-0.5 rounded bg-rose-800 text-white">
                    ΔCos: {activeThreat.cosineMargin >= 0 ? "+" : ""}{activeThreat.cosineMargin.toFixed(3)} (Req: +{activeThreat.minCosineMargin.toFixed(3)})
                  </span>
                  <span className="text-xs font-mono px-2 py-0.5 rounded bg-black/60 border border-rose-500/50 text-rose-300">
                    Bucket: {state.leakyBucketScore} / {state.alertThreshold}
                  </span>
                </h3>
                <p className="text-xs text-rose-200 mt-0.5">
                  Pre-softmax cosine margin exceeded continuously across temporal window. Evidence snapshot logged to audit dossier.
                </p>
              </div>
            </div>
            <span className="text-xs font-mono font-bold bg-rose-800 px-3.5 py-1.5 rounded-xl border border-rose-400 text-white uppercase tracking-wider">
              FLAGGED AUDIT
            </span>
          </div>
        )}

        {/* Main Grid: Viewport + Two Ontology Columns */}
        <div className="grid grid-cols-1 lg:grid-cols-12 gap-6">
          {/* Left Column: Viewport & Leaky Bucket Gauge (7 cols) */}
          <div className="lg:col-span-7 bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 flex flex-col items-center space-y-4">
            <div
              className={`relative w-full aspect-[4/3] max-w-[620px] bg-black rounded-xl overflow-hidden shadow-2xl flex items-center justify-center transition-all duration-300 border-2 ${
                state.isSustainedInfraction
                  ? "border-rose-500 shadow-[0_0_40px_rgba(244,63,94,0.4)]"
                  : state.gateStatus === "threat_gate_open"
                  ? "border-amber-500/80 shadow-[0_0_25px_rgba(245,158,11,0.25)]"
                  : state.isStreaming
                  ? "border-emerald-500/80 shadow-[0_0_20px_rgba(16,185,129,0.2)]"
                  : "border-zinc-800"
              }`}
            >
              <video
                ref={videoRef}
                playsInline
                muted
                className="absolute inset-0 w-full h-full object-cover transform -scale-x-100"
              />

              {/* Stage 1 Gate Status Overlay */}
              {state.isStreaming && (
                <div className="absolute top-3 inset-x-3 flex items-center justify-between z-20 pointer-events-none">
                  <div
                    className={`px-3.5 py-1.5 rounded-xl border text-xs font-mono font-bold flex items-center gap-2 shadow-lg backdrop-blur-md transition-all ${
                      state.gateStatus === "threat_gate_open"
                        ? "bg-rose-950/95 border-rose-500 text-rose-200"
                        : "bg-emerald-950/85 border-emerald-500/60 text-emerald-300"
                    }`}
                  >
                    <span
                      className={`w-2 h-2 rounded-full ${
                        state.gateStatus === "threat_gate_open"
                          ? "bg-rose-500 animate-ping"
                          : "bg-emerald-400"
                      }`}
                    />
                    <span>
                      {state.gateStatus === "threat_gate_open"
                        ? `STAGE 1: THREAT GATE OPEN (ΔCos: ${state.cosineMargin >= 0 ? "+" : ""}${state.cosineMargin.toFixed(3)} ≥ +${state.requiredMargin.toFixed(3)})`
                        : `STAGE 1: BENIGN SHIELD (ΔCos: ${state.cosineMargin >= 0 ? "+" : ""}${state.cosineMargin.toFixed(3)})`}
                    </span>
                  </div>

                  <span className="text-[11px] font-mono px-2.5 py-1 rounded-lg bg-zinc-950/80 border border-zinc-700 text-zinc-300">
                    Pre-Softmax Margin
                  </span>
                </div>
              )}

              {/* Inactive State Prompt */}
              {!state.isStreaming && (
                <div className="absolute inset-0 flex flex-col items-center justify-center bg-zinc-950/85 text-zinc-400 p-6 text-center">
                  <div className="w-16 h-16 rounded-full bg-zinc-900 flex items-center justify-center mb-4 border border-zinc-800">
                    <svg
                      className="w-8 h-8 text-zinc-500"
                      fill="none"
                      viewBox="0 0 24 24"
                      stroke="currentColor"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={1.5}
                        d="M15 10l4.553-2.276A1 1 0 0121 8.618v6.764a1 1 0 01-1.447.894L15 14M5 18h8a2 2 0 002-2V8a2 2 0 00-2-2H5a2 2 0 00-2 2v8a2 2 0 002 2z"
                      />
                    </svg>
                  </div>
                  <p className="font-semibold text-zinc-200">Webcam Inactive</p>
                  <p className="text-xs text-zinc-500 mt-1">
                    Click &quot;Start Camera&quot; to test hierarchical zero-shot semantic proctoring.
                  </p>
                </div>
              )}
            </div>

            {/* Leaky Bucket Accumulator Gauge */}
            <div className="w-full max-w-[620px] p-3.5 rounded-xl bg-zinc-950 border border-zinc-800 space-y-2">
              <div className="flex items-center justify-between text-xs font-mono">
                <span className="text-zinc-400 flex items-center gap-1.5">
                  <span>🪣 Leaky Bucket Temporal Accumulator</span>
                </span>
                <span
                  className={`font-bold ${
                    state.isSustainedInfraction
                      ? "text-rose-400 animate-pulse"
                      : state.leakyBucketScore > 5
                      ? "text-amber-400"
                      : "text-emerald-400"
                  }`}
                >
                  Score: {state.leakyBucketScore} / {state.alertThreshold} pts ({bucketPercentage}%)
                </span>
              </div>

              {/* Gauge Bar */}
              <div className="w-full h-3 rounded-full bg-zinc-900 overflow-hidden relative border border-zinc-800">
                {/* 15 pts alert line */}
                <div className="absolute right-0 top-0 bottom-0 w-0.5 bg-rose-500/80 z-10" />
                <div
                  className={`h-full rounded-full transition-all duration-150 ${
                    state.isSustainedInfraction
                      ? "bg-rose-500 animate-pulse"
                      : state.leakyBucketScore > 5
                      ? "bg-amber-500"
                      : "bg-emerald-500"
                  }`}
                  style={{ width: `${bucketPercentage}%` }}
                />
              </div>

              <div className="flex justify-between items-center text-[10px] text-zinc-500 font-mono">
                <span>Threat detected: +1.0/frame</span>
                <span>Normal behavior: -0.5/frame (decay)</span>
                <span>Threshold: 15 pts</span>
              </div>
            </div>

            {/* Controls */}
            <div className="w-full max-w-[620px] flex items-center justify-between gap-3 pt-1">
              <div>
                {!state.isStreaming ? (
                  <button
                    onClick={startCamera}
                    disabled={!state.isReady}
                    className="px-6 py-2.5 rounded-xl bg-violet-600 hover:bg-violet-500 text-white font-bold text-sm transition shadow-lg shadow-violet-600/20 disabled:opacity-50 disabled:cursor-not-allowed flex items-center gap-2"
                  >
                    <span>Start Camera</span>
                  </button>
                ) : (
                  <button
                    onClick={stopCamera}
                    className="px-5 py-2.5 rounded-xl bg-zinc-900 border border-zinc-700 hover:border-zinc-600 text-zinc-300 font-semibold text-sm transition"
                  >
                    Stop Camera
                  </button>
                )}
              </div>

              <div className="text-xs text-zinc-400 font-mono">
                Try <span className="text-emerald-400">drinking water</span>, <span className="text-cyan-400">looking up</span>, or <span className="text-rose-400">holding a phone</span>.
              </div>
            </div>
          </div>

          {/* Right Column: Group A (Benign) & Group B (Threat) Classes (5 cols) */}
          <div className="lg:col-span-5 space-y-5">
            {/* Group A: Benign Absorber Classes */}
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-emerald-400" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-emerald-300">
                    Group A: Benign Absorber Classes
                  </h2>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                  isThreat: false
                </span>
              </div>

              <div className="space-y-2">
                {state.benignClasses.map((cls) => {
                  const percentage = Math.round(cls.score * 100);
                  const isWinning = state.topClass?.id === cls.id;
                  return (
                    <div key={cls.id} className="space-y-1 font-mono text-xs">
                      <div className="flex justify-between items-center text-zinc-300">
                        <span className="flex items-center gap-1.5 truncate">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: cls.color }}
                          />
                          <span className={isWinning ? "font-bold text-white" : "font-normal"}>
                            {cls.label}
                          </span>
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-zinc-500">
                            Sim: {cls.cosineSim.toFixed(3)}
                          </span>
                          <span className="font-bold ml-1" style={{ color: cls.color }}>
                            {percentage}%
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-zinc-950 overflow-hidden border border-zinc-800/80">
                        <div
                          className="h-full rounded-full transition-all duration-150"
                          style={{
                            width: `${Math.max(2, percentage)}%`,
                            backgroundColor: cls.color,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Group B: Cheating Threat Classes */}
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-5 space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2.5">
                <div className="flex items-center gap-2">
                  <span className="w-2 h-2 rounded-full bg-rose-500 animate-pulse" />
                  <h2 className="text-xs font-bold uppercase tracking-wider text-rose-300">
                    Group B: Cheating Classes
                  </h2>
                </div>
                <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-zinc-800 text-zinc-400">
                  Pre-Softmax Relative Margin
                </span>
              </div>

              <div className="space-y-2.5">
                {state.threatClasses.map((cls) => {
                  const percentage = Math.round(cls.score * 100);
                  const isWinning = state.topClass?.id === cls.id;
                  const passesMargin = cls.cosineMargin >= cls.minCosineMargin;
                  const isActive = state.activeThreat?.id === cls.id;

                  return (
                    <div key={cls.id} className="space-y-1 font-mono text-xs">
                      <div className="flex justify-between items-center text-zinc-300">
                        <span className="flex items-center gap-1.5 truncate">
                          <span
                            className="w-2 h-2 rounded-full shrink-0"
                            style={{ backgroundColor: cls.color }}
                          />
                          <span className={isActive ? "font-bold text-rose-300" : isWinning ? "font-bold text-white" : "font-normal"}>
                            {cls.label}
                          </span>
                          {isActive && (
                            <span className="text-[9px] px-1.5 py-0.2 rounded bg-rose-950 border border-rose-500/80 text-rose-300 font-bold animate-pulse">
                              ACTIVE
                            </span>
                          )}
                        </span>
                        <div className="flex items-center gap-2">
                          <span className="text-[10px] text-zinc-500 font-mono">
                            ΔCos:{" "}
                            <span
                              className={`font-semibold ${
                                passesMargin
                                  ? "text-rose-400 font-bold"
                                  : cls.cosineMargin > 0
                                  ? "text-amber-400"
                                  : "text-zinc-500"
                              }`}
                            >
                              {cls.cosineMargin >= 0 ? "+" : ""}
                              {cls.cosineMargin.toFixed(3)}
                            </span>
                            <span className="text-zinc-600"> (min +{cls.minCosineMargin.toFixed(3)})</span>
                          </span>
                          <span
                            className={`font-bold ml-1 ${
                              passesMargin ? "text-rose-400" : "text-zinc-400"
                            }`}
                          >
                            {percentage}%
                          </span>
                        </div>
                      </div>
                      <div className="w-full h-1.5 rounded-full bg-zinc-950 overflow-hidden border border-zinc-800/80 relative">
                        <div
                          className="h-full rounded-full transition-all duration-150"
                          style={{
                            width: `${Math.max(2, percentage)}%`,
                            backgroundColor: cls.color,
                          }}
                        />
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>

            {/* Audit Dossier Log */}
            <div className="bg-zinc-900/60 border border-zinc-800 rounded-2xl p-4 space-y-3">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-2">
                <h3 className="text-xs font-bold uppercase tracking-wider text-zinc-400">
                  Verified Infraction Dossier ({events.length})
                </h3>
                {events.length > 0 && (
                  <button
                    onClick={() => setEvents([])}
                    className="text-[10px] text-zinc-500 hover:text-zinc-300 font-mono"
                  >
                    Clear
                  </button>
                )}
              </div>

              {events.length === 0 ? (
                <p className="text-xs text-zinc-500 font-mono italic">
                  No verified infractions. Micro-glances drain away; sustained threats trigger snapshot evidence.
                </p>
              ) : (
                <div className="space-y-2 max-h-[160px] overflow-y-auto pr-1">
                  {events.map((ev) => (
                    <div
                      key={ev.id}
                      className="p-2 rounded-xl bg-zinc-950 border border-rose-900/40 flex items-center justify-between text-xs font-mono"
                    >
                      <div className="flex items-center gap-2">
                        {ev.snapshotUrl ? (
                          <img
                            src={ev.snapshotUrl}
                            alt="Evidence"
                            className="w-9 h-9 object-cover rounded cursor-pointer border border-zinc-700 hover:opacity-80"
                            onClick={() => setSelectedSnapshot(ev.snapshotUrl!)}
                          />
                        ) : (
                          <div className="w-9 h-9 rounded bg-zinc-900 flex items-center justify-center text-[10px]">
                            📷
                          </div>
                        )}
                        <div>
                          <p className="font-bold text-rose-300">{ev.label}</p>
                          <p className="text-[10px] text-zinc-500">{ev.timestamp}</p>
                        </div>
                      </div>
                      <span className="font-bold text-rose-400">{ev.score}%</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* Full Snapshot Modal */}
      {selectedSnapshot && (
        <div
          className="fixed inset-0 z-50 bg-black/80 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setSelectedSnapshot(null)}
        >
          <div
            className="bg-zinc-900 border border-zinc-700 rounded-2xl max-w-xl w-full p-4 space-y-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex justify-between items-center border-b border-zinc-800 pb-2">
              <h3 className="font-bold text-sm text-zinc-200 font-mono">Infraction Visual Evidence</h3>
              <button
                onClick={() => setSelectedSnapshot(null)}
                className="text-zinc-400 hover:text-zinc-100 text-sm font-bold"
              >
                ✕
              </button>
            </div>
            <img
              src={selectedSnapshot}
              alt="Snapshot Full"
              className="w-full rounded-xl object-contain max-h-[60vh] border border-zinc-800"
            />
            <div className="flex justify-end">
              <button
                onClick={() => setSelectedSnapshot(null)}
                className="px-4 py-1.5 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-mono"
              >
                Close
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
