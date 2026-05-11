import type {
  RouteErrorSubCode,
} from "../errors";
import type {
  RejectedRouteCandidatesDiagnostics,
  RejectedRouteCandidateDebugSummary,
  RouteCandidate,
  RouteCandidateGateDelta,
  SessionProfile,
} from "../types";
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
  | "geometry_self_intersection"
  | "geometry_loop_compactness"
  | "geometry_out_and_back_similarity"
  | "trail_beauty_score"
  | "natural_corridor_ratio"
  | "longest_trail_segment"
  | "trail_potential"
  | "route_trail_quality"
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

export type RouteDistanceAcceptance = "strict" | "adjusted" | "rejected";

export interface RouteGateReport {
  strictViable: boolean;
  relaxedViable: boolean;
  bucket: 0 | 1 | 2;
  violations: RouteHardGateViolation[];
  blockingViolationCount: number;
  totalSeverity: number;
  criticalStabilityRisk: number;
  routeTrailQualityRank: number;
}

export interface RankedRouteCandidate {
  candidate: RouteCandidate;
  originalIndex: number;
  softScore: number;
  gate: RouteGateReport;
}

const BLOCKING_WARNINGS = new Set(["ONEWAY_VIOLATION", "RESTRICTED_ACCESS"]);
const TRACE_RESTRICTED_ACCESS_RATIO = 0.005;

function isBlockingWarning(warning: string, quality: RouteQualityMetrics | undefined): boolean {
  if (!BLOCKING_WARNINGS.has(warning)) return false;
  if (warning === "RESTRICTED_ACCESS") {
    return (quality?.restrictedAccessRatio ?? 1) > TRACE_RESTRICTED_ACCESS_RATIO;
  }
  return true;
}

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

function allowsTraceSelfIntersection(
  geometry: RouteQualityMetrics["geometry"] | undefined,
  quality: RouteQualityMetrics | undefined,
  context: RouteGateSelectionContext
): boolean {
  if (context.profile.sessionType !== "trail") return false;
  if (context.routeIntent?.type !== "transition_to_woods" && context.routeIntent?.type !== "forest_loop") return false;
  if ((geometry?.selfIntersectionCount ?? 0) > 1) return false;
  if ((geometry?.geometryOverlapRatio ?? 1) > Math.min(0.08, maxGeometryOverlapRatio(context.profile, context.routeIntent) * 0.75)) return false;
  if ((geometry?.outAndBackSimilarityRatio ?? 1) > 0.12) return false;
  if ((quality?.repeatEdgeRatio ?? 1) > maxRepeatEdgeRatio(context.profile, context.routeIntent) * 0.8) return false;
  if ((quality?.uTurnRatio ?? 1) > maxUTurnRatio(context.profile) * 0.8) return false;
  return routeTrailQualityRankFor(quality?.routeTrailQuality) >= 1;
}

const HEALTHY_GATE_MARGIN_RATIO = 0.12;
const STABILITY_RISK_EPSILON = 0.05;

export function distanceAcceptanceForCandidate(
  candidate: RouteCandidate,
  context: RouteGateSelectionContext
): RouteDistanceAcceptance {
  const { targetDistanceKm, profile, routeIntent } = context;
  const distanceErrorRatio = Math.abs(candidate.distanceKm - targetDistanceKm) / Math.max(targetDistanceKm, 0.1);
  const withinStrictDistance = distanceErrorRatio <= distanceTolerance(profile);
  const policy = routeIntent?.distancePolicy;
  if (withinStrictDistance && (policy?.mode !== "adjustable" || candidate.distanceKm >= policy.requestedDistanceKm)) {
    return "strict";
  }
  if (
    policy?.mode === "adjustable" &&
    profile.sport === "running" &&
    profile.sessionType === "recuperation" &&
    routeIntent?.type === "park_loop" &&
    candidate.distanceKm >= policy.minAdjustedDistanceKm &&
    candidate.distanceKm <= policy.maxAdjustedDistanceKm
  ) {
    return "adjusted";
  }
  return withinStrictDistance ? "strict" : "rejected";
}

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

