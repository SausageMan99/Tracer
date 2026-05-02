import type {
  Coordinate,
  EnrichedEdge,
  EnrichedGraph,
  RouteCandidate,
  RouteEdgeDiagnostic,
  RoutePoint,
  SessionProfile,
  SolverPath,
} from "../types";
import {
  BUSY_HIGHWAY_TYPES,
  PAVED_SURFACES,
  QUIET_HIGHWAY_TYPES,
  TRAIL_HIGHWAY_TYPES,
  fetchElevations,
  computeAscent,
  scoreRoute,
  computeLoopScore,
} from "../route-generator-legacy";
import { assessRouteQuality } from "./route-quality";
import type { RouteIntent, TerrainComponent } from "./terrain-planner";

const MAX_ROUTE_POINTS = 200;

function subsampleCoords(coords: Coordinate[], max: number): Coordinate[] {
  if (coords.length <= max) return coords;
  const step = (coords.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => coords[Math.round(i * step)]);
}

function subsampleValues(values: number[], totalLength: number, max: number): number[] {
  if (totalLength <= max) return values;
  const step = (totalLength - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => values[Math.round(i * step)]);
}

function estimateDuration(
  distanceKm: number,
  ascendM: number,
  sport: string
): number {
  // Sport-specific pace in min/km (flat equivalent)
  let baseMinPerKm: number;
  if (sport === "running") {
    baseMinPerKm = 5.5;
  } else if (sport === "cycling_road") {
    baseMinPerKm = 2.0;
  } else if (sport === "cycling_gravel") {
    baseMinPerKm = 2.5;
  } else {
    baseMinPerKm = 3.5; // MTB
  }

  // Add time for climbing: ~10min per 100m D+ for running, ~6min for cycling
  const climbPenalty = sport === "running"
    ? (ascendM / 100) * 10
    : (ascendM / 100) * 6;

  return (distanceKm * baseMinPerKm + climbPenalty) * 60;
}

function rankPathsForPostProcess(
  paths: SolverPath[],
  targetDistanceKm: number,
  limit: number
): SolverPath[] {
  return [...paths]
    .sort((a, b) => {
      const distancePenaltyA = Math.abs(a.distanceKm - targetDistanceKm) / Math.max(targetDistanceKm, 0.1);
      const distancePenaltyB = Math.abs(b.distanceKm - targetDistanceKm) / Math.max(targetDistanceKm, 0.1);
      const scoreA = a.totalScore / Math.max(a.distanceKm, 0.1) - distancePenaltyA * 2;
      const scoreB = b.totalScore / Math.max(b.distanceKm, 0.1) - distancePenaltyB * 2;
      return scoreB - scoreA;
    })
    .slice(0, limit);
}


function resolveShortlistLimit(routeIntent: RouteIntent | undefined, profile: SessionProfile, graph: EnrichedGraph): number {
  const legacy = profile.sessionType === "trail" ? 40 : 24;
  if (!routeIntent) return legacy;

  const base = routeIntent.beamBudget.shortlistSize;
  const intentFloor = routeIntent.type === "forest_loop" || routeIntent.type === "transition_to_woods"
    ? 32
    : routeIntent.type === "urban_nature_loop"
      ? 24
      : 14;
  const denseCap = graph.edges.size > 1800 ? 28 : 44;
  return Math.min(denseCap, Math.max(base, intentFloor));
}

