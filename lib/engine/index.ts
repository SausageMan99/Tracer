import type { GeneratedRoute, RouteRequest } from "../types";
import { PROFILES_BY_ID } from "../session-profiles";
import { geocodeAddress, haversineKm } from "../route-generator-legacy";
import { buildGraph } from "./graph-builder";
import { deriveWeights, scoreEdges } from "./edge-scorer";
import { solve } from "./orienteering-solver";
import { postProcess } from "./route-post-processor";

export async function generateRouteV2(
  request: RouteRequest
): Promise<GeneratedRoute> {
  // 1. Resolve profile
  const profile = PROFILES_BY_ID.get(request.profileId);
  if (!profile) throw new Error("UNKNOWN_PROFILE");

  // 2. Geocode start address
  const startCoordinate = await geocodeAddress(request.address);

  // 3. Build local OSM graph
  const { graph, scenicWayIds } = await buildGraph(
    startCoordinate,
    request.targetDistanceKm
  );

  if (graph.nodes.size === 0) {
    throw new Error("NO_ROAD_NETWORK");
  }

  // 4. Find closest node to start
  let closestNodeId = "";
  let closestDist = Infinity;
  for (const [id, node] of graph.nodes) {
    const dist = haversineKm(startCoordinate, { lat: node.lat, lng: node.lng });
    if (dist < closestDist) {
      closestDist = dist;
      closestNodeId = id;
    }
  }

  if (!closestNodeId) {
    throw new Error("NO_ROAD_NETWORK");
  }

  // 5. Derive session weights and score edges
  const weights = deriveWeights(profile);
  await scoreEdges(graph, weights, profile, scenicWayIds);

  // 6. Run solver
  const solverPaths = await solve(
    graph,
    closestNodeId,
    request.targetDistanceKm
  );

  if (solverPaths.length === 0) {
    throw new Error("NO_ROAD_NETWORK");
  }

  // 7. Post-process into RouteCandidate[]
  const candidates = await postProcess(
    solverPaths,
    graph,
    startCoordinate,
    profile,
    request.targetDistanceKm,
    request.targetElevationM
  );

  if (candidates.length === 0) {
    throw new Error("NO_ROAD_NETWORK");
  }

  const best = candidates[0];

  // 8. Impossible D+ detection
  if (
    request.targetElevationM > 200 &&
    best.ascendM < request.targetElevationM * 0.3
  ) {
    const maxEstimate = Math.round(
      Math.max(...candidates.map((c) => c.ascendM))
    );
    throw new Error(`IMPOSSIBLE_ELEVATION:${maxEstimate}`);
  }

  return {
    best,
    candidates,
    startCoordinate,
    profile,
  };
}
