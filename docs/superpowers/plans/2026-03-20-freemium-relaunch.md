# TrailForge Freemium Relaunch — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform TrailForge into a freemium product with client-side routing engine, Stripe monetization, and mobile-first design refresh.

**Architecture:** Same V2 engine runs in browser (Web Worker, free tier) and server (paid tier), parameterized by TierConfig. Vercel becomes thin proxy + auth + payments. Landing page rewritten with Handcrafted Trail identity, app uses bottom sheet on mobile.

**Tech Stack:** Next.js 15, React 19, TypeScript, Zustand, Mapbox GL, NextAuth v5, Stripe, Vercel Postgres, Vercel KV, Web Workers, IndexedDB (via `idb`)

**Spec:** `docs/superpowers/specs/2026-03-20-freemium-relaunch-design.md`

**Parallelization opportunities:**
- Tasks 2 + 3 (cache adapter + data fetcher) are independent
- Tasks 6 + 7 (OSM proxy + elevation proxy) are independent
- Tasks 8 + 9 (auth + payments) are independent
- Phase 4 (design refresh) can run in parallel with Phase 2-3 (backend + client engine)
- Task 14 (remove deps) + Task 15 (design tokens) are independent

**Deferred to follow-up:**
- Vercel KV caching layer (CDN cache-control sufficient for launch)
- IndexedDB LRU eviction at 50MB (TTL expiry sufficient for launch)
- Streaming proxy responses (size guard + 413 sufficient for launch)
- Intra-solver cancellation (stage-level cancellation sufficient for launch)

---

## Phase 1: Engine Isolation

These tasks decouple the V2 engine from Node.js APIs and the legacy file, making it runnable in both browser and server.

### Task 1: Extract shared utilities from legacy

**Files:**
- Create: `lib/engine/utils.ts`
- Create: `tests/engine-utils.test.ts`
- Modify: `lib/route-generator-legacy.ts`

- [ ] **Step 1: Write tests for pure utility functions**

```typescript
// tests/engine-utils.test.ts
import { describe, it, expect } from "vitest";
import {
  haversineKm,
  computeAscent,
  computeLoopScore,
  scoreRoute,
  PAVED_SURFACES,
  UNPAVED_SURFACES,
  QUIET_HIGHWAY_TYPES,
  BUSY_HIGHWAY_TYPES,
  TRAIL_HIGHWAY_TYPES,
} from "../lib/engine/utils";

describe("haversineKm", () => {
  it("returns 0 for same point", () => {
    const p = { lat: 48.8566, lng: 2.3522 };
    expect(haversineKm(p, p)).toBe(0);
  });
  it("calculates Paris to Lyon ~390km", () => {
    const paris = { lat: 48.8566, lng: 2.3522 };
    const lyon = { lat: 45.764, lng: 4.8357 };
    const d = haversineKm(paris, lyon);
    expect(d).toBeGreaterThan(380);
    expect(d).toBeLessThan(400);
  });
});

describe("computeAscent", () => {
  it("computes ascent and descent", () => {
    const elevations = [100, 150, 120, 200];
    const result = computeAscent(elevations);
    expect(result.ascendM).toBe(130); // +50 + +80
    expect(result.descendM).toBe(30); // -30
  });
  it("returns zero for flat", () => {
    const result = computeAscent([100, 100, 100]);
    expect(result.ascendM).toBe(0);
    expect(result.descendM).toBe(0);
  });
});

describe("computeLoopScore", () => {
  it("returns 1.0 for perfect loop", () => {
    const start = { lat: 48.8566, lng: 2.3522 };
    const points = [
      { lat: 48.86, lng: 2.36 },
      { lat: 48.8566, lng: 2.3522 },
    ];
    expect(computeLoopScore(points, start)).toBeCloseTo(1.0, 1);
  });
});

describe("constants", () => {
  it("PAVED_SURFACES contains asphalt", () => {
    expect(PAVED_SURFACES.has("asphalt")).toBe(true);
  });
  it("TRAIL_HIGHWAY_TYPES contains path", () => {
    expect(TRAIL_HIGHWAY_TYPES.has("path")).toBe(true);
  });
});
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run tests/engine-utils.test.ts`
Expected: FAIL — module `lib/engine/utils` not found

- [ ] **Step 3: Create `lib/engine/utils.ts`**

Copy the following functions and constants from `lib/route-generator-legacy.ts` into `lib/engine/utils.ts` (search by name, not line number — lines may have shifted):
- `haversineKm` — great-circle distance
- `computeAscent` — D+/D- from elevation array
- `computeLoopScore` — loop quality metric
- `scoreRoute` — multi-criteria scoring
- `PAVED_SURFACES`, `UNPAVED_SURFACES`, `TRAIL_HIGHWAY_TYPES`, `QUIET_HIGHWAY_TYPES`, `BUSY_HIGHWAY_TYPES` — surface/highway constant Sets

Import `Coordinate`, `RouteCandidate`, `RoutePoint`, `SessionProfile` from `../types`.

Do NOT copy `fetchElevations`, `geocodeAddress` — those have side effects and will be handled by the data fetcher interface (Task 3).

- [ ] **Step 4: Run test — verify it passes**

Run: `npx vitest run tests/engine-utils.test.ts`
Expected: PASS

- [ ] **Step 5: Update legacy file to re-export from utils**

In `lib/route-generator-legacy.ts`, replace the original function/constant definitions with re-exports:
```typescript
export {
  haversineKm,
  computeAscent,
  computeLoopScore,
  scoreRoute,
  PAVED_SURFACES,
  UNPAVED_SURFACES,
  TRAIL_HIGHWAY_TYPES,
  QUIET_HIGHWAY_TYPES,
  BUSY_HIGHWAY_TYPES,
} from "./engine/utils";
```

This preserves backward compatibility for any other importers.

- [ ] **Step 6: Run all existing tests**

Run: `npx vitest run`
Expected: All existing tests pass (no regressions from re-export)

- [ ] **Step 7: Commit**

```bash
git add lib/engine/utils.ts tests/engine-utils.test.ts lib/route-generator-legacy.ts
git commit -m "refactor: extract pure utilities from legacy to lib/engine/utils"
```

---

### Task 2: Create cache adapter interface

**Files:**
- Create: `lib/engine/adapters/cache-adapter.ts`
- Create: `lib/engine/adapters/filesystem-cache.ts`
- Create: `tests/filesystem-cache.test.ts`
- Modify: `lib/engine/graph-builder.ts`

- [ ] **Step 1: Write the cache adapter interface**

```typescript
// lib/engine/adapters/cache-adapter.ts
import type { Coordinate, EnrichedEdge, GraphNode } from "../../types";

export interface CachedGraph {
  readonly nodes: readonly [string, GraphNode][];
  readonly edges: readonly [string, EnrichedEdge][];
  readonly center: Coordinate;
  readonly radiusKm: number;
  readonly scenicWayIds: readonly string[];
  readonly cachedAt: number;
}

export interface CacheAdapter {
  load(key: string): Promise<CachedGraph | null>;
  save(key: string, data: CachedGraph): Promise<void>;
}

export function buildCacheKey(lat: number, lng: number, radiusKm: number): string {
  return `${lat.toFixed(2)}_${lng.toFixed(2)}_${radiusKm.toFixed(1)}`;
}
```

- [ ] **Step 2: Write tests for filesystem cache**

```typescript
// tests/filesystem-cache.test.ts
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
      nodes: [["n1", { id: "n1", lat: 48.73, lng: -0.09, edges: [] }]] as const,
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
      cachedAt: Date.now() - 8 * 24 * 60 * 60 * 1000, // 8 days ago
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
```

- [ ] **Step 3: Run test — verify it fails**

Run: `npx vitest run tests/filesystem-cache.test.ts`
Expected: FAIL — module not found

- [ ] **Step 4: Implement FilesystemCache**

