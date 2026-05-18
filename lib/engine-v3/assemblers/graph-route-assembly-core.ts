import type { EnrichedEdge, EnrichedGraph, GraphNode } from '../../types';
import { computeRouteMetricsV3, createEmptyRouteMetricsV3 } from '../route-metrics';
import type {
  AssembledRouteV3,
  CorridorMissionV3,
  RouteAssemblyFinalCandidateDiagnosticsV3,
  RouteAssemblyDiagnosticsV3,
  RouteAssemblyFrontierStepDiagnosticsV3,
  RouteAssemblyTargetComponentCandidateDiagnosticsV3,
  RouteAssemblyTargetComponentHandoffDiagnosticsV3,
  RouteEdgeV3,
  RouteIntentV3,
  RouteSurfaceV3,
  TerrainComponentKindV3,
} from '../types';
import { buildTargetComponentTraversal } from './target-component-traversal';

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
  const search = assembleGraphCandidates(startNodeId, intent, mission, graph, adjacency, options);
  assemblyDiagnostics.frontierTrace = search.frontierTrace;
  if (search.targetComponentHandoff) assemblyDiagnostics.targetComponentHandoff = search.targetComponentHandoff;
  const candidates = search.candidates;
  const selection = selectBestCandidate(candidates, startNodeId, intent, mission, options);
  assemblyDiagnostics.topFinalCandidates = finalCandidateDiagnostics(
    candidates,
    selection.selectionPool,
    selection.selected,
    startNodeId,
    intent,
    mission,
    options,
  );
  const traversal = selection.selected?.traversal ?? null;
  if (!traversal || traversal.length === 0) {
    const warning = candidates.length > 0
      ? 'graph assembly found no product-valid route candidate'
      : 'graph assembly could not traverse routeable edges';
    const emptyRoute = emptyGraphRoute(intent, mission, warning);
    emptyRoute.assemblyDiagnostics = assemblyDiagnostics;
    return emptyRoute;
  }

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
  graph: EnrichedGraph,
  adjacency: Map<string, TraversalEdgeV3[]>,
  options: GraphAssemblyOptionsV3,
): {
  candidates: GraphCandidateStateV3[];
  frontierTrace: RouteAssemblyFrontierStepDiagnosticsV3[];
  targetComponentHandoff?: RouteAssemblyTargetComponentHandoffDiagnosticsV3;
} {
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const maxDistanceKm = targetDistanceKm * 1.15;
  const beamWidth = 64;
  const maxSteps = maxTraversalSteps(targetDistanceKm);
  const initialTraversals = traversalsToNonPavedTargetSeeds(startNodeId, adjacency, intent, mission, options);
  let frontier: GraphCandidateStateV3[] = options.mode === 'transition_to_woods' && initialTraversals.length > 0
    ? uniqueByCandidateKey(initialTraversals.map((traversal) => stateFromTraversal(startNodeId, traversal, intent)))
    : [
        { current: startNodeId, traversal: [], usedEdgeCounts: new Map(), distanceKm: 0, naturalDwellKm: 0, enteredTarget: false },
      ];
  if (options.mode !== 'transition_to_woods') {
    for (const traversal of initialTraversals) {
      if (traversal.length > 0) frontier.push(stateFromTraversal(startNodeId, traversal, intent));
    }
    frontier = uniqueByCandidateKey(frontier);
  }
  const candidates: GraphCandidateStateV3[] = [];
  const frontierTrace: RouteAssemblyFrontierStepDiagnosticsV3[] = [];

  for (let step = 0; step < maxSteps && frontier.length > 0; step += 1) {
    const expanded: GraphCandidateStateV3[] = [];

    for (const state of frontier) {
      if (state.traversal.length > 0 && state.current === startNodeId && state.enteredTarget) candidates.push(state);
      if (state.distanceKm >= maxDistanceKm) continue;

      const nextEdges = orderExpansionCandidates(adjacency.get(state.current) ?? [], state, startNodeId, intent, mission, options, adjacency).filter((next) => {
        const nextDistanceKm = state.distanceKm + Math.max(0, next.edge.lengthKm);
        return nextDistanceKm <= maxDistanceKm + 0.001 && canTraverse(next, state, startNodeId, intent, mission, options);
      });
      if (nextEdges.length === 0 && state.traversal.length > 0 && state.enteredTarget) candidates.push(state);

      for (const next of nextEdges) {
        expanded.push(advanceState(state, next, intent));
      }
    }

    frontier = pruneFrontier(expanded, beamWidth, startNodeId, intent, mission, options);
    frontierTrace.push(frontierDiagnosticsStep(step, frontier, candidates, startNodeId, intent, mission, options));
  }

  for (const state of frontier) {
    if (state.traversal.length > 0 && state.current === startNodeId && state.enteredTarget) candidates.push(state);
  }

  const primitiveSearch = buildTargetTraversalCandidates(startNodeId, intent, mission, graph, adjacency, options);
  const primitiveCandidates = primitiveSearch.candidates;
  const closureCandidates = recoverCleanClosures([...candidates, ...primitiveCandidates, ...frontier], adjacency, startNodeId, intent, mission, options, maxDistanceKm);
  const allCandidates = uniqueByCandidateKey([...candidates, ...primitiveCandidates, ...closureCandidates, ...frontier]);

  return { candidates: allCandidates, frontierTrace, targetComponentHandoff: primitiveSearch.handoff };
}

