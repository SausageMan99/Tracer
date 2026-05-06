import type { RouteCandidate, SessionProfile } from "../types";
import type { RouteQualityMetrics } from "./route-quality";
import type { RouteIntent } from "./terrain-planner";

export type RouteHardGateKey =
  | "distance_tolerance"
  | "elevation_tolerance"
  | "production_score"
  | "loop_closure"
  | "paved_ratio"
  | "busy_road_ratio"
  | "repeat_edge_ratio"
  | "u_turn_ratio"
  | "geometry_overlap"
  | "geometry_loop_compactness"
  | "geometry_out_and_back_similarity"
  | "trail_beauty_score"
  | "natural_corridor_ratio"
  | "longest_trail_segment"
  | "trail_potential"
  | "blocking_warning";

export interface RouteHardGateViolation {
  key: RouteHardGateKey;
  actual: number | string;
  limit: number | string;
  severity: number;
  relaxable: boolean;
}

export interface RouteGateSelectionContext {
  targetDistanceKm: number;
  targetElevationM: number;
  profile: SessionProfile;
  routeIntent?: RouteIntent;
}

export interface RouteGateReport {
  strictViable: boolean;
  relaxedViable: boolean;
  bucket: 0 | 1 | 2;
  violations: RouteHardGateViolation[];
  blockingViolationCount: number;
  totalSeverity: number;
  criticalStabilityRisk: number;
}

export interface RankedRouteCandidate {
  candidate: RouteCandidate;
  originalIndex: number;
  softScore: number;
  gate: RouteGateReport;
}

const BLOCKING_WARNINGS = new Set(["ONEWAY_VIOLATION", "RESTRICTED_ACCESS"]);

function overLimitSeverity(actual: number, limit: number): number {
  return Math.max(0, (actual - limit) / Math.max(Math.abs(limit), 0.001));
}

function underLimitSeverity(actual: number, limit: number): number {
  return Math.max(0, (limit - actual) / Math.max(Math.abs(limit), 0.001));
}

function distanceTolerance(profile: SessionProfile): number {
  return profile.sessionType === "recuperation" ? 0.12 : 0.1;
}

function minProductionScore(profile: SessionProfile): number {
  return profile.sessionType === "recuperation" ? 0.68 : 0.7;
}

function maxUTurnRatio(profile: SessionProfile): number {
  return profile.sessionType === "trail" ? 0.01 : 0.015;
}

function maxRepeatEdgeRatio(profile: SessionProfile, routeIntent?: RouteIntent): number {
  return routeIntent?.maxRepeatEdgeRatio ?? (profile.sessionType === "trail" ? 0.04 : 0.06);
}

function maxGeometryOverlapRatio(profile: SessionProfile, routeIntent?: RouteIntent): number {
  return routeIntent?.maxGeometryOverlapRatio ?? (profile.sessionType === "trail" ? 0.12 : 0.18);
}

function minLoopCompactness(routeIntent?: RouteIntent): number | null {
  return routeIntent?.type === "park_loop" || routeIntent?.type === "urban_nature_loop" ? 0.06 : null;
}

const HEALTHY_GATE_MARGIN_RATIO = 0.12;
const STABILITY_RISK_EPSILON = 0.05;

function maxGateStabilityRisk(
  actual: number | undefined,
  limit: number | undefined,
  weight: number
): number {
  if (actual == null || limit == null || limit <= 0) return 0;
  const normalizedMargin = (limit - actual) / limit;
  return Math.max(0, HEALTHY_GATE_MARGIN_RATIO - normalizedMargin) * weight;
}

function minGateStabilityRisk(
  actual: number | undefined,
  limit: number | undefined,
  weight: number
): number {
  if (actual == null || limit == null || limit <= 0) return 0;
  const normalizedMargin = (actual - limit) / limit;
  return Math.max(0, HEALTHY_GATE_MARGIN_RATIO - normalizedMargin) * weight;
}

function elevationToleranceM(targetElevationM: number, profile: SessionProfile, targetDistanceKm: number): number {
  if (targetElevationM <= 50) return 60;
  if (profile.sessionType === "trail" && targetDistanceKm <= 8) return Math.max(100, targetElevationM * 0.45);
  return Math.max(90, targetElevationM * 0.45);
}