function candidateRankingScore(
  candidate: RouteCandidate,
  targetDistanceKm: number,
  targetElevationM: number,
  profile: SessionProfile
): number {
  const distancePenalty = Math.abs(candidate.distanceKm - targetDistanceKm) / Math.max(targetDistanceKm, 0.1);
  const elevationToleranceM = targetElevationM <= 50 ? 60 : Math.max(90, targetElevationM * 0.45);
  const elevationPenalty = Math.max(0, Math.abs(candidate.ascendM - targetElevationM) - elevationToleranceM) / elevationToleranceM;

  const quality = candidate.quality;
  const trailRatio = quality?.trailRatio ?? 0;
  const repeatEdgeRatio = quality?.repeatEdgeRatio ?? 0;
  const uTurnRatio = quality?.uTurnRatio ?? 0;
  const trailBeautyScore = quality?.trailBeautyScore ?? 0;
  const naturalCorridorRatio = quality?.naturalCorridorRatio ?? 0;
  const longestNonPavedTrailStreakKm = quality?.longestNonPavedTrailStreakKm ?? 0;
  const scenicPavedRatio = quality?.scenicPavedRatio ?? 0;
  const routeIntentFailures = quality?.routeIntentFailures ?? [];
  const routeIntentMatchScore = quality?.routeIntentMatchScore ?? 1;
  const geometryOverlapRatio = quality?.geometry?.geometryOverlapRatio ?? 0;
  const forestOrParkRatio = quality?.forestOrParkRatio ?? 0;
  const trailDeficitPenalty = targetDistanceKm >= 8 ? Math.max(0, 0.2 - trailRatio) * 0.8 : 0;

  if (profile.sessionType !== "trail") {
    return candidate.totalScore - distancePenalty * 0.5 - elevationPenalty * 0.35 - trailDeficitPenalty;
  }

  const backtrackingPenalty = repeatEdgeRatio * 8 + uTurnRatio * 5;
  const benchmarkFailurePenalty =
    (Math.abs(candidate.ascendM - targetElevationM) > (targetElevationM <= 50 ? 60 : 120) ? 5 : 0) +
    (distancePenalty > 0.1 ? 5 : 0) +
    (repeatEdgeRatio > 0.04 ? 3 : 0) +
    (trailBeautyScore < 0.58 ? 2 : 0) +
    (naturalCorridorRatio < 0.45 ? 2 : 0) +
    (quality?.warnings.includes("TRAIL_TOO_FRAGMENTED") ? 0.8 : 0) +
    (uTurnRatio > 0.01 ? 2 : 0) +
    ((quality?.pavedRatio ?? 0) > 0.35 && targetDistanceKm >= 12 ? 2 : 0);
  const warningPenalty = quality?.warnings.includes("TOO_MUCH_BACKTRACKING") ? 0.45 : 0;
  const pavementPenalty = Math.max(0, (quality?.pavedRatio ?? 0) - 0.42) * 0.9;
  const scenicPavedPenalty = Math.max(0, scenicPavedRatio - 0.15) * 1.4;
  const expectedNonPavedStreakKm = Math.min(3, Math.max(0.8, targetDistanceKm * 0.18));
  const nonPavedStreakPenalty = Math.max(
    0,
    (expectedNonPavedStreakKm - longestNonPavedTrailStreakKm) / expectedNonPavedStreakKm
  ) * 1.2;
  const routeIntentFailurePenalty = routeIntentFailures.filter((failure) =>
    failure === "paved_ratio" || failure === "non_paved_streak" || failure === "geometry_overlap"
  ).length * 0.35 + Math.max(0, 1 - routeIntentMatchScore) * 0.35;
  const geometryPenalty = geometryOverlapRatio * 1.4;
  const trailQualityBonus = trailBeautyScore * 0.24 + naturalCorridorRatio * 0.14 + forestOrParkRatio * 0.1;

  return candidate.totalScore + trailQualityBonus - distancePenalty * 0.45 - elevationPenalty * 0.25 - trailDeficitPenalty - backtrackingPenalty - warningPenalty - pavementPenalty - scenicPavedPenalty - nonPavedStreakPenalty - routeIntentFailurePenalty - geometryPenalty - benchmarkFailurePenalty;
}

function isPavedLikeEdge(edge: EnrichedEdge): boolean {
  if (edge.surface != null) return PAVED_SURFACES.has(edge.surface);
  return BUSY_HIGHWAY_TYPES.has(edge.highway) || QUIET_HIGHWAY_TYPES.has(edge.highway);
}

function isNaturalLikeEdge(edge: EnrichedEdge, scenicWayIds: Set<string>): boolean {
  return edge.scenic === true || TRAIL_HIGHWAY_TYPES.has(edge.highway) || scenicWayIds.has(String(edge.osmWayId));
}

function isRestrictedForProfile(edge: EnrichedEdge, profile: SessionProfile): boolean {
  if (edge.access === "private" || edge.access === "no") return true;
  if (profile.sport === "running" && (edge.foot === "no" || edge.access === "customers")) return true;
  if (profile.sport !== "running" && (edge.bicycle === "no" || edge.access === "customers")) return true;
  return false;
}

function undirectedEdgeKey(edge: EnrichedEdge): string {
  const [a, b] = edge.from < edge.to ? [edge.from, edge.to] : [edge.to, edge.from];
  return `${a}-${b}-${edge.osmWayId}`;
}

