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
    minNaturalCorridorRatio?: number;
    maxRepeatEdgeRatio?: number;
    maxUTurnRatio?: number;
    minTerrainDataConfidence?: "low" | "medium" | "high";
    minTrailPotential?: "low" | "medium" | "high";
    maxDurationMs?: number;
  };
  blockingWarnings?: string[];
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
    naturalCorridorRatio?: number;
    repeatEdgeRatio?: number;
    uTurnRatio?: number;
    terrainDataConfidence?: "low" | "medium" | "high";
    trailPotential?: "low" | "medium" | "high";
    warnings?: string[];
  };
  durationMs?: number;
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
    naturalCorridorRatio: number;
    repeatEdgeRatio: number;
    uTurnRatio: number;
    terrainDataConfidence: "unknown" | "low" | "medium" | "high";
    trailPotential: "unknown" | "low" | "medium" | "high";
    durationMs: number | null;
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
  const naturalCorridorRatio = quality.naturalCorridorRatio ?? 0;
  const repeatEdgeRatio = quality.repeatEdgeRatio ?? 0;
  const uTurnRatio = quality.uTurnRatio ?? 0;
  const terrainDataConfidence = quality.terrainDataConfidence ?? "unknown";
  const trailPotential = quality.trailPotential ?? "unknown";
  const durationMs = route.durationMs ?? null;
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
  if (
    benchmark.thresholds.minNaturalCorridorRatio !== undefined &&
    naturalCorridorRatio < benchmark.thresholds.minNaturalCorridorRatio
  ) {
    failures.push("natural_corridor_ratio");
  }
  if (
    benchmark.thresholds.maxRepeatEdgeRatio !== undefined &&
    repeatEdgeRatio > benchmark.thresholds.maxRepeatEdgeRatio
  ) {
    failures.push("repeat_edge_ratio");
  }
  if (
    benchmark.thresholds.maxUTurnRatio !== undefined &&
    uTurnRatio > benchmark.thresholds.maxUTurnRatio
  ) {
    failures.push("u_turn_ratio");
  }
  if (
    benchmark.thresholds.minTerrainDataConfidence !== undefined &&
    compareOrderedLevel(terrainDataConfidence, benchmark.thresholds.minTerrainDataConfidence) < 0
  ) {
    failures.push("terrain_data_confidence");
  }
  if (
    benchmark.thresholds.minTrailPotential !== undefined &&
    compareOrderedLevel(trailPotential, benchmark.thresholds.minTrailPotential) < 0
  ) {
    failures.push("trail_potential");
  }
  if (
    benchmark.thresholds.maxDurationMs !== undefined &&
    durationMs !== null &&
    durationMs > benchmark.thresholds.maxDurationMs
  ) {
    failures.push("duration_ms");
  }
  for (const warning of benchmark.blockingWarnings ?? ["ONEWAY_VIOLATION"]) {
    if (warnings.includes(warning)) {
      failures.push(warningToFailure(warning));
    }
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
      naturalCorridorRatio,
      repeatEdgeRatio,
      uTurnRatio,
      terrainDataConfidence,
      trailPotential,
      durationMs,
      warnings,
    },
  };
}

function compareOrderedLevel(
  actual: "unknown" | "low" | "medium" | "high",
  minimum: "low" | "medium" | "high"
): number {
  const rank = { unknown: -1, low: 0, medium: 1, high: 2 } as const;
  return rank[actual] - rank[minimum];
}

function warningToFailure(warning: string): string {
  if (warning === "ONEWAY_VIOLATION") return "oneway_violation";
  if (warning === "U_TURN_DETECTED") return "u_turn_detected";
  if (warning === "TOO_MUCH_BACKTRACKING") return "backtracking_detected";
  return `blocking_warning:${warning}`;
}