function computeCriticalStabilityRisk(
  candidate: RouteCandidate,
  context: RouteGateSelectionContext
): number {
  const { targetDistanceKm, profile, routeIntent } = context;
  const quality = candidate.quality;
  const minTrailBeautyScore = profile.sessionType === "trail"
    ? targetDistanceKm >= 14 ? 0.65 : targetDistanceKm >= 10 ? 0.6 : 0.55
    : undefined;
  const minNaturalCorridorRatio = profile.sessionType === "trail"
    ? targetDistanceKm >= 14 ? 0.55 : targetDistanceKm >= 10 ? 0.45 : 0.4
    : undefined;
  const minLongestTrailSegmentKm = profile.sessionType === "trail"
    ? targetDistanceKm >= 14 ? 4 : targetDistanceKm >= 10 ? 2.5 : 1.6
    : undefined;

  const shortTrailIntent = profile.sessionType === "trail" && targetDistanceKm <= 8;
  const productionStabilityWeight = shortTrailIntent ? 0.5 : 1.2;
  const pavedStabilityWeight = shortTrailIntent
    ? 1
    : profile.sessionType === "trail"
      ? 1.2
      : 3;

  return Math.max(
    maxGateStabilityRisk(Math.abs(candidate.distanceKm - targetDistanceKm) / Math.max(targetDistanceKm, 0.1), distanceTolerance(profile), 8),
    minGateStabilityRisk(quality?.productionScore, minProductionScore(profile), productionStabilityWeight),
    maxGateStabilityRisk(quality?.pavedRatio, routeIntent?.maxPavedRatio, pavedStabilityWeight),
    maxGateStabilityRisk(quality?.repeatEdgeRatio, maxRepeatEdgeRatio(profile, routeIntent), 5),
    maxGateStabilityRisk(quality?.uTurnRatio, maxUTurnRatio(profile), 7),
    minGateStabilityRisk(quality?.trailBeautyScore, minTrailBeautyScore, 1.5),
    minGateStabilityRisk(quality?.naturalCorridorRatio, minNaturalCorridorRatio, 2),
    minGateStabilityRisk(quality?.longestTrailSegmentKm, minLongestTrailSegmentKm, 2)
  );
}

function trailPotentialRank(value: RouteQualityMetrics["trailPotential"]): number {
  if (value === "high") return 2;
  if (value === "medium") return 1;
  return 0;
}

function addMaxViolation(
  violations: RouteHardGateViolation[],
  key: RouteHardGateKey,
  actual: number | undefined,
  limit: number | undefined,
  relaxable: boolean,
  slack = 0,
  severityWeight = 1
): void {
  if (actual == null || limit == null || actual <= limit) return;
  const relaxedLimit = limit + slack;
  violations.push({
    key,
    actual,
    limit,
    severity: overLimitSeverity(actual, limit) * severityWeight,
    relaxable: relaxable && actual <= relaxedLimit,
  });
}

function addMinViolation(
  violations: RouteHardGateViolation[],
  key: RouteHardGateKey,
  actual: number | undefined,
  limit: number | undefined,
  relaxable: boolean,
  slack = 0,
  severityWeight = 1
): void {
  if (actual == null || limit == null || actual >= limit) return;
  const relaxedLimit = limit - slack;
  violations.push({
    key,
    actual,
    limit,
    severity: underLimitSeverity(actual, limit) * severityWeight,
    relaxable: relaxable && actual >= relaxedLimit,
  });
}

