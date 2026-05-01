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
import type { RouteIntent } from "./terrain-planner";

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
  relaxationsUsed?: string[];
  trailBeautyScore?: number;
  terrainDataConfidence?: "low" | "medium" | "high";
  trailPotential?: "low" | "medium" | "high";
  terrainUnknownSurfaceRatio?: number;
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

function hasRestrictedAccess(edge: EnrichedEdge, profile: SessionProfile): boolean {
  if (edge.access === "private" || edge.access === "no") return true;
  if (profile.sport === "running" && (edge.foot === "no" || edge.access === "customers")) return true;
  if (profile.sport !== "running" && (edge.bicycle === "no" || edge.access === "customers")) return true;
  return false;
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

function computeRouteIntentMatch(args: {
  intent?: RouteIntent;
  naturalZoneDwellKm: number;
  longestNonPavedTrailStreakKm: number;
  pavedRatio: number;
  busyRoadRatio: number;
  repeatEdgeRatio: number;
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
  const restrictedKm = edgeLengthSum(edges.filter((edge) => hasRestrictedAccess(edge, profile)));
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
  const terrainAudit = auditTerrainData(edges);
  const routeIntentMatch = computeRouteIntentMatch({
    intent: routeIntent,
    naturalZoneDwellKm,
    longestNonPavedTrailStreakKm,
    pavedRatio,
    busyRoadRatio,
    repeatEdgeRatio,
  });

  const distanceScore = clamp01(1 - distanceErrorPct / 0.2);
  const elevationScore = clamp01(1 - elevationErrorPct / 0.45);
  const loopScore = clamp01(candidate.loopScore);
  const calmScore = clamp01(1 - busyRoadRatio * 4);
  const safetyScore = clamp01(1 - restrictedAccessRatio * 10 - onewayViolationRatio * 10);
  const noveltyScore = clamp01(1 - repeatEdgeRatio * 4);
  const pathShapeScore = clamp01(1 - uTurnRatio * 8);
  const intersectionScore = clamp01(1 - Math.max(0, intersectionDensityPerKm - 8) / 12);

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
  const trailPavementPenalty = isTrailRunning(profile)
    ? Math.max(0, pavedRatio - 0.45) * 0.45 + Math.max(0, scenicPavedRatio - 0.2) * 0.2
    : 0;

  const baseProductionScore =
    distanceScore * 0.22 +
    elevationScore * 0.16 +
    loopScore * 0.18 +
    calmScore * 0.14 +
    safetyScore * 0.14 +
    noveltyScore * 0.05 +
    pathShapeScore * 0.03 +
    intersectionScore * 0.04 +
    routeEnvironmentScore * 0.04;
  const productionScore = clamp01(baseProductionScore - roadHeavyTrailPenalty - trailPavementPenalty);

  const warnings: string[] = [];
  if (distanceErrorPct > 0.2) warnings.push("DISTANCE_OFF_TARGET");
  if (targetElevationM > 0 && elevationErrorPct > 0.5) warnings.push("ELEVATION_OFF_TARGET");
  if (loopGapKm > 0.5) warnings.push("LOOP_NOT_CLOSED");
  if (busyRoadRatio > 0.08) warnings.push("TOO_MUCH_BUSY_ROAD");
  if (restrictedAccessRatio > 0) warnings.push("RESTRICTED_ACCESS");
  if (onewayViolationRatio > 0) warnings.push("ONEWAY_VIOLATION");
  if (uTurnRatio > 0.03) warnings.push("U_TURN_DETECTED");
  if (repeatEdgeRatio > 0.08) warnings.push("TOO_MUCH_BACKTRACKING");
  if (intersectionDensityPerKm > 14) warnings.push("TOO_MANY_INTERSECTIONS");
  if (isTrailRunning(profile) && trailRatio < 0.35) warnings.push("NOT_ENOUGH_TRAIL");
  if (isTrailRunning(profile) && pavedRatio > 0.45) warnings.push("TOO_MUCH_PAVEMENT");
  if (isTrailRunning(profile) && naturalWayRatio >= 0.5 && pavedRatio > 0.45) warnings.push("NATURAL_BUT_PAVED");
  if (roadHeavyTrailPenalty > 0) warnings.push("Boucle trop routière pour une sortie trail.");
  if (
    isTrailRunning(profile) &&
    terrainAudit.confidence === 'medium' &&
    terrainAudit.metrics.unknownSurfaceRatio >= 0.45
  ) {
    warnings.push("Données terrain moyennes : beaucoup de chemins sans surface renseignée dans OSM.");
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
    relaxationsUsed: routeIntentMatch.relaxationsUsed,
    trailBeautyScore,
    terrainDataConfidence: terrainAudit.confidence,
    trailPotential: terrainAudit.trailPotential,
    terrainUnknownSurfaceRatio: terrainAudit.metrics.unknownSurfaceRatio,
    uTurnRatio,
    restrictedAccessRatio,
    onewayViolationRatio,
    repeatEdgeRatio,
    intersectionDensityPerKm,
    productionScore,
    warnings,
  };
}
