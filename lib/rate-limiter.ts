/**
 * Shared in-memory rate limiter with automatic cache eviction.
 *
 * Usage:
 *   const limiter = createRateLimiter({ limit: 10, windowMs: 60_000 });
 *   if (limiter.isLimited(ip)) return 429;
 */

interface RateLimitEntry {
  readonly count: number;
  readonly resetAt: number;
}

interface RateLimiterConfig {
  /** Maximum requests allowed within the window */
  readonly limit: number;
  /** Time window in milliseconds */
  readonly windowMs: number;
  /** How often to prune expired entries (ms). Defaults to windowMs * 2. */
  readonly evictionIntervalMs?: number;
}

interface RateLimiter {
  /** Returns true if the IP has exceeded the rate limit. Increments the counter. */
  isLimited: (ip: string) => boolean;
  /** Stop the eviction timer (for tests / cleanup). */
  dispose: () => void;
}

export function createRateLimiter(config: RateLimiterConfig): RateLimiter {
  const { limit, windowMs } = config;
  const evictionInterval = config.evictionIntervalMs ?? windowMs * 2;
  const entries = new Map<string, RateLimitEntry>();

  // Periodic eviction of expired entries
  const timer = setInterval(() => {
    const now = Date.now();
    for (const [ip, entry] of entries) {
      if (now > entry.resetAt) {
        entries.delete(ip);
      }
    }
  }, evictionInterval);

  // Allow the process to exit even if the timer is still running
  if (timer.unref) {
    timer.unref();
  }

  return {
    isLimited(ip: string): boolean {
      const now = Date.now();
      const entry = entries.get(ip);

      if (!entry || now > entry.resetAt) {
        entries.set(ip, { count: 1, resetAt: now + windowMs });
        return false;
      }

      if (entry.count >= limit) {
        return true;
      }

      entries.set(ip, { count: entry.count + 1, resetAt: entry.resetAt });
      return false;
    },

    dispose() {
      clearInterval(timer);
      entries.clear();
    },
  };
}
