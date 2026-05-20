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
  const productionDiagnostics: Record<string, unknown>[] = [];
  for (const candidateAccessPath of accessPaths) {
    const entryNodeId = candidateAccessPath.nodeIds.at(-1) ?? startNodeId;
    const candidatePlanResult = transitionRoutePlansFromEntry(graph, startNodeId, candidateAccessPath, entryNodeId, targetEdges, mission);
    productionDiagnostics.push(...candidatePlanResult.diagnostics);
    for (const candidatePlan of candidatePlanResult.plans) {
      if (!isEligibleTransitionPlan(candidatePlan, mission)) continue;
      eligiblePlans.push(candidatePlan);
    }
  }
  const returnedPlans = eligiblePlans.filter((plan) => planReturnsToStart(plan));
  const cleanReturnedPlans = returnedPlans.filter((plan) => topologyLaneFromPlan(plan, mission) !== 'long_dirty'
    && sumLengthKm([...plan.accessPath.edges, ...plan.targetRoute.edges, ...plan.closurePath.edges]) >= mission.request.minDistanceKm * 0.95);
  const cleanShortLateralFallbackPlans = returnedPlans.filter((plan) => isCleanShortLateralFallbackPlan(plan, mission));
  const preferredCleanPlans = uniquePlansById([...cleanReturnedPlans, ...cleanShortLateralFallbackPlans], mission);
  const selectedPlan = (preferredCleanPlans.length > 0 ? preferredCleanPlans : returnedPlans.length > 0 ? returnedPlans : eligiblePlans)
    .sort((left, right) => scoreTransitionPlan(right, mission) - scoreTransitionPlan(left, mission))[0] ?? null;
  const selectedAccessPath = selectedPlan?.accessPath ?? null;
  const targetRoute = selectedPlan?.targetRoute ?? null;
  const closurePath = selectedPlan?.closurePath ?? null;
  const targetDwellKm = targetRoute?.naturalDwellKm ?? 0;

  if (!selectedAccessPath) {
    return createNoCandidateAssemblerResultV3(mission, accessPaths.length === 0 ? 'missing_access_connector_to_target' : 'insufficient_natural_target_dwell');
  }

  if (!targetRoute || !closurePath) {
    return createNoCandidateAssemblerResultV3(mission, 'insufficient_natural_target_dwell');
  }

  const selectedIsCleanShortLateralFallback = isCleanShortLateralFallbackPlan(selectedPlan, mission);
  if (targetDwellKm < mission.target.minNaturalDwellKm && !selectedIsCleanShortLateralFallback) {
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
  const selectedCandidate = portfolio.candidates.find((candidate) => candidate.id === portfolio.selectedCandidateId)
    ?? selectCandidateFromPortfolioV3(portfolio);

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
        candidateProduction: summarizeCandidateProduction(eligiblePlans, mission, productionDiagnostics),
      },
    },
    warnings: [
      'transition_to_woods_used_paved_connector_before_natural_dwell',
      ...(selectedIsCleanShortLateralFallback ? ['transition_to_woods_clean_short_lateral_under_requested_dwell'] : []),
    ],
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
type TargetLoop = { edges: EnrichedEdge[]; nodeIds: string[]; naturalDwellKm: number; productionDiagnostics?: Record<string, unknown> };
type TransitionRoutePlan = { accessPath: DirectedPath; targetRoute: TargetLoop; closurePath: DirectedPath; productionSource?: string; productionDiagnostics?: Record<string, unknown> };
type TopologyLaneV3 = 'clean_short' | 'long_dirty' | 'entry_exit_lateral' | 'cycle_or_lateral';

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

function uniquePlansById(plans: TransitionRoutePlan[], mission: MissionContractV3): TransitionRoutePlan[] {
  const byId = new Map<string, TransitionRoutePlan>();
  for (const plan of plans) byId.set(candidateIdFromPlan(plan, mission), plan);
  return Array.from(byId.values());
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
  if (plan.productionSource === 'target_lateral' && planReturnsToStart(plan) && repeat.targetRepeatKm <= mission.budgets.maxTargetRepeatKm + 0.001) {
    return plan.targetRoute.naturalDwellKm < mission.target.minNaturalDwellKm
      ? 'clean_short'
      : 'entry_exit_lateral';
  }
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
  const lane = topologyLaneFromPlan(plan, mission);
  return lane === 'cycle_or_lateral' || lane === 'entry_exit_lateral' ? 'cycle_chain' : 'strategy_assembler';
}

function countTopologyLanes(candidates: RouteCandidateV3[]): Record<TopologyLaneV3, number> {
  return candidates.reduce<Record<TopologyLaneV3, number>>((counts, candidate) => {
    const lane = (candidate.selectedReason ?? 'clean_short') as TopologyLaneV3;
    counts[lane] += 1;
    return counts;
  }, { clean_short: 0, long_dirty: 0, entry_exit_lateral: 0, cycle_or_lateral: 0 });
}

