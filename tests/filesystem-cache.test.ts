import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { FilesystemCache } from "../lib/engine/adapters/filesystem-cache";
import { buildCacheKey } from "../lib/engine/adapters/cache-adapter";
import * as fs from "fs";
import * as path from "path";

const TEST_CACHE_DIR = path.join(process.cwd(), ".cache", "test-graphs");

describe("FilesystemCache", () => {
  let cache: FilesystemCache;

  beforeEach(() => {
    cache = new FilesystemCache(TEST_CACHE_DIR, 7 * 24 * 60 * 60 * 1000);
  });

  afterEach(() => {
    if (fs.existsSync(TEST_CACHE_DIR)) {
      fs.rmSync(TEST_CACHE_DIR, { recursive: true });
    }
  });

  it("returns null for missing key", async () => {
    const result = await cache.load("nonexistent");
    expect(result).toBeNull();
  });

  it("saves and loads graph data", async () => {
    const key = buildCacheKey(48.73, -0.09, 5.6);
    const data = {
      nodes: [["n1", { id: "n1", lat: 48.73, lng: -0.09, edges: [] }]] as [string, any][],
      edges: [],
      center: { lat: 48.73, lng: -0.09 },
      radiusKm: 5.6,
      scenicWayIds: [],
      cachedAt: Date.now(),
    };
    await cache.save(key, data);
    const loaded = await cache.load(key);
    expect(loaded).not.toBeNull();
    expect(loaded!.center.lat).toBe(48.73);
  });

  it("returns null for expired cache", async () => {
    const key = buildCacheKey(48.73, -0.09, 5.6);
    const data = {
      nodes: [],
      edges: [],
      center: { lat: 48.73, lng: -0.09 },
      radiusKm: 5.6,
      scenicWayIds: [],
      cachedAt: Date.now() - 8 * 24 * 60 * 60 * 1000,
    };
    await cache.save(key, data);
    const loaded = await cache.load(key);
    expect(loaded).toBeNull();
  });
});

describe("buildCacheKey", () => {
  it("builds deterministic key", () => {
    expect(buildCacheKey(48.734, -0.087, 5.6)).toBe("48.73_-0.09_5.6");
  });
});