function buildTargetTraversalCandidates(
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  graph: EnrichedGraph,
  adjacency: Map<string, TraversalEdgeV3[]>,
  options: GraphAssemblyOptionsV3,
): { candidates: GraphCandidateStateV3[]; handoff?: RouteAssemblyTargetComponentHandoffDiagnosticsV3 } {
  if (options.mode !== 'transition_to_woods') return { candidates: [] };
  const initialTraversals = traversalsToNonPavedTargetSeeds(startNodeId, adjacency, intent, mission, options).slice(0, 24);
  const states: GraphCandidateStateV3[] = [];
  const componentCandidates: RouteAssemblyTargetComponentCandidateDiagnosticsV3[] = [];

  for (let index = 0; index < initialTraversals.length; index += 1) {
    const initialTraversal = initialTraversals[index];
    const firstTargetIndex = initialTraversal.findIndex((edge) => intent.constraints.targetComponents.includes(edge.kind) && edge.surface !== 'paved');
    if (firstTargetIndex < 0) continue;
    const prefix = initialTraversal.slice(0, firstTargetIndex);
    const entryNodeId = initialTraversal[firstTargetIndex].from;
    const inputStats = targetTraversalInputStats(entryNodeId, adjacency, intent);
    const primitive = buildTargetComponentTraversal({
      graph,
      startNodeId,
      entryNodeId,
      targetComponentIds: intent.constraints.targetComponents,
      targetDistanceKm: intent.constraints.targetDistanceKm,
      minDistanceRatio: 0.7,
      maxDistanceRatio: 1.15,
      usedEdgeKeys: new Set(prefix.map((edge) => edge.edge.id)),
      forbidTargetRepeat: true,
    });
    componentCandidates.push(targetComponentCandidateDiagnostics(
      index + 1,
      entryNodeId,
      prefix,
      inputStats,
      intent,
      primitive,
    ));
    if (primitive.status !== 'success') continue;
    const primitiveTraversal = traversalFromNodeAndEdgeIds(entryNodeId, primitive.nodeIds, primitive.edgeIds, adjacency);
    if (primitiveTraversal.length === 0) continue;
    states.push(stateFromTraversal(startNodeId, [...prefix, ...primitiveTraversal], intent));
  }

  const handoff: RouteAssemblyTargetComponentHandoffDiagnosticsV3 = {
    selectedTargetComponentIds: [...intent.constraints.targetComponents],
    targetComponentKinds: [...intent.constraints.targetComponents],
    componentCandidateCount: componentCandidates.length,
    componentCandidates: componentCandidates.slice(0, 24),
    blocker: targetComponentHandoffBlocker(componentCandidates, states),
  };

  return { candidates: uniqueByCandidateKey(states), handoff };
}

function targetComponentCandidateDiagnostics(
  rank: number,
  entryNodeId: string,
  prefix: TraversalEdgeV3[],
  inputStats: { nodeCount: number; edgeCount: number },
  intent: RouteIntentV3,
  primitive: ReturnType<typeof buildTargetComponentTraversal>,
): RouteAssemblyTargetComponentCandidateDiagnosticsV3 {
  const success = primitive.status === 'success' ? primitive : null;
  return {
    rank,
    entryNodeId,
    entryDistanceKm: round(prefix.reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0)),
    targetComponentKinds: [...intent.constraints.targetComponents],
    reachableTargetKm: primitive.diagnostics.reachableTargetKm,
    cleanExploitableKm: primitive.diagnostics.exploitableTargetKm,
    traversalInputNodeCount: inputStats.nodeCount,
    traversalInputEdgeCount: inputStats.edgeCount,
    traversalResult: {
      status: primitive.status,
      distanceKm: success?.distanceKm ?? primitive.diagnostics.bestPartialDistanceKm,
      targetKm: success?.targetKm ?? 0,
      repeatedTargetKm: success?.repeatedTargetKm ?? 0,
      blocker: primitive.status === 'failure' ? primitive.diagnostics.blocker : null,
    },
    closureAttempt: success
      ? {
          status: success.closure.edgeIds.length > 0 ? 'success' : 'failure',
          closureDistanceKm: success.closure.distanceKm,
          connectorRepeatKm: success.closure.connectorRepeatKm,
          targetRepeatKm: success.closure.targetRepeatKm,
        }
      : {
          status: primitive.diagnostics.blocker === 'no_clean_closure' ? 'failure' : 'not_attempted',
          closureDistanceKm: 0,
          connectorRepeatKm: 0,
          targetRepeatKm: 0,
        },
  };
}