function summarizeCandidateProduction(plans: TransitionRoutePlan[], mission: MissionContractV3, extraProductionDiagnostics: Record<string, unknown>[] = []): Record<string, unknown> {
  const returnedPlans = plans.filter((plan) => planReturnsToStart(plan));
  const planSummaries = plans.map((plan) => summarizePlanProduction(plan, mission));
  const returnedSummaries = returnedPlans.map((plan) => summarizePlanProduction(plan, mission));
  const cleanReturnedSummaries = returnedSummaries.filter((summary) => summary.targetRepeatKm <= mission.budgets.maxTargetRepeatKm);
  const maxDistance = maxBy(planSummaries, 'distanceKm');
  const maxReturnedDistance = maxBy(returnedSummaries, 'distanceKm');
  const maxCleanReturnedDistance = maxBy(cleanReturnedSummaries, 'distanceKm');
  const bestInEnvelope = planSummaries
    .filter((summary) => summary.distanceKm >= mission.request.minDistanceKm && summary.distanceKm <= mission.request.maxDistanceKm)
    .sort((left, right) => right.score - left.score)[0] ?? null;
  const productionDiagnostics = [
    ...extraProductionDiagnostics,
    ...plans.map((plan) => plan.productionDiagnostics ?? plan.targetRoute.productionDiagnostics),
  ].filter((diagnostics): diagnostics is Record<string, unknown> => Boolean(diagnostics));

  const indexedTopologyDiagnostics = productionDiagnostics
    .filter((diagnostics) => diagnostics.source === 'indexed_cycle_sequence')
    .sort((left, right) => Number(right.longestCleanSequenceDistanceKm ?? 0) - Number(left.longestCleanSequenceDistanceKm ?? 0)
      || Number(right.reachableUnusedTargetCapacityFromEntryKm ?? 0) - Number(left.reachableUnusedTargetCapacityFromEntryKm ?? 0))[0] ?? null;
  const accessEntryDiagnostics = productionDiagnostics
    .filter((diagnostics) => diagnostics.source === 'indexed_cycle_sequence')
    .map(summarizeAccessEntryDiagnostic)
    .sort((left, right) => Number(right.longestCleanSequenceDistanceKm ?? 0) - Number(left.longestCleanSequenceDistanceKm ?? 0)
      || Number(right.entryCycleCount ?? 0) - Number(left.entryCycleCount ?? 0)
      || Number(right.reachableUnusedTargetCapacityFromEntryKm ?? 0) - Number(left.reachableUnusedTargetCapacityFromEntryKm ?? 0));
  const targetLateralDiagnostics = productionDiagnostics
    .filter((diagnostics) => diagnostics.source === 'target_lateral')
    .sort((left, right) => Number(right.maxCleanLateralNaturalDwellKm ?? 0) - Number(left.maxCleanLateralNaturalDwellKm ?? 0)
      || Number(right.maxCleanLateralDistanceKm ?? 0) - Number(left.maxCleanLateralDistanceKm ?? 0)
      || Number(right.closureFeasibleRouteCount ?? 0) - Number(left.closureFeasibleRouteCount ?? 0));

  return {
    eligiblePlanCount: plans.length,
    returnedPlanCount: returnedPlans.length,
    inEnvelopePlanCount: planSummaries.filter((summary) => summary.distanceKm >= mission.request.minDistanceKm && summary.distanceKm <= mission.request.maxDistanceKm).length,
    over10kmPlanCount: planSummaries.filter((summary) => summary.distanceKm > 10).length,
    maxDistancePlan: maxDistance,
    maxReturnedDistancePlan: maxReturnedDistance,
    maxCleanReturnedDistancePlan: maxCleanReturnedDistance,
    bestInEnvelopePlan: bestInEnvelope,
    byProductionSource: countBy(plans.map((plan) => plan.productionSource ?? 'unknown')),
    selectedProductionDiagnostics: productionDiagnostics.find((diagnostics) => diagnostics.source === 'indexed_cycle_sequence' && diagnostics.routeEmitted === true)
      ?? productionDiagnostics.find((diagnostics) => diagnostics.source === 'multi_cycle_chain')
      ?? productionDiagnostics[0]
      ?? null,
    indexedTopologyDiagnostics,
    topAccessEntryDiagnostics: accessEntryDiagnostics.slice(0, 12),
    accessEntrySummary: summarizeAccessEntries(accessEntryDiagnostics),
    targetLateralDiagnostics: targetLateralDiagnostics[0] ?? null,
    topTargetLateralDiagnostics: targetLateralDiagnostics.slice(0, 12),
    targetLateralSummary: summarizeTargetLateralEntries(targetLateralDiagnostics),
    topDistancePlans: planSummaries.sort((left, right) => right.distanceKm - left.distanceKm).slice(0, 8),
  };
}

function summarizeAccessEntryDiagnostic(diagnostics: Record<string, unknown>): Record<string, unknown> {
  return {
    entryNodeId: diagnostics.entryNodeId,
    accessDistanceKm: diagnostics.accessDistanceKm,
    accessPavedKm: diagnostics.accessPavedKm,
    closureFeasibleViaAccessReverse: diagnostics.closureFeasibleViaAccessReverse,
    closurePavedKm: diagnostics.closurePavedKm,
    routeEmitted: diagnostics.routeEmitted,
    topologyStopReason: diagnostics.topologyStopReason,
    stopReason: diagnostics.stopReason,
    reachableUnusedTargetCapacityFromEntryKm: diagnostics.reachableUnusedTargetCapacityFromEntryKm,
    reachableUnusedTargetCapacityFromExitKm: diagnostics.reachableUnusedTargetCapacityFromExitKm,
    entryCycleCount: diagnostics.entryCycleCount,
    cycleUnitCount: diagnostics.cycleUnitCount,
    branchUnitCount: diagnostics.branchUnitCount,
    longestCleanSequenceDistanceKm: diagnostics.longestCleanSequenceDistanceKm,
    targetDistanceKm: diagnostics.targetDistanceKm,
    maxTargetDistanceKm: diagnostics.maxTargetDistanceKm,
    topCycleUnits: diagnostics.topCycleUnits,
  };
}

function summarizeAccessEntries(entries: Record<string, unknown>[]): Record<string, unknown> {
  const viableCycleEntries = entries.filter((entry) => Number(entry.entryCycleCount ?? 0) > 0);
  const emittedEntries = entries.filter((entry) => entry.routeEmitted === true);
  const bestByCapacity = maxBy([...entries], 'reachableUnusedTargetCapacityFromEntryKm');
  const bestByCleanSequence = maxBy([...entries], 'longestCleanSequenceDistanceKm');
  return {
    inspectedEntryCount: entries.length,
    viableCycleEntryCount: viableCycleEntries.length,
    emittedIndexedEntryCount: emittedEntries.length,
    bestEntryNodeIdByReachableCapacity: bestByCapacity?.entryNodeId ?? null,
    bestReachableCapacityKm: bestByCapacity?.reachableUnusedTargetCapacityFromEntryKm ?? 0,
    bestEntryNodeIdByCleanSequence: bestByCleanSequence?.entryNodeId ?? null,
    bestCleanSequenceKm: bestByCleanSequence?.longestCleanSequenceDistanceKm ?? 0,
    selectedEntryInsufficientCount: entries.filter((entry) => entry.topologyStopReason === 'selected-entry-insufficient').length,
    topologyInsufficient: viableCycleEntries.length === 0,
  };
}

function summarizeTargetLateralEntries(entries: Record<string, unknown>[]): Record<string, unknown> {
  const emittedEntries = entries.filter((entry) => Number(entry.emittedRouteCount ?? 0) > 0);
  const closureFeasibleEntries = entries.filter((entry) => Number(entry.closureFeasibleRouteCount ?? 0) > 0);
  const bestByDwell = maxBy([...entries], 'maxCleanLateralNaturalDwellKm');
  const bestByDistance = maxBy([...entries], 'maxCleanLateralDistanceKm');
  return {
    inspectedEntryCount: entries.length,
    emittedEntryCount: emittedEntries.length,
    closureFeasibleEntryCount: closureFeasibleEntries.length,
    bestEntryNodeIdByCleanLateralDwell: bestByDwell?.entryNodeId ?? null,
    bestCleanLateralNaturalDwellKm: bestByDwell?.maxCleanLateralNaturalDwellKm ?? 0,
    bestEntryNodeIdByCleanLateralDistance: bestByDistance?.entryNodeId ?? null,
    bestCleanLateralDistanceKm: bestByDistance?.maxCleanLateralDistanceKm ?? 0,
    insufficientDwellEntryCount: entries.filter((entry) => entry.topologyStopReason === 'insufficient_clean_lateral_dwell').length,
    closureInfeasibleEntryCount: entries.filter((entry) => entry.topologyStopReason === 'closure_infeasible_from_lateral_exit').length,
    topologyInsufficient: emittedEntries.length === 0,
  };
}

function pavedLengthKm(edges: EnrichedEdge[]): number {
  return sumLengthKm(edges.filter((edge) => classifyEdgeSemanticsV3(edge).surfaceEvidence === 'explicit_paved'));
}

