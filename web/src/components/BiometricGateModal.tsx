"use client";

import React, { useState, useRef, useEffect, useCallback } from "react";
import {
  acquireCameraWithRetry,
  releaseCameraStream,
  HARDWARE_UNBIND_BUFFER_MS,
} from "@/lib/cameraHandoff";

interface FaceTelemetry {
  faceDetected?: boolean;
  detectionScore?: number;
  faceBox?: [number, number, number, number];
  landmarks?: [number, number][];
  facesCount?: number;
  isLive?: boolean;
  livenessScore?: number;
  spoofType?: string | null;
  spoofProbabilities?: { real: number; print_attack: number; replay_attack: number };
  alignedSize?: [number, number];
  alignmentStatus?: string;
  illuminationStatus?: string;
  embeddingModel?: string;
  embeddingDim?: number;
  embeddingL2Norm?: number;
}

interface BiometricGateResult {
  verified: boolean;
  similarity: number;
  threshold: number;
  message: string;
  reason?: string;
  telemetry?: FaceTelemetry;
  livenessScore?: number;
  spoofType?: string;
}

interface BiometricGateModalProps {
  isOpen: boolean;
  regNo: string;
  studentName: string;
  authToken: string;
  sessionId?: string;
  onVerified: () => void;
  onCancel: () => void;
}

/**
 * Web Audio API synthesizer for clean, zero-dependency success chime.
 * Plays a pleasant two-tone ascending chime: C5 (523.25Hz) -> G5 (783.99Hz).
 */
function playSuccessChime() {
  try {
    const AudioCtx = window.AudioContext || (window as any).webkitAudioContext;
    if (!AudioCtx) return;
    const ctx = new AudioCtx();
    const now = ctx.currentTime;

    // Tone 1: C5 (523.25 Hz)
    const osc1 = ctx.createOscillator();
    const gain1 = ctx.createGain();
    osc1.type = "sine";
    osc1.frequency.setValueAtTime(523.25, now);
    gain1.gain.setValueAtTime(0.0001, now);
    gain1.gain.linearRampToValueAtTime(0.2, now + 0.04);
    gain1.gain.exponentialRampToValueAtTime(0.0001, now + 0.35);
    osc1.connect(gain1);
    gain1.connect(ctx.destination);
    osc1.start(now);
    osc1.stop(now + 0.35);

    // Tone 2: G5 (783.99 Hz)
    const osc2 = ctx.createOscillator();
    const gain2 = ctx.createGain();
    osc2.type = "sine";
    osc2.frequency.setValueAtTime(783.99, now + 0.12);
    gain2.gain.setValueAtTime(0.0001, now + 0.12);
    gain2.gain.linearRampToValueAtTime(0.25, now + 0.16);
    gain2.gain.exponentialRampToValueAtTime(0.0001, now + 0.7);
    osc2.connect(gain2);
    gain2.connect(ctx.destination);
    osc2.start(now + 0.12);
    osc2.stop(now + 0.7);
  } catch (err) {
    console.warn("Chime audio could not play:", err);
  }
}