function targetTraversalInputStats(
  entryNodeId: string,
  adjacency: Map<string, TraversalEdgeV3[]>,
  intent: RouteIntentV3,
): { nodeCount: number; edgeCount: number } {
  const pending = [entryNodeId];
  const seenNodes = new Set<string>();
  const seenEdges = new Set<string>();

  while (pending.length > 0 && seenNodes.size < 5000) {
    const current = pending.shift();
    if (!current || seenNodes.has(current)) continue;
    seenNodes.add(current);
    for (const edge of adjacency.get(current) ?? []) {
      if (!intent.constraints.targetComponents.includes(edge.kind) || edge.surface === 'paved') continue;
      seenEdges.add(edge.edge.id);
      if (!seenNodes.has(edge.to)) pending.push(edge.to);
    }
  }

  return { nodeCount: seenNodes.size, edgeCount: seenEdges.size };
}

function targetComponentHandoffBlocker(
  componentCandidates: RouteAssemblyTargetComponentCandidateDiagnosticsV3[],
  successfulStates: GraphCandidateStateV3[],
): string | null {
  if (componentCandidates.length === 0) return 'no_target_component_candidates';
  if (successfulStates.length === 0) return componentCandidates[0]?.traversalResult.blocker ?? 'no_successful_target_component_traversal';
  return null;
}

function traversalFromNodeAndEdgeIds(
  entryNodeId: string,
  nodeIds: string[],
  edgeIds: string[],
  adjacency: Map<string, TraversalEdgeV3[]>,
): TraversalEdgeV3[] {
  const nodes = nodeIds.length === edgeIds.length + 1 ? nodeIds : [entryNodeId, ...nodeIds.slice(1)];
  const traversal: TraversalEdgeV3[] = [];
  for (let index = 0; index < edgeIds.length; index += 1) {
    const from = nodes[index];
    const to = nodes[index + 1];
    const edge = (adjacency.get(from) ?? []).find((candidate) => candidate.edge.id === edgeIds[index] && candidate.to === to);
    if (!edge) return [];
    traversal.push(edge);
  }
  return traversal;
}

function recoverCleanClosures(
  candidates: GraphCandidateStateV3[],
  adjacency: Map<string, TraversalEdgeV3[]>,
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
  maxDistanceKm: number,
): GraphCandidateStateV3[] {
  const requestedDwellKm = requestedNaturalDwellKm(intent, mission);
  const minDistanceKm = intent.constraints.targetDistanceKm * 0.55;
  const closureSeeds = uniqueByCandidateKey(candidates)
    .filter((candidate) =>
      candidate.current !== startNodeId &&
      candidate.enteredTarget &&
      candidate.distanceKm >= minDistanceKm &&
      (!options.requireNaturalDwell || candidate.naturalDwellKm + 0.001 >= requestedDwellKm),
    )
    .sort((a, b) => scoreProgressCandidate(b, startNodeId, intent, mission, options) - scoreProgressCandidate(a, startNodeId, intent, mission, options))
    .slice(0, 48);

  const recovered: GraphCandidateStateV3[] = [];
  for (const candidate of closureSeeds) {
    const maxAdditionalKm = maxDistanceKm - candidate.distanceKm;
    if (maxAdditionalKm <= 0) continue;
    const returnTraversal = shortestCleanReturnTraversal(candidate, adjacency, startNodeId, intent, maxAdditionalKm);
    if (returnTraversal.length === 0) continue;
    let closed = candidate;
    for (const edge of returnTraversal) closed = advanceState(closed, edge, intent);
    recovered.push(closed);
  }
  return recovered;
}

