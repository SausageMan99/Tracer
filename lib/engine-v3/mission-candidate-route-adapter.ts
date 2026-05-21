import type { EnrichedEdge, EnrichedGraph, GraphNode } from '../types';
import { classifyEdgeSemanticsV3 } from './edge-semantics';
import type { AssemblerResultV3, RouteCandidateV3 } from './contracts';
import type { AssembledRouteV3, CorridorMissionV3, RouteEdgeV3, RouteIntentV3 } from './types';

export function assembledRouteFromMissionCandidateV3(input: {
  intent: RouteIntentV3;
  corridorMission: CorridorMissionV3;
  graph: EnrichedGraph;
  assemblerResult: AssemblerResultV3;
  candidate: RouteCandidateV3;
}): AssembledRouteV3 {
  const edges = input.candidate.edgeIds.map((edgeId, index) => toRouteEdge(input.graph, edgeId, input.candidate.nodeIds, index));
  const geometry = input.candidate.geometry.coordinates.length >= 2
    ? input.candidate.geometry
    : toGeometry(input.graph, input.candidate.nodeIds);

  return {
    engine: 'v3-clean-room',
    strategy: input.intent.strategy,
    mission: cloneCorridorMission(input.corridorMission),
    segments: [],
    edges,
    nodeIds: [...input.candidate.nodeIds],
    geometry,
    surfaces: {
      pavedKm: input.candidate.metrics.pavedKm,
      nonPavedKm: input.candidate.metrics.nonPavedKm,
      naturalDwellKm: input.candidate.metrics.naturalDwellKm,
    },
    metrics: { ...input.candidate.metrics },
    assemblyDiagnostics: {
      startNodeId: input.assemblerResult.diagnostics.startNodeId,
      distanceToFirstNonPavedTargetKm: null,
      reachableNonPavedTargetEdgeCount: 0,
      reachableNonPavedTargetKm: input.assemblerResult.phaseDiagnostics.dwell.cleanExploitableKm,
      candidateCount: input.assemblerResult.portfolio.candidates.length,
      inEnvelopeCount: input.assemblerResult.portfolio.counts.inEnvelope,
      candidateCountByLane: { ...input.assemblerResult.portfolio.counts },
      selectedCandidateId: input.candidate.id,
      selectedReason: `mission-driven:${input.candidate.selectedReason ?? input.candidate.lane}`,
      topFinalCandidates: input.assemblerResult.portfolio.candidates
        .sort((left, right) => right.selectionScore - left.selectionScore)
        .slice(0, 8)
        .map((candidate, index) => ({
          rank: index + 1,
          id: candidate.id,
          selected: candidate.id === input.candidate.id,
          inSelectionPool: candidate.lane === 'complete_valid' || candidate.lane === 'complete_adjustable',
          rejectedReason: candidate.rejectedReason ?? null,
          gate: candidate.gates.find((gate) => gate.status === 'fail')?.id ?? null,
          distanceKm: candidate.metrics.distanceProducedKm,
          naturalDwellKm: candidate.metrics.naturalDwellKm,
          pavedKm: candidate.metrics.pavedKm,
          pavedRatio: candidate.metrics.pavedRatio,
          finalPavedRatioEstimate: candidate.metrics.pavedRatio,
          mixedUnknownKm: candidate.metrics.pathTrackUnknownKm ?? 0,
          strictTrailKm: candidate.metrics.strictTrailKm ?? 0,
          longestTrailSegmentKm: candidate.metrics.longestTrailSegmentKm,
          repeatKm: candidate.metrics.repeatEdgeKm,
          targetRepeatKm: candidate.metrics.targetRepeatKm,
          connectorRepeatKm: candidate.metrics.connectorRepeatKm,
          returned: candidate.returned,
          scoreComplete: candidate.selectionScore,
          scoreProgress: candidate.selectionScore,
          source: candidate.source,
          selectedReason: candidate.selectedReason ?? null,
        })),
      topRejected: input.assemblerResult.portfolio.topRejected.map((candidate, index) => ({
        rank: index + 1,
        id: candidate.id,
        selected: false,
        inSelectionPool: false,
        rejectedReason: candidate.rejectedReason ?? null,
        gate: candidate.gates.find((gate) => gate.status === 'fail')?.id ?? null,
        distanceKm: candidate.metrics.distanceProducedKm,
        naturalDwellKm: candidate.metrics.naturalDwellKm,
        pavedKm: candidate.metrics.pavedKm,
        pavedRatio: candidate.metrics.pavedRatio,
        finalPavedRatioEstimate: candidate.metrics.pavedRatio,
        mixedUnknownKm: candidate.metrics.pathTrackUnknownKm ?? 0,
        strictTrailKm: candidate.metrics.strictTrailKm ?? 0,
        longestTrailSegmentKm: candidate.metrics.longestTrailSegmentKm,
        repeatKm: candidate.metrics.repeatEdgeKm,
        targetRepeatKm: candidate.metrics.targetRepeatKm,
        connectorRepeatKm: candidate.metrics.connectorRepeatKm,
        returned: candidate.returned,
        scoreComplete: candidate.selectionScore,
        scoreProgress: candidate.selectionScore,
        source: candidate.source,
        selectedReason: candidate.selectedReason ?? null,
      })),
      firstDropStage: input.assemblerResult.diagnostics.firstDropStage,
      candidateProductionDiagnostics: input.assemblerResult.diagnostics.observationOnly,
    },
    warnings: unique([...input.corridorMission.warnings, ...input.assemblerResult.warnings]),
  };
}

function toRouteEdge(graph: EnrichedGraph, edgeId: string, nodeIds: string[], index: number): RouteEdgeV3 {
  const edge = graph.edges.get(edgeId);
  if (!edge) {
    return {
      id: edgeId,
      from: nodeIds[index] ?? '',
      to: nodeIds[index + 1] ?? '',
      lengthKm: 0,
      surface: 'mixed',
      componentKind: 'field_paths',
      highway: 'unknown',
      osmWayId: 0,
    };
  }

  const from = nodeIds[index];
  const to = nodeIds[index + 1];
  const oriented = from && to && matchesEdge(edge, from, to);
  const semantics = classifyEdgeSemanticsV3(edge);

  return {
    id: edge.id,
    from: oriented ? from : edge.from,
    to: oriented ? to : edge.to,
    lengthKm: round(Math.max(0, edge.lengthKm)),
    surface: semantics.routeSurface,
    componentKind: semantics.componentKind,
    highway: edge.highway,
    osmWayId: edge.osmWayId,
    osmSurface: edge.surface,
  };
}

function matchesEdge(edge: EnrichedEdge, from: string, to: string): boolean {
  return (edge.from === from && edge.to === to) || (edge.from === to && edge.to === from);
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

function cloneCorridorMission(mission: CorridorMissionV3): CorridorMissionV3 {
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

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