```typescript
// lib/engine/adapters/filesystem-cache.ts
import type { CacheAdapter, CachedGraph } from "./cache-adapter";
import * as fs from "fs";
import * as path from "path";

export class FilesystemCache implements CacheAdapter {
  constructor(
    private readonly cacheDir: string,
    private readonly ttlMs: number
  ) {}

  async load(key: string): Promise<CachedGraph | null> {
    const filePath = path.join(this.cacheDir, `${key}.json`);
    if (!fs.existsSync(filePath)) return null;

    try {
      const raw = fs.readFileSync(filePath, "utf-8");
      const data: CachedGraph = JSON.parse(raw);
      if (Date.now() - data.cachedAt > this.ttlMs) {
        fs.unlinkSync(filePath);
        return null;
      }
      return data;
    } catch {
      return null;
    }
  }

  async save(key: string, data: CachedGraph): Promise<void> {
    fs.mkdirSync(this.cacheDir, { recursive: true });
    const filePath = path.join(this.cacheDir, `${key}.json`);
    fs.writeFileSync(filePath, JSON.stringify(data));
  }
}
```

- [ ] **Step 5: Run test — verify it passes**

Run: `npx vitest run tests/filesystem-cache.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/engine/adapters/ tests/filesystem-cache.test.ts
git commit -m "feat: add cache adapter interface + filesystem implementation"
```

---

### Task 3: Create data fetcher interface

**Files:**
- Create: `lib/engine/adapters/data-fetcher.ts`
- Create: `lib/engine/adapters/direct-fetcher.ts`
- Create: `tests/data-fetcher.test.ts`

- [ ] **Step 1: Write the data fetcher interface**

```typescript
// lib/engine/adapters/data-fetcher.ts
import type { Coordinate } from "../../types";

export interface DataFetcher {
  fetchOverpassData(center: Coordinate, radiusKm: number): Promise<OverpassResponse>;
  fetchElevations(coords: Coordinate[]): Promise<number[]>;
}

// Re-export existing types from lib/types.ts — do NOT redefine
export type { OverpassResponse, OverpassElement } from "../../types";
```

- [ ] **Step 2: Write test for DirectFetcher (unit test with mocked fetch)**

```typescript
// tests/data-fetcher.test.ts
import { describe, it, expect, vi } from "vitest";
import { DirectFetcher } from "../lib/engine/adapters/direct-fetcher";

describe("DirectFetcher", () => {
  it("fetches elevations in batches of 100", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ elevation: Array(50).fill(150) }),
    });
    global.fetch = mockFetch;

    const fetcher = new DirectFetcher();
    const coords = Array(50).fill({ lat: 48.73, lng: -0.09 });
    const elevations = await fetcher.fetchElevations(coords);

    expect(elevations).toHaveLength(50);
    expect(elevations[0]).toBe(150);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("returns zeros on fetch failure", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const fetcher = new DirectFetcher();
    const coords = [{ lat: 48.73, lng: -0.09 }];
    const elevations = await fetcher.fetchElevations(coords);

    expect(elevations).toEqual([0]);
  });
});
```

- [ ] **Step 3: Run test — verify it fails**

Run: `npx vitest run tests/data-fetcher.test.ts`
Expected: FAIL

- [ ] **Step 4: Implement DirectFetcher**

Extract `fetchElevations` logic from `lib/route-generator-legacy.ts` (lines 458-489) and the Overpass fetch logic from `lib/engine/graph-builder.ts` (lines 112-158) into `DirectFetcher`.

```typescript
// lib/engine/adapters/direct-fetcher.ts
import type { Coordinate } from "../../types";
import type { DataFetcher, OverpassResponse } from "./data-fetcher";

const ELEVATION_BATCH_SIZE = 100;
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
];

export class DirectFetcher implements DataFetcher {
  async fetchOverpassData(center: Coordinate, radiusKm: number): Promise<OverpassResponse> {
    const query = buildOverpassQuery(center, radiusKm);
    let lastError: Error | null = null;

    for (let attempt = 0; attempt < 3; attempt++) {
      for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
          const controller = new AbortController();
          const timeout = setTimeout(() => controller.abort(), attempt === 0 ? 30000 : 20000);
          const resp = await fetch(endpoint, {
            method: "POST",
            body: `data=${encodeURIComponent(query)}`,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            signal: controller.signal,
          });
          clearTimeout(timeout);
          if (resp.ok) return await resp.json();
          if (resp.status === 429 || resp.status === 503) continue;
          lastError = new Error(`Overpass ${resp.status}`);
        } catch (e) {
          lastError = e instanceof Error ? e : new Error(String(e));
        }
      }
      if (attempt < 2) await new Promise((r) => setTimeout(r, (attempt + 1) * 1000));
    }
    throw lastError ?? new Error("Overpass fetch failed");
  }

  async fetchElevations(coords: Coordinate[]): Promise<number[]> {
    if (coords.length === 0) return [];
    const results: number[] = [];

    for (let i = 0; i < coords.length; i += ELEVATION_BATCH_SIZE) {
      const batch = coords.slice(i, i + ELEVATION_BATCH_SIZE);
      try {
        const lats = batch.map((c) => c.lat.toFixed(6)).join(",");
        const lngs = batch.map((c) => c.lng.toFixed(6)).join(",");
        const resp = await fetch(
          `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`,
          { signal: AbortSignal.timeout(10000) }
        );
        if (!resp.ok) throw new Error(`Elevation API ${resp.status}`);
        const data = await resp.json();
        results.push(...(data.elevation ?? batch.map(() => 0)));
      } catch {
        results.push(...batch.map(() => 0));
      }
    }
    return results;
  }
}

function buildOverpassQuery(center: Coordinate, radiusKm: number): string {
  const r = radiusKm * 1000;
  return `[out:json][timeout:25];(
    way(around:${r},${center.lat},${center.lng})["highway"~"^(secondary|tertiary|unclassified|residential|service|living_street|pedestrian|track|path|cycleway|bridleway|footway|secondary_link|tertiary_link)$"];
    way(around:${r},${center.lat},${center.lng})["natural"~"^(water|wood|forest)$"];
    way(around:${r},${center.lat},${center.lng})["landuse"~"^(forest|wood)$"];
    way(around:${r},${center.lat},${center.lng})["leisure"="nature_reserve"];
    node(around:${r},${center.lat},${center.lng})["tourism"="viewpoint"];
    way(around:${r},${center.lat},${center.lng})["waterway"~"^(river|stream)$"];
    way(around:${r},${center.lat},${center.lng})["boundary"="national_park"];
  );out body;>;out skel qt;`;
}
```

- [ ] **Step 5: Run test — verify it passes**

Run: `npx vitest run tests/data-fetcher.test.ts`
Expected: PASS

- [ ] **Step 6: Commit**

```bash
git add lib/engine/adapters/data-fetcher.ts lib/engine/adapters/direct-fetcher.ts tests/data-fetcher.test.ts
git commit -m "feat: add data fetcher interface + direct implementation"
```

---

### Task 4: Add TierConfig to solver

**Files:**
- Create: `lib/engine/tier-config.ts`
- Modify: `lib/engine/orienteering-solver.ts`
- Modify: `lib/engine/edge-scorer.ts`
- Create: `tests/tier-config.test.ts`

- [ ] **Step 1: Write TierConfig interface and presets**

```typescript
// lib/engine/tier-config.ts
export interface SolverConfig {
  readonly beamWidth: number;
  readonly temperature: number;
  readonly seedBearing: number;
}

export interface TierConfig {
  readonly solverConfigs: readonly SolverConfig[];
  readonly maxIterations: number;
  readonly earlyK: number;
  readonly lateK: number;
  readonly enableFullScenic: boolean;
  readonly maxCandidates: number;
  readonly deduplicationMode: "distance" | "jaccard";
}

export const FREE_TIER: TierConfig = {
  solverConfigs: [
    { beamWidth: 20, temperature: 0.25, seedBearing: 0 },
    { beamWidth: 20, temperature: 0.25, seedBearing: 180 },
  ],
  maxIterations: 800,
  earlyK: 2,
  lateK: 1,
  enableFullScenic: false,
  maxCandidates: 1,
  deduplicationMode: "distance",
};

export const PRO_TIER: TierConfig = {
  solverConfigs: [
    { beamWidth: 60, temperature: 0.2, seedBearing: 0 },
    { beamWidth: 40, temperature: 0.3, seedBearing: 72 },
    { beamWidth: 80, temperature: 0.15, seedBearing: 144 },
    { beamWidth: 50, temperature: 0.25, seedBearing: 216 },
    { beamWidth: 70, temperature: 0.2, seedBearing: 288 },
  ],
  maxIterations: 2000,
  earlyK: 3,
  lateK: 2,
  enableFullScenic: true,
  maxCandidates: 6,
  deduplicationMode: "jaccard",
};
```

