import type { EnrichedEdge, EnrichedGraph } from '../../types';
import { classifyEdgeSemanticsV3 } from '../edge-semantics';
import {
  buildForestLoopRouteContractV3,
  precheckForestLoopRouteContractV3,
  type RouteContractPrecheckV3,
} from '../contracts/route-contract';
import type {
  AssemblerResultV3,
  AssemblyPhaseDiagnosticsV3,
  CandidatePortfolioV3,
  MissionContractV3,
  RouteCandidateV3,
} from '../contracts';
import type { AssembledRouteV3, CorridorMissionV3, RouteIntentV3, RouteMetricsV3 } from '../types';
import { normalizeCandidatePortfolioV3, selectCandidateFromPortfolioV3 } from './candidate-portfolio';
import { assembleGraphRouteWithStrategyV3 } from './graph-route-assembly-core';
import { buildTerrainInventoryV3, type TerrainInventoryComponentV3 } from './terrain-inventory';

interface OrientedStepV3 {
  edge: EnrichedEdge;
  from: string;
  to: string;
}

interface NaturalComponentEdgesV3 {
  componentId: string;
  edges: EnrichedEdge[];
  nodeIds: Set<string>;
}

export function assembleForestLoopGraphRouteV3(
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  graph: EnrichedGraph,
): AssembledRouteV3 {
  return assembleGraphRouteWithStrategyV3(intent, mission, graph, {
    mode: 'forest_loop',
    warning: 'forest_loop keeps the route inside proven natural forest/path terrain when available',
  });
}

export function assembleForestLoopMissionV3(
  graph: EnrichedGraph,
  mission: MissionContractV3,
): AssemblerResultV3 {
  const startNodeId = closestNodeId(graph, mission.request.start) ?? firstNodeId(graph);
  if (!startNodeId) return noCandidateResult(mission, 'no_start_node', 'access');
  const scenicDiagnostics = scenicPavedDiagnosticCandidates(mission, graph);

  const inventory = buildTerrainInventoryV3({
    graph,
    startNodeId,
    targetComponentIds: mission.target.componentKinds,
  });
  const routeContract = buildForestLoopRouteContractV3({
    requestedDistanceKm: mission.request.targetDistanceKm,
    targetComponentIds: mission.target.componentKinds,
  });
  const precheck = precheckForestLoopRouteContractV3({ contract: routeContract, inventory });
  const selectedComponent = precheck.selectedComponent;

  if (!selectedComponent) return noCandidateResult(mission, 'no_loopable_component', 'access', precheck, null, scenicDiagnostics);
  if (!selectedComponent.corePortalNodeId || selectedComponent.estimatedClosureCostKm === null) {
    return noCandidateResult(mission, 'no_two_core_clean_closure', 'closure', precheck, selectedComponent, scenicDiagnostics);
  }

  const component = naturalComponents(graph, mission.target.componentKinds).find(
    (candidate) => candidate.componentId === selectedComponent.componentId,
  );
  if (!component) return noCandidateResult(mission, 'selected_component_edges_missing', 'target_dwell', precheck, selectedComponent, scenicDiagnostics);

  const access = shortestPath(graph, startNodeId, selectedComponent.portalNodeId ?? selectedComponent.corePortalNodeId);
  if (!access) return noCandidateResult(mission, 'component_portal_unreachable', 'access', precheck, selectedComponent, scenicDiagnostics);

  const portalToCore = (selectedComponent.portalNodeId && selectedComponent.portalNodeId !== selectedComponent.corePortalNodeId)
    ? shortestPath(graph, selectedComponent.portalNodeId, selectedComponent.corePortalNodeId, new Set(component.edges.map((edge) => edge.id)))
    : [];
  if (!portalToCore) return noCandidateResult(mission, 'core_portal_unreachable', 'access', precheck, selectedComponent, scenicDiagnostics);

  const coreSteps = orderedCoreLoopSteps(component.edges, selectedComponent.corePortalNodeId);
  if (coreSteps.length === 0 || coreSteps.at(-1)?.to !== selectedComponent.corePortalNodeId) {
    return noCandidateResult(mission, 'no_two_core_clean_closure', 'closure', precheck, selectedComponent, scenicDiagnostics);
  }

  const steps = [
    ...access,
    ...portalToCore,
    ...coreSteps,
    ...reverseSteps(portalToCore),
    ...reverseSteps(access),
  ];
  const metrics = metricsFromSteps(steps, mission.request.targetDistanceKm);
  const contractAdjusted = precheck.status === 'adjusted_plausible';
  const hardFailures = forestLoopGateFailures(metrics, mission, contractAdjusted);
  if (hardFailures.length > 0) {
    const rejectedCandidate = createCandidate({
      id: `${mission.id}-forest-loop-contract-rejected`,
      steps,
      graph,
      lane: 'diagnostic_only',
      source: 'strategy_assembler',
      mission,
      selectedComponent,
      selectionScore: metrics.distanceProducedKm,
      rejectedReason: hardFailures[0],
    });
    return noCandidateResult(mission, hardFailures[0], 'final_gate', precheck, selectedComponent, [rejectedCandidate, ...scenicDiagnostics]);
  }

  const lane: RouteCandidateV3['lane'] = contractAdjusted ? 'complete_adjustable' : 'complete_valid';
  const validCandidate = createCandidate({
    id: `${mission.id}-component-first-forest-loop`,
    steps,
    graph,
    lane,
    source: 'strategy_assembler',
    mission,
    selectedComponent,
    selectionScore: forestLoopSelectionScore(metrics, selectedComponent, precheck),
    adjusted: contractAdjusted,
  });
  const portfolio = normalizeCandidatePortfolioV3({
    missionId: mission.id,
    candidates: [validCandidate, ...scenicDiagnostics],
    selectedCandidateId: validCandidate.id,
    topRejected: scenicDiagnostics,
    counts: emptyPortfolioCounts(),
    diagnostics: { firstDropStage: null, blocker: null, phaseBlockers: {} },
  });
  const selectedCandidate = selectCandidateFromPortfolioV3(portfolio);

  return {
    mission,
    status: 'portfolio_ready',
    portfolio,
    selectedCandidate,
    phaseDiagnostics: createPhaseDiagnostics(mission, selectedCandidate, null, selectedComponent, precheck),
    diagnostics: {
      startNodeId,
      targetEntryAttempted: true,
      targetEntrySucceeded: selectedCandidate !== null,
      closureAttempted: true,
      closureSucceeded: selectedCandidate !== null,
      firstDropStage: null,
      blocker: null,
      observationOnly: {
        routeContractStatus: precheck.status,
        selectedComponentId: selectedComponent.componentId,
        selectedPortalNodeId: selectedComponent.portalNodeId,
        selectedCorePortalNodeId: selectedComponent.corePortalNodeId,
        terrainInventoryScope: inventory.scope,
      },
    },
    warnings: contractAdjusted ? ['forest_loop_route_contract_adjusted_plausible'] : [],
  };
}

