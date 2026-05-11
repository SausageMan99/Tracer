import type {
  Coordinate,
  EnrichedGraph,
  GeneratedRoute,
  RouteGenerationDiagnostics,
  RouteGenerationStageTiming,
  RouteRequest,
} from "../types";
import { PROFILES_BY_ID } from "../session-profiles";
import { geocodeAddress, haversineKm } from "../route-generator-legacy";
import { RouteGenerationError } from "../errors";
import { buildGraph } from "./graph-builder";
import { deriveWeights, scoreEdges } from "./edge-scorer";
import { solve } from "./orienteering-solver";
import { postProcess } from "./route-post-processor";
import { buildRejectedCandidatesDiagnostics, distanceAcceptanceForCandidate, isBetaStableCandidate, rejectionSubCodeForCandidate } from "./route-gate-selector";
import { auditTerrainData } from "./terrain-audit";
import { planRouteIntent } from "./terrain-planner";

export interface GenerateRouteV2Options {
  includeGenerationDiagnostics?: boolean;
  now?: () => number;
}

export interface StartNodeSnapResult {
  closestNodeId: string;
  closestDist: number;
}

export function selectStartNodeTopologyAware(
  graph: Pick<EnrichedGraph, "nodes">,
  startCoordinate: Coordinate,
  preferJunction: boolean = true
): StartNodeSnapResult {
  let closestNodeId = "";
  let closestDist = Infinity;
  const candidates: Array<{ id: string; dist: number; degree: number }> = [];

  for (const [id, node] of Array.from(graph.nodes.entries())) {
    const dist = haversineKm(startCoordinate, { lat: node.lat, lng: node.lng });
    const degree = node.edges.length;
    candidates.push({ id, dist, degree });
    if (dist < closestDist) {
      closestDist = dist;
      closestNodeId = id;
    }
  }

  if (!preferJunction || !closestNodeId || !Number.isFinite(closestDist)) {
    return { closestNodeId, closestDist };
  }

  const searchRadiusKm = Math.min(0.05, Math.max(0.03, closestDist + 0.02));
  const junctionCandidate = candidates
    .filter((candidate) => candidate.degree >= 3 && candidate.dist <= searchRadiusKm)
    .sort((a, b) => a.dist - b.dist)[0];

  if (!junctionCandidate) {
    return { closestNodeId, closestDist };
  }

  return { closestNodeId: junctionCandidate.id, closestDist: junctionCandidate.dist };
}

function errorCodeFrom(error: unknown): string | undefined {
  if (error instanceof RouteGenerationError) return error.code;
  return error instanceof Error ? "UNKNOWN" : undefined;
}

