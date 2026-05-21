import type { EnrichedEdge, EnrichedGraph } from '../../types';
import { classifyEdgeSemanticsV3 } from '../edge-semantics';
import type {
  AssemblerResultV3,
  AssemblyPhaseDiagnosticsV3,
  CandidatePortfolioV3,
  MissionContractV3,
  RouteCandidateV3,
} from '../contracts';
import type { AssembledRouteV3, CorridorMissionV3, RouteIntentV3, RouteMetricsV3, TerrainComponentKindV3 } from '../types';
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
  const parkEdges = routeableUrbanParkEdges(graph, mission);
  const parkCapacityKm = sumLengthKm(parkEdges);
  const blocker = mission.strategy === 'urban_nature_loop'
    ? 'urban_nature_corridor_capacity_below_requested_distance'
    : 'park_capacity_below_requested_distance';
  const relaxationAllowed = mission.relaxations.some((relaxation) => relaxation.allowed && relaxation.id === 'adjust_to_park_capacity');

  if (parkCapacityKm < mission.request.minDistanceKm && !relaxationAllowed) {
    return createNoCandidateAssemblerResultV3(mission, blocker);
  }

  if (parkCapacityKm === 0) {
    return createNoCandidateAssemblerResultV3(mission, blocker);
  }

  const adjustableCandidate = createParkCandidate(graph, mission, selectUrbanParkRouteEdges(graph, mission, parkEdges), blocker);
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
    warnings: [
      mission.strategy === 'urban_nature_loop'
        ? 'urban_nature_loop may use paved park/canal/corridor paths but keeps paved distance explicit instead of selling it as pure trail'
        : 'park_loop may use paved park paths but keeps paved distance explicit instead of selling it as pure trail',
      blocker,
    ],
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

function routeableUrbanParkEdges(graph: EnrichedGraph, mission: MissionContractV3): EnrichedEdge[] {
  const allowedKinds = allowedUrbanParkComponentKinds(mission);
  return Array.from(graph.edges.values()).filter((edge) => allowedKinds.has(classifyEdgeSemanticsV3(edge).componentKind));
}

function allowedUrbanParkComponentKinds(mission: MissionContractV3): ReadonlySet<TerrainComponentKindV3> {
  if (mission.strategy === 'urban_nature_loop') {
    return new Set<TerrainComponentKindV3>(['park', 'urban_green', 'river_corridor', 'scenic_paved', 'field_paths']);
  }
  return new Set<TerrainComponentKindV3>(['park']);
}

function selectUrbanParkRouteEdges(
  graph: EnrichedGraph,
  mission: MissionContractV3,
  edges: EnrichedEdge[],
): EnrichedEdge[] {
  const startNodeId = closestNodeId(graph, mission.request.start) ?? edges[0]?.from ?? null;
  if (!startNodeId) return [];

  const adjacency = buildAllowedAdjacency(edges);
  const selected: EnrichedEdge[] = [];
  const used = new Set<string>();
  let current = startNodeId;
  let distanceKm = 0;
  const minDistanceKm = mission.request.minDistanceKm;
  const maxDistanceKm = mission.request.maxDistanceKm;

  for (let step = 0; step < 320 && distanceKm < maxDistanceKm; step += 1) {
    const choices = (adjacency.get(current) ?? [])
      .filter((candidate) => !used.has(candidate.edge.id) || (distanceKm >= minDistanceKm && candidate.to === startNodeId))
      .filter((candidate) => distanceKm + candidate.edge.lengthKm <= maxDistanceKm + 0.001)
      .sort((left, right) => scoreUrbanParkStep(right, startNodeId, distanceKm, minDistanceKm) - scoreUrbanParkStep(left, startNodeId, distanceKm, minDistanceKm));
    const next = choices[0];
    if (!next) break;
    selected.push(next.edge);
    used.add(next.edge.id);
    distanceKm += Math.max(0, next.edge.lengthKm);
    current = next.to;
    if (current === startNodeId && distanceKm >= minDistanceKm) return selected;
  }

  if (selected.length > 0 && distanceKm >= minDistanceKm * 0.7) return selected;

  const fallback: EnrichedEdge[] = [];
  let fallbackDistanceKm = 0;
  for (const edge of edges) {
    if (fallbackDistanceKm >= minDistanceKm) break;
    if (fallbackDistanceKm + edge.lengthKm > maxDistanceKm + 0.001 && fallback.length > 0) continue;
    fallback.push(edge);
    fallbackDistanceKm += Math.max(0, edge.lengthKm);
  }
  return fallback;
}

