import type { EnrichedEdge, EnrichedGraph } from '../../types';
import { classifyEdgeSemanticsV3 } from '../edge-semantics';
import type {
  AssemblerResultV3,
  AssemblyPhaseDiagnosticsV3,
  CandidatePortfolioV3,
  MissionContractV3,
  RouteCandidateV3,
} from '../contracts';
import type { AssembledRouteV3, CorridorMissionV3, RouteIntentV3, RouteMetricsV3 } from '../types';
import { createNoCandidateAssemblerResultV3 } from './assembler-result-factory';
import { normalizeCandidatePortfolioV3, selectCandidateFromPortfolioV3 } from './candidate-portfolio';
import { assembleGraphRouteWithStrategyV3 } from './graph-route-assembly-core';

export function assembleTransitionToWoodsGraphRouteV3(
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  graph: EnrichedGraph,
): AssembledRouteV3 {
  return assembleGraphRouteWithStrategyV3(intent, mission, graph, {
    mode: 'transition_to_woods',
    requireNaturalDwell: true,
    warning: 'transition_to_woods allows paved access only as a connector before requiring real non-paved woods dwell',
  });
}

export function assembleTransitionToWoodsMissionV3(
  graph: EnrichedGraph,
  mission: MissionContractV3,
): AssemblerResultV3 {
  const startNodeId = closestNodeId(graph, mission.request.start) ?? firstNodeId(graph);
  const targetEdges = Array.from(graph.edges.values()).filter((edge) => {
    const semantics = classifyEdgeSemanticsV3(edge);
    return mission.target.componentKinds.includes(semantics.componentKind)
      && semantics.routeSurface !== 'paved'
      && semantics.isTrailCandidate;
  });
  const targetNodeIds = nodeSetFromEdges(targetEdges);
  const accessPaths = accessPathsToTargetNodes(graph, startNodeId, targetNodeIds, mission.budgets.maxAccessPavedKm);
  const eligiblePlans: TransitionRoutePlan[] = [];
  for (const candidateAccessPath of accessPaths) {
    const entryNodeId = candidateAccessPath.nodeIds.at(-1) ?? startNodeId;
    const candidatePlans = transitionRoutePlansFromEntry(graph, startNodeId, candidateAccessPath, entryNodeId, targetEdges, mission);
    for (const candidatePlan of candidatePlans) {
      if (candidatePlan.targetRoute.naturalDwellKm < mission.target.minNaturalDwellKm) continue;
      eligiblePlans.push(candidatePlan);
    }
  }
  const returnedPlans = eligiblePlans.filter((plan) => planReturnsToStart(plan));
  const selectedPlan = (returnedPlans.length > 0 ? returnedPlans : eligiblePlans)
    .sort((left, right) => scoreTransitionPlan(right, mission) - scoreTransitionPlan(left, mission))[0] ?? null;
  const selectedAccessPath = selectedPlan?.accessPath ?? null;
  const targetRoute = selectedPlan?.targetRoute ?? null;
  const closurePath = selectedPlan?.closurePath ?? null;
  const targetDwellKm = targetRoute?.naturalDwellKm ?? 0;

  if (!selectedAccessPath) {
    return createNoCandidateAssemblerResultV3(mission, accessPaths.length === 0 ? 'missing_access_connector_to_target' : 'insufficient_natural_target_dwell');
  }

  if (!targetRoute || !closurePath || targetDwellKm < mission.target.minNaturalDwellKm) {
    return createNoCandidateAssemblerResultV3(mission, 'insufficient_natural_target_dwell');
  }

  const routeEdges = [...selectedAccessPath.edges, ...targetRoute.edges, ...closurePath.edges];
  const routeNodeIds = [
    ...selectedAccessPath.nodeIds,
    ...targetRoute.nodeIds.slice(1),
    ...closurePath.nodeIds.slice(1),
  ];
  const isOpenLateral = closurePath.edges.length === 0 && routeNodeIds.at(-1) !== startNodeId;
  const lane: RouteCandidateV3['lane'] = isOpenLateral
    ? 'complete_adjustable'
    : sumLengthKm(routeEdges) >= mission.request.minDistanceKm ? 'complete_valid' : 'complete_adjustable';
  const topologyCandidates = uniqueTopologyPlans(eligiblePlans, mission).map((plan) => candidateFromTransitionPlan(plan, graph, mission));
  const validCandidate = topologyCandidates.find((candidate) => candidate.id === candidateIdFromPlan(selectedPlan, mission))
    ?? createCandidate({
      id: candidateIdFromPlan(selectedPlan, mission),
      edges: routeEdges,
      graph,
      lane,
      source: sourceFromPlan(selectedPlan, mission),
      mission,
      selectionScore: scoreTransitionPlan(selectedPlan, mission),
      nodeIds: routeNodeIds,
      selectedReason: topologyLaneFromPlan(selectedPlan, mission),
      returned: !isOpenLateral,
    });
  const accessEdgeIds = new Set(selectedAccessPath.edges.map((edge) => edge.id));
  const residentialDiagnosticEdges = Array.from(graph.edges.values()).filter((edge) => {
    const semantics = classifyEdgeSemanticsV3(edge);
    return semantics.componentKind === 'residential' && !accessEdgeIds.has(edge.id);
  });
  const diagnosticCandidates = residentialDiagnosticEdges.length > 0
    ? [createCandidate({
        id: `${mission.id}-residential-decoy-diagnostic`,
        edges: residentialDiagnosticEdges,
        graph,
        lane: 'connector_heavy',
        source: 'diagnostic',
        mission,
        selectionScore: -sumLengthKm(residentialDiagnosticEdges),
        rejectedReason: 'residential_connector_without_target_dwell',
      })]
    : [];
  const portfolio = normalizeCandidatePortfolioV3({
    missionId: mission.id,
    candidates: [validCandidate, ...topologyCandidates.filter((candidate) => candidate.id !== validCandidate.id), ...diagnosticCandidates],
    selectedCandidateId: validCandidate.id,
    topRejected: diagnosticCandidates,
    counts: emptyPortfolioCounts(),
    diagnostics: {
      firstDropStage: null,
      blocker: null,
      phaseBlockers: {},
    },
  });
  const selectedCandidate = selectCandidateFromPortfolioV3(portfolio);

  return {
    mission,
    status: 'portfolio_ready',
    portfolio,
    selectedCandidate,
    phaseDiagnostics: createPhaseDiagnostics(mission, selectedCandidate, {
      accessKm: selectedAccessPath.distanceKm,
      accessPavedKm: sumLengthKm(selectedAccessPath.edges.filter((edge) => classifyEdgeSemanticsV3(edge).surfaceEvidence === 'explicit_paved')),
      entryNodeId: selectedAccessPath.nodeIds.at(-1) ?? startNodeId,
      connectorRepeatKm: sumLengthKm(selectedAccessPath.edges),
    }),
    diagnostics: {
      startNodeId,
      targetEntryAttempted: true,
      targetEntrySucceeded: selectedCandidate !== null,
      closureAttempted: true,
      closureSucceeded: selectedCandidate !== null,
      firstDropStage: null,
      blocker: null,
      observationOnly: {
        rejectedResidentialConnectorCandidateCount: diagnosticCandidates.length,
        topologyLaneCounts: countTopologyLanes(topologyCandidates),
      },
    },
    warnings: ['transition_to_woods_used_paved_connector_before_natural_dwell'],
  };
}

