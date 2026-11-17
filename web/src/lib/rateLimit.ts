/**
 * In-Memory Sliding Window / Leaky Bucket Rate Limiter
 * Provides thread-safe, high-performance request throttling for Next.js API routes.
 */

interface RateLimitEntry {
  count: number;
  resetTime: number;
}

const rateLimitMap = new Map<string, RateLimitEntry>();
let lastCleanup = Date.now();

function cleanupExpiredEntries() {
  const now = Date.now();
  if (now - lastCleanup < 30000) return; // Cleanup at most once every 30s
  lastCleanup = now;

  for (const [key, entry] of rateLimitMap.entries()) {
    if (now >= entry.resetTime) {
      rateLimitMap.delete(key);
    }
  }
}

export interface RateLimitResult {
  allowed: boolean;
  limit: number;
  remaining: number;
  resetTime: number;
  retryAfter: number; // in seconds
}

/**
 * Checks if a request identified by `key` is within rate limit boundaries.
 * @param key Unique identifier (e.g. student regNo, instructor ID, or IP)
 * @param limit Maximum allowed requests within the window (default 30)
 * @param windowMs Time window in milliseconds (default 60000ms = 1 minute)
 */
export function checkRateLimit(
  key: string,
  limit: number = 30,
  windowMs: number = 60000
): RateLimitResult {
  cleanupExpiredEntries();

  const now = Date.now();
  const entry = rateLimitMap.get(key);

  if (!entry || now >= entry.resetTime) {
    const newEntry: RateLimitEntry = {
      count: 1,
      resetTime: now + windowMs,
    };
    rateLimitMap.set(key, newEntry);
    return {
      allowed: true,
      limit,
      remaining: Math.max(0, limit - 1),
      resetTime: newEntry.resetTime,
      retryAfter: 0,
    };
  }

  entry.count += 1;

  if (entry.count > limit) {
    const retryAfter = Math.max(1, Math.ceil((entry.resetTime - now) / 1000));
    return {
      allowed: false,
      limit,
      remaining: 0,
      resetTime: entry.resetTime,
      retryAfter,
    };
  }

  return {
    allowed: true,
    limit,
    remaining: Math.max(0, limit - entry.count),
    resetTime: entry.resetTime,
    retryAfter: 0,
  };
}

/**
 * LeakyBucket rate limiter class providing static and instance interfaces
 * for API route throttling and IP brute-force protection.
 */
export class LeakyBucket {
  private capacity: number;
  private windowMs: number;

  constructor(capacity: number = 30, windowMs: number = 60000) {
    this.capacity = capacity;
    this.windowMs = windowMs;
  }

  /**
   * Evaluates if a key is allowed under this instance's capacity/window settings.
   */
  public consume(key: string): RateLimitResult {
    return checkRateLimit(key, this.capacity, this.windowMs);
  }

  /**
   * Static helper to check rate limit for a key against a sliding-window LeakyBucket.
   */
  public static check(key: string, limit: number = 30, windowMs: number = 60000): RateLimitResult {
    return checkRateLimit(key, limit, windowMs);
  }

  /**
   * Clears rate limit state for a key or all keys.
   */
  public static reset(key?: string) {
    resetRateLimit(key);
  }
}

/**
 * Clears rate limit state for a key or all keys (useful for testing).
 */
export function resetRateLimit(key?: string) {
  if (key) {
    rateLimitMap.delete(key);
  } else {
    rateLimitMap.clear();
  }
}


