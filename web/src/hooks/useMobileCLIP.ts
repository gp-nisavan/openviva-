"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { acquireCameraWithRetry, releaseCameraStream } from "@/lib/cameraHandoff";
import { apiUrl } from "@/lib/api";
import {
  preprocessMobileCLIP,
  normalizeVector,
  cosineSimilarity,
  computeSoftmax,
  OPEN_VIVA_HIERARCHICAL_CONFIG,
  CLASS_CENTROIDS,
  MOBILECLIP_INPUT_SIZE,
} from "@/lib/proctor/mobileclip";

export interface HierarchicalClassResult {
  id: string;
  label: string;
  category: "benign" | "threat";
  isThreat: boolean;
  severity: "none" | "low" | "medium" | "critical";
  score: number; // 0..1 Softmax probability
  cosineSim: number; // Raw cosine similarity
  cosineMargin: number; // Difference over Max(Benign)
  minCosineMargin: number; // Required Pre-Softmax margin
  minThreshold: number; // legacy
  color: string;
}

export interface MobileCLIPProctorState {
  isLoading: boolean;
  isReady: boolean;
  isStreaming: boolean;
  error: string | null;
  provider: string | null;
  fps: number;
  latencyMs: number;

  // Hierarchical Gating & Cosine Margin Telemetry (Option 2)
  gateStatus: "benign_shielded" | "threat_gate_open";
  maxBenignScore: number;
  maxThreatScore: number;
  cosineMargin: number; // Max(Threat) - Max(Benign)
  requiredMargin: number; // Target margin for active candidate

  // Leaky Bucket Telemetry
  leakyBucketScore: number; // 0 to 20
  alertThreshold: number; // e.g., 15
  isSustainedInfraction: boolean;

  // Lighting Diagnostic
  lightingWarning: boolean;

  // Class Results
  topClass: HierarchicalClassResult | null;
  activeThreat: HierarchicalClassResult | null;
  benignClasses: HierarchicalClassResult[];
  threatClasses: HierarchicalClassResult[];
}

