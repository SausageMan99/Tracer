import type {
  Coordinate,
  EnrichedGraph,
  RouteCandidate,
  RoutePoint,
  SessionProfile,
  SolverPath,
} from "../types";
import {
  fetchElevations,
  computeAscent,
  scoreRoute,
  computeLoopScore,
} from "../route-generator-legacy";
import { assessRouteQuality } from "./route-quality";

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
  const forestOrParkRatio = quality?.forestOrParkRatio ?? 0;
  const trailDeficitPenalty = targetDistanceKm >= 8 ? Math.max(0, 0.2 - trailRatio) * 0.8 : 0;

  if (profile.sessionType !== "trail") {
    return candidate.totalScore - distancePenalty * 0.5 - elevationPenalty * 0.35 - trailDeficitPenalty;
  }

  const backtrackingPenalty = repeatEdgeRatio * 1.8 + uTurnRatio * 2.5;
  const warningPenalty = quality?.warnings.includes("TOO_MUCH_BACKTRACKING") ? 0.22 : 0;
  const trailQualityBonus = trailBeautyScore * 0.24 + naturalCorridorRatio * 0.14 + forestOrParkRatio * 0.1;

  return candidate.totalScore + trailQualityBonus - distancePenalty * 0.45 - elevationPenalty * 0.25 - trailDeficitPenalty - backtrackingPenalty - warningPenalty;
}

export async function postProcess(
  paths: SolverPath[],
  graph: EnrichedGraph,
  startCoordinate: Coordinate,
  profile: SessionProfile,
  targetDistanceKm: number,
  targetElevationM: number,
  nodeElevation: Map<string, number> = new Map(),
  scenicWayIds: Set<string> = new Set()
): Promise<RouteCandidate[]> {
  if (paths.length === 0) return [];

  // Keep a distance-aware shortlist. Raw solver score alone can prefer shorter
  // high-quality loops and discard the only path that actually matches the ask.
  const topPaths = rankPathsForPostProcess(paths, targetDistanceKm, 8);

  const candidates: RouteCandidate[] = await Promise.all(
    topPaths.map(async (solverPath) => {
      // Reconstruct coordinates from nodeIds
      const fullCoords: Coordinate[] = solverPath.nodeIds
        .map((nid) => graph.nodes.get(nid))
        .filter((n): n is NonNullable<typeof n> => n != null)
        .map((n) => ({ lat: n.lat, lng: n.lng }));

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
        try {
          elevations = await fetchElevations(sampled);
        } catch {
          elevations = sampled.map(() => 0);
        }
      }

      const points: RoutePoint[] = sampled.map((c, i) => ({
        lat: c.lat,
        lng: c.lng,
        elevation: elevations[i] ?? undefined,
      }));

      const elevationSmoothingThresholdM = targetElevationM <= 50 ? 35 : 20;
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
        ? edgeScores.reduce((a, b) => a + b, 0) / edgeScores.length
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
      });

      const totalScore = baseScore * 0.65 + quality.productionScore * 0.35;

      return {
        ...candidateWithoutQuality,
        totalScore,
        quality,
      };
    })
  );

  // Sort by totalScore descending
  candidates.sort((a, b) =>
    candidateRankingScore(b, targetDistanceKm, targetElevationM, profile) -
    candidateRankingScore(a, targetDistanceKm, targetElevationM, profile)
  );

  return candidates;
}