- [ ] **Step 2: Write tests for tier config behavior**

```typescript
// tests/tier-config.test.ts
import { describe, it, expect } from "vitest";
import { FREE_TIER, PRO_TIER } from "../lib/engine/tier-config";

describe("TierConfig presets", () => {
  it("free tier has 2 solver configs", () => {
    expect(FREE_TIER.solverConfigs).toHaveLength(2);
  });
  it("pro tier has 5 solver configs", () => {
    expect(PRO_TIER.solverConfigs).toHaveLength(5);
  });
  it("free tier disables full scenic", () => {
    expect(FREE_TIER.enableFullScenic).toBe(false);
  });
  it("pro tier enables full scenic", () => {
    expect(PRO_TIER.enableFullScenic).toBe(true);
  });
  it("free tier returns 1 candidate", () => {
    expect(FREE_TIER.maxCandidates).toBe(1);
  });
  it("pro tier returns 6 candidates", () => {
    expect(PRO_TIER.maxCandidates).toBe(6);
  });
});
```

- [ ] **Step 3: Run test — verify it passes**

Run: `npx vitest run tests/tier-config.test.ts`
Expected: PASS

- [ ] **Step 4: Update `orienteering-solver.ts` to accept TierConfig**

Modify `solve()` signature (line ~595) to accept `tierConfig` parameter:

```typescript
export async function solve(
  graph: EnrichedGraph,
  startNodeId: string,
  targetDistanceKm: number,
  targetElevationM: number = 0,
  nodeElevation: Map<string, number> = new Map(),
  tierConfig: TierConfig = PRO_TIER
): Promise<SolverPath[]>
```

Inside `solve()`:
- Replace `SOLVER_CONFIGS` with `tierConfig.solverConfigs`
- Replace `MAX_ITERATIONS` with `tierConfig.maxIterations`
- Limit final output to `tierConfig.maxCandidates`
- Replace `deduplicatePaths` call with conditional based on `tierConfig.deduplicationMode`

Update `solveWithConfig()` signature to accept `earlyK` and `lateK`:
```typescript
async function solveWithConfig(
  graph: EnrichedGraph,
  startNodeId: string,
  targetDistanceKm: number,
  targetElevationM: number,
  nodeElevation: Map<string, number>,
  config: SolverConfig, // from tier-config.ts (no expansionFactor)
  earlyK: number,
  lateK: number,
  maxIterations: number
): Promise<SolverPath[]>
```

Replace expansion factor usage inside `solveWithConfig`:
```typescript
// OLD: const k = progress < 0.6 ? config.expansionFactor : Math.max(2, config.expansionFactor - 1);
// NEW:
const k = progress < 0.6 ? earlyK : lateK;
```

In `solve()`, pass `tierConfig.earlyK`, `tierConfig.lateK`, `tierConfig.maxIterations` to each `solveWithConfig` call.

Remove the old `SolverConfig` interface and `SOLVER_CONFIGS` constant (now in `tier-config.ts`).

- [ ] **Step 5: Update `edge-scorer.ts` for enableFullScenic**

In `deriveWeights()`, accept optional `enableFullScenic` parameter:
```typescript
export function deriveWeights(
  profile: SessionProfile,
  scenicMode?: boolean,
  enableFullScenic: boolean = true
): SessionWeights
```

When `enableFullScenic` is false, set `quietness` weight to 0 and redistribute to other weights.

In `scoreEdges()`, accept `enableFullScenic` and skip `litBonus` when false:
```typescript
const litBonus = enableFullScenic && edge.lit === "yes" ? 0.05 : 0;
```

- [ ] **Step 6: Run all existing tests**

Run: `npx vitest run`
Expected: All tests pass. The solver and edge-scorer tests should still work because `PRO_TIER` matches the original constants.

- [ ] **Step 7: Commit**

```bash
git add lib/engine/tier-config.ts lib/engine/orienteering-solver.ts lib/engine/edge-scorer.ts tests/tier-config.test.ts
git commit -m "feat: add TierConfig parameterization to solver and scorer"
```

---

### Task 5: Wire engine with adapter interfaces

**Files:**
- Modify: `lib/engine/graph-builder.ts`
- Modify: `lib/engine/edge-scorer.ts`
- Modify: `lib/engine/route-post-processor.ts`
- Modify: `lib/engine/index.ts`
- Modify: all engine imports from legacy → `utils.ts`

- [ ] **Step 1: Update graph-builder to use CacheAdapter + DataFetcher**

Change `buildGraph` signature to accept adapters:
```typescript
export async function buildGraph(
  center: Coordinate,
  targetDistanceKm: number,
  cache: CacheAdapter,
  fetcher: DataFetcher
): Promise<{ graph: EnrichedGraph; scenicWayIds: Set<string> }>
```

- Remove `import * as fs from "fs"` and `import * as path from "path"`
- Remove `CACHE_DIR`, `CACHE_TTL_MS` constants
- Remove `tryLoadCache()` and `saveCache()` private functions
- Replace with `cache.load(key)` and `cache.save(key, data)` calls
- Replace inline Overpass fetch with `fetcher.fetchOverpassData(center, radiusKm)`
- Change `import { haversineKm } from "../route-generator-legacy"` → `import { haversineKm } from "./utils"`

- [ ] **Step 2: Update edge-scorer imports**

Change `import { fetchElevations, PAVED_SURFACES, ... } from "../route-generator-legacy"` to:
```typescript
import { PAVED_SURFACES, UNPAVED_SURFACES, QUIET_HIGHWAY_TYPES, BUSY_HIGHWAY_TYPES, TRAIL_HIGHWAY_TYPES } from "./utils";
```

Update `scoreEdges` to accept a `DataFetcher`:
```typescript
export async function scoreEdges(
  graph: EnrichedGraph,
  weights: SessionWeights,
  profile: SessionProfile,
  scenicWayIds: Set<string>,
  fetcher: DataFetcher,
  enableFullScenic: boolean = true
): Promise<{ nodeElevation: Map<string, number> }>
```

Replace `fetchElevations(coords)` with `fetcher.fetchElevations(coords)`.

- [ ] **Step 3: Update route-post-processor imports**

Change imports from legacy to:
```typescript
import { computeAscent, scoreRoute, computeLoopScore } from "./utils";
```

Also remove the `fetchElevations` import from legacy — elevation fetching is now done via `DataFetcher` passed as parameter.

Update `postProcess` to accept a `DataFetcher` for elevation fallback:
```typescript
export async function postProcess(
  paths: SolverPath[],
  graph: EnrichedGraph,
  startCoordinate: Coordinate,
  profile: SessionProfile,
  targetDistanceKm: number,
  targetElevationM: number,
  nodeElevation: Map<string, number>,
  fetcher: DataFetcher,
  maxCandidates: number = 6
): Promise<RouteCandidate[]>
```

- [ ] **Step 4: Update index.ts pipeline to pass adapters**

```typescript
import { FilesystemCache } from "./adapters/filesystem-cache";
import { DirectFetcher } from "./adapters/direct-fetcher";
import type { CacheAdapter } from "./adapters/cache-adapter";
import type { DataFetcher } from "./adapters/data-fetcher";
import type { TierConfig } from "./tier-config";
import { PRO_TIER } from "./tier-config";
import { geocodeAddress } from "../route-generator-legacy"; // geocoding stays in caller
import { haversineKm } from "./utils";

const defaultCache = new FilesystemCache(
  path.join(process.cwd(), ".cache", "graphs"),
  7 * 24 * 60 * 60 * 1000
);
const defaultFetcher = new DirectFetcher();

export async function generateRouteV2(
  request: RouteRequest,
  tierConfig: TierConfig = PRO_TIER,
  cache: CacheAdapter = defaultCache,
  fetcher: DataFetcher = defaultFetcher
): Promise<GeneratedRoute>
```

Thread `cache`, `fetcher`, and `tierConfig` through to `buildGraph`, `scoreEdges`, `solve`, and `postProcess`.