function createCandidate(input: {
  id: string;
  edges: EnrichedEdge[];
  graph: EnrichedGraph;
  lane: RouteCandidateV3['lane'];
  source: RouteCandidateV3['source'];
  mission: MissionContractV3;
  selectionScore: number;
  rejectedReason?: string;
  nodeIds?: string[];
  selectedReason?: string;
  returned?: boolean;
}): RouteCandidateV3 {
  const nodeIds = input.nodeIds ?? nodeIdsFromEdges(input.edges);
  const metrics = metricsFromEdges(input.edges, input.mission.request.targetDistanceKm, input.mission);

  return {
    id: input.id,
    source: input.source,
    lane: input.lane,
    lifecycle: input.rejectedReason ? 'rejected' : 'gated',
    edgeIds: input.edges.map((edge) => edge.id),
    nodeIds,
    geometry: {
      type: 'LineString',
      coordinates: nodeIds.map((nodeId) => {
        const node = input.graph.nodes.get(nodeId);
        return node ? [node.lng, node.lat] : [input.graph.center.lng, input.graph.center.lat];
      }),
    },
    targetComponentIds: input.mission.target.componentIds,
    targetComponentKinds: input.mission.target.componentKinds,
    returned: input.returned ?? (input.rejectedReason ? false : true),
    metrics,
    gates: input.rejectedReason
      ? [{ id: input.rejectedReason, status: 'fail', severity: 'hard', reason: input.rejectedReason }]
      : [{ id: 'transition_to_woods_target_dwell_before_closure', status: 'pass', severity: 'info' }],
    selectionScore: input.selectionScore,
    selected: false,
    selectedReason: input.selectedReason,
    rejectedReason: input.rejectedReason,
  };
}

function nodeIdsFromEdges(edges: EnrichedEdge[]): string[] {
  if (edges.length === 0) return [];
  return [edges[0].from, ...edges.map((edge) => edge.to)];
}

