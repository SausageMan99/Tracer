import { describe, expect, it } from "vitest";
import { assessRouteQuality } from "@/lib/engine/route-quality";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import type { EnrichedGraph, RouteCandidate, SolverPath } from "@/lib/types";

function makeGraph(): EnrichedGraph {
  return {
    center: { lat: 48.8566, lng: 2.3522 },
    radiusKm: 2,
    nodes: new Map([
      ["a", { id: "a", lat: 48.8566, lng: 2.3522, edges: ["ab"] }],
      ["b", { id: "b", lat: 48.857, lng: 2.353, edges: ["ab", "bc", "bd"] }],
      ["c", { id: "c", lat: 48.858, lng: 2.354, edges: ["bc"] }],
      ["d", { id: "d", lat: 48.859, lng: 2.355, edges: ["bd"] }],
    ]),
    edges: new Map([
      ["ab", { id: "ab", from: "a", to: "b", lengthKm: 1, highway: "primary", osmWayId: 1, score: 0.2 }],
      ["bc", { id: "bc", from: "b", to: "c", lengthKm: 1, highway: "residential", osmWayId: 2, onewayViolation: true, score: 0.1 }],
      ["bd", { id: "bd", from: "b", to: "d", lengthKm: 1, highway: "path", surface: "gravel", osmWayId: 3, score: 0.9 }],
    ]),
  };
}

function makeCandidate(overrides: Partial<RouteCandidate> = {}): RouteCandidate {
  return {
    points: [
      { lat: 48.8566, lng: 2.3522, elevation: 50 },
      { lat: 48.857, lng: 2.353, elevation: 55 },
      { lat: 48.8567, lng: 2.3523, elevation: 50 },
    ],
    distanceKm: 2,
    durationSeconds: 900,
    ascendM: 50,
    descendM: 50,
    surfaceScore: 0.8,
    loopScore: 0.95,
    totalScore: 0.8,
    geometry: { type: "LineString", coordinates: [[2.3522, 48.8566], [2.353, 48.857]] },
    ...overrides,
  };
}

describe("assessRouteQuality", () => {
  it("flags unsafe cycling routes with oneway violations and busy roads", () => {
    const graph = makeGraph();
    const profile = PROFILES_BY_ID.get("cycling_mtb_endurance")!;
    const path: SolverPath = {
      nodeIds: ["a", "b", "c"],
      edgeIds: ["ab", "bc"],
      distanceKm: 2,
      totalScore: 1,
    };

    const quality = assessRouteQuality({
      candidate: makeCandidate(),
      path,
      graph,
      profile,
      targetDistanceKm: 2,
      targetElevationM: 50,
    });

    expect(quality.warnings).toContain("TOO_MUCH_BUSY_ROAD");
    expect(quality.warnings).toContain("ONEWAY_VIOLATION");
    expect(quality.productionScore).toBeLessThan(0.75);
  });

  it("rewards clean trail-like loops close to target distance and elevation", () => {
    const graph = makeGraph();
    const profile = PROFILES_BY_ID.get("running_endurance")!;
    const path: SolverPath = {
      nodeIds: ["a", "b", "d"],
      edgeIds: ["bd"],
      distanceKm: 2,
      totalScore: 1,
    };

    const quality = assessRouteQuality({
      candidate: makeCandidate(),
      path,
      graph,
      profile,
      targetDistanceKm: 2,
      targetElevationM: 50,
    });

    expect(quality.warnings).not.toContain("TOO_MUCH_BUSY_ROAD");
    expect(quality.warnings).not.toContain("DISTANCE_OFF_TARGET");
    expect(quality.productionScore).toBeGreaterThan(0.8);
  });

  it("computes trail-specific beauty metrics from surfaces and continuous paths", () => {
    const graph: EnrichedGraph = {
      center: { lat: 48.8566, lng: 2.3522 },
      radiusKm: 2,
      nodes: new Map([
        ["a", { id: "a", lat: 48.8566, lng: 2.3522, edges: ["ab"] }],
        ["b", { id: "b", lat: 48.857, lng: 2.353, edges: ["ab", "bc"] }],
        ["c", { id: "c", lat: 48.858, lng: 2.354, edges: ["bc", "cd"] }],
        ["d", { id: "d", lat: 48.859, lng: 2.355, edges: ["cd"] }],
      ]),
      edges: new Map([
        ["ab", { id: "ab", from: "a", to: "b", lengthKm: 2, highway: "path", surface: "dirt", osmWayId: 10, score: 0.95 }],
        ["bc", { id: "bc", from: "b", to: "c", lengthKm: 3, highway: "track", surface: "gravel", osmWayId: 11, score: 0.9 }],
        ["cd", { id: "cd", from: "c", to: "d", lengthKm: 1, highway: "residential", surface: "asphalt", osmWayId: 12, score: 0.3 }],
      ]),
    };
    const profile = PROFILES_BY_ID.get("running_trail")!;
    const path: SolverPath = {
      nodeIds: ["a", "b", "c", "d"],
      edgeIds: ["ab", "bc", "cd"],
      distanceKm: 6,
      totalScore: 1,
    };

    const quality = assessRouteQuality({
      candidate: makeCandidate({ distanceKm: 6, ascendM: 120 }),
      path,
      graph,
      profile,
      targetDistanceKm: 6,
      targetElevationM: 120,
      scenicWayIds: new Set(["10", "11"]),
    });

    expect(quality.pavedRatio).toBeCloseTo(1 / 6);
    expect(quality.forestOrParkRatio).toBeCloseTo(5 / 6);
    expect(quality.longestTrailSegmentKm).toBe(5);
    expect(quality.trailBeautyScore).toBeGreaterThan(0.8);
    expect(quality.warnings).not.toContain("NOT_ENOUGH_TRAIL");
    expect(quality.warnings).not.toContain("TOO_MUCH_PAVEMENT");
  });

  it("warns when a trail-running route is mostly paved road", () => {
    const graph = makeGraph();
    const profile = PROFILES_BY_ID.get("running_trail")!;
    const path: SolverPath = {
      nodeIds: ["a", "b", "c"],
      edgeIds: ["ab", "bc"],
      distanceKm: 2,
      totalScore: 1,
    };

    const quality = assessRouteQuality({
      candidate: makeCandidate(),
      path,
      graph,
      profile,
      targetDistanceKm: 2,
      targetElevationM: 50,
    });

    expect(quality.pavedRatio).toBeGreaterThan(0.45);
    expect(quality.longestTrailSegmentKm).toBe(0);
    expect(quality.trailBeautyScore).toBeLessThan(0.45);
    expect(quality.warnings).toContain("NOT_ENOUGH_TRAIL");
    expect(quality.warnings).toContain("TOO_MUCH_PAVEMENT");
  });
});