- [ ] **Step 5: Update all engine file imports from legacy to utils**

In `orienteering-solver.ts`: `import { haversineKm } from "./utils"`
In `pathfinder.ts`: `import { haversineKm } from "./utils"`

- [ ] **Step 6: Run all tests**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 7: Commit**

```bash
git add lib/engine/
git commit -m "refactor: wire engine with cache adapter + data fetcher interfaces"
```

---

## Phase 2: Backend Infrastructure

### Task 6: OSM proxy endpoint

**Files:**
- Create: `app/api/proxy/osm/route.ts`
- Create: `tests/proxy-osm.test.ts`

- [ ] **Step 1: Write test**

```typescript
// tests/proxy-osm.test.ts
import { describe, it, expect } from "vitest";

describe("OSM proxy validation", () => {
  it("rejects missing lat param", async () => {
    const url = new URL("http://localhost/api/proxy/osm?lng=-0.09&radius=5.6");
    // Validate that the handler returns 400 for missing lat
    const { validateParams } = await import("../app/api/proxy/osm/route");
    expect(() => validateParams(url.searchParams)).toThrow();
  });
  it("rejects radius > 25", async () => {
    const url = new URL("http://localhost/api/proxy/osm?lat=48.73&lng=-0.09&radius=30");
    const { validateParams } = await import("../app/api/proxy/osm/route");
    expect(() => validateParams(url.searchParams)).toThrow();
  });
});
```

- [ ] **Step 2: Implement proxy endpoint**

```typescript
// app/api/proxy/osm/route.ts
import { NextRequest, NextResponse } from "next/server";
import { DirectFetcher } from "@/lib/engine/adapters/direct-fetcher";

const fetcher = new DirectFetcher();

export function validateParams(params: URLSearchParams) {
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  const radius = Number(params.get("radius"));
  if (isNaN(lat) || isNaN(lng) || isNaN(radius)) throw new Error("Missing params");
  if (radius > 25) throw new Error("Radius too large");
  if (radius < 0.5) throw new Error("Radius too small");
  return { lat, lng, radius };
}

export async function GET(request: NextRequest) {
  try {
    const { lat, lng, radius } = validateParams(request.nextUrl.searchParams);
    const data = await fetcher.fetchOverpassData({ lat, lng }, radius);
    const json = JSON.stringify(data);

    if (json.length > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "GRAPH_TOO_LARGE", message: "Reduce target distance" },
        { status: 413 }
      );
    }

    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
```

**Deferred:** Vercel KV caching layer is deferred to a follow-up task. CDN Cache-Control headers provide the server-side cache layer for now. IndexedDB provides the primary client-side cache.

**Streaming note:** For large Overpass responses (>4.5MB), Vercel serverless has a buffered response limit. If this becomes an issue in production, convert the proxy to stream the Overpass response via `ReadableStream`. For now, the 10MB size check + 413 rejection is a safe guard.

- [ ] **Step 3: Run test — verify it passes**

Run: `npx vitest run tests/proxy-osm.test.ts`

- [ ] **Step 4: Commit**

```bash
git add app/api/proxy/osm/route.ts tests/proxy-osm.test.ts
git commit -m "feat: add OSM proxy endpoint with validation"
```

---

### Task 7: Elevation proxy endpoint

**Files:**
- Create: `app/api/proxy/elevation/route.ts`
- Create: `tests/proxy-elevation.test.ts`

- [ ] **Step 1: Write test**

```typescript
// tests/proxy-elevation.test.ts
import { describe, it, expect } from "vitest";

describe("Elevation proxy validation", () => {
  it("rejects empty coordinates", async () => {
    const { validateBody } = await import("../app/api/proxy/elevation/route");
    expect(() => validateBody({ coordinates: [] })).toThrow();
  });
  it("rejects > 500 coordinates", async () => {
    const { validateBody } = await import("../app/api/proxy/elevation/route");
    const coords = Array(501).fill({ lat: 48.73, lng: -0.09 });
    expect(() => validateBody({ coordinates: coords })).toThrow();
  });
  it("accepts valid coordinates", async () => {
    const { validateBody } = await import("../app/api/proxy/elevation/route");
    const result = validateBody({ coordinates: [{ lat: 48.73, lng: -0.09 }] });
    expect(result).toHaveLength(1);
  });
});
```

- [ ] **Step 2: Implement elevation proxy**

```typescript
// app/api/proxy/elevation/route.ts
import { NextRequest, NextResponse } from "next/server";
import type { Coordinate } from "@/lib/types";
import { DirectFetcher } from "@/lib/engine/adapters/direct-fetcher";

const fetcher = new DirectFetcher();

export function validateBody(body: unknown): Coordinate[] {
  const { coordinates } = body as { coordinates: Coordinate[] };
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    throw new Error("coordinates array required");
  }
  if (coordinates.length > 500) {
    throw new Error("Max 500 coordinates per request");
  }
  return coordinates;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const coords = validateBody(body);
    const elevations = await fetcher.fetchElevations(coords);
    return NextResponse.json(
      { elevations },
      {
        headers: { "Cache-Control": "public, max-age=604800" },
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
```

- [ ] **Step 3: Run test — verify it passes**

Run: `npx vitest run tests/proxy-elevation.test.ts`

- [ ] **Step 4: Commit**

```bash
git add app/api/proxy/elevation/route.ts tests/proxy-elevation.test.ts
git commit -m "feat: add elevation proxy endpoint"
```

---

### Task 8: Database schema + NextAuth setup

**Files:**
- Create: `lib/db/schema.sql`
- Create: `lib/db/index.ts`
- Create: `lib/auth.ts`
- Create: `app/api/auth/[...nextauth]/route.ts`
- Modify: `package.json` (add dependencies)

- [ ] **Step 1: Install dependencies**

```bash
npm install next-auth@5 @auth/pg-adapter @vercel/postgres stripe @stripe/stripe-js @vercel/kv idb
```

- [ ] **Step 2: Create database schema**

```sql
-- lib/db/schema.sql
CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  image TEXT,
  email_verified TIMESTAMPTZ,
  tier TEXT NOT NULL DEFAULT 'free',
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT,
  UNIQUE(provider, provider_account_id)
);

CREATE TABLE IF NOT EXISTS verification_tokens (
  identifier TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (identifier, token)
);

CREATE TABLE IF NOT EXISTS subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active',
  current_period_end TIMESTAMPTZ,
  plan TEXT NOT NULL,
  created_at TIMESTAMPTZ DEFAULT now()
);

CREATE TABLE IF NOT EXISTS route_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  route_data JSONB NOT NULL,
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

- [ ] **Step 3: Create database client wrapper**

```typescript
// lib/db/index.ts
import { sql } from "@vercel/postgres";

export { sql };

export async function getUserTier(userId: string): Promise<"free" | "pro"> {
  const result = await sql`SELECT tier FROM users WHERE id = ${userId}`;
  return (result.rows[0]?.tier as "free" | "pro") ?? "free";
}

export async function setUserTier(userId: string, tier: "free" | "pro"): Promise<void> {
  await sql`UPDATE users SET tier = ${tier} WHERE id = ${userId}`;
}
```

- [ ] **Step 4: Create NextAuth config**

```typescript
// lib/auth.ts
import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Nodemailer from "next-auth/providers/nodemailer";
import PostgresAdapter from "@auth/pg-adapter";
import { Pool } from "@vercel/postgres";

const pool = new Pool();

