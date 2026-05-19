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
  const targetEdges = Array.from(graph.edges.values()).filter((edge) => {
    const semantics = classifyEdgeSemanticsV3(edge);
    return mission.target.componentKinds.includes(semantics.componentKind) && semantics.isStrictTrailLike;
  });
  const scenicPavedEdges = Array.from(graph.edges.values()).filter((edge) => {
    const semantics = classifyEdgeSemanticsV3(edge);
    return semantics.componentKind === 'scenic_paved' && semantics.surfaceEvidence === 'explicit_paved';
  });
  const targetDistanceKm = sumLengthKm(targetEdges);

  if (targetDistanceKm < mission.request.minDistanceKm || targetDistanceKm < mission.target.minNaturalDwellKm) {
    const blocker = scenicPavedEdges.length > 0 ? 'dominant_paved_scenic_core' : 'insufficient_natural_target_capacity';

    if (scenicPavedEdges.length === 0) {
      return createNoCandidateAssemblerResultV3(mission, blocker);
    }

    const scenicCandidate = createCandidate({
      id: `${mission.id}-scenic-paved-diagnostic`,
      edges: scenicPavedEdges,
      graph,
      lane: 'connector_heavy',
      source: 'diagnostic',
      mission,
      selectionScore: -scenicPavedEdges.length,
      rejectedReason: blocker,
    });
    const portfolio = normalizeCandidatePortfolioV3({
      missionId: mission.id,
      candidates: [scenicCandidate],
      selectedCandidateId: null,
      topRejected: [scenicCandidate],
      counts: emptyPortfolioCounts(),
      diagnostics: {
        firstDropStage: 'final_gate',
        blocker,
        phaseBlockers: { final_gate: [blocker] },
      },
    });

    return {
      mission,
      status: 'no_candidate',
      portfolio,
      selectedCandidate: null,
      phaseDiagnostics: createPhaseDiagnostics(mission, null, blocker),
      diagnostics: {
        startNodeId: null,
        targetEntryAttempted: true,
        targetEntrySucceeded: false,
        closureAttempted: true,
        closureSucceeded: false,
        firstDropStage: 'final_gate',
        blocker,
        observationOnly: {
          rejectedScenicPavedCandidateCount: 1,
        },
      },
      warnings: [blocker],
    };
  }

  const validCandidate = createCandidate({
    id: `${mission.id}-forest-natural-loop`,
    edges: targetEdges,
    graph,
    lane: 'complete_valid',
    source: 'strategy_assembler',
    mission,
    selectionScore: targetDistanceKm,
  });
  const diagnosticCandidates = scenicPavedEdges.length > 0
    ? [createCandidate({
        id: `${mission.id}-scenic-paved-diagnostic`,
        edges: scenicPavedEdges,
        graph,
        lane: 'connector_heavy',
        source: 'diagnostic',
        mission,
        selectionScore: -scenicPavedEdges.length,
        rejectedReason: 'dominant_paved_scenic_core',
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
    phaseDiagnostics: createPhaseDiagnostics(mission, selectedCandidate),
    diagnostics: {
      startNodeId: selectedCandidate?.nodeIds[0] ?? null,
      targetEntryAttempted: true,
      targetEntrySucceeded: selectedCandidate !== null,
      closureAttempted: true,
      closureSucceeded: selectedCandidate !== null,
      firstDropStage: null,
      blocker: null,
      observationOnly: {
        rejectedScenicPavedCandidateCount: diagnosticCandidates.length,
      },
    },
    warnings: diagnosticCandidates.length > 0 ? ['dominant_paved_scenic_core_rejected_as_diagnostic'] : [],
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
}): RouteCandidateV3 {
  const nodeIds = nodeIdsFromEdges(input.edges);
  const metrics = metricsFromEdges(input.edges, input.mission.request.targetDistanceKm);

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
      : [{ id: 'forest_loop_target_dwell', status: 'pass', severity: 'info' }],
    selectionScore: input.selectionScore,
    selected: false,
    rejectedReason: input.rejectedReason,
  };
}

function nodeIdsFromEdges(edges: EnrichedEdge[]): string[] {
  if (edges.length === 0) return [];
  return [edges[0].from, ...edges.map((edge) => edge.to)];
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

function createPhaseDiagnostics(
  mission: MissionContractV3,
  selectedCandidate: RouteCandidateV3 | null,
  blocker?: string,
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
      status: metrics ? 'success' : 'failure',
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
      status: metrics ? 'success' : 'failure',
      closureKm: 0,
      closurePavedKm: 0,
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

function sumLengthKm(edges: EnrichedEdge[]): number {
  return edges.reduce((sum, edge) => sum + edge.lengthKm, 0);
}

function ratio(numerator: number, denominator: number): number {
  return denominator > 0 ? numerator / denominator : 0;
}