function noCandidateResult(
  mission: MissionContractV3,
  blocker: string,
  phase: 'access' | 'target_dwell' | 'closure' | 'final_gate',
  precheck?: RouteContractPrecheckV3,
  selectedComponent?: TerrainInventoryComponentV3 | null,
  candidates: RouteCandidateV3[] = [],
): AssemblerResultV3 {
  const portfolio = normalizeCandidatePortfolioV3({
    missionId: mission.id,
    candidates,
    selectedCandidateId: null,
    topRejected: candidates,
    counts: emptyPortfolioCounts(),
    diagnostics: { firstDropStage: phase, blocker, phaseBlockers: { [phase]: [blocker] } },
  });

  return {
    mission,
    status: 'no_candidate',
    portfolio,
    selectedCandidate: null,
    phaseDiagnostics: createPhaseDiagnostics(mission, null, blocker, selectedComponent ?? null, precheck),
    diagnostics: {
      startNodeId: null,
      targetEntryAttempted: true,
      targetEntrySucceeded: false,
      closureAttempted: phase === 'closure' || phase === 'final_gate',
      closureSucceeded: false,
      firstDropStage: phase,
      blocker,
      observationOnly: {
        routeContractStatus: precheck?.status ?? null,
        routeContractReasons: precheck?.reasons ?? [],
        selectedComponentId: selectedComponent?.componentId ?? null,
      },
    },
    warnings: [blocker],
  };
}

