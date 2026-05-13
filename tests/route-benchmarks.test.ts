import { describe, expect, it } from "vitest";
import {
  BENCHMARK_CASES,
  BETA_BEHAVIOR_CASE_IDS,
  BETA_SMOKE_CASE_IDS,
  READINESS_UNSTABLE_CASE_IDS,
  benchmarkToRequest,
  summarizeBenchmarkFailure,
  summarizeBenchmarkResult,
} from "@/lib/route-benchmarks";
import type { RouteBenchmarkCase } from "@/lib/route-benchmarks";
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

  it("defines a beta smoke panel that excludes unstable Tourville 12k without dropping it from readiness", () => {
    expect(BETA_SMOKE_CASE_IDS).toEqual([
      "tourville-pommiers-trail-8k",
      "fontainebleau-trail-15k",
      "caen-colline-aux-oiseaux-6k-soft",
      "meudon-forest-trail-10k",
    ]);
    expect(BETA_SMOKE_CASE_IDS).not.toContain("tourville-pommiers-trail-12k");
    expect(READINESS_UNSTABLE_CASE_IDS).toContain("tourville-pommiers-trail-12k");

    const tourville12 = BENCHMARK_CASES.find((item) => item.id === "tourville-pommiers-trail-12k")!;
    expect(tourville12.tier).toBe("p0");
    expect(tourville12.tags).toEqual(expect.arrayContaining(["tourville", "trail", "field-feedback", "baron"]));
    expect(tourville12.readinessStatus).toBe("unstable");
    expect(tourville12.betaSmokeExcludedReason).toBe("tourville12_quality_pavement_unstable");
    expect(tourville12.thresholds.maxPavedRatio).toBe(0.42);
    expect(tourville12.thresholds.minTrailBeautyScore).toBe(0.58);
    expect(tourville12.thresholds.minNaturalCorridorRatio).toBe(0.45);
    expect(tourville12.thresholds.maxRepeatEdgeRatio).toBe(0.04);
    expect(tourville12.thresholds.maxUTurnRatio).toBe(0.01);
  });

  it("defines a closed-beta behavior panel focused on honest outcomes", () => {
    expect(BETA_BEHAVIOR_CASE_IDS).toEqual([
      "tourville-pommiers-trail-8k",
      "caen-colline-aux-oiseaux-6k-soft",
      "fontainebleau-trail-15k",
      "clecy-suisse-normande-trail-12k",
      "caen-prairie-8k-mixed",
      "lille-10k-citadel-loop",
      "paris-buttes-chaumont-5k-constrained",
      "meudon-forest-trail-10k",
    ]);

    const panel = BETA_BEHAVIOR_CASE_IDS.map((id) => BENCHMARK_CASES.find((item) => item.id === id)!);
    expect(panel).toHaveLength(8);
    expect(panel.every(Boolean)).toBe(true);
    expect(panel.map((item) => item.expectedOutcome ?? "exact_distance")).toEqual(expect.arrayContaining([
      "best_effort_route",
      "park_recovery",
      "exact_distance",
    ]));
    expect(panel.flatMap((item) => item.tags ?? [])).toEqual(expect.arrayContaining([
      "field-feedback",
      "park",
      "forest",
      "urban-nature",
      "constrained",
      "periurban",
    ]));
    expect(BETA_BEHAVIOR_CASE_IDS).not.toContain("tourville-pommiers-trail-12k");
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
      expect(benchmark.thresholds.maxSelfIntersectionCount ?? 0).toBeLessThanOrEqual(0);
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
      routeGateElevationToleranceM: BENCHMARK_CASES[0].thresholds.elevationToleranceM,
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
        trailPotential: "low",
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

  it("accepts Meudon route success when quality is high and no restricted access evidence is present", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "meudon-forest-trail-10k")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 10.1,
      ascendM: 220,
      quality: {
        productionScore: 0.98,
        loopGapKm: 0.2,
        busyRoadRatio: 0.01,
        trailRatio: 0.753,
        naturalWayRatio: 0.801,
        pavedRatio: 0.247,
        trailBeautyScore: 0.658,
        longestTrailSegmentKm: 3.823,
        naturalCorridorRatio: 0.725,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        terrainDataConfidence: "medium",
        trailPotential: "medium",
        routeTrailQuality: "high",
        warnings: [],
      },
      durationMs: 36_000,
    });

    expect(benchmark.thresholds.minTrailPotential).toBe("medium");
    expect(benchmark.thresholds.minRouteTrailQuality).toBe("high");
    expect(benchmark.expectedOutcome).toBe("route_or_typed_refusal");
    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
    expect(summary.metrics.routeTrailQuality).toBe("high");
  });

  it("fails Meudon exploratory quality gates when routeTrailQuality is not high", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "meudon-forest-trail-10k")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 10.1,
      ascendM: 220,
      quality: {
        productionScore: 0.98,
        loopGapKm: 0.2,
        busyRoadRatio: 0.01,
        trailRatio: 0.753,
        naturalWayRatio: 0.801,
        pavedRatio: 0.247,
        trailBeautyScore: 0.658,
        longestTrailSegmentKm: 3.823,
        naturalCorridorRatio: 0.725,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        terrainDataConfidence: "medium",
        trailPotential: "medium",
        routeTrailQuality: "medium",
        warnings: [],
      },
      durationMs: 36_000,
    });

    expect(summary.passed).toBe(false);
    expect(summary.failures).toContain("route_trail_quality");
  });

  it("accepts an honest paved-running cap for the Caen recovery park contract", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "caen-colline-aux-oiseaux-6k-soft")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 5.49,
      ascendM: 95,
      distanceAdjustment: {
        requestedDistanceKm: 6,
        adjustedDistanceKm: 5.49,
        reason: "PARK_RECOVERY_SIZE_LIMIT",
        policy: "adjusted_distance",
        messageCode: "PARK_RECOVERY_DISTANCE_ADJUSTED",
      },
      quality: {
        productionScore: 0.705,
        loopGapKm: 0.02,
        busyRoadRatio: 0,
        naturalWayRatio: 0.74,
        pavedRatio: 0.666,
        repeatEdgeRatio: 0.026,
        uTurnRatio: 0.001,
        terrainDataConfidence: "medium",
        trailPotential: "medium",
        warnings: ["TOO_MANY_INTERSECTIONS"],
        geometry: {
          loopCompactness: 0.22,
          geometryOverlapRatio: 0.16,
          selfIntersectionCount: 0,
          sharpTurnDensityPerKm: 1,
          headingReversalRatio: 0.02,
          outAndBackSimilarityRatio: 0,
          startStemKm: 0,
          endStemKm: 0,
          maxDistanceFromStartKm: 1.2,
        },
      },
      durationMs: 17000,
    });

    expect(benchmark.thresholds.maxPavedRatio).toBe(0.68);
    expect(summary.passed).toBe(true);
  });


  it("allows Caen benchmark to pass with explicit adjusted_distance outcome", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "caen-colline-aux-oiseaux-6k-soft")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 5.35,
      ascendM: 50,
      distanceAdjustment: {
        requestedDistanceKm: 6,
        adjustedDistanceKm: 5.35,
        reason: "PARK_RECOVERY_SIZE_LIMIT",
        policy: "adjusted_distance",
        messageCode: "PARK_RECOVERY_DISTANCE_ADJUSTED",
      },
      quality: {
        productionScore: 0.82,
        loopGapKm: 0.02,
        busyRoadRatio: 0,
        naturalWayRatio: 0.78,
        pavedRatio: 0.62,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        terrainDataConfidence: "high",
        trailPotential: "high",
        warnings: [],
        geometry: {
          loopCompactness: 0.12,
          geometryOverlapRatio: 0.08,
          selfIntersectionCount: 0,
          sharpTurnDensityPerKm: 1,
          headingReversalRatio: 0.02,
          outAndBackSimilarityRatio: 0,
          startStemKm: 0.02,
          endStemKm: 0.02,
          maxDistanceFromStartKm: 0.9,
        },
      },
      durationMs: 17000,
    });

    expect(benchmark.expectedOutcome).toBe("park_recovery");
    expect(summary.passed).toBe(true);
    expect(summary.failures).not.toContain("distance_tolerance");
    expect(summary.metrics.distanceAdjustmentReason).toBe("PARK_RECOVERY_SIZE_LIMIT");
  });

  it("accepts Caen adjusted_distance when only a tiny park compactness miss remains", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "caen-colline-aux-oiseaux-6k-soft")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 5.9863024225914385,
      ascendM: 0,
      distanceAdjustment: {
        requestedDistanceKm: 6,
        adjustedDistanceKm: 5.9863024225914385,
        reason: "PARK_RECOVERY_SIZE_LIMIT",
        policy: "adjusted_distance",
        messageCode: "PARK_RECOVERY_DISTANCE_ADJUSTED",
      },
      quality: {
        productionScore: 0.9669587413477018,
        loopGapKm: 0.07460043639319847,
        busyRoadRatio: 0,
        naturalWayRatio: 0.7961899810345329,
        pavedRatio: 0.6086652040224061,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        terrainDataConfidence: "medium",
        trailPotential: "medium",
        warnings: ["LOOP_TOO_CONSTRAINED", "TOO_MANY_INTERSECTIONS"],
        geometry: {
          loopCompactness: 0.05923,
          geometryOverlapRatio: 0.05601,
          selfIntersectionCount: 0,
          sharpTurnDensityPerKm: 0.3341,
          headingReversalRatio: 0.0101,
          outAndBackSimilarityRatio: 0,
          startStemKm: 0.05035,
          endStemKm: 0.02829,
          maxDistanceFromStartKm: 1.0023,
        },
      },
      durationMs: 21_751,
    });

    expect(summary.passed).toBe(true);
    expect(summary.failures).not.toContain("geometry_loop_compactness");
  });

  it("accepts Caen park_recovery when the API honestly refuses a too-constrained park", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "caen-colline-aux-oiseaux-6k-soft")!;
    const summary = summarizeBenchmarkFailure(benchmark, {
      status: 422,
      errorCode: "ROUTE_CANDIDATES_REJECTED",
      subCode: "PARK_TOO_SMALL_FOR_DISTANCE",
      error: "Le parc est trop contraint pour tenir cette distance proprement.",
      durationMs: 20_443,
    });

    expect(benchmark.expectedOutcome).toBe("park_recovery");
    expect(benchmark.expectedRefusalSubCode).toBe("PARK_TOO_SMALL_FOR_DISTANCE");
    expect(summary.passed).toBe(true);
    expect(summary.metrics.actualOutcome).toBe("typed_refusal");
  });

  it("reads adjusted_distance from the generated route envelope, not only from best candidate", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "caen-colline-aux-oiseaux-6k-soft")!;
    const generatedRoute = {
      best: {
        distanceKm: 5.45,
        ascendM: 50,
        quality: {
          productionScore: 0.86,
          loopGapKm: 0.02,
          busyRoadRatio: 0,
          naturalWayRatio: 0.79,
          pavedRatio: 0.56,
          repeatEdgeRatio: 0,
          uTurnRatio: 0,
          terrainDataConfidence: "medium",
          trailPotential: "medium",
          warnings: [],
          geometry: { loopCompactness: 0.08, geometryOverlapRatio: 0.08, selfIntersectionCount: 0, sharpTurnDensityPerKm: 1, headingReversalRatio: 0.02, outAndBackSimilarityRatio: 0, startStemKm: 0.02, endStemKm: 0.02, maxDistanceFromStartKm: 0.9 },
        },
      },
      distanceAdjustment: {
        requestedDistanceKm: 6,
        adjustedDistanceKm: 5.45,
        reason: "PARK_RECOVERY_SIZE_LIMIT",
        policy: "adjusted_distance",
        messageCode: "PARK_RECOVERY_DISTANCE_ADJUSTED",
      },
      durationMs: 17000,
    };
    const summary = summarizeBenchmarkResult(
      benchmark,
      generatedRoute as unknown as Parameters<typeof summarizeBenchmarkResult>[1]
    );

    expect(summary.passed).toBe(true);
    expect(summary.metrics.adjustedDistanceKm).toBe(5.45);
  });

  it("fails Caen benchmark on silent short success without distanceAdjustment", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "caen-colline-aux-oiseaux-6k-soft")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 5.0,
      ascendM: 50,
      quality: {
        productionScore: 0.82,
        loopGapKm: 0.02,
        busyRoadRatio: 0,
        naturalWayRatio: 0.78,
        pavedRatio: 0.62,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        terrainDataConfidence: "high",
        trailPotential: "high",
        warnings: [],
        geometry: { loopCompactness: 0.12, geometryOverlapRatio: 0.08, selfIntersectionCount: 0, startStemKm: 0.02, endStemKm: 0.02, maxDistanceFromStartKm: 0.9 },
      },
      durationMs: 17000,
    });

    expect(summary.passed).toBe(false);
    expect(summary.failures).toContain("distance_tolerance");
  });

  it("accepts Caen park_recovery on a full clean route success without distance adjustment", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "caen-colline-aux-oiseaux-6k-soft")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 6.46,
      ascendM: 95,
      quality: {
        productionScore: 0.89,
        loopGapKm: 0.08,
        busyRoadRatio: 0,
        trailRatio: 0.79,
        naturalWayRatio: 0.79,
        pavedRatio: 0.66,
        scenicPavedRatio: 0.26,
        trailBeautyScore: 0.65,
        longestTrailSegmentKm: 1.41,
        naturalCorridorRatio: 0.71,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        terrainDataConfidence: "high",
        trailPotential: "high",
        routeTrailQuality: "medium",
        warnings: [],
        geometry: {
          loopCompactness: 0.15,
          geometryOverlapRatio: 0.12,
          selfIntersectionCount: 0,
          sharpTurnDensityPerKm: 0,
          headingReversalRatio: 0,
          outAndBackSimilarityRatio: 0,
          startStemKm: 0.03,
          endStemKm: 0.05,
          maxDistanceFromStartKm: 1.3,
        },
      },
      durationMs: 25_016,
    });

    expect(benchmark.expectedOutcome).toBe("park_recovery");
    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
    expect(summary.metrics.actualOutcome).toBe("route_success");
    expect(summary.metrics.distanceAdjustmentReason).toBeNull();
  });

  it("treats Tourville 8k as a best-effort trail-unavailable smoke contract", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "tourville-pommiers-trail-8k")!;

    expect(benchmark.tier).toBe("p0");
    expect(SPRINT_4_SMOKE_CASE_IDS).toContain("tourville-pommiers-trail-8k");
    expect(benchmark.expectedOutcome).toBe("best_effort_route");
    expect(benchmark.notes).toContain("meilleure boucle nature");
  });

  it("passes Tourville 8k smoke on a safe best-effort route with explicit trail-unavailable notice", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "tourville-pommiers-trail-8k")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 7.69,
      ascendM: 185,
      terrainFallback: {
        reason: "TRAIL_NOT_AVAILABLE_IN_LOCATION",
        policy: "best_effort_terrain",
        requestedTerrain: "trail",
        deliveredTerrain: "best_effort_nature",
        messageCode: "TRAIL_NOT_AVAILABLE_IN_LOCATION",
        message: "Chemin trail non disponible dans cette localisation : meilleure boucle nature proposée.",
      },
      quality: {
        productionScore: 0.93,
        loopClosureKm: 0.12,
        busyRoadRatio: 0,
        naturalWayRatio: 0.79,
        pavedRatio: 0.49,
        trailBeautyScore: 0.52,
        longestTrailSegmentKm: 0.9,
        naturalCorridorRatio: 0.38,
        repeatEdgeRatio: 0.01,
        uTurnRatio: 0,
        routeTrailQuality: "low",
        terrainDataConfidence: "medium",
        trailPotential: "medium",
        warnings: ["TOO_MUCH_PAVEMENT", "TRAIL_TOO_FRAGMENTED"],
      },
      durationMs: 11_750,
    });

    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
    expect(summary.metrics.actualOutcome).toBe("best_effort_route");
    expect(summary.metrics.terrainFallbackReason).toBe("TRAIL_NOT_AVAILABLE_IN_LOCATION");
  });

  it("rejects Tourville 8k smoke on silent route success without explicit trail-unavailable notice", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "tourville-pommiers-trail-8k")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 7.69,
      ascendM: 185,
      quality: {
        productionScore: 0.93,
        loopClosureKm: 0.12,
        busyRoadRatio: 0,
        naturalWayRatio: 0.79,
        pavedRatio: 0.49,
        trailBeautyScore: 0.52,
        longestTrailSegmentKm: 0.9,
        naturalCorridorRatio: 0.38,
        repeatEdgeRatio: 0.01,
        uTurnRatio: 0,
        routeTrailQuality: "low",
        terrainDataConfidence: "medium",
        trailPotential: "medium",
        warnings: ["TOO_MUCH_PAVEMENT", "TRAIL_TOO_FRAGMENTED"],
      },
      durationMs: 11_750,
    });

    expect(summary.passed).toBe(false);
    expect(summary.failures).toContain("missing_best_effort_terrain_fallback");
  });

  it("keeps Meudon exploratory instead of requiring an unproven restricted-access refusal", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "meudon-forest-trail-10k")!;

    expect(benchmark.tier).toBe("exploratory");
    expect(benchmark.expectedOutcome).toBe("route_or_typed_refusal");
    expect(benchmark.expectedRefusalSubCode).toBeUndefined();
    expect(benchmark.notes).toContain("hors critère de lancement beta fermée");
  });

  it("passes Meudon exploratory when the API returns a high-quality route without restriction evidence", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "meudon-forest-trail-10k")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 10.25,
      ascendM: 175,
      quality: {
        productionScore: 0.96,
        loopClosureKm: 0.04,
        busyRoadRatio: 0,
        trailRatio: 0.79,
        naturalWayRatio: 0.87,
        pavedRatio: 0.21,
        scenicPavedRatio: 0.05,
        trailBeautyScore: 0.68,
        longestTrailSegmentKm: 3.7,
        naturalCorridorRatio: 0.78,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        terrainDataConfidence: "high",
        trailPotential: "high",
        routeTrailQuality: "high",
        warnings: [],
      },
      durationMs: 37_267,
    });

    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
    expect(summary.metrics.actualOutcome).toBe("route_success");
  });

  it("does not pretend Meudon proves closed-beta launch readiness", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "meudon-forest-trail-10k")!;

    expect(benchmark.tags).toContain("restricted-access-ambiguous");
    expect(benchmark.notes).toContain("ne pas compter comme preuve beta nationale");
  });

  it("accepts Clécy medium trail potential without pretending high-confidence surface data", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "clecy-suisse-normande-trail-12k")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 11.77,
      ascendM: 236,
      quality: {
        productionScore: 0.9,
        loopClosureKm: 0.02,
        busyRoadRatio: 0,
        trailRatio: 0.63,
        naturalWayRatio: 0.92,
        pavedRatio: 0.36,
        scenicPavedRatio: 0.28,
        trailBeautyScore: 0.69,
        longestTrailSegmentKm: 3.5,
        naturalCorridorRatio: 0.59,
        repeatEdgeRatio: 0.02,
        uTurnRatio: 0,
        terrainDataConfidence: "medium",
        trailPotential: "medium",
        routeTrailQuality: "medium",
        warnings: ["OSM_SURFACE_DATA_WEAK"],
      },
      durationMs: 32_000,
    });

    expect(benchmark.thresholds.minTrailPotential).toBe("medium");
    expect(benchmark.expectedOutcome).toBe("route_or_typed_refusal");
    expect(benchmark.requireHonestWarnings).toBeUndefined();
    expect(benchmark.expectedWarnings).toBeUndefined();
    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
  });

  it("accepts Clécy as an honest typed refusal when trail candidates are unstable", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "clecy-suisse-normande-trail-12k")!;
    const summary = summarizeBenchmarkFailure(benchmark, {
      status: 422,
      errorCode: "ROUTE_CANDIDATES_REJECTED",
      subCode: "TRAIL_PROMISE_UNMET",
      error: "Aucune boucle stable ne respecte assez les promesses terrain/sécurité pour cette beta.",
      durationMs: 29_000,
    });

    expect(benchmark.notes).toContain("refus TRAIL_PROMISE_UNMET reste honnête");
    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
    expect(summary.metrics.actualOutcome).toBe("typed_refusal");
  });

  it("uses a geocodable Paris Buttes-Chaumont POI for the beta behavior input", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "paris-buttes-chaumont-5k-constrained")!;

    expect(benchmark.address).toBe("Parc des Buttes-Chaumont, Paris");
    expect(benchmark.expectedOutcome).toBe("park_recovery");
    expect(benchmark.expectedRefusalSubCode).toBe("PARK_TOO_SMALL_FOR_DISTANCE");
    expect(benchmark.notes).toContain("POI géocodable");
  });

  it("passes Meudon exploratory on a typed refusal without requiring a restricted-access sub-code", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "meudon-forest-trail-10k")!;
    const summary = summarizeBenchmarkFailure(benchmark, {
      status: 422,
      errorCode: "ROUTE_CANDIDATES_REJECTED",
      subCode: "TRAIL_PROMISE_UNMET",
      error: "rejected",
      durationMs: 18000,
    });

    expect(benchmark.expectedOutcome).toBe("route_or_typed_refusal");
    expect(benchmark.expectedRefusalSubCode).toBeUndefined();
    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
  });

  it("rejects an expected typed-refusal benchmark on a 200 route success even when route quality metrics are green", () => {
    const benchmark: RouteBenchmarkCase = {
      id: "restricted-access-blocked-10k",
      label: "Restricted access blocked 10k",
      address: "Synthetic restricted access fixture",
      profileId: "running_trail",
      targetDistanceKm: 10,
      targetElevationM: 180,
      tier: "p0",
      tags: ["typed-refusal"],
      expectedOutcome: "typed_refusal",
      expectedRefusalSubCode: "RESTRICTED_ACCESS_BLOCKED",
      thresholds: {
        distanceToleranceRatio: 0.1,
        elevationToleranceM: 100,
        minProductionScore: 0.7,
        maxLoopClosureKm: 0.35,
        maxBusyRoadRatio: 0.08,
        minNaturalWayRatio: 0.4,
        maxPavedRatio: 0.42,
        minTrailBeautyScore: 0.6,
        minLongestTrailSegmentKm: 2.5,
        minNaturalCorridorRatio: 0.48,
        maxRepeatEdgeRatio: 0.04,
        maxUTurnRatio: 0.01,
        minTerrainDataConfidence: "medium",
        minTrailPotential: "medium",
        minRouteTrailQuality: "high",
        maxDurationMs: 80000,
      },
      notes: "Synthetic typed-refusal contract fixture.",
    };
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 9.9,
      ascendM: 176,
      quality: {
        productionScore: 0.97,
        loopClosureKm: 0.03,
        busyRoadRatio: 0,
        trailRatio: 0.86,
        naturalWayRatio: 0.9,
        pavedRatio: 0.14,
        scenicPavedRatio: 0.04,
        trailBeautyScore: 0.69,
        longestTrailSegmentKm: 3.04,
        naturalCorridorRatio: 0.82,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        terrainDataConfidence: "high",
        trailPotential: "high",
        routeTrailQuality: "high",
        warnings: [],
      },
      durationMs: 37_267,
    });

    expect(summary.passed).toBe(false);
    expect(summary.failures).toEqual(["expected_typed_refusal"]);
    expect(summary.metrics.expectedOutcome).toBe("typed_refusal");
    expect(summary.metrics.actualOutcome).toBe("route_success");
  });

  it("passes an expected typed refusal only when the refusal sub-code matches", () => {
    const benchmark: RouteBenchmarkCase = {
      id: "micro-park-impossible-10k",
      label: "Micro park impossible 10k",
      address: "Micro parc test",
      profileId: "running-recuperation",
      targetDistanceKm: 10,
      targetElevationM: 0,
      tags: ["typed-refusal"],
      tier: "p0",
      expectedOutcome: "typed_refusal",
      expectedRefusalSubCode: "PARK_TOO_SMALL_FOR_DISTANCE",
      thresholds: {
        distanceToleranceRatio: 0.1,
        elevationToleranceM: 100,
        minProductionScore: 0,
        maxLoopClosureKm: 1,
        maxBusyRoadRatio: 1,
      },
      notes: "Synthetic refusal contract fixture.",
    };

    const summary = summarizeBenchmarkFailure(benchmark, {
      status: 422,
      errorCode: "ROUTE_CANDIDATES_REJECTED",
      subCode: "PARK_TOO_SMALL_FOR_DISTANCE",
      error: "Le parc est trop contraint pour tenir cette distance proprement.",
      durationMs: 1400,
    });

    expect(summary.passed).toBe(true);
    expect(summary.failures).toEqual([]);
    expect(summary.metrics.actualOutcome).toBe("typed_refusal");
    expect(summary.metrics.expectedRefusalSubCode).toBe("PARK_TOO_SMALL_FOR_DISTANCE");
  });

  it("fails an expected typed refusal when the API returns a generic refusal", () => {
    const benchmark: RouteBenchmarkCase = {
      id: "micro-park-impossible-10k",
      label: "Micro park impossible 10k",
      address: "Micro parc test",
      profileId: "running-recuperation",
      targetDistanceKm: 10,
      targetElevationM: 0,
      tags: ["typed-refusal"],
      tier: "p0",
      expectedOutcome: "typed_refusal",
      expectedRefusalSubCode: "PARK_TOO_SMALL_FOR_DISTANCE",
      thresholds: {
        distanceToleranceRatio: 0.1,
        elevationToleranceM: 100,
        minProductionScore: 0,
        maxLoopClosureKm: 1,
        maxBusyRoadRatio: 1,
      },
      notes: "Synthetic refusal contract fixture.",
    };

    const summary = summarizeBenchmarkFailure(benchmark, {
      status: 422,
      errorCode: "ROUTE_CANDIDATES_REJECTED",
      subCode: "TRAIL_PROMISE_UNMET",
      error: "rejected",
      durationMs: 1400,
    });

    expect(summary.passed).toBe(false);
    expect(summary.failures).toContain("typed_refusal_sub_code_mismatch");
  });

  it("still fails adjusted Caen benchmark when pavement cap is broken", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "caen-colline-aux-oiseaux-6k-soft")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 5.35,
      ascendM: 50,
      distanceAdjustment: {
        requestedDistanceKm: 6,
        adjustedDistanceKm: 5.35,
        reason: "PARK_RECOVERY_SIZE_LIMIT",
        policy: "adjusted_distance",
        messageCode: "PARK_RECOVERY_DISTANCE_ADJUSTED",
      },
      quality: {
        productionScore: 0.82,
        loopGapKm: 0.02,
        busyRoadRatio: 0,
        naturalWayRatio: 0.78,
        pavedRatio: 0.7,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        terrainDataConfidence: "high",
        trailPotential: "high",
        warnings: [],
        geometry: { loopCompactness: 0.12, geometryOverlapRatio: 0.08, selfIntersectionCount: 0, startStemKm: 0.02, endStemKm: 0.02, maxDistanceFromStartKm: 0.9 },
      },
      durationMs: 17000,
    });

    expect(summary.passed).toBe(false);
    expect(summary.failures).toContain("paved_ratio");
  });

  it("fails geometry thresholds when a constrained park route becomes a fake loop", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "caen-colline-aux-oiseaux-6k-soft")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 6,
      ascendM: 80,
      distanceAdjustment: {
        requestedDistanceKm: 6,
        adjustedDistanceKm: 6,
        reason: "PARK_RECOVERY_SIZE_LIMIT",
        policy: "adjusted_distance",
        messageCode: "PARK_RECOVERY_DISTANCE_ADJUSTED",
      },
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

  it("keeps generation diagnostics and stage timings on benchmark HTTP failures", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "meudon-forest-trail-10k")!;
    const generationDiagnostics = {
      version: 1,
      graph: { nodeCount: 240, edgeCount: 580, scenicWayCount: 36 },
      solver: { pathCount: 0, candidateCount: 0, emptyReason: "UNKNOWN_EMPTY" },
    };
    const stageTimings = {
      totalMs: 1900,
      stages: [
        { stage: "solver.solve", durationMs: 1200, ok: true },
        { stage: "postProcess.candidates", durationMs: 600, ok: true },
        { stage: "guards.betaStability", durationMs: 5, ok: false, errorCode: "ROUTE_CANDIDATES_REJECTED" },
        { stage: "total", durationMs: 1900, ok: false, errorCode: "ROUTE_CANDIDATES_REJECTED" },
      ],
    };

    const summary = summarizeBenchmarkFailure(benchmark, {
      status: 422,
      durationMs: 1900,
      errorCode: "NO_ROAD_NETWORK",
      subCode: "SOLVER_EMPTY",
      error: "Impossible de construire un parcours en boucle.",
      generationDiagnostics,
      stageTimings,
    });

    expect(summary.passed).toBe(false);
    expect(summary.generationDiagnostics).toEqual(generationDiagnostics);
    expect(summary.stageTimings).toEqual(stageTimings);
  });

  it("allows Caen Prairie and Lille Citadelle to pass as honest urban-nature typed refusals", () => {
    for (const id of ["caen-prairie-8k-mixed", "lille-10k-citadel-loop"]) {
      const benchmark = BENCHMARK_CASES.find((item) => item.id === id)!;

      expect(benchmark.expectedOutcome).toBe("route_or_typed_refusal");
      expect(benchmark.expectedRefusalSubCode).toBe("URBAN_NATURE_PROMISE_UNMET");
      expect(summarizeBenchmarkFailure(benchmark, {
        status: 422,
        errorCode: "ROUTE_CANDIDATES_REJECTED",
        subCode: "URBAN_NATURE_PROMISE_UNMET",
        error: "urban contract miss",
        durationMs: 10_000,
      }).passed).toBe(true);
    }
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