function summarizePlanProduction(plan: TransitionRoutePlan, mission: MissionContractV3): {
  productionSource: string;
  topologyLane: TopologyLaneV3;
  distanceKm: number;
  targetDistanceKm: number;
  naturalDwellKm: number;
  pavedKm: number;
  repeatKm: number;
  targetRepeatKm: number;
  connectorRepeatKm: number;
  returned: boolean;
  score: number;
} {
  const edges = [...plan.accessPath.edges, ...plan.targetRoute.edges, ...plan.closurePath.edges];
  const repeat = repeatedLengthByKind(edges, mission);
  const pavedKm = sumLengthKm(edges.filter((edge) => classifyEdgeSemanticsV3(edge).surfaceEvidence === 'explicit_paved'));
  return {
    productionSource: plan.productionSource ?? 'unknown',
    topologyLane: topologyLaneFromPlan(plan, mission),
    distanceKm: sumLengthKm(edges),
    targetDistanceKm: sumLengthKm(plan.targetRoute.edges),
    naturalDwellKm: plan.targetRoute.naturalDwellKm,
    pavedKm,
    repeatKm: repeat.targetRepeatKm + repeat.connectorRepeatKm,
    targetRepeatKm: repeat.targetRepeatKm,
    connectorRepeatKm: repeat.connectorRepeatKm,
    returned: planReturnsToStart(plan),
    score: scoreTransitionPlan(plan, mission),
  };
}

function maxBy<T extends Record<string, unknown>>(items: T[], key: keyof T): T | null {
  return items.sort((left, right) => Number(right[key] ?? 0) - Number(left[key] ?? 0))[0] ?? null;
}

function countBy(values: string[]): Record<string, number> {
  return values.reduce<Record<string, number>>((counts, value) => {
    counts[value] = (counts[value] ?? 0) + 1;
    return counts;
  }, {});
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
): { plans: TransitionRoutePlan[]; diagnostics: Record<string, unknown>[] } {
  const plans: TransitionRoutePlan[] = [];
  const diagnostics: Record<string, unknown>[] = [];
  const indexedCycleSequence = findIndexedCycleSequenceFromEntry(graph, entryNodeId, targetEdges, mission, accessPath);
  if (indexedCycleSequence) {
    diagnostics.push(indexedCycleSequence.productionDiagnostics ?? { source: 'indexed_cycle_sequence' });
    plans.push({
      accessPath,
      targetRoute: indexedCycleSequence,
      closurePath: reversePath(accessPath),
      productionSource: 'indexed_cycle_sequence',
      productionDiagnostics: indexedCycleSequence.productionDiagnostics,
    });
  } else {
    diagnostics.push(observeIndexedCycleTopologyFromEntry(graph, entryNodeId, targetEdges, mission, accessPath));
  }

  const multiCycleChain = findTargetMultiCycleChainFromEntry(graph, entryNodeId, targetEdges, mission, accessPath);
  if (multiCycleChain) {
    plans.push({
      accessPath,
      targetRoute: multiCycleChain,
      closurePath: reversePath(accessPath),
      productionSource: 'multi_cycle_chain',
    });
  }

  const loop = findTargetLoopFromEntry(graph, entryNodeId, targetEdges, mission);
  if (loop) {
    plans.push({
      accessPath,
      targetRoute: loop,
      closurePath: reversePath(accessPath),
      productionSource: 'target_loop',
    });
  }

  const lateralRoutes = findTargetLateralRoutesFromEntry(graph, entryNodeId, targetEdges, mission);
  diagnostics.push(observeTargetLateralRoutesFromEntry(graph, startNodeId, entryNodeId, targetEdges, mission));
  for (const lateralRoute of lateralRoutes) {
    const exitNodeId = lateralRoute.nodeIds.at(-1) ?? entryNodeId;
    const closurePath = connectorPathBetweenNodes(graph, exitNodeId, startNodeId, mission.budgets.maxClosurePavedKm + mission.budgets.maxConnectorRepeatKm);
    plans.push({
      accessPath,
      targetRoute: lateralRoute,
      closurePath: closurePath ?? { edges: [], nodeIds: [exitNodeId], distanceKm: 0 },
      productionSource: 'target_lateral',
    });
  }

  const outAndBack = findTargetOutAndBackFromEntry(graph, entryNodeId, targetEdges, mission);
  if (outAndBack) {
    plans.push({
      accessPath,
      targetRoute: outAndBack,
      closurePath: reversePath(accessPath),
      productionSource: 'target_out_and_back',
    });
  }

  return { plans, diagnostics };
}

function isEligibleTransitionPlan(plan: TransitionRoutePlan, mission: MissionContractV3): boolean {
  if (plan.targetRoute.naturalDwellKm >= mission.target.minNaturalDwellKm) return true;
  return isCleanShortLateralFallbackPlan(plan, mission) || isCleanShortLateralEvidencePlan(plan, mission);
}

function isCleanShortLateralEvidencePlan(plan: TransitionRoutePlan, mission: MissionContractV3): boolean {
  return plan.productionSource === 'target_lateral'
    && plan.targetRoute.naturalDwellKm >= mission.target.minNaturalDwellKm * 0.9;
}

