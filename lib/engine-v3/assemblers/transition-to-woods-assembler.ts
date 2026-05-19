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
  const startNodeId = firstNodeId(graph);
  const targetEdges = Array.from(graph.edges.values()).filter((edge) => {
    const semantics = classifyEdgeSemanticsV3(edge);
    return mission.target.componentKinds.includes(semantics.componentKind)
      && semantics.surfaceEvidence === 'explicit_natural'
      && semantics.isTrailCandidate;
  });
  const accessEdge = Array.from(graph.edges.values()).find((edge) => {
    const semantics = classifyEdgeSemanticsV3(edge);
    return edge.from === startNodeId
      && semantics.isConnectorLike
      && semantics.surfaceEvidence === 'explicit_paved'
      && targetEdges.some((targetEdge) => targetEdge.from === edge.to || targetEdge.to === edge.to);
  });
  const targetDwellKm = sumLengthKm(targetEdges);

  if (!accessEdge) {
    return createNoCandidateAssemblerResultV3(mission, 'missing_access_connector_to_target');
  }

  if (targetDwellKm < mission.target.minNaturalDwellKm) {
    return createNoCandidateAssemblerResultV3(mission, 'insufficient_natural_target_dwell');
  }

  const routeEdges = [accessEdge, ...targetEdges, accessEdge];
  const routeNodeIds = [...nodeIdsFromEdges([accessEdge, ...targetEdges]), startNodeId].filter(Boolean);
  const validCandidate = createCandidate({
    id: `${mission.id}-transition-woods-connector-dwell`,
    edges: routeEdges,
    graph,
    lane: 'complete_valid',
    source: 'strategy_assembler',
    mission,
    selectionScore: targetDwellKm - accessEdge.lengthKm,
    nodeIds: routeNodeIds,
  });
  const residentialDiagnosticEdges = Array.from(graph.edges.values()).filter((edge) => {
    const semantics = classifyEdgeSemanticsV3(edge);
    return semantics.componentKind === 'residential' && edge.id !== accessEdge.id;
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
    candidates: [validCandidate, ...diagnosticCandidates],
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
    phaseDiagnostics: createPhaseDiagnostics(mission, selectedCandidate, accessEdge),
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
    returned: input.rejectedReason ? false : true,
    metrics,
    gates: input.rejectedReason
      ? [{ id: input.rejectedReason, status: 'fail', severity: 'hard', reason: input.rejectedReason }]
      : [{ id: 'transition_to_woods_target_dwell_before_closure', status: 'pass', severity: 'info' }],
    selectionScore: input.selectionScore,
    selected: false,
    rejectedReason: input.rejectedReason,
  };
}

function nodeIdsFromEdges(edges: EnrichedEdge[]): string[] {
  if (edges.length === 0) return [];
  return [edges[0].from, ...edges.map((edge) => edge.to)];
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
  accessEdge: EnrichedEdge,
): AssemblyPhaseDiagnosticsV3 {
  const metrics = selectedCandidate?.metrics;

  return {
    access: {
      status: metrics ? 'success' : 'failure',
      accessKm: accessEdge.lengthKm,
      accessPavedKm: classifyEdgeSemanticsV3(accessEdge).surfaceEvidence === 'explicit_paved' ? accessEdge.lengthKm : 0,
      entryNodeId: accessEdge.to,
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
