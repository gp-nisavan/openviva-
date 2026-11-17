export type DefenseVerdict = "DISTINCTION" | "PASS" | "CONDITIONAL_PASS" | "FAIL" | "EVALUATED" | "IMPOSTER_PROXY_TAKEOVER" | "VERIFIED_AUTHENTIC" | "UNAUDITED_NO_VOICE_ENROLLED";
export type PerformanceTier = "DISTINCTION" | "COMPETENT" | "BORDERLINE" | "UNSATISFACTORY" | "EVALUATED";

export interface DimensionScores {
  questionAdherence: number;
  conceptualRigor: number;
  adversarialResistance: number;
  spokenConciseness: number;
}

export interface CandidateStrengthItem {
  area: string;
  evidenceQuote: string;
  facultyAppraisal: string;
}

export interface DiagnosticWeaknessItem {
  topic: string;
  flawedClaimQuote: string;
  underlyingMisconception: string;
  remediationPrescription: string;
}

export interface SubtopicEvaluation {
  subtopic: string;
  score: number;
  performanceTier?: PerformanceTier;
  evidenceQuote: string;
  assessment: string;
}

export interface BehavioralIntegrityFlag {
  flag: string;
  turnSnippet?: string;
  severity: "LOW" | "MEDIUM" | "HIGH";
  timestampRange?: {
    startSeconds: number;
    endSeconds: number;
    durationSeconds: number;
  };
  similarityScore?: number;
  speakerCluster?: string;
  alignedTranscript?: string;
  flaggedAt?: string;
}

export interface BehavioralIntegrityAudit {
  filibusterDetected?: boolean;
  evasionAttempted?: boolean;
  selfCorrectionDemonstrated?: boolean;
  observations?: string;
  dominantSpeakerSimilarity?: number;
  flags?: string[];
  evidenceSnippets?: BehavioralIntegrityFlag[];
  auditedAt?: string;
}

export interface BiometricIdentityCardData {
  verificationStatus: "AUTHENTICATED" | "FLAGGED" | "PENDING" | "NOT_ENROLLED";
  enrolledFaceUrl?: string;
  examKeyframeUrl?: string;
  faceMatchSimilarity?: number;
  enrolledAt?: string;
  keyframeCapturedAt?: string;
  secondaryVoiceDetected?: boolean;
  evidenceSnippets?: BehavioralIntegrityFlag[];
  recordingUrl?: string;
  livenessConfidence?: number;
  alignmentMethod?: string;
  claheNormalized?: boolean;
  acousticAuditCompleted?: boolean;
  acousticSimilarity?: number | null;
  acousticVerdict?: string | null;
}

export interface ExamEvaluationResult {
  overallScore: number;
  verdict: DefenseVerdict;
  dimensionScores?: DimensionScores;
  conceptualRigorScore: number;
  clarityScore: number;
  adversarialResistanceScore: number;
  candidateStrengths?: CandidateStrengthItem[];
  diagnosticWeaknesses?: DiagnosticWeaknessItem[];
  subtopicBreakdown: SubtopicEvaluation[];
  strengths: string[];
  weaknesses: string[];
  behavioralFlags: BehavioralIntegrityFlag[];
  behavioralAudit?: BehavioralIntegrityAudit;
  biometricAudit?: BiometricIdentityCardData;
  committeeRemarks: string;
  improvementFeedback?: string;
  evaluatedAt: string;
  durationMinutes?: number;
}