type DirectedPath = { edges: EnrichedEdge[]; nodeIds: string[]; distanceKm: number };
type TargetLoop = { edges: EnrichedEdge[]; nodeIds: string[]; naturalDwellKm: number };
type TransitionRoutePlan = { accessPath: DirectedPath; targetRoute: TargetLoop; closurePath: DirectedPath };
type TopologyLaneV3 = 'clean_short' | 'long_dirty' | 'cycle_or_lateral';

function candidateFromTransitionPlan(
  plan: TransitionRoutePlan,
  graph: EnrichedGraph,
  mission: MissionContractV3,
): RouteCandidateV3 {
  const routeEdges = [...plan.accessPath.edges, ...plan.targetRoute.edges, ...plan.closurePath.edges];
  const routeNodeIds = [
    ...plan.accessPath.nodeIds,
    ...plan.targetRoute.nodeIds.slice(1),
    ...plan.closurePath.nodeIds.slice(1),
  ];
  const topologyLane = topologyLaneFromPlan(plan, mission);
  const returned = planReturnsToStart(plan);
  const lane: RouteCandidateV3['lane'] = returned && sumLengthKm(routeEdges) >= mission.request.minDistanceKm
    ? 'complete_valid'
    : returned ? 'complete_adjustable' : 'progress_no_closure';

  return createCandidate({
    id: candidateIdFromPlan(plan, mission),
    edges: routeEdges,
    graph,
    lane,
    source: sourceFromPlan(plan, mission),
    mission,
    selectionScore: scoreTransitionPlan(plan, mission),
    nodeIds: routeNodeIds,
    selectedReason: topologyLane,
    returned,
  });
}

function uniqueTopologyPlans(plans: TransitionRoutePlan[], mission: MissionContractV3): TransitionRoutePlan[] {
  const byTopologyLane = new Map<TopologyLaneV3, TransitionRoutePlan>();
  const extras: TransitionRoutePlan[] = [];

  for (const plan of plans.sort((left, right) => scoreTransitionPlan(right, mission) - scoreTransitionPlan(left, mission))) {
    const lane = topologyLaneFromPlan(plan, mission);
    if (!byTopologyLane.has(lane)) {
      byTopologyLane.set(lane, plan);
    } else if (extras.length < 3) {
      extras.push(plan);
    }
  }

  return [...Array.from(byTopologyLane.values()), ...extras].slice(0, 8);
}

function candidateIdFromPlan(plan: TransitionRoutePlan, mission: MissionContractV3): string {
  return `${mission.id}-${topologyLaneFromPlan(plan, mission)}-${edgeSignature(plan)}`;
}

function edgeSignature(plan: TransitionRoutePlan): string {
  return [...plan.accessPath.edges, ...plan.targetRoute.edges, ...plan.closurePath.edges]
    .map((edge) => edge.id.replace(/[^a-zA-Z0-9]+/g, '-'))
    .slice(0, 4)
    .join('-') || 'target';
}

function topologyLaneFromPlan(plan: TransitionRoutePlan, mission: MissionContractV3): TopologyLaneV3 {
  const routeEdges = [...plan.accessPath.edges, ...plan.targetRoute.edges, ...plan.closurePath.edges];
  const repeat = repeatedLengthByKind(routeEdges, mission);
  const distanceKm = sumLengthKm(routeEdges);
  const targetRepeatRatio = ratio(repeat.targetRepeatKm, distanceKm);
  if (repeat.targetRepeatKm > mission.budgets.maxTargetRepeatKm && targetRepeatRatio > mission.budgets.maxOverlapRatio) return 'long_dirty';
  if (distanceKm >= mission.request.minDistanceKm * 0.95) return 'cycle_or_lateral';
  if (distanceKm < mission.request.minDistanceKm) return 'clean_short';
  return 'cycle_or_lateral';
}

function planReturnsToStart(plan: TransitionRoutePlan): boolean {
  const startNodeId = plan.accessPath.nodeIds[0];
  const lastNodeId = plan.closurePath.nodeIds.at(-1) ?? plan.targetRoute.nodeIds.at(-1);
  return Boolean(startNodeId && lastNodeId === startNodeId);
}

function sourceFromPlan(plan: TransitionRoutePlan, mission: MissionContractV3): RouteCandidateV3['source'] {
  return topologyLaneFromPlan(plan, mission) === 'cycle_or_lateral' ? 'cycle_chain' : 'strategy_assembler';
}

function countTopologyLanes(candidates: RouteCandidateV3[]): Record<TopologyLaneV3, number> {
  return candidates.reduce<Record<TopologyLaneV3, number>>((counts, candidate) => {
    const lane = (candidate.selectedReason ?? 'clean_short') as TopologyLaneV3;
    counts[lane] += 1;
    return counts;
  }, { clean_short: 0, long_dirty: 0, cycle_or_lateral: 0 });
}

