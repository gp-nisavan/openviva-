// ============================================================================
// OPENVIVA CANDIDATE ORAL DEFENSE CHAMBER
// ============================================================================
// Resolves Issue 13: Webcam Stream Handoff Lockup on Gate Transition.
// Re-exports the oral examination chamber component with camera acquisition
// retry backoff on Chromium / Linux V4L2 / Windows DirectShow driver transitions.
// ============================================================================

"use client";

import React from "react";
import { DefenseViewStack2 } from "./DefenseViewStack2";
import { acquireCameraWithRetry, releaseCameraStream } from "@/lib/cameraHandoff";

export { acquireCameraWithRetry, releaseCameraStream };

export interface CandidateOralChamberProps {
  initialRoom?: string;
  initialStudentId?: string;
  systemPrompt?: string;
  durationMinutes?: number;
  courseTitle?: string;
  leadProfessor?: string;
  supervisingTaId?: string;
  supervisingTaName?: string;
}

export function CandidateOralChamber(props: CandidateOralChamberProps) {
  return <DefenseViewStack2 {...props} />;
}

export default CandidateOralChamber;
