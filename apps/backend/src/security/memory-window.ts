/**
 * Per-instance fixed-window counter used ONLY as the degraded-mode fallback when Redis is
 * unavailable, so rate limits never silently disappear. Limits then apply per backend instance
 * (weaker than the distributed Redis limits, but never unlimited). Bounded in size.
 */
export class MemoryWindowCounter {
  private readonly windows = new Map<string, { count: number; resetAt: number }>();

  constructor(private readonly maxKeys = 50_000) {}

  hit(key: string, windowMs: number, now = Date.now()): { count: number; remainingMs: number } {
    const existing = this.windows.get(key);
    if (!existing || existing.resetAt <= now) {
      if (this.windows.size >= this.maxKeys) this.evictExpired(now);
      const fresh = { count: 1, resetAt: now + windowMs };
      this.windows.set(key, fresh);
      return { count: 1, remainingMs: windowMs };
    }
    existing.count += 1;
    return { count: existing.count, remainingMs: existing.resetAt - now };
  }

  private evictExpired(now: number): void {
    for (const [key, value] of this.windows) if (value.resetAt <= now) this.windows.delete(key);
    // Still full: drop the oldest entries rather than grow without bound.
    const excess = this.windows.size - Math.floor(this.maxKeys * 0.9);
    if (excess > 0) {
      let removed = 0;
      for (const key of this.windows.keys()) {
        if (removed >= excess) break;
        this.windows.delete(key);
        removed += 1;
      }
    }
  }
}
