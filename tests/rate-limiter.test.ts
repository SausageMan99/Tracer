import { describe, it, expect, afterEach } from "vitest";
import { createRateLimiter } from "@/lib/rate-limiter";

describe("createRateLimiter", () => {
  const limiters: ReturnType<typeof createRateLimiter>[] = [];

  afterEach(() => {
    for (const l of limiters) l.dispose();
    limiters.length = 0;
  });

  function make(limit: number, windowMs: number) {
    const l = createRateLimiter({ limit, windowMs, evictionIntervalMs: 100_000 });
    limiters.push(l);
    return l;
  }

  it("allows requests up to the limit", () => {
    const limiter = make(3, 60_000);

    expect(limiter.isLimited("1.1.1.1")).toBe(false);
    expect(limiter.isLimited("1.1.1.1")).toBe(false);
    expect(limiter.isLimited("1.1.1.1")).toBe(false);
    expect(limiter.isLimited("1.1.1.1")).toBe(true);
  });

  it("tracks IPs independently", () => {
    const limiter = make(1, 60_000);

    expect(limiter.isLimited("a")).toBe(false);
    expect(limiter.isLimited("a")).toBe(true);
    expect(limiter.isLimited("b")).toBe(false);
    expect(limiter.isLimited("b")).toBe(true);
  });

  it("resets after the window expires", () => {
    const limiter = make(1, 1); // 1ms window

    expect(limiter.isLimited("x")).toBe(false);
    // After 1ms the window has expired
    // Sleep briefly then retry
    const start = Date.now();
    while (Date.now() - start < 5) {
      // busy wait
    }
    expect(limiter.isLimited("x")).toBe(false);
  });
});
