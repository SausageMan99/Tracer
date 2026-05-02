import rawBenchmarkCases from "./route-benchmarks-data.json";
import {
  benchmarkToRequestCore,
  summarizeBenchmarkResult as summarizeBenchmarkResultCore,
} from "./route-benchmarks-core.mjs";
import type { GenerateRouteRequest } from "./types";

export interface RouteBenchmarkCase {
  id: string;
  label: string;
  address: string;
  profileId: string;
  targetDistanceKm: number;
  targetElevationM: number;
  scenicMode?: boolean;
  tags?: string[];
  tier?: "p0" | "p1" | "p2" | "exploratory";
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
    maxGeometryOverlapRatio?: number;
    maxSelfIntersectionCount?: number;
    maxSharpTurnDensityPerKm?: number;
    maxHeadingReversalRatio?: number;
    maxOutAndBackSimilarityRatio?: number;
    minLoopCompactness?: number;
    maxStartEndStemKm?: number;
    minMaxDistanceFromStartKm?: number;
  };
  expectedWarnings?: string[];
  allowedWarnings?: string[];
  requireHonestWarnings?: boolean;
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
    scenicPavedRatio?: number;
    trailBeautyScore?: number;
    longestTrailSegmentKm?: number;
    naturalCorridorRatio?: number;
    repeatEdgeRatio?: number;
    uTurnRatio?: number;
    terrainDataConfidence?: "low" | "medium" | "high";
    trailPotential?: "low" | "medium" | "high";
    warnings?: string[];
    elevationDiagnostics?: {
      absoluteErrorM?: number;
      relativeErrorPct?: number;
      withinAbsoluteTolerance?: boolean;
      messageCode?: string;
    };
    geometry?: {
      loopCompactness?: number;
      geometryOverlapRatio?: number;
      selfIntersectionCount?: number;
      sharpTurnDensityPerKm?: number;
      headingReversalRatio?: number;
      outAndBackSimilarityRatio?: number;
      startStemKm?: number;
      endStemKm?: number;
      maxDistanceFromStartKm?: number;
    };
  };
  durationMs?: number;
}

export interface BenchmarkSummary {
  id: string;
  label: string;
  tier?: "p0" | "p1" | "p2" | "exploratory";
  tags: string[];
  passed: boolean;
  failures: string[];
  metrics: {
    distanceKm: number;
    ascendM: number;
    distanceErrorRatio: number;
    elevationErrorM: number;
    productionScore: number;
    loopClosureKm: number;
    busyRoadRatio: number;
    trailRatio: number;
    naturalWayRatio: number;
    pavedRatio: number;
    scenicPavedRatio: number;
    trailBeautyScore: number;
    longestTrailSegmentKm: number;
    naturalCorridorRatio: number;
    repeatEdgeRatio: number;
    uTurnRatio: number;
    terrainDataConfidence: "unknown" | "low" | "medium" | "high";
    trailPotential: "unknown" | "low" | "medium" | "high";
    durationMs: number | null;
    warnings: string[];
    elevationErrorPct: number;
    elevationWithinTolerance: boolean | null;
    elevationDiagnosticCode: string | null;
    geometry: {
      loopCompactness: number;
      geometryOverlapRatio: number;
      selfIntersectionCount: number;
      sharpTurnDensityPerKm: number;
      headingReversalRatio: number;
      outAndBackSimilarityRatio: number;
      startStemKm: number;
      endStemKm: number;
      maxDistanceFromStartKm: number;
    };
  };
}

export const BENCHMARK_CASES = rawBenchmarkCases as RouteBenchmarkCase[];

export function benchmarkToRequest(benchmark: RouteBenchmarkCase): GenerateRouteRequest {
  return benchmarkToRequestCore(benchmark) as GenerateRouteRequest;
}

export function summarizeBenchmarkResult(
  benchmark: RouteBenchmarkCase,
  route: BenchmarkRouteSample
): BenchmarkSummary {
  return summarizeBenchmarkResultCore(benchmark, route) as BenchmarkSummary;
}
