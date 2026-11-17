// ============================================================================
// OPENVIVA CAMERA HANDOFF & HARDWARE UNBIND UTILITY
// ============================================================================
// Resolves Issue 13: Webcam Stream Handoff Lockup on Gate Transition.
// Provides graceful hardware unbind buffers and retry backoff for NotReadableError
// on Chromium / Linux V4L2 / Windows DirectShow driver subsystems.
// ============================================================================

export const HARDWARE_UNBIND_BUFFER_MS = 350;

/**
 * Gracefully requests camera access with automatic retry backoff.
 * Catches NotReadableError and TrackStartError (caused by driver hardware lock latency)
 * and retries up to maxRetries (default 3) with retryDelayMs (default 300ms) intervals.
 */
export async function acquireCameraWithRetry(
  constraints: MediaStreamConstraints = {
    video: { width: { ideal: 640 }, height: { ideal: 480 }, facingMode: "user" },
    audio: false,
  },
  maxRetries: number = 3,
  retryDelayMs: number = 300
): Promise<MediaStream> {
  if (typeof navigator === "undefined" || !navigator.mediaDevices?.getUserMedia) {
    throw new Error("navigator.mediaDevices.getUserMedia is not supported in this environment.");
  }

  let attempt = 0;
  while (attempt < maxRetries) {
    try {
      return await navigator.mediaDevices.getUserMedia(constraints);
    } catch (err: any) {
      attempt++;
      const isNotReadable =
        err?.name === "NotReadableError" ||
        err?.name === "TrackStartError" ||
        (typeof err?.message === "string" &&
          err.message.toLowerCase().includes("could not start video source"));

      if (isNotReadable && attempt < maxRetries) {
        console.warn(
          `[CameraHandoff] Webcam hardware busy (attempt ${attempt}/${maxRetries}): ${err?.message || err?.name}. Retrying in ${retryDelayMs}ms...`
        );
        await new Promise((resolve) => setTimeout(resolve, retryDelayMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error("Failed to acquire webcam after maximum retries.");
}

/**
 * Gracefully pauses video element, clears srcObject, and terminates all active tracks.
 */
export function releaseCameraStream(
  videoElement: HTMLVideoElement | null,
  stream: MediaStream | null
): void {
  if (videoElement) {
    try {
      videoElement.pause();
    } catch (err) {
      console.debug("[CameraHandoff] Video element pause warning:", err);
    }
    try {
      videoElement.srcObject = null;
    } catch (err) {
      console.debug("[CameraHandoff] Video element srcObject clear warning:", err);
    }
  }

  if (stream) {
    try {
      stream.getTracks().forEach((track) => {
        try {
          track.stop();
        } catch (trackErr) {
          console.debug("[CameraHandoff] Track stop warning:", trackErr);
        }
      });
    } catch (err) {
      console.debug("[CameraHandoff] Stream getTracks release warning:", err);
    }
  }
}

