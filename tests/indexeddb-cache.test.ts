import { describe, it, expect, beforeEach } from "vitest";
import "fake-indexeddb/auto";
import { IndexedDBCache } from "../lib/engine/adapters/indexeddb-cache";

describe("IndexedDBCache", () => {
  let cache: IndexedDBCache;

  beforeEach(() => {
    cache = new IndexedDBCache(7 * 24 * 60 * 60 * 1000);
  });

  it("returns null for missing key", async () => {
    expect(await cache.load("missing")).toBeNull();
  });

  it("saves and loads data", async () => {
    const data = {
      nodes: [],
      edges: [],
      center: { lat: 48.73, lng: -0.09 },
      radiusKm: 5.6,
      scenicWayIds: [],
      cachedAt: Date.now(),
    };
    await cache.save("test-key", data);
    const loaded = await cache.load("test-key");
    expect(loaded).not.toBeNull();
    expect(loaded!.center.lat).toBe(48.73);
  });

  it("returns null for expired entries", async () => {
    const data = {
      nodes: [],
      edges: [],
      center: { lat: 48.73, lng: -0.09 },
      radiusKm: 5.6,
      scenicWayIds: [],
      cachedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    };
    await cache.save("expired-key", data);
    expect(await cache.load("expired-key")).toBeNull();
  });
});
