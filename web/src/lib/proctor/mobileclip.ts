/**
 * MobileCLIP Zero-Shot Vision Proctoring Engine
 * 100% Client-Side inference via onnxruntime-web (WebGPU / WASM)
 * Architecture: Two-Stage Hierarchical Gating + Leaky Bucket Temporal Accumulation
 */

export const MOBILECLIP_INPUT_SIZE = 256;

export interface HierarchicalProctorConfig {
  metaVectors: {
    benignClassIds: string[];
    threatClassIds: string[];
    stage1GateLogic: "max_vs_max" | "pre_softmax_cosine_margin";
    stage1BinaryThreshold: number;
    defaultCosineMargin?: number;
  };
  temporalSmoothing: {
    strategy: "leaky_bucket";
    alertThreshold: number;
    threatIncrement: number;
    benignDecrement: number;
  };
  classes: Array<{
    id: string;
    label: string;
    category: "benign" | "threat";
    isThreat: boolean;
    severity: "none" | "low" | "medium" | "critical";
    minConfidenceThreshold?: number;
    minCosineMargin: number; // Pre-Softmax Cosine Margin over Max(Benign)
    primaryPrompt: string;
    ensemblePrompts: string[];
    visualRationale: string;
    color: string;
  }>;
}

export const OPEN_VIVA_HIERARCHICAL_CONFIG: HierarchicalProctorConfig = {
  metaVectors: {
    benignClassIds: [
      "normal_baseline",
      "cognitive_thinking",
      "fatigue_stretching",
      "hydration",
      "adjusting_grooming",
      "poor_lighting_silhouette",
    ],
    threatClassIds: [
      "phone_contraband",
      "paper_notes_book",
      "under_desk_manipulation",
      "accomplice_whispering",
      "off_screen_glancing",
      "desk_abandonment",
    ],
    stage1GateLogic: "pre_softmax_cosine_margin",
    stage1BinaryThreshold: 0.015,
    defaultCosineMargin: 0.015,
  },
  temporalSmoothing: {
    strategy: "leaky_bucket",
    alertThreshold: 15,
    threatIncrement: 1.0,
    benignDecrement: 0.5,
  },
  classes: [
    // --- GROUP A: BENIGN ABSORBER CLASSES ---
    {
      id: "normal_baseline",
      label: "Normal Baseline",
      category: "benign",
      isThreat: false,
      severity: "none",
      minConfidenceThreshold: 0.0,
      minCosineMargin: 0.0,
      primaryPrompt: "a student sitting upright and looking directly forward into the webcam lens.",
      ensemblePrompts: [
        "a person sitting straight and making direct eye contact with the camera.",
        "an attentive candidate facing forward directly toward the camera lens.",
        "a student looking straight ahead while sitting still in the video frame.",
      ],
      visualRationale: "Anchors on neutral posture and direct forward gaze to establish the benign zero-state.",
      color: "#10b981", // Emerald
    },
    {
      id: "cognitive_thinking",
      label: "Cognitive Gaze Aversion",
      category: "benign",
      isThreat: false,
      severity: "none",
      minConfidenceThreshold: 0.0,
      minCosineMargin: 0.0,
      primaryPrompt: "a person looking up at the room ceiling while deep in thought.",
      ensemblePrompts: [
        "a student tilting their head back to look upward at the ceiling.",
        "a candidate gazing up at the top corners of the room walls.",
        "a person looking upward away from the lens while thinking quietly.",
      ],
      visualRationale: "Absorbs upward eye movements (common during recall) preventing false flags for off-screen glancing.",
      color: "#06b6d4", // Cyan
    },
    {
      id: "fatigue_stretching",
      label: "Fatigue / Stretching",
      category: "benign",
      isThreat: false,
      severity: "none",
      minConfidenceThreshold: 0.0,
      minCosineMargin: 0.0,
      primaryPrompt: "a student stretching their neck and yawning in front of the camera.",
      ensemblePrompts: [
        "a person rubbing their tired eyes with their hands during a video.",
        "a candidate rolling their shoulders and stretching their arms upward.",
        "a student with eyes closed rubbing their face in the webcam view.",
      ],
      visualRationale: "Catches closed eyes and hands touching the face, which otherwise confuse phone or lap manipulation vectors.",
      color: "#3b82f6", // Blue
    },
    {
      id: "hydration",
      label: "Hydration",
      category: "benign",
      isThreat: false,
      severity: "none",
      minConfidenceThreshold: 0.0,
      minCosineMargin: 0.0,
      primaryPrompt: "a person holding a glass and drinking water during a video call.",
      ensemblePrompts: [
        "a student lifting a water bottle to their mouth to take a drink.",
        "a candidate holding a coffee cup up to their face to drink.",
        "a person drinking from a beverage container visible in the camera frame.",
      ],
      visualRationale: "Identifies cups/bottles and raised hands near the mouth, preventing them from being classified as whispering or phones.",
      color: "#0ea5e9", // Sky
    },
    {
      id: "adjusting_grooming",
      label: "Adjusting / Grooming",
      category: "benign",
      isThreat: false,
      severity: "none",
      minConfidenceThreshold: 0.0,
      minCosineMargin: 0.0,
      primaryPrompt: "a student adjusting their eyeglasses and fixing hair in the camera view.",
      ensemblePrompts: [
        "a person using their hands to scratch their chin and touch their face.",
        "a candidate brushing hair away from their eyes on a webcam.",
        "a student adjusting their shirt collar with their hands visible.",
      ],
      visualRationale: "Absorbs transient hand-to-head movements so they do not trigger accomplice or phone classes.",
      color: "#6366f1", // Indigo
    },
    {
      id: "poor_lighting_silhouette",
      label: "Poor Lighting / Silhouette",
      category: "benign",
      isThreat: false,
      severity: "medium",
      minConfidenceThreshold: 0.70,
      minCosineMargin: 0.0,
      primaryPrompt: "a dark silhouette of a person sitting against a very bright background light.",
      ensemblePrompts: [
        "a person sitting in front of a bright window appearing as a dark shadow.",
        "a backlit webcam view showing only the dark outline of a student.",
        "a heavily shadowed figure sitting in a room with severe backlighting.",
      ],
      visualRationale: "Catches extreme dynamic range failures. When this spikes, MobileCLIP cannot see details. The UI intercepts this state and pauses the exam.",
      color: "#eab308", // Yellow
    },

    // --- GROUP B: CHEATING / THREAT CLASSES ---
    {
      id: "phone_contraband",
      label: "Phone Contraband",
      category: "threat",
      isThreat: true,
      severity: "critical",
      minConfidenceThreshold: 0.60,
      minCosineMargin: 0.012, // Distinct object cue; +0.012 margin over benign establishes contraband
      primaryPrompt: "a person holding and looking at a glowing smartphone in their hands.",
      ensemblePrompts: [
        "a student tapping fingers on a mobile phone held in front of them.",
        "a candidate holding a cell phone with a bright screen visible.",
        "hands holding a mobile device up to the camera lens view.",
      ],
      visualRationale: "Specific nouns (smartphone, cell phone) paired with 'hands holding' separates this from passive objects on the desk.",
      color: "#f43f5e", // Rose
    },
    {
      id: "paper_notes_book",
      label: "Paper Notes / Book",
      category: "threat",
      isThreat: true,
      severity: "critical",
      minConfidenceThreshold: 0.65,
      minCosineMargin: 0.015,
      primaryPrompt: "a student looking down at loose sheets of paper on a desk.",
      ensemblePrompts: [
        "a person leaning forward to read an open textbook on the table.",
        "a candidate with head tilted down reading written paper notes.",
        "a student looking downwards at study materials resting on a flat surface.",
      ],
      visualRationale: "Combines downward gaze with explicit stationary physical items (paper, textbook) on a surface (desk, table).",
      color: "#fb923c", // Orange
    },
    {
      id: "under_desk_manipulation",
      label: "Under-Desk Manipulation",
      category: "threat",
      isThreat: true,
      severity: "medium",
      minConfidenceThreshold: 0.60,
      minCosineMargin: 0.015,
      primaryPrompt: "a person gazing down at hidden hands concealed below the desk level.",
      ensemblePrompts: [
        "a student tucking their chin down to stare into their empty lap.",
        "a candidate looking downwards with both hands out of the camera view.",
        "a person staring down into their lap where hands are hiding.",
      ],
      visualRationale: "Focuses on the downward chin tuck paired with the notable absence of visible hands in the frame.",
      color: "#d946ef", // Fuchsia
    },
    {
      id: "accomplice_whispering",
      label: "Accomplice Whispering",
      category: "threat",
      isThreat: true,
      severity: "critical",
      minConfidenceThreshold: 0.70,
      minCosineMargin: 0.015,
      primaryPrompt: "a student turning their head sideways to whisper to someone off camera.",
      ensemblePrompts: [
        "a person facing the side wall with their mouth moving to speak.",
        "a candidate turning ninety degrees sideways and talking to an unseen person.",
        "a student looking completely to the side while speaking out loud.",
      ],
      visualRationale: "Requires extreme yaw (sideways head rotation) plus active mouth movement to prevent false positives from mere side-glances.",
      color: "#ec4899", // Pink
    },
    {
      id: "off_screen_glancing",
      label: "Off-Screen Glancing",
      category: "threat",
      isThreat: true,
      severity: "low",
      minConfidenceThreshold: 0.75,
      minCosineMargin: 0.018, // +0.018 margin prevents rapid micro-saccades or thinking from triggering
      primaryPrompt: "a person continuously looking away from the camera toward a side wall.",
      ensemblePrompts: [
        "a student staring fixedly at the side of the room away from the lens.",
        "a candidate turning their eyes to read something off camera.",
        "a person looking sharply to the side instead of the webcam.",
      ],
      visualRationale: "Highlights horizontal gaze deviation ('side wall', 'away') without mouth movement, strictly avoiding screen/monitor tokens.",
      color: "#a855f7", // Purple
    },
    {
      id: "desk_abandonment",
      label: "Desk Abandonment",
      category: "threat",
      isThreat: true,
      severity: "medium",
      minConfidenceThreshold: 0.85,
      minCosineMargin: 0.020,
      primaryPrompt: "an empty office chair and unoccupied desk with no people visible.",
      ensemblePrompts: [
        "a vacant seating area showing a background wall with zero humans present.",
        "an empty room on webcam without any person in the camera frame.",
        "an empty desk showing only the background and no candidate sitting there.",
      ],
      visualRationale: "Maximizes nullifying tokens (empty, unoccupied, no people, vacant) to overpower any human-centric features in the background.",
      color: "#ef4444", // Red
    },
  ],
};