function createCandidate(input: {
  id: string;
  steps: OrientedStepV3[];
  graph: EnrichedGraph;
  lane: RouteCandidateV3['lane'];
  source: RouteCandidateV3['source'];
  mission: MissionContractV3;
  selectedComponent: TerrainInventoryComponentV3;
  selectionScore: number;
  rejectedReason?: string;
  adjusted?: boolean;
}): RouteCandidateV3 {
  const metrics = metricsFromSteps(input.steps, input.mission.request.targetDistanceKm);
  const nodeIds = nodeIdsFromSteps(input.steps);
  const gates: RouteCandidateV3['gates'] = input.rejectedReason
    ? [{ id: input.rejectedReason, status: 'fail', severity: 'hard', reason: input.rejectedReason }]
    : input.adjusted
      ? [{ id: 'forest_loop_route_contract_adjusted', status: 'pass', severity: 'soft' }]
      : [{ id: 'forest_loop_route_contract_generated', status: 'pass', severity: 'info' }];

  return {
    id: input.id,
    source: input.source,
    lane: input.lane,
    lifecycle: input.rejectedReason ? 'rejected' : 'gated',
    edgeIds: input.steps.map((step) => step.edge.id),
    nodeIds,
    geometry: {
      type: 'LineString',
      coordinates: nodeIds.map((nodeId) => {
        const node = input.graph.nodes.get(nodeId);
        return node ? [node.lng, node.lat] : [input.graph.center.lng, input.graph.center.lat];
      }),
    },
    targetComponentIds: [input.selectedComponent.componentId],
    targetComponentKinds: input.mission.target.componentKinds,
    returned: input.rejectedReason ? false : true,
    metrics,
    gates,
    selectionScore: input.selectionScore,
    selected: false,
    rejectedReason: input.rejectedReason,
    selectedReason: input.adjusted ? 'component_first_adjusted_contract' : 'component_first_generated_contract',
  };
}

function forestLoopGateFailures(metrics: RouteMetricsV3, mission: MissionContractV3, contractAdjusted: boolean): string[] {
  const failures: string[] = [];
  if (metrics.pavedRatio > mission.budgets.maxPavedRatio) failures.push('paved_ratio_exceeds_forest_loop_budget');
  if (metrics.naturalDwellKm < mission.target.minNaturalDwellKm && !contractAdjusted) failures.push('target_dwell_below_forest_loop_contract');
  if (metrics.distanceProducedKm < mission.request.minDistanceKm) failures.push('distance_below_minimum');
  if (metrics.distanceProducedKm > mission.request.maxDistanceKm) failures.push('distance_above_maximum');
  return failures;
}

function forestLoopSelectionScore(
  metrics: RouteMetricsV3,
  component: TerrainInventoryComponentV3,
  precheck: RouteContractPrecheckV3,
): number {
  const contractBonus = precheck.status === 'generated_plausible' ? 100 : 50;
  return contractBonus + metrics.naturalDwellKm * 4 - metrics.pavedKm * 8 + component.estimatedLoopableNaturalKm;
}

function scenicPavedDiagnosticCandidates(mission: MissionContractV3, graph: EnrichedGraph): RouteCandidateV3[] {
  const scenicPavedEdges = Array.from(graph.edges.values()).filter((edge) => {
    const semantics = classifyEdgeSemanticsV3(edge);
    return semantics.componentKind === 'scenic_paved' && semantics.surfaceEvidence === 'explicit_paved';
  });
  if (scenicPavedEdges.length === 0) return [];

  const steps = scenicPavedEdges.map((edge) => ({ edge, from: edge.from, to: edge.to }));
  const nodeIds = nodeIdsFromSteps(steps);
  return [{
    id: `${mission.id}-scenic-paved-diagnostic`,
    source: 'diagnostic',
    lane: 'connector_heavy',
    lifecycle: 'rejected',
    edgeIds: scenicPavedEdges.map((edge) => edge.id),
    nodeIds,
    geometry: {
      type: 'LineString',
      coordinates: nodeIds.map((nodeId) => {
        const node = graph.nodes.get(nodeId);
        return node ? [node.lng, node.lat] : [graph.center.lng, graph.center.lat];
      }),
    },
    targetComponentIds: mission.target.componentIds,
    targetComponentKinds: mission.target.componentKinds,
    returned: false,
    metrics: metricsFromSteps(steps, mission.request.targetDistanceKm),
    gates: [{ id: 'dominant_paved_scenic_core', status: 'fail', severity: 'hard', reason: 'dominant_paved_scenic_core' }],
    selectionScore: -sumLengthKm(scenicPavedEdges),
    selected: false,
    rejectedReason: 'dominant_paved_scenic_core',
  }];
}

