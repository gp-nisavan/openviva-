"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { acquireCameraWithRetry, releaseCameraStream } from "@/lib/cameraHandoff";
import { apiUrl } from "@/lib/api";
import {
  preprocessYOLO,
  postprocessYOLO,
  DetectedObject,
  YOLO_INPUT_SIZE,
} from "@/lib/proctor/contraband";

export interface ContrabandTrackerState {
  isLoading: boolean;
  isReady: boolean;
  isStreaming: boolean;
  error: string | null;
  provider: string | null;
  fps: number;
  detections: DetectedObject[];
  activeThreat: DetectedObject | null;
  personCount: number;
}

export function useContrabandDetector() {
  const [state, setState] = useState<ContrabandTrackerState>({
    isLoading: true,
    isReady: false,
    isStreaming: false,
    error: null,
    provider: null,
    fps: 0,
    detections: [],
    activeThreat: null,
    personCount: 0,
  });

  const [confidenceThreshold, setConfidenceThreshold] = useState<number>(0.25);
  const confidenceRef = useRef<number>(0.25);
  confidenceRef.current = confidenceThreshold;

  const sessionRef = useRef<any>(null);
  const ortRef = useRef<any>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const preprocessCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const isLoopRunningRef = useRef<boolean>(false);
  const frameCountRef = useRef<number>(0);
  const lastFpsUpdateRef = useRef<number>(performance.now());

  // Initialize YOLOv8 ONNX session
  useEffect(() => {
    let isCancelled = false;

    async function loadModel() {
      try {
        setState((prev) => ({ ...prev, isLoading: true, error: null }));

        // Dynamically import onnxruntime-web to avoid SSR breakage
        const ort = await import("onnxruntime-web");
        ortRef.current = ort;

        // Configure WASM binaries: local self-hosted files, dynamically adjust threads
        const isIsolated = typeof window !== "undefined" && (window as any).crossOriginIsolated;
        ort.env.wasm.wasmPaths = apiUrl("/onnx-wasm/");
        ort.env.wasm.numThreads = isIsolated ? Math.min(4, navigator.hardwareConcurrency || 2) : 1;
        ort.env.wasm.proxy = false;
        ort.env.logLevel = "error";

        const modelPath = apiUrl("/models/yolov8n.onnx");
        let session: any;
        let activeProvider = "wasm";

        // 1. Try WebGPU first
        try {
          session = await ort.InferenceSession.create(modelPath, {
            executionProviders: ["webgpu", "wasm"],
            logSeverityLevel: 3,
          });
          activeProvider = (session as any).handler?.ep?.name || "webgpu";
        } catch (gpuErr) {
          console.warn("WebGPU initialization fallback to WASM for YOLOv8:", gpuErr);
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
        console.error("Failed to load YOLOv8 ONNX model:", err);
        setState((prev) => ({
          ...prev,
          isLoading: false,
          error: err?.message || "Failed to load contraband detector",
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

    try {
      if (!preprocessCanvasRef.current) {
        preprocessCanvasRef.current = document.createElement("canvas");
      }

      // Preprocess to 640x640 Float32Array RGB NCHW with letterbox
      const { tensor: tensorData, letterbox } = preprocessYOLO(
        video,
        preprocessCanvasRef.current
      );
      const inputTensor = new ort.Tensor("float32", tensorData, [
        1,
        3,
        YOLO_INPUT_SIZE,
        YOLO_INPUT_SIZE,
      ]);

      // Run model
      const feeds = { [session.inputNames[0]]: inputTensor };
      const outputMap = await session.run(feeds);
      const outputTensor = outputMap[session.outputNames[0]];

      // Post-process candidates and apply NMS with letterbox-aware coordinates
      const detections = postprocessYOLO(
        outputTensor.data as Float32Array,
        letterbox,
        confidenceRef.current,
        0.45
      );

      // Analyze for threats
      const threat = detections.find((d) => d.isThreat) || null;
      const persons = detections.filter((d) => d.label === "person").length;

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
        detections,
        activeThreat: threat,
        personCount: persons,
      }));
    } catch (err) {
      console.warn("YOLO inference frame skipped:", err);
    }

    if (isLoopRunningRef.current) {
      // Run every ~75ms (~13 FPS for smooth, real-time contraband checks)
      setTimeout(() => {
        if (isLoopRunningRef.current) {
          requestAnimationFrame(runInference);
        }
      }, 75);
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
    setState((prev) => ({
      ...prev,
      isStreaming: false,
      detections: [],
      activeThreat: null,
      fps: 0,
    }));
  }, []);

  return {
    state,
    videoRef,
    confidenceThreshold,
    setConfidenceThreshold,
    startCamera,
    stopCamera,
  };
}
