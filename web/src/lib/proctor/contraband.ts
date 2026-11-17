/**
 * Physical Contraband & Accomplice Detection Engine (YOLOv8 ONNX)
 * 100% Client-Side inference via onnxruntime-web (WebGPU / WASM)
 * Detects:
 * - Cell Phones (COCO class 67, and 65 remote fallback)
 * - Books / Notebooks / Cheat Sheets (COCO class 73)
 * - Extra Persons / Accomplices (COCO class 0)
 * - Laptops / Tablets (COCO class 63)
 */

export const YOLO_INPUT_SIZE = 640;

export interface Letterbox {
  scale: number;
  padX: number;
  padY: number;
  origW: number;
  origH: number;
}

// Targeted COCO classes for physical exam integrity
export const CONTRABAND_CLASSES: Record<number, { label: string; isThreat: boolean }> = {
  67: { label: "cell phone", isThreat: true },
  65: { label: "cell phone", isThreat: true }, // Remote control (common COCO misclassification for angled/dark phones)
  73: { label: "book", isThreat: true },
  0:  { label: "person", isThreat: false }, // Multi-person detection
  63: { label: "laptop", isThreat: false },
};

export interface DetectedObject {
  classId: number;
  label: string;
  score: number;
  x1: number; // Normalized 0..1
  y1: number;
  x2: number;
  y2: number;
  isThreat: boolean;
}

/**
 * Pre-processes video frame for YOLOv8 with aspect-ratio preserving letterboxing.
 * Fills borders with standard YOLO gray (114, 114, 114) to eliminate distortion.
 */
export function preprocessYOLO(
  video: HTMLVideoElement,
  canvas: HTMLCanvasElement
): { tensor: Float32Array; letterbox: Letterbox } {
  canvas.width = YOLO_INPUT_SIZE;
  canvas.height = YOLO_INPUT_SIZE;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  if (!ctx) throw new Error("Could not acquire 2D canvas context");

  const origW = video.videoWidth || 640;
  const origH = video.videoHeight || 480;

  const scale = Math.min(YOLO_INPUT_SIZE / origW, YOLO_INPUT_SIZE / origH);
  const padX = (YOLO_INPUT_SIZE - origW * scale) / 2;
  const padY = (YOLO_INPUT_SIZE - origH * scale) / 2;

  // Fill with neutral YOLO gray (114)
  ctx.fillStyle = "#727272";
  ctx.fillRect(0, 0, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE);

  // Draw scaled video preserving true geometry
  ctx.drawImage(video, padX, padY, origW * scale, origH * scale);

  const imgData = ctx.getImageData(0, 0, YOLO_INPUT_SIZE, YOLO_INPUT_SIZE);
  const data = imgData.data;
  const totalPixels = YOLO_INPUT_SIZE * YOLO_INPUT_SIZE;
  const tensor = new Float32Array(3 * totalPixels);

  // Convert RGBA HWC -> RGB NCHW (0.0 to 1.0)
  for (let i = 0; i < totalPixels; i++) {
    tensor[i] = data[i * 4] / 255.0;                         // Channel 0 (R)
    tensor[totalPixels + i] = data[i * 4 + 1] / 255.0;       // Channel 1 (G)
    tensor[2 * totalPixels + i] = data[i * 4 + 2] / 255.0;   // Channel 2 (B)
  }

  return {
    tensor,
    letterbox: { scale, padX, padY, origW, origH },
  };
}

/**
 * Decodes YOLOv8 output tensor: [1, 84, 8400]
 * Checks all target classes independently so person confidence doesn't suppress phones.
 */
export function postprocessYOLO(
  output: Float32Array,
  letterbox?: Letterbox,
  scoreThreshold = 0.25,
  iouThreshold = 0.45
): DetectedObject[] {
  const numChannels = 84;
  const numAnchors = 8400;

  const candidates: DetectedObject[] = [];
  const padX = letterbox?.padX ?? 0;
  const padY = letterbox?.padY ?? 0;
  const drawW = letterbox ? letterbox.origW * letterbox.scale : YOLO_INPUT_SIZE;
  const drawH = letterbox ? letterbox.origH * letterbox.scale : YOLO_INPUT_SIZE;

  for (let i = 0; i < numAnchors; i++) {
    for (const classIdStr of Object.keys(CONTRABAND_CLASSES)) {
      const classId = Number(classIdStr);
      const score = output[(4 + classId) * numAnchors + i];

      // Threats (smartphones, books) use sensitive threshold (0.20) to guarantee fast pickup
      const effectiveThresh = CONTRABAND_CLASSES[classId].isThreat
        ? Math.min(scoreThreshold, 0.20)
        : scoreThreshold;

      if (score >= effectiveThresh) {
        const cx = output[0 * numAnchors + i];
        const cy = output[1 * numAnchors + i];
        const w  = output[2 * numAnchors + i];
        const h  = output[3 * numAnchors + i];

        // Map from letterboxed 640x640 back to original video 0..1 space
        const x1 = Math.max(0, Math.min(1, (cx - w / 2 - padX) / drawW));
        const y1 = Math.max(0, Math.min(1, (cy - h / 2 - padY) / drawH));
        const x2 = Math.max(0, Math.min(1, (cx + w / 2 - padX) / drawW));
        const y2 = Math.max(0, Math.min(1, (cy + h / 2 - padY) / drawH));

        candidates.push({
          classId,
          label: CONTRABAND_CLASSES[classId].label,
          score,
          x1,
          y1,
          x2,
          y2,
          isThreat: CONTRABAND_CLASSES[classId].isThreat,
        });
      }
    }
  }

  // Sort candidates by score descending
  candidates.sort((a, b) => b.score - a.score);

  // Apply Non-Maximum Suppression (NMS)
  const results: DetectedObject[] = [];
  const suppressed = new Uint8Array(candidates.length);

  for (let i = 0; i < candidates.length; i++) {
    if (suppressed[i]) continue;

    const current = candidates[i];
    results.push(current);

    for (let j = i + 1; j < candidates.length; j++) {
      if (suppressed[j]) continue;
      const other = candidates[j];

      // Suppress duplicate overlapping boxes of the same conceptual class
      if (current.label === other.label || current.classId === other.classId) {
        const iou = computeIoU(current, other);
        if (iou > iouThreshold) {
          suppressed[j] = 1;
        }
      }
    }
  }

  return results;
}

function computeIoU(boxA: DetectedObject, boxB: DetectedObject): number {
  const xA = Math.max(boxA.x1, boxB.x1);
  const yA = Math.max(boxA.y1, boxB.y1);
  const xB = Math.min(boxA.x2, boxB.x2);
  const yB = Math.min(boxA.y2, boxB.y2);

  const interW = Math.max(0, xB - xA);
  const interH = Math.max(0, yB - yA);
  const interArea = interW * interH;

  const areaA = (boxA.x2 - boxA.x1) * (boxA.y2 - boxA.y1);
  const areaB = (boxB.x2 - boxB.x1) * (boxB.y2 - boxB.y1);

  const unionArea = areaA + areaB - interArea;
  return unionArea > 0 ? interArea / unionArea : 0;
}