function naturalComponents(graph: EnrichedGraph, targetKinds: MissionContractV3['target']['componentKinds']): NaturalComponentEdgesV3[] {
  const edges = Array.from(graph.edges.values()).filter((edge) => {
    const semantics = classifyEdgeSemanticsV3(edge);
    return targetKinds.includes(semantics.componentKind) && semantics.routeSurface !== 'paved' && semantics.candidateNaturalWeight > 0;
  });
  const adjacency = new Map<string, EnrichedEdge[]>();
  for (const edge of edges) {
    push(adjacency, edge.from, edge);
    push(adjacency, edge.to, edge);
  }

  const visited = new Set<string>();
  const components: NaturalComponentEdgesV3[] = [];
  for (const edge of edges) {
    if (visited.has(edge.id)) continue;
    const edgeIds = new Set<string>();
    const nodeIds = new Set<string>();
    const stack = [edge.from, edge.to];
    while (stack.length > 0) {
      const nodeId = stack.pop();
      if (!nodeId) continue;
      nodeIds.add(nodeId);
      for (const adjacentEdge of adjacency.get(nodeId) ?? []) {
        if (edgeIds.has(adjacentEdge.id)) continue;
        edgeIds.add(adjacentEdge.id);
        visited.add(adjacentEdge.id);
        stack.push(adjacentEdge.from === nodeId ? adjacentEdge.to : adjacentEdge.from);
      }
    }
    components.push({
      componentId: `terrain-component-${components.length + 1}`,
      nodeIds,
      edges: edges.filter((candidate) => edgeIds.has(candidate.id)),
    });
  }
  return components;
}

function orderedCoreLoopSteps(edges: EnrichedEdge[], startNodeId: string): OrientedStepV3[] {
  const coreNodeIds = twoCoreNodes(edges);
  if (!coreNodeIds.has(startNodeId)) return [];
  const coreEdges = edges.filter((edge) => coreNodeIds.has(edge.from) && coreNodeIds.has(edge.to));
  const adjacency = new Map<string, EnrichedEdge[]>();
  for (const edge of coreEdges) {
    push(adjacency, edge.from, edge);
    push(adjacency, edge.to, edge);
  }

  const steps: OrientedStepV3[] = [];
  const used = new Set<string>();
  let current = startNodeId;
  while (used.size < coreEdges.length) {
    const next = (adjacency.get(current) ?? []).find((edge) => !used.has(edge.id));
    if (!next) break;
    used.add(next.id);
    const to = next.from === current ? next.to : next.from;
    steps.push({ edge: next, from: current, to });
    current = to;
  }

  return current === startNodeId ? steps : [];
}

function twoCoreNodes(edges: EnrichedEdge[]): Set<string> {
  const adjacency = new Map<string, Set<string>>();
  for (const edge of edges) {
    pushSet(adjacency, edge.from, edge.to);
    pushSet(adjacency, edge.to, edge.from);
  }
  const remaining = new Set(adjacency.keys());
  let changed = true;
  while (changed) {
    changed = false;
    for (const nodeId of Array.from(remaining)) {
      const degree = Array.from(adjacency.get(nodeId) ?? []).filter((candidate) => remaining.has(candidate)).length;
      if (degree < 2) {
        remaining.delete(nodeId);
        changed = true;
      }
    }
  }
  return remaining;
}

