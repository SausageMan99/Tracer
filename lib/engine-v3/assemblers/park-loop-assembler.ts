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

export function assembleParkLoopGraphRouteV3(
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  graph: EnrichedGraph,
): AssembledRouteV3 {
  return assembleGraphRouteWithStrategyV3(intent, mission, graph, {
    mode: 'park_loop',
    warning: 'park_loop may use paved park paths but keeps paved distance explicit instead of selling it as pure trail',
  });
}

export function assembleParkLoopMissionV3(
  graph: EnrichedGraph,
  mission: MissionContractV3,
): AssemblerResultV3 {
  const parkEdges = Array.from(graph.edges.values()).filter((edge) => classifyEdgeSemanticsV3(edge).componentKind === 'park');
  const parkCapacityKm = sumLengthKm(parkEdges);
  const blocker = 'park_capacity_below_requested_distance';
  const relaxationAllowed = mission.relaxations.some((relaxation) => relaxation.allowed && relaxation.id === 'adjust_to_park_capacity');

  if (parkCapacityKm < mission.request.minDistanceKm && !relaxationAllowed) {
    return createNoCandidateAssemblerResultV3(mission, blocker);
  }

  if (parkCapacityKm === 0) {
    return createNoCandidateAssemblerResultV3(mission, blocker);
  }

  const adjustableCandidate = createParkCandidate(graph, mission, parkEdges, blocker);
  const portfolio = normalizeCandidatePortfolioV3({
    missionId: mission.id,
    candidates: [adjustableCandidate],
    selectedCandidateId: adjustableCandidate.id,
    topRejected: [],
    counts: emptyPortfolioCounts(),
    diagnostics: {
      firstDropStage: 'final_gate',
      blocker,
      phaseBlockers: { final_gate: [blocker] },
    },
  });
  const selectedCandidate = selectCandidateFromPortfolioV3(portfolio);

  return {
    mission,
    status: 'portfolio_ready',
    portfolio,
    selectedCandidate,
    phaseDiagnostics: createParkPhaseDiagnostics(mission, selectedCandidate, blocker),
    diagnostics: {
      startNodeId: selectedCandidate?.nodeIds[0] ?? null,
      targetEntryAttempted: true,
      targetEntrySucceeded: selectedCandidate !== null,
      closureAttempted: true,
      closureSucceeded: selectedCandidate !== null,
      firstDropStage: 'final_gate',
      blocker,
      observationOnly: {
        parkCapacityKm,
        requestedMinDistanceKm: mission.request.minDistanceKm,
        compromise: mission.relaxations.find((relaxation) => relaxation.allowed)?.userFacingCompromise ?? null,
      },
    },
    warnings: [blocker],
  };
}

function createParkCandidate(
  graph: EnrichedGraph,
  mission: MissionContractV3,
  edges: EnrichedEdge[],
  blocker: string,
): RouteCandidateV3 {
  const nodeIds = nodeIdsFromEdges(edges);

  return {
    id: `${mission.id}-park-capacity-adjusted`,
    source: 'park_loop',
    lane: 'complete_adjustable',
    lifecycle: 'gated',
    edgeIds: edges.map((edge) => edge.id),
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
    returned: true,
    metrics: metricsFromEdges(edges, mission.request.targetDistanceKm),
    gates: [{ id: blocker, status: 'warning', severity: 'soft', reason: blocker }],
    selectionScore: sumLengthKm(edges),
    selected: false,
    selectedReason: 'park_compromise_relaxation_allowed',
  };
}

function createParkPhaseDiagnostics(
  mission: MissionContractV3,
  selectedCandidate: RouteCandidateV3 | null,
  blocker: string,
): AssemblyPhaseDiagnosticsV3 {
  const metrics = selectedCandidate?.metrics;

  return {
    access: {
      status: metrics ? 'success' : 'failure',
      accessKm: 0,
      accessPavedKm: 0,
      entryNodeId: selectedCandidate?.nodeIds[0] ?? null,
      componentId: mission.target.componentIds[0] ?? null,
      rejectedEntryReasons: {},
    },
    dwell: {
      status: metrics ? 'partial' : 'failure',
      targetDwellKm: metrics?.naturalDwellKm ?? 0,
      requestedTargetDwellKm: mission.target.minNaturalDwellKm,
      longestTrailSegmentKm: metrics?.longestTrailSegmentKm ?? 0,
      cleanExploitableKm: metrics?.naturalDwellKm ?? 0,
      targetRepeatKm: 0,
    },
    recovery: {
      status: metrics ? 'failure' : 'not_attempted',
      recoveredDistanceKm: metrics?.distanceProducedKm ?? 0,
      recoveryPavedKm: 0,
      recoveryRejectedReasons: { [blocker]: 1 },
    },
    closure: {
      status: metrics ? 'success' : 'not_attempted',
      closureKm: 0,
      closurePavedKm: 0,
      connectorRepeatKm: 0,
      targetRepeatKm: 0,
      closureRejectedReasons: {},
    },
    finalGate: {
      status: metrics ? 'candidate_ready' : 'no_selectable_candidate',
      distanceKm: metrics?.distanceProducedKm ?? 0,
      finalPavedRatioEstimate: metrics?.pavedRatio ?? 0,
      trailRatio: metrics?.trailRatio ?? 0,
      naturalWayRatio: metrics?.naturalWayRatio ?? 0,
      pavedRatio: metrics?.pavedRatio ?? 0,
      gateFailures: [blocker],
    },
  };
}

function metricsFromEdges(edges: EnrichedEdge[], targetDistanceKm: number): RouteMetricsV3 {
  const distanceProducedKm = sumLengthKm(edges);
  const strictTrailKm = sumLengthKm(edges.filter((edge) => classifyEdgeSemanticsV3(edge).isStrictTrailLike));
  const explicitPavedKm = sumLengthKm(edges.filter((edge) => classifyEdgeSemanticsV3(edge).surfaceEvidence === 'explicit_paved'));
  const explicitNaturalKm = sumLengthKm(edges.filter((edge) => classifyEdgeSemanticsV3(edge).surfaceEvidence === 'explicit_natural'));
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
    nonPavedKm: Math.max(0, distanceProducedKm - explicitPavedKm),
    naturalDwellKm: explicitNaturalKm,
    repeatEdgeKm: 0,
    targetRepeatKm: 0,
    connectorRepeatKm: 0,
    visitedComponents,
    repeatRatio: 0,
    overlapRatio: 0,
    busyRoadRatio: 0,
    loopClosureKm: 0,
    longestTrailSegmentKm: strictTrailKm,
  };
}

function nodeIdsFromEdges(edges: EnrichedEdge[]): string[] {
  if (edges.length === 0) return [];
  return [edges[0].from, ...edges.map((edge) => edge.to)];
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

function sumLengthKm(edges: EnrichedEdge[]): number {
  return edges.reduce((sum, edge) => sum + edge.lengthKm, 0);
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}