export async function generateRouteV2(
  request: RouteRequest,
  options: GenerateRouteV2Options = {}
): Promise<GeneratedRoute> {
  const includeGenerationDiagnostics = options.includeGenerationDiagnostics === true;
  const now = options.now ?? (() => performance.now());
  const totalStartedAt = now();
  const stages: RouteGenerationStageTiming[] = [];

  const recordStage = (stage: string, startedAt: number, ok: boolean, error?: unknown): void => {
    if (!includeGenerationDiagnostics) return;
    const timing: RouteGenerationStageTiming = {
      stage,
      durationMs: now() - startedAt,
      ok,
    };
    const errorCode = ok ? undefined : errorCodeFrom(error);
    if (errorCode) timing.errorCode = errorCode;
    stages.push(timing);
  };

  const timed = async <T>(stage: string, fn: () => T | Promise<T>): Promise<T> => {
    const startedAt = now();
    try {
      const value = await fn();
      recordStage(stage, startedAt, true);
      return value;
    } catch (error) {
      recordStage(stage, startedAt, false, error);
      throw error;
    }
  };

  // 1. Resolve profile
  const profile = await timed("profile.resolve", () => {
    const resolved = PROFILES_BY_ID.get(request.profileId);
    if (!resolved) throw new RouteGenerationError("UNKNOWN", { message: "Unknown profile" });
    return resolved;
  });

  // 2. Geocode start address
  const startCoordinate = await timed("geocode.start", () => geocodeAddress(request.address));

  // 3. Build local OSM graph
  const { graph, scenicWayIds } = await timed("graph.build", () => buildGraph(startCoordinate, {
    targetDistanceKm: request.targetDistanceKm,
    sport: profile.sport,
  }));

  if (graph.nodes.size === 0) {
    throw new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "EMPTY_GRAPH" });
  }

  // 4. Find start node. For running/trail loops, avoid snapping to a very close
  // spur when a real junction is only a few metres farther away.
  const { closestNodeId, closestDist } = await timed("graph.closestNode", () => {
    const preferJunction = profile.sport === "running" || profile.sessionType === "trail";
    return selectStartNodeTopologyAware(graph, startCoordinate, preferJunction);
  });

  if (!closestNodeId) {
    throw new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "EMPTY_GRAPH" });
  }

  // 5. Plan route intent in read-only mode for V2.5 diagnostics
  const routeIntent = await timed("terrain.plan", () => {
    const terrainAudit = auditTerrainData(Array.from(graph.edges.values()));
    return planRouteIntent({
      graph,
      terrainAudit,
      profile,
      targetDistanceKm: request.targetDistanceKm,
      targetElevationM: request.targetElevationM,
      scenicMode: request.scenicMode,
    });
  });

  // 6. Derive session weights and score edges
  const { nodeElevation } = await timed("edges.score", async () => {
    const weights = deriveWeights(profile, request.scenicMode);
    return scoreEdges(graph, weights, profile, scenicWayIds, routeIntent);
  });

  // 7. Run solver
  const solverPaths = await timed("solver.solve", () => solve(
    graph,
    closestNodeId,
    request.targetDistanceKm,
    request.targetElevationM,
    nodeElevation,
    routeIntent
  ));

  if (solverPaths.length === 0) {
    throw new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "SOLVER_EMPTY" });
  }

  // 8. Post-process into RouteCandidate[]
  const candidates = await timed("postProcess.candidates", () => postProcess(
    solverPaths,
    graph,
    startCoordinate,
    profile,
    request.targetDistanceKm,
    request.targetElevationM,
    nodeElevation,
    scenicWayIds,
    routeIntent
  ));

  if (candidates.length === 0) {
    throw new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "SOLVER_EMPTY" });
  }

  const best = candidates[0];

  // 9. Beta fail-clean: do not return a success when the selected candidate
  // violates a product promise or blocking safety gate. Critical stability risk
  // remains a ranking/warning/diagnostic signal, not a hidden hard threshold
  // when the selected route is inside every product gate.
  await timed("guards.betaStability", () => {
    const gateContext = {
      targetDistanceKm: request.targetDistanceKm,
      targetElevationM: request.targetElevationM,
      profile,
      routeIntent,
    };
    if (!isBetaStableCandidate(best, gateContext)) {
      const subCode = rejectionSubCodeForCandidate(best, gateContext);
      throw new RouteGenerationError("ROUTE_CANDIDATES_REJECTED", {
        subCode,
        rejectedCandidatesDiagnostics: includeGenerationDiagnostics
          ? buildRejectedCandidatesDiagnostics(candidates, gateContext, subCode)
          : undefined,
      });
    }
  });

  // 10. Impossible D+ detection
  await timed("guards.elevation", () => {
    if (
      request.targetElevationM > 200 &&
      Math.max(...candidates.map((c) => c.ascendM)) > 0 &&
      best.ascendM < request.targetElevationM * 0.3
    ) {
      const maxEstimate = Math.round(
        Math.max(...candidates.map((c) => c.ascendM))
      );
      throw new RouteGenerationError("IMPOSSIBLE_ELEVATION", { maxElevationEstimate: maxEstimate });
    }
  });

  const distanceAcceptance = distanceAcceptanceForCandidate(best, {
    targetDistanceKm: request.targetDistanceKm,
    targetElevationM: request.targetElevationM,
    profile,
    routeIntent,
  });

  const distanceAdjustment = routeIntent.distancePolicy.mode === "adjustable" && distanceAcceptance === "adjusted"
    ? {
        requestedDistanceKm: request.targetDistanceKm,
        adjustedDistanceKm: best.distanceKm,
        reason: routeIntent.distancePolicy.reason,
        policy: "adjusted_distance" as const,
        messageCode: "PARK_RECOVERY_DISTANCE_ADJUSTED" as const,
      }
    : undefined;

  const route: GeneratedRoute = {
    best,
    candidates,
    startCoordinate,
    profile,
    routeIntent,
    ...(distanceAdjustment != null ? { distanceAdjustment } : {}),
  };

  if (includeGenerationDiagnostics) {
    const totalMs = now() - totalStartedAt;
    stages.push({ stage: "total", durationMs: totalMs, ok: true });
    route.stageTimings = {
      totalMs,
      stages,
    };
    const warnings = Array.isArray(best.quality?.warnings) ? best.quality.warnings : [];
    const diagnostics: RouteGenerationDiagnostics = {
      version: 1,
      strategy: "v2-local-graph",
      profileId: profile.id,
      sport: profile.sport,
      scenicMode: request.scenicMode === true,
      targetDistanceKm: request.targetDistanceKm,
      targetElevationM: request.targetElevationM,
      graph: {
        nodeCount: graph.nodes.size,
        edgeCount: graph.edges.size,
        scenicWayCount: scenicWayIds.size,
      },
      closestNodeDistanceKm: Number.isFinite(closestDist) ? closestDist : null,
      terrain: {
        routeIntent,
      },
      solver: {
        pathCount: solverPaths.length,
        candidateCount: candidates.length,
        bestTotalScore: typeof best.totalScore === "number" ? best.totalScore : null,
        bestProductionScore: typeof best.quality?.productionScore === "number" ? best.quality.productionScore : null,
        warnings,
      },
    };
    route.diagnostics = diagnostics;
  }

  return route;
}
