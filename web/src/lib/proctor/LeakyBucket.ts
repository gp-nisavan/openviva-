/**
 * Leaky Bucket Cognitive Suspicion Accumulator
 *
 * Mathematically derived from cognitive psychology:
 * - Natural thinking pauses (looking up or slightly away while recalling memory)
 *   last between 1.0s and 2.0s (95th percentile).
 * - Dishonest glances (reading secondary monitors, notes on desk, phone) exceed 3.0s
 *   or occur in rapid repeated saccades.
 *
 * Dynamics:
 * - FILL_RATE = 28.0 pts/sec (when gaze is OFF-SCREEN)
 *   Requires 3.57 seconds of continuous off-screen gaze to hit 100 (Infraction).
 * - DRAIN_RATE = 40.0 pts/sec (when gaze returns ON-SCREEN)
 *   Recovers from a 1.5s thinking pause (42 pts) within ~1.05s of eye contact.
 * - CAPACITY = 100.0 pts max.
 */

export type SuspicionState = "FOCUSED" | "ACCUMULATING" | "INFRACTION";

export interface LeakyBucketConfig {
  fillRate?: number;    // Points per second added when off-screen (default: 28)
  drainRate?: number;   // Points per second drained when on-screen (default: 40)
  capacity?: number;    // Overflow alert threshold (default: 100)
}

export class LeakyBucket {
  public fillRate: number;
  public drainRate: number;
  public capacity: number;

  private score = 0;
  private lastTimestamp: number | null = null;
  private infractionTriggered = false;
  private offScreenDuration = 0;

  // Event callbacks
  public onScoreChange?: (score: number) => void;
  public onInfraction?: (durationSec: number) => void;
  public onStateChange?: (state: SuspicionState) => void;

  constructor(config?: LeakyBucketConfig) {
    this.fillRate = config?.fillRate ?? 28.0;
    this.drainRate = config?.drainRate ?? 40.0;
    this.capacity = config?.capacity ?? 100.0;
  }

  /**
   * Updates the leaky bucket state with the current gaze boundary status.
   * @param isOffScreen True if the candidate's gaze is outside the calibrated monitor bounds.
   * @param timestamp Current timestamp in milliseconds (e.g., performance.now()).
   * @returns Current suspicion score (0 to 100).
   */
  public update(isOffScreen: boolean, timestamp: number): number {
    if (this.lastTimestamp === null) {
      this.lastTimestamp = timestamp;
      return this.score;
    }

    const dt = Math.max(0, (timestamp - this.lastTimestamp) / 1000.0);
    this.lastTimestamp = timestamp;

    const prevState = this.getState();

    if (isOffScreen) {
      this.offScreenDuration += dt;
      this.score = Math.min(this.capacity, this.score + this.fillRate * dt);

      // Check for infraction overflow
      if (this.score >= this.capacity && !this.infractionTriggered) {
        this.infractionTriggered = true;
        this.onInfraction?.(this.offScreenDuration);
      }
    } else {
      // Gaze returned on-screen: drain the bucket
      this.offScreenDuration = 0;
      this.score = Math.max(0, this.score - this.drainRate * dt);

      if (this.score < this.capacity * 0.70) {
        // Reset infraction lock once candidate has maintained focused recovery
        this.infractionTriggered = false;
      }
    }

    this.onScoreChange?.(this.score);

    const currentState = this.getState();
    if (currentState !== prevState) {
      this.onStateChange?.(currentState);
    }

    return this.score;
  }

  public getScore(): number {
    return this.score;
  }

  public getState(): SuspicionState {
    if (this.score >= this.capacity) return "INFRACTION";
    if (this.score > 20) return "ACCUMULATING";
    return "FOCUSED";
  }

  public reset(): void {
    this.score = 0;
    this.lastTimestamp = null;
    this.infractionTriggered = false;
    this.offScreenDuration = 0;
    this.onScoreChange?.(0);
    this.onStateChange?.("FOCUSED");
  }
}
