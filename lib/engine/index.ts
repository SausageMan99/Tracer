import * as path from "path";
import type { GeneratedRoute, RouteRequest } from "../types";
import { PROFILES_BY_ID } from "../session-profiles";
import { geocodeAddress } from "../route-generator-legacy";
import { RouteGenerationError } from "../errors";
import { buildGraph } from "./graph-builder";
import { deriveWeights, scoreEdges } from "./edge-scorer";
import { solve } from "./orienteering-solver";
import { postProcess } from "./route-post-processor";
import { FilesystemCache } from "./adapters/filesystem-cache";
import { DirectFetcher } from "./adapters/direct-fetcher";
import type { CacheAdapter } from "./adapters/cache-adapter";
import type { DataFetcher } from "./adapters/data-fetcher";
import type { TierConfig } from "./solver-config";
import { FULL_CONFIG } from "./solver-config";
import { haversineKm } from "./utils";

const defaultCache = new FilesystemCache(
  path.join(process.cwd(), ".cache", "graphs"),
  7 * 24 * 60 * 60 * 1000
);
const defaultFetcher = new DirectFetcher();

export async function generateRouteV2(
  request: RouteRequest,
  tierConfig: TierConfig = FULL_CONFIG,
  cache: CacheAdapter = defaultCache,
  fetcher: DataFetcher = defaultFetcher
): Promise<GeneratedRoute> {
  const t0 = performance.now();
  const log = (stage: string, data: Record<string, unknown>) =>
    console.log(`[v2-engine] ${stage}`, JSON.stringify(data));

  // 1. Resolve profile
  const profile = PROFILES_BY_ID.get(request.profileId);
  if (!profile) throw new RouteGenerationError("UNKNOWN", { message: "Unknown profile" });

  // 2. Geocode start address
  const t1 = performance.now();
  const startCoordinate = await geocodeAddress(request.address);
  log("geocode", {
    ms: Math.round(performance.now() - t1),
    lat: startCoordinate.lat,
    lng: startCoordinate.lng,
  });

  // 3. Build local OSM graph
  const t2 = performance.now();
  const { graph, scenicWayIds } = await buildGraph(
    startCoordinate,
    request.targetDistanceKm,
    cache,
    fetcher
  );
  log("graph", {
    ms: Math.round(performance.now() - t2),
    nodes: graph.nodes.size,
    edges: graph.edges.size,
    scenicWays: scenicWayIds.size,
  });

  if (graph.nodes.size === 0) {
    throw new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "EMPTY_GRAPH" });
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
    throw new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "EMPTY_GRAPH" });
  }

  // 5. Derive session weights and score edges
  const t3 = performance.now();
  const weights = deriveWeights(profile, request.scenicMode);
  const { nodeElevation } = await scoreEdges(
    graph,
    weights,
    profile,
    scenicWayIds,
    fetcher,
    tierConfig.enableFullScenic
  );
  log("scoring", {
    ms: Math.round(performance.now() - t3),
    weights,
  });

  // 6. Run solver
  const t4 = performance.now();
  const solverPaths = await solve(
    graph,
    closestNodeId,
    request.targetDistanceKm,
    request.targetElevationM,
    nodeElevation,
    tierConfig
  );
  log("solver", {
    ms: Math.round(performance.now() - t4),
    pathsFound: solverPaths.length,
  });

  if (solverPaths.length === 0) {
    throw new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "SOLVER_EMPTY" });
  }

  // 7. Post-process into RouteCandidate[]
  const t5 = performance.now();
  const candidates = await postProcess(
    solverPaths,
    graph,
    startCoordinate,
    profile,
    request.targetDistanceKm,
    request.targetElevationM,
    nodeElevation,
    fetcher,
    tierConfig.maxCandidates
  );
  log("postprocess", {
    ms: Math.round(performance.now() - t5),
    candidates: candidates.length,
    bestScore: candidates[0]?.totalScore,
    bestDistance: candidates[0]?.distanceKm,
    bestAscent: candidates[0]?.ascendM,
  });

  if (candidates.length === 0) {
    throw new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "SOLVER_EMPTY" });
  }

  const best = candidates[0];

  // 8. Impossible D+ detection
  const elevationDeficit = request.targetElevationM - best.ascendM;
  if (
    request.targetElevationM > 0 &&
    elevationDeficit > 50 &&
    best.ascendM < request.targetElevationM * 0.4
  ) {
    const maxEstimate = Math.round(
      Math.max(...candidates.map((c) => c.ascendM))
    );
    throw new RouteGenerationError("IMPOSSIBLE_ELEVATION", { maxElevationEstimate: maxEstimate });
  }

  log("complete", {
    totalMs: Math.round(performance.now() - t0),
    profile: profile.id,
    distanceKm: best.distanceKm,
    ascentM: best.ascendM,
  });

  return {
    best,
    candidates,
    startCoordinate,
    profile,
  };
}
