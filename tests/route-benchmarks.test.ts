import { describe, expect, it } from "vitest";
import {
  BENCHMARK_CASES,
  benchmarkToRequest,
  summarizeBenchmarkResult,
} from "@/lib/route-benchmarks";
import { PROFILES_BY_ID } from "@/lib/session-profiles";

const SPRINT_4_SMOKE_CASE_IDS = [
  "tourville-pommiers-trail-8k",
  "tourville-pommiers-trail-12k",
  "fontainebleau-trail-15k",
  "caen-colline-aux-oiseaux-6k-soft",
  "meudon-forest-trail-10k",
];

const BLOCKING_ROUTE_WARNINGS = [
  "ONEWAY_VIOLATION",
  "U_TURN_DETECTED",
  "TOO_MUCH_BACKTRACKING",
];

describe("route production benchmarks", () => {
  it("covers the priority running/trail regression cases", () => {
    const ids = BENCHMARK_CASES.map((benchmark) => benchmark.id);

    expect(BENCHMARK_CASES.length).toBeGreaterThanOrEqual(14);
    expect(ids).toEqual(expect.arrayContaining([
      "tourville-pommiers-trail-5k",
      "tourville-pommiers-trail-8k",
      "tourville-pommiers-trail-10k",
      "tourville-pommiers-trail-12k",
      "caen-prairie-8k-mixed",
      "caen-colline-aux-oiseaux-6k-soft",
      "clecy-suisse-normande-trail-12k",
      "fontainebleau-trail-15k",
      "meudon-forest-trail-10k",
      "lille-10k-citadel-loop",
      "paris-19-canal-running",
      "nanterre-east-avoid-highways",
      "osm-poor-rural-trail-8k",
      "paris-buttes-chaumont-5k-constrained",
    ]));
  });

  it("defines the mandatory Sprint 4 multi-zone smoke panel", () => {
    for (const id of SPRINT_4_SMOKE_CASE_IDS) {
      const benchmark = BENCHMARK_CASES.find((item) => item.id === id);
      expect(benchmark, `${id} must stay registered in route-benchmarks-data.json`).toBeDefined();
      expect(benchmark!.scenicMode).toBe(true);
      expect(benchmark!.profileId.startsWith("cycling_")).toBe(false);
      expect(benchmark!.thresholds.maxDurationMs).toBeGreaterThan(0);
      expect(benchmark!.thresholds.maxRepeatEdgeRatio).toBeGreaterThan(0);
      expect(benchmark!.thresholds.maxUTurnRatio).toBeGreaterThan(0);
      expect(benchmark!.blockingWarnings).toEqual(expect.arrayContaining(BLOCKING_ROUTE_WARNINGS));
    }
  });

  it("keeps benchmark ids unique and linked to valid session profiles", () => {
    const ids = BENCHMARK_CASES.map((benchmark) => benchmark.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const benchmark of BENCHMARK_CASES) {
      expect(PROFILES_BY_ID.has(benchmark.profileId)).toBe(true);
      expect(benchmark.targetDistanceKm).toBeGreaterThan(0);
      expect(benchmark.targetElevationM).toBeGreaterThanOrEqual(0);
      expect(benchmark.scenicMode).toBe(true);
    }
  });

  it("classifies every benchmark with tags and a product tier", () => {
    for (const benchmark of BENCHMARK_CASES) {
      expect(["p0", "p1", "p2", "exploratory"]).toContain(benchmark.tier);
      expect(benchmark.tags).toEqual(expect.arrayContaining([expect.any(String)]));
    }

    const tourville = BENCHMARK_CASES.find((item) => item.id === "tourville-pommiers-trail-10k")!;
    expect(tourville.tier).toBe("p0");
    expect(tourville.tags).toEqual(expect.arrayContaining(["tourville", "trail", "field-feedback"]));

    const fontainebleau = BENCHMARK_CASES.find((item) => item.id === "fontainebleau-trail-15k")!;
    expect(fontainebleau.tier).toBe("p1");
    expect(fontainebleau.tags).toEqual(expect.arrayContaining(["fontainebleau", "trail", "forest"]));
  });

  it("keeps every benchmark threshold actionable", () => {
    for (const benchmark of BENCHMARK_CASES) {
      expect(benchmark.thresholds.distanceToleranceRatio).toBeGreaterThan(0);
      expect(benchmark.thresholds.distanceToleranceRatio).toBeLessThanOrEqual(0.15);
      expect(benchmark.thresholds.elevationToleranceM).toBeGreaterThan(0);
      expect(benchmark.thresholds.minProductionScore).toBeGreaterThanOrEqual(0.6);
      expect(benchmark.thresholds.minProductionScore).toBeLessThanOrEqual(0.9);
      expect(benchmark.thresholds.maxLoopClosureKm).toBeGreaterThan(0);
      expect(benchmark.thresholds.maxBusyRoadRatio).toBeGreaterThanOrEqual(0);
      expect(benchmark.thresholds.maxBusyRoadRatio).toBeLessThanOrEqual(0.15);
      expect(benchmark.thresholds.maxRepeatEdgeRatio).toBeGreaterThan(0);
      expect(benchmark.thresholds.maxRepeatEdgeRatio).toBeLessThanOrEqual(0.06);
      expect(benchmark.thresholds.maxUTurnRatio).toBeGreaterThan(0);
      expect(benchmark.thresholds.maxUTurnRatio).toBeLessThanOrEqual(0.015);
      expect(benchmark.thresholds.maxDurationMs).toBeGreaterThan(0);
      expect(benchmark.blockingWarnings).toEqual(expect.arrayContaining([
        "ONEWAY_VIOLATION",
        "U_TURN_DETECTED",
        "TOO_MUCH_BACKTRACKING",
      ]));
    }
  });

  it("converts a benchmark into the public generate-route request contract", () => {
    const request = benchmarkToRequest(BENCHMARK_CASES[0]);

    expect(request).toEqual({
      address: BENCHMARK_CASES[0].address,
      profileId: BENCHMARK_CASES[0].profileId,
      targetDistanceKm: BENCHMARK_CASES[0].targetDistanceKm,
      targetElevationM: BENCHMARK_CASES[0].targetElevationM,
      scenicMode: BENCHMARK_CASES[0].scenicMode,
    });
  });

  it("fails a route when production quality misses hard thresholds", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "lille-10k-citadel-loop")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 7.8,
      ascendM: 40,
      quality: {
        productionScore: 0.61,
        loopClosureKm: 0.4,
        busyRoadRatio: 0.18,
        naturalWayRatio: 0.12,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        terrainDataConfidence: "high",
        trailPotential: "high",
        warnings: ["DISTANCE_OFF_TARGET", "TOO_MUCH_BUSY_ROAD"],
      },
      durationMs: 1200,
    });

    expect(summary.passed).toBe(false);
    expect(summary.failures).toEqual(expect.arrayContaining([
      "distance_tolerance",
      "production_score",
      "busy_road_ratio",
    ]));
  });

  it("fails a route when safety reports a oneway violation", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "meudon-forest-trail-10k")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 10.1,
      ascendM: 210,
      quality: {
        productionScore: 0.82,
        loopClosureKm: 0.4,
        busyRoadRatio: 0.01,
        naturalWayRatio: 0.6,
        pavedRatio: 0.2,
        trailBeautyScore: 0.8,
        longestTrailSegmentKm: 3,
        naturalCorridorRatio: 0.6,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        terrainDataConfidence: "high",
        trailPotential: "high",
        warnings: ["ONEWAY_VIOLATION"],
      },
      durationMs: 1200,
    });

    expect(summary.passed).toBe(false);
    expect(summary.failures).toContain("oneway_violation");
  });

  it("passes a route that stays within production thresholds", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "paris-19-canal-running")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 10.2,
      ascendM: 95,
      quality: {
        productionScore: 0.84,
        loopGapKm: 0.18,
        busyRoadRatio: 0.04,
        trailRatio: 0.38,
        naturalWayRatio: 0.38,
        repeatEdgeRatio: 0.01,
        uTurnRatio: 0,
        terrainDataConfidence: "high",
        trailPotential: "high",
        warnings: [],
      },
      durationMs: 1200,
    });

    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
  });

  it("fails a trail benchmark when pavement or beauty thresholds are missed", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "fontainebleau-trail-15k")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 15.1,
      ascendM: 210,
      quality: {
        productionScore: 0.82,
        loopGapKm: 0.2,
        busyRoadRatio: 0.02,
        trailRatio: 0.55,
        pavedRatio: 0.52,
        trailBeautyScore: 0.48,
        longestTrailSegmentKm: 2,
        naturalCorridorRatio: 0.32,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        terrainDataConfidence: "high",
        trailPotential: "high",
        warnings: [],
      },
      durationMs: 1000,
    });

    expect(summary.passed).toBe(false);
    expect(summary.failures).toEqual(expect.arrayContaining([
      "paved_ratio",
      "trail_beauty_score",
      "longest_trail_segment",
      "natural_corridor_ratio",
    ]));
  });

  it("keeps naturalWayRatio separate from trailRatio and never masks paved failures", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "fontainebleau-trail-15k")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 15,
      ascendM: 210,
      quality: {
        productionScore: 0.9,
        loopGapKm: 0.2,
        busyRoadRatio: 0.02,
        trailRatio: 0.2,
        naturalWayRatio: 0.8,
        pavedRatio: 0.65,
        trailBeautyScore: 0.8,
        longestTrailSegmentKm: 3,
        naturalCorridorRatio: 0.7,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        terrainDataConfidence: "high",
        trailPotential: "high",
        warnings: [],
      },
      durationMs: 1000,
    });

    expect(summary.metrics.trailRatio).toBe(0.2);
    expect(summary.metrics.naturalWayRatio).toBe(0.8);
    expect(summary.metrics.pavedRatio).toBe(0.65);
    expect(summary.failures).toContain("paved_ratio");
    expect(summary.failures).not.toContain("natural_way_ratio");
  });

  it("does not fall back from naturalWayRatio to trailRatio", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "fontainebleau-trail-15k")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 15,
      ascendM: 200,
      quality: {
        productionScore: 0.9,
        loopGapKm: 0.2,
        busyRoadRatio: 0.01,
        trailRatio: 0.8,
        pavedRatio: 0.1,
        trailBeautyScore: 0.8,
        longestTrailSegmentKm: 5,
        naturalCorridorRatio: 0.7,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        terrainDataConfidence: "high",
        trailPotential: "high",
        warnings: [],
      },
      durationMs: 1000,
    });

    expect(summary.metrics.trailRatio).toBe(0.8);
    expect(summary.metrics.naturalWayRatio).toBe(0);
    expect(summary.failures).toContain("natural_way_ratio");
  });

  it("fails the Tourville trail benchmarks on U-turns and overlapping edges", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "tourville-pommiers-trail-12k")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 11.7,
      ascendM: 104,
      quality: {
        productionScore: 0.78,
        loopGapKm: 0.2,
        busyRoadRatio: 0.04,
        trailRatio: 0.42,
        pavedRatio: 0.38,
        trailBeautyScore: 0.61,
        longestTrailSegmentKm: 2.8,
        naturalCorridorRatio: 0.48,
        repeatEdgeRatio: 0.09,
        uTurnRatio: 0.04,
        terrainDataConfidence: "high",
        trailPotential: "high",
        warnings: ["U_TURN_DETECTED", "TOO_MUCH_BACKTRACKING"],
      },
      durationMs: 1000,
    });

    expect(summary.passed).toBe(false);
    expect(summary.failures).toEqual(expect.arrayContaining([
      "repeat_edge_ratio",
      "u_turn_ratio",
      "u_turn_detected",
      "backtracking_detected",
    ]));
  });

  it("fails a trail benchmark when terrain confidence or potential is too low", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "clecy-suisse-normande-trail-12k")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 12,
      ascendM: 340,
      quality: {
        productionScore: 0.8,
        loopGapKm: 0.2,
        busyRoadRatio: 0.01,
        trailRatio: 0.5,
        pavedRatio: 0.2,
        trailBeautyScore: 0.8,
        longestTrailSegmentKm: 3,
        naturalCorridorRatio: 0.6,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        terrainDataConfidence: "low",
        trailPotential: "medium",
        warnings: [],
      },
      durationMs: 1000,
    });

    expect(summary.passed).toBe(false);
    expect(summary.failures).toEqual(expect.arrayContaining([
      "terrain_data_confidence",
      "trail_potential",
    ]));
  });

  it("fails geometry thresholds when a constrained park route becomes a fake loop", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "caen-colline-aux-oiseaux-6k-soft")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 6,
      ascendM: 80,
      quality: {
        productionScore: 0.82,
        loopGapKm: 0.1,
        busyRoadRatio: 0.01,
        naturalWayRatio: 0.5,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        terrainDataConfidence: "high",
        trailPotential: "high",
        warnings: [],
        geometry: {
          loopCompactness: 0.02,
          geometryOverlapRatio: 0.04,
          selfIntersectionCount: 1,
          sharpTurnDensityPerKm: 4,
          headingReversalRatio: 0.12,
          outAndBackSimilarityRatio: 0.3,
          startStemKm: 0.4,
          maxDistanceFromStartKm: 0.3,
        },
      },
      durationMs: 1000,
    });

    expect(summary.passed).toBe(false);
    expect(summary.failures).toEqual(expect.arrayContaining([
      "geometry_self_intersection",
      "geometry_loop_compactness",
      "geometry_start_end_stem",
      "geometry_spatial_spread",
    ]));
  });

  it("requires an honest OSM warning on the poor-data benchmark", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "osm-poor-rural-trail-8k")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 8,
      ascendM: 140,
      quality: {
        productionScore: 0.72,
        loopGapKm: 0.1,
        busyRoadRatio: 0.01,
        naturalWayRatio: 0.4,
        pavedRatio: 0.2,
        trailBeautyScore: 0.55,
        longestTrailSegmentKm: 1.4,
        naturalCorridorRatio: 0.35,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        terrainDataConfidence: "low",
        trailPotential: "low",
        warnings: [],
      },
      durationMs: 1000,
    });

    expect(summary.passed).toBe(false);
    expect(summary.failures).toContain("missing_honest_warning");
  });
});
