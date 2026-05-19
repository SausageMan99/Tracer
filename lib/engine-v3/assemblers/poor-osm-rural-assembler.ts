import type { EnrichedEdge, EnrichedGraph } from '../../types';
import { classifyEdgeSemanticsV3 } from '../edge-semantics';
import type {
  AssemblerResultV3,
  AssemblyPhaseDiagnosticsV3,
  CandidatePortfolioV3,
  MissionContractV3,
  RouteCandidateV3,
} from '../contracts';
import type { RouteMetricsV3 } from '../types';
import { normalizeCandidatePortfolioV3 } from './candidate-portfolio';

export function assemblePoorOsmRuralMissionV3(
  graph: EnrichedGraph,
  mission: MissionContractV3,
): AssemblerResultV3 {
  const edges = Array.from(graph.edges.values());
  const blocker = hasWeakSurfaceConfidence(edges) && strictTrailKm(edges) < mission.target.minNaturalDwellKm
    ? 'weak_surface_confidence'
    : 'insufficient_target_dwell';
  const diagnosticCandidate = createNegativeEvidenceCandidate(graph, mission, edges, blocker);
  const portfolio = normalizeCandidatePortfolioV3({
    missionId: mission.id,
    candidates: [diagnosticCandidate],
    selectedCandidateId: null,
    topRejected: [diagnosticCandidate],
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
    phaseDiagnostics: createPoorRuralPhaseDiagnostics(mission, diagnosticCandidate.metrics, blocker),
    diagnostics: {
      startNodeId: null,
      targetEntryAttempted: true,
      targetEntrySucceeded: false,
      closureAttempted: false,
      closureSucceeded: false,
      firstDropStage: 'final_gate',
      blocker,
      observationOnly: {
        exportPolicy: { emptyOnRefusal: true },
        surfaceConfidence: 'weak',
      },
    },
    warnings: [blocker, 'road_like_unknown_never_counts_as_strict_trail'],
  };
}

function createNegativeEvidenceCandidate(
  graph: EnrichedGraph,
  mission: MissionContractV3,
  edges: EnrichedEdge[],
  blocker: string,
): RouteCandidateV3 {
  const nodeIds = nodeIdsFromEdges(edges);

  return {
    id: `${mission.id}-negative-surface-evidence`,
    source: 'diagnostic',
    lane: 'negative_evidence',
    lifecycle: 'rejected',
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
    returned: false,
    metrics: metricsFromEdges(edges, mission.request.targetDistanceKm),
    gates: [{ id: blocker, status: 'fail', severity: 'hard', reason: blocker }],
    selectionScore: -1,
    selected: false,
    rejectedReason: blocker,
  };
}

function createPoorRuralPhaseDiagnostics(
  mission: MissionContractV3,
  metrics: RouteMetricsV3,
  blocker: string,
): AssemblyPhaseDiagnosticsV3 {
  return {
    access: {
      status: 'failure',
      accessKm: 0,
      accessPavedKm: 0,
      entryNodeId: null,
      componentId: mission.target.componentIds[0] ?? null,
      rejectedEntryReasons: { [blocker]: 1 },
    },
    dwell: {
      status: 'failure',
      targetDwellKm: metrics.naturalDwellKm,
      requestedTargetDwellKm: mission.target.minNaturalDwellKm,
      longestTrailSegmentKm: metrics.longestTrailSegmentKm,
      cleanExploitableKm: metrics.naturalDwellKm,
      targetRepeatKm: 0,
    },
    recovery: {
      status: 'not_attempted',
      recoveredDistanceKm: 0,
      recoveryPavedKm: 0,
      recoveryRejectedReasons: { [blocker]: 1 },
    },
    closure: {
      status: 'not_attempted',
      closureKm: 0,
      closurePavedKm: 0,
      connectorRepeatKm: 0,
      targetRepeatKm: 0,
      closureRejectedReasons: { [blocker]: 1 },
    },
    finalGate: {
      status: 'no_selectable_candidate',
      distanceKm: metrics.distanceProducedKm,
      finalPavedRatioEstimate: metrics.pavedRatio,
      trailRatio: metrics.trailRatio,
      naturalWayRatio: metrics.naturalWayRatio,
      pavedRatio: metrics.pavedRatio,
      gateFailures: [blocker],
    },
  };
}

function hasWeakSurfaceConfidence(edges: EnrichedEdge[]): boolean {
  return edges.some((edge) => edge.terrainContext?.confidence === 'low');
}

function strictTrailKm(edges: EnrichedEdge[]): number {
  return sumLengthKm(edges.filter((edge) => classifyEdgeSemanticsV3(edge).isStrictTrailLike));
}

function metricsFromEdges(edges: EnrichedEdge[], targetDistanceKm: number): RouteMetricsV3 {
  const distanceProducedKm = sumLengthKm(edges);
  const strictTrailKmValue = strictTrailKm(edges);
  const explicitPavedKm = sumLengthKm(edges.filter((edge) => classifyEdgeSemanticsV3(edge).surfaceEvidence === 'explicit_paved' || classifyEdgeSemanticsV3(edge).surfaceEvidence === 'road_like_unknown'));
  const explicitNaturalKm = sumLengthKm(edges.filter((edge) => classifyEdgeSemanticsV3(edge).surfaceEvidence === 'explicit_natural'));
  const pathTrackUnknownKm = sumLengthKm(edges.filter((edge) => classifyEdgeSemanticsV3(edge).surfaceEvidence === 'path_track_unknown'));
  const roadLikeUnknownKm = sumLengthKm(edges.filter((edge) => classifyEdgeSemanticsV3(edge).surfaceEvidence === 'road_like_unknown'));
  const visitedComponents = Array.from(new Set(edges.map((edge) => classifyEdgeSemanticsV3(edge).componentKind)));

  return {
    targetDistanceKm,
    distanceProducedKm,
    strictTrailKm: strictTrailKmValue,
    explicitNaturalKm,
    explicitPavedKm,
    roadLikeUnknownKm,
    pathTrackUnknownKm,
    candidateNaturalKm: explicitNaturalKm + pathTrackUnknownKm,
    trailCandidateKm: strictTrailKmValue,
    unverifiedTrailCandidateKm: pathTrackUnknownKm,
    trailRatio: ratio(strictTrailKmValue, distanceProducedKm),
    naturalWayRatio: ratio(explicitNaturalKm + pathTrackUnknownKm, distanceProducedKm),
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
    longestTrailSegmentKm: strictTrailKmValue,
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
