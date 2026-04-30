import rawBenchmarkCases from "./route-benchmarks-data.json";
import type { GenerateRouteRequest } from "./types";

export interface RouteBenchmarkCase {
  id: string;
  label: string;
  address: string;
  profileId: string;
  targetDistanceKm: number;
  targetElevationM: number;
  scenicMode?: boolean;
  thresholds: {
    distanceToleranceRatio: number;
    elevationToleranceM: number;
    minProductionScore: number;
    maxLoopClosureKm: number;
    maxBusyRoadRatio: number;
    minNaturalWayRatio?: number;
    maxPavedRatio?: number;
    minTrailBeautyScore?: number;
    minLongestTrailSegmentKm?: number;
  };
  notes: string;
}

export interface BenchmarkRouteSample {
  distanceKm: number;
  ascendM: number;
  quality?: {
    productionScore?: number;
    loopClosureKm?: number;
    loopGapKm?: number;
    busyRoadRatio?: number;
    naturalWayRatio?: number;
    trailRatio?: number;
    pavedRatio?: number;
    trailBeautyScore?: number;
    longestTrailSegmentKm?: number;
    warnings?: string[];
  };
}

export interface BenchmarkSummary {
  id: string;
  label: string;
  passed: boolean;
  failures: string[];
  metrics: {
    distanceErrorRatio: number;
    elevationErrorM: number;
    productionScore: number;
    loopClosureKm: number;
    busyRoadRatio: number;
    naturalWayRatio: number;
    pavedRatio: number;
    trailBeautyScore: number;
    longestTrailSegmentKm: number;
    warnings: string[];
  };
}

export const BENCHMARK_CASES = rawBenchmarkCases as RouteBenchmarkCase[];

export function benchmarkToRequest(benchmark: RouteBenchmarkCase): GenerateRouteRequest {
  return {
    address: benchmark.address,
    profileId: benchmark.profileId,
    targetDistanceKm: benchmark.targetDistanceKm,
    targetElevationM: benchmark.targetElevationM,
    scenicMode: benchmark.scenicMode,
  };
}

export function summarizeBenchmarkResult(
  benchmark: RouteBenchmarkCase,
  route: BenchmarkRouteSample
): BenchmarkSummary {
  const quality = route.quality ?? {};
  const distanceErrorRatio = Math.abs(route.distanceKm - benchmark.targetDistanceKm) / benchmark.targetDistanceKm;
  const elevationErrorM = Math.abs(route.ascendM - benchmark.targetElevationM);
  const productionScore = quality.productionScore ?? 0;
  const loopClosureKm = quality.loopGapKm ?? quality.loopClosureKm ?? Number.POSITIVE_INFINITY;
  const busyRoadRatio = quality.busyRoadRatio ?? 1;
  const naturalWayRatio = quality.trailRatio ?? quality.naturalWayRatio ?? 0;
  const pavedRatio = quality.pavedRatio ?? 0;
  const trailBeautyScore = quality.trailBeautyScore ?? 0;
  const longestTrailSegmentKm = quality.longestTrailSegmentKm ?? 0;
  const warnings = quality.warnings ?? [];

  const failures: string[] = [];

  if (distanceErrorRatio > benchmark.thresholds.distanceToleranceRatio) {
    failures.push("distance_tolerance");
  }
  if (elevationErrorM > benchmark.thresholds.elevationToleranceM) {
    failures.push("elevation_tolerance");
  }
  if (productionScore < benchmark.thresholds.minProductionScore) {
    failures.push("production_score");
  }
  if (loopClosureKm > benchmark.thresholds.maxLoopClosureKm) {
    failures.push("loop_closure");
  }
  if (busyRoadRatio > benchmark.thresholds.maxBusyRoadRatio) {
    failures.push("busy_road_ratio");
  }
  if (
    benchmark.thresholds.minNaturalWayRatio !== undefined &&
    naturalWayRatio < benchmark.thresholds.minNaturalWayRatio
  ) {
    failures.push("natural_way_ratio");
  }
  if (
    benchmark.thresholds.maxPavedRatio !== undefined &&
    pavedRatio > benchmark.thresholds.maxPavedRatio
  ) {
    failures.push("paved_ratio");
  }
  if (
    benchmark.thresholds.minTrailBeautyScore !== undefined &&
    trailBeautyScore < benchmark.thresholds.minTrailBeautyScore
  ) {
    failures.push("trail_beauty_score");
  }
  if (
    benchmark.thresholds.minLongestTrailSegmentKm !== undefined &&
    longestTrailSegmentKm < benchmark.thresholds.minLongestTrailSegmentKm
  ) {
    failures.push("longest_trail_segment");
  }
  if (warnings.includes("ONEWAY_VIOLATION")) {
    failures.push("oneway_violation");
  }

  return {
    id: benchmark.id,
    label: benchmark.label,
    passed: failures.length === 0,
    failures,
    metrics: {
      distanceErrorRatio,
      elevationErrorM,
      productionScore,
      loopClosureKm,
      busyRoadRatio,
      naturalWayRatio,
      pavedRatio,
      trailBeautyScore,
      longestTrailSegmentKm,
      warnings,
    },
  };
}