export function evaluateRouteHardGates(
  candidate: RouteCandidate,
  context: RouteGateSelectionContext
): RouteGateReport {
  const { targetDistanceKm, targetElevationM, profile, routeIntent } = context;
  const quality = candidate.quality;
  const geometry = quality?.geometry;
  const violations: RouteHardGateViolation[] = [];

  const distanceErrorRatio = Math.abs(candidate.distanceKm - targetDistanceKm) / Math.max(targetDistanceKm, 0.1);
  addMaxViolation(violations, "distance_tolerance", distanceErrorRatio, distanceTolerance(profile), false, 0, 8);

  const elevationTolerance = elevationToleranceM(targetElevationM, profile, targetDistanceKm);
  const elevationErrorM = Math.abs(candidate.ascendM - targetElevationM);
  addMaxViolation(violations, "elevation_tolerance", elevationErrorM, elevationTolerance, true, 20, 0.5);

  addMinViolation(violations, "production_score", quality?.productionScore, minProductionScore(profile), true, 0.04, 1.4);
  addMaxViolation(violations, "paved_ratio", quality?.pavedRatio, routeIntent?.maxPavedRatio, true, 0.08, 3);
  addMaxViolation(violations, "busy_road_ratio", quality?.busyRoadRatio, routeIntent?.maxBusyRoadRatio ?? 0.08, true, 0.03, 2);
  addMaxViolation(violations, "repeat_edge_ratio", quality?.repeatEdgeRatio, maxRepeatEdgeRatio(profile, routeIntent), false, 0, 5);
  addMaxViolation(violations, "u_turn_ratio", quality?.uTurnRatio, maxUTurnRatio(profile), false, 0, 8);
  addMaxViolation(violations, "geometry_overlap", geometry?.geometryOverlapRatio, maxGeometryOverlapRatio(profile, routeIntent), false, 0, 3);
  addMaxViolation(violations, "geometry_out_and_back_similarity", geometry?.outAndBackSimilarityRatio, routeIntent?.type === "park_loop" ? 0.22 : 0.32, true, 0.06, 1.2);
  if (profile.sessionType === "trail") {
    addMinViolation(violations, "trail_beauty_score", quality?.trailBeautyScore, targetDistanceKm >= 14 ? 0.65 : targetDistanceKm >= 10 ? 0.6 : 0.55, false, 0, 2);
    addMinViolation(violations, "natural_corridor_ratio", quality?.naturalCorridorRatio, targetDistanceKm >= 14 ? 0.55 : targetDistanceKm >= 10 ? 0.45 : 0.4, false, 0, 1.4);
    addMinViolation(violations, "longest_trail_segment", quality?.longestTrailSegmentKm, targetDistanceKm >= 14 ? 4 : targetDistanceKm >= 10 ? 2.5 : 1.6, false, 0, 1.2);
    const minimumTrailPotentialRank = targetDistanceKm >= 14 ? 2 : 1;
    if (trailPotentialRank(quality?.trailPotential) < minimumTrailPotentialRank) {
      violations.push({
        key: "trail_potential",
        actual: quality?.trailPotential ?? "unknown",
        limit: minimumTrailPotentialRank === 2 ? "high" : "medium",
        severity: 1,
        relaxable: false,
      });
    }
  }
  const loopCompactnessLimit = minLoopCompactness(routeIntent);
  if (routeIntent?.type === "park_loop" || routeIntent?.type === "urban_nature_loop") {
    addMinViolation(violations, "geometry_loop_compactness", geometry?.loopCompactness, loopCompactnessLimit ?? undefined, true, 0.03, 0.05);
  } else {
    addMinViolation(violations, "geometry_loop_compactness", geometry?.loopCompactness, loopCompactnessLimit ?? undefined, false, 0, 2);
  }

  for (const warning of quality?.warnings ?? []) {
    if (!BLOCKING_WARNINGS.has(warning)) continue;
    violations.push({
      key: "blocking_warning",
      actual: warning,
      limit: "absent",
      severity: 1,
      relaxable: false,
    });
  }

  const blockingViolationCount = violations.filter((violation) => !violation.relaxable).length;
  const totalSeverity = violations.reduce((sum, violation) => sum + violation.severity, 0);
  const criticalStabilityRisk = computeCriticalStabilityRisk(candidate, context);
  const strictViable = violations.length === 0;
  const relaxedViable = blockingViolationCount === 0;
  const bucket: 0 | 1 | 2 = strictViable ? 0 : relaxedViable ? 1 : 2;

  return {
    strictViable,
    relaxedViable,
    bucket,
    violations,
    blockingViolationCount,
    totalSeverity,
    criticalStabilityRisk,
  };
}

export function compareRankedRouteCandidates(a: RankedRouteCandidate, b: RankedRouteCandidate): number {
  if (a.gate.bucket !== b.gate.bucket) return a.gate.bucket - b.gate.bucket;

  if (a.gate.bucket === 2) {
    if (a.gate.blockingViolationCount !== b.gate.blockingViolationCount) {
      return a.gate.blockingViolationCount - b.gate.blockingViolationCount;
    }
    if (a.gate.totalSeverity !== b.gate.totalSeverity) return a.gate.totalSeverity - b.gate.totalSeverity;
    if (Math.abs(a.gate.criticalStabilityRisk - b.gate.criticalStabilityRisk) > STABILITY_RISK_EPSILON) {
      return a.gate.criticalStabilityRisk - b.gate.criticalStabilityRisk;
    }
    if (a.softScore !== b.softScore) return b.softScore - a.softScore;
    return a.originalIndex - b.originalIndex;
  }

  if (a.gate.bucket === 1) {
    if (a.gate.totalSeverity !== b.gate.totalSeverity) return a.gate.totalSeverity - b.gate.totalSeverity;
    if (Math.abs(a.gate.criticalStabilityRisk - b.gate.criticalStabilityRisk) > STABILITY_RISK_EPSILON) {
      return a.gate.criticalStabilityRisk - b.gate.criticalStabilityRisk;
    }
    if (a.softScore !== b.softScore) return b.softScore - a.softScore;
    return a.originalIndex - b.originalIndex;
  }

  if (Math.abs(a.gate.criticalStabilityRisk - b.gate.criticalStabilityRisk) > STABILITY_RISK_EPSILON) {
    return a.gate.criticalStabilityRisk - b.gate.criticalStabilityRisk;
  }
  if (a.softScore !== b.softScore) return b.softScore - a.softScore;
  return a.originalIndex - b.originalIndex;
}

export function isBetaStableCandidate(
  candidate: RouteCandidate,
  context: RouteGateSelectionContext
): boolean {
  const gate = evaluateRouteHardGates(candidate, context);
  return gate.bucket === 0 && gate.criticalStabilityRisk <= STABILITY_RISK_EPSILON;
}

export function orderCandidatesByHardGates(
  candidates: RouteCandidate[],
  context: RouteGateSelectionContext,
  score: (candidate: RouteCandidate) => number
): RouteCandidate[] {
  return candidates
    .map((candidate, originalIndex) => ({
      candidate,
      originalIndex,
      softScore: score(candidate),
      gate: evaluateRouteHardGates(candidate, context),
    }))
    .sort(compareRankedRouteCandidates)
    .map((entry) => entry.candidate);
}
