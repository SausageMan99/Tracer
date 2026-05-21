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

  const selectedEdges = selectUrbanParkRouteEdges(graph, mission, parkEdges);
  const opportunityDiagnostics = buildUrbanParkOpportunityDiagnostics(graph, mission, parkEdges, selectedEdges);
  const adjustableCandidate = createParkCandidate(graph, mission, selectedEdges, blocker);
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
        selectedOpportunity: opportunityDiagnostics.selectedOpportunity,
        availableOpportunity: opportunityDiagnostics.availableOpportunity,
        nearestNonPavedAllowedEdges: opportunityDiagnostics.nearestNonPavedAllowedEdges,
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

function buildUrbanParkOpportunityDiagnostics(
  graph: EnrichedGraph,
  mission: MissionContractV3,
  allowedEdges: EnrichedEdge[],
  selectedEdges: EnrichedEdge[],
): {
  selectedOpportunity: EdgeOpportunitySummary;
  availableOpportunity: EdgeOpportunitySummary;
  nearestNonPavedAllowedEdges: NearestOpportunityEdge[];
} {
  return {
    selectedOpportunity: summarizeEdgeOpportunity(selectedEdges),
    availableOpportunity: summarizeEdgeOpportunity(allowedEdges),
    nearestNonPavedAllowedEdges: nearestNonPavedAllowedEdges(graph, mission, allowedEdges),
  };
}

interface EdgeOpportunitySummary {
  edgeCount: number;
  totalKm: number;
  explicitPavedKm: number;
  roadLikeUnknownKm: number;
  explicitNaturalKm: number;
  pathTrackUnknownKm: number;
  contextualNaturalUnknownKm: number;
  candidateNaturalKm: number;
  componentKindKm: Record<string, number>;
  highwayKm: Record<string, number>;
}

interface NearestOpportunityEdge {
  edgeId: string;
  distanceFromStartKm: number;
  lengthKm: number;
  highway: string;
  surface: string | null;
  componentKind: TerrainComponentKindV3;
  surfaceEvidence: string;
  candidateNaturalWeight: number;
}

function summarizeEdgeOpportunity(edges: EnrichedEdge[]): EdgeOpportunitySummary {
  const summary: EdgeOpportunitySummary = {
    edgeCount: edges.length,
    totalKm: 0,
    explicitPavedKm: 0,
    roadLikeUnknownKm: 0,
    explicitNaturalKm: 0,
    pathTrackUnknownKm: 0,
    contextualNaturalUnknownKm: 0,
    candidateNaturalKm: 0,
    componentKindKm: {},
    highwayKm: {},
  };

  for (const edge of edges) {
    const lengthKm = Math.max(0, edge.lengthKm);
    const semantics = classifyEdgeSemanticsV3(edge);
    summary.totalKm += lengthKm;
    summary.candidateNaturalKm += lengthKm * semantics.candidateNaturalWeight;
    if (semantics.surfaceEvidence === 'explicit_paved') summary.explicitPavedKm += lengthKm;
    if (semantics.surfaceEvidence === 'road_like_unknown') summary.roadLikeUnknownKm += lengthKm;
    if (semantics.surfaceEvidence === 'explicit_natural') summary.explicitNaturalKm += lengthKm;
    if (semantics.surfaceEvidence === 'path_track_unknown') summary.pathTrackUnknownKm += lengthKm;
    if (semantics.surfaceEvidence === 'contextual_natural_unknown') summary.contextualNaturalUnknownKm += lengthKm;
    summary.componentKindKm[semantics.componentKind] = (summary.componentKindKm[semantics.componentKind] ?? 0) + lengthKm;
    summary.highwayKm[edge.highway] = (summary.highwayKm[edge.highway] ?? 0) + lengthKm;
  }

  return {
    ...summary,
    totalKm: round3(summary.totalKm),
    explicitPavedKm: round3(summary.explicitPavedKm),
    roadLikeUnknownKm: round3(summary.roadLikeUnknownKm),
    explicitNaturalKm: round3(summary.explicitNaturalKm),
    pathTrackUnknownKm: round3(summary.pathTrackUnknownKm),
    contextualNaturalUnknownKm: round3(summary.contextualNaturalUnknownKm),
    candidateNaturalKm: round3(summary.candidateNaturalKm),
    componentKindKm: roundRecord(summary.componentKindKm),
    highwayKm: roundRecord(summary.highwayKm),
  };
}

function nearestNonPavedAllowedEdges(
  graph: EnrichedGraph,
  mission: MissionContractV3,
  allowedEdges: EnrichedEdge[],
): NearestOpportunityEdge[] {
  const start = mission.request.start;
  const opportunities: NearestOpportunityEdge[] = [];

  for (const edge of allowedEdges) {
    const semantics = classifyEdgeSemanticsV3(edge);
    if (semantics.surfaceEvidence === 'explicit_paved' || semantics.surfaceEvidence === 'road_like_unknown') continue;
    if (semantics.candidateNaturalWeight <= 0) continue;
    const distanceFromStartKm = edgeDistanceFromStartKm(graph, edge, start);
    if (distanceFromStartKm === null) continue;
    opportunities.push({
      edgeId: edge.id,
      distanceFromStartKm,
      lengthKm: edge.lengthKm,
      highway: edge.highway,
      surface: edge.surface ?? null,
      componentKind: semantics.componentKind,
      surfaceEvidence: semantics.surfaceEvidence,
      candidateNaturalWeight: semantics.candidateNaturalWeight,
    });
  }

  return opportunities
    .sort((left, right) => left.distanceFromStartKm - right.distanceFromStartKm)
    .slice(0, 8)
    .map((edge) => ({
      ...edge,
      distanceFromStartKm: round3(edge.distanceFromStartKm),
      lengthKm: round3(edge.lengthKm),
    }));
}

function edgeDistanceFromStartKm(
  graph: EnrichedGraph,
  edge: EnrichedEdge,
  start: { lat: number; lng: number },
): number | null {
  const from = graph.nodes.get(edge.from);
  const to = graph.nodes.get(edge.to);
  const distances = [from, to]
    .filter((node): node is NonNullable<typeof node> => node !== undefined)
    .map((node) => haversineKm(start.lat, start.lng, node.lat, node.lng));
  if (distances.length === 0) return null;
  return Math.min(...distances);
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusKm = 6371;
  const dLat = toRadians(lat2 - lat1);
  const dLng = toRadians(lng2 - lng1);
  const a = Math.sin(dLat / 2) ** 2
    + Math.cos(toRadians(lat1)) * Math.cos(toRadians(lat2)) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function toRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function roundRecord(values: Record<string, number>): Record<string, number> {
  return Object.fromEntries(Object.entries(values).map(([key, value]) => [key, round3(value)]));
}

function round3(value: number): number {
  return Math.round(value * 1000) / 1000;
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