export function BiometricGateModal({
  isOpen,
  regNo,
  studentName,
  authToken,
  sessionId,
  onVerified,
  onCancel,
}: BiometricGateModalProps) {
  const [cameraReady, setCameraReady] = useState<boolean>(false);
  const [cameraError, setCameraError] = useState<string | null>(null);
  const [verifying, setVerifying] = useState<boolean>(false);
  const [verifiedResult, setVerifiedResult] = useState<BiometricGateResult | null>(null);
  const [attempts, setAttempts] = useState<number>(0);
  const [isDark, setIsDark] = useState<boolean>(false);
  const [isTransitioning, setIsTransitioning] = useState<boolean>(false);
  const [transitionProgress, setTransitionProgress] = useState<number>(0);

  // Dynamic Oval Geometry & Face Alignment Tracking State
  const [ovalGeometry, setOvalGeometry] = useState<{
    cx: number;
    cy: number;
    rx: number;
    ry: number;
  }>({
    cx: 320,
    cy: 240,
    rx: 125,
    ry: 160,
  });
  const [isFaceAligned, setIsFaceAligned] = useState<boolean>(false);
  const [alignmentConfidence, setAlignmentConfidence] = useState<number>(0);

  const [srAnnouncement, setSrAnnouncement] = useState<string>(
    "Initializing camera feed. Please wait."
  );

  const videoRef = useRef<HTMLVideoElement | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const overlayCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const sampleCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const trackingIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const transitionTimerRef = useRef<NodeJS.Timeout | null>(null);
  const progressIntervalRef = useRef<NodeJS.Timeout | null>(null);
  const modalRef = useRef<HTMLDivElement | null>(null);
  const previousActiveElementRef = useRef<HTMLElement | null>(null);
  const verifyButtonRef = useRef<HTMLButtonElement | null>(null);

  const startCamera = useCallback(async () => {
    try {
      setCameraError(null);
      setSrAnnouncement("Initializing camera feed. Please allow camera permissions if prompted.");
      if (streamRef.current) {
        releaseCameraStream(videoRef.current, streamRef.current);
        streamRef.current = null;
      }
      const stream = await acquireCameraWithRetry({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
        audio: false,
      });
      streamRef.current = stream;
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        videoRef.current.onloadedmetadata = () => {
          videoRef.current?.play().catch(console.error);
          setCameraReady(true);
          setSrAnnouncement(
            "Camera feed active. Please center your face inside the framing guide and select Verify Identity."
          );
        };
      }
    } catch (err: any) {
      console.error("Camera access failed:", err);
      const errMsg = err.message || "Failed to access webcam. Please allow camera permissions in your browser.";
      setCameraError(errMsg);
      setSrAnnouncement(`Camera access error: ${errMsg}`);
    }
  }, []);

  const stopCamera = useCallback(() => {
    if (trackingIntervalRef.current) {
      clearInterval(trackingIntervalRef.current);
      trackingIntervalRef.current = null;
    }
    releaseCameraStream(videoRef.current, streamRef.current);
    streamRef.current = null;
    setCameraReady(false);
  }, []);

  // Real-time Face Tracking & Alignment Loop
  useEffect(() => {
    if (!isOpen || !cameraReady) {
      if (trackingIntervalRef.current) {
        clearInterval(trackingIntervalRef.current);
        trackingIntervalRef.current = null;
      }
      return;
    }

    // Create offscreen sampling canvas if not created
    if (!sampleCanvasRef.current) {
      const c = document.createElement("canvas");
      c.width = 160;
      c.height = 120;
      sampleCanvasRef.current = c;
    }

    let consecutiveCenteredFrames = 0;
    const faceDetectorSupported = typeof window !== "undefined" && "FaceDetector" in window;
    let detector: any = null;
    if (faceDetectorSupported) {
      try {
        detector = new (window as any).FaceDetector({ fastMode: true, maxDetectedFaces: 1 });
      } catch (e) {
        detector = null;
      }
    }

    trackingIntervalRef.current = setInterval(async () => {
      const video = videoRef.current;
      if (!video || video.readyState < 2) return;

      try {
        if (detector) {
          const faces = await detector.detect(video);
          if (faces && faces.length > 0) {
            const f = faces[0].boundingBox;
            const videoW = video.videoWidth || 640;
            const videoH = video.videoHeight || 480;

            // Video is CSS scale-x-[-1], so invert X center coordinate
            const rawCenterX = f.x + f.width / 2;
            const rawCenterY = f.y + f.height / 2;
            const mirroredCenterX = (videoW - rawCenterX) * (640 / videoW);
            const mirroredCenterY = rawCenterY * (480 / videoH);

            const targetRx = Math.max(105, Math.min(150, (f.width * (640 / videoW)) * 0.75));
            const targetRy = Math.max(135, Math.min(190, (f.height * (480 / videoH)) * 0.95));

            // Smoothly ease oval coordinates
            setOvalGeometry((prev) => ({
              cx: Math.round(prev.cx + (mirroredCenterX - prev.cx) * 0.35),
              cy: Math.round(prev.cy + (mirroredCenterY - prev.cy) * 0.35),
              rx: Math.round(prev.rx + (targetRx - prev.rx) * 0.35),
              ry: Math.round(prev.ry + (targetRy - prev.ry) * 0.35),
            }));

            // Check if face is centered within tolerance (within 70px of screen center)
            const distFromCenter = Math.hypot(mirroredCenterX - 320, mirroredCenterY - 240);
            const isGoodSize = f.width > 90 && f.width < 340;
            if (distFromCenter < 75 && isGoodSize) {
              consecutiveCenteredFrames = Math.min(10, consecutiveCenteredFrames + 1);
            } else {
              consecutiveCenteredFrames = Math.max(0, consecutiveCenteredFrames - 1);
            }

            const aligned = consecutiveCenteredFrames >= 3;
            setIsFaceAligned(aligned);
            setAlignmentConfidence(Math.min(1, consecutiveCenteredFrames / 5));
            return;
          }
        }

        // Fallback: Real-time sampling via offscreen canvas
        const sCanvas = sampleCanvasRef.current;
        if (!sCanvas) return;
        const sCtx = sCanvas.getContext("2d", { willReadFrequently: true });
        if (!sCtx) return;

        sCtx.drawImage(video, 0, 0, 160, 120);
        const imgData = sCtx.getImageData(0, 0, 160, 120);
        const data = imgData.data;

        // Compute central luminance and presence
        let centerLuma = 0;
        let edgeLuma = 0;
        let centerPixels = 0;
        let edgePixels = 0;

        for (let y = 0; y < 120; y += 4) {
          for (let x = 0; x < 160; x += 4) {
            const idx = (y * 160 + x) * 4;
            const luma = 0.299 * data[idx] + 0.587 * data[idx + 1] + 0.114 * data[idx + 2];
            const isCenter = x >= 50 && x <= 110 && y >= 30 && y <= 90;
            if (isCenter) {
              centerLuma += luma;
              centerPixels++;
            } else {
              edgeLuma += luma;
              edgePixels++;
            }
          }
        }

        const avgCenter = centerLuma / Math.max(1, centerPixels);
        const avgEdge = edgeLuma / Math.max(1, edgePixels);
        const contrast = Math.abs(avgCenter - avgEdge);

        // Subtle breathing animation when waiting for face
        const timeNow = Date.now() / 800;
        const breathX = Math.sin(timeNow) * 2;
        const breathY = Math.cos(timeNow) * 2;

        setOvalGeometry((prev) => ({
          cx: Math.round(prev.cx + (320 - prev.cx) * 0.15),
          cy: Math.round(prev.cy + (240 - prev.cy) * 0.15),
          rx: Math.round(125 + breathX),
          ry: Math.round(160 + breathY),
        }));

        // A valid face presence is indicated by adequate central brightness (above 40)
        // and contrast differential from background
        if (avgCenter > 42 && avgCenter < 240) {
          consecutiveCenteredFrames = Math.min(8, consecutiveCenteredFrames + 1);
        } else {
          consecutiveCenteredFrames = Math.max(0, consecutiveCenteredFrames - 1);
        }

        const aligned = consecutiveCenteredFrames >= 2;
        setIsFaceAligned(aligned);
        setAlignmentConfidence(Math.min(1, consecutiveCenteredFrames / 4));
      } catch (e) {
        // Non-blocking fallback
        setIsFaceAligned(true);
      }
    }, 140);

    return () => {
      if (trackingIntervalRef.current) {
        clearInterval(trackingIntervalRef.current);
        trackingIntervalRef.current = null;
      }
    };
  }, [isOpen, cameraReady]);

  // Reticle overlay
  const drawReticleOverlay = useCallback((telem?: FaceTelemetry, isVerified?: boolean) => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    ctx.clearRect(0, 0, canvas.width, canvas.height);
    if (!telem || !telem.faceBox) return;

    const [rawX1, rawY1, rawX2, rawY2] = telem.faceBox;
    const videoW = 640;
    const videoH = 480;

    const x1 = (videoW - rawX2) * (canvas.width / videoW);
    const x2 = (videoW - rawX1) * (canvas.width / videoW);
    const y1 = rawY1 * (canvas.height / videoH);
    const y2 = rawY2 * (canvas.height / videoH);
    const boxW = x2 - x1;
    const boxH = y2 - y1;

    const color = isVerified ? "#10b981" : "#f43f5e";
    const shadowColor = isVerified ? "rgba(16, 185, 129, 0.6)" : "rgba(244, 63, 94, 0.6)";

    const bracketLen = Math.min(24, Math.min(boxW, boxH) * 0.25);
    ctx.lineWidth = 3;
    ctx.strokeStyle = color;
    ctx.shadowColor = shadowColor;
    ctx.shadowBlur = 8;
    ctx.lineCap = "round";

    ctx.beginPath();
    ctx.moveTo(x1, y1 + bracketLen);
    ctx.lineTo(x1, y1);
    ctx.lineTo(x1 + bracketLen, y1);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2 - bracketLen, y1);
    ctx.lineTo(x2, y1);
    ctx.lineTo(x2, y1 + bracketLen);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x1, y2 - bracketLen);
    ctx.lineTo(x1, y2);
    ctx.lineTo(x1 + bracketLen, y2);
    ctx.stroke();

    ctx.beginPath();
    ctx.moveTo(x2 - bracketLen, y2);
    ctx.lineTo(x2, y2);
    ctx.lineTo(x2, y2 - bracketLen);
    ctx.stroke();

    if (telem.landmarks && Array.isArray(telem.landmarks)) {
      telem.landmarks.forEach(([rawKpx, rawKpy]) => {
        const kpx = (videoW - rawKpx) * (canvas.width / videoW);
        const kpy = rawKpy * (canvas.height / videoH);

        ctx.beginPath();
        ctx.arc(kpx, kpy, 3.5, 0, 2 * Math.PI);
        ctx.fillStyle = isVerified ? "#34d399" : "#fb7185";
        ctx.shadowColor = shadowColor;
        ctx.shadowBlur = 6;
        ctx.fill();
      });
    }
  }, []);

  const clearReticle = useCallback(() => {
    const canvas = overlayCanvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (ctx) ctx.clearRect(0, 0, canvas.width, canvas.height);
  }, []);

  useEffect(() => {
    if (isOpen) {
      setVerifiedResult(null);
      setAttempts(0);
      setIsTransitioning(false);
      setTransitionProgress(0);
      setIsFaceAligned(false);
      startCamera();
    } else {
      stopCamera();
      clearReticle();
    }
    return () => {
      stopCamera();
      clearReticle();
      if (transitionTimerRef.current) clearTimeout(transitionTimerRef.current);
      if (progressIntervalRef.current) clearInterval(progressIntervalRef.current);
    };
  }, [isOpen, startCamera, stopCamera, clearReticle]);

  // Clean transition handoff upon biometric verification
  const handleStartTransition = useCallback(() => {
    setIsTransitioning(true);
    playSuccessChime();

    const startTime = Date.now();
    const duration = 1000;

    progressIntervalRef.current = setInterval(() => {
      const elapsed = Date.now() - startTime;
      const pct = Math.min(100, (elapsed / duration) * 100);
      setTransitionProgress(pct);
      if (pct >= 100 && progressIntervalRef.current) {
        clearInterval(progressIntervalRef.current);
        progressIntervalRef.current = null;
      }
    }, 40);

    transitionTimerRef.current = setTimeout(() => {
      stopCamera();
      setTimeout(() => {
        onVerified();
      }, HARDWARE_UNBIND_BUFFER_MS);
    }, duration);
  }, [onVerified, stopCamera]);

  // Capture frame and submit to backend verification
  const handleCaptureAndVerify = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth) {
      setCameraError("Camera stream not ready. Please wait a moment.");
      return;
    }

    try {
      setVerifying(true);
      setCameraError(null);
      clearReticle();

      const canvas = document.createElement("canvas");
      canvas.width = 640;
      canvas.height = 480;
      const ctx = canvas.getContext("2d");
      if (!ctx) throw new Error("Could not initialize canvas context");

      // Flip horizontally to match standard facial orientation
      ctx.translate(640, 0);
      ctx.scale(-1, 1);
      ctx.drawImage(video, 0, 0, 640, 480);

      const liveFrameBase64 = canvas.toDataURL("image/jpeg", 0.92);

      const basePath = process.env.NEXT_PUBLIC_BASE_PATH || "/openviva";
      const endpoints = [`${basePath}/api/auth/verify-gate`, "/api/auth/verify-gate"];
      let res: Response | null = null;
      let lastErr: Error | null = null;

      for (const ep of endpoints) {
        try {
          res = await fetch(ep, {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              Authorization: `Bearer ${authToken}`,
            },
            body: JSON.stringify({
              regNo,
              liveFrameBase64,
              sessionId,
            }),
          });
          if (res.status !== 404) break;
        } catch (err: any) {
          lastErr = err;
        }
      }

      if (!res) throw lastErr || new Error("Failed to connect to verification gate service.");

      const data: BiometricGateResult = await res.json();
      setAttempts((prev) => prev + 1);

      if (!res.ok) {
        const anomalyResult: BiometricGateResult = {
          verified: false,
          similarity: 0,
          threshold: 0.62,
          reason: data.reason || "VALIDATION_FAILED",
          message: data.message || (data as any).error || "Biometric validation check failed.",
          livenessScore: data.livenessScore,
          spoofType: data.spoofType,
        };
        setVerifiedResult(anomalyResult);
        drawReticleOverlay(data.telemetry, false);
        return;
      }

      setVerifiedResult(data);
      drawReticleOverlay(data.telemetry, data.verified);

      if (data.verified) {
        handleStartTransition();
      }
    } catch (err: any) {
      console.error("Biometric gate error:", err);
      setCameraError(err.message || "Failed to complete identity verification.");
    } finally {
      setVerifying(false);
    }
  };

  if (!isOpen) return null;

  const isVerified = verifiedResult?.verified === true;
  const isFailed = verifiedResult !== null && !verifiedResult.verified;
  const matchPercent = verifiedResult?.similarity ? verifiedResult.similarity * 100 : 0;
  const thresholdPercent = (verifiedResult?.threshold ?? 0.62) * 100;

  return (
    <div
      role="region"
      aria-label="Biometric Identity Gate Dialog"
      className="fixed inset-0 z-50 flex items-center justify-center p-4 font-sans text-white bg-black/85 backdrop-blur-md animate-in fade-in duration-200"
    >
      {/* Background Architectural Watermark & Atmosphere */}
      <div className="absolute inset-0 pointer-events-none overflow-hidden z-0 opacity-40">
        <div className="absolute top-12 left-12 space-y-2">
          <div className="text-[10px] font-mono tracking-widest text-zinc-500 uppercase flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-purple-500"></span>
            <span>CHAMBER STATION</span>
          </div>
          <h1 className="text-3xl sm:text-4xl font-black tracking-tight text-white">
            Oral defense <span className="text-purple-400">chamber.</span>
          </h1>
          <p className="text-xs text-zinc-400 font-mono">
            Verify your identity and enter the live defense session.
          </p>
        </div>
      </div>

      {/* Main Glass Identity Gate Container matching Mockup */}
      <div
        ref={modalRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="biometric-gate-title"
        aria-describedby="biometric-gate-description"
        tabIndex={-1}
        className="relative z-10 w-full max-w-2xl sm:max-w-3xl bg-[#0b0c12]/95 border border-purple-500/40 rounded-3xl p-5 sm:p-7 space-y-5 shadow-[0_0_60px_-15px_rgba(168,85,247,0.25)] outline-none backdrop-blur-xl animate-in zoom-in-95 duration-200"
      >
        {/* ARIA Announcements */}
        <div className="sr-only" aria-live="polite" role="status" aria-atomic="true">
          {srAnnouncement}
        </div>

        {/* Modal Header */}
        <div className="flex items-center justify-between pb-1">
          <div>
            <div className="flex items-center gap-2">
              <span className="w-2.5 h-2.5 rounded-full bg-emerald-400 animate-pulse" aria-hidden="true" />
              <h2 id="biometric-gate-title" className="text-lg sm:text-xl font-bold tracking-tight text-white">
                Pre-Viva Identity Gate
              </h2>
            </div>
            <p id="biometric-gate-description" className="text-xs text-zinc-400 font-mono mt-0.5">
              Neural facial alignment & anti-spoof liveness telemetry.
            </p>
          </div>

          <div className="text-right">
            <span className="inline-block text-xs font-mono font-bold px-3 py-1 rounded-lg bg-zinc-900/90 border border-zinc-800 text-zinc-200 tracking-wider">
              {regNo.toUpperCase()}
            </span>
            <div className="text-[11px] font-mono text-zinc-500 mt-1">
              {studentName || regNo.toLowerCase()}
            </div>
          </div>
        </div>

        {/* Real-time Camera Viewfinder with Overlay Interactions */}
        <div className="relative aspect-[16/10] sm:aspect-[16/10] bg-zinc-950 rounded-2xl overflow-hidden border border-zinc-800/90 flex items-center justify-center shadow-2xl">
          {/* 1. Genuine Real-time Camera Stream */}
          <video
            ref={videoRef}
            playsInline
            muted
            aria-label="Live camera feed for biometric facial verification"
            className="w-full h-full object-cover scale-x-[-1]"
          />

          {/* Interactive HTML5 Canvas Overlay for regressed neural landmarks */}
          <canvas
            ref={overlayCanvasRef}
            width={640}
            height={480}
            aria-hidden="true"
            className="absolute inset-0 w-full h-full pointer-events-none z-10"
          />

          {/* 2. Interactive Dashed Framing Oval (Adapts to Face & Turns Green on Success) */}
          <svg
            viewBox="0 0 640 480"
            aria-hidden="true"
            className="absolute inset-0 w-full h-full pointer-events-none z-20"
          >
            <defs>
              <filter id="emeraldGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="8" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
              <filter id="violetGlow" x="-20%" y="-20%" width="140%" height="140%">
                <feGaussianBlur stdDeviation="6" result="blur" />
                <feMerge>
                  <feMergeNode in="blur" />
                  <feMergeNode in="SourceGraphic" />
                </feMerge>
              </filter>
            </defs>

            {/* Subtle Vignette Mask Outside Oval */}
            <path
              d={`M 0 0 L 640 0 L 640 480 L 0 480 Z M ${ovalGeometry.cx} ${ovalGeometry.cy - ovalGeometry.ry} 
                  C ${ovalGeometry.cx - ovalGeometry.rx * 0.55} ${ovalGeometry.cy - ovalGeometry.ry} 
                    ${ovalGeometry.cx - ovalGeometry.rx} ${ovalGeometry.cy - ovalGeometry.ry * 0.55} 
                    ${ovalGeometry.cx - ovalGeometry.rx} ${ovalGeometry.cy} 
                  C ${ovalGeometry.cx - ovalGeometry.rx} ${ovalGeometry.cy + ovalGeometry.ry * 0.55} 
                    ${ovalGeometry.cx - ovalGeometry.rx * 0.55} ${ovalGeometry.cy + ovalGeometry.ry} 
                    ${ovalGeometry.cx} ${ovalGeometry.cy + ovalGeometry.ry} 
                  C ${ovalGeometry.cx + ovalGeometry.rx * 0.55} ${ovalGeometry.cy + ovalGeometry.ry} 
                    ${ovalGeometry.cx + ovalGeometry.rx} ${ovalGeometry.cy + ovalGeometry.ry * 0.55} 
                    ${ovalGeometry.cx + ovalGeometry.rx} ${ovalGeometry.cy} 
                  C ${ovalGeometry.cx + ovalGeometry.rx} ${ovalGeometry.cy - ovalGeometry.ry * 0.55} 
                    ${ovalGeometry.cx + ovalGeometry.rx * 0.55} ${ovalGeometry.cy - ovalGeometry.ry} 
                    ${ovalGeometry.cx} ${ovalGeometry.cy - ovalGeometry.ry} Z`}
              fill="rgba(0, 0, 0, 0.28)"
              fillRule="evenodd"
              className="transition-all duration-300 ease-out"
            />

            {/* The Dynamic Dashed Oval Guide */}
            <ellipse
              cx={ovalGeometry.cx}
              cy={ovalGeometry.cy}
              rx={ovalGeometry.rx}
              ry={ovalGeometry.ry}
              fill="none"
              stroke={
                isVerified
                  ? "#10b981"
                  : isFailed
                  ? "#f43f5e"
                  : isFaceAligned
                  ? "#34d399"
                  : "rgba(255, 255, 255, 0.75)"
              }
              strokeWidth={isVerified ? "3.5" : "2"}
              strokeDasharray={isVerified ? "none" : "9 7"}
              filter={
                isVerified
                  ? "url(#emeraldGlow)"
                  : isFaceAligned
                  ? "url(#emeraldGlow)"
                  : undefined
              }
              className="transition-all duration-300 ease-out"
            />
          </svg>

          {/* 3. Subtle Violet Liveness Scanning Line (Moves Vertically Across Live Video) */}
          <div className="absolute inset-x-0 h-0.5 bg-gradient-to-r from-transparent via-purple-400 to-transparent shadow-[0_0_15px_rgba(168,85,247,0.95)] pointer-events-none z-20 animate-liveness-laser" />
          <div className="absolute inset-x-0 h-10 -translate-y-5 bg-gradient-to-b from-purple-500/0 via-purple-500/10 to-purple-500/0 pointer-events-none z-10 animate-liveness-laser" />

          {/* 4. Top Overlay Controls: ● Live pill & Alignment Status */}
          <div className="absolute top-4 inset-x-4 flex items-center justify-between pointer-events-none z-30">
            {/* Live Indicator Pill */}
            <div className="px-3 py-1 rounded-full bg-zinc-950/75 backdrop-blur-md border border-zinc-700/60 text-zinc-300 text-xs font-mono flex items-center gap-2 shadow-lg">
              <span className="w-2 h-2 rounded-full bg-purple-500 animate-pulse" />
              <span>Live</span>
            </div>

            {/* Dynamic Alignment Status Pill */}
            {isVerified ? (
              <div className="px-3.5 py-1 rounded-full bg-emerald-950/90 border border-emerald-500/80 text-emerald-300 text-xs font-mono font-medium flex items-center gap-2 shadow-lg animate-in fade-in">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-ping" />
                <span>🟢 Face verified • Ready</span>
              </div>
            ) : isFailed ? (
              <div className="px-3.5 py-1 rounded-full bg-rose-950/90 border border-rose-500/80 text-rose-300 text-xs font-mono font-medium flex items-center gap-2 shadow-lg animate-in shake">
                <span>⚠️</span>
                <span>
                  {verifiedResult?.reason === "SPOOF_PHOTO_DETECTED"
                    ? "Presentation attack trapped"
                    : "Low similarity • Align face inside oval"}
                </span>
              </div>
            ) : isFaceAligned ? (
              <div className="px-3.5 py-1 rounded-full bg-emerald-950/80 backdrop-blur-md border border-emerald-500/60 text-emerald-300 text-xs font-mono flex items-center gap-2 shadow-lg animate-in fade-in">
                <span className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
                <span>👁 Face aligned • Ready for scan</span>
              </div>
            ) : (
              <div className="px-3.5 py-1 rounded-full bg-zinc-950/80 backdrop-blur-md border border-zinc-700/80 text-zinc-300 text-xs font-mono flex items-center gap-2 shadow-md">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
                <span>👁 Center your face inside the frame</span>
              </div>
            )}

            {/* Spacer for symmetry */}
            <div className="w-14" />
          </div>

          {!cameraReady && !cameraError && (
            <div
              className="absolute inset-0 bg-zinc-950/90 flex items-center justify-center text-xs text-zinc-400 font-mono z-30"
              role="status"
              aria-label="Initializing camera feed"
            >
              Initializing camera feed...
            </div>
          )}

          {/* 5. Celebratory Gate-to-Chamber Transition */}
          {isTransitioning && isVerified && (
            <div
              className="absolute inset-0 z-40 bg-black/85 backdrop-blur-md flex flex-col items-center justify-center p-6 text-center space-y-4 animate-in fade-in zoom-in-95 duration-300"
              role="status"
              aria-label="Identity authenticated. Auto-handoff to oral defense chamber in progress."
            >
              <div className="relative flex items-center justify-center">
                <div className="w-20 h-20 rounded-full bg-emerald-500/20 border-2 border-emerald-400 flex items-center justify-center text-4xl text-emerald-300 shadow-[0_0_35px_rgba(16,185,129,0.7)] animate-bounce" aria-hidden="true">
                  ✓
                </div>
                <div className="absolute -inset-2 rounded-full border border-emerald-500/40 animate-ping pointer-events-none" aria-hidden="true" />
              </div>

              <div className="space-y-1">
                <h3 className="text-xl font-bold tracking-tight text-white">
                  Identity Authenticated
                </h3>
                <p className="text-xs font-mono text-emerald-300">
                  Candidate: <span className="font-bold text-white">{regNo.toUpperCase()}</span>
                </p>
                <p className="text-[11px] font-mono text-zinc-400">
                  Match: <span className="text-emerald-400 font-semibold">{matchPercent.toFixed(1)}%</span> • Umeyama Locked • Liveness Verified
                </p>
              </div>

              <div className="w-56 space-y-2 pt-2">
                <div className="flex items-center justify-between text-[10px] font-mono text-zinc-400">
                  <span>Entering defense room</span>
                  <span className="text-emerald-400 animate-pulse">Auto-handoff...</span>
                </div>
                <div
                  className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden"
                  role="progressbar"
                  aria-valuenow={Math.round(transitionProgress)}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full bg-emerald-400 rounded-full transition-all duration-75"
                    style={{ width: `${transitionProgress}%` }}
                  />
                </div>
              </div>
            </div>
          )}
        </div>

        {/* Error notification if camera failed */}
        {cameraError && (
          <div role="alert" className="p-3 rounded-xl bg-rose-950/60 border border-rose-800 text-rose-300 text-xs font-mono">
            {cameraError}
          </div>
        )}

        {/* Result telemetry summary */}
        {verifiedResult && !isTransitioning && !isVerified && (
          <div
            role="alert"
            className="p-3 rounded-2xl border text-xs font-mono flex items-center justify-between bg-rose-950/50 border-rose-800 text-rose-200"
          >
            <div className="flex items-center gap-2">
              <span className="text-rose-400 font-bold">✕</span>
              <span>{verifiedResult.message}</span>
            </div>
            {verifiedResult.similarity > 0 && (
              <span className="text-[11px] text-rose-300">
                {(verifiedResult.similarity * 100).toFixed(1)}% / {thresholdPercent.toFixed(0)}%
              </span>
            )}
          </div>
        )}

        {/* Modal Actions matching Mockup */}
        <div className="flex items-center justify-between pt-1">
          <button
            type="button"
            disabled={isTransitioning}
            onClick={() => {
              stopCamera();
              clearReticle();
              onCancel();
            }}
            aria-label="Cancel verification and exit"
            className="text-xs text-zinc-400 hover:text-white font-mono px-3 py-2 rounded-xl transition cursor-pointer disabled:opacity-40"
          >
            ← Cancel
          </button>

          {isTransitioning ? (
            <div className="px-5 py-2.5 rounded-xl bg-emerald-600/90 text-white font-semibold text-xs font-mono flex items-center gap-2 shadow">
              <span className="w-2 h-2 rounded-full bg-white animate-ping" />
              <span>Entering Chamber...</span>
            </div>
          ) : (
            <button
              ref={verifyButtonRef}
              type="button"
              disabled={!cameraReady || verifying || (!isFaceAligned && attempts === 0)}
              onClick={handleCaptureAndVerify}
              title={!isFaceAligned && attempts === 0 ? "Align your face inside the oval to enable verification" : "Scan and verify candidate identity"}
              className={`px-5 py-2.5 rounded-xl font-mono text-xs font-semibold transition-all duration-200 flex items-center gap-2 shadow-lg ${
                !isFaceAligned && attempts === 0
                  ? "bg-zinc-900 border border-zinc-800 text-zinc-500 opacity-60 cursor-not-allowed"
                  : "bg-purple-600 hover:bg-purple-500 text-white shadow-[0_0_20px_rgba(147,51,234,0.45)] cursor-pointer active:scale-95"
              }`}
            >
              <span>📷</span>
              <span>{verifying ? "Verifying..." : "Verify Identity"}</span>
              <span aria-hidden="true">→</span>
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