function coordForNode(graph: EnrichedGraph, nodeId: string): Coordinate | null {
  const node = graph.nodes.get(nodeId);
  return node ? { lat: node.lat, lng: node.lng } : null;
}

function componentIdForEdge(edge: EnrichedEdge, components: TerrainComponent[]): string | null {
  const match = components.find((component) => {
    const nodeIds = new Set(component.nodeIds);
    return nodeIds.has(edge.from) && nodeIds.has(edge.to);
  });
  return match?.id ?? null;
}

function buildEdgeDiagnostics(
  path: SolverPath,
  graph: EnrichedGraph,
  profile: SessionProfile,
  scenicWayIds: Set<string>,
  routeIntent?: RouteIntent
): RouteEdgeDiagnostic[] {
  const repeatCounts = new Map<string, number>();
  for (const edgeId of path.edgeIds) {
    const edge = graph.edges.get(edgeId);
    if (!edge) continue;
    const key = undirectedEdgeKey(edge);
    repeatCounts.set(key, (repeatCounts.get(key) ?? 0) + 1);
  }

  return path.edgeIds.flatMap((edgeId, index) => {
    const edge = graph.edges.get(edgeId);
    if (!edge) return [];
    const edgeKey = undirectedEdgeKey(edge);
    const repeatCount = repeatCounts.get(edgeKey) ?? 1;
    return [{
      index,
      edgeId: edge.id,
      edgeKey,
      osmWayId: edge.osmWayId,
      fromNodeId: edge.from,
      toNodeId: edge.to,
      from: coordForNode(graph, edge.from),
      to: coordForNode(graph, edge.to),
      highway: edge.highway,
      surface: edge.surface ?? null,
      access: edge.access ?? null,
      foot: edge.foot ?? null,
      bicycle: edge.bicycle ?? null,
      oneway: edge.oneway ?? null,
      name: edge.name ?? null,
      ref: edge.ref ?? null,
      componentId: componentIdForEdge(edge, routeIntent?.terrainComponents ?? []),
      lengthKm: Number(edge.lengthKm.toFixed(5)),
      score: Number(edge.score.toFixed(5)),
      scoreReason: edge.scoreReason ?? null,
      flags: {
        trail: TRAIL_HIGHWAY_TYPES.has(edge.highway),
        paved: isPavedLikeEdge(edge),
        natural: isNaturalLikeEdge(edge, scenicWayIds),
        scenic: edge.scenic === true,
        busy: BUSY_HIGHWAY_TYPES.has(edge.highway),
        restricted: isRestrictedForProfile(edge, profile),
        onewayViolation: edge.onewayViolation === true,
      },
      repeatCount,
      repeated: repeatCount > 1,
    }];
  });
}

async function mapWithConcurrency<T, R>(
  items: T[],
  limit: number,
  worker: (item: T) => Promise<R>
): Promise<R[]> {
  const results: R[] = [];
  let nextIndex = 0;

  async function runWorker(): Promise<void> {
    while (nextIndex < items.length) {
      const index = nextIndex;
      nextIndex += 1;
      results[index] = await worker(items[index]);
    }
  }

  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, () => runWorker()));
  return results;
}

function buildRouteCoordinates(solverPath: SolverPath, graph: EnrichedGraph): Coordinate[] {
  const coords: Coordinate[] = [];

  for (const edgeId of solverPath.edgeIds) {
    const edge = graph.edges.get(edgeId);
    if (!edge) continue;

    const from = graph.nodes.get(edge.from);
    const to = graph.nodes.get(edge.to);
    if (!from || !to) continue;

    const fromCoord = { lat: from.lat, lng: from.lng };
    const toCoord = { lat: to.lat, lng: to.lng };

    if (coords.length === 0) {
      coords.push(fromCoord);
    } else {
      const last = coords[coords.length - 1];
      if (last.lat !== fromCoord.lat || last.lng !== fromCoord.lng) {
        coords.push(fromCoord);
      }
    }

    coords.push(toCoord);
  }

  if (coords.length >= 2) return coords;

  return solverPath.nodeIds
    .map((nid) => graph.nodes.get(nid))
    .filter((n): n is NonNullable<typeof n> => n != null)
    .map((n) => ({ lat: n.lat, lng: n.lng }));
}

