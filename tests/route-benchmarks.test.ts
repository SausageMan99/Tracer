import { describe, expect, it } from "vitest";
import {
  BENCHMARK_CASES,
  benchmarkToRequest,
  summarizeBenchmarkResult,
} from "@/lib/route-benchmarks";
import { PROFILES_BY_ID } from "@/lib/session-profiles";

describe("route production benchmarks", () => {
  it("covers the critical Reddit/product regression cases", () => {
    const ids = BENCHMARK_CASES.map((benchmark) => benchmark.id);

    expect(ids).toContain("lille-10k-citadel-loop");
    expect(ids).toContain("paris-19-canal-running");
    expect(ids).toContain("dijon-hilly-running");
    expect(ids).toContain("nanterre-east-avoid-highways");
    expect(ids).toContain("rennes-saint-malo-road-bike");
    expect(ids).toContain("mtb-40k-oneway-safety");
    expect(ids).toContain("fontainebleau-trail-15k");
  });

  it("keeps benchmark ids unique and linked to valid session profiles", () => {
    const ids = BENCHMARK_CASES.map((benchmark) => benchmark.id);
    expect(new Set(ids).size).toBe(ids.length);

    for (const benchmark of BENCHMARK_CASES) {
      expect(PROFILES_BY_ID.has(benchmark.profileId)).toBe(true);
      expect(benchmark.targetDistanceKm).toBeGreaterThan(0);
      expect(benchmark.targetElevationM).toBeGreaterThanOrEqual(0);
    }
  });

  it("keeps every benchmark threshold actionable", () => {
    for (const benchmark of BENCHMARK_CASES) {
      expect(benchmark.thresholds.distanceToleranceRatio).toBeGreaterThan(0);
      expect(benchmark.thresholds.distanceToleranceRatio).toBeLessThanOrEqual(0.15);
      expect(benchmark.thresholds.elevationToleranceM).toBeGreaterThan(0);
      expect(benchmark.thresholds.minProductionScore).toBeGreaterThanOrEqual(0.65);
      expect(benchmark.thresholds.minProductionScore).toBeLessThanOrEqual(0.9);
      expect(benchmark.thresholds.maxLoopClosureKm).toBeGreaterThan(0);
      expect(benchmark.thresholds.maxBusyRoadRatio).toBeGreaterThanOrEqual(0);
      expect(benchmark.thresholds.maxBusyRoadRatio).toBeLessThanOrEqual(0.15);
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
        warnings: ["DISTANCE_OFF_TARGET", "TOO_MUCH_BUSY_ROAD"],
      },
    });

    expect(summary.passed).toBe(false);
    expect(summary.failures).toEqual(expect.arrayContaining([
      "distance_tolerance",
      "production_score",
      "busy_road_ratio",
    ]));
  });

  it("fails a route when VTT safety reports a oneway violation", () => {
    const benchmark = BENCHMARK_CASES.find((item) => item.id === "mtb-40k-oneway-safety")!;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: 40.5,
      ascendM: 790,
      quality: {
        productionScore: 0.82,
        loopClosureKm: 0.4,
        busyRoadRatio: 0.01,
        naturalWayRatio: 0.6,
        warnings: ["ONEWAY_VIOLATION"],
      },
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
        warnings: [],
      },
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
        warnings: [],
      },
    });

    expect(summary.passed).toBe(false);
    expect(summary.failures).toEqual(expect.arrayContaining([
      "paved_ratio",
      "trail_beauty_score",
      "longest_trail_segment",
    ]));
  });
});
