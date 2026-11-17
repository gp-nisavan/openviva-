import { TOCItem, RigorTier } from "./toc";
import { ExamEvaluationResult } from "./grading";

export type ExamSessionStatus =
  | "IN_PROGRESS"
  | "PENDING_EVALUATION"
  | "COMPLETED"
  | "EVALUATION_FAILED";

export interface TranscriptTurn {
  id?: string;
  speaker: "examiner" | "candidate" | "system";
  text: string;
  timestamp: string;
  isInterrupted?: boolean;
  tokens?: number;
  cumulativeTokens?: number;
}

export interface AllowedStudent {
  name: string;
  regNo: string;
}

export interface StudentAccount {
  regNo: string;
  studentName: string;
  department: string;
  cohort: string;
  passwordHash: string;
  salt: string;
  mustChangePassword: boolean;
  isActive: boolean;
  createdAt: string;
  updatedAt?: string;
}

export interface StudentBiometricsRecord {
  regNo: string;
  studentName: string;
  faceImagePath?: string;
  faceEmbedding?: Uint8Array | null;
  faceEnrolledAt?: string;
  voiceSamplePath?: string;
  voiceEmbedding?: Uint8Array | null;
  voiceEnrolledAt?: string;
  enrolledIpAddress?: string;
  enrolledUserAgent?: string;
  verifiedByTaId?: string;
  verificationStatus: "PENDING" | "AUTHENTICATED" | "FLAGGED";
  lastFaceSimilarity?: number;
  lastLivenessScore?: number;
}

export interface AccessControl {
  type: "OPEN" | "RESTRICTED";
  allowedStudents?: AllowedStudent[];
}

export type InstructorRole = "PROFESSOR" | "TA" | "ADMIN";

export interface InstructorAccount {
  id: string;
  username: string;
  displayName: string;
  role: InstructorRole;
  department?: string;
  createdAt: string;
}

export interface ExamPreset {
  id: string;
  courseTitle: string;
  instructorId: string; // Combined / legacy identifier
  leadProfessor?: string; // Course Faculty In-Charge (e.g. "Prof. Jane Doe")
  supervisingTaId?: string; // Foreign key linked to instructors(id)
  supervisingTaName?: string; // Human-readable display name (e.g. "Savan (Systems TA)")
  difficultyTier: RigorTier | string;
  durationMinutes: number;
  studentDecidesWeightage: boolean;
  globalDirective?: string;
  accessControl?: AccessControl;
  totalTopics: number;
  topics: TOCItem[];
  systemPrompt: string;
  createdAt: string;
  updatedAt?: string;
}

export interface ExamSessionRecord {
  sessionId: string;
  examId: string;
  courseTitle: string;
  instructorId?: string; // Combined / legacy identifier
  leadProfessor?: string; // Course Faculty In-Charge
  supervisingTaId?: string; // Foreign key linked to instructors(id)
  supervisingTaName?: string; // Human-readable display name
  studentId: string;
  status: ExamSessionStatus;
  startedAt: string;
  endedAt?: string;
  actualDurationSeconds: number;
  turnCount: number;
  recordingUrl?: string;
  transcript: TranscriptTurn[];
  evaluationResult?: ExamEvaluationResult;
  error?: string;
  tokenMetrics?: {
    systemPromptTokens?: number;
    totalConversationTokens?: number;
    peakContextTokens?: number;
    averageTokensPerTurn?: number;
    totalTurns?: number;
  };
  createdAt: string;
  updatedAt?: string;
}
