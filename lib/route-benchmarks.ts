import rawBenchmarkCases from "./route-benchmarks-data.json";
import {
  benchmarkToRequestCore,
  summarizeBenchmarkFailure as summarizeBenchmarkFailureCore,
  summarizeBenchmarkResult as summarizeBenchmarkResultCore,
} from "./route-benchmarks-core.mjs";
import type { GenerateRouteRequest, RouteGenerationDiagnostics } from "./types";

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
  expectedOutcome?: "exact_distance" | "adjusted_distance" | "typed_refusal" | "park_recovery";
  expectedRefusalSubCode?: string;
  adjustedDistanceKm?: { min: number; max: number };
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
    minRouteTrailQuality?: "low" | "medium" | "high";
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
    routeTrailQuality?: "low" | "medium" | "high";
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
  distanceAdjustment?: import("./types").RouteDistanceAdjustment;
}

export interface BenchmarkFailureSample {
  status: number;
  errorCode?: string;
  subCode?: string | null;
  error?: string | null;
  durationMs?: number;
  rejectedCandidatesDiagnostics?: unknown;
  generationDiagnostics?: RouteGenerationDiagnostics | unknown;
  routeArtifacts?: unknown;
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
    requestedDistanceKm?: number | null;
    adjustedDistanceKm?: number | null;
    distanceAdjustmentReason?: string | null;
    expectedOutcome?: "exact_distance" | "adjusted_distance" | "typed_refusal" | "park_recovery";
    actualOutcome?: "exact_distance" | "adjusted_distance" | "typed_refusal" | "http_error";
    expectedRefusalSubCode?: string | null;
    refusalSubCode?: string | null;
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
    routeTrailQuality: "unknown" | "low" | "medium" | "high";
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
  generationDiagnostics?: RouteGenerationDiagnostics | unknown;
}

export const BENCHMARK_CASES = rawBenchmarkCases as RouteBenchmarkCase[];

export function benchmarkToRequest(benchmark: RouteBenchmarkCase): GenerateRouteRequest {
  return benchmarkToRequestCore(benchmark) as GenerateRouteRequest;
}

export function summarizeBenchmarkFailure(
  benchmark: RouteBenchmarkCase,
  payload: BenchmarkFailureSample
): BenchmarkSummary {
  return summarizeBenchmarkFailureCore(benchmark, payload) as unknown as BenchmarkSummary;
}

export function summarizeBenchmarkResult(
  benchmark: RouteBenchmarkCase,
  route: BenchmarkRouteSample
): BenchmarkSummary {
  return summarizeBenchmarkResultCore(benchmark, route) as BenchmarkSummary;
}
