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

export interface RouteQualityMetrics {
  distanceErrorPct: number;
  elevationErrorPct: number;
  loopGapKm: number;
  busyRoadRatio: number;
  trailRatio: number;
  pavedRatio?: number;
  forestOrParkRatio?: number;
  longestTrailSegmentKm?: number;
  trailBeautyScore?: number;
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

  return ratio(repeatedKm, totalKm);
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

function isTrailLikeEdge(edge: EnrichedEdge, scenicWayIds: Set<string>): boolean {
  return TRAIL_HIGHWAY_TYPES.has(edge.highway) || scenicWayIds.has(String(edge.osmWayId));
}

function isPavedLikeEdge(edge: EnrichedEdge): boolean {
  if (edge.surface != null) return PAVED_SURFACES.has(edge.surface);
  return BUSY_HIGHWAY_TYPES.has(edge.highway) || QUIET_HIGHWAY_TYPES.has(edge.highway);
}

function computeLongestTrailSegmentKm(edges: EnrichedEdge[], scenicWayIds: Set<string>): number {
  let longestKm = 0;
  let currentKm = 0;

  for (const edge of edges) {
    if (isTrailLikeEdge(edge, scenicWayIds)) {
      currentKm += edge.lengthKm;
      longestKm = Math.max(longestKm, currentKm);
    } else {
      currentKm = 0;
    }
  }

  return longestKm;
}

function computeTrailBeautyScore(args: {
  trailRatio: number;
  pavedRatio: number;
  busyRoadRatio: number;
  forestOrParkRatio: number;
  longestTrailSegmentKm: number;
  totalKm: number;
}): number {
  const continuityRatio = ratio(args.longestTrailSegmentKm, Math.max(args.totalKm, 0.1));
  const lowPavementScore = clamp01(1 - args.pavedRatio / 0.5);
  const calmScore = clamp01(1 - args.busyRoadRatio * 8);

  return clamp01(
    args.trailRatio * 0.35 +
      args.forestOrParkRatio * 0.25 +
      continuityRatio * 0.2 +
      lowPavementScore * 0.1 +
      calmScore * 0.1
  );
}

export function assessRouteQuality(args: {
  candidate: Omit<RouteCandidate, "totalScore"> & { totalScore?: number };
  path: SolverPath;
  graph: EnrichedGraph;
  profile: SessionProfile;
  targetDistanceKm: number;
  targetElevationM: number;
  scenicWayIds?: Set<string>;
}): RouteQualityMetrics {
  const { candidate, path, graph, profile, targetDistanceKm, targetElevationM, scenicWayIds = new Set() } = args;
  const edges = path.edgeIds
    .map((edgeId) => graph.edges.get(edgeId))
    .filter((edge): edge is EnrichedEdge => edge != null);

  const totalKm = edgeLengthSum(edges) || candidate.distanceKm || 1;
  const busyKm = edgeLengthSum(edges.filter((edge) => BUSY_HIGHWAY_TYPES.has(edge.highway)));
  const pavedKm = edgeLengthSum(edges.filter((edge) => isPavedLikeEdge(edge)));
  const forestOrParkKm = edgeLengthSum(
    edges.filter((edge) => scenicWayIds.has(String(edge.osmWayId)))
  );
  const naturalKm = edgeLengthSum(
    edges.filter((edge) => isTrailLikeEdge(edge, scenicWayIds))
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
  const pavedRatio = ratio(pavedKm, totalKm);
  const forestOrParkRatio = ratio(forestOrParkKm, totalKm);
  const longestTrailSegmentKm = computeLongestTrailSegmentKm(edges, scenicWayIds);
  const trailBeautyScore = computeTrailBeautyScore({
    trailRatio,
    pavedRatio,
    busyRoadRatio,
    forestOrParkRatio,
    longestTrailSegmentKm,
    totalKm,
  });
  const restrictedAccessRatio = ratio(restrictedKm, totalKm);
  const onewayViolationRatio = ratio(onewayViolationKm, totalKm);
  const repeatEdgeRatio = computeRepeatRatio(edges, totalKm);
  const intersectionDensityPerKm = computeIntersectionDensity(path, graph);

  const distanceScore = clamp01(1 - distanceErrorPct / 0.2);
  const elevationScore = clamp01(1 - elevationErrorPct / 0.45);
  const loopScore = clamp01(candidate.loopScore);
  const calmScore = clamp01(1 - busyRoadRatio * 4);
  const safetyScore = clamp01(1 - restrictedAccessRatio * 10 - onewayViolationRatio * 10);
  const noveltyScore = clamp01(1 - repeatEdgeRatio * 4);
  const intersectionScore = clamp01(1 - Math.max(0, intersectionDensityPerKm - 8) / 12);

  const natureScore = profile.sport === "cycling_road"
    ? clamp01(0.65 + trailRatio * 0.35)
    : clamp01(0.45 + trailRatio * 0.55);
  const routeEnvironmentScore = isTrailRunning(profile)
    ? clamp01(natureScore * 0.45 + trailBeautyScore * 0.55)
    : natureScore;

  const productionScore =
    distanceScore * 0.22 +
    elevationScore * 0.16 +
    loopScore * 0.18 +
    calmScore * 0.14 +
    safetyScore * 0.14 +
    noveltyScore * 0.08 +
    intersectionScore * 0.04 +
    routeEnvironmentScore * 0.04;

  const warnings: string[] = [];
  if (distanceErrorPct > 0.2) warnings.push("DISTANCE_OFF_TARGET");
  if (targetElevationM > 0 && elevationErrorPct > 0.5) warnings.push("ELEVATION_OFF_TARGET");
  if (loopGapKm > 0.5) warnings.push("LOOP_NOT_CLOSED");
  if (busyRoadRatio > 0.08) warnings.push("TOO_MUCH_BUSY_ROAD");
  if (restrictedAccessRatio > 0) warnings.push("RESTRICTED_ACCESS");
  if (onewayViolationRatio > 0) warnings.push("ONEWAY_VIOLATION");
  if (repeatEdgeRatio > 0.08) warnings.push("TOO_MUCH_BACKTRACKING");
  if (intersectionDensityPerKm > 14) warnings.push("TOO_MANY_INTERSECTIONS");
  if (isTrailRunning(profile) && trailRatio < 0.35) warnings.push("NOT_ENOUGH_TRAIL");
  if (isTrailRunning(profile) && pavedRatio > 0.45) warnings.push("TOO_MUCH_PAVEMENT");
  if (isTrailRunning(profile) && longestTrailSegmentKm < Math.min(3, totalKm * 0.35)) {
    warnings.push("TRAIL_TOO_FRAGMENTED");
  }

  return {
    distanceErrorPct,
    elevationErrorPct,
    loopGapKm,
    busyRoadRatio,
    trailRatio,
    pavedRatio,
    forestOrParkRatio,
    longestTrailSegmentKm,
    trailBeautyScore,
    restrictedAccessRatio,
    onewayViolationRatio,
    repeatEdgeRatio,
    intersectionDensityPerKm,
    productionScore,
    warnings,
  };
}