function closestNodeId(graph: EnrichedGraph, point: { lat: number; lng: number }): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const node of Array.from(graph.nodes.values())) {
    const distance = Math.hypot(node.lat - point.lat, node.lng - point.lng);
    if (!best || distance < best.distance) best = { id: node.id, distance };
  }
  return best?.id ?? null;
}

function nodeSetFromEdges(edges: EnrichedEdge[]): Set<string> {
  const nodes = new Set<string>();
  for (const edge of edges) {
    nodes.add(edge.from);
    nodes.add(edge.to);
  }
  return nodes;
}

function accessPathsToTargetNodes(
  graph: EnrichedGraph,
  startNodeId: string,
  targetNodeIds: Set<string>,
  maxDistanceKm: number,
): DirectedPath[] {
  if (targetNodeIds.has(startNodeId)) return [{ edges: [], nodeIds: [startNodeId], distanceKm: 0 }];

  const queue: DirectedPath[] = [{ edges: [], nodeIds: [startNodeId], distanceKm: 0 }];
  const bestDistanceByNode = new Map<string, number>([[startNodeId, 0]]);
  const matches: DirectedPath[] = [];

  while (queue.length > 0 && matches.length < 80) {
    queue.sort((left, right) => left.distanceKm - right.distanceKm);
    const current = queue.shift();
    if (!current) break;
    const nodeId = current.nodeIds.at(-1) ?? startNodeId;
    if (targetNodeIds.has(nodeId)) {
      matches.push(current);
      continue;
    }

    for (const next of adjacentEdges(graph, nodeId)) {
      const semantics = classifyEdgeSemanticsV3(next.edge);
      if (!semantics.isConnectorLike) continue;
      const distanceKm = current.distanceKm + next.edge.lengthKm;
      if (distanceKm > maxDistanceKm + 0.001) continue;
      if ((bestDistanceByNode.get(next.to) ?? Infinity) <= distanceKm + 0.001) continue;
      bestDistanceByNode.set(next.to, distanceKm);
      queue.push({
        edges: [...current.edges, next.edge],
        nodeIds: [...current.nodeIds, next.to],
        distanceKm,
      });
    }
  }

  return matches.sort((left, right) => left.distanceKm - right.distanceKm);
}

function transitionRoutePlansFromEntry(
  graph: EnrichedGraph,
  startNodeId: string,
  accessPath: DirectedPath,
  entryNodeId: string,
  targetEdges: EnrichedEdge[],
  mission: MissionContractV3,
): TransitionRoutePlan[] {
  const plans: TransitionRoutePlan[] = [];
  const multiCycleChain = findTargetMultiCycleChainFromEntry(graph, entryNodeId, targetEdges, mission, accessPath);
  if (multiCycleChain) {
    plans.push({
      accessPath,
      targetRoute: multiCycleChain,
      closurePath: reversePath(accessPath),
    });
  }

  const loop = findTargetLoopFromEntry(graph, entryNodeId, targetEdges, mission);
  if (loop) {
    plans.push({
      accessPath,
      targetRoute: loop,
      closurePath: reversePath(accessPath),
    });
  }

  const lateralRoutes = findTargetLateralRoutesFromEntry(graph, entryNodeId, targetEdges, mission);
  for (const lateralRoute of lateralRoutes) {
    const exitNodeId = lateralRoute.nodeIds.at(-1) ?? entryNodeId;
    const closurePath = connectorPathBetweenNodes(graph, exitNodeId, startNodeId, mission.budgets.maxClosurePavedKm + mission.budgets.maxConnectorRepeatKm);
    plans.push({
      accessPath,
      targetRoute: lateralRoute,
      closurePath: closurePath ?? { edges: [], nodeIds: [exitNodeId], distanceKm: 0 },
    });
  }

  const outAndBack = findTargetOutAndBackFromEntry(graph, entryNodeId, targetEdges, mission);
  if (outAndBack) {
    plans.push({
      accessPath,
      targetRoute: outAndBack,
      closurePath: reversePath(accessPath),
    });
  }

  return plans;
}

function scoreTransitionPlan(plan: TransitionRoutePlan, mission: MissionContractV3): number {
  const routeEdges = [...plan.accessPath.edges, ...plan.targetRoute.edges, ...plan.closurePath.edges];
  const distanceKm = sumLengthKm(routeEdges);
  const repeat = repeatedLengthByKind(routeEdges, mission);
  const pavedKm = sumLengthKm(routeEdges.filter((edge) => classifyEdgeSemanticsV3(edge).surfaceEvidence === 'explicit_paved'));
  const targetDistanceKm = mission.request.targetDistanceKm;
  const openLateralPenalty = plan.closurePath.edges.length === 0
    && plan.targetRoute.nodeIds.at(-1) !== plan.accessPath.nodeIds[0]
    ? 8
    : 0;
  const underMinDistanceKm = Math.max(0, mission.request.minDistanceKm - distanceKm);
  const overMaxDistanceKm = Math.max(0, distanceKm - mission.request.maxDistanceKm);
  return plan.targetRoute.naturalDwellKm * 3
    - repeat.targetRepeatKm * 10
    - repeat.connectorRepeatKm * 0.75
    - pavedKm * 0.5
    - openLateralPenalty
    - underMinDistanceKm * 4
    - overMaxDistanceKm * 4
    - Math.abs(distanceKm - targetDistanceKm) * 0.25;
}