function shortestPath(
  graph: EnrichedGraph,
  from: string,
  to: string,
  allowedEdgeIds?: Set<string>,
): OrientedStepV3[] | null {
  if (from === to) return [];
  const distances = new Map<string, number>([[from, 0]]);
  const previous = new Map<string, { nodeId: string; edge: EnrichedEdge }>();
  const visited = new Set<string>();

  while (visited.size < distances.size) {
    let current: string | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const [nodeId, distance] of Array.from(distances.entries())) {
      if (!visited.has(nodeId) && distance < best) {
        current = nodeId;
        best = distance;
      }
    }
    if (!current) break;
    if (current === to) break;
    visited.add(current);

    const node = graph.nodes.get(current);
    for (const edgeId of node?.edges ?? []) {
      if (allowedEdgeIds && !allowedEdgeIds.has(edgeId)) continue;
      const edge = graph.edges.get(edgeId);
      if (!edge) continue;
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : null;
      if (!next || visited.has(next)) continue;
      const nextDistance = (distances.get(current) ?? 0) + Math.max(0, edge.lengthKm);
      if (nextDistance < (distances.get(next) ?? Number.POSITIVE_INFINITY)) {
        distances.set(next, nextDistance);
        previous.set(next, { nodeId: current, edge });
      }
    }
  }

  if (!previous.has(to)) return null;
  const reversed: OrientedStepV3[] = [];
  let current = to;
  while (current !== from) {
    const entry = previous.get(current);
    if (!entry) return null;
    reversed.push({ edge: entry.edge, from: entry.nodeId, to: current });
    current = entry.nodeId;
  }
  return reversed.reverse();
}

function reverseSteps(steps: OrientedStepV3[]): OrientedStepV3[] {
  return [...steps].reverse().map((step) => ({ edge: step.edge, from: step.to, to: step.from }));
}

function nodeIdsFromSteps(steps: OrientedStepV3[]): string[] {
  if (steps.length === 0) return [];
  return [steps[0].from, ...steps.map((step) => step.to)];
}

function metricsFromSteps(steps: OrientedStepV3[], targetDistanceKm: number): RouteMetricsV3 {
  const edges = steps.map((step) => step.edge);
  const distanceProducedKm = round(sumLengthKm(edges));
  const strictTrailKm = round(sumLengthKm(edges.filter((edge) => classifyEdgeSemanticsV3(edge).isStrictTrailLike)));
  const explicitPavedKm = round(sumLengthKm(edges.filter((edge) => classifyEdgeSemanticsV3(edge).surfaceEvidence === 'explicit_paved')));
  const explicitNaturalKm = round(sumLengthKm(edges.filter((edge) => classifyEdgeSemanticsV3(edge).surfaceEvidence === 'explicit_natural')));
  const targetRepeatKm = round(repeatedLengthKm(steps.filter((step) => classifyEdgeSemanticsV3(step.edge).routeSurface !== 'paved')));
  const connectorRepeatKm = round(repeatedLengthKm(steps.filter((step) => classifyEdgeSemanticsV3(step.edge).routeSurface === 'paved')));
  const repeatEdgeKm = round(targetRepeatKm + connectorRepeatKm);
  const visitedComponents = Array.from(new Set(edges.map((edge) => classifyEdgeSemanticsV3(edge).componentKind)));

  return {
    targetDistanceKm,
    distanceProducedKm,
    strictTrailKm,
    explicitNaturalKm,
    explicitPavedKm,
    roadLikeUnknownKm: 0,
    pathTrackUnknownKm: 0,
    candidateNaturalKm: explicitNaturalKm,
    trailCandidateKm: strictTrailKm,
    unverifiedTrailCandidateKm: 0,
    trailRatio: ratio(strictTrailKm, distanceProducedKm),
    naturalWayRatio: ratio(explicitNaturalKm, distanceProducedKm),
    pavedRatio: ratio(explicitPavedKm, distanceProducedKm),
    pavedKm: explicitPavedKm,
    nonPavedKm: round(Math.max(0, distanceProducedKm - explicitPavedKm)),
    naturalDwellKm: explicitNaturalKm,
    repeatEdgeKm,
    targetRepeatKm,
    connectorRepeatKm,
    visitedComponents,
    repeatRatio: ratio(repeatEdgeKm, distanceProducedKm),
    overlapRatio: 0,
    busyRoadRatio: 0,
    loopClosureKm: 0,
    longestTrailSegmentKm: strictTrailKm,
  };
}

function repeatedLengthKm(steps: OrientedStepV3[]): number {
  const counts = new Map<string, { count: number; lengthKm: number }>();
  for (const step of steps) {
    const value = counts.get(step.edge.id) ?? { count: 0, lengthKm: step.edge.lengthKm };
    value.count += 1;
    counts.set(step.edge.id, value);
  }
  return Array.from(counts.values()).reduce((sum, value) => sum + Math.max(0, value.count - 1) * value.lengthKm, 0);
}