function buildAllowedAdjacency(edges: EnrichedEdge[]): Map<string, { edge: EnrichedEdge; to: string }[]> {
  const adjacency = new Map<string, { edge: EnrichedEdge; to: string }[]>();
  for (const edge of edges) {
    const fromEdges = adjacency.get(edge.from) ?? [];
    fromEdges.push({ edge, to: edge.to });
    adjacency.set(edge.from, fromEdges);
    const toEdges = adjacency.get(edge.to) ?? [];
    toEdges.push({ edge, to: edge.from });
    adjacency.set(edge.to, toEdges);
  }
  return adjacency;
}

function scoreUrbanParkStep(
  candidate: { edge: EnrichedEdge; to: string },
  startNodeId: string,
  distanceKm: number,
  minDistanceKm: number,
): number {
  const semantics = classifyEdgeSemanticsV3(candidate.edge);
  const returnBonus = distanceKm >= minDistanceKm && candidate.to === startNodeId ? 10_000 : 0;
  const naturalBonus = semantics.surfaceEvidence === 'explicit_natural' ? 50 : 0;
  const pathBonus = semantics.isConnectorLike ? 0 : 10;
  return returnBonus + naturalBonus + pathBonus + candidate.edge.lengthKm;
}

function closestNodeId(graph: EnrichedGraph, point: { lat: number; lng: number }): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const node of Array.from(graph.nodes.values())) {
    const distance = Math.hypot(node.lat - point.lat, node.lng - point.lng);
    if (!best || distance < best.distance) best = { id: node.id, distance };
  }
  return best?.id ?? null;
}

function metricsFromEdges(edges: EnrichedEdge[], targetDistanceKm: number): RouteMetricsV3 {
  const distanceProducedKm = sumLengthKm(edges);
  let strictTrailKm = 0;
  let explicitPavedKm = 0;
  let explicitNaturalKm = 0;
  let roadLikeUnknownKm = 0;
  let pathTrackUnknownKm = 0;
  let candidateNaturalKm = 0;
  let unverifiedTrailCandidateKm = 0;
  const visitedComponents = new Set<TerrainComponentKindV3>();

  for (const edge of edges) {
    const lengthKm = Math.max(0, edge.lengthKm);
    const semantics = classifyEdgeSemanticsV3(edge);
    visitedComponents.add(semantics.componentKind);
    if (semantics.isStrictTrailLike) strictTrailKm += lengthKm;
    if (semantics.surfaceEvidence === 'explicit_paved') explicitPavedKm += lengthKm;
    if (semantics.surfaceEvidence === 'explicit_natural') explicitNaturalKm += lengthKm;
    if (semantics.surfaceEvidence === 'road_like_unknown') roadLikeUnknownKm += lengthKm;
    if (semantics.surfaceEvidence === 'path_track_unknown') pathTrackUnknownKm += lengthKm;
    candidateNaturalKm += lengthKm * semantics.candidateNaturalWeight;
    if (semantics.isUnverifiedTrailCandidate) unverifiedTrailCandidateKm += lengthKm;
  }
  const naturalDwellKm = candidateNaturalKm;

  return {
    targetDistanceKm,
    distanceProducedKm,
    strictTrailKm,
    explicitNaturalKm,
    explicitPavedKm,
    roadLikeUnknownKm,
    pathTrackUnknownKm,
    candidateNaturalKm,
    trailCandidateKm: candidateNaturalKm,
    unverifiedTrailCandidateKm,
    trailRatio: ratio(strictTrailKm, distanceProducedKm),
    naturalWayRatio: ratio(naturalDwellKm, distanceProducedKm),
    pavedRatio: ratio(explicitPavedKm + roadLikeUnknownKm, distanceProducedKm),
    pavedKm: explicitPavedKm + roadLikeUnknownKm,
    nonPavedKm: Math.max(0, distanceProducedKm - explicitPavedKm - roadLikeUnknownKm),
    naturalDwellKm,
    repeatEdgeKm: 0,
    targetRepeatKm: 0,
    connectorRepeatKm: 0,
    visitedComponents: Array.from(visitedComponents),
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