export const { handlers, auth, signIn, signOut } = NextAuth({
  adapter: PostgresAdapter(pool),
  session: { strategy: "jwt" },
  providers: [
    Nodemailer({
      server: process.env.EMAIL_SERVER,
      from: process.env.EMAIL_FROM ?? "TrailForge <noreply@trailforge.app>",
    }),
    Google({
      clientId: process.env.GOOGLE_CLIENT_ID,
      clientSecret: process.env.GOOGLE_CLIENT_SECRET,
    }),
  ],
  callbacks: {
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
      }
      return token;
    },
    async session({ session, token }) {
      if (token.id) {
        session.user.id = token.id as string;
      }
      return session;
    },
  },
  pages: {
    signIn: "/auth/signin",
    verifyRequest: "/auth/verify",
  },
});
```

- [ ] **Step 5: Create NextAuth route handler**

```typescript
// app/api/auth/[...nextauth]/route.ts
import { handlers } from "@/lib/auth";
export const { GET, POST } = handlers;
```

- [ ] **Step 6: Commit**

```bash
git add lib/db/ lib/auth.ts app/api/auth/ package.json package-lock.json
git commit -m "feat: add NextAuth v5 with magic link + Google OAuth + Postgres"
```

---

### Task 9: Stripe integration

**Files:**
- Create: `lib/stripe.ts`
- Create: `app/api/payments/checkout/route.ts`
- Create: `app/api/payments/webhook/route.ts`
- Create: `app/api/payments/portal/route.ts`

- [ ] **Step 1: Create Stripe server helper**

```typescript
// lib/stripe.ts
import Stripe from "stripe";

export const stripe = new Stripe(process.env.STRIPE_SECRET_KEY!, {
  apiVersion: "2025-01-27.acacia",
});

export const PLANS = {
  monthly: {
    priceId: process.env.STRIPE_MONTHLY_PRICE_ID!,
    amount: 899, // 8.99 EUR
  },
  annual: {
    priceId: process.env.STRIPE_ANNUAL_PRICE_ID!,
    amount: 7999, // 79.99 EUR
  },
} as const;
```

- [ ] **Step 2: Create checkout endpoint**

```typescript
// app/api/payments/checkout/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { stripe, PLANS } from "@/lib/stripe";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.email) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const { plan } = (await request.json()) as { plan: "monthly" | "annual" };
  if (!PLANS[plan]) {
    return NextResponse.json({ error: "Invalid plan" }, { status: 400 });
  }

  const checkoutSession = await stripe.checkout.sessions.create({
    customer_email: session.user.email,
    mode: "subscription",
    line_items: [{ price: PLANS[plan].priceId, quantity: 1 }],
    success_url: `${process.env.NEXT_PUBLIC_APP_URL}/app?upgraded=true`,
    cancel_url: `${process.env.NEXT_PUBLIC_APP_URL}/app`,
    metadata: { userId: session.user.id },
  });

  return NextResponse.json({ url: checkoutSession.url });
}
```

- [ ] **Step 3: Create webhook handler**

```typescript
// app/api/payments/webhook/route.ts
import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { setUserTier } from "@/lib/db";
import { sql } from "@vercel/postgres";

export async function POST(request: NextRequest) {
  const body = await request.text();
  const sig = request.headers.get("stripe-signature")!;

  let event;
  try {
    event = stripe.webhooks.constructEvent(body, sig, process.env.STRIPE_WEBHOOK_SECRET!);
  } catch {
    return NextResponse.json({ error: "Invalid signature" }, { status: 400 });
  }

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object;
      const userId = session.metadata?.userId;
      if (userId && session.subscription) {
        await setUserTier(userId, "pro");
        await sql`
          INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, plan)
          VALUES (${userId}, ${session.customer as string}, ${session.subscription as string}, 'active', 'monthly')
          ON CONFLICT (user_id) DO UPDATE SET
            stripe_subscription_id = EXCLUDED.stripe_subscription_id,
            status = 'active'
        `;
      }
      break;
    }
    case "customer.subscription.deleted": {
      const sub = event.data.object;
      await sql`
        UPDATE subscriptions SET status = 'canceled' WHERE stripe_subscription_id = ${sub.id}
      `;
      const result = await sql`
        SELECT user_id FROM subscriptions WHERE stripe_subscription_id = ${sub.id}
      `;
      if (result.rows[0]) {
        await setUserTier(result.rows[0].user_id, "free");
      }
      break;
    }
  }

  return NextResponse.json({ received: true });
}
```

- [ ] **Step 4: Create portal endpoint**

```typescript
// app/api/payments/portal/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { sql } from "@vercel/postgres";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const result = await sql`
    SELECT stripe_customer_id FROM subscriptions WHERE user_id = ${session.user.id}
  `;
  const customerId = result.rows[0]?.stripe_customer_id;
  if (!customerId) {
    return NextResponse.json({ error: "No subscription" }, { status: 404 });
  }

  const portal = await stripe.billingPortal.sessions.create({
    customer: customerId,
    return_url: `${process.env.NEXT_PUBLIC_APP_URL}/app`,
  });

  return NextResponse.json({ url: portal.url });
}
```

- [ ] **Step 5: Commit**

```bash
git add lib/stripe.ts app/api/payments/
git commit -m "feat: add Stripe checkout, webhook, and portal endpoints"
```

---

### Task 9b: Route history endpoints (Pro only)

**Files:**
- Create: `app/api/routes/save/route.ts`
- Create: `app/api/routes/history/route.ts`

- [ ] **Step 1: Create save route endpoint**

```typescript
// app/api/routes/save/route.ts
import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserTier } from "@/lib/db";
import { sql } from "@vercel/postgres";

export async function POST(request: NextRequest) {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tier = await getUserTier(session.user.id);
  if (tier !== "pro") {
    return NextResponse.json({ error: "Pro required" }, { status: 403 });
  }

  const { routeData, name } = await request.json();
  const result = await sql`
    INSERT INTO route_history (user_id, route_data, name)
    VALUES (${session.user.id}, ${JSON.stringify(routeData)}, ${name ?? null})
    RETURNING id, created_at
  `;

  return NextResponse.json({ id: result.rows[0].id, createdAt: result.rows[0].created_at });
}
```

- [ ] **Step 2: Create history endpoint**

```typescript
// app/api/routes/history/route.ts
import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserTier } from "@/lib/db";
import { sql } from "@vercel/postgres";

export async function GET() {
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }
  const tier = await getUserTier(session.user.id);
  if (tier !== "pro") {
    return NextResponse.json({ error: "Pro required" }, { status: 403 });
  }

  const result = await sql`
    SELECT id, name, created_at, route_data
    FROM route_history
    WHERE user_id = ${session.user.id}
    ORDER BY created_at DESC
    LIMIT 50
  `;

  return NextResponse.json({ routes: result.rows });
}
```

- [ ] **Step 3: Commit**

```bash
git add app/api/routes/
git commit -m "feat: add Pro-only route history save/list endpoints"
```

---

## Phase 3: Client-Side Engine

### Task 10: IndexedDB cache adapter

**Files:**
- Create: `lib/engine/adapters/indexeddb-cache.ts`
- Create: `tests/indexeddb-cache.test.ts`

- [ ] **Step 1: Write test (using fake-indexeddb for vitest)**

```bash
npm install -D fake-indexeddb
```

```typescript
// tests/indexeddb-cache.test.ts
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
```

- [ ] **Step 2: Run test — verify it fails**

Run: `npx vitest run tests/indexeddb-cache.test.ts`

- [ ] **Step 3: Implement IndexedDBCache**

```typescript
// lib/engine/adapters/indexeddb-cache.ts
import { openDB } from "idb";
import type { CacheAdapter, CachedGraph } from "./cache-adapter";

const DB_NAME = "trailforge-cache";
const STORE_NAME = "graphs";
const DB_VERSION = 1;

export class IndexedDBCache implements CacheAdapter {
  constructor(private readonly ttlMs: number) {}

  private async getDB() {
    return openDB(DB_NAME, DB_VERSION, {
      upgrade(db) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      },
    });
  }

  async load(key: string): Promise<CachedGraph | null> {
    const db = await this.getDB();
    const data: CachedGraph | undefined = await db.get(STORE_NAME, key);
    if (!data) return null;
    if (Date.now() - data.cachedAt > this.ttlMs) {
      await db.delete(STORE_NAME, key);
      return null;
    }
    return data;
  }

  async save(key: string, data: CachedGraph): Promise<void> {
    const db = await this.getDB();
    await db.put(STORE_NAME, data, key);
  }
}
```

- [ ] **Step 4: Run test — verify it passes**

Run: `npx vitest run tests/indexeddb-cache.test.ts`

- [ ] **Step 5: Commit**

```bash
git add lib/engine/adapters/indexeddb-cache.ts tests/indexeddb-cache.test.ts
git commit -m "feat: add IndexedDB cache adapter for browser"
```

