import type {
  Coordinate,
  EnrichedGraph,
  GeneratedRoute,
  RouteTerrainFallback,
  RouteGenerationDiagnostics,
  RouteGenerationStageTiming,
  RouteGenerationStageTimings,
  RouteRequest,
  SessionProfile,
} from "../types";
import { PROFILES_BY_ID } from "../session-profiles";
import { geocodeAddress, haversineKm } from "../route-generator-legacy";
import { RouteGenerationError } from "../errors";
import { buildGraph } from "./graph-builder";
import { deriveWeights, scoreEdges } from "./edge-scorer";
import { solve } from "./orienteering-solver";
import type { SolverEmptyDiagnostics } from "./orienteering-solver";
import { postProcess } from "./route-post-processor";
import { buildRejectedCandidatesDiagnostics, distanceAcceptanceForCandidate, isBestEffortTrailFallbackCandidate, isBetaStableCandidate, rejectionSubCodeForCandidate } from "./route-gate-selector";
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
  graph: Pick<EnrichedGraph, "nodes" | "edges">,
  startCoordinate: Coordinate,
  preferJunction: boolean = true
): StartNodeSnapResult {
  let closestNodeId = "";
  let closestDist = Infinity;
  const scoredGraph = graph.edges.size > 0;
  const usableDegreeFor = (node: { edges: string[] }): number => {
    if (!scoredGraph) return node.edges.length;
    return node.edges.filter((edgeId) => (graph.edges.get(edgeId)?.score ?? 0) > 0).length;
  };
  const candidates: Array<{ id: string; dist: number; degree: number }> = [];

  for (const [id, node] of Array.from(graph.nodes.entries())) {
    const dist = haversineKm(startCoordinate, { lat: node.lat, lng: node.lng });
    const degree = usableDegreeFor(node);
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

function inferSolverEmptyReason(diagnostics?: SolverEmptyDiagnostics): string {
  if (!diagnostics) return "UNKNOWN_EMPTY";
  if (diagnostics.deadlineReached) return "DEADLINE_EXCEEDED";
  if ((diagnostics.targetEntryNodeCount ?? 0) > 0 && (diagnostics.targetEntryStatesReached ?? 0) === 0) return "TARGET_ENTRY_ANCHOR_MISS";
  if ((diagnostics.noExpandableEdges ?? 0) > 0 && (diagnostics.statesExpanded ?? 0) === 0) return "NO_EXPANDABLE_EDGES";
  if ((diagnostics.prunedReturnBudget ?? 0) > 0) return "RETURN_BUDGET_EXHAUSTED";
  if ((diagnostics.returnPavedCap ?? 0) > 0) return "PAVED_CAP_EXHAUSTED";
  if ((diagnostics.returnRepeatCap ?? 0) > 0) return "REPEAT_CAP_EXHAUSTED";
  if ((diagnostics.returnPathMissing ?? 0) > 0) return "RETURN_PATH_MISSING";
  if ((diagnostics.prunedDistanceBudget ?? 0) > 0) return "DISTANCE_BUDGET_EXHAUSTED";
  if ((diagnostics.noExpandableEdges ?? 0) > 0) return "NO_EXPANDABLE_EDGES";
  return "UNKNOWN_EMPTY";
}

export interface SolverEmptyErrorContractInput {
  profile: SessionProfile;
  routeIntent?: RouteGenerationDiagnostics["terrain"]["routeIntent"];
  graphNodeCount: number;
  graphEdgeCount: number;
  emptyReason: string;
}

export function determineSolverEmptyErrorContract(input: SolverEmptyErrorContractInput): {
  code: "NO_ROAD_NETWORK" | "ROUTE_CANDIDATES_REJECTED";
  subCode: "SOLVER_EMPTY" | "URBAN_NATURE_PROMISE_UNMET";
} {
  const hasHealthyGraph = input.graphNodeCount > 0 && input.graphEdgeCount > 0;
  const isUrbanNatureIntent =
    input.routeIntent?.type === "urban_nature_loop" ||
    input.routeIntent?.strategy === "urban_nature_loop" ||
    input.routeIntent?.type === "park_loop" ||
    input.routeIntent?.strategy === "park_loop";
  const isUrbanRunningContract = input.profile.sport === "running" && (
    input.profile.sessionType !== "trail" || isUrbanNatureIntent
  );

  if (hasHealthyGraph && isUrbanRunningContract) {
    return { code: "ROUTE_CANDIDATES_REJECTED", subCode: "URBAN_NATURE_PROMISE_UNMET" };
  }

  return { code: "NO_ROAD_NETWORK", subCode: "SOLVER_EMPTY" };
}

function buildGenerationDiagnostics(args: {
  request: RouteRequest;
  profile: { id: string; sport: RouteGenerationDiagnostics["sport"] };
  graph: EnrichedGraph;
  scenicWayIds: { size: number };
  closestNodeId: string;
  closestDist: number;
  routeIntent: RouteGenerationDiagnostics["terrain"]["routeIntent"];
  solverPathCount: number;
  candidateCount: number;
  bestTotalScore?: number | null;
  bestProductionScore?: number | null;
  warnings?: string[];
  emptyReason?: string;
  emptyDiagnostics?: SolverEmptyDiagnostics;
}): RouteGenerationDiagnostics {
  const selectedStartNode = args.graph.nodes.get(args.closestNodeId);
  return {
    version: 1,
    strategy: "v2-local-graph",
    profileId: args.profile.id,
    sport: args.profile.sport,
    scenicMode: args.request.scenicMode === true,
    targetDistanceKm: args.request.targetDistanceKm,
    targetElevationM: args.request.targetElevationM,
    graph: {
      nodeCount: args.graph.nodes.size,
      edgeCount: args.graph.edges.size,
      scenicWayCount: args.scenicWayIds.size,
      selectedStartNodeId: args.closestNodeId || null,
      selectedStartNodeDegree: selectedStartNode?.edges.length ?? null,
    },
    closestNodeDistanceKm: Number.isFinite(args.closestDist) ? args.closestDist : null,
    terrain: {
      routeIntent: args.routeIntent,
    },
    solver: {
      pathCount: args.solverPathCount,
      candidateCount: args.candidateCount,
      bestTotalScore: args.bestTotalScore ?? null,
      bestProductionScore: args.bestProductionScore ?? null,
      warnings: args.warnings ?? [],
      ...(args.emptyReason != null ? { emptyReason: args.emptyReason } : {}),
      ...(args.emptyDiagnostics != null ? { emptyDiagnostics: args.emptyDiagnostics } : {}),
    },
  };
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

  const buildFailureStageTimings = (error: unknown): RouteGenerationStageTimings | undefined => {
    if (!includeGenerationDiagnostics) return undefined;
    const totalMs = now() - totalStartedAt;
    const totalTiming: RouteGenerationStageTiming = {
      stage: "total",
      durationMs: totalMs,
      ok: false,
    };
    const errorCode = errorCodeFrom(error);
    if (errorCode) totalTiming.errorCode = errorCode;
    return {
      totalMs,
      stages: [...stages, totalTiming],
    };
  };

  const attachFailureStageTimings = (error: unknown): void => {
    if (!(error instanceof RouteGenerationError)) return;
    if (error.stageTimings != null) return;
    const stageTimings = buildFailureStageTimings(error);
    if (stageTimings == null) return;
    Object.defineProperty(error, "stageTimings", {
      value: stageTimings,
      configurable: true,
      enumerable: true,
      writable: false,
    });
  };

  const timed = async <T>(stage: string, fn: () => T | Promise<T>): Promise<T> => {
    const startedAt = now();
    try {
      const value = await fn();
      recordStage(stage, startedAt, true);
      return value;
    } catch (error) {
      recordStage(stage, startedAt, false, error);
      attachFailureStageTimings(error);
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
  let { closestNodeId, closestDist } = await timed("graph.closestNode", () => {
    const preferJunction = profile.sport === "running" || profile.sessionType === "trail";
    return selectStartNodeTopologyAware(graph, startCoordinate, preferJunction);
  });

  if (!closestNodeId) {
    throw new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "EMPTY_GRAPH" });
  }

  // 5. Plan route intent in read-only mode for V2.5 diagnostics
  const routeIntent = await timed("terrain.plan", () => {
    const terrainAudit = auditTerrainData(Array.from(graph.edges.values()));
    const planned = planRouteIntent({
      graph,
      terrainAudit,
      profile,
      targetDistanceKm: request.targetDistanceKm,
      targetElevationM: request.targetElevationM,
      scenicMode: request.scenicMode,
    });
    if (request.routeGateElevationToleranceM != null && Number.isFinite(request.routeGateElevationToleranceM)) {
      return { ...planned, elevationToleranceM: request.routeGateElevationToleranceM };
    }
    return planned;
  });

  // 6. Derive session weights and score edges
  const { nodeElevation } = await timed("edges.score", async () => {
    const weights = deriveWeights(profile, request.scenicMode);
    return scoreEdges(graph, weights, profile, scenicWayIds, routeIntent);
  });

  const scoredStartSnap = await timed("graph.closestScoredNode", () => {
    const preferJunction = profile.sport === "running" || profile.sessionType === "trail";
    return selectStartNodeTopologyAware(graph, startCoordinate, preferJunction);
  });
  closestNodeId = scoredStartSnap.closestNodeId;
  closestDist = scoredStartSnap.closestDist;

  // 7. Run solver
  const solverEmptyDiagnostics: SolverEmptyDiagnostics | undefined = includeGenerationDiagnostics ? {} : undefined;
  const solverPaths = await timed("solver.solve", () => solve(
    graph,
    closestNodeId,
    request.targetDistanceKm,
    request.targetElevationM,
    nodeElevation,
    routeIntent,
    { emptyDiagnostics: solverEmptyDiagnostics }
  ));

  if (solverPaths.length === 0) {
    const emptyReason = inferSolverEmptyReason(solverEmptyDiagnostics);
    const errorContract = determineSolverEmptyErrorContract({
      profile,
      routeIntent,
      graphNodeCount: graph.nodes.size,
      graphEdgeCount: graph.edges.size,
      emptyReason,
    });
    throw new RouteGenerationError(errorContract.code, {
      subCode: errorContract.subCode,
      generationDiagnostics: includeGenerationDiagnostics
        ? buildGenerationDiagnostics({
            request,
            profile,
            graph,
            scenicWayIds,
            closestNodeId,
            closestDist,
            routeIntent,
            solverPathCount: 0,
            candidateCount: 0,
            emptyReason,
            emptyDiagnostics: solverEmptyDiagnostics,
          })
        : undefined,
    });
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
    const emptyReason = "POST_PROCESS_EMPTY";
    const errorContract = determineSolverEmptyErrorContract({
      profile,
      routeIntent,
      graphNodeCount: graph.nodes.size,
      graphEdgeCount: graph.edges.size,
      emptyReason,
    });
    throw new RouteGenerationError(errorContract.code, {
      subCode: errorContract.subCode,
      generationDiagnostics: includeGenerationDiagnostics
        ? buildGenerationDiagnostics({
            request,
            profile,
            graph,
            scenicWayIds,
            closestNodeId,
            closestDist,
            routeIntent,
            solverPathCount: solverPaths.length,
            candidateCount: 0,
            emptyReason,
            emptyDiagnostics: solverEmptyDiagnostics,
          })
        : undefined,
    });
  }

  const best = candidates[0];
  let terrainFallback: RouteTerrainFallback | undefined;

  // 9. Beta fail-clean: do not return a success when the selected candidate
  // violates a product promise or blocking safety gate. Critical stability risk
  // remains a ranking/warning/diagnostic signal, not a hidden hard threshold
  // when the selected route is inside every product gate.
  await timed("guards.betaStability", () => {
    const gateContext = {
      targetDistanceKm: request.targetDistanceKm,
      targetElevationM: request.targetElevationM,
      profile,
      routeGateElevationToleranceM: request.routeGateElevationToleranceM,
      routeIntent,
    };
    if (!isBetaStableCandidate(best, gateContext)) {
      const subCode = rejectionSubCodeForCandidate(best, gateContext);
      if (subCode === "TRAIL_PROMISE_UNMET" && isBestEffortTrailFallbackCandidate(best, gateContext)) {
        terrainFallback = {
          reason: "TRAIL_NOT_AVAILABLE_IN_LOCATION",
          policy: "best_effort_terrain",
          requestedTerrain: "trail",
          deliveredTerrain: "best_effort_nature",
          messageCode: "TRAIL_NOT_AVAILABLE_IN_LOCATION",
          message: "Chemin trail non disponible dans cette localisation : meilleure boucle nature proposée.",
        };
        return;
      }
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
    routeGateElevationToleranceM: request.routeGateElevationToleranceM,
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
    ...(terrainFallback != null ? { terrainFallback } : {}),
  };

  if (includeGenerationDiagnostics) {
    const totalMs = now() - totalStartedAt;
    stages.push({ stage: "total", durationMs: totalMs, ok: true });
    route.stageTimings = {
      totalMs,
      stages,
    };
    const warnings = Array.isArray(best.quality?.warnings) ? best.quality.warnings : [];
    route.diagnostics = buildGenerationDiagnostics({
      request,
      profile,
      graph,
      scenicWayIds,
      closestNodeId,
      closestDist,
      routeIntent,
      solverPathCount: solverPaths.length,
      candidateCount: candidates.length,
      bestTotalScore: typeof best.totalScore === "number" ? best.totalScore : null,
      bestProductionScore: typeof best.quality?.productionScore === "number" ? best.quality.productionScore : null,
      warnings,
    });
  }

  return route;
}
