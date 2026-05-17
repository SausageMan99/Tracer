import type { EnrichedEdge, EnrichedGraph, GraphNode } from '../../types';
import { computeRouteMetricsV3, createEmptyRouteMetricsV3 } from '../route-metrics';
import type { AssembledRouteV3, CorridorMissionV3, RouteAssemblyDiagnosticsV3, RouteEdgeV3, RouteIntentV3, RouteSurfaceV3, TerrainComponentKindV3 } from '../types';

const PAVED_SURFACES = new Set(['asphalt', 'concrete', 'paved', 'paving_stones', 'sett', 'cobblestone', 'compacted']);
const NATURAL_SURFACES = new Set(['dirt', 'earth', 'grass', 'ground', 'gravel', 'mud', 'sand', 'soil', 'unpaved', 'woodchips']);
const ROAD_LIKE_HIGHWAYS = new Set(['secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);
const PATH_LIKE_HIGHWAYS = new Set(['path', 'track', 'footway', 'bridleway', 'pedestrian']);

export interface TraversalEdgeV3 {
  edge: EnrichedEdge;
  from: string;
  to: string;
  kind: TerrainComponentKindV3;
  surface: RouteSurfaceV3;
}

export interface GraphAssemblyOptionsV3 {
  mode: 'forest_loop' | 'transition_to_woods' | 'park_loop' | 'generic';
  requireNaturalDwell?: boolean;
  warning?: string;
}

export function assembleGraphRouteWithStrategyV3(
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  graph: EnrichedGraph,
  options: GraphAssemblyOptionsV3,
): AssembledRouteV3 {
  if (!mission.anchor || intent.strategy === 'unroutable') return emptyGraphRoute(intent, mission, 'no usable anchor for graph assembly');

  const startNodeId = closestNodeId(graph, intent.request?.start ?? graph.center);
  if (!startNodeId) return emptyGraphRoute(intent, mission, 'graph contains no nodes for assembly');

  const adjacency = buildAdjacency(graph);
  const assemblyDiagnostics = diagnoseReachableNonPavedTargets(startNodeId, adjacency, intent);
  const candidates = assembleGraphCandidates(startNodeId, intent, mission, adjacency, options);
  const traversal = selectBestCandidate(candidates, startNodeId, intent, mission, options);
  if (!traversal || traversal.length === 0) return emptyGraphRoute(intent, mission, 'graph assembly could not traverse routeable edges');

  const nodeIds = nodesFromTraversal(startNodeId, traversal);
  const edges = traversal.map(toRouteEdge);
  const geometry = toGeometry(graph, nodeIds);
  const metrics = computeRouteMetricsV3({
    targetDistanceKm: intent.constraints.targetDistanceKm,
    edges,
    geometry,
    targetComponents: intent.constraints.targetComponents,
  });
  const distanceProducedKm = metrics.distanceProducedKm;
  const warnings = [...mission.warnings];
  if (options.warning) warnings.push(options.warning);
  if (distanceProducedKm < intent.constraints.targetDistanceKm * 0.7) warnings.push('graph assembly produced insufficient route distance');
  if (options.requireNaturalDwell && metrics.naturalDwellKm < mission.requestedNaturalDwellKm) {
    warnings.push('transition_to_woods did not meet requested woods dwell; route remains adjusted, not pure trail');
  }

  return {
    engine: 'v3-clean-room',
    strategy: intent.strategy,
    mission: cloneMission(mission),
    segments: [],
    edges,
    nodeIds,
    geometry,
    surfaces: {
      pavedKm: metrics.pavedKm,
      nonPavedKm: metrics.nonPavedKm,
      naturalDwellKm: metrics.naturalDwellKm,
    },
    metrics,
    assemblyDiagnostics,
    warnings,
  };
}

interface GraphCandidateStateV3 {
  current: string;
  traversal: TraversalEdgeV3[];
  usedEdgeCounts: Map<string, number>;
  distanceKm: number;
  naturalDwellKm: number;
  enteredTarget: boolean;
}

function assembleGraphCandidates(
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  adjacency: Map<string, TraversalEdgeV3[]>,
  options: GraphAssemblyOptionsV3,
): GraphCandidateStateV3[] {
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const maxDistanceKm = targetDistanceKm * 1.15;
  const beamWidth = 64;
  const maxSteps = maxTraversalSteps(targetDistanceKm);
  const initialTraversal = shortestTraversalToFirstNonPavedTarget(startNodeId, adjacency, intent);
  let frontier: GraphCandidateStateV3[] = [
    { current: startNodeId, traversal: [], usedEdgeCounts: new Map(), distanceKm: 0, naturalDwellKm: 0, enteredTarget: false },
  ];
  if (initialTraversal.length > 0) frontier.push(stateFromTraversal(startNodeId, initialTraversal, intent));
  const candidates: GraphCandidateStateV3[] = [];

  for (let step = 0; step < maxSteps && frontier.length > 0; step += 1) {
    const expanded: GraphCandidateStateV3[] = [];

    for (const state of frontier) {
      if (state.traversal.length > 0 && state.current === startNodeId && state.enteredTarget) candidates.push(state);
      if (state.distanceKm >= maxDistanceKm) continue;

      const nextEdges = orderExpansionCandidates(adjacency.get(state.current) ?? [], state, startNodeId, intent, mission, options).filter((next) => {
        const nextDistanceKm = state.distanceKm + Math.max(0, next.edge.lengthKm);
        return nextDistanceKm <= maxDistanceKm + 0.001 && canTraverse(next, state, startNodeId, intent, mission);
      });
      if (nextEdges.length === 0 && state.traversal.length > 0 && state.enteredTarget) candidates.push(state);

      for (const next of nextEdges) {
        expanded.push(advanceState(state, next, intent));
      }
    }

    frontier = pruneFrontier(expanded, beamWidth, startNodeId, intent, mission, options);
  }

  for (const state of frontier) {
    if (state.traversal.length > 0 && state.current === startNodeId && state.enteredTarget) candidates.push(state);
  }

  return candidates.length > 0 ? [...candidates, ...frontier] : frontier;
}

function maxTraversalSteps(targetDistanceKm: number): number {
  return Math.min(512, Math.max(128, Math.ceil((targetDistanceKm / 0.035) * 1.2)));
}

function pruneFrontier(
  expanded: GraphCandidateStateV3[],
  beamWidth: number,
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
): GraphCandidateStateV3[] {
  const byRouteScore = [...expanded].sort(
    (a, b) => scorePartialCandidate(b, startNodeId, intent, mission, options) - scorePartialCandidate(a, startNodeId, intent, mission, options),
  );
  const explorationLane = [...expanded]
    .filter((state) => state.current !== startNodeId || state.naturalDwellKm > 0)
    .sort((a, b) => scoreExplorationLane(b, intent, mission) - scoreExplorationLane(a, intent, mission));
  const selected: GraphCandidateStateV3[] = [];
  const seen = new Set<string>();
  for (const state of [...byRouteScore.slice(0, Math.max(1, beamWidth - 16)), ...explorationLane]) {
    const key = candidateKey(state);
    if (seen.has(key)) continue;
    selected.push(state);
    seen.add(key);
    if (selected.length >= beamWidth) break;
  }
  return selected;
}

function scoreExplorationLane(state: GraphCandidateStateV3, intent: RouteIntentV3, mission: CorridorMissionV3): number {
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const dwellProgress = Math.min(1, state.naturalDwellKm / Math.max(0.001, requestedNaturalDwellKm(intent, mission)));
  const distanceProgress = Math.min(1, state.distanceKm / Math.max(0.001, targetDistanceKm));
  const pavedRatio = pavedKm(state) / Math.max(0.001, state.distanceKm);
  let score = distanceProgress * 4 + dwellProgress * 12 - pavedRatio * 8;
  if (!state.enteredTarget) score += 4;
  if (state.naturalDwellKm > 0) score += 8;
  return score;
}

function candidateKey(state: GraphCandidateStateV3): string {
  return `${state.current}:${state.traversal.map((edge) => edge.edge.id).join('|')}`;
}

function selectBestCandidate(
  candidates: GraphCandidateStateV3[],
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
): TraversalEdgeV3[] | null {
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const viableReturnedCandidates = candidates.filter(
    (candidate) =>
      candidate.current === startNodeId &&
      candidate.traversal.length > 0 &&
      candidate.distanceKm >= targetDistanceKm * 0.7 &&
      candidate.distanceKm <= targetDistanceKm * 1.15,
  );
  const requestedDwellKm = requestedNaturalDwellKm(intent, mission);
  const viableReturnedWithDwell = viableReturnedCandidates.filter(
    (candidate) => candidate.naturalDwellKm + 0.001 >= requestedDwellKm,
  );
  const pool = viableReturnedWithDwell.length > 0 ? viableReturnedWithDwell : candidates;
  const scorer = viableReturnedWithDwell.length > 0 ? scoreCompleteCandidate : scoreProgressCandidate;
  const selected = [...pool].sort(
    (a, b) => scorer(b, startNodeId, intent, mission, options) - scorer(a, startNodeId, intent, mission, options),
  )[0];
  return selected?.traversal ?? null;
}

function orderExpansionCandidates(
  candidates: TraversalEdgeV3[],
  state: GraphCandidateStateV3,
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
): TraversalEdgeV3[] {
  return [...candidates].sort(
    (a, b) => scoreNextEdge(b, state, startNodeId, intent, mission, options) - scoreNextEdge(a, state, startNodeId, intent, mission, options),
  );
}

function canTraverse(
  edge: TraversalEdgeV3,
  state: GraphCandidateStateV3,
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
): boolean {
  const usedCount = state.usedEdgeCounts.get(edge.edge.id) ?? 0;
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const requestedDwellKm = requestedNaturalDwellKm(intent, mission);
  if (
    edge.to === startNodeId &&
    state.enteredTarget &&
    mission.returnMode === 'out_and_back_connector' &&
    state.distanceKm < targetDistanceKm * 0.7 &&
    state.naturalDwellKm < requestedDwellKm * 0.75
  ) {
    return false;
  }
  if (usedCount >= 2) return false;
  if (usedCount > 0 && !shouldAllowRepeat(edge, state, startNodeId, intent, mission)) return false;
  if (state.traversal.length === 0 && edge.to === startNodeId) return false;
  return true;
}

function shouldAllowRepeat(
  edge: TraversalEdgeV3,
  state: GraphCandidateStateV3,
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
): boolean {
  if (!state.enteredTarget) return false;
  if (edge.to === startNodeId) return true;
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const requestedDwellKm = requestedNaturalDwellKm(intent, mission);
  return state.distanceKm >= targetDistanceKm * 0.55 && state.naturalDwellKm >= requestedDwellKm * 0.75;
}

function advanceState(state: GraphCandidateStateV3, edge: TraversalEdgeV3, intent: RouteIntentV3): GraphCandidateStateV3 {
  const usedEdgeCounts = new Map(state.usedEdgeCounts);
  usedEdgeCounts.set(edge.edge.id, (usedEdgeCounts.get(edge.edge.id) ?? 0) + 1);
  const edgeLengthKm = Math.max(0, edge.edge.lengthKm);
  const isTarget = intent.constraints.targetComponents.includes(edge.kind);
  const naturalDwellKm = state.naturalDwellKm + (isTarget && edge.surface !== 'paved' ? (edge.surface === 'mixed' ? edgeLengthKm * 0.5 : edgeLengthKm) : 0);
  return {
    current: edge.to,
    traversal: [...state.traversal, edge],
    usedEdgeCounts,
    distanceKm: state.distanceKm + edgeLengthKm,
    naturalDwellKm,
    enteredTarget: state.enteredTarget || isTarget,
  };
}

function stateFromTraversal(startNodeId: string, traversal: TraversalEdgeV3[], intent: RouteIntentV3): GraphCandidateStateV3 {
  return traversal.reduce<GraphCandidateStateV3>(
    (state, edge) => advanceState(state, edge, intent),
    { current: startNodeId, traversal: [], usedEdgeCounts: new Map(), distanceKm: 0, naturalDwellKm: 0, enteredTarget: false },
  );
}

function shortestTraversalToFirstNonPavedTarget(
  startNodeId: string,
  adjacency: Map<string, TraversalEdgeV3[]>,
  intent: RouteIntentV3,
): TraversalEdgeV3[] {
  const bestDistances = new Map<string, number>([[startNodeId, 0]]);
  const pending: Array<{ nodeId: string; distanceKm: number; traversal: TraversalEdgeV3[] }> = [
    { nodeId: startNodeId, distanceKm: 0, traversal: [] },
  ];
  const seen = new Set<string>();

  while (pending.length > 0) {
    const current = pending.sort((a, b) => a.distanceKm - b.distanceKm).shift();
    if (!current) break;
    if (seen.has(current.nodeId)) continue;
    seen.add(current.nodeId);

    for (const edge of adjacency.get(current.nodeId) ?? []) {
      const nextDistanceKm = current.distanceKm + Math.max(0, edge.edge.lengthKm);
      if (nextDistanceKm + 0.000001 >= (bestDistances.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      const traversal = [...current.traversal, edge];
      if (intent.constraints.targetComponents.includes(edge.kind) && edge.surface !== 'paved') return traversal;
      bestDistances.set(edge.to, nextDistanceKm);
      pending.push({ nodeId: edge.to, distanceKm: nextDistanceKm, traversal });
    }
  }

  return [];
}

function scoreNextEdge(
  edge: TraversalEdgeV3,
  state: GraphCandidateStateV3,
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
): number {
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const requestedDwellKm = requestedNaturalDwellKm(intent, mission);
  const nextDistanceKm = state.distanceKm + Math.max(0, edge.edge.lengthKm);
  const isTarget = intent.constraints.targetComponents.includes(edge.kind);
  const usedCount = state.usedEdgeCounts.get(edge.edge.id) ?? 0;
  let score = edge.edge.score ?? 0;

  if (edge.to === startNodeId && state.enteredTarget && nextDistanceKm >= targetDistanceKm * 0.7) score += 10;
  if (edge.to === startNodeId && state.enteredTarget && nextDistanceKm < targetDistanceKm * 0.7 && state.naturalDwellKm < requestedDwellKm) score -= 20;
  if (!state.enteredTarget && isTarget) score += 6;
  if (state.enteredTarget && state.naturalDwellKm < requestedDwellKm && isTarget && edge.surface !== 'paved') score += 18;
  if (state.enteredTarget && state.naturalDwellKm >= requestedDwellKm && edge.to === startNodeId) score += 4;
  if (edge.surface === 'natural') score += 2;
  if (edge.surface === 'paved') score -= 1.5;
  if (usedCount > 0) score -= 3 + usedCount * 2;
  if (options.mode === 'forest_loop' && edge.kind === 'forest' && edge.surface === 'natural') score += 3;
  if (options.mode === 'park_loop' && edge.kind === 'park') score += 3;
  if (options.mode === 'transition_to_woods' && !state.enteredTarget && edge.surface === 'paved' && edge.kind === 'residential') score += 1;

  const distanceAfterEdgeError = Math.abs(targetDistanceKm - nextDistanceKm) / targetDistanceKm;
  score -= distanceAfterEdgeError;
  if (nextDistanceKm > targetDistanceKm && edge.to !== startNodeId) score -= 2;
  return score;
}

function scorePartialCandidate(
  state: GraphCandidateStateV3,
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
): number {
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const distanceScore = 1 - Math.abs(targetDistanceKm - state.distanceKm) / targetDistanceKm;
  let score = distanceScore;
  if (state.enteredTarget) score += 4;
  score += Math.min(1, state.naturalDwellKm / Math.max(0.001, requestedNaturalDwellKm(intent, mission))) * 3;
  if (state.current === startNodeId && state.traversal.length > 0) score += 3;
  if (options.mode === 'transition_to_woods' && state.enteredTarget) score += 1;
  score -= repeatKm(state) / Math.max(0.001, state.distanceKm) * 3;
  return score;
}

function scoreCompleteCandidate(
  state: GraphCandidateStateV3,
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
): number {
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const requestedDwellKm = requestedNaturalDwellKm(intent, mission);
  const inDistanceBand = state.distanceKm >= targetDistanceKm * 0.7 && state.distanceKm <= targetDistanceKm * 1.15;
  const returned = state.current === startNodeId && state.traversal.length > 0;
  const dwellSatisfied = state.naturalDwellKm + 0.001 >= requestedDwellKm;
  let score = scorePartialCandidate(state, startNodeId, intent, mission, options);
  if (returned) score += 20;
  if (inDistanceBand) score += 15;
  if (dwellSatisfied) score += 10;
  if (!state.enteredTarget) score -= 50;
  if (!returned) score -= 30;
  if (state.distanceKm < targetDistanceKm * 0.7) score -= 20;
  if (state.distanceKm < targetDistanceKm) score -= (targetDistanceKm - state.distanceKm) / targetDistanceKm;
  score -= repeatKm(state) / Math.max(0.001, state.distanceKm) * 5;
  return score;
}

function scoreProgressCandidate(
  state: GraphCandidateStateV3,
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
): number {
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const requestedDwellKm = requestedNaturalDwellKm(intent, mission);
  const distanceProgress = Math.min(1, state.distanceKm / Math.max(0.001, targetDistanceKm));
  const dwellProgress = Math.min(1, state.naturalDwellKm / Math.max(0.001, requestedDwellKm));
  let score = scorePartialCandidate(state, startNodeId, intent, mission, options);
  score += distanceProgress * 10;
  score += dwellProgress * 20;
  if (state.enteredTarget) score += 5;
  if (state.current === startNodeId && state.distanceKm < targetDistanceKm * 0.7) {
    score -= state.naturalDwellKm < requestedDwellKm ? 30 : 8;
  }
  score -= pavedKm(state) / Math.max(0.001, state.distanceKm) * 20;
  score -= repeatKm(state) / Math.max(0.001, state.distanceKm) * 5;
  return score;
}

function pavedKm(state: GraphCandidateStateV3): number {
  return state.traversal.reduce((total, edge) => total + (edge.surface === 'paved' ? Math.max(0, edge.edge.lengthKm) : 0), 0);
}

function repeatKm(state: GraphCandidateStateV3): number {
  const firstLengths = new Map<string, number>();
  let repeatedKm = 0;
  for (const edge of state.traversal) {
    if (firstLengths.has(edge.edge.id)) repeatedKm += Math.max(0, edge.edge.lengthKm);
    firstLengths.set(edge.edge.id, Math.max(0, edge.edge.lengthKm));
  }
  return repeatedKm;
}

function requestedNaturalDwellKm(intent: RouteIntentV3, mission: CorridorMissionV3): number {
  return Math.max(mission.requestedNaturalDwellKm, intent.constraints.targetDistanceKm * intent.constraints.minNaturalDwellRatio);
}

function buildAdjacency(graph: EnrichedGraph): Map<string, TraversalEdgeV3[]> {
  const adjacency = new Map<string, TraversalEdgeV3[]>();
  for (const edge of Array.from(graph.edges.values())) {
    const surface = classifySurface(edge);
    const kind = classifyComponentKind(edge, surface);
    pushAdjacency(adjacency, edge.from, { edge, from: edge.from, to: edge.to, kind, surface });
    pushAdjacency(adjacency, edge.to, { edge, from: edge.to, to: edge.from, kind, surface });
  }
  return adjacency;
}

function diagnoseReachableNonPavedTargets(
  startNodeId: string,
  adjacency: Map<string, TraversalEdgeV3[]>,
  intent: RouteIntentV3,
): RouteAssemblyDiagnosticsV3 {
  const distances = shortestDistancesFrom(startNodeId, adjacency);
  const reachableTargetEdgeIds = new Set<string>();
  let reachableNonPavedTargetKm = 0;
  let distanceToFirstNonPavedTargetKm: number | null = null;

  for (const edges of Array.from(adjacency.values())) {
    for (const edge of edges) {
      if (reachableTargetEdgeIds.has(edge.edge.id)) continue;
      if (!intent.constraints.targetComponents.includes(edge.kind)) continue;
      if (edge.surface === 'paved') continue;
      const fromDistance = distances.get(edge.from);
      const toDistance = distances.get(edge.to);
      const edgeDistance = Math.min(fromDistance ?? Number.POSITIVE_INFINITY, toDistance ?? Number.POSITIVE_INFINITY);
      if (!Number.isFinite(edgeDistance)) continue;
      reachableTargetEdgeIds.add(edge.edge.id);
      reachableNonPavedTargetKm += Math.max(0, edge.edge.lengthKm);
      distanceToFirstNonPavedTargetKm = Math.min(distanceToFirstNonPavedTargetKm ?? edgeDistance, edgeDistance);
    }
  }

  return {
    startNodeId,
    distanceToFirstNonPavedTargetKm: distanceToFirstNonPavedTargetKm === null ? null : round(distanceToFirstNonPavedTargetKm),
    reachableNonPavedTargetEdgeCount: reachableTargetEdgeIds.size,
    reachableNonPavedTargetKm: round(reachableNonPavedTargetKm),
  };
}

function shortestDistancesFrom(startNodeId: string, adjacency: Map<string, TraversalEdgeV3[]>): Map<string, number> {
  const distances = new Map<string, number>([[startNodeId, 0]]);
  const pending = [startNodeId];
  while (pending.length > 0) {
    const current = pending
      .sort((a, b) => (distances.get(a) ?? Number.POSITIVE_INFINITY) - (distances.get(b) ?? Number.POSITIVE_INFINITY))
      .shift();
    if (!current) break;
    const currentDistance = distances.get(current) ?? 0;
    for (const next of adjacency.get(current) ?? []) {
      const nextDistance = currentDistance + Math.max(0, next.edge.lengthKm);
      if (nextDistance + 0.000001 < (distances.get(next.to) ?? Number.POSITIVE_INFINITY)) {
        distances.set(next.to, nextDistance);
        pending.push(next.to);
      }
    }
  }
  return distances;
}

function pushAdjacency(adjacency: Map<string, TraversalEdgeV3[]>, nodeId: string, edge: TraversalEdgeV3): void {
  const edges = adjacency.get(nodeId) ?? [];
  edges.push(edge);
  adjacency.set(nodeId, edges);
}

function nodesFromTraversal(startNodeId: string, traversal: TraversalEdgeV3[]): string[] {
  return traversal.reduce<string[]>((nodeIds, edge) => [...nodeIds, edge.to], [startNodeId]);
}

function toRouteEdge(edge: TraversalEdgeV3): RouteEdgeV3 {
  return {
    id: edge.edge.id,
    from: edge.from,
    to: edge.to,
    lengthKm: round(Math.max(0, edge.edge.lengthKm)),
    surface: edge.surface,
    componentKind: edge.kind,
    highway: edge.edge.highway,
    osmWayId: edge.edge.osmWayId,
  };
}

function toGeometry(graph: EnrichedGraph, nodeIds: string[]): AssembledRouteV3['geometry'] {
  return {
    type: 'LineString',
    coordinates: nodeIds
      .map((nodeId) => graph.nodes.get(nodeId))
      .filter((node): node is GraphNode => Boolean(node))
      .map((node) => [node.lng, node.lat]),
  };
}

function closestNodeId(graph: EnrichedGraph, coordinate: { lat: number; lng: number }): string | null {
  let best: { id: string; distanceSq: number } | null = null;
  for (const node of Array.from(graph.nodes.values())) {
    const distanceSq = (node.lat - coordinate.lat) ** 2 + (node.lng - coordinate.lng) ** 2;
    if (!best || distanceSq < best.distanceSq) best = { id: node.id, distanceSq };
  }
  return best?.id ?? null;
}

function classifySurface(edge: EnrichedEdge): RouteSurfaceV3 {
  const surface = edge.surface?.toLowerCase();
  if (surface && PAVED_SURFACES.has(surface)) return 'paved';
  if (surface && NATURAL_SURFACES.has(surface)) return 'natural';
  return 'mixed';
}

function classifyComponentKind(edge: EnrichedEdge, surface: RouteSurfaceV3): TerrainComponentKindV3 {
  const landcover = edge.terrainContext?.landcoverClass;
  const highway = edge.highway.toLowerCase();

  if (surface === 'paved' && edge.scenic && ROAD_LIKE_HIGHWAYS.has(highway)) return 'scenic_paved';
  if (landcover === 'forest') return 'forest';
  if (landcover === 'park') return 'park';
  if (landcover === 'water_corridor') return 'river_corridor';
  if (landcover === 'urban') return edge.scenic ? 'urban_green' : 'residential';
  if (surface === 'paved' && edge.scenic) return 'scenic_paved';
  if (surface === 'natural' && PATH_LIKE_HIGHWAYS.has(highway)) return edge.scenic ? 'forest' : 'field_paths';
  if (edge.scenic) return 'urban_green';
  if (ROAD_LIKE_HIGHWAYS.has(highway)) return 'residential';
  return 'field_paths';
}

function emptyGraphRoute(intent: RouteIntentV3, mission: CorridorMissionV3, warning: string): AssembledRouteV3 {
  return {
    engine: 'v3-clean-room',
    strategy: intent.strategy,
    mission: cloneMission(mission),
    segments: [],
    edges: [],
    nodeIds: [],
    geometry: { type: 'LineString', coordinates: [] },
    surfaces: { pavedKm: 0, nonPavedKm: 0, naturalDwellKm: 0 },
    metrics: createEmptyRouteMetricsV3(intent.constraints.targetDistanceKm),
    warnings: [...mission.warnings, warning],
  };
}

function cloneMission(mission: CorridorMissionV3): CorridorMissionV3 {
  return {
    ...mission,
    targetComponents: [...mission.targetComponents],
    anchor: mission.anchor ? { ...mission.anchor } : null,
    warnings: [...mission.warnings],
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