function createPhaseDiagnostics(
  mission: MissionContractV3,
  selectedCandidate: RouteCandidateV3 | null,
  blocker?: string | null,
  selectedComponent?: TerrainInventoryComponentV3 | null,
  precheck?: RouteContractPrecheckV3,
): AssemblyPhaseDiagnosticsV3 {
  const metrics = selectedCandidate?.metrics;
  const phase = blocker === 'no_two_core_clean_closure' ? 'closure' : blocker ? 'final_gate' : null;

  return {
    access: {
      status: selectedComponent ? 'success' : blocker ? 'failure' : 'not_applicable',
      accessKm: selectedComponent?.accessDistanceKm ?? 0,
      accessPavedKm: selectedComponent?.accessPavedKm ?? 0,
      entryNodeId: selectedComponent?.portalNodeId ?? null,
      componentId: selectedComponent?.componentId ?? null,
      rejectedEntryReasons: {},
    },
    dwell: {
      status: metrics ? 'success' : precheck?.status === 'adjusted_plausible' ? 'partial' : blocker ? 'failure' : 'not_applicable',
      targetDwellKm: metrics?.naturalDwellKm ?? selectedComponent?.estimatedLoopableNaturalKm ?? 0,
      requestedTargetDwellKm: mission.target.minNaturalDwellKm,
      longestTrailSegmentKm: metrics?.longestTrailSegmentKm ?? selectedComponent?.bestNaturalSkeletonKm ?? 0,
      cleanExploitableKm: selectedComponent?.estimatedLoopableNaturalKm ?? metrics?.naturalDwellKm ?? 0,
      targetRepeatKm: metrics?.targetRepeatKm ?? 0,
    },
    recovery: {
      status: metrics ? 'success' : 'not_attempted',
      recoveredDistanceKm: metrics?.distanceProducedKm ?? 0,
      recoveryPavedKm: 0,
      recoveryRejectedReasons: {},
    },
    closure: {
      status: metrics ? 'success' : phase === 'closure' ? 'failure' : 'not_attempted',
      closureKm: selectedComponent?.estimatedClosureCostKm ?? 0,
      closurePavedKm: selectedComponent?.accessPavedKm ?? 0,
      connectorRepeatKm: metrics?.connectorRepeatKm ?? 0,
      targetRepeatKm: metrics?.targetRepeatKm ?? 0,
      closureRejectedReasons: phase === 'closure' && blocker ? { [blocker]: 1 } : {},
    },
    finalGate: {
      status: metrics ? 'candidate_ready' : 'no_selectable_candidate',
      distanceKm: metrics?.distanceProducedKm ?? 0,
      finalPavedRatioEstimate: metrics?.pavedRatio ?? 0,
      trailRatio: metrics?.trailRatio ?? 0,
      naturalWayRatio: metrics?.naturalWayRatio ?? 0,
      pavedRatio: metrics?.pavedRatio ?? 0,
      gateFailures: blocker ? [blocker] : [],
    },
  };
}

function emptyPortfolioCounts(): CandidatePortfolioV3['counts'] {
  return {
    complete_valid: 0,
    complete_adjustable: 0,
    progress_no_closure: 0,
    dwell_only: 0,
    connector_heavy: 0,
    diagnostic_only: 0,
    negative_evidence: 0,
    discovered: 0,
    closed: 0,
    inEnvelope: 0,
    rejected: 0,
  };
}

function closestNodeId(graph: EnrichedGraph, point: { lat: number; lng: number }): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const node of Array.from(graph.nodes.values())) {
    const distance = Math.hypot(node.lat - point.lat, node.lng - point.lng);
    if (!best || distance < best.distance) best = { id: node.id, distance };
  }
  return best?.id ?? null;
}

function firstNodeId(graph: EnrichedGraph): string | null {
  return graph.nodes.keys().next().value ?? null;
}

function sumLengthKm(edges: EnrichedEdge[]): number {
  return edges.reduce((sum, edge) => sum + Math.max(0, edge.lengthKm), 0);
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? round(numerator / denominator) : 0;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key) ?? [];
  values.push(value);
  map.set(key, values);
}

function pushSet<K, V>(map: Map<K, Set<V>>, key: K, value: V): void {
  const values = map.get(key) ?? new Set<V>();
  values.add(value);
  map.set(key, values);
}