function shortestCleanReturnTraversal(
  seed: GraphCandidateStateV3,
  adjacency: Map<string, TraversalEdgeV3[]>,
  startNodeId: string,
  intent: RouteIntentV3,
  maxAdditionalKm: number,
): TraversalEdgeV3[] {
  const bestCosts = new Map<string, number>([[seed.current, 0]]);
  const pending: Array<{ nodeId: string; distanceKm: number; cost: number; traversal: TraversalEdgeV3[]; usedEdgeCounts: Map<string, number> }> = [
    { nodeId: seed.current, distanceKm: 0, cost: 0, traversal: [], usedEdgeCounts: new Map(seed.usedEdgeCounts) },
  ];

  while (pending.length > 0) {
    const current = pending.sort((a, b) => a.cost - b.cost || a.distanceKm - b.distanceKm).shift();
    if (!current) break;
    if (current.nodeId === startNodeId && current.traversal.length > 0) return current.traversal;
    if (current.cost > (bestCosts.get(current.nodeId) ?? Number.POSITIVE_INFINITY) + 0.000001) continue;

    for (const edge of adjacency.get(current.nodeId) ?? []) {
      const edgeLengthKm = Math.max(0, edge.edge.lengthKm);
      const nextDistanceKm = current.distanceKm + edgeLengthKm;
      if (nextDistanceKm > maxAdditionalKm + 0.001) continue;
      if (!canAppendCleanReturnEdge(edge, seed, current.usedEdgeCounts, intent, startNodeId)) continue;
      const repeatPenaltyKm = (current.usedEdgeCounts.get(edge.edge.id) ?? 0) > 0 ? Math.max(0.5, edgeLengthKm * 4) : 0;
      const nextCost = current.cost + edgeLengthKm + repeatPenaltyKm;
      if (nextCost + 0.000001 >= (bestCosts.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      const usedEdgeCounts = new Map(current.usedEdgeCounts);
      usedEdgeCounts.set(edge.edge.id, (usedEdgeCounts.get(edge.edge.id) ?? 0) + 1);
      bestCosts.set(edge.to, nextCost);
      pending.push({ nodeId: edge.to, distanceKm: nextDistanceKm, cost: nextCost, traversal: [...current.traversal, edge], usedEdgeCounts });
    }
  }

  return [];
}

function canAppendCleanReturnEdge(
  edge: TraversalEdgeV3,
  seed: GraphCandidateStateV3,
  usedEdgeCounts: Map<string, number>,
  intent: RouteIntentV3,
  startNodeId: string,
): boolean {
  const usedCount = usedEdgeCounts.get(edge.edge.id) ?? 0;
  if (usedCount >= 2) return false;
  if (isTraversedTargetPair(edge, seed, intent)) return false;
  if (intent.constraints.targetComponents.includes(edge.kind) && usedCount > 0) return false;
  if (!intent.constraints.targetComponents.includes(edge.kind) && usedCount > 0 && edge.to !== startNodeId) return false;
  return true;
}

function frontierDiagnosticsStep(
  step: number,
  frontier: GraphCandidateStateV3[],
  returnedCandidates: GraphCandidateStateV3[],
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
): RouteAssemblyFrontierStepDiagnosticsV3 {
  const bestReturned = [...returnedCandidates].sort(
    (a, b) => scoreCompleteCandidate(b, startNodeId, intent, mission, options) - scoreCompleteCandidate(a, startNodeId, intent, mission, options),
  )[0];

  return {
    step,
    frontierSize: frontier.length,
    maxDistanceKm: round(Math.max(0, ...frontier.map((candidate) => candidate.distanceKm))),
    maxNaturalDwellKm: round(Math.max(0, ...frontier.map((candidate) => candidate.naturalDwellKm))),
    bestReturnedDistanceKm: bestReturned ? round(bestReturned.distanceKm) : null,
    bestReturnedNaturalDwellKm: bestReturned ? round(bestReturned.naturalDwellKm) : null,
    countEnteredTarget: frontier.filter((candidate) => candidate.enteredTarget).length,
    countReturned: returnedCandidates.length,
    topCandidateIds: [...frontier]
      .sort((a, b) => scoreProgressCandidate(b, startNodeId, intent, mission, options) - scoreProgressCandidate(a, startNodeId, intent, mission, options))
      .slice(0, 8)
      .map((candidate, rank) => candidateDiagnosticId(candidate, step, rank)),
  };
}

function candidateDiagnosticId(state: GraphCandidateStateV3, step: number, rank: number): string {
  const firstEdge = state.traversal[0]?.edge.id ?? 'start';
  const lastEdge = state.traversal.at(-1)?.edge.id ?? 'start';
  return `step${step}-rank${rank}:${state.current}:${state.traversal.length}:${firstEdge}>${lastEdge}`;
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
): { selected: GraphCandidateStateV3 | null; selectionPool: GraphCandidateStateV3[] } {
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
  const productValidCandidates = options.requireNaturalDwell ? viableReturnedWithDwell : viableReturnedCandidates;
  if (productValidCandidates.length === 0) {
    return { selected: null, selectionPool: candidates };
  }

  const repeatAwarePool = preferLowRepeatCandidates(productValidCandidates, true, intent, mission);
  const selected = [...repeatAwarePool].sort(
    (a, b) => scoreCompleteCandidate(b, startNodeId, intent, mission, options) - scoreCompleteCandidate(a, startNodeId, intent, mission, options),
  )[0];
  return { selected: selected ?? null, selectionPool: repeatAwarePool };
}

function finalCandidateDiagnostics(
  candidates: GraphCandidateStateV3[],
  selectionPool: GraphCandidateStateV3[],
  selected: GraphCandidateStateV3 | null,
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
): RouteAssemblyFinalCandidateDiagnosticsV3[] {
  const selectionKeys = new Set(selectionPool.map(candidateKey));
  const selectedKey = selected ? candidateKey(selected) : null;
  const uniqueCandidates = uniqueByCandidateKey(candidates);
  const sorted = uniqueCandidates.sort((a, b) => {
    const aSelected = selectedKey !== null && candidateKey(a) === selectedKey ? 1 : 0;
    const bSelected = selectedKey !== null && candidateKey(b) === selectedKey ? 1 : 0;
    if (aSelected !== bSelected) return bSelected - aSelected;

    const aInPool = selectionKeys.has(candidateKey(a)) ? 1 : 0;
    const bInPool = selectionKeys.has(candidateKey(b)) ? 1 : 0;
    if (aInPool !== bInPool) return bInPool - aInPool;

    return scoreCompleteCandidate(b, startNodeId, intent, mission, options) - scoreCompleteCandidate(a, startNodeId, intent, mission, options);
  });

  return sorted.slice(0, 12).map((candidate, index) => {
    const key = candidateKey(candidate);
    return {
      id: finalCandidateDiagnosticId(candidate, index + 1),
      rank: index + 1,
      selected: selectedKey !== null && key === selectedKey,
      inSelectionPool: selectionKeys.has(key),
      distanceKm: round(candidate.distanceKm),
      naturalDwellKm: round(candidate.naturalDwellKm),
      pavedKm: round(pavedKm(candidate)),
      repeatKm: round(repeatKm(candidate)),
      targetRepeatKm: round(targetRepeatKm(candidate, intent)),
      connectorRepeatKm: round(connectorRepeatKm(candidate, intent)),
      returned: candidate.current === startNodeId && candidate.traversal.length > 0,
      scoreComplete: round(scoreCompleteCandidate(candidate, startNodeId, intent, mission, options)),
      scoreProgress: round(scoreProgressCandidate(candidate, startNodeId, intent, mission, options)),
    };
  });
}

function uniqueByCandidateKey(candidates: GraphCandidateStateV3[]): GraphCandidateStateV3[] {
  const seen = new Set<string>();
  const unique: GraphCandidateStateV3[] = [];
  for (const candidate of candidates) {
    const key = candidateKey(candidate);
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(candidate);
  }
  return unique;
}

function finalCandidateDiagnosticId(state: GraphCandidateStateV3, rank: number): string {
  const keyHash = hashString(candidateKey(state));
  const firstEdge = state.traversal[0]?.edge.id ?? 'start';
  const lastEdge = state.traversal.at(-1)?.edge.id ?? 'start';
  return `final-rank${rank}-${keyHash}:${state.current}:${state.traversal.length}:${firstEdge}>${lastEdge}`;
}

function hashString(value: string): string {
  let hash = 0;
  for (let index = 0; index < value.length; index += 1) {
    hash = (hash * 31 + value.charCodeAt(index)) >>> 0;
  }
  return hash.toString(36);
}

function preferLowRepeatCandidates(
  candidates: GraphCandidateStateV3[],
  requireGeneratedQuality: boolean,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
): GraphCandidateStateV3[] {
  if (!requireGeneratedQuality || candidates.length <= 1) return candidates;

  const requestedDwellKm = requestedNaturalDwellKm(intent, mission);
  const bestNaturalDwellKm = Math.max(...candidates.map((candidate) => candidate.naturalDwellKm));
  const minProtectedNaturalDwellKm = Math.max(requestedDwellKm, bestNaturalDwellKm * 0.85);
  const maxPavedRatio = Math.min(0.5, intent.constraints.maxPavedRatio + 0.05);
  const terrainSafeCandidates = candidates.filter(
    (candidate) =>
      candidate.naturalDwellKm + 0.001 >= minProtectedNaturalDwellKm &&
      candidate.distanceKm >= intent.constraints.targetDistanceKm * 0.7 &&
      pavedKm(candidate) / Math.max(0.001, candidate.distanceKm) <= maxPavedRatio,
  );
  if (terrainSafeCandidates.length === 0) return candidates;

  const generatedQuality = terrainSafeCandidates.filter((candidate) => damagingRepeatRatio(candidate, intent) <= 0.2 + 0.001);
  if (generatedQuality.length > 0) return generatedQuality;

  const sortedByRepeat = [...terrainSafeCandidates].sort((a, b) => damagingRepeatRatio(a, intent) - damagingRepeatRatio(b, intent));
  const bestRepeatRatio = damagingRepeatRatio(sortedByRepeat[0], intent);
  return sortedByRepeat.filter((candidate) => damagingRepeatRatio(candidate, intent) <= bestRepeatRatio + 0.03);
}

function orderExpansionCandidates(
  candidates: TraversalEdgeV3[],
  state: GraphCandidateStateV3,
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
  adjacency: Map<string, TraversalEdgeV3[]>,
): TraversalEdgeV3[] {
  return [...candidates].sort(
    (a, b) => scoreNextEdge(b, state, startNodeId, intent, mission, options, adjacency) - scoreNextEdge(a, state, startNodeId, intent, mission, options, adjacency),
  );
}

function canTraverse(
  edge: TraversalEdgeV3,
  state: GraphCandidateStateV3,
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
): boolean {
  const usedCount = state.usedEdgeCounts.get(edge.edge.id) ?? 0;
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const requestedDwellKm = requestedNaturalDwellKm(intent, mission);
  if (
    options.mode === 'transition_to_woods' &&
    edge.to === startNodeId &&
    state.enteredTarget &&
    state.naturalDwellKm + 0.001 < requestedDwellKm
  ) {
    return false;
  }
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
  if (isTraversedTargetPair(edge, state, intent)) return false;
  if (isImmediateTargetBacktrack(edge, state, intent)) return false;
  if (usedCount > 0 && !shouldAllowRepeat(edge, state, startNodeId, intent, mission)) return false;
  if (state.traversal.length === 0 && edge.to === startNodeId) return false;
  return true;
}

function isTraversedTargetPair(edge: TraversalEdgeV3, state: GraphCandidateStateV3, intent: RouteIntentV3): boolean {
  if (!intent.constraints.targetComponents.includes(edge.kind)) return false;
  const pairKey = undirectedPairKey(edge);
  return state.traversal.some(
    (previous) => intent.constraints.targetComponents.includes(previous.kind) && undirectedPairKey(previous) === pairKey,
  );
}

function isImmediateTargetBacktrack(edge: TraversalEdgeV3, state: GraphCandidateStateV3, intent: RouteIntentV3): boolean {
  if (!intent.constraints.targetComponents.includes(edge.kind)) return false;
  const previous = state.traversal.at(-1);
  if (!previous || !intent.constraints.targetComponents.includes(previous.kind)) return false;
  return previous.from === edge.to && previous.to === edge.from;
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
  if (intent.constraints.targetComponents.includes(edge.kind)) return false;
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

interface InitialTargetSeedV3 {
  distanceKm: number;
  traversal: TraversalEdgeV3[];
  capacityKm: number;
  natural: boolean;
}

function traversalsToNonPavedTargetSeeds(
  startNodeId: string,
  adjacency: Map<string, TraversalEdgeV3[]>,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
): TraversalEdgeV3[][] {
  const targetCandidates = initialNonPavedTargetCandidates(startNodeId, adjacency, intent);
  const requestedDwellKm = requestedNaturalDwellKm(intent, mission);
  const viableNatural = targetCandidates.filter((candidate) => candidate.natural && candidate.capacityKm + 0.001 >= requestedDwellKm);
  const viableAnySurface = targetCandidates.filter((candidate) => candidate.capacityKm + 0.001 >= requestedDwellKm);
  const fallbackNatural = targetCandidates.filter((candidate) => candidate.natural);
  const pool = viableNatural.length > 0 ? viableNatural : viableAnySurface.length > 0 ? viableAnySurface : fallbackNatural.length > 0 ? fallbackNatural : targetCandidates;
  const nearestViableTarget = [...pool].sort((a, b) => a.distanceKm - b.distanceKm || b.capacityKm - a.capacityKm)[0];
  if (!nearestViableTarget) return [];
  if (options.mode !== 'transition_to_woods') return [nearestViableTarget.traversal];

  const reasonableAccessDistanceKm = Math.max(0.75, Math.min(3, intent.constraints.targetDistanceKm * 0.25));
  const highCapacitySeeds = [...pool]
    .filter((candidate) => candidate.distanceKm <= reasonableAccessDistanceKm + 0.001)
    .sort((a, b) => b.capacityKm - a.capacityKm || b.distanceKm - a.distanceKm)
    .slice(0, 48);
  const desiredRecoveryDistanceKm = intent.constraints.targetDistanceKm * 0.65;
  const maxRecoverySeedDistanceKm = intent.constraints.targetDistanceKm * 0.95;
  const distanceRecoverySeeds = [...targetCandidates]
    .filter((candidate) => candidate.distanceKm <= maxRecoverySeedDistanceKm + 0.001)
    .sort(
      (a, b) =>
        Math.abs(a.distanceKm - desiredRecoveryDistanceKm) - Math.abs(b.distanceKm - desiredRecoveryDistanceKm) ||
        b.capacityKm - a.capacityKm,
    )
    .slice(0, 64);

  return dedupeTraversals([nearestViableTarget, ...highCapacitySeeds, ...distanceRecoverySeeds].map((candidate) => candidate.traversal)).slice(0, 96);
}

function initialNonPavedTargetCandidates(
  startNodeId: string,
  adjacency: Map<string, TraversalEdgeV3[]>,
  intent: RouteIntentV3,
): InitialTargetSeedV3[] {
  const bestDistances = new Map<string, number>([[startNodeId, 0]]);
  const pending: Array<{ nodeId: string; distanceKm: number; traversal: TraversalEdgeV3[] }> = [
    { nodeId: startNodeId, distanceKm: 0, traversal: [] },
  ];
  const targetCandidates: InitialTargetSeedV3[] = [];

  while (pending.length > 0) {
    const current = pending.sort((a, b) => a.distanceKm - b.distanceKm).shift();
    if (!current) break;
    if (current.distanceKm > (bestDistances.get(current.nodeId) ?? Number.POSITIVE_INFINITY) + 0.000001) continue;

    for (const edge of adjacency.get(current.nodeId) ?? []) {
      const nextDistanceKm = current.distanceKm + Math.max(0, edge.edge.lengthKm);
      const traversal = [...current.traversal, edge];
      if (intent.constraints.targetComponents.includes(edge.kind) && edge.surface !== 'paved') {
        targetCandidates.push({
          distanceKm: nextDistanceKm,
          traversal,
          capacityKm: reachableTargetDwellKmFrom(edge.to, edge.from, adjacency, intent),
          natural: edge.surface === 'natural',
        });
      }
      if (nextDistanceKm + 0.000001 >= (bestDistances.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      bestDistances.set(edge.to, nextDistanceKm);
      pending.push({ nodeId: edge.to, distanceKm: nextDistanceKm, traversal });
    }
  }

  return targetCandidates;
}

function dedupeTraversals(traversals: TraversalEdgeV3[][]): TraversalEdgeV3[][] {
  const seen = new Set<string>();
  const unique: TraversalEdgeV3[][] = [];
  for (const traversal of traversals) {
    const key = traversal.map((edge) => `${edge.edge.id}:${edge.from}:${edge.to}`).join('|');
    if (seen.has(key)) continue;
    seen.add(key);
    unique.push(traversal);
  }
  return unique;
}

function reachableTargetDwellKmFrom(
  nodeId: string,
  blockedReturnNodeId: string,
  adjacency: Map<string, TraversalEdgeV3[]>,
  intent: RouteIntentV3,
): number {
  const pending = [nodeId];
  const seenNodes = new Set<string>([blockedReturnNodeId]);
  const seenEdges = new Set<string>();
  let dwellKm = 0;

  while (pending.length > 0 && seenNodes.size < 2000) {
    const current = pending.shift();
    if (!current || seenNodes.has(current)) continue;
    seenNodes.add(current);
    for (const edge of adjacency.get(current) ?? []) {
      if (!intent.constraints.targetComponents.includes(edge.kind) || edge.surface === 'paved') continue;
      if (!seenEdges.has(edge.edge.id)) {
        dwellKm += edge.surface === 'mixed' ? Math.max(0, edge.edge.lengthKm) * 0.5 : Math.max(0, edge.edge.lengthKm);
        seenEdges.add(edge.edge.id);
      }
      if (!seenNodes.has(edge.to)) pending.push(edge.to);
    }
  }

  return dwellKm;
}

function scoreNextEdge(
  edge: TraversalEdgeV3,
  state: GraphCandidateStateV3,
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
  adjacency: Map<string, TraversalEdgeV3[]>,
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
  if (
    options.mode === 'transition_to_woods' &&
    isTarget &&
    edge.surface !== 'paved' &&
    state.naturalDwellKm + Math.max(0, edge.edge.lengthKm) < requestedDwellKm &&
    !hasUntraversedTargetContinuation(edge, state, intent, adjacency)
  ) {
    score -= 80;
  }
  if (state.enteredTarget && state.naturalDwellKm >= requestedDwellKm && edge.to === startNodeId) score += 4;
  if (edge.surface === 'natural') score += 2;
  if (edge.surface === 'paved') score -= 1.5;
  if (usedCount > 0) score -= 8 + usedCount * 4;
  if (options.mode === 'forest_loop' && edge.kind === 'forest' && edge.surface === 'natural') score += 3;
  if (options.mode === 'park_loop' && edge.kind === 'park') score += 3;
  if (options.mode === 'transition_to_woods' && !state.enteredTarget && edge.surface === 'paved' && edge.kind === 'residential') score += 1;

  const distanceAfterEdgeError = Math.abs(targetDistanceKm - nextDistanceKm) / targetDistanceKm;
  score -= distanceAfterEdgeError;
  if (nextDistanceKm > targetDistanceKm && edge.to !== startNodeId) score -= 2;
  return score;
}

function hasUntraversedTargetContinuation(
  edge: TraversalEdgeV3,
  state: GraphCandidateStateV3,
  intent: RouteIntentV3,
  adjacency: Map<string, TraversalEdgeV3[]>,
): boolean {
  return (adjacency.get(edge.to) ?? []).some((candidate) => {
    if (!intent.constraints.targetComponents.includes(candidate.kind) || candidate.surface === 'paved') return false;
    if (candidate.to === edge.from) return false;
    if (isTraversedTargetPair(candidate, state, intent)) return false;
    return undirectedPairKey(candidate) !== undirectedPairKey(edge);
  });
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
  score -= repeatRatio(state) * 2;
  score -= damagingRepeatRatio(state, intent) * 12;
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
  score -= repeatRatio(state) * 3;
  score -= damagingRepeatRatio(state, intent) * 20;
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
  score -= repeatRatio(state) * 2;
  score -= damagingRepeatRatio(state, intent) * 15;
  return score;
}

function pavedKm(state: GraphCandidateStateV3): number {
  return state.traversal.reduce((total, edge) => total + (edge.surface === 'paved' ? Math.max(0, edge.edge.lengthKm) : 0), 0);
}

function repeatRatio(state: GraphCandidateStateV3): number {
  return repeatKm(state) / Math.max(0.001, state.distanceKm);
}

function damagingRepeatRatio(state: GraphCandidateStateV3, intent: RouteIntentV3): number {
  return damagingRepeatKm(state, intent) / Math.max(0.001, state.distanceKm);
}

function damagingRepeatKm(state: GraphCandidateStateV3, intent: RouteIntentV3): number {
  return targetRepeatKm(state, intent);
}

function targetRepeatKm(state: GraphCandidateStateV3, intent: RouteIntentV3): number {
  const targetComponents = new Set(intent.constraints.targetComponents);
  const traversedPairs = new Set<string>();
  let repeatedKm = 0;
  for (const edge of state.traversal) {
    const pairKey = undirectedPairKey(edge);
    if (targetComponents.has(edge.kind) && traversedPairs.has(pairKey)) repeatedKm += Math.max(0, edge.edge.lengthKm);
    traversedPairs.add(pairKey);
  }
  return repeatedKm;
}

function connectorRepeatKm(state: GraphCandidateStateV3, intent: RouteIntentV3): number {
  const targetComponents = new Set(intent.constraints.targetComponents);
  const traversedPairs = new Set<string>();
  let repeatedKm = 0;
  for (const edge of state.traversal) {
    const pairKey = undirectedPairKey(edge);
    if (!targetComponents.has(edge.kind) && traversedPairs.has(pairKey)) repeatedKm += Math.max(0, edge.edge.lengthKm);
    traversedPairs.add(pairKey);
  }
  return repeatedKm;
}

function repeatKm(state: GraphCandidateStateV3): number {
  const traversedPairs = new Set<string>();
  let repeatedKm = 0;
  for (const edge of state.traversal) {
    const pairKey = undirectedPairKey(edge);
    if (traversedPairs.has(pairKey)) repeatedKm += Math.max(0, edge.edge.lengthKm);
    traversedPairs.add(pairKey);
  }
  return repeatedKm;
}

function undirectedPairKey(edge: TraversalEdgeV3): string {
  return edge.from < edge.to ? `${edge.from}::${edge.to}` : `${edge.to}::${edge.from}`;
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