/**
 * Pre-processes video frame for MobileCLIP-S0 (256x256 Float32Array RGB NCHW, normalized 0.0 to 1.0)
 */
export function preprocessMobileCLIP(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): Float32Array {
  canvas.width = MOBILECLIP_INPUT_SIZE;
  canvas.height = MOBILECLIP_INPUT_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not acquire 2D canvas context");

  const vw = video.videoWidth || 640;
  const vh = video.videoHeight || 480;
  const minDim = Math.min(vw, vh);
  const sx = (vw - minDim) / 2;
  const sy = (vh - minDim) / 2;

  ctx.drawImage(video, sx, sy, minDim, minDim, 0, 0, MOBILECLIP_INPUT_SIZE, MOBILECLIP_INPUT_SIZE);

  const imgData = ctx.getImageData(0, 0, MOBILECLIP_INPUT_SIZE, MOBILECLIP_INPUT_SIZE);
  const data = imgData.data;
  const totalPixels = MOBILECLIP_INPUT_SIZE * MOBILECLIP_INPUT_SIZE;
  const tensor = new Float32Array(3 * totalPixels);

  // Convert RGBA HWC -> RGB NCHW (0.0 to 1.0)
  for (let i = 0; i < totalPixels; i++) {
    tensor[i] = data[i * 4] / 255.0;                         // R
    tensor[totalPixels + i] = data[i * 4 + 1] / 255.0;       // G
    tensor[2 * totalPixels + i] = data[i * 4 + 2] / 255.0;   // B
  }

  return tensor;
}

