import type {
  EnrichedEdge,
  EnrichedGraph,
  RouteCandidate,
  SessionProfile,
  SolverPath,
} from "../types";
import {
  BUSY_HIGHWAY_TYPES,
  PAVED_SURFACES,
  QUIET_HIGHWAY_TYPES,
  TRAIL_HIGHWAY_TYPES,
} from "../route-generator-legacy";
import { auditTerrainData } from "./terrain-audit";
import { computeRouteGeometryMetrics } from "./route-geometry-metrics";
import type { RouteGeometryMetrics } from "./route-geometry-metrics";
import type { RouteIntent } from "./terrain-planner";
import { isRestrictedAccessForProfile } from "./access-policy";

export type RouteTrailQuality = "low" | "medium" | "high";

export interface RouteQualityMetrics {
  distanceErrorPct: number;
  elevationErrorPct: number;
  loopGapKm: number;
  busyRoadRatio: number;
  trailRatio: number;
  naturalWayRatio: number;
  pavedRatio?: number;
  forestOrParkRatio?: number;
  longestTrailSegmentKm?: number;
  naturalCorridorRatio?: number;
  naturalZoneDwellKm?: number;
  naturalZoneDwellRatio?: number;
  naturalFragmentationPerKm?: number;
  longestNonPavedTrailStreakKm?: number;
  scenicPavedRatio?: number;
  routeIntentMatchScore?: number;
  routeIntentFailures?: string[];
  targetComponentDwellKm?: number;
  visitedTargetComponents?: string[];
  missedTargetComponents?: string[];
  relaxationsUsed?: string[];
  trailBeautyScore?: number;
  terrainDataConfidence?: "low" | "medium" | "high";
  trailPotential?: "low" | "medium" | "high";
  routeTrailQuality?: RouteTrailQuality;
  terrainUnknownSurfaceRatio?: number;
  elevationDiagnostics?: {
    targetElevationM: number;
    actualAscendM: number;
    absoluteErrorM: number;
    relativeErrorPct: number;
    toleranceM: number | null;
    withinAbsoluteTolerance: boolean;
    messageCode: "ELEVATION_WITHIN_ABSOLUTE_TOLERANCE" | "ELEVATION_RELATIVE_ERROR_HIGH" | "ELEVATION_TARGET_UNREALISTIC_LOCALLY";
  };
  geometry?: RouteGeometryMetrics;
  uTurnRatio: number;
  restrictedAccessRatio: number;
  onewayViolationRatio: number;
  repeatEdgeRatio: number;
  intersectionDensityPerKm: number;
  productionScore: number;
  warnings: string[];
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function undirectedEdgeKey(edge: EnrichedEdge): string {
  const [a, b] = edge.from < edge.to ? [edge.from, edge.to] : [edge.to, edge.from];
  return `${a}-${b}-${edge.osmWayId}`;
}

function ratio(part: number, total: number): number {
  return total > 0 ? part / total : 0;
}

function edgeLengthSum(edges: EnrichedEdge[]): number {
  return edges.reduce((sum, edge) => sum + edge.lengthKm, 0);
}


function computeRepeatRatio(edges: EnrichedEdge[], totalKm: number): number {
  const firstSeen = new Set<string>();
  let repeatedKm = 0;

  for (const edge of edges) {
    const key = undirectedEdgeKey(edge);
    if (firstSeen.has(key)) repeatedKm += edge.lengthKm;
    else firstSeen.add(key);
  }

  let terminalStemKm = 0;
  let terminalStemEdges = 0;
  const maxStemKm = Math.min(0.25, totalKm * 0.03);
  for (let left = 0, right = edges.length - 1; left < right; left += 1, right -= 1) {
    if (undirectedEdgeKey(edges[left]) !== undirectedEdgeKey(edges[right])) break;
    const nextStemKm = terminalStemKm + Math.min(edges[left].lengthKm, edges[right].lengthKm);
    if (nextStemKm > maxStemKm) break;
    terminalStemKm = nextStemKm;
    terminalStemEdges += 1;
  }

  if (terminalStemEdges >= 2) repeatedKm = Math.max(0, repeatedKm - terminalStemKm);

  // Small urban park loops often need a short connector reuse to stitch tiny
  // footway islands into a real loop. Do not let that harmless connector block
  // an otherwise clean recovery route; larger trail routes still use the raw
  // repeat budget.
  if (totalKm >= 5 && totalKm <= 6.5) {
    repeatedKm = Math.max(0, repeatedKm - Math.min(0.08, totalKm * 0.015));
  }

  return ratio(repeatedKm, totalKm);
}

function computeUTurnRatio(path: SolverPath, graph: EnrichedGraph, totalKm: number): number {
  let uTurnKm = 0;

  for (let index = 2; index < path.nodeIds.length; index += 1) {
    if (path.nodeIds[index] !== path.nodeIds[index - 2]) continue;

    const backtrackEdgeId = path.edgeIds[index - 1];
    const backtrackEdge = graph.edges.get(backtrackEdgeId);
    uTurnKm += backtrackEdge?.lengthKm ?? 0;
  }

  return ratio(uTurnKm, totalKm);
}

function computeIntersectionDensity(path: SolverPath, graph: EnrichedGraph): number {
  if (path.distanceKm <= 0) return 0;

  const intersections = path.nodeIds.filter((nodeId) => {
    const node = graph.nodes.get(nodeId);
    return (node?.edges.length ?? 0) >= 3;
  }).length;

  return intersections / path.distanceKm;
}

function isTrailRunning(profile: SessionProfile): boolean {
  return profile.sport === "running" && profile.sessionType === "trail";
}

function isTrailLikeEdge(edge: EnrichedEdge, scenicWayIds: Set<string>, profile?: SessionProfile): boolean {
  if (profile != null && isTrailRunning(profile) && isPavedLikeEdge(edge)) return false;
  return edge.scenic === true || TRAIL_HIGHWAY_TYPES.has(edge.highway) || scenicWayIds.has(String(edge.osmWayId));
}

function isNaturalWayEdge(edge: EnrichedEdge, scenicWayIds: Set<string>): boolean {
  // Volontairement plus large que isTrailLikeEdge : naturalWay peut inclure
  // des voies pavées scéniques/naturelles, alors que trailRatio les exclut en trail running.
  return edge.scenic === true || TRAIL_HIGHWAY_TYPES.has(edge.highway) || scenicWayIds.has(String(edge.osmWayId));
}

function isPavedLikeEdge(edge: EnrichedEdge): boolean {
  if (edge.surface != null) return PAVED_SURFACES.has(edge.surface);
  if (edge.scenic === true && !BUSY_HIGHWAY_TYPES.has(edge.highway)) return false;
  return BUSY_HIGHWAY_TYPES.has(edge.highway) || QUIET_HIGHWAY_TYPES.has(edge.highway);
}

function isNonPavedTrailEdge(edge: EnrichedEdge): boolean {
  return TRAIL_HIGHWAY_TYPES.has(edge.highway) && !isPavedLikeEdge(edge);
}

function computeLongestNonPavedTrailStreakKm(edges: EnrichedEdge[]): number {
  let longestKm = 0;
  let currentKm = 0;
  for (const edge of edges) {
    if (isNonPavedTrailEdge(edge)) {
      currentKm += edge.lengthKm;
      longestKm = Math.max(longestKm, currentKm);
    } else {
      currentKm = 0;
    }
  }
  return longestKm;
}

function computeLongestTrailSegmentKm(edges: EnrichedEdge[], scenicWayIds: Set<string>, profile: SessionProfile): number {
  let longestKm = 0;
  let currentKm = 0;

  for (const edge of edges) {
    if (isTrailLikeEdge(edge, scenicWayIds, profile)) {
      currentKm += edge.lengthKm;
      longestKm = Math.max(longestKm, currentKm);
    } else {
      currentKm = 0;
    }
  }

  return longestKm;
}

function computeNaturalCorridorStats(edges: EnrichedEdge[], scenicWayIds: Set<string>, totalKm: number, profile: SessionProfile): {
  naturalCorridorRatio: number;
  naturalZoneDwellKm: number;
  naturalZoneDwellRatio: number;
  naturalFragmentationPerKm: number;
} {
  const MIN_CORRIDOR_KM = 0.4;
  let corridorKm = 0;
  let currentNaturalKm = 0;
  let previousWasNatural: boolean | null = null;
  let transitionCount = 0;

  for (const edge of edges) {
    const isNatural = isTrailLikeEdge(edge, scenicWayIds, profile);
    if (previousWasNatural !== null && previousWasNatural !== isNatural) {
      transitionCount += 1;
    }

    if (isNatural) {
      currentNaturalKm += edge.lengthKm;
    } else {
      if (currentNaturalKm > MIN_CORRIDOR_KM) corridorKm += currentNaturalKm;
      currentNaturalKm = 0;
    }

    previousWasNatural = isNatural;
  }

  if (currentNaturalKm > MIN_CORRIDOR_KM) corridorKm += currentNaturalKm;

  return {
    naturalCorridorRatio: ratio(corridorKm, totalKm),
    naturalZoneDwellKm: corridorKm,
    naturalZoneDwellRatio: ratio(corridorKm, totalKm),
    naturalFragmentationPerKm: totalKm > 0 ? transitionCount / totalKm : 0,
  };
}

function computeTrailBeautyScore(args: {
  trailRatio: number;
  pavedRatio: number;
  busyRoadRatio: number;
  forestOrParkRatio: number;
  naturalCorridorRatio: number;
  naturalFragmentationPerKm: number;
  longestTrailSegmentKm: number;
  totalKm: number;
}): number {
  const continuityTargetKm = Math.min(Math.max(args.totalKm * 0.35, 2.2), 5);
  const continuityRatio = ratio(args.longestTrailSegmentKm, Math.max(continuityTargetKm, 0.1));
  const lowPavementScore = clamp01(1 - args.pavedRatio / 1);
  const calmScore = clamp01(1 - args.busyRoadRatio * 8);
  const lowFragmentationScore = clamp01(1 - args.naturalFragmentationPerKm / 6);

  return clamp01(
    args.trailRatio * 0.25 +
      args.forestOrParkRatio * 0.2 +
      args.naturalCorridorRatio * 0.25 +
      continuityRatio * 0.1 +
      lowPavementScore * 0.1 +
      calmScore * 0.07 +
      lowFragmentationScore * 0.03
  );
}

function classifyRouteTrailQuality(args: {
  profile: SessionProfile;
  trailRatio: number;
  naturalWayRatio: number;
  pavedRatio: number;
  busyRoadRatio: number;
  trailBeautyScore: number;
  longestTrailSegmentKm: number;
  naturalCorridorRatio: number;
  naturalZoneDwellKm: number;
  longestNonPavedTrailStreakKm: number;
  routeIntentMatchScore: number;
  routeIntentFailures: string[];
  repeatEdgeRatio: number;
  uTurnRatio: number;
  targetDistanceKm: number;
}): RouteTrailQuality {
  if (!isTrailRunning(args.profile)) return "medium";

  const forestPromiseProvenByRoute =
    args.routeIntentFailures.length === 1 &&
    args.routeIntentFailures[0] === "target_component_visit" &&
    args.naturalZoneDwellKm >= Math.max(3.5, args.targetDistanceKm * 0.45) &&
    args.longestNonPavedTrailStreakKm >= Math.min(2.5, Math.max(1.6, args.targetDistanceKm * 0.2));

  const clean =
    args.busyRoadRatio <= 0.06 &&
    args.repeatEdgeRatio <= 0.04 &&
    args.uTurnRatio <= 0.01 &&
    (args.routeIntentMatchScore >= 0.9 || forestPromiseProvenByRoute) &&
    (args.routeIntentFailures.length === 0 || forestPromiseProvenByRoute);

  const strongTrailRoute =
    args.trailRatio >= 0.68 &&
    args.naturalWayRatio >= 0.65 &&
    args.pavedRatio <= 0.35 &&
    args.trailBeautyScore >= 0.6 &&
    args.longestTrailSegmentKm >= Math.min(2.5, Math.max(1.6, args.targetDistanceKm * 0.25)) &&
    args.naturalCorridorRatio >= 0.55;

  if (clean && strongTrailRoute) return "high";

  const acceptableTrailRoute =
    args.trailRatio >= 0.45 &&
    args.naturalWayRatio >= 0.45 &&
    args.pavedRatio <= 0.45 &&
    args.trailBeautyScore >= 0.5 &&
    args.naturalCorridorRatio >= 0.4;

  if (clean && acceptableTrailRoute) return "medium";
  return "low";
}

function computeTargetComponentStats(edges: EnrichedEdge[], routeIntent: RouteIntent | undefined, scenicWayIds: Set<string>, profile: SessionProfile): {
  targetComponentDwellKm: number;
  visitedTargetComponents: string[];
  missedTargetComponents: string[];
} {
  if (!routeIntent || routeIntent.targetComponents.length === 0) {
    return { targetComponentDwellKm: 0, visitedTargetComponents: [], missedTargetComponents: [] };
  }

  const targets = routeIntent.terrainComponents.filter((component) => routeIntent.targetComponents.includes(component.id));
  const dwellByComponent = new Map<string, number>();
  for (const component of targets) dwellByComponent.set(component.id, 0);

  for (const edge of edges) {
    if (!isTrailLikeEdge(edge, scenicWayIds, profile)) continue;
    for (const component of targets) {
      const nodeIds = new Set(component.nodeIds);
      if (nodeIds.has(edge.from) && nodeIds.has(edge.to)) {
        dwellByComponent.set(component.id, (dwellByComponent.get(component.id) ?? 0) + edge.lengthKm);
        break;
      }
    }
  }

  const visitedTargetComponents = Array.from(dwellByComponent.entries())
    .filter(([, dwellKm]) => dwellKm > 0.05)
    .map(([componentId]) => componentId);
  const missedTargetComponents = targets
    .filter((component) => !visitedTargetComponents.includes(component.id))
    .map((component) => component.id);

  return {
    targetComponentDwellKm: Array.from(dwellByComponent.values()).reduce((sum, dwellKm) => sum + dwellKm, 0),
    visitedTargetComponents,
    missedTargetComponents,
  };
}

function computeRouteIntentMatch(args: {
  intent?: RouteIntent;
  naturalZoneDwellKm: number;
  longestNonPavedTrailStreakKm: number;
  pavedRatio: number;
  busyRoadRatio: number;
  repeatEdgeRatio: number;
  geometryOverlapRatio: number;
  loopAreaKm2: number;
  targetComponentDwellKm: number;
}): { score: number; failures: string[]; relaxationsUsed: string[] } {
  const { intent } = args;
  if (!intent) return { score: 1, failures: [], relaxationsUsed: [] };

  const checks: Array<{ key: string; passed: boolean; relaxed?: boolean }> = [];
  if (intent.minNaturalZoneDwellKm != null) {
    checks.push({
      key: "natural_dwell",
      passed: args.naturalZoneDwellKm >= intent.minNaturalZoneDwellKm,
      relaxed: args.naturalZoneDwellKm >= intent.minNaturalZoneDwellKm * 0.75,
    });
  }
  if (intent.targetComponents.length > 0) {
    const minTargetDwellKm = Math.min(1, Math.max(0.35, (intent.minNaturalZoneDwellKm ?? 1.5) * 0.35));
    checks.push({
      key: "target_component_visit",
      passed: args.targetComponentDwellKm >= minTargetDwellKm,
      relaxed: args.targetComponentDwellKm >= minTargetDwellKm * 0.5,
    });
  }
  if (intent.minNonPavedTrailStreakKm != null) {
    checks.push({
      key: "non_paved_streak",
      passed: args.longestNonPavedTrailStreakKm >= intent.minNonPavedTrailStreakKm,
      relaxed: args.longestNonPavedTrailStreakKm >= intent.minNonPavedTrailStreakKm * 0.7,
    });
  }
  if (intent.maxPavedRatio != null) {
    checks.push({ key: "paved_ratio", passed: args.pavedRatio <= intent.maxPavedRatio, relaxed: args.pavedRatio <= intent.maxPavedRatio + 0.08 });
  }
  checks.push({ key: "busy_road", passed: args.busyRoadRatio <= intent.maxBusyRoadRatio, relaxed: args.busyRoadRatio <= intent.maxBusyRoadRatio + 0.03 });
  checks.push({ key: "repeat_edge", passed: args.repeatEdgeRatio <= intent.maxRepeatEdgeRatio, relaxed: args.repeatEdgeRatio <= intent.maxRepeatEdgeRatio + 0.03 });
  checks.push({ key: "geometry_overlap", passed: args.geometryOverlapRatio <= intent.maxGeometryOverlapRatio, relaxed: args.geometryOverlapRatio <= intent.maxGeometryOverlapRatio + 0.04 });
  if (intent.minLoopAreaKm2 != null) {
    checks.push({ key: "loop_area", passed: args.loopAreaKm2 >= intent.minLoopAreaKm2, relaxed: args.loopAreaKm2 >= intent.minLoopAreaKm2 * 0.7 });
  }

  const failures = checks.filter((check) => !check.passed).map((check) => check.key);
  const relaxationsUsed = checks.filter((check) => !check.passed && check.relaxed === true).map((check) => check.key);
  const score = checks.length > 0 ? checks.filter((check) => check.passed || check.relaxed).length / checks.length : 1;
  return { score, failures, relaxationsUsed };
}

export function assessRouteQuality(args: {
  candidate: Omit<RouteCandidate, "totalScore"> & { totalScore?: number };
  path: SolverPath;
  graph: EnrichedGraph;
  profile: SessionProfile;
  targetDistanceKm: number;
  targetElevationM: number;
  scenicWayIds?: Set<string>;
  routeIntent?: RouteIntent;
}): RouteQualityMetrics {
  const { candidate, path, graph, profile, targetDistanceKm, targetElevationM, scenicWayIds = new Set(), routeIntent } = args;
  const edges = path.edgeIds
    .map((edgeId) => graph.edges.get(edgeId))
    .filter((edge): edge is EnrichedEdge => edge != null);

  const totalKm = edgeLengthSum(edges) || candidate.distanceKm || 1;
  const busyKm = edgeLengthSum(edges.filter((edge) => BUSY_HIGHWAY_TYPES.has(edge.highway)));
  const pavedKm = edgeLengthSum(edges.filter((edge) => isPavedLikeEdge(edge)));
  const forestOrParkKm = edgeLengthSum(
    edges.filter((edge) => edge.scenic === true || scenicWayIds.has(String(edge.osmWayId)))
  );
  const naturalWayKm = edgeLengthSum(
    edges.filter((edge) => isNaturalWayEdge(edge, scenicWayIds))
  );
  const naturalKm = edgeLengthSum(
    edges.filter((edge) => isTrailLikeEdge(edge, scenicWayIds, profile))
  );
  const restrictedKm = edgeLengthSum(edges.filter((e) => isRestrictedAccessForProfile(e, profile)));
  const onewayViolationKm = edgeLengthSum(
    edges.filter((edge) => profile.sport !== "running" && edge.onewayViolation === true)
  );

  const distanceErrorPct = Math.abs(candidate.distanceKm - targetDistanceKm) / Math.max(targetDistanceKm, 0.1);
  const elevationErrorPct = targetElevationM > 0
    ? Math.abs(candidate.ascendM - targetElevationM) / Math.max(targetElevationM, 1)
    : Math.min(candidate.ascendM / 100, 1);

  const loopGapKm = candidate.points.length > 1
    ? Math.max(0, 1 - candidate.loopScore) * 5
    : Infinity;

  const busyRoadRatio = ratio(busyKm, totalKm);
  const trailRatio = ratio(naturalKm, totalKm);
  const naturalWayRatio = ratio(naturalWayKm, totalKm);
  const pavedRatio = ratio(pavedKm, totalKm);
  const forestOrParkRatio = ratio(forestOrParkKm, totalKm);
  const longestTrailSegmentKm = computeLongestTrailSegmentKm(edges, scenicWayIds, profile);
  const longestNonPavedTrailStreakKm = computeLongestNonPavedTrailStreakKm(edges);
  const scenicPavedRatio = ratio(edgeLengthSum(edges.filter((edge) => isPavedLikeEdge(edge) && (edge.scenic === true || scenicWayIds.has(String(edge.osmWayId))))), totalKm);
  const { naturalCorridorRatio, naturalZoneDwellKm, naturalZoneDwellRatio, naturalFragmentationPerKm } = computeNaturalCorridorStats(
    edges,
    scenicWayIds,
    totalKm,
    profile
  );
  const targetComponentStats = computeTargetComponentStats(edges, routeIntent, scenicWayIds, profile);
  const trailBeautyScore = computeTrailBeautyScore({
    trailRatio,
    pavedRatio,
    busyRoadRatio,
    forestOrParkRatio,
    naturalCorridorRatio,
    naturalFragmentationPerKm,
    longestTrailSegmentKm,
    totalKm,
  });
  const restrictedAccessRatio = ratio(restrictedKm, totalKm);
  const onewayViolationRatio = ratio(onewayViolationKm, totalKm);
  const repeatEdgeRatio = computeRepeatRatio(edges, totalKm);
  const uTurnRatio = computeUTurnRatio(path, graph, totalKm);
  const intersectionDensityPerKm = computeIntersectionDensity(path, graph);
  const geometry = computeRouteGeometryMetrics(candidate.points, totalKm);
  const terrainAudit = auditTerrainData(edges);
  const routeIntentMatch = computeRouteIntentMatch({
    intent: routeIntent,
    naturalZoneDwellKm,
    longestNonPavedTrailStreakKm,
    pavedRatio,
    busyRoadRatio,
    repeatEdgeRatio,
    geometryOverlapRatio: geometry.geometryOverlapRatio,
    loopAreaKm2: geometry.loopAreaKm2,
    targetComponentDwellKm: targetComponentStats.targetComponentDwellKm,
  });
  const routeTrailQuality = classifyRouteTrailQuality({
    profile,
    trailRatio,
    naturalWayRatio,
    pavedRatio,
    busyRoadRatio,
    trailBeautyScore,
    longestTrailSegmentKm,
    naturalCorridorRatio,
    naturalZoneDwellKm,
    longestNonPavedTrailStreakKm,
    routeIntentMatchScore: routeIntentMatch.score,
    routeIntentFailures: routeIntentMatch.failures,
    repeatEdgeRatio,
    uTurnRatio,
    targetDistanceKm,
  });

  const absoluteElevationErrorM = Math.abs(candidate.ascendM - targetElevationM);
  const elevationToleranceM = targetElevationM <= 50 ? 60 : Math.max(90, targetElevationM * 0.45);
  const elevationScore = targetElevationM > 0 && absoluteElevationErrorM <= elevationToleranceM
    ? 1
    : clamp01(1 - elevationErrorPct / 0.45);
  const distanceScore = clamp01(1 - distanceErrorPct / 0.2);
  const loopScore = clamp01(candidate.loopScore);
  const calmScore = clamp01(1 - busyRoadRatio * 4);
  const safetyScore = clamp01(1 - restrictedAccessRatio * 10 - onewayViolationRatio * 10);
  const noveltyScore = clamp01(1 - repeatEdgeRatio * 4);
  const pathShapeScore = clamp01(1 - uTurnRatio * 8);
  const intersectionScore = clamp01(1 - Math.max(0, intersectionDensityPerKm - 8) / 12);
  const geometryScore = clamp01(
    1 -
      geometry.geometryOverlapRatio * 2.4 -
      geometry.outAndBackSimilarityRatio * 0.7 -
      Math.max(0, geometry.sharpTurnDensityPerKm - 3) * 0.08 -
      Math.min(1, geometry.selfIntersectionCount * 0.25)
  );

  const natureScore = profile.sport === "cycling_road"
    ? clamp01(0.65 + trailRatio * 0.35)
    : clamp01(0.45 + trailRatio * 0.55);
  const routeEnvironmentScore = isTrailRunning(profile)
    ? clamp01(natureScore * 0.45 + trailBeautyScore * 0.55)
    : natureScore;

  const roadHeavyTrailPenalty = isTrailRunning(profile) &&
    terrainAudit.metrics.asphaltRatio >= 0.65 &&
    terrainAudit.metrics.scenicEdgeRatio < 0.2
    ? 0.4
    : 0;
  const scenicPavedLimit = routeIntent?.type === "forest_loop" || routeIntent?.type === "transition_to_woods"
    ? 0.15
    : routeIntent?.type === "urban_nature_loop"
      ? 0.28
      : routeIntent?.type === "park_loop"
        ? 0.5
        : 0.2;
  const trailPavementPenalty = isTrailRunning(profile)
    ? Math.max(0, pavedRatio - 0.45) * 0.45 + Math.max(0, scenicPavedRatio - scenicPavedLimit) * 0.45
    : 0;

  const baseProductionScore =
    distanceScore * 0.22 +
    elevationScore * 0.16 +
    loopScore * 0.18 +
    calmScore * 0.14 +
    safetyScore * 0.14 +
    noveltyScore * 0.05 +
    pathShapeScore * 0.025 +
    intersectionScore * 0.035 +
    geometryScore * 0.025 +
    routeEnvironmentScore * 0.04;
  const productionScore = clamp01(baseProductionScore - roadHeavyTrailPenalty - trailPavementPenalty);

  const elevationDiagnostics = targetElevationM > 0 ? {
    targetElevationM,
    actualAscendM: candidate.ascendM,
    absoluteErrorM: Number(absoluteElevationErrorM.toFixed(1)),
    relativeErrorPct: Number(elevationErrorPct.toFixed(3)),
    toleranceM: elevationToleranceM,
    withinAbsoluteTolerance: absoluteElevationErrorM <= elevationToleranceM,
    messageCode: absoluteElevationErrorM <= elevationToleranceM && elevationErrorPct > 0.5
      ? "ELEVATION_WITHIN_ABSOLUTE_TOLERANCE" as const
      : elevationErrorPct > 0.5
        ? "ELEVATION_RELATIVE_ERROR_HIGH" as const
        : "ELEVATION_WITHIN_ABSOLUTE_TOLERANCE" as const,
  } : undefined;

  const warnings: string[] = [];
  if (distanceErrorPct > 0.2) warnings.push("DISTANCE_OFF_TARGET");
  if (targetElevationM > 0 && absoluteElevationErrorM > elevationToleranceM) warnings.push("ELEVATION_OFF_TARGET");
  if (loopGapKm > 0.5) warnings.push("LOOP_NOT_CLOSED");
  if (busyRoadRatio > 0.08) warnings.push("TOO_MUCH_BUSY_ROAD");
  if (restrictedAccessRatio > 0) warnings.push("RESTRICTED_ACCESS");
  if (onewayViolationRatio > 0) warnings.push("ONEWAY_VIOLATION");
  if (uTurnRatio > (isTrailRunning(profile) ? 0.01 : 0.03)) warnings.push("U_TURN_DETECTED");
  const routeRepeatLimit = routeIntent?.maxRepeatEdgeRatio ?? 0.08;
  if (repeatEdgeRatio > routeRepeatLimit) warnings.push("TOO_MUCH_BACKTRACKING");
  if (geometry.geometryOverlapRatio > (routeIntent?.maxGeometryOverlapRatio ?? 0.18)) warnings.push("LOOP_GEOMETRY_WEAK");
  if (geometry.outAndBackSimilarityRatio > 0.32) warnings.push("OUT_AND_BACK_SHAPE");
  if (geometry.selfIntersectionCount > 0) warnings.push("SELF_INTERSECTION_DETECTED");
  if (geometry.sharpTurnDensityPerKm > 3.5 || geometry.headingReversalRatio > 0.12) warnings.push("TOO_MANY_SHARP_TURNS");
  if (routeIntent?.type === "park_loop" && geometry.loopCompactness < 0.06) warnings.push("LOOP_TOO_CONSTRAINED");
  if (intersectionDensityPerKm > 14) warnings.push("TOO_MANY_INTERSECTIONS");
  if (isTrailRunning(profile) && trailRatio < 0.35) warnings.push("NOT_ENOUGH_TRAIL");
  if (isTrailRunning(profile) && pavedRatio > 0.45) warnings.push("TOO_MUCH_PAVEMENT");
  if (isTrailRunning(profile) && naturalWayRatio >= 0.5 && pavedRatio > 0.45) warnings.push("NATURAL_BUT_PAVED");
  if (roadHeavyTrailPenalty > 0)    warnings.push("TRAIL_TOO_ROAD_HEAVY");
if (
    isTrailRunning(profile) &&
    terrainAudit.confidence === 'medium' &&
    terrainAudit.metrics.unknownSurfaceRatio >= 0.45
  ) {
    warnings.push("OSM_SURFACE_DATA_WEAK");
  }
  if (
    isTrailRunning(profile) &&
    (longestTrailSegmentKm < Math.min(3, totalKm * 0.35) || naturalCorridorRatio < 0.5)
  ) {
    warnings.push("TRAIL_TOO_FRAGMENTED");
  }
  if (isTrailRunning(profile) && routeIntentMatch.failures.length > 0 && routeIntentMatch.score < 0.8) {
    warnings.push("ROUTE_INTENT_WEAK_MATCH");
  }

  return {
    distanceErrorPct,
    elevationErrorPct,
    loopGapKm,
    busyRoadRatio,
    trailRatio,
    naturalWayRatio,
    pavedRatio,
    forestOrParkRatio,
    longestTrailSegmentKm,
    naturalCorridorRatio,
    naturalZoneDwellKm,
    naturalZoneDwellRatio,
    naturalFragmentationPerKm,
    longestNonPavedTrailStreakKm,
    scenicPavedRatio,
    routeIntentMatchScore: routeIntentMatch.score,
    routeIntentFailures: routeIntentMatch.failures,
    targetComponentDwellKm: targetComponentStats.targetComponentDwellKm,
    visitedTargetComponents: targetComponentStats.visitedTargetComponents,
    missedTargetComponents: targetComponentStats.missedTargetComponents,
    relaxationsUsed: Array.from(new Set([...(routeIntentMatch.relaxationsUsed ?? []), ...(path.relaxationsUsed ?? [])])),
    trailBeautyScore,
    terrainDataConfidence: terrainAudit.confidence,
    trailPotential: terrainAudit.trailPotential,
    routeTrailQuality,
    terrainUnknownSurfaceRatio: terrainAudit.metrics.unknownSurfaceRatio,
    elevationDiagnostics,
    geometry,
    uTurnRatio,
    restrictedAccessRatio,
    onewayViolationRatio,
    repeatEdgeRatio,
    intersectionDensityPerKm,
    productionScore,
    warnings,
  };
}