---

### Task 11: Proxy data fetcher for browser

**Files:**
- Create: `lib/engine/adapters/proxy-fetcher.ts`
- Create: `tests/proxy-fetcher.test.ts`

- [ ] **Step 1: Write test**

```typescript
// tests/proxy-fetcher.test.ts
import { describe, it, expect, vi } from "vitest";
import { ProxyFetcher } from "../lib/engine/adapters/proxy-fetcher";

describe("ProxyFetcher", () => {
  it("calls /api/proxy/osm with correct params", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ elements: [] }),
    });
    global.fetch = mockFetch;

    const fetcher = new ProxyFetcher();
    await fetcher.fetchOverpassData({ lat: 48.73, lng: -0.09 }, 5.6);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/proxy/osm?lat=48.73&lng=-0.09&radius=5.6"),
      expect.any(Object)
    );
  });

  it("calls /api/proxy/elevation with POST", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ elevations: [150] }),
    });
    global.fetch = mockFetch;

    const fetcher = new ProxyFetcher();
    const result = await fetcher.fetchElevations([{ lat: 48.73, lng: -0.09 }]);

    expect(result).toEqual([150]);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/proxy/elevation"),
      expect.objectContaining({ method: "POST" })
    );
  });
});
```

- [ ] **Step 2: Implement ProxyFetcher**

```typescript
// lib/engine/adapters/proxy-fetcher.ts
import type { Coordinate } from "../../types";
import type { DataFetcher, OverpassResponse } from "./data-fetcher";

export class ProxyFetcher implements DataFetcher {
  async fetchOverpassData(center: Coordinate, radiusKm: number): Promise<OverpassResponse> {
    const resp = await fetch(
      `/api/proxy/osm?lat=${center.lat}&lng=${center.lng}&radius=${radiusKm}`,
      { signal: AbortSignal.timeout(35000) }
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: "Proxy error" }));
      throw new Error(err.error ?? `Proxy ${resp.status}`);
    }
    return resp.json();
  }

  async fetchElevations(coords: Coordinate[]): Promise<number[]> {
    if (coords.length === 0) return [];
    const resp = await fetch("/api/proxy/elevation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates: coords }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return coords.map(() => 0);
    const data = await resp.json();
    return data.elevations ?? coords.map(() => 0);
  }
}
```

- [ ] **Step 3: Run test — verify it passes**

Run: `npx vitest run tests/proxy-fetcher.test.ts`

- [ ] **Step 4: Commit**

```bash
git add lib/engine/adapters/proxy-fetcher.ts tests/proxy-fetcher.test.ts
git commit -m "feat: add proxy data fetcher for browser-side engine"
```

---

### Task 12: Web Worker wrapper

**Files:**
- Create: `lib/engine/worker.ts`
- Create: `lib/engine/worker-client.ts`
- Create: `lib/engine/worker-types.ts`

- [ ] **Step 1: Define worker message types**

```typescript
// lib/engine/worker-types.ts
import type { Coordinate, RouteCandidate } from "../types";
import type { TierConfig } from "./tier-config";

export type WorkerRequest =
  | {
      type: "generate";
      id: string;
      params: {
        center: Coordinate;
        targetDistanceKm: number;
        targetElevationM: number;
        profileId: string;
        tierConfig: TierConfig;
        scenicMode?: boolean;
      };
    }
  | { type: "cancel"; id: string };

export type WorkerResponse =
  | {
      type: "progress";
      id: string;
      stage: "graph" | "elevation" | "scoring" | "solving" | "postprocess";
      percent: number;
    }
  | { type: "result"; id: string; routes: RouteCandidate[] }
  | { type: "error"; id: string; code: string; message: string };
```

- [ ] **Step 2: Implement the worker entry point**

```typescript
// lib/engine/worker.ts
/// <reference lib="webworker" />

import { IndexedDBCache } from "./adapters/indexeddb-cache";
import { ProxyFetcher } from "./adapters/proxy-fetcher";
import { buildGraph } from "./graph-builder";
import { deriveWeights, scoreEdges } from "./edge-scorer";
import { solve } from "./orienteering-solver";
import { postProcess } from "./route-post-processor";
import { haversineKm } from "./utils";
import { PROFILES_BY_ID } from "../session-profiles";
import type { WorkerRequest, WorkerResponse } from "./worker-types";

const cache = new IndexedDBCache(7 * 24 * 60 * 60 * 1000);
const fetcher = new ProxyFetcher();
const cancelledIds = new Set<string>();

function post(msg: WorkerResponse) {
  self.postMessage(msg);
}

async function handleGenerate(req: Extract<WorkerRequest, { type: "generate" }>) {
  const { id, params } = req;
  const profile = PROFILES_BY_ID.get(params.profileId);
  if (!profile) {
    return post({ type: "error", id, code: "INVALID_PROFILE", message: "Unknown profile" });
  }

  try {
    // Stage 1: Graph
    post({ type: "progress", id, stage: "graph", percent: 10 });
    const { graph, scenicWayIds } = await buildGraph(
      params.center,
      params.targetDistanceKm,
      cache,
      fetcher
    );
    if (cancelledIds.has(id)) return;

    // Find closest start node
    let closestNodeId = "";
    let closestDist = Infinity;
    for (const [nodeId, node] of graph.nodes) {
      const d = haversineKm(params.center, { lat: node.lat, lng: node.lng });
      if (d < closestDist) {
        closestDist = d;
        closestNodeId = nodeId;
      }
    }

    // Stage 2: Elevation
    post({ type: "progress", id, stage: "elevation", percent: 35 });
    const weights = deriveWeights(profile, params.scenicMode, params.tierConfig.enableFullScenic);

    // Stage 3: Scoring
    post({ type: "progress", id, stage: "scoring", percent: 48 });
    const { nodeElevation } = await scoreEdges(
      graph,
      weights,
      profile,
      scenicWayIds,
      fetcher,
      params.tierConfig.enableFullScenic
    );
    if (cancelledIds.has(id)) return;

    // Stage 4: Solving
    // Note: The solver should also check cancelledIds between iterations.
    // Pass a cancellation check function to solve():
    //   cancelCheck: () => cancelledIds.has(id)
    // Inside solveWithConfig, check this every 200 iterations and throw if cancelled.
    post({ type: "progress", id, stage: "solving", percent: 55 });
    const paths = await solve(
      graph,
      closestNodeId,
      params.targetDistanceKm,
      params.targetElevationM,
      nodeElevation,
      params.tierConfig
    );
    if (cancelledIds.has(id)) return;

    // Stage 5: Post-process
    post({ type: "progress", id, stage: "postprocess", percent: 92 });
    const routes = await postProcess(
      paths,
      graph,
      params.center,
      profile,
      params.targetDistanceKm,
      params.targetElevationM,
      nodeElevation,
      fetcher,
      params.tierConfig.maxCandidates
    );

    post({ type: "result", id, routes });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const code = (e as any)?.code ?? "UNKNOWN";
    post({ type: "error", id, code, message: msg });
  }
}

self.addEventListener("message", (event: MessageEvent<WorkerRequest>) => {
  const req = event.data;
  if (req.type === "cancel") {
    cancelledIds.add(req.id);
    return;
  }
  if (req.type === "generate") {
    cancelledIds.delete(req.id);
    handleGenerate(req);
  }
});
```

- [ ] **Step 3: Implement the worker client (main thread wrapper)**