function reversePath(path: DirectedPath): DirectedPath {
  return {
    edges: [...path.edges].reverse(),
    nodeIds: [...path.nodeIds].reverse(),
    distanceKm: path.distanceKm,
  };
}

function connectorPathBetweenNodes(
  graph: EnrichedGraph,
  fromNodeId: string,
  toNodeId: string,
  maxDistanceKm: number,
): DirectedPath | null {
  if (fromNodeId === toNodeId) return { edges: [], nodeIds: [fromNodeId], distanceKm: 0 };
  const queue: DirectedPath[] = [{ edges: [], nodeIds: [fromNodeId], distanceKm: 0 }];
  const bestDistanceByNode = new Map<string, number>([[fromNodeId, 0]]);

  while (queue.length > 0) {
    queue.sort((left, right) => left.distanceKm - right.distanceKm);
    const current = queue.shift();
    if (!current) break;
    const nodeId = current.nodeIds.at(-1) ?? fromNodeId;
    if (nodeId === toNodeId) return current;

    for (const next of adjacentEdges(graph, nodeId)) {
      const semantics = classifyEdgeSemanticsV3(next.edge);
      if (!semantics.isConnectorLike) continue;
      const distanceKm = current.distanceKm + next.edge.lengthKm;
      if (distanceKm > maxDistanceKm + 0.001) continue;
      if ((bestDistanceByNode.get(next.to) ?? Infinity) <= distanceKm + 0.001) continue;
      bestDistanceByNode.set(next.to, distanceKm);
      queue.push({
        edges: [...current.edges, next.edge],
        nodeIds: [...current.nodeIds, next.to],
        distanceKm,
      });
    }
  }

  return null;
}

function findTargetMultiCycleChainFromEntry(
  graph: EnrichedGraph,
  entryNodeId: string,
  targetEdges: EnrichedEdge[],
  mission: MissionContractV3,
  accessPath: DirectedPath,
): TargetLoop | null {
  const targetEdgeIds = new Set(targetEdges.map((edge) => edge.id));
  const targetDistanceKm = Math.max(
    mission.target.minNaturalDwellKm,
    mission.request.targetDistanceKm - accessPath.distanceKm * 2,
  );
  const maxTargetDistanceKm = Math.max(
    mission.target.minNaturalDwellKm,
    mission.request.maxDistanceKm - accessPath.distanceKm * 2,
  );
  const stack: Array<TargetLoop & { usedEdgeIds: Set<string>; completedCycles: number }> = [{
    edges: [],
    nodeIds: [entryNodeId],
    naturalDwellKm: 0,
    usedEdgeIds: new Set<string>(),
    completedCycles: 0,
  }];
  const candidates: Array<TargetLoop & { completedCycles: number }> = [];
  let inspected = 0;

  while (stack.length > 0 && inspected < 60_000 && candidates.length < 40) {
    inspected += 1;
    const current = stack.pop();
    if (!current) break;
    const currentDistanceKm = sumLengthKm(current.edges);
    const nodeId = current.nodeIds.at(-1) ?? entryNodeId;
    const returnedToEntry = nodeId === entryNodeId && current.edges.length > 0;
    const completedCycles = returnedToEntry ? current.completedCycles + 1 : current.completedCycles;

    if (returnedToEntry && current.naturalDwellKm >= mission.target.minNaturalDwellKm) {
      candidates.push({
        edges: current.edges,
        nodeIds: current.nodeIds,
        naturalDwellKm: current.naturalDwellKm,
        completedCycles,
      });
    }
    if (currentDistanceKm >= maxTargetDistanceKm - 0.001) continue;

    const shouldKeepChaining = !returnedToEntry
      || currentDistanceKm < targetDistanceKm - 0.25
      || completedCycles < 2;
    if (!shouldKeepChaining) continue;

    const nextEdges = adjacentEdges(graph, nodeId)
      .filter((candidate) => targetEdgeIds.has(candidate.edge.id) && !current.usedEdgeIds.has(candidate.edge.id))
      .sort((left, right) => classifyEdgeSemanticsV3(right.edge).trailConfidence - classifyEdgeSemanticsV3(left.edge).trailConfidence || right.edge.lengthKm - left.edge.lengthKm)
      .slice(0, 8);

    for (const next of nextEdges) {
      const nextDistanceKm = currentDistanceKm + next.edge.lengthKm;
      if (nextDistanceKm > maxTargetDistanceKm + 0.001) continue;
      const semantics = classifyEdgeSemanticsV3(next.edge);
      stack.push({
        edges: [...current.edges, next.edge],
        nodeIds: [...current.nodeIds, next.to],
        naturalDwellKm: current.naturalDwellKm + next.edge.lengthKm * semantics.candidateNaturalWeight,
        usedEdgeIds: new Set([...Array.from(current.usedEdgeIds), next.edge.id]),
        completedCycles,
      });
    }
  }

  const usefulMultiCycleCandidates = candidates
    .filter((candidate) => candidate.completedCycles >= 2 || sumLengthKm(candidate.edges) >= targetDistanceKm - 0.25)
    .sort((left, right) => scoreTargetLoop(right, mission) - scoreTargetLoop(left, mission));
  return usefulMultiCycleCandidates[0] ?? null;
}