function routeTrailQualityRankFor(value: RouteQualityMetrics["routeTrailQuality"]): number {
  if (value === "high") return 2;
  if (value === "medium") return 1;
  return 0;
}

function rankedRouteTrailQuality(candidate: RouteCandidate, context: RouteGateSelectionContext): number {
  if (context.profile.sessionType !== "trail") return 0;
  return routeTrailQualityRankFor(candidate.quality?.routeTrailQuality);
}

function minimumRouteTrailQualityRank(context: RouteGateSelectionContext): number | null {
  if (context.profile.sessionType !== "trail") return null;
  if (context.targetDistanceKm <= 8) return 2;
  if (context.targetDistanceKm >= 10) return 1;
  return null;
}

function routeTrailQualityLabel(rank: number): "medium" | "high" {
  return rank >= 2 ? "high" : "medium";
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
  if (distanceAcceptanceForCandidate(candidate, context) === "rejected") {
    addMaxViolation(violations, "distance_tolerance", distanceErrorRatio, distanceTolerance(profile), false, 0, 8);
  }

  const elevationTolerance = elevationToleranceM(targetElevationM, profile, targetDistanceKm);
  const elevationErrorM = Math.abs(candidate.ascendM - targetElevationM);
  addMaxViolation(violations, "elevation_tolerance", elevationErrorM, elevationTolerance, true, 20, 0.5);

  addMinViolation(violations, "production_score", quality?.productionScore, minProductionScore(profile), true, 0.04, 1.4);
  addMaxViolation(violations, "paved_ratio", quality?.pavedRatio, routeIntent?.maxPavedRatio, true, 0.08, 3);
  addMaxViolation(violations, "busy_road_ratio", quality?.busyRoadRatio, routeIntent?.maxBusyRoadRatio ?? 0.08, true, 0.03, 2);
  addMaxViolation(violations, "repeat_edge_ratio", quality?.repeatEdgeRatio, maxRepeatEdgeRatio(profile, routeIntent), false, 0, 5);
  addMaxViolation(violations, "u_turn_ratio", quality?.uTurnRatio, maxUTurnRatio(profile), false, 0, 8);
  addMaxViolation(violations, "geometry_overlap", geometry?.geometryOverlapRatio, maxGeometryOverlapRatio(profile, routeIntent), false, 0, 3);
  if (!allowsTraceSelfIntersection(geometry, quality, context)) {
    addMaxViolation(violations, "geometry_self_intersection", geometry?.selfIntersectionCount, 0, false, 0, 1);
  }
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
    const minimumRouteTrailRank = minimumRouteTrailQualityRank(context);
    if (minimumRouteTrailRank != null && quality?.routeTrailQuality != null && routeTrailQualityRankFor(quality.routeTrailQuality) < minimumRouteTrailRank) {
      violations.push({
        key: "route_trail_quality",
        actual: quality.routeTrailQuality,
        limit: routeTrailQualityLabel(minimumRouteTrailRank),
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
    if (!isBlockingWarning(warning, quality)) continue;
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
  const routeTrailQualityRank = rankedRouteTrailQuality(candidate, context);
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
    routeTrailQualityRank,
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
    if (a.gate.routeTrailQualityRank !== b.gate.routeTrailQualityRank) {
      return b.gate.routeTrailQualityRank - a.gate.routeTrailQualityRank;
    }
    if (Math.abs(a.gate.criticalStabilityRisk - b.gate.criticalStabilityRisk) > STABILITY_RISK_EPSILON) {
      return a.gate.criticalStabilityRisk - b.gate.criticalStabilityRisk;
    }
    if (a.softScore !== b.softScore) return b.softScore - a.softScore;
    return a.originalIndex - b.originalIndex;
  }

  if (a.gate.routeTrailQualityRank !== b.gate.routeTrailQualityRank) {
    return b.gate.routeTrailQualityRank - a.gate.routeTrailQualityRank;
  }
  if (Math.abs(a.gate.criticalStabilityRisk - b.gate.criticalStabilityRisk) > STABILITY_RISK_EPSILON) {
    return a.gate.criticalStabilityRisk - b.gate.criticalStabilityRisk;
  }
  if (a.softScore !== b.softScore) return b.softScore - a.softScore;
  return a.originalIndex - b.originalIndex;
}

function isTinyRecoveryParkCompactnessMiss(
  gate: RouteGateReport,
  context: RouteGateSelectionContext
): boolean {
  if (context.profile.sessionType !== "recuperation") return false;
  if (context.routeIntent?.type !== "park_loop") return false;
  if (gate.bucket !== 1 || gate.blockingViolationCount !== 0) return false;
  if (gate.totalSeverity > 0.003) return false;
  return gate.violations.length > 0 && gate.violations.every((violation) =>
    violation.relaxable && violation.key === "geometry_loop_compactness"
  );
}

export function isBetaStableCandidate(
  candidate: RouteCandidate,
  context: RouteGateSelectionContext
): boolean {
  const gate = evaluateRouteHardGates(candidate, context);
  return gate.bucket === 0 || isTinyRecoveryParkCompactnessMiss(gate, context);
}

export function rejectionSubCodeForCandidate(
  candidate: RouteCandidate,
  context: RouteGateSelectionContext
): RouteErrorSubCode {
  const gate = evaluateRouteHardGates(candidate, context);
  const pavedViolation = gate.violations.find((violation) => violation.key === "paved_ratio");
  const distanceViolation = gate.violations.find((violation) => violation.key === "distance_tolerance");
  const compactnessViolation = gate.violations.find((violation) => violation.key === "geometry_loop_compactness");
  const nonRelaxableViolations = gate.violations.filter((violation) => !violation.relaxable);
  const hasRestrictedAccessBlock = nonRelaxableViolations.some(
    (violation) => violation.key === "blocking_warning" && violation.actual === "RESTRICTED_ACCESS"
  );
  const otherNonRelaxableSeverity = nonRelaxableViolations
    .filter((violation) => !(violation.key === "blocking_warning" && violation.actual === "RESTRICTED_ACCESS"))
    .reduce((sum, violation) => sum + violation.severity, 0);
  if (hasRestrictedAccessBlock && otherNonRelaxableSeverity <= 0.05) {
    return "RESTRICTED_ACCESS_BLOCKED";
  }
  if (
    context.profile.sessionType === "recuperation" &&
    context.routeIntent?.type === "park_loop" &&
    (pavedViolation != null || distanceViolation != null || compactnessViolation != null)
  ) {
    return "PARK_TOO_SMALL_FOR_DISTANCE";
  }
  return "TRAIL_PROMISE_UNMET";
}

function roundedDelta(value: number): number {
  return Number(value.toFixed(6));
}

function numericDelta(key: string, actual: number | undefined, limit: number | undefined, mode: "max" | "min"): RouteCandidateGateDelta {
  if (actual == null || limit == null) {
    return { key, actual: actual ?? null, limit: limit ?? null, deltaToPass: null };
  }
  const delta = mode === "max" ? limit - actual : actual - limit;
  return { key, actual, limit, deltaToPass: roundedDelta(delta) };
}

function stringDelta(key: string, actual: string | undefined, limit: string | undefined): RouteCandidateGateDelta {
  return { key, actual: actual ?? null, limit: limit ?? null, deltaToPass: null };
}

function candidateThresholds(context: RouteGateSelectionContext): Record<string, number | string | null> {
  const { targetDistanceKm, targetElevationM, profile, routeIntent } = context;
  return {
    distanceToleranceRatio: distanceTolerance(profile),
    distancePolicy: routeIntent?.distancePolicy?.mode ?? null,
    elevationToleranceM: elevationToleranceM(targetElevationM, profile, targetDistanceKm),
    minProductionScore: minProductionScore(profile),
    maxPavedRatio: routeIntent?.maxPavedRatio ?? null,
    maxBusyRoadRatio: routeIntent?.maxBusyRoadRatio ?? 0.08,
    maxRepeatEdgeRatio: maxRepeatEdgeRatio(profile, routeIntent),
    maxUTurnRatio: maxUTurnRatio(profile),
    maxGeometryOverlapRatio: maxGeometryOverlapRatio(profile, routeIntent),
    maxSelfIntersectionCount: 0,
    maxGeometryOutAndBackSimilarityRatio: routeIntent?.type === "park_loop" ? 0.22 : 0.32,
    minGeometryLoopCompactness: minLoopCompactness(routeIntent),
    minTrailBeautyScore: profile.sessionType === "trail"
      ? targetDistanceKm >= 14 ? 0.65 : targetDistanceKm >= 10 ? 0.6 : 0.55
      : null,
    minNaturalCorridorRatio: profile.sessionType === "trail"
      ? targetDistanceKm >= 14 ? 0.55 : targetDistanceKm >= 10 ? 0.45 : 0.4
      : null,
    minLongestTrailSegmentKm: profile.sessionType === "trail"
      ? targetDistanceKm >= 14 ? 4 : targetDistanceKm >= 10 ? 2.5 : 1.6
      : null,
    minTrailPotential: profile.sessionType === "trail"
      ? targetDistanceKm >= 14 ? "high" : "medium"
      : null,
    minRouteTrailQuality: minimumRouteTrailQualityRank(context) != null
      ? routeTrailQualityLabel(minimumRouteTrailQualityRank(context) as number)
      : null,
    maxCriticalStabilityRisk: STABILITY_RISK_EPSILON,
    healthyGateMarginRatio: HEALTHY_GATE_MARGIN_RATIO,
  };
}

function candidateDeltas(candidate: RouteCandidate, context: RouteGateSelectionContext): RouteCandidateGateDelta[] {
  const { targetDistanceKm, targetElevationM } = context;
  const quality = candidate.quality;
  const geometry = quality?.geometry;
  const thresholds = candidateThresholds(context);
  const distanceErrorRatio = Math.abs(candidate.distanceKm - targetDistanceKm) / Math.max(targetDistanceKm, 0.1);
  const elevationErrorM = Math.abs(candidate.ascendM - targetElevationM);

  return [
    numericDelta("distance_tolerance", distanceErrorRatio, thresholds.distanceToleranceRatio as number, "max"),
    stringDelta("distance_policy", distanceAcceptanceForCandidate(candidate, context), context.routeIntent?.distancePolicy?.mode),
    numericDelta("elevation_tolerance", elevationErrorM, thresholds.elevationToleranceM as number, "max"),
    numericDelta("production_score", quality?.productionScore, thresholds.minProductionScore as number, "min"),
    numericDelta("paved_ratio", quality?.pavedRatio, thresholds.maxPavedRatio as number | undefined, "max"),
    numericDelta("busy_road_ratio", quality?.busyRoadRatio, thresholds.maxBusyRoadRatio as number, "max"),
    numericDelta("repeat_edge_ratio", quality?.repeatEdgeRatio, thresholds.maxRepeatEdgeRatio as number, "max"),
    numericDelta("u_turn_ratio", quality?.uTurnRatio, thresholds.maxUTurnRatio as number, "max"),
    numericDelta("geometry_overlap", geometry?.geometryOverlapRatio, thresholds.maxGeometryOverlapRatio as number, "max"),
    numericDelta("geometry_self_intersection", geometry?.selfIntersectionCount, thresholds.maxSelfIntersectionCount as number, "max"),
    numericDelta("geometry_out_and_back_similarity", geometry?.outAndBackSimilarityRatio, thresholds.maxGeometryOutAndBackSimilarityRatio as number, "max"),
    numericDelta("geometry_loop_compactness", geometry?.loopCompactness, thresholds.minGeometryLoopCompactness as number | undefined, "min"),
    numericDelta("trail_beauty_score", quality?.trailBeautyScore, thresholds.minTrailBeautyScore as number | undefined, "min"),
    numericDelta("natural_corridor_ratio", quality?.naturalCorridorRatio, thresholds.minNaturalCorridorRatio as number | undefined, "min"),
    numericDelta("longest_trail_segment", quality?.longestTrailSegmentKm, thresholds.minLongestTrailSegmentKm as number | undefined, "min"),
    stringDelta("trail_potential", quality?.trailPotential, thresholds.minTrailPotential as string | undefined),
    stringDelta("route_trail_quality", quality?.routeTrailQuality, thresholds.minRouteTrailQuality as string | undefined),
    numericDelta("critical_stability_risk", evaluateRouteHardGates(candidate, context).criticalStabilityRisk, STABILITY_RISK_EPSILON, "max"),
  ];
}

function summarizeRejectedCandidate(
  candidate: RouteCandidate,
  candidateIndex: number,
  context: RouteGateSelectionContext
): RejectedRouteCandidateDebugSummary {
  const gate = evaluateRouteHardGates(candidate, context);
  const quality = candidate.quality;
  return {
    candidateIndex,
    distanceKm: candidate.distanceKm ?? null,
    ascendM: candidate.ascendM ?? null,
    productionScore: quality?.productionScore ?? null,
    pavedRatio: quality?.pavedRatio ?? null,
    trailRatio: quality?.trailRatio ?? null,
    naturalWayRatio: quality?.naturalWayRatio ?? null,
    trailBeautyScore: quality?.trailBeautyScore ?? null,
    longestTrailSegmentKm: quality?.longestTrailSegmentKm ?? null,
    repeatEdgeRatio: quality?.repeatEdgeRatio ?? null,
    uTurnRatio: quality?.uTurnRatio ?? null,
    warnings: Array.isArray(quality?.warnings) ? quality.warnings : [],
    gate,
    criticalStabilityRisk: gate.criticalStabilityRisk,
    thresholds: candidateThresholds(context),
    deltas: candidateDeltas(candidate, context),
  };
}

export function buildRejectedCandidatesDiagnostics(
  candidates: RouteCandidate[],
  context: RouteGateSelectionContext,
  subCode?: string,
  topN = 5
): RejectedRouteCandidatesDiagnostics {
  const rejectionReasonsHistogram: Record<string, number> = {};
  const routeTrailQualityHistogram: Record<"low" | "medium" | "high" | "unknown", number> = {
    low: 0,
    medium: 0,
    high: 0,
    unknown: 0,
  };
  const summaries = candidates.map((candidate, candidateIndex) => summarizeRejectedCandidate(candidate, candidateIndex, context));

  for (let candidateIndex = 0; candidateIndex < summaries.length; candidateIndex += 1) {
    const summary = summaries[candidateIndex];
    const routeTrailQuality = candidates[candidateIndex].quality?.routeTrailQuality;
    routeTrailQualityHistogram[routeTrailQuality ?? "unknown"] += 1;
    for (const violation of summary.gate.violations) {
      rejectionReasonsHistogram[violation.key] = (rejectionReasonsHistogram[violation.key] ?? 0) + 1;
    }
    if (summary.gate.bucket === 0 && summary.criticalStabilityRisk > STABILITY_RISK_EPSILON) {
      rejectionReasonsHistogram.critical_stability_risk = (rejectionReasonsHistogram.critical_stability_risk ?? 0) + 1;
    }
  }

  return {
    subCode,
    candidateCount: candidates.length,
    selectedCandidateIndex: candidates.length > 0 ? 0 : null,
    topCandidateIndex: candidates.length > 0 ? 0 : null,
    rejectionReasonsHistogram,
    routeTrailQualityHistogram,
    topCandidates: summaries.slice(0, topN),
  };
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