function isCleanShortLateralFallbackPlan(plan: TransitionRoutePlan, mission: MissionContractV3): boolean {
  const routeEdges = [...plan.accessPath.edges, ...plan.targetRoute.edges, ...plan.closurePath.edges];
  const repeat = repeatedLengthByKind(routeEdges, mission);
  const distanceKm = sumLengthKm(routeEdges);
  const nearDwell = plan.targetRoute.naturalDwellKm >= mission.target.minNaturalDwellKm * 0.9;
  const usefulDistance = distanceKm >= mission.request.minDistanceKm * 0.8;
  const returnedCleanLateral = plan.productionSource === 'target_lateral'
    && planReturnsToStart(plan)
    && repeat.targetRepeatKm <= mission.budgets.maxTargetRepeatKm + 0.001;

  return returnedCleanLateral && nearDwell && usefulDistance;
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
    - underMinDistanceKm * 8
    - overMaxDistanceKm * 6
    - Math.abs(distanceKm - targetDistanceKm) * 2;
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


type IndexedCycleUnitV3 = {
  id: string;
  edges: EnrichedEdge[];
  nodeIds: string[];
  lengthKm: number;
  naturalKm: number;
  entryNodeIds: string[];
};

type IndexedTopologyStopReasonV3 =
  | 'target_reached'
  | 'no_cycle_unit_at_entry'
  | 'no_adjacent_unit'
  | 'repeat_guard'
  | 'budget_cap'
  | 'candidate_cap';


function observeIndexedCycleTopologyFromEntry(
  graph: EnrichedGraph,
  entryNodeId: string,
  targetEdges: EnrichedEdge[],
  mission: MissionContractV3,
  accessPath: DirectedPath,
): Record<string, unknown> {
  const targetEdgeIds = new Set(targetEdges.map((edge) => edge.id));
  const targetPairKeys = new Set(targetEdges.map((edge) => edgePairKey(edge)));
  const targetDistanceKm = Math.max(mission.target.minNaturalDwellKm, mission.request.targetDistanceKm - accessPath.distanceKm * 2);
  const maxTargetDistanceKm = Math.max(mission.target.minNaturalDwellKm, mission.request.maxDistanceKm - accessPath.distanceKm * 2);
  const cycleUnits = findIndexedCycleUnits(graph, entryNodeId, targetEdgeIds, targetDistanceKm, maxTargetDistanceKm);
  const entryCycleCount = cycleUnits.filter((unit) => unit.entryNodeIds.includes(entryNodeId)).length;
  const longestCycle = cycleUnits[0] ?? null;
  return {
    source: 'indexed_cycle_sequence',
    routeEmitted: false,
    entryNodeId,
    accessDistanceKm: accessPath.distanceKm,
    accessPavedKm: pavedLengthKm(accessPath.edges),
    closureFeasibleViaAccessReverse: true,
    closurePavedKm: pavedLengthKm(accessPath.edges),
    targetNodeCount: nodeSetFromEdges(targetEdges).size,
    targetEdgeCount: targetEdges.length,
    targetUndirectedPairCount: targetPairKeys.size,
    cycleUnitCount: cycleUnits.length,
    branchUnitCount: countBranchUnits(graph, targetEdgeIds),
    entryCycleCount,
    candidateSequenceCount: 0,
    reachableUnusedTargetCapacityFromEntryKm: reachableTargetCapacityFromNode(graph, entryNodeId, targetEdgeIds),
    reachableUnusedTargetCapacityFromExitKm: reachableTargetCapacityFromNode(graph, entryNodeId, targetEdgeIds),
    longestCleanSequenceDistanceKm: longestCycle?.lengthKm ?? 0,
    stopReason: entryCycleCount === 0 ? 'no_cycle_unit_at_entry' : 'no_route_emitted',
    topologyStopReason: entryCycleCount === 0 ? 'selected-entry-insufficient' : 'assembler_failure_cycle_exploitation',
    maxTargetDistanceKm,
    targetDistanceKm,
    topCycleUnits: cycleUnits.slice(0, 12).map((unit) => ({
      id: unit.id,
      lengthKm: unit.lengthKm,
      naturalKm: unit.naturalKm,
      entryNodeIds: unit.entryNodeIds.slice(0, 6),
    })),
  };
}

function findIndexedCycleSequenceFromEntry(
  graph: EnrichedGraph,
  entryNodeId: string,
  targetEdges: EnrichedEdge[],
  mission: MissionContractV3,
  accessPath: DirectedPath,
): TargetLoop | null {
  const targetEdgeIds = new Set(targetEdges.map((edge) => edge.id));
  const targetPairKeys = new Set(targetEdges.map((edge) => edgePairKey(edge)));
  const targetDistanceKm = Math.max(mission.target.minNaturalDwellKm, mission.request.targetDistanceKm - accessPath.distanceKm * 2);
  const maxTargetDistanceKm = Math.max(mission.target.minNaturalDwellKm, mission.request.maxDistanceKm - accessPath.distanceKm * 2);
  const reachableTargetCapacityKm = reachableTargetCapacityFromNode(graph, entryNodeId, targetEdgeIds);
  const cycleUnits = findIndexedCycleUnits(graph, entryNodeId, targetEdgeIds, targetDistanceKm, maxTargetDistanceKm);
  const branchUnitCount = countBranchUnits(graph, targetEdgeIds);
  const sequenceDiagnostics: Array<Record<string, unknown>> = [];
  const entryCycles = cycleUnits
    .filter((unit) => unit.entryNodeIds.includes(entryNodeId))
    .sort((left, right) => scoreIndexedCycleUnit(right, targetDistanceKm) - scoreIndexedCycleUnit(left, targetDistanceKm));
  let stopReason: IndexedTopologyStopReasonV3 = entryCycles.length === 0 ? 'no_cycle_unit_at_entry' : 'no_adjacent_unit';
  let best: TargetLoop | null = null;
  let candidateSequenceCount = 0;
  let longestCleanSequenceDistanceKm = 0;

  for (const seed of entryCycles.slice(0, 12)) {
    const sequence = buildIndexedCycleSequence(seed, cycleUnits, targetDistanceKm, maxTargetDistanceKm);
    candidateSequenceCount += 1;
    longestCleanSequenceDistanceKm = Math.max(longestCleanSequenceDistanceKm, sequence.distanceKm);
    sequenceDiagnostics.push({
      seedUnitId: seed.id,
      selectedUnitIds: sequence.unitIds,
      distanceKm: sequence.distanceKm,
      naturalDwellKm: sequence.naturalDwellKm,
      stopReason: sequence.stopReason,
      insertedUnitCount: sequence.unitIds.length,
    });
    if (sequence.stopReason === 'target_reached') stopReason = 'target_reached';
    else if (stopReason !== 'target_reached' && sequence.distanceKm >= maxTargetDistanceKm - 0.001) stopReason = 'budget_cap';
    else if (stopReason !== 'target_reached' && sequence.stopReason === 'repeat_guard') stopReason = 'repeat_guard';

    const candidate: TargetLoop = {
      edges: sequence.edges,
      nodeIds: sequence.nodeIds,
      naturalDwellKm: sequence.naturalDwellKm,
      productionDiagnostics: {
        source: 'indexed_cycle_sequence',
        routeEmitted: true,
        entryNodeId,
        accessDistanceKm: accessPath.distanceKm,
        accessPavedKm: pavedLengthKm(accessPath.edges),
        closureFeasibleViaAccessReverse: true,
        closurePavedKm: pavedLengthKm(accessPath.edges),
        targetNodeCount: nodeSetFromEdges(targetEdges).size,
        targetEdgeCount: targetEdges.length,
        targetUndirectedPairCount: targetPairKeys.size,
        cycleUnitCount: cycleUnits.length,
        branchUnitCount,
        entryCycleCount: entryCycles.length,
        candidateSequenceCount,
        reachableUnusedTargetCapacityFromEntryKm: reachableTargetCapacityKm,
        reachableUnusedTargetCapacityFromExitKm: reachableTargetCapacityFromNode(graph, sequence.nodeIds.at(-1) ?? entryNodeId, targetEdgeIds),
        longestCleanSequenceDistanceKm,
        stopReason: sequence.stopReason,
        topologyStopReason: stopReason,
        maxTargetDistanceKm,
        targetDistanceKm,
        topCycleUnits: cycleUnits.slice(0, 12).map((unit) => ({
          id: unit.id,
          lengthKm: unit.lengthKm,
          naturalKm: unit.naturalKm,
          entryNodeIds: unit.entryNodeIds.slice(0, 6),
        })),
        candidateSequences: sequenceDiagnostics.slice(0, 12),
      },
    };
    if (!best || scoreTargetLoopAgainstDistance(candidate, targetDistanceKm) > scoreTargetLoopAgainstDistance(best, targetDistanceKm)) best = candidate;
    if (candidate.naturalDwellKm >= mission.target.minNaturalDwellKm && sequence.distanceKm >= targetDistanceKm - 0.25) break;
  }

  if (!best || best.naturalDwellKm < mission.target.minNaturalDwellKm) {
    return null;
  }
  return best;
}

function buildIndexedCycleSequence(
  seed: IndexedCycleUnitV3,
  cycleUnits: IndexedCycleUnitV3[],
  targetDistanceKm: number,
  maxTargetDistanceKm: number,
): TargetLoop & { unitIds: string[]; distanceKm: number; stopReason: IndexedTopologyStopReasonV3 } {
  let routeEdges = [...seed.edges];
  let routeNodeIds = [...seed.nodeIds];
  const usedEdgeIds = new Set(seed.edges.map((edge) => edge.id));
  const unitIds = [seed.id];
  let naturalDwellKm = seed.naturalKm;
  let stopReason: IndexedTopologyStopReasonV3 = seed.lengthKm >= targetDistanceKm - 0.25 ? 'target_reached' : 'no_adjacent_unit';

  while (sumLengthKm(routeEdges) < targetDistanceKm - 0.25 && unitIds.length < 10) {
    const routeNodeSet = new Set(routeNodeIds);
    const nextUnit = cycleUnits
      .filter((unit) => !unitIds.includes(unit.id))
      .map((unit) => {
        const sharedNode = unit.entryNodeIds.find((nodeId) => routeNodeSet.has(nodeId));
        return { unit, sharedNode };
      })
      .filter((item): item is { unit: IndexedCycleUnitV3; sharedNode: string } => Boolean(item.sharedNode))
      .filter((item) => item.unit.edges.every((edge) => !usedEdgeIds.has(edge.id)))
      .filter((item) => sumLengthKm(routeEdges) + item.unit.lengthKm <= maxTargetDistanceKm + 0.001)
      .sort((left, right) => scoreIndexedCycleUnit(right.unit, targetDistanceKm - sumLengthKm(routeEdges)) - scoreIndexedCycleUnit(left.unit, targetDistanceKm - sumLengthKm(routeEdges)))[0] ?? null;

    if (!nextUnit) {
      const hasAdjacent = cycleUnits.some((unit) => !unitIds.includes(unit.id) && unit.entryNodeIds.some((nodeId) => routeNodeSet.has(nodeId)));
      stopReason = hasAdjacent ? 'repeat_guard' : 'no_adjacent_unit';
      break;
    }

    const oriented = orientCycleUnitAtNode(nextUnit.unit, nextUnit.sharedNode);
    const nodeIndex = routeNodeIds.indexOf(nextUnit.sharedNode);
    if (nodeIndex < 0) {
      stopReason = 'no_adjacent_unit';
      break;
    }
    routeEdges = [
      ...routeEdges.slice(0, nodeIndex),
      ...oriented.edges,
      ...routeEdges.slice(nodeIndex),
    ];
    routeNodeIds = [
      ...routeNodeIds.slice(0, nodeIndex + 1),
      ...oriented.nodeIds.slice(1),
      ...routeNodeIds.slice(nodeIndex + 1),
    ];
    for (const edge of oriented.edges) usedEdgeIds.add(edge.id);
    unitIds.push(nextUnit.unit.id);
    naturalDwellKm += nextUnit.unit.naturalKm;
    stopReason = sumLengthKm(routeEdges) >= targetDistanceKm - 0.25 ? 'target_reached' : 'no_adjacent_unit';
  }

  if (unitIds.length >= 10 && sumLengthKm(routeEdges) < targetDistanceKm - 0.25) stopReason = 'candidate_cap';
  if (sumLengthKm(routeEdges) >= maxTargetDistanceKm - 0.001 && sumLengthKm(routeEdges) < targetDistanceKm - 0.25) stopReason = 'budget_cap';

  return {
    edges: routeEdges,
    nodeIds: routeNodeIds,
    naturalDwellKm,
    unitIds,
    distanceKm: sumLengthKm(routeEdges),
    stopReason,
  };
}

function findIndexedCycleUnits(
  graph: EnrichedGraph,
  entryNodeId: string,
  targetEdgeIds: Set<string>,
  targetDistanceKm: number,
  maxTargetDistanceKm: number,
): IndexedCycleUnitV3[] {
  const targetNodeIds = Array.from(nodeSetFromEdges(Array.from(targetEdgeIds).map((edgeId) => graph.edges.get(edgeId)).filter((edge): edge is EnrichedEdge => Boolean(edge))));
  const preferredRoots = [entryNodeId, ...targetNodeIds.filter((nodeId) => nodeId !== entryNodeId)]
    .sort((left, right) => targetDegree(graph, right, targetEdgeIds) - targetDegree(graph, left, targetEdgeIds))
    .slice(0, 160);
  const units: IndexedCycleUnitV3[] = [];
  const signatures = new Set<string>();
  const maxDepth = 22;
  const maxCycles = 220;

  for (const root of preferredRoots) {
    const stack: Array<{ edges: EnrichedEdge[]; nodeIds: string[]; usedEdgeIds: Set<string>; visitedNodeIds: Set<string>; distanceKm: number; naturalKm: number }> = [{
      edges: [],
      nodeIds: [root],
      usedEdgeIds: new Set<string>(),
      visitedNodeIds: new Set<string>([root]),
      distanceKm: 0,
      naturalKm: 0,
    }];
    let inspected = 0;
    while (stack.length > 0 && inspected < 4000 && units.length < maxCycles) {
      inspected += 1;
      const current = stack.pop();
      if (!current) break;
      const nodeId = current.nodeIds.at(-1) ?? root;
      for (const next of adjacentEdges(graph, nodeId)
        .filter((candidate) => targetEdgeIds.has(candidate.edge.id) && !current.usedEdgeIds.has(candidate.edge.id))
        .sort((left, right) => classifyEdgeSemanticsV3(right.edge).trailConfidence - classifyEdgeSemanticsV3(left.edge).trailConfidence || right.edge.lengthKm - left.edge.lengthKm)
        .slice(0, 10)) {
        const semantics = classifyEdgeSemanticsV3(next.edge);
        const nextDistanceKm = current.distanceKm + next.edge.lengthKm;
        if (nextDistanceKm > maxTargetDistanceKm + 0.001) continue;
        const nextNaturalKm = current.naturalKm + next.edge.lengthKm * semantics.candidateNaturalWeight;
        if (next.to === root && current.edges.length >= 2) {
          const edges = [...current.edges, next.edge];
          const signature = edgeSetSignature(edges);
          if (!signatures.has(signature)) {
            signatures.add(signature);
            units.push({
              id: `indexed-cycle-${units.length + 1}`,
              edges,
              nodeIds: [...current.nodeIds, root],
              lengthKm: nextDistanceKm,
              naturalKm: nextNaturalKm,
              entryNodeIds: Array.from(new Set([...current.nodeIds, root])),
            });
          }
          continue;
        }
        if (current.edges.length + 1 >= maxDepth || current.visitedNodeIds.has(next.to)) continue;
        stack.push({
          edges: [...current.edges, next.edge],
          nodeIds: [...current.nodeIds, next.to],
          usedEdgeIds: new Set([...Array.from(current.usedEdgeIds), next.edge.id]),
          visitedNodeIds: new Set([...Array.from(current.visitedNodeIds), next.to]),
          distanceKm: nextDistanceKm,
          naturalKm: nextNaturalKm,
        });
      }
    }
    if (units.length >= maxCycles) break;
  }

  return units
    .filter((unit) => unit.lengthKm >= Math.min(1.5, targetDistanceKm * 0.2))
    .sort((left, right) => scoreIndexedCycleUnit(right, targetDistanceKm) - scoreIndexedCycleUnit(left, targetDistanceKm))
    .slice(0, 80);
}

function orientCycleUnitAtNode(unit: IndexedCycleUnitV3, nodeId: string): { edges: EnrichedEdge[]; nodeIds: string[] } {
  const index = unit.nodeIds.slice(0, -1).indexOf(nodeId);
  if (index <= 0) return { edges: [...unit.edges], nodeIds: [...unit.nodeIds] };
  return {
    edges: [...unit.edges.slice(index), ...unit.edges.slice(0, index)],
    nodeIds: [...unit.nodeIds.slice(index, -1), ...unit.nodeIds.slice(0, index + 1)],
  };
}

function reachableTargetCapacityFromNode(graph: EnrichedGraph, startNodeId: string, targetEdgeIds: Set<string>): number {
  const visitedNodes = new Set<string>([startNodeId]);
  const visitedEdgeIds = new Set<string>();
  const stack = [startNodeId];
  while (stack.length > 0 && visitedNodes.size < 5000) {
    const nodeId = stack.pop();
    if (!nodeId) break;
    for (const next of adjacentEdges(graph, nodeId)) {
      if (!targetEdgeIds.has(next.edge.id)) continue;
      visitedEdgeIds.add(next.edge.id);
      if (!visitedNodes.has(next.to)) {
        visitedNodes.add(next.to);
        stack.push(next.to);
      }
    }
  }
  return Array.from(visitedEdgeIds).reduce((sum, edgeId) => sum + (graph.edges.get(edgeId)?.lengthKm ?? 0), 0);
}

function countBranchUnits(graph: EnrichedGraph, targetEdgeIds: Set<string>): number {
  const targetEdges = Array.from(targetEdgeIds).map((edgeId) => graph.edges.get(edgeId)).filter((edge): edge is EnrichedEdge => Boolean(edge));
  const nodeIds = nodeSetFromEdges(targetEdges);
  let count = 0;
  for (const nodeId of Array.from(nodeIds)) {
    const degree = targetDegree(graph, nodeId, targetEdgeIds);
    if (degree === 1 || degree >= 3) count += 1;
  }
  return count;
}

function targetDegree(graph: EnrichedGraph, nodeId: string, targetEdgeIds: Set<string>): number {
  return adjacentEdges(graph, nodeId).filter((candidate) => targetEdgeIds.has(candidate.edge.id)).length;
}

function scoreIndexedCycleUnit(unit: IndexedCycleUnitV3, targetDistanceKm: number): number {
  return unit.naturalKm * 3 + Math.min(unit.lengthKm, targetDistanceKm) - Math.abs(targetDistanceKm - unit.lengthKm) * 0.35 + unit.entryNodeIds.length * 0.02;
}

function edgeSetSignature(edges: EnrichedEdge[]): string {
  return edges.map((edge) => edge.id).sort().join('\u0000');
}

function edgePairKey(edge: EnrichedEdge): string {
  return [edge.from, edge.to].sort().join('::');
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
  const seenCandidateSignatures = new Set<string>();
  let duplicateReturnedCandidateCount = 0;
  let inspected = 0;
  let maxFrontierDistanceKm = 0;
  let maxCandidateDistanceKm = 0;
  let maxUsefulCandidateDistanceKm = 0;
  let prunedByMaxTargetDistance = 0;
  let stoppedAfterGoodEnoughReturn = 0;
  let stoppedByNoUnusedTargetEdges = 0;
  let prunedNextOverMaxTargetDistance = 0;
  let bridgeExpansionAttemptCount = 0;
  let bridgeExpansionUsedCount = 0;
  let bridgeExpansionUnlockedTargetEdgeCount = 0;
  const frontierDeadEnds: Array<{
    nodeId: string;
    distanceKm: number;
    naturalDwellKm: number;
    completedCycles: number;
    unusedAdjacentTargetKm: number;
    bridgeCandidateCount: number;
    bridgeUnlockedTargetKm: number;
  }> = [];

  while (stack.length > 0 && inspected < 140_000 && candidates.length < 160) {
    inspected += 1;
    const current = stack.pop();
    if (!current) break;
    const currentDistanceKm = sumLengthKm(current.edges);
    maxFrontierDistanceKm = Math.max(maxFrontierDistanceKm, currentDistanceKm);
    const nodeId = current.nodeIds.at(-1) ?? entryNodeId;
    const returnedToEntry = nodeId === entryNodeId && current.edges.length > 0;
    const completedCycles = returnedToEntry ? current.completedCycles + 1 : current.completedCycles;

    if (returnedToEntry && current.naturalDwellKm >= mission.target.minNaturalDwellKm) {
      maxCandidateDistanceKm = Math.max(maxCandidateDistanceKm, currentDistanceKm);
      const candidateSignature = current.edges.map((edge) => edge.id).join('\u0000');
      if (seenCandidateSignatures.has(candidateSignature)) {
        duplicateReturnedCandidateCount += 1;
      } else {
        seenCandidateSignatures.add(candidateSignature);
        candidates.push({
          edges: current.edges,
          nodeIds: current.nodeIds,
          naturalDwellKm: current.naturalDwellKm,
          completedCycles,
        });
      }
    }
    if (currentDistanceKm >= maxTargetDistanceKm - 0.001) {
      prunedByMaxTargetDistance += 1;
      continue;
    }

    const shouldKeepChaining = !returnedToEntry
      || currentDistanceKm < targetDistanceKm - 0.25
      || completedCycles < 2;
    if (!shouldKeepChaining) {
      stoppedAfterGoodEnoughReturn += 1;
      continue;
    }

    const directNextEdges = adjacentEdges(graph, nodeId)
      .filter((candidate) => targetEdgeIds.has(candidate.edge.id) && !current.usedEdgeIds.has(candidate.edge.id))
      .sort((left, right) => classifyEdgeSemanticsV3(right.edge).trailConfidence - classifyEdgeSemanticsV3(left.edge).trailConfidence || right.edge.lengthKm - left.edge.lengthKm)
      .slice(0, 8);
    const shouldAttemptBridgeExpansion = directNextEdges.length === 0 && completedCycles < 2 && bridgeExpansionAttemptCount < 24;
    const bridgeExtensions = shouldAttemptBridgeExpansion
      ? findBridgeExtensionsToUnusedTargetEdges(graph, nodeId, targetEdgeIds, current.usedEdgeIds, mission)
        .slice(0, 8)
      : [];
    if (bridgeExtensions.length > 0) {
      bridgeExpansionUsedCount += 1;
      bridgeExpansionUnlockedTargetEdgeCount += bridgeExtensions.length;
    }
    const nextExpansions = [
      ...directNextEdges.map((next) => ({
        edges: [next.edge],
        nodeIds: [next.to],
        unlockedTargetKm: next.edge.lengthKm,
      })),
      ...bridgeExtensions,
    ];
    if (directNextEdges.length === 0) {
      stoppedByNoUnusedTargetEdges += 1;
      if (shouldAttemptBridgeExpansion) bridgeExpansionAttemptCount += 1;
      if (frontierDeadEnds.length < 12) {
        frontierDeadEnds.push({
          nodeId,
          distanceKm: currentDistanceKm,
          naturalDwellKm: current.naturalDwellKm,
          completedCycles,
          unusedAdjacentTargetKm: sumLengthKm(adjacentEdges(graph, nodeId)
            .filter((candidate) => targetEdgeIds.has(candidate.edge.id) && !current.usedEdgeIds.has(candidate.edge.id))
            .map((candidate) => candidate.edge)),
          bridgeCandidateCount: bridgeExtensions.length,
          bridgeUnlockedTargetKm: bridgeExtensions.reduce((sum, extension) => sum + extension.unlockedTargetKm, 0),
        });
      }
    }

    for (const next of nextExpansions) {
      const nextDistanceKm = currentDistanceKm + sumLengthKm(next.edges);
      if (nextDistanceKm > maxTargetDistanceKm + 0.001) {
        prunedNextOverMaxTargetDistance += 1;
        continue;
      }
      const naturalDwellKm = next.edges.reduce((sum, edge) => {
        const semantics = classifyEdgeSemanticsV3(edge);
        return sum + edge.lengthKm * semantics.candidateNaturalWeight;
      }, current.naturalDwellKm);
      stack.push({
        edges: [...current.edges, ...next.edges],
        nodeIds: [...current.nodeIds, ...next.nodeIds],
        naturalDwellKm,
        usedEdgeIds: new Set([
          ...Array.from(current.usedEdgeIds),
          ...next.edges.filter((edge) => targetEdgeIds.has(edge.id)).map((edge) => edge.id),
        ]),
        completedCycles,
      });
    }
  }

  const usefulMultiCycleCandidates = candidates
    .filter((candidate) => candidate.completedCycles >= 2 || sumLengthKm(candidate.edges) >= targetDistanceKm - 0.25)
    .sort((left, right) => scoreTargetLoopAgainstDistance(right, targetDistanceKm) - scoreTargetLoopAgainstDistance(left, targetDistanceKm));
  for (const candidate of usefulMultiCycleCandidates) {
    maxUsefulCandidateDistanceKm = Math.max(maxUsefulCandidateDistanceKm, sumLengthKm(candidate.edges));
  }
  const selected = usefulMultiCycleCandidates[0] ?? null;
  if (!selected) return null;
  return {
    ...selected,
    productionDiagnostics: {
      source: 'multi_cycle_chain',
      inspected,
      stackRemaining: stack.length,
      hardStop: inspected >= 140_000 ? 'inspected_cap' : candidates.length >= 160 ? 'candidate_cap' : 'exhausted',
      emittedCandidateCount: candidates.length,
      duplicateReturnedCandidateCount,
      usefulCandidateCount: usefulMultiCycleCandidates.length,
      targetDistanceKm,
      maxTargetDistanceKm,
      maxFrontierDistanceKm,
      maxCandidateDistanceKm,
      maxUsefulCandidateDistanceKm,
      selectedTargetDistanceKm: sumLengthKm(selected.edges),
      selectedCompletedCycles: selected.completedCycles,
      stopCounts: {
        prunedByMaxTargetDistance,
        stoppedAfterGoodEnoughReturn,
        stoppedByNoUnusedTargetEdges,
        prunedNextOverMaxTargetDistance,
      },
      bridgeExpansion: {
        attemptCount: bridgeExpansionAttemptCount,
        usedCount: bridgeExpansionUsedCount,
        unlockedTargetEdgeCount: bridgeExpansionUnlockedTargetEdgeCount,
        frontierDeadEnds,
      },
      topUsefulCandidates: usefulMultiCycleCandidates.slice(0, 8).map((candidate) => ({
        distanceKm: sumLengthKm(candidate.edges),
        naturalDwellKm: candidate.naturalDwellKm,
        completedCycles: candidate.completedCycles,
        score: scoreTargetLoopAgainstDistance(candidate, targetDistanceKm),
      })),
    },
  };
}

function findBridgeExtensionsToUnusedTargetEdges(
  graph: EnrichedGraph,
  nodeId: string,
  targetEdgeIds: Set<string>,
  usedEdgeIds: Set<string>,
  mission: MissionContractV3,
): Array<{ edges: EnrichedEdge[]; nodeIds: string[]; unlockedTargetKm: number }> {
  type BridgeState = { edges: EnrichedEdge[]; nodeIds: string[]; distanceKm: number; currentNodeId: string; visitedNodeIds: Set<string> };
  const maxBridgeKm = Math.min(1.5, Math.max(0.35, mission.budgets.maxConnectorRepeatKm));
  const queue: BridgeState[] = [{
    edges: [],
    nodeIds: [],
    distanceKm: 0,
    currentNodeId: nodeId,
    visitedNodeIds: new Set([nodeId]),
  }];
  const extensions: Array<{ edges: EnrichedEdge[]; nodeIds: string[]; unlockedTargetKm: number; score: number }> = [];
  let inspected = 0;

  while (queue.length > 0 && inspected < 600 && extensions.length < 16) {
    inspected += 1;
    queue.sort((left, right) => left.distanceKm - right.distanceKm);
    const current = queue.shift();
    if (!current) break;

    if (current.edges.length > 0) {
      const unlockedTargets = adjacentEdges(graph, current.currentNodeId)
        .filter((candidate) => targetEdgeIds.has(candidate.edge.id) && !usedEdgeIds.has(candidate.edge.id))
        .sort((left, right) => classifyEdgeSemanticsV3(right.edge).trailConfidence - classifyEdgeSemanticsV3(left.edge).trailConfidence || right.edge.lengthKm - left.edge.lengthKm)
        .slice(0, 4);
      for (const target of unlockedTargets) {
        const edges = [...current.edges, target.edge];
        extensions.push({
          edges,
          nodeIds: [...current.nodeIds, target.to],
          unlockedTargetKm: target.edge.lengthKm,
          score: target.edge.lengthKm * 3 - current.distanceKm,
        });
      }
      if (unlockedTargets.length > 0) continue;
    }

    for (const next of adjacentEdges(graph, current.currentNodeId)) {
      if (targetEdgeIds.has(next.edge.id) || usedEdgeIds.has(next.edge.id) || current.visitedNodeIds.has(next.to)) continue;
      const semantics = classifyEdgeSemanticsV3(next.edge);
      if (semantics.surfaceEvidence === 'explicit_paved') continue;
      if (!semantics.isConnectorLike && !semantics.isTrailCandidate) continue;
      const distanceKm = current.distanceKm + next.edge.lengthKm;
      if (distanceKm > maxBridgeKm + 0.001) continue;
      queue.push({
        edges: [...current.edges, next.edge],
        nodeIds: [...current.nodeIds, next.to],
        distanceKm,
        currentNodeId: next.to,
        visitedNodeIds: new Set([...Array.from(current.visitedNodeIds), next.to]),
      });
    }
  }

  return extensions
    .sort((left, right) => right.score - left.score)
    .map((extension) => ({
      edges: extension.edges,
      nodeIds: extension.nodeIds,
      unlockedTargetKm: extension.unlockedTargetKm,
    }));
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
  let bestNearDwellRoute: TargetLoop | null = null;
  let inspected = 0;

  while (stack.length > 0 && inspected < 20_000) {
    inspected += 1;
    const current = stack.pop();
    if (!current) break;
    const currentDistanceKm = sumLengthKm(current.edges);
    const nodeId = current.nodeIds.at(-1) ?? entryNodeId;
    if (currentDistanceKm > maxTargetDistanceKm + 0.001) continue;

    const nextEdges = adjacentEdges(graph, nodeId)
      .filter((candidate) => targetEdgeIds.has(candidate.edge.id) && !current.usedEdgeIds.has(candidate.edge.id))
      .sort((left, right) => classifyEdgeSemanticsV3(right.edge).trailConfidence - classifyEdgeSemanticsV3(left.edge).trailConfidence || right.edge.lengthKm - left.edge.lengthKm);

    if (nodeId !== entryNodeId && current.naturalDwellKm >= mission.target.minNaturalDwellKm * 0.9) {
      const nearDwellRoute = { edges: current.edges, nodeIds: current.nodeIds, naturalDwellKm: current.naturalDwellKm };
      if (!bestNearDwellRoute || scoreTargetLoop(nearDwellRoute, mission) > scoreTargetLoop(bestNearDwellRoute, mission)) {
        bestNearDwellRoute = nearDwellRoute;
      }
    }

    if (nodeId !== entryNodeId && (current.naturalDwellKm >= mission.target.minNaturalDwellKm
      || (nextEdges.length === 0 && current.naturalDwellKm >= mission.target.minNaturalDwellKm * 0.9))) {
      routes.push({ edges: current.edges, nodeIds: current.nodeIds, naturalDwellKm: current.naturalDwellKm });
      if (currentDistanceKm >= maxTargetDistanceKm - 0.001 || routes.length >= 80) continue;
    }

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

  if (bestNearDwellRoute && !routes.some((route) => route.nodeIds.join('>') === bestNearDwellRoute.nodeIds.join('>'))) {
    routes.push(bestNearDwellRoute);
  }

  return routes.sort((left, right) => scoreTargetLoop(right, mission) - scoreTargetLoop(left, mission)).slice(0, 20);
}

function observeTargetLateralRoutesFromEntry(
  graph: EnrichedGraph,
  startNodeId: string,
  entryNodeId: string,
  targetEdges: EnrichedEdge[],
  mission: MissionContractV3,
): Record<string, unknown> {
  const targetEdgeIds = new Set(targetEdges.map((edge) => edge.id));
  const maxTargetDistanceKm = Math.max(mission.target.minNaturalDwellKm, mission.request.maxDistanceKm);
  const stack: Array<TargetLoop & { usedEdgeIds: Set<string> }> = [{
    edges: [],
    nodeIds: [entryNodeId],
    naturalDwellKm: 0,
    usedEdgeIds: new Set<string>(),
  }];
  let inspected = 0;
  let emittedRouteCount = 0;
  let closureFeasibleRouteCount = 0;
  let closureInfeasibleRouteCount = 0;
  let maxCleanLateralDistanceKm = 0;
  let maxCleanLateralNaturalDwellKm = 0;
  let terminalFrontierCount = 0;
  let prunedByMaxTargetDistance = 0;
  const topLateralFrontiers: Array<{
    exitNodeId: string;
    distanceKm: number;
    naturalDwellKm: number;
    adjacentUnusedTargetKm: number;
    closureFeasible: boolean;
    closureDistanceKm: number | null;
  }> = [];

  while (stack.length > 0 && inspected < 20_000) {
    inspected += 1;
    const current = stack.pop();
    if (!current) break;
    const currentDistanceKm = sumLengthKm(current.edges);
    const nodeId = current.nodeIds.at(-1) ?? entryNodeId;

    if (nodeId !== entryNodeId) {
      maxCleanLateralDistanceKm = Math.max(maxCleanLateralDistanceKm, currentDistanceKm);
      maxCleanLateralNaturalDwellKm = Math.max(maxCleanLateralNaturalDwellKm, current.naturalDwellKm);
    }

    const nextEdges = adjacentEdges(graph, nodeId)
      .filter((candidate) => targetEdgeIds.has(candidate.edge.id) && !current.usedEdgeIds.has(candidate.edge.id))
      .sort((left, right) => classifyEdgeSemanticsV3(right.edge).trailConfidence - classifyEdgeSemanticsV3(left.edge).trailConfidence || right.edge.lengthKm - left.edge.lengthKm);

    if (nodeId !== entryNodeId && current.naturalDwellKm >= mission.target.minNaturalDwellKm) {
      emittedRouteCount += 1;
      const closurePath = connectorPathBetweenNodes(graph, nodeId, startNodeId, mission.budgets.maxClosurePavedKm + mission.budgets.maxConnectorRepeatKm);
      if (closurePath) closureFeasibleRouteCount += 1;
      else closureInfeasibleRouteCount += 1;
      if (topLateralFrontiers.length < 16) {
        topLateralFrontiers.push({
          exitNodeId: nodeId,
          distanceKm: currentDistanceKm,
          naturalDwellKm: current.naturalDwellKm,
          adjacentUnusedTargetKm: sumLengthKm(nextEdges.map((candidate) => candidate.edge)),
          closureFeasible: Boolean(closurePath),
          closureDistanceKm: closurePath?.distanceKm ?? null,
        });
      }
    }

    if (nextEdges.length === 0 && nodeId !== entryNodeId) {
      terminalFrontierCount += 1;
      if (topLateralFrontiers.length < 16) {
        const closurePath = connectorPathBetweenNodes(graph, nodeId, startNodeId, mission.budgets.maxClosurePavedKm + mission.budgets.maxConnectorRepeatKm);
        topLateralFrontiers.push({
          exitNodeId: nodeId,
          distanceKm: currentDistanceKm,
          naturalDwellKm: current.naturalDwellKm,
          adjacentUnusedTargetKm: 0,
          closureFeasible: Boolean(closurePath),
          closureDistanceKm: closurePath?.distanceKm ?? null,
        });
      }
    }

    if (currentDistanceKm > maxTargetDistanceKm + 0.001) {
      prunedByMaxTargetDistance += 1;
      continue;
    }

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

  const topologyStopReason = emittedRouteCount === 0
    ? 'insufficient_clean_lateral_dwell'
    : closureFeasibleRouteCount === 0 ? 'closure_infeasible_from_lateral_exit' : null;

  return {
    source: 'target_lateral',
    routeEmitted: emittedRouteCount > 0,
    entryNodeId,
    inspected,
    emittedRouteCount,
    closureFeasibleRouteCount,
    closureInfeasibleRouteCount,
    terminalFrontierCount,
    maxCleanLateralDistanceKm,
    maxCleanLateralNaturalDwellKm,
    requestedNaturalDwellKm: mission.target.minNaturalDwellKm,
    topologyStopReason,
    stopCounts: {
      prunedByMaxTargetDistance,
    },
    topLateralFrontiers: topLateralFrontiers
      .sort((left, right) => right.naturalDwellKm - left.naturalDwellKm || right.distanceKm - left.distanceKm)
      .slice(0, 8),
  };
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
  const targetDistanceKm = Math.max(mission.target.minNaturalDwellKm, mission.request.targetDistanceKm - mission.budgets.maxConnectorRepeatKm);
  return scoreTargetLoopAgainstDistance(loop, targetDistanceKm);
}

function scoreTargetLoopAgainstDistance(loop: TargetLoop, targetDistanceKm: number): number {
  const distanceKm = sumLengthKm(loop.edges);
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