/**
 * L2-Normalize a 512-dimensional vector
 */
export function normalizeVector(vec: Float32Array | number[]): number[] {
  let sumSq = 0;
  for (let i = 0; i < vec.length; i++) {
    sumSq += vec[i] * vec[i];
  }
  const norm = Math.sqrt(sumSq) || 1e-12;
  const result: number[] = new Array(vec.length);
  for (let i = 0; i < vec.length; i++) {
    result[i] = vec[i] / norm;
  }
  return result;
}

/**
 * Computes cosine similarity between two unit-normalized vectors
 */
export function cosineSimilarity(a: number[] | Float32Array, b: number[] | Float32Array): number {
  let dot = 0;
  for (let i = 0; i < 512; i++) {
    dot += a[i] * b[i];
  }
  return dot;
}

/**
 * Computes Softmax probabilities across an array of raw cosine similarities
 */
export function computeSoftmax(scores: number[], temperature = 0.07): number[] {
  let max = -Infinity;
  for (let i = 0; i < scores.length; i++) {
    const scaled = scores[i] / temperature;
    if (scaled > max) max = scaled;
  }

  const expScores: number[] = new Array(scores.length);
  let sumExp = 0;
  for (let i = 0; i < scores.length; i++) {
    const expVal = Math.exp(scores[i] / temperature - max);
    expScores[i] = expVal;
    sumExp += expVal;
  }

  const probs: number[] = new Array(scores.length);
  for (let i = 0; i < scores.length; i++) {
    probs[i] = sumExp > 0 ? expScores[i] / sumExp : 1 / scores.length;
  }
  return probs;
}

import { REAL_MOBILECLIP_EMBEDDINGS } from "./mobileclip_embeddings";

// Map each of the 12 classes to its genuine MobileCLIP 512-dim centroid vector
export const CLASS_CENTROIDS: Record<string, number[]> = REAL_MOBILECLIP_EMBEDDINGS;
