import type { EnrichedEdge, EnrichedGraph, GraphNode } from '../../types';
import { classifyEdgeSemanticsV3 } from '../edge-semantics';
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
import { solveComponentLoopV3 } from './component-loop-solver';
import type { ComponentLoopSolverDiagnosticsV3 } from './component-loop-solver';
import { buildTargetComponentTraversal } from './target-component-traversal';

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

const TARGET_COMPONENT_DETAILED_TRAVERSAL_EDGE_THRESHOLD = 2_000;

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
  Object.assign(assemblyDiagnostics, search.closureDiagnostics);
  if (search.targetComponentHandoff) assemblyDiagnostics.targetComponentHandoff = search.targetComponentHandoff;
  const timeoutDiagnostics = extractAssemblyTimeout(search.targetComponentHandoff);
  if (timeoutDiagnostics) assemblyDiagnostics.assemblyTimeout = timeoutDiagnostics;
  const candidates = search.candidates;
  const selection = selectBestCandidate(candidates, startNodeId, intent, mission, options);
  const finalDiagnostics = finalCandidateDiagnostics(
    candidates,
    selection.selectionPool,
    selection.selected,
    startNodeId,
    intent,
    mission,
    options,
    selection,
  );
  assemblyDiagnostics.topFinalCandidates = finalDiagnostics;
  applyCandidateDiversityDiagnostics(assemblyDiagnostics, candidates, finalDiagnostics, selection, startNodeId, intent);
  applyTransitionPhaseDiagnostics(assemblyDiagnostics, candidates, selection.selected, intent, mission, options);
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
  source?: string;
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
  closureDiagnostics: Pick<RouteAssemblyDiagnosticsV3, 'closureAttemptCount' | 'returnedClosureCount' | 'closureRejectedReasons' | 'recoveryExpansionKm' | 'recoveryBudgetKm'>;
} {
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const maxDistanceKm = targetDistanceKm * 1.15;
  const beamWidth = options.mode === 'transition_to_woods' ? 24 : 64;
  const maxSteps = options.mode === 'transition_to_woods'
    ? Math.min(96, maxTraversalSteps(targetDistanceKm))
    : maxTraversalSteps(targetDistanceKm);
  const initialTraversals = traversalsToNonPavedTargetSeeds(startNodeId, adjacency, intent, mission, options);
  debugAssemblyStage('initial-seeds', { count: initialTraversals.length });
  let frontier: GraphCandidateStateV3[] = options.mode === 'transition_to_woods' && initialTraversals.length > 0
    ? uniqueByCandidateKey(initialTraversals.map((traversal) => stateFromTraversal(startNodeId, traversal, intent, 'seed')))
    : [
        { current: startNodeId, traversal: [], usedEdgeCounts: new Map(), distanceKm: 0, naturalDwellKm: 0, enteredTarget: false, source: 'frontier' },
      ];
  if (options.mode !== 'transition_to_woods') {
    for (const traversal of initialTraversals) {
      if (traversal.length > 0) frontier.push(stateFromTraversal(startNodeId, traversal, intent, 'seed'));
    }
    frontier = uniqueByCandidateKey(frontier);
  }
  const candidates: GraphCandidateStateV3[] = [];
  const frontierTrace: RouteAssemblyFrontierStepDiagnosticsV3[] = [];

  for (let step = 0; step < maxSteps && frontier.length > 0; step += 1) {
    const expanded: GraphCandidateStateV3[] = [];

    for (const state of frontier) {
      if (state.traversal.length > 0 && state.current === startNodeId && state.enteredTarget) {
        candidates.push(state);
        continue;
      }
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
  debugAssemblyStage('frontier-search', { frontier: frontier.length, candidates: candidates.length, trace: frontierTrace.length });

  const primitiveSearch = buildTargetTraversalCandidates(startNodeId, intent, mission, graph, adjacency, options);
  debugAssemblyStage('primitive-search', { candidates: primitiveSearch.candidates.length, handoff: Boolean(primitiveSearch.handoff) });
  const primitiveCandidates = primitiveSearch.candidates;
  const closureSearch = recoverCleanClosures([...candidates, ...primitiveCandidates, ...frontier], adjacency, startNodeId, intent, mission, options, maxDistanceKm);
  debugAssemblyStage('closure-recovery', { candidates: closureSearch.candidates.length, attempts: closureSearch.diagnostics.closureAttemptCount });
  const closureCandidates = closureSearch.candidates;
  const allCandidates = uniqueByCandidateKey([...candidates, ...primitiveCandidates, ...closureCandidates, ...frontier]);

  return { candidates: allCandidates, frontierTrace, targetComponentHandoff: primitiveSearch.handoff, closureDiagnostics: closureSearch.diagnostics };
}

function debugAssemblyStage(stage: string, data: Record<string, unknown>): void {
  if (process.env.TRAILFORGE_V3_ASSEMBLY_DEBUG !== '1') return;
  console.error(`[engine-v3:assembly] ${stage} ${JSON.stringify(data)}`);
}

function extractAssemblyTimeout(
  handoff: RouteAssemblyTargetComponentHandoffDiagnosticsV3 | undefined,
): RouteAssemblyDiagnosticsV3['assemblyTimeout'] | undefined {
  const timeout = (handoff as unknown as {
    componentLoopSolver?: {
      orderedCycleExpansion?: {
        multiCycleDwell?: { assemblyTimeout?: RouteAssemblyDiagnosticsV3['assemblyTimeout'] };
      };
    };
  } | undefined)?.componentLoopSolver?.orderedCycleExpansion?.multiCycleDwell?.assemblyTimeout;
  return timeout ? { ...timeout } : undefined;
}

interface TargetComponentCandidateV3 {
  componentId: string;
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  reachableTargetKm: number;
  naturalTargetKm: number;
  accessTraversal: TraversalEdgeV3[];
  entryNodeId: string;
  primitive: ReturnType<typeof buildTargetComponentTraversal>;
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

  const componentCandidates = targetComponentCandidatesFromGraph(startNodeId, intent, mission, graph, adjacency);
  const rankedCandidates = rankTargetComponentCandidates(componentCandidates, intent, mission);
  const selectedCandidate = rankedCandidates[0] ?? null;
  const selectedComponentId = selectedCandidate?.componentId ?? null;
  const states: GraphCandidateStateV3[] = [];

  for (const candidate of rankedCandidates.slice(0, 12)) {
    if (candidate.primitive.status !== 'success') continue;
    const primitiveTraversal = traversalFromNodeAndEdgeIds(candidate.entryNodeId, candidate.primitive.nodeIds, candidate.primitive.edgeIds, adjacency);
    if (primitiveTraversal.length === 0) continue;
    states.push(stateFromTraversal(startNodeId, [...candidate.accessTraversal, ...primitiveTraversal], intent, 'target-component-traversal'));
  }

  const diagnosticCandidates = rankedCandidates.map((candidate, index) => targetComponentCandidateDiagnostics(
    index + 1,
    candidate,
    selectedComponentId === candidate.componentId,
    selectedComponentId === candidate.componentId ? null : targetComponentRejectionReason(candidate, selectedCandidate, mission, intent),
    intent,
  ));
  const primitiveHandoff: RouteAssemblyTargetComponentHandoffDiagnosticsV3 = {
    selectedTargetComponentIds: [...intent.constraints.targetComponents],
    targetComponentKinds: [...intent.constraints.targetComponents],
    componentCandidateCount: rankedCandidates.length,
    componentCandidates: diagnosticCandidates.slice(0, 24),
    blocker: targetComponentHandoffBlocker(diagnosticCandidates, states),
  };

  if (states.length > 0 || graph.edges.size > 500) {
    return { candidates: uniqueByCandidateKey(states), handoff: primitiveHandoff };
  }

  debugAssemblyStage('component-loop:start', { targetDistanceKm: intent.constraints.targetDistanceKm });
  const componentLoop = solveComponentLoopV3({
    graph,
    startNodeId,
    targetComponentIds: intent.constraints.targetComponents,
    targetDistanceKm: intent.constraints.targetDistanceKm,
    requestedNaturalDwellKm: requestedNaturalDwellKm(intent, mission),
  });
  debugAssemblyStage('component-loop:done', {
    status: componentLoop.status,
    reason: componentLoop.status === 'failure' ? componentLoop.reason : null,
    edgeCount: componentLoop.edgeIds.length,
    assemblyTimeout: componentLoop.diagnostics.orderedCycleExpansion?.multiCycleDwell?.assemblyTimeout ?? null,
  });
  if (graph.edges.size > 8_000 && componentLoop.edgeIds.length > 0) {
    const loopTraversal = traversalFromStartAndEdgeIds(startNodeId, componentLoop.edgeIds, adjacency);
    const loopStates = loopTraversal.length > 0
      ? [stateFromTraversal(startNodeId, loopTraversal, intent, componentLoop.status === 'success' ? 'component-loop' : 'component-loop-diagnostic')]
      : [];
    if (loopStates[0]) loopStates[0].naturalDwellKm = Math.max(loopStates[0].naturalDwellKm, componentLoop.metrics.naturalDwellKm);
    const handoff = largeGraphTargetComponentHandoff(startNodeId, intent, mission, adjacency, componentLoop.diagnostics);
    handoff.blocker = componentLoop.status === 'success' ? null : 'component_loop_large_graph_cap';
    return { candidates: uniqueByCandidateKey(loopStates), handoff };
  }
  if (isLargeGraphForDetailedTargetTraversal(graph) && componentLoop.edgeIds.length === 0) {
    const handoff = largeGraphTargetComponentHandoff(startNodeId, intent, mission, adjacency, componentLoop.diagnostics);
    return { candidates: [], handoff };
  }

  if (componentLoop.edgeIds.length > 0) {
    const loopTraversal = traversalFromStartAndEdgeIds(startNodeId, componentLoop.edgeIds, adjacency);
    const hasPartialEvidence = componentLoop.metrics.distanceKm >= intent.constraints.targetDistanceKm * 0.55 &&
      componentLoop.metrics.naturalDwellKm + 0.001 >= requestedNaturalDwellKm(intent, mission) * 0.8;
    const hasReturnedEnvelopeEvidence = componentLoop.metrics.distanceKm + 0.001 >= intent.constraints.targetDistanceKm * 0.7 &&
      componentLoop.metrics.distanceKm <= intent.constraints.targetDistanceKm * 1.15 + 0.001;
    if (loopTraversal.length > 0 && (componentLoop.status === 'success' || hasPartialEvidence || hasReturnedEnvelopeEvidence)) {
      const source = componentLoop.status === 'success' ? 'component-loop' : 'component-loop-diagnostic';
      const loopState = stateFromTraversal(startNodeId, loopTraversal, intent, source);
      loopState.naturalDwellKm = Math.max(loopState.naturalDwellKm, componentLoop.metrics.naturalDwellKm);
      if (componentLoop.metrics.targetRepeatKm <= 0.5 + 0.001 || hasReturnedEnvelopeEvidence) states.push(loopState);
    }
  }

  (primitiveHandoff as RouteAssemblyTargetComponentHandoffDiagnosticsV3 & { componentLoopSolver: ComponentLoopSolverDiagnosticsV3 }).componentLoopSolver = componentLoop.diagnostics;
  primitiveHandoff.blocker = targetComponentHandoffBlocker(diagnosticCandidates, states);

  return { candidates: uniqueByCandidateKey(states), handoff: primitiveHandoff };
}

function targetComponentCandidatesFromGraph(
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  graph: EnrichedGraph,
  adjacency: Map<string, TraversalEdgeV3[]>,
): TargetComponentCandidateV3[] {
  const components = targetComponentsFromGraph(adjacency, intent, startNodeId);
  const requestedDwellKm = requestedNaturalDwellKm(intent, mission);
  const maxAccessKm = Math.max(3, intent.constraints.targetDistanceKm * 0.5);
  const preliminary = components
    .map((component, index) => {
      const accessTraversal = shortestAccessTraversalToComponent(startNodeId, component.nodeIds, adjacency);
      if (!accessTraversal && !component.nodeIds.has(startNodeId)) return null;
      const prefix = accessTraversal ?? [];
      const entryNodeId = prefix.at(-1)?.to ?? startNodeId;
      const accessDistanceKm = prefix.reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
      if (accessDistanceKm > maxAccessKm + 0.001 && component.reachableTargetKm < requestedDwellKm * 2) return null;
      return { component, index, accessTraversal: prefix, entryNodeId, accessDistanceKm };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null)
    .sort((a, b) => {
      const aViable = a.component.reachableTargetKm + 0.001 >= requestedDwellKm ? 1 : 0;
      const bViable = b.component.reachableTargetKm + 0.001 >= requestedDwellKm ? 1 : 0;
      if (aViable !== bViable) return bViable - aViable;
      return b.component.reachableTargetKm - a.component.reachableTargetKm || a.accessDistanceKm - b.accessDistanceKm;
    })
    .slice(0, 12);

  return preliminary.map(({ component, index, accessTraversal, entryNodeId }) => ({
    componentId: `target-component-${index + 1}`,
    nodeIds: component.nodeIds,
    edgeIds: component.edgeIds,
    reachableTargetKm: component.reachableTargetKm,
    naturalTargetKm: component.naturalTargetKm,
    accessTraversal,
    entryNodeId,
    primitive: buildTargetComponentTraversal({
      graph,
      startNodeId,
      entryNodeId,
      targetComponentIds: intent.constraints.targetComponents,
      targetDistanceKm: intent.constraints.targetDistanceKm,
      minDistanceRatio: 0.7,
      maxDistanceRatio: 1.15,
      usedEdgeKeys: new Set(accessTraversal.map((edge) => edge.edge.id)),
      forbidTargetRepeat: true,
    }),
  }));
}

function targetComponentCandidateDiagnostics(
  rank: number,
  candidate: TargetComponentCandidateV3,
  selected: boolean,
  rejectedReason: string | null,
  intent: RouteIntentV3,
): RouteAssemblyTargetComponentCandidateDiagnosticsV3 {
  const success = candidate.primitive.status === 'success' ? candidate.primitive : null;
  return {
    rank,
    componentId: candidate.componentId,
    selected,
    rejectedReason,
    entryNodeId: candidate.entryNodeId,
    entryDistanceKm: round(candidate.accessTraversal.reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0)),
    targetComponentKinds: [...intent.constraints.targetComponents],
    reachableTargetKm: candidate.primitive.diagnostics.reachableTargetKm,
    cleanExploitableKm: candidate.primitive.diagnostics.exploitableTargetKm,
    componentTargetKmRaw: candidate.primitive.diagnostics.reachableTargetKm,
    componentTargetKmFinal: candidate.primitive.diagnostics.exploitableTargetKm,
    targetDistanceKm: candidate.primitive.diagnostics.targetDistanceKm,
    minDistanceKm: candidate.primitive.diagnostics.minDistanceKm,
    maxDistanceKm: candidate.primitive.diagnostics.maxDistanceKm,
    usedEdgeKeyCount: candidate.accessTraversal.length,
    traversalInputNodeCount: candidate.nodeIds.size,
    traversalInputEdgeCount: candidate.edgeIds.size,
    traversalResult: {
      status: candidate.primitive.status,
      distanceKm: success?.distanceKm ?? candidate.primitive.diagnostics.bestPartialDistanceKm,
      targetKm: success?.targetKm ?? candidate.primitive.diagnostics.targetDistanceKm,
      repeatedTargetKm: success?.repeatedTargetKm ?? 0,
      blocker: candidate.primitive.status === 'failure' ? candidate.primitive.diagnostics.blocker : null,
    },
    closureAttempt: success
      ? {
          status: success.closure.edgeIds.length > 0 ? 'success' : 'failure',
          closureDistanceKm: success.closure.distanceKm,
          connectorRepeatKm: success.closure.connectorRepeatKm,
          targetRepeatKm: success.closure.targetRepeatKm,
        }
      : {
          status: candidate.primitive.diagnostics.blocker === 'no_clean_closure' ? 'failure' : 'not_attempted',
          closureDistanceKm: 0,
          connectorRepeatKm: 0,
          targetRepeatKm: 0,
        },
  };
}

interface TargetComponentGraphComponentV3 {
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  reachableTargetKm: number;
  naturalTargetKm: number;
}

function isLargeGraphForDetailedTargetTraversal(graph: EnrichedGraph): boolean {
  return graph.edges.size > TARGET_COMPONENT_DETAILED_TRAVERSAL_EDGE_THRESHOLD;
}

function largeGraphTargetComponentHandoff(
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  adjacency: Map<string, TraversalEdgeV3[]>,
  componentLoopDiagnostics: ComponentLoopSolverDiagnosticsV3,
): RouteAssemblyTargetComponentHandoffDiagnosticsV3 {
  const requestedDwellKm = requestedNaturalDwellKm(intent, mission);
  const componentDiagnostics = targetComponentsFromGraph(adjacency, intent, startNodeId)
    .map((component, index) => {
      const accessTraversal = shortestAccessTraversalToComponent(startNodeId, component.nodeIds, adjacency) ?? [];
      const entryNodeId = accessTraversal.at(-1)?.to ?? (component.nodeIds.has(startNodeId) ? startNodeId : Array.from(component.nodeIds)[0] ?? startNodeId);
      const reachableTargetKm = round(component.reachableTargetKm);
      const cleanExploitableKm = round(component.naturalTargetKm);
      return {
        rank: index + 1,
        componentId: `target-component-${index + 1}`,
        selected: false,
        rejectedReason: 'large_graph_component_loop_fallback',
        entryNodeId,
        entryDistanceKm: round(accessTraversal.reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0)),
        targetComponentKinds: [...intent.constraints.targetComponents],
        reachableTargetKm,
        cleanExploitableKm,
        componentTargetKmRaw: reachableTargetKm,
        componentTargetKmFinal: cleanExploitableKm,
        targetDistanceKm: intent.constraints.targetDistanceKm,
        minDistanceKm: round(intent.constraints.targetDistanceKm * 0.7),
        maxDistanceKm: round(intent.constraints.targetDistanceKm * 1.15),
        usedEdgeKeyCount: accessTraversal.length,
        traversalInputNodeCount: component.nodeIds.size,
        traversalInputEdgeCount: component.edgeIds.size,
        traversalResult: {
          status: 'failure' as const,
          distanceKm: 0,
          targetKm: intent.constraints.targetDistanceKm,
          repeatedTargetKm: 0,
          blocker: cleanExploitableKm + 0.001 >= requestedDwellKm ? 'detailed_traversal_skipped_large_graph' : 'insufficient_clean_exploitable_capacity',
        },
        closureAttempt: {
          status: 'not_attempted' as const,
          closureDistanceKm: 0,
          connectorRepeatKm: 0,
          targetRepeatKm: 0,
        },
      };
    })
    .sort((a, b) => b.cleanExploitableKm - a.cleanExploitableKm || a.entryDistanceKm - b.entryDistanceKm)
    .map((candidate, index) => ({ ...candidate, rank: index + 1, selected: index === 0 }));

  const handoff: RouteAssemblyTargetComponentHandoffDiagnosticsV3 = {
    selectedTargetComponentIds: [...intent.constraints.targetComponents],
    targetComponentKinds: [...intent.constraints.targetComponents],
    componentCandidateCount: componentDiagnostics.length,
    componentCandidates: componentDiagnostics.slice(0, 24),
    blocker: componentDiagnostics.length > 0 ? 'detailed_traversal_skipped_large_graph' : 'no_target_component_candidates',
  };
  (handoff as RouteAssemblyTargetComponentHandoffDiagnosticsV3 & { componentLoopSolver: ComponentLoopSolverDiagnosticsV3 }).componentLoopSolver = componentLoopDiagnostics;
  return handoff;
}

function targetComponentsFromGraph(
  adjacency: Map<string, TraversalEdgeV3[]>,
  intent: RouteIntentV3,
  blockedTransitNodeId?: string,
): TargetComponentGraphComponentV3[] {
  const seenEdges = new Set<string>();
  const components: TargetComponentGraphComponentV3[] = [];

  for (const edges of Array.from(adjacency.values())) {
    for (const seed of edges) {
      if (seenEdges.has(seed.edge.id) || !isTargetComponentTraversalEdge(seed, intent)) continue;
      const pending = [seed.from, seed.to];
      const nodeIds = new Set<string>();
      const edgeIds = new Set<string>();
      let reachableTargetKm = 0;
      let naturalTargetKm = 0;

      while (pending.length > 0) {
        const current = pending.shift();
        if (!current || nodeIds.has(current)) continue;
        nodeIds.add(current);
        for (const edge of adjacency.get(current) ?? []) {
          if (edge.to === blockedTransitNodeId && edge.to !== seed.from && edge.to !== seed.to) continue;
          if (!isTargetComponentTraversalEdge(edge, intent)) continue;
          if (!edgeIds.has(edge.edge.id)) {
            edgeIds.add(edge.edge.id);
            seenEdges.add(edge.edge.id);
            const lengthKm = Math.max(0, edge.edge.lengthKm);
            reachableTargetKm += lengthKm;
            naturalTargetKm += lengthKm * classifyEdgeSemanticsV3(edge.edge).candidateNaturalWeight;
          }
          if (!nodeIds.has(edge.to)) pending.push(edge.to);
        }
      }

      components.push({
        nodeIds,
        edgeIds,
        reachableTargetKm: round(reachableTargetKm),
        naturalTargetKm: round(naturalTargetKm),
      });
    }
  }

  return components;
}

function isTargetComponentTraversalEdge(edge: TraversalEdgeV3, intent: RouteIntentV3): boolean {
  return intent.constraints.targetComponents.includes(edge.kind) && classifyEdgeSemanticsV3(edge.edge).routeSurface !== 'paved';
}

function shortestAccessTraversalToComponent(
  startNodeId: string,
  componentNodeIds: Set<string>,
  adjacency: Map<string, TraversalEdgeV3[]>,
): TraversalEdgeV3[] | null {
  if (componentNodeIds.has(startNodeId)) return [];
  const bestCosts = new Map<string, number>([[startNodeId, 0]]);
  const pending: Array<{ nodeId: string; distanceKm: number; cost: number; traversal: TraversalEdgeV3[] }> = [
    { nodeId: startNodeId, distanceKm: 0, cost: 0, traversal: [] },
  ];

  while (pending.length > 0) {
    const current = pending.sort((a, b) => a.cost - b.cost || a.distanceKm - b.distanceKm).shift();
    if (!current) break;
    if (componentNodeIds.has(current.nodeId) && current.traversal.length > 0) return current.traversal;
    if (current.cost > (bestCosts.get(current.nodeId) ?? Number.POSITIVE_INFINITY) + 0.000001) continue;

    for (const edge of adjacency.get(current.nodeId) ?? []) {
      const nextDistanceKm = current.distanceKm + Math.max(0, edge.edge.lengthKm);
      const nextCost = current.cost + weightedConnectorCost(edge);
      if (nextCost + 0.000001 >= (bestCosts.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      bestCosts.set(edge.to, nextCost);
      pending.push({ nodeId: edge.to, distanceKm: nextDistanceKm, cost: nextCost, traversal: [...current.traversal, edge] });
    }
  }

  return null;
}

function rankTargetComponentCandidates(
  candidates: TargetComponentCandidateV3[],
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
): TargetComponentCandidateV3[] {
  const requestedDwellKm = requestedNaturalDwellKm(intent, mission);
  return [...candidates].sort((a, b) => {
    const aSuccess = a.primitive.status === 'success' ? 1 : 0;
    const bSuccess = b.primitive.status === 'success' ? 1 : 0;
    if (aSuccess !== bSuccess) return bSuccess - aSuccess;

    const aCleanViable = a.primitive.diagnostics.exploitableTargetKm + 0.001 >= requestedDwellKm ? 1 : 0;
    const bCleanViable = b.primitive.diagnostics.exploitableTargetKm + 0.001 >= requestedDwellKm ? 1 : 0;
    if (aCleanViable !== bCleanViable) return bCleanViable - aCleanViable;

    const cleanDelta = b.primitive.diagnostics.exploitableTargetKm - a.primitive.diagnostics.exploitableTargetKm;
    if (Math.abs(cleanDelta) > 0.001) return cleanDelta;

    const naturalDelta = b.naturalTargetKm - a.naturalTargetKm;
    if (Math.abs(naturalDelta) > 0.001) return naturalDelta;

    const accessDelta = accessDistanceKm(a) - accessDistanceKm(b);
    if (Math.abs(accessDelta) > 0.001) return accessDelta;

    return b.reachableTargetKm - a.reachableTargetKm;
  });
}

function targetComponentRejectionReason(
  candidate: TargetComponentCandidateV3,
  selectedCandidate: TargetComponentCandidateV3 | null,
  mission: CorridorMissionV3,
  intent: RouteIntentV3,
): string | null {
  if (candidate.primitive.status === 'failure') return candidate.primitive.diagnostics.blocker;
  if (!selectedCandidate) return null;
  if (candidate.primitive.diagnostics.exploitableTargetKm < requestedNaturalDwellKm(intent, mission)) return 'lower_clean_exploitable_capacity';
  if (accessDistanceKm(candidate) > accessDistanceKm(selectedCandidate) + 0.001) return 'higher_access_cost';
  return 'lower_ranked_component';
}

function accessDistanceKm(candidate: TargetComponentCandidateV3): number {
  return candidate.accessTraversal.reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
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

function traversalFromStartAndEdgeIds(
  startNodeId: string,
  edgeIds: string[],
  adjacency: Map<string, TraversalEdgeV3[]>,
): TraversalEdgeV3[] {
  const traversal: TraversalEdgeV3[] = [];
  let current = startNodeId;
  for (const edgeId of edgeIds) {
    const edge = (adjacency.get(current) ?? []).find((candidate) => candidate.edge.id === edgeId);
    if (!edge) return [];
    traversal.push(edge);
    current = edge.to;
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
): {
  candidates: GraphCandidateStateV3[];
  diagnostics: Pick<RouteAssemblyDiagnosticsV3, 'closureAttemptCount' | 'returnedClosureCount' | 'closureRejectedReasons' | 'recoveryExpansionKm' | 'recoveryBudgetKm'>;
} {
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
    .slice(0, 8);

  const recovered: GraphCandidateStateV3[] = [];
  const closureRejectedReasons: Record<string, number> = {};
  let recoveryExpansionKm = 0;
  let recoveryBudgetKm = 0;
  for (const candidate of closureSeeds) {
    const maxAdditionalKm = maxDistanceKm - candidate.distanceKm;
    recoveryBudgetKm = Math.max(recoveryBudgetKm, maxAdditionalKm);
    if (maxAdditionalKm <= 0) {
      closureRejectedReasons.no_budget = (closureRejectedReasons.no_budget ?? 0) + 1;
      continue;
    }
    const returnTraversal = shortestCleanReturnTraversal(candidate, adjacency, startNodeId, intent, maxAdditionalKm);
    if (returnTraversal.length === 0) {
      closureRejectedReasons.no_clean_return = (closureRejectedReasons.no_clean_return ?? 0) + 1;
      continue;
    }
    recoveryExpansionKm = Math.max(recoveryExpansionKm, sumTraversalLength(returnTraversal));
    let closed: GraphCandidateStateV3 = { ...candidate, source: `${candidate.source ?? 'frontier'}+closure` };
    for (const edge of returnTraversal) closed = advanceState(closed, edge, intent);
    recovered.push(closed);
  }
  return {
    candidates: recovered,
    diagnostics: {
      closureAttemptCount: closureSeeds.length,
      returnedClosureCount: recovered.filter((candidate) => candidate.current === startNodeId).length,
      closureRejectedReasons,
      recoveryExpansionKm: round(recoveryExpansionKm),
      recoveryBudgetKm: round(recoveryBudgetKm),
    },
  };
}

function sumTraversalLength(traversal: TraversalEdgeV3[]): number {
  return traversal.reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
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
      const nextCost = current.cost + weightedConnectorCost(edge) + repeatPenaltyKm;
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

interface CandidateSelectionResultV3 {
  selected: GraphCandidateStateV3 | null;
  selectionPool: GraphCandidateStateV3[];
  paretoFrontier: GraphCandidateStateV3[];
  dominated: Array<{ candidate: GraphCandidateStateV3; dominatedBy: GraphCandidateStateV3 }>;
  selectedReason: string | null;
  mode: ProductGateModeV3 | null;
}

function selectBestCandidate(
  candidates: GraphCandidateStateV3[],
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
): CandidateSelectionResultV3 {
  const productValidCandidates = candidates.filter(
    (candidate) => productGateAssessment(candidate, startNodeId, intent, mission, options, 'generated').passed,
  );
  if (productValidCandidates.length > 0) {
    return selectParetoCandidate(productValidCandidates, startNodeId, intent, mission, options, 'generated');
  }

  const adjustedEvidenceCandidates = candidates.filter(
    (candidate) => productGateAssessment(candidate, startNodeId, intent, mission, options, 'adjusted').passed,
  );
  if (adjustedEvidenceCandidates.length > 0) {
    return selectParetoCandidate(adjustedEvidenceCandidates, startNodeId, intent, mission, options, 'adjusted');
  }

  return {
    selected: null,
    selectionPool: candidates,
    paretoFrontier: [],
    dominated: [],
    selectedReason: null,
    mode: null,
  };
}

function selectParetoCandidate(
  candidates: GraphCandidateStateV3[],
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
  mode: ProductGateModeV3,
): CandidateSelectionResultV3 {
  const repeatAwarePool = preferLowRepeatCandidates(candidates, true, intent, mission);
  const pareto = paretoFrontier(repeatAwarePool, startNodeId, intent);
  const frontier = pareto.frontier.length > 0 ? pareto.frontier : repeatAwarePool;
  const selected = [...frontier].sort(
    (a, b) => paretoTieBreakScore(b, startNodeId, intent, mission, options, mode) - paretoTieBreakScore(a, startNodeId, intent, mission, options, mode),
  )[0] ?? null;

  return {
    selected,
    selectionPool: frontier,
    paretoFrontier: frontier,
    dominated: pareto.dominated,
    selectedReason: selected
      ? `pareto-${mode}: in-envelope candidate balanced distance error, trail continuity, paved budget, repeat and closure quality`
      : null,
    mode,
  };
}

function finalCandidateDiagnostics(
  candidates: GraphCandidateStateV3[],
  selectionPool: GraphCandidateStateV3[],
  selected: GraphCandidateStateV3 | null,
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
  selection?: CandidateSelectionResultV3,
): RouteAssemblyFinalCandidateDiagnosticsV3[] {
  const selectionKeys = new Set(selectionPool.map(candidateKey));
  const selectedKey = selected ? candidateKey(selected) : null;
  const dominatedByKey = new Map((selection?.dominated ?? []).map((item) => [candidateKey(item.candidate), finalCandidateDiagnosticId(item.dominatedBy, 0)]));
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
    const assessment = productGateAssessment(candidate, startNodeId, intent, mission, options, 'generated');
    const selectedCandidate = selectedKey !== null && key === selectedKey;
    return {
      id: finalCandidateDiagnosticId(candidate, index + 1),
      rank: index + 1,
      selected: selectedCandidate,
      inSelectionPool: selectionKeys.has(key),
      rejectedReason: selectedCandidate ? null : assessment.reason,
      gate: selectedCandidate ? null : assessment.gate,
      distanceKm: round(candidate.distanceKm),
      naturalDwellKm: round(candidate.naturalDwellKm),
      pavedKm: round(assessment.signals.pavedKm),
      pavedRatio: round(assessment.signals.pavedRatio),
      finalPavedRatioEstimate: round(assessment.signals.pavedRatio),
      mixedUnknownKm: round(assessment.signals.mixedUnknownKm),
      strictTrailKm: round(assessment.signals.strictTrailKm),
      longestTrailSegmentKm: round(assessment.signals.longestTrailSegmentKm),
      repeatKm: round(repeatKm(candidate)),
      targetRepeatKm: round(targetRepeatKm(candidate, intent)),
      connectorRepeatKm: round(connectorRepeatKm(candidate, intent)),
      returned: candidate.current === startNodeId && candidate.traversal.length > 0,
      scoreComplete: round(scoreCompleteCandidate(candidate, startNodeId, intent, mission, options)),
      scoreProgress: round(scoreProgressCandidate(candidate, startNodeId, intent, mission, options)),
      source: candidate.source ?? 'unknown',
      distanceErrorRatio: round(distanceErrorRatio(candidate, intent)),
      pavedConnectorKm: round(Math.max(0, assessment.signals.pavedKm - assessment.signals.targetPavedKm)),
      busyRoadRatio: round(assessment.signals.busyRoadKm / Math.max(0.001, candidate.distanceKm)),
      closureQuality: round(closureQuality(candidate, startNodeId)),
      selectedReason: selectedCandidate ? (selection?.selectedReason ?? null) : null,
      dominatedBy: dominatedByKey.get(key) ?? null,
    };
  });
}

interface ParetoComparableMetricsV3 {
  distanceErrorRatio: number;
  longestTrailSegmentKm: number;
  strictTrailKm: number;
  naturalDwellKm: number;
  finalPavedRatioEstimate: number;
  mixedUnknownKm: number;
  pavedConnectorKm: number;
  repeatKm: number;
  targetRepeatKm: number;
  connectorRepeatKm: number;
  busyRoadRatio: number;
  closureQuality: number;
}

function paretoFrontier(
  candidates: GraphCandidateStateV3[],
  startNodeId: string,
  intent: RouteIntentV3,
): { frontier: GraphCandidateStateV3[]; dominated: Array<{ candidate: GraphCandidateStateV3; dominatedBy: GraphCandidateStateV3 }> } {
  const unique = uniqueByCandidateKey(candidates);
  const dominated: Array<{ candidate: GraphCandidateStateV3; dominatedBy: GraphCandidateStateV3 }> = [];
  const frontier = unique.filter((candidate) => {
    const dominator = unique.find((other) => other !== candidate && dominatesCandidate(other, candidate, startNodeId, intent));
    if (dominator) {
      dominated.push({ candidate, dominatedBy: dominator });
      return false;
    }
    return true;
  });
  return { frontier, dominated };
}

function dominatesCandidate(
  a: GraphCandidateStateV3,
  b: GraphCandidateStateV3,
  startNodeId: string,
  intent: RouteIntentV3,
): boolean {
  const am = paretoMetrics(a, startNodeId, intent);
  const bm = paretoMetrics(b, startNodeId, intent);
  const noWorse =
    am.distanceErrorRatio <= bm.distanceErrorRatio + 0.001 &&
    am.longestTrailSegmentKm + 0.001 >= bm.longestTrailSegmentKm &&
    am.strictTrailKm + 0.001 >= bm.strictTrailKm &&
    am.naturalDwellKm + 0.001 >= bm.naturalDwellKm &&
    am.finalPavedRatioEstimate <= bm.finalPavedRatioEstimate + 0.001 &&
    am.mixedUnknownKm <= bm.mixedUnknownKm + 0.001 &&
    am.pavedConnectorKm <= bm.pavedConnectorKm + 0.001 &&
    am.repeatKm <= bm.repeatKm + 0.001 &&
    am.targetRepeatKm <= bm.targetRepeatKm + 0.001 &&
    am.connectorRepeatKm <= bm.connectorRepeatKm + 0.001 &&
    am.busyRoadRatio <= bm.busyRoadRatio + 0.001 &&
    am.closureQuality + 0.001 >= bm.closureQuality;
  if (!noWorse) return false;
  return (
    am.distanceErrorRatio < bm.distanceErrorRatio - 0.01 ||
    am.longestTrailSegmentKm > bm.longestTrailSegmentKm + 0.05 ||
    am.strictTrailKm > bm.strictTrailKm + 0.05 ||
    am.naturalDwellKm > bm.naturalDwellKm + 0.05 ||
    am.finalPavedRatioEstimate < bm.finalPavedRatioEstimate - 0.02 ||
    am.mixedUnknownKm < bm.mixedUnknownKm - 0.05 ||
    am.pavedConnectorKm < bm.pavedConnectorKm - 0.05 ||
    am.repeatKm < bm.repeatKm - 0.05 ||
    am.targetRepeatKm < bm.targetRepeatKm - 0.05 ||
    am.connectorRepeatKm < bm.connectorRepeatKm - 0.05 ||
    am.busyRoadRatio < bm.busyRoadRatio - 0.02 ||
    am.closureQuality > bm.closureQuality + 0.1
  );
}

function paretoMetrics(candidate: GraphCandidateStateV3, startNodeId: string, intent: RouteIntentV3): ParetoComparableMetricsV3 {
  const signals = productGateSignals(candidate, intent);
  return {
    distanceErrorRatio: distanceErrorRatio(candidate, intent),
    longestTrailSegmentKm: signals.longestTrailSegmentKm,
    strictTrailKm: signals.strictTrailKm,
    naturalDwellKm: candidate.naturalDwellKm,
    finalPavedRatioEstimate: signals.pavedRatio,
    mixedUnknownKm: signals.mixedUnknownKm,
    pavedConnectorKm: Math.max(0, signals.pavedKm - signals.targetPavedKm),
    repeatKm: repeatKm(candidate),
    targetRepeatKm: targetRepeatKm(candidate, intent),
    connectorRepeatKm: connectorRepeatKm(candidate, intent),
    busyRoadRatio: signals.busyRoadKm / Math.max(0.001, candidate.distanceKm),
    closureQuality: closureQuality(candidate, startNodeId),
  };
}

function paretoTieBreakScore(
  candidate: GraphCandidateStateV3,
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
  mode: ProductGateModeV3,
): number {
  const metrics = paretoMetrics(candidate, startNodeId, intent);
  const requestedDwellKm = requestedNaturalDwellKm(intent, mission);
  const trailContinuity = Math.min(1.5, metrics.longestTrailSegmentKm / Math.max(0.001, intent.constraints.targetDistanceKm * 0.3));
  const strictTrail = Math.min(1.5, metrics.strictTrailKm / Math.max(0.001, requestedDwellKm));
  const naturalDwell = Math.min(1.5, metrics.naturalDwellKm / Math.max(0.001, requestedDwellKm));
  const base = mode === 'generated'
    ? scoreCompleteCandidate(candidate, startNodeId, intent, mission, options)
    : scoreProgressCandidate(candidate, startNodeId, intent, mission, options);
  return (
    base * 0.05 +
    (1 - metrics.distanceErrorRatio) * 6 +
    trailContinuity * 6 +
    strictTrail * 4 +
    naturalDwell * 4 +
    (1 - metrics.finalPavedRatioEstimate) * 3 +
    metrics.closureQuality * 2 -
    metrics.mixedUnknownKm * 0.5 -
    metrics.pavedConnectorKm * 0.8 -
    metrics.repeatKm * 2 -
    metrics.busyRoadRatio * 5
  );
}

function distanceErrorRatio(candidate: GraphCandidateStateV3, intent: RouteIntentV3): number {
  return Math.abs(candidate.distanceKm - intent.constraints.targetDistanceKm) / Math.max(0.001, intent.constraints.targetDistanceKm);
}

function closureQuality(candidate: GraphCandidateStateV3, startNodeId: string): number {
  if (candidate.current !== startNodeId || candidate.traversal.length === 0) return 0;
  return 1 / (1 + repeatRatio(candidate));
}

function applyCandidateDiversityDiagnostics(
  diagnostics: RouteAssemblyDiagnosticsV3,
  candidates: GraphCandidateStateV3[],
  finalDiagnostics: RouteAssemblyFinalCandidateDiagnosticsV3[],
  selection: CandidateSelectionResultV3,
  startNodeId: string,
  intent: RouteIntentV3,
): void {
  const uniqueCandidates = uniqueByCandidateKey(candidates);
  const minDistanceKm = intent.constraints.targetDistanceKm * 0.7;
  const maxDistanceKm = intent.constraints.targetDistanceKm * 1.15;
  diagnostics.candidateCount = uniqueCandidates.length;
  diagnostics.inEnvelopeCount = uniqueCandidates.filter((candidate) => candidate.distanceKm >= minDistanceKm - 0.001 && candidate.distanceKm <= maxDistanceKm + 0.001).length;
  diagnostics.overlongCount = uniqueCandidates.filter((candidate) => candidate.distanceKm > maxDistanceKm + 0.001).length;
  diagnostics.underMinCount = uniqueCandidates.filter((candidate) => candidate.distanceKm + 0.001 < minDistanceKm).length;
  diagnostics.candidateCountByLane = uniqueCandidates.reduce<Record<string, number>>((counts, candidate) => {
    const source = candidate.source ?? 'unknown';
    counts[source] = (counts[source] ?? 0) + 1;
    return counts;
  }, {});
  const frontierKeys = new Set(selection.paretoFrontier.map((candidate) => finalCandidateDiagnosticId(candidate, 0).split(':').slice(1).join(':')));
  diagnostics.paretoFrontierCandidates = finalDiagnostics.filter((candidate) => frontierKeys.has(candidate.id.split(':').slice(1).join(':')));
  const selectedDiagnostic = finalDiagnostics.find((candidate) => candidate.selected) ?? null;
  diagnostics.selectedCandidateId = selectedDiagnostic?.id ?? null;
  diagnostics.selectedReason = selection.selectedReason;
  diagnostics.rejectedDominatedCandidates = selection.dominated.slice(0, 12).map((item) => finalCandidateDiagnosticId(item.candidate, 0));
  diagnostics.topRejected = finalDiagnostics.filter((candidate) => !candidate.selected && Boolean(candidate.rejectedReason)).slice(0, 5);
  const returnedInEnvelopeCount = uniqueCandidates.filter((candidate) =>
    candidate.current === startNodeId &&
    candidate.distanceKm >= minDistanceKm - 0.001 &&
    candidate.distanceKm <= maxDistanceKm + 0.001,
  ).length;
  diagnostics.returnedClosureCount = Math.max(diagnostics.returnedClosureCount ?? 0, returnedInEnvelopeCount);
  diagnostics.firstDropStage = selection.selected
    ? null
    : diagnostics.inEnvelopeCount === 0
      ? ((diagnostics.returnedClosureCount ?? 0) > 0 ? 'distance_gate' : 'closure')
      : 'product_gate';
}

function applyTransitionPhaseDiagnostics(
  diagnostics: RouteAssemblyDiagnosticsV3,
  candidates: GraphCandidateStateV3[],
  selected: GraphCandidateStateV3 | null,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
): void {
  if (options.mode !== 'transition_to_woods') return;

  const uniqueCandidates = uniqueByCandidateKey(candidates);
  const targetCandidates = uniqueCandidates.filter((candidate) => candidate.enteredTarget);
  const selectedTargetCandidate = diagnostics.targetComponentHandoff?.componentCandidates.find((candidate) => candidate.selected) ?? null;
  const bestDwellCandidate = [...targetCandidates].sort((a, b) => b.naturalDwellKm - a.naturalDwellKm || b.distanceKm - a.distanceKm)[0] ?? null;
  const bestCandidate = selected ?? bestDwellCandidate;
  const requestedDwellKm = requestedNaturalDwellKm(intent, mission);

  diagnostics.enteredTargetComponent = targetCandidates.length > 0;
  diagnostics.targetComponentDwellKm = round(bestCandidate?.naturalDwellKm ?? 0);
  diagnostics.targetCapacityKm = round(selectedTargetCandidate?.cleanExploitableKm ?? diagnostics.reachableNonPavedTargetKm);
  diagnostics.selectedTargetCandidate = selectedTargetCandidate
    ? `${selectedTargetCandidate.componentId}:${selectedTargetCandidate.entryNodeId}`
    : null;
  diagnostics.closureBlockedUntilDwell = selected
    ? false
    : targetCandidates.some((candidate) => candidate.current !== candidate.traversal[0]?.from && candidate.naturalDwellKm + 0.001 < requestedDwellKm);
  diagnostics.failureStage = selected
    ? null
    : (diagnostics.targetComponentHandoff?.blocker ?? diagnostics.firstDropStage ?? null);
}


type ProductGateModeV3 = 'generated' | 'adjusted';

interface ProductGateSignalsV3 {
  pavedKm: number;
  pavedRatio: number;
  mixedUnknownKm: number;
  strictTrailKm: number;
  longestTrailSegmentKm: number;
  targetPavedKm: number;
  targetExplicitPavedKm: number;
  busyRoadKm: number;
}

interface ProductGateAssessmentV3 {
  passed: boolean;
  gate: string | null;
  reason: string | null;
  signals: ProductGateSignalsV3;
}

function productGateAssessment(
  candidate: GraphCandidateStateV3,
  startNodeId: string,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  options: GraphAssemblyOptionsV3,
  mode: ProductGateModeV3,
): ProductGateAssessmentV3 {
  const signals = productGateSignals(candidate, intent);
  const fail = (gate: string, reason: string): ProductGateAssessmentV3 => ({ passed: false, gate, reason, signals });
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const requestedDwellKm = requestedNaturalDwellKm(intent, mission);
  const isTrailIntent = intent.request?.mode === 'trail' || options.mode === 'forest_loop' || options.mode === 'transition_to_woods';
  const minDistanceRatio = 0.7;
  const maxDistanceRatio = 1.15;

  if (candidate.current !== startNodeId || candidate.traversal.length === 0) return fail('loopClosure', 'candidate is not a returned loop');
  if (candidate.distanceKm + 0.001 < targetDistanceKm * minDistanceRatio) return fail('distance', `distance ${round(candidate.distanceKm)}km below ${mode} minimum ${round(targetDistanceKm * minDistanceRatio)}km`);
  if (candidate.distanceKm > targetDistanceKm * maxDistanceRatio + 0.001) return fail('distance', `distance ${round(candidate.distanceKm)}km above maximum envelope ${round(targetDistanceKm * maxDistanceRatio)}km`);

  const minDwellKm = options.requireNaturalDwell
    ? requestedDwellKm * (mode === 'generated' ? 1 : 0.4)
    : requestedDwellKm * (mode === 'generated' ? 0.45 : 0.25);
  if (candidate.naturalDwellKm + 0.001 < minDwellKm) return fail('naturalDwell', `natural dwell ${round(candidate.naturalDwellKm)}km below ${round(minDwellKm)}km`);

  const maxPavedRatio = mode === 'generated'
    ? intent.constraints.maxPavedRatio
    : Math.min(0.5, intent.constraints.maxPavedRatio + 0.1);
  if (signals.pavedRatio > maxPavedRatio + 0.001) return fail('pavedRatio', `final paved ratio ${round(signals.pavedRatio)} exceeds ${mode} budget ${round(maxPavedRatio)}`);

  const targetDistanceInTerrainKm = candidate.traversal
    .filter((edge) => intent.constraints.targetComponents.includes(edge.kind))
    .reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
  const pavedCoreKm = mode === 'generated' ? signals.targetPavedKm : signals.targetExplicitPavedKm;
  const pavedCoreRatio = pavedCoreKm / Math.max(0.001, targetDistanceInTerrainKm);
  if (isTrailIntent && targetDistanceInTerrainKm > 0 && (pavedCoreKm > 0.35 || pavedCoreRatio > 0.15)) {
    return fail('pavedCore', `paved target core ${round(pavedCoreKm)}km / ${round(pavedCoreRatio)} ratio; paved scenic can only be connector evidence`);
  }

  if (isTrailIntent) {
    const minLongestTrailKm = mode === 'generated'
      ? Math.min(requestedDwellKm * 0.5, targetDistanceKm * 0.3)
      : Math.min(Math.max(0.8, requestedDwellKm * 0.3), targetDistanceKm * 0.22);
    if (signals.longestTrailSegmentKm + 0.001 < minLongestTrailKm) {
      return fail('longestTrailSegment', `longest strict trail segment ${round(signals.longestTrailSegmentKm)}km below ${round(minLongestTrailKm)}km`);
    }

    const minStrictTrailKm = mode === 'generated'
      ? Math.min(requestedDwellKm * 0.6, targetDistanceKm * 0.25)
      : Math.min(requestedDwellKm * 0.35, targetDistanceKm * 0.18);
    if (signals.strictTrailKm + 0.001 < minStrictTrailKm) {
      return fail('strictTrail', `strict trail ${round(signals.strictTrailKm)}km below ${round(minStrictTrailKm)}km`);
    }

    const maxMixedUnknownKm = mode === 'generated'
      ? Math.max(0.75, signals.strictTrailKm * 0.5)
      : adjustedMixedUnknownBudgetKm(signals.strictTrailKm, targetDistanceKm);
    if (signals.mixedUnknownKm > maxMixedUnknownKm + 0.001) {
      return fail('mixedUnknown', `mixed/unknown evidence ${round(signals.mixedUnknownKm)}km exceeds ${round(maxMixedUnknownKm)}km cap`);
    }
  }

  if (mode === 'generated' && damagingRepeatRatio(candidate, intent) > 0.2 + 0.001) return fail('repeat', `target repeat/overlap ratio ${round(damagingRepeatRatio(candidate, intent))} exceeds generated limit`);
  if (mode === 'adjusted' && !targetRepeatWithinAdjustedEvidence(candidate, intent)) return fail('repeat', `target repeat ${round(targetRepeatKm(candidate, intent))}km too high for adjusted evidence`);
  if (signals.busyRoadKm / Math.max(0.001, candidate.distanceKm) > (mode === 'generated' ? 0.2 : 0.35)) return fail('busyRoad', 'busy-road share is too high for this outcome');

  return { passed: true, gate: null, reason: null, signals };
}

function productGateSignals(candidate: GraphCandidateStateV3, intent: RouteIntentV3): ProductGateSignalsV3 {
  let pavedKm = 0;
  let mixedUnknownKm = 0;
  let strictTrailKm = 0;
  let currentTrailSegmentKm = 0;
  let longestTrailSegmentKm = 0;
  let targetPavedKm = 0;
  let targetExplicitPavedKm = 0;
  let busyRoadKm = 0;

  for (const edge of candidate.traversal) {
    const lengthKm = Math.max(0, edge.edge.lengthKm);
    const semantics = classifyEdgeSemanticsV3(edge.edge);
    const pavedEquivalentKm = lengthKm * semantics.pavedEquivalentWeight;
    pavedKm += pavedEquivalentKm;
    if (semantics.routeSurface === 'mixed') mixedUnknownKm += lengthKm;
    if (intent.constraints.targetComponents.includes(edge.kind)) {
      targetPavedKm += pavedEquivalentKm;
      if (semantics.surfaceEvidence === 'explicit_paved') targetExplicitPavedKm += lengthKm;
    }
    if (semantics.isStrictTrailLike) {
      strictTrailKm += lengthKm;
      currentTrailSegmentKm += lengthKm;
      longestTrailSegmentKm = Math.max(longestTrailSegmentKm, currentTrailSegmentKm);
    } else {
      currentTrailSegmentKm = 0;
    }
    if (semantics.routeSurface === 'paved' && ['motorway', 'trunk', 'primary', 'secondary', 'tertiary'].includes((edge.edge.highway ?? '').toLowerCase())) {
      busyRoadKm += lengthKm;
    }
  }

  return {
    pavedKm,
    pavedRatio: pavedKm / Math.max(0.001, candidate.distanceKm),
    mixedUnknownKm,
    strictTrailKm,
    longestTrailSegmentKm,
    targetPavedKm,
    targetExplicitPavedKm,
    busyRoadKm,
  };
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
  const semantics = classifyEdgeSemanticsV3(edge.edge);
  const naturalDwellKm = state.naturalDwellKm + (isTarget && semantics.routeSurface !== 'paved' ? edgeLengthKm * semantics.candidateNaturalWeight : 0);
  return {
    current: edge.to,
    traversal: [...state.traversal, edge],
    usedEdgeCounts,
    distanceKm: state.distanceKm + edgeLengthKm,
    naturalDwellKm,
    enteredTarget: state.enteredTarget || isTarget,
    source: state.source,
  };
}

function stateFromTraversal(startNodeId: string, traversal: TraversalEdgeV3[], intent: RouteIntentV3, source = 'frontier'): GraphCandidateStateV3 {
  return traversal.reduce<GraphCandidateStateV3>(
    (state, edge) => advanceState(state, edge, intent),
    { current: startNodeId, traversal: [], usedEdgeCounts: new Map(), distanceKm: 0, naturalDwellKm: 0, enteredTarget: false, source },
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
    .slice(0, 8);
  const desiredRecoveryDistanceKm = intent.constraints.targetDistanceKm * 0.65;
  const maxRecoverySeedDistanceKm = intent.constraints.targetDistanceKm * 0.95;
  const distanceRecoverySeeds = [...targetCandidates]
    .filter((candidate) => candidate.distanceKm <= maxRecoverySeedDistanceKm + 0.001)
    .sort(
      (a, b) =>
        Math.abs(a.distanceKm - desiredRecoveryDistanceKm) - Math.abs(b.distanceKm - desiredRecoveryDistanceKm) ||
        b.capacityKm - a.capacityKm,
    )
    .slice(0, 8);

  return dedupeTraversals([nearestViableTarget, ...highCapacitySeeds, ...distanceRecoverySeeds].map((candidate) => candidate.traversal)).slice(0, 16);
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
  const capacityCache = new Map<string, number>();
  let capacityProbeCount = 0;
  const maxCapacityProbes = 192;

  while (pending.length > 0) {
    const current = pending.sort((a, b) => a.distanceKm - b.distanceKm).shift();
    if (!current) break;
    if (current.distanceKm > (bestDistances.get(current.nodeId) ?? Number.POSITIVE_INFINITY) + 0.000001) continue;

    for (const edge of adjacency.get(current.nodeId) ?? []) {
      const nextDistanceKm = current.distanceKm + Math.max(0, edge.edge.lengthKm);
      const traversal = [...current.traversal, edge];
      if (intent.constraints.targetComponents.includes(edge.kind) && edge.surface !== 'paved' && edge.to !== startNodeId) {
        const capacityCacheKey = `${edge.kind}:${edge.to}:${edge.from}`;
        let capacityKm = capacityCache.get(capacityCacheKey);
        if (capacityKm == null && capacityProbeCount < maxCapacityProbes) {
          capacityProbeCount += 1;
          capacityKm = reachableTargetDwellKmFrom(edge.to, edge.from, adjacency, intent);
          capacityCache.set(capacityCacheKey, capacityKm);
        }
        targetCandidates.push({
          distanceKm: nextDistanceKm,
          traversal,
          capacityKm: capacityKm ?? 0,
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
  return state.traversal.reduce((total, edge) => total + Math.max(0, edge.edge.lengthKm) * classifyEdgeSemanticsV3(edge.edge).pavedEquivalentWeight, 0);
}

function weightedConnectorCost(edge: TraversalEdgeV3): number {
  const lengthKm = Math.max(0, edge.edge.lengthKm);
  const semantics = classifyEdgeSemanticsV3(edge.edge);
  if (semantics.pavedEquivalentWeight >= 1) return lengthKm * 3.5;
  if (semantics.routeSurface === 'mixed') return lengthKm * 1.35;
  return lengthKm;
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

function targetRepeatWithinAdjustedEvidence(state: GraphCandidateStateV3, intent: RouteIntentV3): boolean {
  return isAdjustedTargetRepeatWithinEvidenceBudgetV3({
    repeatedKm: targetRepeatKm(state, intent),
    distanceKm: state.distanceKm,
    targetDistanceKm: intent.constraints.targetDistanceKm,
  });
}

export function isAdjustedTargetRepeatWithinEvidenceBudgetV3(input: {
  repeatedKm: number;
  distanceKm: number;
  targetDistanceKm: number;
}): boolean {
  if (input.repeatedKm <= 0.001) return true;
  const missionDerivedRepeatBudgetKm = Math.max(0.5, input.targetDistanceKm * 0.08);
  return input.repeatedKm <= missionDerivedRepeatBudgetKm + 0.001
    && input.repeatedKm / Math.max(0.001, input.distanceKm) <= 0.08;
}

export function isAdjustedMixedUnknownWithinEvidenceBudgetV3(input: {
  mixedUnknownKm: number;
  strictTrailKm: number;
  targetDistanceKm: number;
}): boolean {
  return input.mixedUnknownKm <= adjustedMixedUnknownBudgetKm(input.strictTrailKm, input.targetDistanceKm) + 0.001;
}

function adjustedMixedUnknownBudgetKm(strictTrailKm: number, targetDistanceKm: number): number {
  return Math.max(1.25, strictTrailKm * 2, targetDistanceKm * 0.6);
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
    const kind = classifyComponentKind(edge);
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
  return classifyEdgeSemanticsV3(edge).routeSurface;
}

function classifyComponentKind(edge: EnrichedEdge): TerrainComponentKindV3 {
  return classifyEdgeSemanticsV3(edge).componentKind;
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
