// ============================================================================
// OPENVIVA CHAMBER LOCK REGISTRY (SQLite-Backed Distributed Lease Management)
// ============================================================================
// Resolves Issue 12: In-Memory Chamber Locks Wiped on Process Restart.
// Chamber leases are persisted to SQLite table `chamber_leases` with 45-second
// sliding TTL heartbeats, ensuring locks survive PM2 reloads and process restarts
// while maintaining 0ms in-memory read performance.
// ============================================================================

import { getSyncDB } from "./db";

export interface ChamberLock {
  studentId: string;
  lockedAt: number;
  lastHeartbeat: number;
}

declare global {
  var __openviva_chamber_locks: Map<string, ChamberLock> | undefined;
}

const locks: Map<string, ChamberLock> =
  global.__openviva_chamber_locks || new Map<string, ChamberLock>();
global.__openviva_chamber_locks = locks;

export const DEFAULT_LEASE_TTL_SECONDS = 45;

/**
 * Claims a chamber lock, persisting the lease to SQLite and caching in memory.
 */
export function claimChamber(
  roomName: string,
  studentId: string,
  ttlSeconds: number = DEFAULT_LEASE_TTL_SECONDS
): void {
  if (!roomName || !studentId) return;

  const now = Date.now();
  const claimedAt = new Date(now).toISOString();
  const heartbeatAt = claimedAt;
  const expiresAt = new Date(now + ttlSeconds * 1000).toISOString();

  // 1. Update in-memory cache
  locks.set(roomName, {
    studentId,
    lockedAt: now,
    lastHeartbeat: now,
  });

  // 2. Persist to SQLite chamber_leases table
  try {
    const db = getSyncDB();
    if (db) {
      db.run(
        `INSERT INTO chamber_leases (room_name, claimed_by, claimed_at, heartbeat_at, expires_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(room_name) DO UPDATE SET
           claimed_by = excluded.claimed_by,
           claimed_at = excluded.claimed_at,
           heartbeat_at = excluded.heartbeat_at,
           expires_at = excluded.expires_at;`,
        [roomName, studentId, claimedAt, heartbeatAt, expiresAt]
      );
    }
  } catch (err) {
    console.debug("[chamberLocks] claimChamber DB persist warning:", err);
  }
}

/**
 * Extends chamber lease TTL via candidate or examiner heartbeat.
 */
export function heartbeatChamber(
  roomName: string,
  studentId?: string,
  ttlSeconds: number = DEFAULT_LEASE_TTL_SECONDS
): void {
  if (!roomName) return;

  const now = Date.now();
  const heartbeatAt = new Date(now).toISOString();
  const expiresAt = new Date(now + ttlSeconds * 1000).toISOString();

  const current = locks.get(roomName);
  if (current) {
    if (!studentId || current.studentId.toLowerCase() === studentId.toLowerCase()) {
      current.lastHeartbeat = now;
    }
  } else if (studentId) {
    claimChamber(roomName, studentId, ttlSeconds);
    return;
  }

  // Persist extended expiry to SQLite
  try {
    const db = getSyncDB();
    if (db) {
      if (studentId) {
        db.run(
          `UPDATE chamber_leases
           SET heartbeat_at = ?, expires_at = ?
           WHERE room_name = ? AND (claimed_by = ? COLLATE NOCASE);`,
          [heartbeatAt, expiresAt, roomName, studentId]
        );
      } else {
        db.run(
          `UPDATE chamber_leases
           SET heartbeat_at = ?, expires_at = ?
           WHERE room_name = ?;`,
          [heartbeatAt, expiresAt, roomName]
        );
      }
    }
  } catch (err) {
    console.debug("[chamberLocks] heartbeatChamber DB update warning:", err);
  }
}

/**
 * Releases a chamber lock in memory and deletes the lease record in SQLite.
 */
export function releaseChamber(roomName: string, studentId?: string): void {
  if (!roomName) return;

  const current = locks.get(roomName);
  if (current) {
    if (!studentId || current.studentId.toLowerCase() === studentId.toLowerCase()) {
      locks.delete(roomName);
    }
  } else {
    locks.delete(roomName);
  }

  // Remove lease record from SQLite
  try {
    const db = getSyncDB();
    if (db) {
      if (studentId) {
        db.run(
          `DELETE FROM chamber_leases WHERE room_name = ? AND (claimed_by = ? COLLATE NOCASE);`,
          [roomName, studentId]
        );
      } else {
        db.run(`DELETE FROM chamber_leases WHERE room_name = ?;`, [roomName]);
      }
    }
  } catch (err) {
    console.debug("[chamberLocks] releaseChamber DB delete warning:", err);
  }
}

/**
 * Returns all active chamber locks, pruning expired records from both SQLite and memory.
 * Reconciles state from SQLite so active leases survive process restarts.
 */
export function getActiveLocks(): Map<string, ChamberLock> {
  const now = Date.now();
  const nowIso = new Date(now).toISOString();

  // 1. Synchronize from SQLite chamber_leases table
  try {
    const db = getSyncDB();
    if (db) {
      // Auto-prune expired leases in SQLite
      db.run("DELETE FROM chamber_leases WHERE expires_at <= ?;", [nowIso]);

      // Query active non-expired leases
      const res = db.exec(
        "SELECT room_name, claimed_by, claimed_at, heartbeat_at, expires_at FROM chamber_leases WHERE expires_at > ?;",
        [nowIso]
      );

      const activeRooms = new Set<string>();

      if (res.length > 0 && res[0].values) {
        for (const row of res[0].values) {
          const roomName = row[0] as string;
          const claimedBy = row[1] as string;
          const claimedAt = row[2] as string;
          const heartbeatAt = row[3] as string;

          const lockedTime = claimedAt ? new Date(claimedAt).getTime() : now;
          const hbTime = heartbeatAt ? new Date(heartbeatAt).getTime() : now;

          activeRooms.add(roomName);
          locks.set(roomName, {
            studentId: claimedBy,
            lockedAt: lockedTime,
            lastHeartbeat: hbTime,
          });
        }
      }

      // Remove any in-memory lock that is no longer active in SQLite
      for (const room of Array.from(locks.keys())) {
        if (!activeRooms.has(room)) {
          locks.delete(room);
        }
      }

      return locks;
    }
  } catch (err) {
    console.debug("[chamberLocks] getActiveLocks SQLite sync warning:", err);
  }

  // Fallback in-memory pruning if DB is temporarily unreachable
  for (const [room, lock] of locks.entries()) {
    if (now - lock.lastHeartbeat > DEFAULT_LEASE_TTL_SECONDS * 1000) {
      locks.delete(room);
    }
  }
  return locks;
}