function findTargetLateralRoutesFromEntry(
  graph: EnrichedGraph,
  entryNodeId: string,
  targetEdges: EnrichedEdge[],
  mission: MissionContractV3,
): TargetLoop[] {
  const targetEdgeIds = new Set(targetEdges.map((edge) => edge.id));
  const maxTargetDistanceKm = Math.max(mission.target.minNaturalDwellKm, mission.request.maxDistanceKm);
  const stack: Array<TargetLoop & { usedEdgeIds: Set<string> }> = [{
    edges: [],
    nodeIds: [entryNodeId],
    naturalDwellKm: 0,
    usedEdgeIds: new Set<string>(),
  }];
  const routes: TargetLoop[] = [];
  let inspected = 0;

  while (stack.length > 0 && inspected < 20_000) {
    inspected += 1;
    const current = stack.pop();
    if (!current) break;
    const currentDistanceKm = sumLengthKm(current.edges);
    const nodeId = current.nodeIds.at(-1) ?? entryNodeId;

    if (nodeId !== entryNodeId && current.naturalDwellKm >= mission.target.minNaturalDwellKm) {
      routes.push({ edges: current.edges, nodeIds: current.nodeIds, naturalDwellKm: current.naturalDwellKm });
      if (currentDistanceKm >= maxTargetDistanceKm - 0.001 || routes.length >= 80) continue;
    }
    if (currentDistanceKm > maxTargetDistanceKm + 0.001) continue;

    const nextEdges = adjacentEdges(graph, nodeId)
      .filter((candidate) => targetEdgeIds.has(candidate.edge.id) && !current.usedEdgeIds.has(candidate.edge.id))
      .sort((left, right) => classifyEdgeSemanticsV3(right.edge).trailConfidence - classifyEdgeSemanticsV3(left.edge).trailConfidence || right.edge.lengthKm - left.edge.lengthKm);

    for (const next of nextEdges) {
      const semantics = classifyEdgeSemanticsV3(next.edge);
      stack.push({
        edges: [...current.edges, next.edge],
        nodeIds: [...current.nodeIds, next.to],
        naturalDwellKm: current.naturalDwellKm + next.edge.lengthKm * semantics.candidateNaturalWeight,
        usedEdgeIds: new Set([...Array.from(current.usedEdgeIds), next.edge.id]),
      });
    }
  }

  return routes.sort((left, right) => scoreTargetLoop(right, mission) - scoreTargetLoop(left, mission)).slice(0, 20);
}

function findTargetLoopFromEntry(
  graph: EnrichedGraph,
  entryNodeId: string,
  targetEdges: EnrichedEdge[],
  mission: MissionContractV3,
): TargetLoop | null {
  const targetEdgeIds = new Set(targetEdges.map((edge) => edge.id));
  const maxTargetDistanceKm = Math.max(mission.target.minNaturalDwellKm, mission.request.maxDistanceKm);
  const initial: TargetLoop & { usedEdgeIds: Set<string> } = {
    edges: [],
    nodeIds: [entryNodeId],
    naturalDwellKm: 0,
    usedEdgeIds: new Set<string>(),
  };
  const stack: Array<TargetLoop & { usedEdgeIds: Set<string> }> = [initial];
  let best: TargetLoop | null = null;
  let inspected = 0;

  while (stack.length > 0 && inspected < 20_000) {
    inspected += 1;
    const current = stack.pop();
    if (!current) break;
    const nodeId = current.nodeIds.at(-1) ?? entryNodeId;

    if (nodeId === entryNodeId && current.edges.length > 0 && current.naturalDwellKm >= mission.target.minNaturalDwellKm) {
      if (!best || scoreTargetLoop(current, mission) > scoreTargetLoop(best, mission)) {
        best = { edges: current.edges, nodeIds: current.nodeIds, naturalDwellKm: current.naturalDwellKm };
      }
      continue;
    }

    if (sumLengthKm(current.edges) > maxTargetDistanceKm + 0.001) continue;

    const nextEdges = adjacentEdges(graph, nodeId)
      .filter((candidate) => targetEdgeIds.has(candidate.edge.id) && !current.usedEdgeIds.has(candidate.edge.id))
      .sort((left, right) => classifyEdgeSemanticsV3(right.edge).trailConfidence - classifyEdgeSemanticsV3(left.edge).trailConfidence || right.edge.lengthKm - left.edge.lengthKm);

    for (const next of nextEdges) {
      const semantics = classifyEdgeSemanticsV3(next.edge);
      const naturalDwellKm = current.naturalDwellKm + next.edge.lengthKm * semantics.candidateNaturalWeight;
      stack.push({
        edges: [...current.edges, next.edge],
        nodeIds: [...current.nodeIds, next.to],
        naturalDwellKm,
        usedEdgeIds: new Set([...Array.from(current.usedEdgeIds), next.edge.id]),
      });
    }
  }

  return best;
}

