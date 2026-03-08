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

const MAX_ROUTE_POINTS = 200;

function subsampleCoords(coords: Coordinate[], max: number): Coordinate[] {
  if (coords.length <= max) return coords;
  const step = (coords.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => coords[Math.round(i * step)]);
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

export async function postProcess(
  paths: SolverPath[],
  graph: EnrichedGraph,
  startCoordinate: Coordinate,
  profile: SessionProfile,
  targetDistanceKm: number,
  targetElevationM: number
): Promise<RouteCandidate[]> {
  if (paths.length === 0) return [];

  // Take top 6 paths
  const topPaths = paths.slice(0, 6);

  const candidates: RouteCandidate[] = await Promise.all(
    topPaths.map(async (solverPath) => {
      // Reconstruct coordinates from nodeIds
      const fullCoords: Coordinate[] = solverPath.nodeIds
        .map((nid) => graph.nodes.get(nid))
        .filter((n): n is NonNullable<typeof n> => n != null)
        .map((n) => ({ lat: n.lat, lng: n.lng }));

      // Subsample to ≤200 points
      const sampled = subsampleCoords(fullCoords, MAX_ROUTE_POINTS);

      // Fetch elevations
      let elevations: number[];
      try {
        elevations = await fetchElevations(sampled);
      } catch {
        elevations = sampled.map(() => 0);
      }

      const points: RoutePoint[] = sampled.map((c, i) => ({
        lat: c.lat,
        lng: c.lng,
        elevation: elevations[i] ?? undefined,
      }));

      const { ascendM, descendM } = computeAscent(
        elevations.filter((e): e is number => e != null)
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

      const totalScore = scoreRoute(
        { ascendM, distanceKm: solverPath.distanceKm, surfaceScore, loopScore },
        profile,
        targetDistanceKm,
        targetElevationM
      );

      return {
        points,
        distanceKm: solverPath.distanceKm,
        durationSeconds,
        ascendM,
        descendM,
        surfaceScore,
        loopScore,
        totalScore,
        geometry,
      };
    })
  );

  // Sort by totalScore descending
  candidates.sort((a, b) => b.totalScore - a.totalScore);

  return candidates;
}
