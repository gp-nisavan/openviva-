import { NextRequest, NextResponse } from "next/server";
import { RoomServiceClient } from "livekit-server-sdk";
import { getActiveLocks } from "@/lib/chamberLocks";

const LIVEKIT_URL = process.env.LIVEKIT_URL || "http://10.10.16.13:7880";
const LIVEKIT_API_KEY = process.env.LIVEKIT_API_KEY;
const LIVEKIT_API_SECRET = process.env.LIVEKIT_API_SECRET;

export const dynamic = "force-dynamic";

// ============================================================================
// ISSUE 29: IN-MEMORY SHORT-LIVED TTL CACHE & REQUEST COALESCER
// ============================================================================
// Mitigates high-frequency LiveKit RPC fan-out when multiple candidates poll
// `/api/defense/chambers` every 1,000ms. LiveKit occupancy is cached for 2s
// with single-flight request coalescing (in-flight promise deduplication).
// In-memory/SQLite pre-claim chamber locks (getActiveLocks) are queried on
// every single request with 0ms latency for real-time lease consistency.
// ============================================================================

interface LiveKitCache {
  occupied: Set<string>;
  timestamp: number;
}

const CACHE_TTL_MS = 2000; // 2-second short-lived TTL
let liveKitCache: LiveKitCache | null = null;
let inFlightLiveKitPromise: Promise<Set<string>> | null = null;
let roomServiceClient: RoomServiceClient | null = null;

function getRoomService(): RoomServiceClient | null {
  if (!LIVEKIT_API_KEY || !LIVEKIT_API_SECRET) {
    console.warn("[chambers] LIVEKIT_API_KEY or LIVEKIT_API_SECRET not configured in environment.");
    return null;
  }
  if (!roomServiceClient) {
    roomServiceClient = new RoomServiceClient(LIVEKIT_URL, LIVEKIT_API_KEY, LIVEKIT_API_SECRET);
  }
  return roomServiceClient;
}

/**
 * Queries LiveKit rooms and participants with parallelized participant checks.
 */
async function queryLiveKitOccupancy(): Promise<Set<string>> {
  const occupied = new Set<string>();
  const roomService = getRoomService();
  if (!roomService) {
    return occupied;
  }
  const activeRooms = await roomService.listRooms();

  const singleParticipantRooms: string[] = [];

  for (const r of activeRooms) {
    if (r.numParticipants > 1) {
      occupied.add(r.name);
    } else if (r.numParticipants === 1) {
      singleParticipantRooms.push(r.name);
    }
  }

  // Parallelize participant inspections for single-participant rooms
  if (singleParticipantRooms.length > 0) {
    const results = await Promise.allSettled(
      singleParticipantRooms.map(async (roomName) => {
        const parts = await roomService.listParticipants(roomName);
        const hasCandidate = parts.some((p) => !p.identity.startsWith("ai_examiner"));
        return { roomName, hasCandidate };
      })
    );

    for (const res of results) {
      if (res.status === "fulfilled" && res.value.hasCandidate) {
        occupied.add(res.value.roomName);
      } else if (res.status === "rejected") {
        // Safe fallback on participant inspection error: mark room occupied to avoid collision
        // (room will clear on next TTL cycle if empty)
        occupied.add(singleParticipantRooms[0]);
      }
    }
  }

  return occupied;
}

/**
 * Retrieves LiveKit room occupancy, leveraging 2s memory cache and
 * single-flight request coalescing.
 */
async function getLiveKitOccupied(forceRefresh: boolean = false): Promise<{ occupied: Set<string>; fromCache: boolean }> {
  const now = Date.now();

  // 1. Cache HIT: Return immediately if within TTL and refresh not requested
  if (!forceRefresh && liveKitCache && (now - liveKitCache.timestamp) < CACHE_TTL_MS) {
    return { occupied: liveKitCache.occupied, fromCache: true };
  }

  // 2. Coalesce concurrent in-flight requests (Single-Flight Deduplication)
  if (inFlightLiveKitPromise) {
    try {
      const occupied = await inFlightLiveKitPromise;
      return { occupied, fromCache: true };
    } catch {
      // Fall through to fallback
    }
  }

  // 3. Cache MISS / BYPASS: Launch single LiveKit query
  inFlightLiveKitPromise = queryLiveKitOccupancy()
    .then((occupied) => {
      liveKitCache = { occupied, timestamp: Date.now() };
      return occupied;
    })
    .catch((err) => {
      console.warn("[chambers] LiveKit RPC error, falling back to stale cache:", err);
      if (liveKitCache) {
        return liveKitCache.occupied;
      }
      return new Set<string>();
    })
    .finally(() => {
      inFlightLiveKitPromise = null;
    });

  const occupied = await inFlightLiveKitPromise;
  return { occupied, fromCache: false };
}

export async function GET(req: NextRequest) {
  const startTime = performance.now();

  try {
    const searchParams = req.nextUrl.searchParams;
    const forceRefresh =
      searchParams.get("refresh") === "true" ||
      searchParams.get("noCache") === "true" ||
      req.headers.get("cache-control") === "no-cache" ||
      req.headers.get("pragma") === "no-cache";

    // 1. Fetch LiveKit confirmed occupancy (TTL cached + coalesced)
    const { occupied: liveKitOccupied, fromCache } = await getLiveKitOccupied(forceRefresh);

    const occupiedSet = new Set<string>(liveKitOccupied);

    // 2. Instant pre-claim locks in Node.js memory / SQLite (0ms latency, always real-time)
    const activeLocks = getActiveLocks();
    for (const lockedRoom of activeLocks.keys()) {
      occupiedSet.add(lockedRoom);
    }

    // 3. Generate 100 Chambers - All powered by the Universal EOU ONNX Engine
    const chambers = Array.from({ length: 100 }, (_, i) => {
      const num = String(i + 1).padStart(2, "0");
      const id = `stack2-chamber-${num}`;
      const isOccupied = occupiedSet.has(id);

      return {
        id,
        number: i + 1,
        label: `Chamber ${num}`,
        isOccupied,
      };
    });

    const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
    const cacheHeader = forceRefresh ? "BYPASS" : (fromCache ? "HIT" : "MISS");

    return NextResponse.json(
      {
        total: 100,
        occupiedCount: occupiedSet.size,
        chambers,
      },
      {
        status: 200,
        headers: {
          "X-Cache": cacheHeader,
          "Cache-Control": "public, max-age=2, stale-while-revalidate=5",
          "X-Response-Time-Ms": `${durationMs}`,
        },
      }
    );
  } catch (error: any) {
    console.error("[chambers] Chambers fetch fatal error:", error);
    const activeLocks = getActiveLocks();
    const chambers = Array.from({ length: 100 }, (_, i) => {
      const num = String(i + 1).padStart(2, "0");
      const id = `stack2-chamber-${num}`;
      const isOccupied = activeLocks.has(id);
      return {
        id,
        number: i + 1,
        label: `Chamber ${num}`,
        isOccupied,
      };
    });

    const durationMs = Math.round((performance.now() - startTime) * 100) / 100;
    return NextResponse.json(
      { total: 100, occupiedCount: activeLocks.size, chambers },
      {
        status: 200,
        headers: {
          "X-Cache": "ERROR-FALLBACK",
          "Cache-Control": "no-store",
          "X-Response-Time-Ms": `${durationMs}`,
        },
      }
    );
  }
}
