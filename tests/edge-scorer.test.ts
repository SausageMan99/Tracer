import { describe, it, expect, vi } from "vitest";
import { deriveWeights, scoreEdges } from "@/lib/engine/edge-scorer";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import type { DataFetcher } from "@/lib/engine/adapters/data-fetcher";
import type { EnrichedGraph, SessionProfile, SessionWeights } from "@/lib/types";

// ---------------------------------------------------------------------------
// Mock DataFetcher factory
// ---------------------------------------------------------------------------

function makeMockFetcher(elevations?: number[]): DataFetcher {
  return {
    fetchOverpassData: vi.fn(),
    fetchElevations: vi.fn(async (coords: { lat: number; lng: number }[]) =>
      elevations ?? coords.map(() => 0)
    ),
  } as unknown as DataFetcher;
}

function makeGraph(edges: Array<{
  id: string;
  from: string;
  to: string;
  highway: string;
  lengthKm: number;
  lit?: string;
  access?: string;
  surface?: string;
  osmWayId?: number;
}>): EnrichedGraph {
  const nodes = new Map<string, { lat: number; lng: number; edges: string[] }>();
  const edgeMap = new Map<string, any>();
  for (const e of edges) {
    if (!nodes.has(e.from)) nodes.set(e.from, { lat: 0, lng: 0, edges: [] });
    if (!nodes.has(e.to)) nodes.set(e.to, { lat: 0, lng: 0, edges: [] });
    nodes.get(e.from)!.edges.push(e.id);
    edgeMap.set(e.id, { ...e, score: 0 });
  }
  return { nodes, edges: edgeMap } as EnrichedGraph;
}

describe("deriveWeights", () => {
  it("returns weights that sum to 1", () => {
    for (const profile of PROFILES_BY_ID.values()) {
      const w = deriveWeights(profile);
      const sum = w.surface + w.elevation + w.nature + w.quietness;
      expect(sum).toBeCloseTo(1.0, 5);
    }
  });

  it("returns weights summing to 1 in scenic mode", () => {
    for (const profile of PROFILES_BY_ID.values()) {
      const w = deriveWeights(profile, true);
      const sum = w.surface + w.elevation + w.nature + w.quietness;
      expect(sum).toBeCloseTo(1.0, 5);
    }
  });

  it("scenic mode boosts nature weight", () => {
    const profile = PROFILES_BY_ID.get("running_endurance")!;
    const normal = deriveWeights(profile, false);
    const scenic = deriveWeights(profile, true);
    expect(scenic.nature).toBeGreaterThan(normal.nature);
  });

  it("intervals profile reduces elevation weight", () => {
    const profile = PROFILES_BY_ID.get("running_intervals")!;
    const w = deriveWeights(profile);
    expect(w.elevation).toBeLessThan(0.1);
  });

  it("gran fondo profile increases elevation weight", () => {
    const profile = PROFILES_BY_ID.get("cycling_road_gran_fondo")!;
    const w = deriveWeights(profile);
    expect(w.elevation).toBeGreaterThan(0.2);
  });

  it("does not mutate the profile object", () => {
    const profile = PROFILES_BY_ID.get("running_endurance")!;
    const before = JSON.stringify(profile);
    deriveWeights(profile, true);
    expect(JSON.stringify(profile)).toBe(before);
  });

  it("all weights are positive", () => {
    for (const profile of PROFILES_BY_ID.values()) {
      for (const scenic of [false, true]) {
        const w = deriveWeights(profile, scenic);
        expect(w.surface).toBeGreaterThan(0);
        expect(w.elevation).toBeGreaterThan(0);
        expect(w.nature).toBeGreaterThan(0);
        expect(w.quietness).toBeGreaterThan(0);
      }
    }
  });
});

describe("scoreEdges — elevation smoothness", () => {
  const equalWeights: SessionWeights = {
    surface: 0.25,
    elevation: 0.25,
    nature: 0.25,
    quietness: 0.25,
  };

  async function scoreGradient(
    gradient: number,
    sessionType: string
  ): Promise<number> {
    const elevDiff = gradient * 100; // 100m edge
    const fetcher = makeMockFetcher([0, elevDiff]);
    const graph = makeGraph([
      {
        id: "e1",
        from: "a",
        to: "b",
        highway: "residential",
        lengthKm: 0.1,
        osmWayId: 1,
      },
    ]);
    const profile = {
      id: "test",
      sport: "running",
      sessionType,
    } as SessionProfile;
    await scoreEdges(graph, equalWeights, profile, new Set(), fetcher);
    return graph.edges.get("e1")!.score;
  }

  it("prefersClimbs: no discontinuity near 3% gradient", async () => {
    const score29 = await scoreGradient(0.029, "gran_fondo");
    const score30 = await scoreGradient(0.03, "gran_fondo");
    const score31 = await scoreGradient(0.031, "gran_fondo");
    // Adjacent gradients should differ by < 0.05 (no jumps)
    expect(Math.abs(score31 - score30)).toBeLessThan(0.05);
    expect(Math.abs(score30 - score29)).toBeLessThan(0.05);
  });

  it("prefersClimbs: peaks near 5.5% and decreases away from it", async () => {
    const score0 = await scoreGradient(0.0, "gran_fondo");
    const score55 = await scoreGradient(0.055, "gran_fondo");
    const score12 = await scoreGradient(0.12, "gran_fondo");
    expect(score55).toBeGreaterThan(score0);
    expect(score55).toBeGreaterThan(score12);
  });

  it("endurance: no discontinuity near 2% gradient", async () => {
    const score19 = await scoreGradient(0.019, "endurance");
    const score20 = await scoreGradient(0.02, "endurance");
    const score21 = await scoreGradient(0.021, "endurance");
    expect(Math.abs(score21 - score20)).toBeLessThan(0.05);
    expect(Math.abs(score20 - score19)).toBeLessThan(0.05);
  });
});