```typescript
// lib/engine/worker-client.ts
import type { WorkerRequest, WorkerResponse } from "./worker-types";
import type { RouteCandidate, Coordinate } from "../types";
import type { TierConfig } from "./tier-config";

type ProgressCallback = (stage: string, percent: number) => void;

export class RouteWorkerClient {
  private worker: Worker | null = null;
  private requestId = 0;

  private getWorker(): Worker {
    if (!this.worker) {
      this.worker = new Worker(new URL("./worker.ts", import.meta.url), { type: "module" });
    }
    return this.worker;
  }

  async generate(
    params: {
      center: Coordinate;
      targetDistanceKm: number;
      targetElevationM: number;
      profileId: string;
      tierConfig: TierConfig;
      scenicMode?: boolean;
    },
    onProgress?: ProgressCallback
  ): Promise<RouteCandidate[]> {
    const id = String(++this.requestId);
    const worker = this.getWorker();

    // Cancel any previous request
    if (this.requestId > 1) {
      const cancelMsg: WorkerRequest = { type: "cancel", id: String(this.requestId - 1) };
      worker.postMessage(cancelMsg);
    }

    return new Promise((resolve, reject) => {
      const handler = (event: MessageEvent<WorkerResponse>) => {
        const msg = event.data;
        if (msg.id !== id) return;

        if (msg.type === "progress") {
          onProgress?.(msg.stage, msg.percent);
        } else if (msg.type === "result") {
          worker.removeEventListener("message", handler);
          resolve(msg.routes);
        } else if (msg.type === "error") {
          worker.removeEventListener("message", handler);
          reject(new Error(msg.message));
        }
      };

      worker.addEventListener("message", handler);
      const request: WorkerRequest = { type: "generate", id, params };
      worker.postMessage(request);
    });
  }

  terminate() {
    this.worker?.terminate();
    this.worker = null;
  }
}
```

- [ ] **Step 4: Verify Web Worker loads with Next.js 15**

Next.js 15 supports `new Worker(new URL("./worker.ts", import.meta.url), { type: "module" })` natively — no webpack config or `worker-loader` needed. The `worker-client.ts` already uses this pattern. No changes to `next.config.ts` required.

Run `npm run dev` and verify the worker loads without errors in the browser console.

- [ ] **Step 5: Commit**

```bash
git add lib/engine/worker-types.ts lib/engine/worker.ts lib/engine/worker-client.ts next.config.ts
git commit -m "feat: add Web Worker wrapper for client-side engine"
```

---

### Task 13: Integrate Web Worker into Zustand store

**Files:**
- Modify: `lib/store.ts`
- Modify: `components/sidebar/SessionForm.tsx`

- [ ] **Step 1: Add worker client and tier to store**

Add to `lib/store.ts`:
```typescript
import { RouteWorkerClient } from "./engine/worker-client";
import { FREE_TIER } from "./engine/tier-config";

// Module-level singleton (not in store state — not serializable)
let workerClient: RouteWorkerClient | null = null;
function getWorkerClient(): RouteWorkerClient {
  if (!workerClient) workerClient = new RouteWorkerClient();
  return workerClient;
}
```

Add to store state:
```typescript
generationProgress: { stage: string; percent: number } | null;
userTier: "free" | "pro";
```

Add action:
```typescript
generateRouteClientSide: async (center: Coordinate) => {
  const state = get();
  set({ status: "loading", generationProgress: null, errorMessage: null });
  try {
    const routes = await getWorkerClient().generate(
      {
        center,
        targetDistanceKm: state.targetDistanceKm,
        targetElevationM: state.targetElevationM,
        profileId: state.selectedProfileId,
        tierConfig: FREE_TIER,
        scenicMode: state.scenicMode,
      },
      (stage, percent) => set({ generationProgress: { stage, percent } })
    );
    if (routes.length === 0) throw new Error("No routes found");
    const profile = PROFILES_BY_ID.get(state.selectedProfileId)!;
    set({
      status: "success",
      currentRoute: { best: routes[0], candidates: routes, startCoordinate: center, profile },
      candidateIndex: 0,
      generationProgress: null,
    });
  } catch (e) {
    set({
      status: "error",
      errorMessage: e instanceof Error ? e.message : "Route generation failed",
      generationProgress: null,
    });
  }
},
```

- [ ] **Step 2: Update SessionForm to use client-side generation**

In `SessionForm.tsx`, replace the `fetch("/api/generate-route", ...)` call with:

```typescript
// Geocode address first (main thread)
const geocodeResp = await fetch(
  `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(address)}.json?access_token=${process.env.NEXT_PUBLIC_MAPBOX_TOKEN}&limit=1`
);
const geocodeData = await geocodeResp.json();
const [lng, lat] = geocodeData.features[0].center;
const center = { lat, lng };

// Generate route via Web Worker
await store.generateRouteClientSide(center);
```

- [ ] **Step 3: Update loading UI to show progress stages**

Replace the timer-based `LOADING_STEPS` with real progress from `generationProgress`:

```typescript
const progress = useAppStore((s) => s.generationProgress);
// Map stage names to French labels
const STAGE_LABELS: Record<string, string> = {
  graph: "Chargement de la carte...",
  elevation: "Analyse du relief...",
  scoring: "Évaluation des chemins...",
  solving: "Recherche du meilleur parcours...",
  postprocess: "Finalisation...",
};
```

- [ ] **Step 4: Run the app locally and test a route generation**

Run: `npm run dev`
Test: Generate a route in the browser. Verify the Web Worker runs, progress updates show, and a route appears on the map.

- [ ] **Step 5: Commit**

```bash
git add lib/store.ts components/sidebar/SessionForm.tsx
git commit -m "feat: integrate Web Worker client-side engine into app"
```

---

## Phase 4: Design Refresh

### Task 14: Remove GSAP, Three.js, Lenis + dependency cleanup

**Files:**
- Delete: `lib/utils/animations.ts`
- Delete: `lib/utils/gsap-setup.ts`
- Delete: `components/ui/CustomCursor.tsx`
- Delete: `components/providers/SmoothScrollProvider.tsx` (or equivalent)
- Modify: `app/layout.tsx` — remove SmoothScrollProvider
- Modify: `app/globals.css` — remove `cursor: none` and animation keyframes
- Modify: `package.json` — remove deps

- [ ] **Step 1: Uninstall packages**

```bash
npm uninstall gsap lenis three @react-three/fiber @react-three/drei simplex-noise
```

- [ ] **Step 2: Delete animation files**

Delete `lib/utils/animations.ts`, `lib/utils/gsap-setup.ts`, `components/ui/CustomCursor.tsx`.

- [ ] **Step 3: Remove SmoothScrollProvider from layout**

In `app/layout.tsx`, remove the `SmoothScrollProvider` import and wrapper. Keep fonts, analytics.

- [ ] **Step 4: Clean up CSS**

In `app/globals.css`:
- Remove `.custom-cursor` class and `cursor: none` rule
- Remove GSAP-dependent keyframes (`.hero-line`, `.reveal-up`, `.clip-reveal`)
- Keep functional CSS (`.app-viewport`, `.trailforge-slider`, `.sidebar-scroll`)

- [ ] **Step 5: Remove all GSAP imports across the codebase**

Search for any remaining `import ... from "gsap"` or `from "@/lib/utils/gsap-setup"` and remove them.

- [ ] **Step 6: Verify build**

Run: `npm run build`
Expected: Build succeeds with no missing module errors

- [ ] **Step 7: Commit**

```bash
git add -A
git commit -m "refactor: remove GSAP, Three.js, Lenis — save ~600KB bundle"
```

---

### Task 15: New design tokens + typography

**Files:**
- Modify: `app/globals.css`
- Modify: `app/layout.tsx`

- [ ] **Step 1: Update CSS design tokens**

Replace current color tokens in `app/globals.css`:

```css
:root {
  /* Handcrafted Trail palette */
  --bg-parchment: #f2ece3;
  --bg-warm: #e8e0d4;
  --bg-deep: #3d3529;
  --bg-surface: #f7f3ed;
  --border: #d4c9b8;
  --text-primary: #3d3529;
  --text-muted: #7a6e5d;
  --text-light: #a39683;
  --accent-forest: #5a7247;
  --accent-forest-light: #6d8a58;
  --accent-moss: #8fa87e;
  --accent-trail: #c17a3a;

  /* Typography */
  --font-heading: "Georgia", "Times New Roman", serif;
  --font-body: "JetBrains Mono", "Courier New", monospace;
  --font-ui: "Inter", system-ui, sans-serif;
}
```

- [ ] **Step 2: Update layout.tsx fonts**

Remove Playfair Display and Syne. Keep Inter and JetBrains Mono:

```typescript
const inter = Inter({ subsets: ["latin"], variable: "--font-inter", weight: ["400", "500"] });
const jetbrains = JetBrains_Mono({ subsets: ["latin"], variable: "--font-jetbrains", weight: ["400", "500"] });
```

- [ ] **Step 3: Commit**