function scoreTargetLoop(loop: TargetLoop, mission: MissionContractV3): number {
  const distanceKm = sumLengthKm(loop.edges);
  const targetDistanceKm = Math.max(mission.target.minNaturalDwellKm, mission.request.targetDistanceKm - mission.budgets.maxConnectorRepeatKm);
  return loop.naturalDwellKm - Math.abs(distanceKm - targetDistanceKm) * 0.25;
}

function findTargetOutAndBackFromEntry(
  graph: EnrichedGraph,
  entryNodeId: string,
  targetEdges: EnrichedEdge[],
  mission: MissionContractV3,
): TargetLoop | null {
  const targetEdgeIds = new Set(targetEdges.map((edge) => edge.id));
  const stack: Array<TargetLoop & { usedEdgeIds: Set<string> }> = [{
    edges: [],
    nodeIds: [entryNodeId],
    naturalDwellKm: 0,
    usedEdgeIds: new Set<string>(),
  }];
  let best: TargetLoop | null = null;
  let inspected = 0;

  while (stack.length > 0 && inspected < 20_000) {
    inspected += 1;
    const current = stack.pop();
    if (!current) break;
    const currentDistanceKm = sumLengthKm(current.edges);
    if (current.naturalDwellKm >= mission.target.minNaturalDwellKm / 2) {
      const reversedEdges = [...current.edges].reverse();
      const route: TargetLoop = {
        edges: [...current.edges, ...reversedEdges],
        nodeIds: [...current.nodeIds, ...current.nodeIds.slice(0, -1).reverse()],
        naturalDwellKm: current.naturalDwellKm * 2,
      };
      if (!best || scoreTargetLoop(route, mission) > scoreTargetLoop(best, mission)) best = route;
    }
    if (currentDistanceKm > mission.request.maxDistanceKm / 2 + 0.001) continue;

    const nodeId = current.nodeIds.at(-1) ?? entryNodeId;
    const nextEdges = adjacentEdges(graph, nodeId)
      .filter((candidate) => targetEdgeIds.has(candidate.edge.id) && !current.usedEdgeIds.has(candidate.edge.id))
      .sort((left, right) => classifyEdgeSemanticsV3(right.edge).trailConfidence - classifyEdgeSemanticsV3(left.edge).trailConfidence || right.edge.lengthKm - left.edge.lengthKm);

    for (const next of nextEdges) {
      const semantics = classifyEdgeSemanticsV3(next.edge);
      stack.push({
        edges: [...current.edges, next.edge],
        nodeIds: [...current.nodeIds, next.to],
        naturalDwellKm: current.naturalDwellKm + next.edge.lengthKm * semantics.candidateNaturalWeight,
        usedEdgeIds: new Set([...Array.from(current.usedEdgeIds), next.edge.id]),
      });
    }
  }

  return best;
}

function adjacentEdges(graph: EnrichedGraph, nodeId: string): Array<{ edge: EnrichedEdge; to: string }> {
  const node = graph.nodes.get(nodeId);
  const edgeIds = node?.edges ?? [];
  const result: Array<{ edge: EnrichedEdge; to: string }> = [];
  for (const edgeId of edgeIds) {
    const edge = graph.edges.get(edgeId);
    if (!edge) continue;
    if (edge.from === nodeId) result.push({ edge, to: edge.to });
    else if (edge.to === nodeId) result.push({ edge, to: edge.from });
  }
  return result;
}

