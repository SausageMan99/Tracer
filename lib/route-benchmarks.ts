import rawBenchmarkCases from "./route-benchmarks-data.json";
import {
  benchmarkToRequestCore,
  summarizeBenchmarkFailure as summarizeBenchmarkFailureCore,
  summarizeBenchmarkResult as summarizeBenchmarkResultCore,
} from "./route-benchmarks-core.mjs";
import {
  TERRAIN_AWARE_BENCHMARK_PANEL_IDS,
  TERRAIN_AWARE_BENCHMARK_PANELS,
  assertBenchmarkPanelCoverage,
  filterBenchmarksByPanel,
  resolveBenchmarkPanel,
  summarizeBenchmarkPanels,
} from "./route-benchmark-panels.mjs";
import type { GenerateRouteRequest, RouteGenerationDiagnostics, RouteGenerationStageTimings } from "./types";

export type TerrainAwareBenchmarkPanelId =
  | "true_forest_trail"
  | "transition_to_woods"
  | "park_recovery"
  | "urban_nature"
  | "poor_osm_rural"
  | "negative_impossible";

export interface TerrainAwareBenchmarkPanel {
  id: TerrainAwareBenchmarkPanelId;
  label: string;
  promise: string;
  caseIds: readonly string[];
  hardSignals: readonly string[];
  acceptableOutcomes: readonly string[];
}

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
  readinessStatus?: "stable" | "unstable" | "readiness_only";
  betaSmokeExcludedReason?: string;
  expectedOutcome?: "exact_distance" | "adjusted_distance" | "typed_refusal" | "park_recovery" | "route_or_typed_refusal" | "best_effort_route";
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
  terrainFallback?: import("./types").RouteTerrainFallback;
}

export interface BenchmarkFailureSample {
  status: number;
  errorCode?: string;
  subCode?: string | null;
  error?: string | null;
  durationMs?: number;
  rejectedCandidatesDiagnostics?: unknown;
  stageTimings?: RouteGenerationStageTimings | unknown;
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
    expectedOutcome?: "exact_distance" | "adjusted_distance" | "typed_refusal" | "park_recovery" | "route_or_typed_refusal" | "best_effort_route";
    readinessStatus?: "stable" | "unstable" | "readiness_only";
    betaSmokeExcludedReason?: string;
    actualOutcome?: "exact_distance" | "adjusted_distance" | "typed_refusal" | "http_error" | "route_success" | "best_effort_route";
    expectedRefusalSubCode?: string | null;
    refusalSubCode?: string | null;
    terrainFallbackReason?: string | null;
    terrainFallbackMessageCode?: string | null;
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
    shapeQualityScore?: number;
    shapeQuality?: {
      available: boolean;
      score: number;
      thresholds: Record<string, number | string>;
      issues: Array<{
        key: string;
        actual: number | null;
        limit: number | null;
        direction: string;
        severity: number;
        weight: number;
      }>;
    };
    opportunityCapture?: {
      schemaVersion: number;
      observationOnly: boolean;
      scoringBehaviorChanged: boolean;
      caseId: string;
      opportunityCaptureScore: number;
      naturalDwellCaptureRatio: number;
      continuousNaturalCaptureRatio: number;
      targetComponentCaptureRatio: number;
      connectorEfficiencyRatio: number;
      avoidablePavementKm: number;
      missedBetterComponentCount: number;
      promiseHonestyScore: number;
      inputs: Record<string, unknown>;
      approximationNotes: string[];
    };
  };
  stageTimings?: RouteGenerationStageTimings | unknown;
  generationDiagnostics?: RouteGenerationDiagnostics | unknown;
}

export const BENCHMARK_CASES = rawBenchmarkCases as RouteBenchmarkCase[];

export const TERRAIN_AWARE_PANELS = TERRAIN_AWARE_BENCHMARK_PANELS as Record<TerrainAwareBenchmarkPanelId, TerrainAwareBenchmarkPanel>;
export const TERRAIN_AWARE_PANEL_IDS = TERRAIN_AWARE_BENCHMARK_PANEL_IDS as readonly TerrainAwareBenchmarkPanelId[];
export const getTerrainAwarePanelForBenchmark = resolveBenchmarkPanel as (benchmarkOrId: RouteBenchmarkCase | string) => TerrainAwareBenchmarkPanel | null;
export const filterBenchmarksForTerrainAwarePanel = filterBenchmarksByPanel as (benchmarks: RouteBenchmarkCase[], panelId: TerrainAwareBenchmarkPanelId) => RouteBenchmarkCase[];
export const summarizeTerrainAwarePanels = summarizeBenchmarkPanels as (results: Array<{ id: string; passed: boolean; skipped?: boolean; panel?: { id: string } }>) => Array<{
  id: TerrainAwareBenchmarkPanelId;
  label: string;
  promise: string;
  caseIds: string[];
  total: number;
  passed: number;
  failed: number;
  skipped: number;
  hardSignals: string[];
  acceptableOutcomes: string[];
}>;
export const validateTerrainAwarePanelCoverage = assertBenchmarkPanelCoverage as (benchmarks: RouteBenchmarkCase[]) => { ok: boolean; errors: string[] };

export const BETA_SMOKE_CASE_IDS = [
  "tourville-pommiers-trail-8k",
  "fontainebleau-trail-15k",
  "caen-colline-aux-oiseaux-6k-soft",
  "meudon-forest-trail-10k",
] as const;

export const BETA_BEHAVIOR_CASE_IDS = [
  "tourville-pommiers-trail-8k",
  "caen-colline-aux-oiseaux-6k-soft",
  "fontainebleau-trail-15k",
  "clecy-suisse-normande-trail-12k",
  "caen-prairie-8k-mixed",
  "lille-10k-citadel-loop",
  "paris-buttes-chaumont-5k-constrained",
  "meudon-forest-trail-10k",
] as const;

export const READINESS_UNSTABLE_CASE_IDS = [
  "tourville-pommiers-trail-12k",
] as const;

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