describe("scoreEdges — gradient nature scoring", () => {
  const natureOnlyWeights: SessionWeights = {
    surface: 0.0,
    elevation: 0.0,
    nature: 1.0,
    quietness: 0.0,
  };

  const profile = {
    id: "test",
    sport: "running",
    sessionType: "endurance",
  } as SessionProfile;

  async function scoreNatureEdge(
    highway: string,
    scenicWayIds: Set<string>,
    osmWayId = 1
  ): Promise<number> {
    const fetcher = makeMockFetcher([0, 0]);
    const graph = makeGraph([
      {
        id: "e1",
        from: "a",
        to: "b",
        highway,
        lengthKm: 0.1,
        osmWayId,
      },
    ]);
    await scoreEdges(graph, natureOnlyWeights, profile, scenicWayIds, fetcher);
    return graph.edges.get("e1")!.score;
  }

  it("forest trail (path) scores higher than residential street", async () => {
    const pathScore = await scoreNatureEdge("path", new Set());
    const residentialScore = await scoreNatureEdge("residential", new Set());
    expect(pathScore).toBeGreaterThan(residentialScore);
  });

  it("trail types score above baseline 0.3", async () => {
    const pathScore = await scoreNatureEdge("path", new Set());
    const trackScore = await scoreNatureEdge("track", new Set());
    const bridlewayScore = await scoreNatureEdge("bridleway", new Set());
    expect(pathScore).toBeGreaterThan(0.3);
    expect(trackScore).toBeGreaterThan(0.3);
    expect(bridlewayScore).toBeGreaterThan(0.3);
  });

  it("residential and service score below baseline", async () => {
    const residentialScore = await scoreNatureEdge("residential", new Set());
    const serviceScore = await scoreNatureEdge("service", new Set());
    expect(residentialScore).toBeLessThan(0.3);
    expect(serviceScore).toBeLessThan(0.3);
  });

  it("scenic way with path scores higher than non-scenic path", async () => {
    const scenicPath = await scoreNatureEdge("path", new Set(["42"]), 42);
    const nonScenicPath = await scoreNatureEdge("path", new Set());
    expect(scenicPath).toBeGreaterThan(nonScenicPath);
  });

  it("scenic way blends scenic + affinity (60/40)", async () => {
    // path affinity = 0.8, scenic blend = 1.0 * 0.6 + 0.8 * 0.4 = 0.92
    const score = await scoreNatureEdge("path", new Set(["1"]), 1);
    expect(score).toBeCloseTo(0.92, 2);
  });

  it("unknown highway type falls back to 0.3 baseline", async () => {
    const score = await scoreNatureEdge("motorway", new Set());
    expect(score).toBeCloseTo(0.3, 2);
  });

  it("produces a gradient — not binary", async () => {
    const scores = await Promise.all([
      scoreNatureEdge("path", new Set()),
      scoreNatureEdge("cycleway", new Set()),
      scoreNatureEdge("residential", new Set()),
      scoreNatureEdge("secondary", new Set()),
    ]);
    // All distinct values
    const unique = new Set(scores.map((s) => s.toFixed(4)));
    expect(unique.size).toBe(scores.length);
    // Ordered from highest to lowest
    for (let i = 1; i < scores.length; i++) {
      expect(scores[i - 1]).toBeGreaterThan(scores[i]);
    }
  });
});

describe("scoreEdges — safety decoupled from quietness", () => {
  const equalWeights: SessionWeights = {
    surface: 0.25,
    elevation: 0.25,
    nature: 0.25,
    quietness: 0.25,
  };

  it("busy highway with lit=yes does not inflate quietness score", async () => {
    const litGraph = makeGraph([
      {
        id: "e1",
        from: "a",
        to: "b",
        highway: "primary", // busy
        lengthKm: 0.1,
        lit: "yes",
        osmWayId: 1,
      },
    ]);
    const unlitGraph = makeGraph([
      {
        id: "e1",
        from: "a",
        to: "b",
        highway: "primary", // busy
        lengthKm: 0.1,
        lit: "no",
        osmWayId: 1,
      },
    ]);

    const profile = {
      id: "test",
      sport: "running",
      sessionType: "endurance",
    } as SessionProfile;

    await scoreEdges(litGraph, equalWeights, profile, new Set(), makeMockFetcher([0, 0]));
    await scoreEdges(unlitGraph, equalWeights, profile, new Set(), makeMockFetcher([0, 0]));

    const litScore = litGraph.edges.get("e1")!.score;
    const unlitScore = unlitGraph.edges.get("e1")!.score;

    // Lit bonus should be small (0.05), not the old 0.3 * quietness weight
    expect(litScore - unlitScore).toBeCloseTo(0.05, 2);
  });

  it("private access edges get score 0", async () => {
    const graph = makeGraph([
      {
        id: "e1",
        from: "a",
        to: "b",
        highway: "residential",
        lengthKm: 0.1,
        access: "private",
        osmWayId: 1,
      },
    ]);
    const profile = {
      id: "test",
      sport: "running",
      sessionType: "endurance",
    } as SessionProfile;
    await scoreEdges(graph, equalWeights, profile, new Set(), makeMockFetcher([0, 0]));
    expect(graph.edges.get("e1")!.score).toBe(0);
  });
});