```bash
git add app/globals.css app/layout.tsx
git commit -m "feat: update design tokens to Handcrafted Trail palette"
```

---

### Task 16: Landing page rewrite

**Files:**
- Rewrite: `components/landing/LandingPageV2.tsx`
- Create: `components/landing/HeroSection.tsx` (rewrite)
- Create: `components/landing/ProblemSection.tsx`
- Create: `components/landing/HowItWorksSection.tsx` (rewrite)
- Create: `components/landing/DifferenceSection.tsx`
- Create: `components/landing/PricingSection.tsx`
- Create: `components/landing/FooterSection.tsx` (rewrite)
- Delete: `components/landing/ManifestoSection.tsx`
- Delete: `components/landing/FeatureShowcase.tsx`
- Delete: `components/landing/StackingFeatureCards.tsx`
- Delete: `components/landing/MetricsSection.tsx`
- Delete: `components/landing/WaitlistSection.tsx`
- Delete: `components/landing/FinalCTASection.tsx`
- Delete: `components/landing/LoadingSequence.tsx`
- Delete: `components/landing/feature-visuals/`
- Delete: `components/landing/shared/TopographicDivider.tsx`

- [ ] **Step 1: Rewrite LandingPageV2 as simple section composition**

```typescript
// components/landing/LandingPageV2.tsx
import { HeroSection } from "./HeroSection";
import { ProblemSection } from "./ProblemSection";
import { HowItWorksSection } from "./HowItWorksSection";
import { DifferenceSection } from "./DifferenceSection";
import { PricingSection } from "./PricingSection";
import { FooterSection } from "./FooterSection";

export function LandingPageV2() {
  return (
    <main style={{ background: "var(--bg-parchment)", color: "var(--text-primary)" }}>
      <HeroSection />
      <ProblemSection />
      <HowItWorksSection />
      <DifferenceSection />
      <PricingSection />
      <FooterSection />
    </main>
  );
}
```

No loading sequence, no custom cursor, no GSAP.

- [ ] **Step 2: Implement each section**

Each section should be a self-contained component following the Handcrafted Trail design:
- Monospace body text, serif headlines
- Warm parchment backgrounds
- First-person French copy
- Minimal animations (CSS `fade-in` only)
- Mobile-first responsive layout (single column, stacking)

Key sections:
- **HeroSection**: Full-viewport, trail photo background (CSS `background-image`), one sentence headline, one CTA button
- **ProblemSection**: 2-3 pain points in first person
- **HowItWorksSection**: 3 numbered steps with real route screenshot
- **DifferenceSection**: Side-by-side map comparison (generic vs scenic route)
- **PricingSection**: Free vs Pro comparison cards
- **FooterSection**: Minimal links + "Built by a trail runner"

Implement each section with focus on mobile viewport (375px).

- [ ] **Step 3: Delete old landing page components**

Remove all unused components: ManifestoSection, FeatureShowcase, StackingFeatureCards, MetricsSection, WaitlistSection, FinalCTASection, LoadingSequence, TopographicDivider, feature-visuals/.

- [ ] **Step 4: Verify build and visual check**

Run: `npm run dev`
Open: http://localhost:3000
Check: Landing page renders with new design, no console errors, responsive on mobile viewport.

- [ ] **Step 5: Commit**

```bash
git add -A
git commit -m "feat: rewrite landing page with Handcrafted Trail design"
```

---

### Task 17: Bottom sheet component + app UI migration

**Files:**
- Create: `components/app/BottomSheet.tsx`
- Modify: `app/app/page.tsx`
- Modify: `components/sidebar/SidebarContainer.tsx`

- [ ] **Step 1: Create BottomSheet component**

A draggable bottom sheet with 3 snap points (peek 10%, half 50%, full 90%). Uses touch events for drag, CSS transform for position. Desktop breakpoint switches to fixed side panel.

Key behaviors:
- Touch drag with momentum
- Snap to nearest point on release
- Backdrop overlay in full mode
- Content scrollable when at full snap
- CSS-only transition between snaps

- [ ] **Step 2: Integrate BottomSheet into app page**

Replace the current sidebar layout in `app/app/page.tsx`:

Mobile: `<BottomSheet>` wrapping `<SidebarContainer />`
Desktop (md+): Keep side panel layout (360px, left-anchored)

- [ ] **Step 3: Update SidebarContainer for bottom sheet context**

Ensure the form → result panel transition works inside the bottom sheet. The generate button should be fixed at the bottom of the half-sheet snap.

- [ ] **Step 4: Test on mobile viewport**

Run: `npm run dev`
Test: On mobile viewport (375px), verify bottom sheet drags between 3 snap points, form is usable, route generation works, and results display in expanded sheet.

- [ ] **Step 5: Commit**

```bash
git add components/app/BottomSheet.tsx app/app/page.tsx components/sidebar/SidebarContainer.tsx
git commit -m "feat: add bottom sheet mobile UI, replace sidebar drawer"
```

---

## Phase 5: Feature Gating & Integration

### Task 18: Pro feature gating in UI

**Files:**
- Create: `components/ui/UpgradePrompt.tsx`
- Create: `components/ui/ProBadge.tsx`
- Modify: `components/sidebar/RouteResult.tsx`
- Modify: `lib/store.ts` (add auth state)

- [ ] **Step 1: Create UpgradePrompt component**

A modal/sheet that appears when a free user tries a Pro feature. Shows "Sign in to continue" with magic link input + Google button, then Stripe checkout.

- [ ] **Step 2: Create ProBadge component**

Small "PRO" label next to gated features (GPX export button, multi-candidate selector, scenic mode toggle).

- [ ] **Step 3: Gate features in RouteResult**

- GPX export button: Show ProBadge, onClick opens UpgradePrompt if free
- Multi-candidate swiper: Hidden for free tier (only 1 route returned)
- Add conversion hook message: "3 more scenic routes found. Unlock with Pro."

- [ ] **Step 4: Gate refine-route on server**

In `app/api/refine-route/route.ts` (rename from `generate-route`), add auth check:
```typescript
const session = await auth();
const tier = session?.user?.id ? await getUserTier(session.user.id) : "free";
if (tier !== "pro") {
  return NextResponse.json({ error: "Pro subscription required" }, { status: 403 });
}
```

- [ ] **Step 5: Commit**

```bash
git add components/ui/UpgradePrompt.tsx components/ui/ProBadge.tsx components/sidebar/RouteResult.tsx app/api/refine-route/
git commit -m "feat: add Pro feature gating with upgrade prompts"
```

---

### Task 19: Refine-route endpoint + server-side Pro generation

**Files:**
- Create: `app/api/refine-route/route.ts`
- Modify: `app/api/generate-route/route.ts` (deprecate)

- [ ] **Step 1: Create refine-route endpoint**

Copy the current `generate-route` handler logic, add:
- Auth check (session required, Pro tier required)
- Use `PRO_TIER` config explicitly
- Use `FilesystemCache` + `DirectFetcher` (server-side)

- [ ] **Step 2: Keep generate-route as deprecated fallback**

Add a deprecation comment. It will be removed once client-side engine is fully validated.

- [ ] **Step 3: Commit**

```bash
git add app/api/refine-route/ app/api/generate-route/
git commit -m "feat: add Pro-only refine-route endpoint"
```

---

### Task 20: End-to-end integration testing

- [ ] **Step 1: Test free tier flow**

1. Open app without auth
2. Generate a route (should use Web Worker)
3. Verify route appears on map
4. Verify GPX export shows Pro upgrade prompt
5. Verify only 1 route candidate

- [ ] **Step 2: Test Pro tier flow**

1. Sign in via magic link
2. Subscribe via Stripe test mode
3. Generate a route (should hit /api/refine-route)
4. Verify 3+ candidates returned
5. Verify GPX export works
6. Verify scenic mode toggle works

- [ ] **Step 3: Test landing page**

1. Verify landing page loads with new design
2. Verify mobile layout (375px viewport)
3. Verify pricing section links to upgrade flow
4. Verify no console errors

- [ ] **Step 4: Run full test suite**

```bash
npx vitest run
```

- [ ] **Step 5: Final commit**

```bash
git add -A
git commit -m "test: verify end-to-end free and Pro tier flows"
```