export async function postProcess(
  paths: SolverPath[],
  graph: EnrichedGraph,
  startCoordinate: Coordinate,
  profile: SessionProfile,
  targetDistanceKm: number,
  targetElevationM: number,
  nodeElevation: Map<string, number> = new Map(),
  scenicWayIds: Set<string> = new Set(),
  routeIntent?: RouteIntent
): Promise<RouteCandidate[]> {
  if (paths.length === 0) return [];

  // Keep a distance-aware shortlist. Raw solver score alone can prefer shorter
  // high-quality loops and discard the only path that actually matches the ask.
  const topPaths = rankPathsForPostProcess(paths, targetDistanceKm, resolveShortlistLimit(routeIntent, profile, graph));

  const candidates: RouteCandidate[] = await mapWithConcurrency(
    topPaths,
    6,
    async (solverPath) => {
      // Reconstruct display coordinates from the actual traversed edges. nodeIds
      // can be a simplified solver path; the map/GPX need the edge-by-edge line.
      const fullCoords = buildRouteCoordinates(solverPath, graph);

      // Subsample to ≤200 points
      const sampled = subsampleCoords(fullCoords, MAX_ROUTE_POINTS);

      // Build elevations from pre-fetched nodeElevation map, fall back to API
      let elevations: number[];
      if (nodeElevation.size > 0 && graph.nodes.size <= 1_000) {
        // On small graphs every node has a direct elevation sample. On dense
        // Overpass graphs, sampled-node interpolation follows OSM insertion order
        // rather than the route geometry and can create fake D+ cliffs; route
        // coordinates are safer for final ascent metrics.
        elevations = solverPath.nodeIds.length === fullCoords.length
          ? subsampleValues(
              solverPath.nodeIds.map((nid) => nodeElevation.get(nid) ?? 0),
              fullCoords.length,
              sampled.length
            )
          : sampled.map(() => 0);
      } else {
        elevations = await fetchElevations(sampled);
      }

      const points: RoutePoint[] = sampled.map((c, i) => ({
        lat: c.lat,
        lng: c.lng,
        elevation: elevations[i] ?? undefined,
      }));

      const elevationSmoothingThresholdM = profile.sessionType === "trail"
        ? 35
        : (targetElevationM <= 50 ? 35 : 20);
      const { ascendM, descendM } = computeAscent(
        elevations.filter((e): e is number => e != null),
        elevationSmoothingThresholdM
      );

      const durationSeconds = estimateDuration(
        solverPath.distanceKm,
        ascendM,
        profile.sport
      );

      const loopScore = computeLoopScore(points, startCoordinate);

      // Build geometry from full coords
      const geometry: RouteCandidate["geometry"] = {
        type: "LineString",
        coordinates: fullCoords.map((c) => [c.lng, c.lat] as [number, number]),
      };

      // Compute surface score as average edge score (proxy for terrain quality)
      const edgeScores = solverPath.edgeIds
        .map((eid) => graph.edges.get(eid)?.score ?? 0.5)
        .filter((s) => s > 0);
      const surfaceScore = edgeScores.length > 0
        ? Math.min(1, edgeScores.reduce((a, b) => a + b, 0) / edgeScores.length)
        : 0.5;

      const baseScore = scoreRoute(
        { ascendM, distanceKm: solverPath.distanceKm, surfaceScore, loopScore },
        profile,
        targetDistanceKm,
        targetElevationM
      );

      const candidateWithoutQuality = {
        points,
        distanceKm: solverPath.distanceKm,
        durationSeconds,
        ascendM,
        descendM,
        surfaceScore,
        loopScore,
        totalScore: baseScore,
        geometry,
      };

      const quality = assessRouteQuality({
        candidate: candidateWithoutQuality,
        path: solverPath,
        graph,
        profile,
        targetDistanceKm,
        targetElevationM,
        scenicWayIds,
        routeIntent,
      });

      const totalScore = baseScore * 0.65 + quality.productionScore * 0.35;

      const edgeDiagnostics = buildEdgeDiagnostics(solverPath, graph, profile, scenicWayIds, routeIntent);

      return {
        ...candidateWithoutQuality,
        totalScore,
        quality,
        edgeDiagnostics,
      };
    }
  );

  // Sort by totalScore descending
  candidates.sort((a, b) =>
    candidateRankingScore(b, targetDistanceKm, targetElevationM, profile) -
    candidateRankingScore(a, targetDistanceKm, targetElevationM, profile)
  );

  return candidates;
}