export function useMobileCLIP() {
  const [state, setState] = useState<MobileCLIPProctorState>({
    isLoading: true,
    isReady: false,
    isStreaming: false,
    error: null,
    provider: null,
    fps: 0,
    latencyMs: 0,
    gateStatus: "benign_shielded",
    maxBenignScore: 0,
    maxThreatScore: 0,
    cosineMargin: 0,
    requiredMargin: 0.015,
    leakyBucketScore: 0,
    alertThreshold: OPEN_VIVA_HIERARCHICAL_CONFIG.temporalSmoothing.alertThreshold,
    isSustainedInfraction: false,
    lightingWarning: false,
    topClass: null,
    activeThreat: null,
    benignClasses: [],
    threatClasses: [],
  });

  const sessionRef = useRef<any>(null);
  const ortRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const preprocessCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isLoopRunningRef = useRef<boolean>(false);
  const frameCountRef = useRef<number>(0);
  const lastFpsUpdateRef = useRef<number>(performance.now());

  // Leaky Bucket State Ref
  const leakyBucketRef = useRef<number>(0);
  // Exponential Moving Average (EMA) Probabilities Ref for zero-jitter smoothing
  const smoothedProbsRef = useRef<Record<string, number>>({});

  // Initialize MobileCLIP Vision ONNX Session
  useEffect(() => {
    let isCancelled = false;

    async function loadModel() {
      try {
        setState((prev) => ({ ...prev, isLoading: true, error: null }));

        const ort = await import("onnxruntime-web");
        ortRef.current = ort;

        // Configure self-hosted WASM paths and dynamic threads
        const isIsolated = typeof window !== "undefined" && (window as any).crossOriginIsolated;
        ort.env.wasm.wasmPaths = apiUrl("/onnx-wasm/");
        ort.env.wasm.numThreads = isIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
        ort.env.wasm.proxy = false;
        ort.env.logLevel = "error";

        const modelPath = apiUrl("/models/mobileclip_vision.onnx");
        let session: any;
        let activeProvider = "wasm";

        // Try WebGPU first, fall back gracefully to WASM
        try {
          session = await ort.InferenceSession.create(modelPath, {
            executionProviders: ["webgpu", "wasm"],
            logSeverityLevel: 3,
          });
          activeProvider = (session as any).handler?.ep?.name || "webgpu";
        } catch (gpuErr) {
          console.warn("WebGPU fallback to WASM for MobileCLIP:", gpuErr);
          session = await ort.InferenceSession.create(modelPath, {
            executionProviders: ["wasm"],
            logSeverityLevel: 3,
          });
          activeProvider = "wasm";
        }

        if (isCancelled) return;

        sessionRef.current = session;

        setState((prev) => ({
          ...prev,
          isLoading: false,
          isReady: true,
          provider: activeProvider,
        }));
      } catch (err: any) {
        if (isCancelled) return;
        console.error("Failed to load MobileCLIP Vision model:", err);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: err?.message || "Failed to load MobileCLIP model",
        }));
      }
    }

    loadModel();

    return () => {
      isCancelled = true;
      sessionRef.current?.release();
    };
  }, []);

  // Inference Loop
  const runInference = useCallback(async () => {
    const video = videoRef.current;
    const session = sessionRef.current;
    const ort = ortRef.current;

    if (!video || !session || !ort || video.readyState < 2) {
      if (isLoopRunningRef.current) {
        requestAnimationFrame(runInference);
      }
      return;
    }

    const t0 = performance.now();

    try {
      if (!preprocessCanvasRef.current) {
        preprocessCanvasRef.current = document.createElement("canvas");
      }

      // Preprocess video to 256x256 RGB NCHW
      const tensorData = preprocessMobileCLIP(video, preprocessCanvasRef.current);
      const inputTensor = new ort.Tensor("float32", tensorData, [
        1,
        3,
        MOBILECLIP_INPUT_SIZE,
        MOBILECLIP_INPUT_SIZE,
      ]);

      // Run inference
      const feeds: Record<string, any> = { [session.inputNames[0]]: inputTensor };
      const outputMap = await session.run(feeds);
      const outputTensor = outputMap[session.outputNames[0]];

      // Unit-normalize output visual embedding (1 x 512)
      const imageEmbedding = normalizeVector(outputTensor.data as Float32Array);

      // Compute raw cosine similarities for all 12 classes
      const rawCosines: Record<string, number> = {};
      const config = OPEN_VIVA_HIERARCHICAL_CONFIG;

      for (const cls of config.classes) {
        const centroid = CLASS_CENTROIDS[cls.id];
        rawCosines[cls.id] = centroid ? cosineSimilarity(imageEmbedding, centroid) : 0;
      }

      // ─── STAGE 1: OPTION 2 PRE-SOFTMAX COSINE MARGIN GATE ───────────
      let maxBenign = -Infinity;
      let topBenignId = "";
      for (const id of config.metaVectors.benignClassIds) {
        const sim = rawCosines[id] ?? 0;
        if (sim > maxBenign) {
          maxBenign = sim;
          topBenignId = id;
        }
      }

      let maxThreat = -Infinity;
      let topThreatId = "";
      for (const id of config.metaVectors.threatClassIds) {
        const sim = rawCosines[id] ?? 0;
        if (sim > maxThreat) {
          maxThreat = sim;
          topThreatId = id;
        }
      }

      // Option 2 Pre-Softmax Cosine Margin:
      // The threat must beat the strongest benign absorber by its calibrated cosine margin
      const topThreatDef = config.classes.find((c) => c.id === topThreatId);
      const requiredMargin = topThreatDef?.minCosineMargin ?? config.metaVectors.stage1BinaryThreshold ?? 0.015;
      const cosineMargin = maxThreat - maxBenign;
      const threatGateOpen = cosineMargin >= requiredMargin;

      // Stage 2: Calibrated Softmax across all 12 classes with standard CLIP logit scale (T = 0.025)
      const cosineValues = config.classes.map((c) => rawCosines[c.id]);
      const rawSoftmaxProbs = computeSoftmax(cosineValues, 0.025);

      // Apply Exponential Moving Average (EMA) smoothing (alpha = 0.40) to kill frame-to-frame noise
      const EMA_ALPHA = 0.40;
      const smoothedProbs: number[] = [];
      for (let i = 0; i < config.classes.length; i++) {
        const id = config.classes[i].id;
        const current = rawSoftmaxProbs[i];
        const prev = smoothedProbsRef.current[id] ?? current;
        const smoothed = prev * (1 - EMA_ALPHA) + current * EMA_ALPHA;
        smoothedProbsRef.current[id] = smoothed;
        smoothedProbs.push(smoothed);
      }

      const allResults: HierarchicalClassResult[] = config.classes.map((cls, i) => {
        const sim = rawCosines[cls.id] ?? 0;
        const margin = sim - maxBenign;
        return {
          id: cls.id,
          label: cls.label,
          category: cls.category,
          isThreat: cls.isThreat,
          severity: cls.severity,
          score: smoothedProbs[i],
          cosineSim: parseFloat(sim.toFixed(3)),
          cosineMargin: parseFloat(margin.toFixed(3)),
          minCosineMargin: cls.minCosineMargin,
          minThreshold: cls.minConfidenceThreshold ?? 0,
          color: cls.color,
        };
      });

      const benignClasses = allResults
        .filter((c) => c.category === "benign")
        .sort((a, b) => b.score - a.score);

      const threatClasses = allResults
        .filter((c) => c.category === "threat")
        .sort((a, b) => b.cosineMargin - a.cosineMargin);

      const topClass = [...allResults].sort((a, b) => b.score - a.score)[0];

      // Option 2 Active Threat: Evaluated via Pre-Softmax Cosine Margin
      let activeThreat: HierarchicalClassResult | null = null;
      if (threatGateOpen) {
        const candidate = threatClasses.find((c) => c.id === topThreatId) || threatClasses[0];
        if (candidate && candidate.cosineMargin >= candidate.minCosineMargin) {
          activeThreat = candidate;
        }
      }

      // ─── STAGE 3: LEAKY BUCKET TEMPORAL ACCUMULATOR ───────────────
      const { threatIncrement, benignDecrement, alertThreshold } =
        config.temporalSmoothing;

      if (activeThreat) {
        // Threat verified by Cosine Margin: fill bucket (+1.0 per frame)
        leakyBucketRef.current = Math.min(
          alertThreshold + 5,
          leakyBucketRef.current + threatIncrement
        );
      } else {
        // Benign state or sub-margin noise: drain bucket (-0.5 per frame)
        leakyBucketRef.current = Math.max(
          0,
          leakyBucketRef.current - benignDecrement
        );
      }

      const isSustainedInfraction = leakyBucketRef.current >= alertThreshold;

      // Check Lighting Diagnostic Absorber
      const lightingResult = allResults.find((c) => c.id === "poor_lighting_silhouette");
      const lightingWarning = (lightingResult && lightingResult.score >= 0.70) || false;

      const t1 = performance.now();
      const latency = Math.round(t1 - t0);

      // Track FPS
      frameCountRef.current++;
      const now = performance.now();
      let currentFps = state.fps;
      if (now - lastFpsUpdateRef.current >= 1000) {
        currentFps = Math.round(
          (frameCountRef.current * 1000) / (now - lastFpsUpdateRef.current)
        );
        frameCountRef.current = 0;
        lastFpsUpdateRef.current = now;
      }

      setState((prev) => ({
        ...prev,
        fps: currentFps,
        latencyMs: latency,
        gateStatus: threatGateOpen ? "threat_gate_open" : "benign_shielded",
        maxBenignScore: parseFloat(maxBenign.toFixed(3)),
        maxThreatScore: parseFloat(maxThreat.toFixed(3)),
        cosineMargin: parseFloat(cosineMargin.toFixed(3)),
        requiredMargin: parseFloat(requiredMargin.toFixed(3)),
        leakyBucketScore: Math.round(leakyBucketRef.current * 10) / 10,
        isSustainedInfraction,
        lightingWarning,
        topClass,
        activeThreat,
        benignClasses,
        threatClasses,
      }));
    } catch (err) {
      console.warn("MobileCLIP inference frame skipped:", err);
    }

    if (isLoopRunningRef.current) {
      // 2 FPS pacing (450ms wait + ~115ms inference = ~565ms interval = smooth, low-load 1.8-2 FPS)
      setTimeout(() => {
        if (isLoopRunningRef.current) {
          requestAnimationFrame(runInference);
        }
      }, 450);
    }
  }, [state.fps]);

  // Start Camera with Retry Backoff
  const startCamera = useCallback(async () => {
    try {
      const stream = await acquireCameraWithRetry({
        video: { width: { ideal: 640 }, height: { ideal: 480 }, frameRate: { ideal: 30 } },
        audio: false,
      });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play();
      }

      isLoopRunningRef.current = true;
      setState((prev) => ({ ...prev, isStreaming: true }));
      requestAnimationFrame(runInference);
    } catch (err: any) {
      console.error("Camera access failed:", err);
      setState((prev) => ({
        ...prev,
        error: "Camera access denied. Please grant webcam permissions.",
      }));
    }
  }, [runInference]);

  // Stop Camera
  const stopCamera = useCallback(() => {
    isLoopRunningRef.current = false;
    releaseCameraStream(videoRef.current, videoRef.current?.srcObject as MediaStream | null);
    leakyBucketRef.current = 0;
    smoothedProbsRef.current = {};
    setState((prev) => ({
      ...prev,
      isStreaming: false,
      topClass: null,
      activeThreat: null,
      benignClasses: [],
      threatClasses: [],
      cosineMargin: 0,
      leakyBucketScore: 0,
      isSustainedInfraction: false,
      fps: 0,
      latencyMs: 0,
    }));
  }, []);

  return {
    state,
    videoRef,
    startCamera,
    stopCamera,
  };
}