function metricsFromEdges(edges: EnrichedEdge[], targetDistanceKm: number, mission: MissionContractV3): RouteMetricsV3 {
  const distanceProducedKm = sumLengthKm(edges);
  const strictTrailKm = sumLengthKm(edges.filter((edge) => classifyEdgeSemanticsV3(edge).isStrictTrailLike));
  const explicitPavedKm = sumLengthKm(edges.filter((edge) => classifyEdgeSemanticsV3(edge).surfaceEvidence === 'explicit_paved'));
  const explicitNaturalKm = sumLengthKm(edges.filter((edge) => classifyEdgeSemanticsV3(edge).surfaceEvidence === 'explicit_natural'));
  const visitedComponents = Array.from(new Set(edges.map((edge) => classifyEdgeSemanticsV3(edge).componentKind)));
  const repeatByEdgeId = repeatedLengthByKind(edges, mission);

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
    nonPavedKm: Math.max(0, distanceProducedKm - explicitPavedKm),
    naturalDwellKm: explicitNaturalKm,
    repeatEdgeKm: repeatByEdgeId.connectorRepeatKm + repeatByEdgeId.targetRepeatKm,
    targetRepeatKm: repeatByEdgeId.targetRepeatKm,
    connectorRepeatKm: repeatByEdgeId.connectorRepeatKm,
    visitedComponents,
    repeatRatio: ratio(repeatByEdgeId.targetRepeatKm, distanceProducedKm),
    overlapRatio: ratio(repeatByEdgeId.targetRepeatKm, distanceProducedKm),
    busyRoadRatio: 0,
    loopClosureKm: repeatByEdgeId.connectorRepeatKm,
    longestTrailSegmentKm: strictTrailKm,
  };
}

function repeatedLengthByKind(
  edges: EnrichedEdge[],
  mission: MissionContractV3,
): { connectorRepeatKm: number; targetRepeatKm: number } {
  const seen = new Set<string>();
  let connectorRepeatKm = 0;
  let targetRepeatKm = 0;

  for (const edge of edges) {
    if (!seen.has(edge.id)) {
      seen.add(edge.id);
      continue;
    }

    const semantics = classifyEdgeSemanticsV3(edge);
    if (mission.target.componentKinds.includes(semantics.componentKind)) {
      targetRepeatKm += edge.lengthKm;
    } else {
      connectorRepeatKm += edge.lengthKm;
    }
  }

  return { connectorRepeatKm, targetRepeatKm };
}

function createPhaseDiagnostics(
  mission: MissionContractV3,
  selectedCandidate: RouteCandidateV3 | null,
  access: { accessKm: number; accessPavedKm: number; entryNodeId: string; connectorRepeatKm: number },
): AssemblyPhaseDiagnosticsV3 {
  const metrics = selectedCandidate?.metrics;

  return {
    access: {
      status: metrics ? 'success' : 'failure',
      accessKm: access.accessKm,
      accessPavedKm: access.accessPavedKm,
      entryNodeId: access.entryNodeId,
      componentId: mission.target.componentIds[0] ?? null,
      rejectedEntryReasons: {},
    },
    dwell: {
      status: metrics && metrics.naturalDwellKm >= mission.target.minNaturalDwellKm ? 'success' : 'failure',
      targetDwellKm: metrics?.naturalDwellKm ?? 0,
      requestedTargetDwellKm: mission.target.minNaturalDwellKm,
      longestTrailSegmentKm: metrics?.longestTrailSegmentKm ?? 0,
      cleanExploitableKm: metrics?.naturalDwellKm ?? 0,
      targetRepeatKm: metrics?.targetRepeatKm ?? 0,
    },
    recovery: {
      status: metrics ? 'success' : 'failure',
      recoveredDistanceKm: metrics?.distanceProducedKm ?? 0,
      recoveryPavedKm: 0,
      recoveryRejectedReasons: {},
    },
    closure: {
      status: metrics && metrics.naturalDwellKm >= mission.target.minNaturalDwellKm ? 'success' : 'failure',
      closureKm: metrics?.loopClosureKm ?? 0,
      closurePavedKm: metrics?.connectorRepeatKm ?? 0,
      connectorRepeatKm: metrics?.connectorRepeatKm ?? 0,
      targetRepeatKm: metrics?.targetRepeatKm ?? 0,
      closureRejectedReasons: {},
    },
    finalGate: {
      status: metrics ? 'candidate_ready' : 'no_selectable_candidate',
      distanceKm: metrics?.distanceProducedKm ?? 0,
      finalPavedRatioEstimate: metrics?.pavedRatio ?? 0,
      trailRatio: metrics?.trailRatio ?? 0,
      naturalWayRatio: metrics?.naturalWayRatio ?? 0,
      pavedRatio: metrics?.pavedRatio ?? 0,
      gateFailures: [],
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

function firstNodeId(graph: EnrichedGraph): string {
  return graph.nodes.keys().next().value ?? 'start';
}

function sumLengthKm(edges: EnrichedEdge[]): number {
  return edges.reduce((sum, edge) => sum + edge.lengthKm, 0);
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}
