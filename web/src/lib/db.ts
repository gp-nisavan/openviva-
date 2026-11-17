// ============================================================================
// OPENVIVA MODULAR DATABASE LAYER (RE-EXPORT ENTRYPOINT)
// ============================================================================
// Decomposed into focused domain modules per Issue 19:
// - connection.ts: Connection pooling, better-sqlite3 adapter, directory paths, and pragmas
// - schema.ts: DDL tables, column ensure migrations, seed routines
// - exams.ts: Exam presets, syllabus topics, and access controls
// - sessions.ts: Viva exam sessions, transcript WAL turns, evaluations, metrics
// - auth.ts: Instructor and student accounts, sessions, biometrics records
// ============================================================================

export * from "./db/connection";
export * from "./db/schema";
export * from "./db/exams";
export * from "./db/sessions";
export * from "./db/auth";
