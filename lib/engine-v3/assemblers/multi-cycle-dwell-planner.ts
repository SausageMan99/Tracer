import type { EnrichedEdge, EnrichedGraph } from '../../types';
import type { RouteSurfaceV3, TerrainComponentKindV3 } from '../types';
import type { NaturalCycleCandidateV3, NaturalGraphContractionResultV3 } from './natural-graph-contraction';

const PAVED_SURFACES = new Set(['asphalt', 'concrete', 'paved', 'paving_stones', 'sett', 'cobblestone', 'compacted']);
const NATURAL_SURFACES = new Set(['dirt', 'earth', 'grass', 'ground', 'gravel', 'mud', 'sand', 'soil', 'unpaved', 'woodchips']);
const ROAD_LIKE_HIGHWAYS = new Set(['secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);
const PATH_LIKE_HIGHWAYS = new Set(['path', 'track', 'footway', 'bridleway', 'pedestrian']);

interface DirectedMultiCycleEdgeV3 {
  edge: EnrichedEdge;
  from: string;
  to: string;
  kind: TerrainComponentKindV3;
  surface: RouteSurfaceV3;
}

export type MultiCycleDwellFailureReasonV3 = 'no_cycle_candidate' | 'no_chainable_cycle' | 'no_closure' | 'excessive_repeat';
export type MultiCycleDwellFailedPhaseV3 = 'dwellPhase' | 'closurePhase' | 'finalGate' | null;

export interface MultiCycleDwellMetricsV3 {
  distanceKm: number;
  accessKm: number;
  chainKm: number;
  chainNaturalKm: number;
  connectorNaturalKm: number;
  connectorPavedKm: number;
  closureKm: number;
  closurePavedKm: number;
  pavedKm: number;
  chainRepeatKm: number;
  chainTargetRepeatKm: number;
  chainConnectorRepeatKm: number;
}

export type MultiCycleDwellCandidateRejectedReasonV3 =
  | 'overlong'
  | 'under_min'
  | 'excessive_paved'
  | 'excessive_repeat'
  | 'dominated';

export interface MultiCycleDwellCandidateSummaryV3 extends MultiCycleDwellMetricsV3 {
  candidateId: string;
  cycleIds: string[];
  chainCount: number;
  distanceErrorKm: number;
  pavedRatio: number;
  returned: boolean;
  selectedExitNode: string | null;
  rejectedReason: MultiCycleDwellCandidateRejectedReasonV3 | null;
}

export interface MultiCycleDwellCandidateDiagnosticsV3 {
  count: number;
  selectedCandidateId: string | null;
  inEnvelopeCount: number;
  overlongCount: number;
  underMinCount: number;
  paretoFrontier: MultiCycleDwellCandidateSummaryV3[];
  topRejected: Array<MultiCycleDwellCandidateSummaryV3 | { candidateId: string; cycleIds: string[]; rejectedReason: MultiCycleDwellCandidateRejectedReasonV3 }>;
  selectionReason: string | null;
}

export interface MultiCycleDwellDiagnosticsV3 extends MultiCycleDwellMetricsV3 {
  cycleIds: string[];
  chainCount: number;
  candidateCount: number;
  selectedExitNode: string | null;
  failedPhase: MultiCycleDwellFailedPhaseV3;
  rejectedCycles: Array<{ id: string; reason: 'overlap' | 'repeat' | 'connector_paved' | 'no_connector' | 'not_improving' }>;
  overlapRejectedCount: number;
  prunedCandidateCount: number;
  maxCycles: number;
  beamWidth: number;
  multiCycleDwellCandidates: MultiCycleDwellCandidateDiagnosticsV3;
}

export interface MultiCycleDwellInputV3 {
  graph: EnrichedGraph;
  startNodeId: string;
  contraction: NaturalGraphContractionResultV3;
  targetComponentIds: TerrainComponentKindV3[];
  targetDistanceKm: number;
  minDistanceKm?: number;
  maxDistanceKm?: number;
  requestedNaturalDwellKm: number;
  maxCycles?: number;
  beamWidth?: number;
}

export interface MultiCycleDwellSuccessV3 {
  status: 'success';
  edgeIds: string[];
  nodeIds: string[];
  cycleIds: string[];
  selectedExitNode: string;
  metrics: MultiCycleDwellMetricsV3;
  diagnostics: MultiCycleDwellDiagnosticsV3;
}

export interface MultiCycleDwellFailureV3 {
  status: 'failure';
  reason: MultiCycleDwellFailureReasonV3;
  edgeIds: string[];
  nodeIds: string[];
  metrics: MultiCycleDwellMetricsV3;
  diagnostics: MultiCycleDwellDiagnosticsV3;
}

export type MultiCycleDwellResultV3 = MultiCycleDwellSuccessV3 | MultiCycleDwellFailureV3;

interface OrderedCycleV3 {
  id: string;
  edges: DirectedMultiCycleEdgeV3[];
  nodes: string[];
  edgeIds: Set<string>;
  pairKeys: Set<string>;
  lengthKm: number;
  naturalKm: number;
}

interface ChainStateV3 {
  currentNodeId: string;
  cycleIds: string[];
  chainEdges: DirectedMultiCycleEdgeV3[];
  connectorEdges: DirectedMultiCycleEdgeV3[];
  usedEdgeIds: Set<string>;
  usedPairKeys: Set<string>;
  naturalKm: number;
  score: number;
}

interface MultiCycleEvaluatedCandidateV3 {
  state: ChainStateV3;
  edgeIds: string[];
  nodeIds: string[];
  summary: MultiCycleDwellCandidateSummaryV3;
}

const EMPTY_METRICS: MultiCycleDwellMetricsV3 = {
  distanceKm: 0,
  accessKm: 0,
  chainKm: 0,
  chainNaturalKm: 0,
  connectorNaturalKm: 0,
  connectorPavedKm: 0,
  closureKm: 0,
  closurePavedKm: 0,
  pavedKm: 0,
  chainRepeatKm: 0,
  chainTargetRepeatKm: 0,
  chainConnectorRepeatKm: 0,
};

export function planMultiCycleDwellV3(input: MultiCycleDwellInputV3): MultiCycleDwellResultV3 {
  const maxCycles = input.maxCycles ?? 3;
  const beamWidth = input.beamWidth ?? 8;
  const minDistanceKm = input.minDistanceKm ?? input.targetDistanceKm * 0.7;
  const maxDistanceKm = input.maxDistanceKm ?? input.targetDistanceKm * 1.15;
  const targetComponents = new Set(input.targetComponentIds);
  const adjacency = buildAdjacency(input.graph);
  const orderedCycles = input.contraction.cycleCandidates
    .slice(0, 16)
    .map((cycle) => orderCycleEdges(cycle, input.graph))
    .filter((cycle): cycle is OrderedCycleV3 => cycle !== null)
    .sort((a, b) => b.naturalKm - a.naturalKm || b.lengthKm - a.lengthKm || a.id.localeCompare(b.id));
  const rejectedCycles: MultiCycleDwellDiagnosticsV3['rejectedCycles'] = [];
  let overlapRejectedCount = input.contraction.diagnostics.jaccardDedupCount;
  let prunedCandidateCount = Math.max(0, input.contraction.cycleCandidates.length - 16);

  if (orderedCycles.length === 0) return failure('no_chainable_cycle', [], [input.startNodeId], 'dwellPhase');

  let frontier: ChainStateV3[] = [];
  const allStates: ChainStateV3[] = [];
  for (const cycle of orderedCycles.slice(0, beamWidth)) {
    const access = shortestPathToAnyNode(input.startNodeId, cycle.nodes.slice(0, -1), adjacency, new Set(), new Set(), { preferNatural: false });
    if (!access && !cycle.nodes.includes(input.startNodeId)) {
      rejectedCycles.push({ id: cycle.id, reason: 'no_connector' });
      continue;
    }
    const entryNodeId = access?.at(-1)?.to ?? (cycle.nodes.includes(input.startNodeId) ? input.startNodeId : cycle.nodes[0]);
    const rotated = rotateCycleToNode(cycle, entryNodeId);
    if (!rotated) continue;
    const chainable = openCycleForChaining(rotated, adjacency);
    const usedEdgeIds = new Set(chainable.edges.map((edge) => edge.edge.id));
    const usedPairKeys = new Set(chainable.edges.map(edgePairKey));
    for (const edge of access ?? []) usedEdgeIds.add(edge.edge.id);
    frontier.push({
      currentNodeId: chainable.nodes.at(-1) ?? entryNodeId,
      cycleIds: [cycle.id],
      chainEdges: [...chainable.edges],
      connectorEdges: [],
      usedEdgeIds,
      usedPairKeys,
      naturalKm: naturalTargetKm(chainable.edges, targetComponents),
      score: cycle.naturalKm * 100 - sumPaved(access ?? []) * 25,
    });
  }

  if (frontier.length === 0) return failure('no_chainable_cycle', [], [input.startNodeId], 'dwellPhase');
  frontier = frontier.sort((a, b) => b.score - a.score).slice(0, beamWidth);
  allStates.push(...frontier);
  let best = frontier[0] ?? null;
  let bestRejectedConnectorPavedKm = 0;

  for (let depth = 1; depth < maxCycles && frontier.length > 0; depth += 1) {
    const expanded: ChainStateV3[] = [];
    for (const state of frontier) {
      if (!best || state.naturalKm > best.naturalKm) best = state;
      for (const cycle of orderedCycles) {
        if (state.cycleIds.includes(cycle.id)) continue;
        const overlap = jaccardOverlap(state.usedEdgeIds, cycle.edgeIds);
        if (overlap > 0.35) {
          overlapRejectedCount += 1;
          rejectedCycles.push({ id: cycle.id, reason: 'overlap' });
          continue;
        }
        const connector = shortestPathToAnyNode(state.currentNodeId, cycle.nodes.slice(0, -1), adjacency, state.usedEdgeIds, state.usedPairKeys, { preferNatural: true });
        if (!connector) {
          rejectedCycles.push({ id: cycle.id, reason: 'no_connector' });
          continue;
        }
        const connectorPavedKm = sumPaved(connector);
        bestRejectedConnectorPavedKm = Math.max(bestRejectedConnectorPavedKm, connectorPavedKm);
        if (connectorPavedKm > Math.max(0.8, input.targetDistanceKm * 0.14)) {
          rejectedCycles.push({ id: cycle.id, reason: 'connector_paved' });
          continue;
        }
        const entryNodeId = connector.at(-1)?.to ?? state.currentNodeId;
        const rotated = rotateCycleToNode(cycle, entryNodeId);
        if (!rotated) continue;
        const chainable = openCycleForChaining(rotated, adjacency);
        const repeatedCycleKm = repeatedKm(chainable.edges, state.usedEdgeIds, state.usedPairKeys, targetComponents).repeatKm;
        if (repeatedCycleKm > 0.001) {
          rejectedCycles.push({ id: cycle.id, reason: 'repeat' });
          continue;
        }
        const nextUsedEdgeIds = new Set(state.usedEdgeIds);
        const nextUsedPairKeys = new Set(state.usedPairKeys);
        for (const edge of [...connector, ...chainable.edges]) {
          nextUsedEdgeIds.add(edge.edge.id);
          nextUsedPairKeys.add(edgePairKey(edge));
        }
        const connectorNaturalKm = naturalTargetKm(connector, targetComponents);
        const nextNaturalKm = state.naturalKm + connectorNaturalKm + naturalTargetKm(chainable.edges, targetComponents);
        if (nextNaturalKm <= state.naturalKm + 0.25) {
          rejectedCycles.push({ id: cycle.id, reason: 'not_improving' });
          continue;
        }
        expanded.push({
          currentNodeId: chainable.nodes.at(-1) ?? entryNodeId,
          cycleIds: [...state.cycleIds, cycle.id],
          chainEdges: [...state.chainEdges, ...connector, ...chainable.edges],
          connectorEdges: [...state.connectorEdges, ...connector],
          usedEdgeIds: nextUsedEdgeIds,
          usedPairKeys: nextUsedPairKeys,
          naturalKm: nextNaturalKm,
          score: nextNaturalKm * 130 - connectorPavedKm * 160 - repeatedCycleKm * 400 - overlap * 40,
        });
      }
    }
    if (expanded.length === 0) break;
    prunedCandidateCount += Math.max(0, expanded.length - beamWidth);
    frontier = expanded.sort((a, b) => b.score - a.score).slice(0, beamWidth);
    allStates.push(...frontier);
    if (!best || frontier[0]?.naturalKm > best.naturalKm) best = frontier[0] ?? best;
  }

  const viableStates = allStates
    .filter((state) => state.naturalKm + 0.001 >= input.requestedNaturalDwellKm)
    .sort((a, b) => b.naturalKm - a.naturalKm || b.score - a.score);

  const candidateStates = boundedCandidateStates(viableStates, input, targetComponents, beamWidth);
  const evaluatedCandidates = candidateStates
    .map((state, index) => evaluateChainCandidate({
      state,
      index,
      input,
      adjacency,
      targetComponents,
      minDistanceKm,
      maxDistanceKm,
    }))
    .filter((candidate): candidate is MultiCycleEvaluatedCandidateV3 => candidate !== null);
  const candidateDiagnostics = buildCandidateDiagnostics(evaluatedCandidates, rejectedCycles, null, overlapRejectedCount);

  if (!best || viableStates.length === 0 || evaluatedCandidates.length === 0) {
    const edgeIds = best?.chainEdges.map((edge) => edge.edge.id) ?? [];
    const nodeIds = best ? nodesFromDirectedEdges(best.chainEdges[0]?.from ?? input.startNodeId, best.chainEdges) : [input.startNodeId];
    const metrics = best
      ? { ...metricsFromParts([], best.chainEdges, [], best.connectorEdges, targetComponents), connectorPavedKm: round(Math.max(bestRejectedConnectorPavedKm, sumPaved(best.connectorEdges))) }
      : { ...EMPTY_METRICS, connectorPavedKm: round(bestRejectedConnectorPavedKm) };
    return {
      status: 'failure',
      reason: 'no_chainable_cycle',
      edgeIds,
      nodeIds,
      metrics,
      diagnostics: diagnosticsFrom('dwellPhase', best, metrics, rejectedCycles, overlapRejectedCount, prunedCandidateCount, maxCycles, beamWidth, null, candidateDiagnostics),
    };
  }

  const selectable = evaluatedCandidates
    .filter((candidate) => candidate.summary.rejectedReason === null && candidate.summary.chainCount >= 2)
    .sort((a, b) => candidateParetoScore(b.summary, input.targetDistanceKm) - candidateParetoScore(a.summary, input.targetDistanceKm));
  const selected = selectable[0] ?? null;
  const selectedCandidateDiagnostics = buildCandidateDiagnostics(evaluatedCandidates, rejectedCycles, selected?.summary.candidateId ?? null, overlapRejectedCount);

  if (!selected) {
    const bestDiagnostic = evaluatedCandidates
      .slice()
      .sort((a, b) => candidateDiagnosticScore(b.summary, input.targetDistanceKm) - candidateDiagnosticScore(a.summary, input.targetDistanceKm))[0];
    const state = bestDiagnostic?.state ?? best;
    const metrics = bestDiagnostic?.summary ?? metricsFromParts([], state.chainEdges, [], state.connectorEdges, targetComponents);
    return {
      status: 'failure',
      reason: bestDiagnostic?.summary.rejectedReason === 'overlong' ? 'excessive_repeat' : 'no_chainable_cycle',
      edgeIds: bestDiagnostic?.edgeIds ?? state.chainEdges.map((edge) => edge.edge.id),
      nodeIds: bestDiagnostic?.nodeIds ?? nodesFromDirectedEdges(state.chainEdges[0]?.from ?? input.startNodeId, state.chainEdges),
      metrics,
      diagnostics: diagnosticsFrom('finalGate', state, metrics, rejectedCycles, overlapRejectedCount, prunedCandidateCount, maxCycles, beamWidth, state.currentNodeId, selectedCandidateDiagnostics),
    };
  }

  const diagnostics = diagnosticsFrom(null, selected.state, selected.summary, rejectedCycles, overlapRejectedCount, prunedCandidateCount, maxCycles, beamWidth, selected.state.currentNodeId, selectedCandidateDiagnostics);
  return { status: 'success', edgeIds: selected.edgeIds, nodeIds: selected.nodeIds, cycleIds: selected.state.cycleIds, selectedExitNode: selected.state.currentNodeId, metrics: selected.summary, diagnostics };

  function failure(
    reason: MultiCycleDwellFailureReasonV3,
    edgeIds: string[],
    nodeIds: string[],
    failedPhase: Exclude<MultiCycleDwellFailedPhaseV3, null>,
  ): MultiCycleDwellFailureV3 {
    const diagnostics = diagnosticsFrom(failedPhase, null, EMPTY_METRICS, rejectedCycles, overlapRejectedCount, prunedCandidateCount, maxCycles, beamWidth, null, emptyCandidateDiagnostics());
    return { status: 'failure', reason, edgeIds, nodeIds, metrics: EMPTY_METRICS, diagnostics };
  }
}

function boundedCandidateStates(
  states: ChainStateV3[],
  input: MultiCycleDwellInputV3,
  targetComponents: Set<TerrainComponentKindV3>,
  beamWidth: number,
): ChainStateV3[] {
  const variants: ChainStateV3[] = [];
  for (const state of states) {
    variants.push(state);
    const minPrefixEdges = Math.max(2, Math.floor(state.chainEdges.length * 0.45));
    const step = Math.max(1, Math.floor(state.chainEdges.length / 16));
    for (let end = minPrefixEdges; end < state.chainEdges.length; end += step) {
      const chainEdges = state.chainEdges.slice(0, end);
      const naturalKm = naturalTargetKm(chainEdges, targetComponents);
      if (naturalKm + 0.001 < input.requestedNaturalDwellKm) continue;
      const currentNodeId = chainEdges.at(-1)?.to;
      if (!currentNodeId) continue;
      const usedEdgeIds = new Set(chainEdges.map((edge) => edge.edge.id));
      const usedPairKeys = new Set(chainEdges.map(edgePairKey));
      const prefixEdgeIds = usedEdgeIds;
      const connectorEdges = state.connectorEdges.filter((edge) => prefixEdgeIds.has(edge.edge.id));
      variants.push({
        currentNodeId,
        cycleIds: state.cycleIds,
        chainEdges,
        connectorEdges,
        usedEdgeIds,
        usedPairKeys,
        naturalKm,
        score: naturalKm * 120 - sumPaved(chainEdges) * 180 - Math.abs(sumDirectedLengths(chainEdges) - input.targetDistanceKm) * 20,
      });
    }
  }
  const deduped = new Map<string, ChainStateV3>();
  for (const variant of variants.sort((a, b) => b.score - a.score)) {
    const key = `${variant.cycleIds.join('+')}::${variant.currentNodeId}::${variant.chainEdges.length}`;
    if (!deduped.has(key)) deduped.set(key, variant);
  }
  return Array.from(deduped.values()).slice(0, Math.max(beamWidth * 3, 24));
}

function evaluateChainCandidate(args: {
  state: ChainStateV3;
  index: number;
  input: MultiCycleDwellInputV3;
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>;
  targetComponents: Set<TerrainComponentKindV3>;
  minDistanceKm: number;
  maxDistanceKm: number;
}): MultiCycleEvaluatedCandidateV3 | null {
  const { state, index, input, adjacency, targetComponents, minDistanceKm, maxDistanceKm } = args;
  const closure = state.currentNodeId === input.startNodeId
    ? []
    : shortestClosure(state.currentNodeId, input.startNodeId, adjacency, state.usedEdgeIds, state.usedPairKeys, targetComponents);
  if (!closure) return null;
  const access = state.chainEdges[0]?.from === input.startNodeId
    ? []
    : shortestPathToAnyNode(input.startNodeId, [state.chainEdges[0]?.from ?? input.startNodeId], adjacency, new Set(), new Set(), { preferNatural: false }) ?? [];
  const all = [...access, ...state.chainEdges, ...closure];
  const metrics = metricsFromParts(access, state.chainEdges, closure, state.connectorEdges, targetComponents);
  const pavedRatio = metrics.distanceKm > 0 ? round(metrics.pavedKm / metrics.distanceKm) : 0;
  const distanceErrorKm = round(Math.abs(metrics.distanceKm - input.targetDistanceKm));
  let rejectedReason: MultiCycleDwellCandidateRejectedReasonV3 | null = null;
  if (metrics.distanceKm > maxDistanceKm + 0.001) rejectedReason = 'overlong';
  else if (metrics.distanceKm + 0.001 < minDistanceKm) rejectedReason = 'under_min';
  else if (metrics.chainTargetRepeatKm > 0.001 || metrics.chainConnectorRepeatKm > Math.max(0.35, input.targetDistanceKm * 0.08)) rejectedReason = 'excessive_repeat';
  else if (pavedRatio > 0.48 && metrics.pavedKm > Math.max(1.2, metrics.chainNaturalKm * 0.45)) rejectedReason = 'excessive_paved';

  const summary: MultiCycleDwellCandidateSummaryV3 = {
    ...metrics,
    candidateId: `multi-cycle-${state.cycleIds.join('-') || index}`,
    cycleIds: state.cycleIds,
    chainCount: state.cycleIds.length,
    distanceErrorKm,
    pavedRatio,
    returned: state.currentNodeId === input.startNodeId || closure.length > 0,
    selectedExitNode: state.currentNodeId,
    rejectedReason,
  };
  return { state, edgeIds: all.map((edge) => edge.edge.id), nodeIds: nodesFromDirectedEdges(input.startNodeId, all), summary };
}

function buildCandidateDiagnostics(
  candidates: MultiCycleEvaluatedCandidateV3[],
  rejectedCycles: MultiCycleDwellDiagnosticsV3['rejectedCycles'],
  selectedCandidateId: string | null,
  overlapRejectedCount: number,
): MultiCycleDwellCandidateDiagnosticsV3 {
  const summaries = candidates.map((candidate) => ({ ...candidate.summary, cycleIds: [...candidate.summary.cycleIds] }));
  const acceptable = summaries.filter((candidate) => candidate.rejectedReason === null);
  const dominatedIds = new Set<string>();
  for (const candidate of acceptable) {
    const dominated = acceptable.some((other) => other.candidateId !== candidate.candidateId && dominatesCandidate(other, candidate));
    if (dominated && candidate.candidateId !== selectedCandidateId) dominatedIds.add(candidate.candidateId);
  }
  for (const summary of summaries) {
    if (dominatedIds.has(summary.candidateId)) summary.rejectedReason = 'dominated';
  }
  const finalAcceptable = summaries.filter((candidate) => candidate.rejectedReason === null);
  const paretoFrontier = finalAcceptable
    .slice()
    .sort((a, b) => candidateParetoScore(b, b.distanceKm + b.distanceErrorKm) - candidateParetoScore(a, a.distanceKm + a.distanceErrorKm))
    .slice(0, 8);
  const cycleRejected = rejectedCycles.slice(0, 8).map((cycle) => ({
    candidateId: cycle.id,
    cycleIds: [cycle.id],
    rejectedReason: cycle.reason === 'connector_paved' ? 'excessive_paved' as const
      : cycle.reason === 'repeat' || cycle.reason === 'overlap' ? 'excessive_repeat' as const
        : 'dominated' as const,
  }));
  const rejectedSorted = summaries.filter((candidate) => candidate.rejectedReason !== null)
    .sort((a, b) => candidateDiagnosticScore(b, b.distanceKm + b.distanceErrorKm) - candidateDiagnosticScore(a, a.distanceKm + a.distanceErrorKm));
  const reasonPlaceholders = Array.from(new Set([
    ...rejectedSorted.map((candidate) => candidate.rejectedReason).filter((reason): reason is MultiCycleDwellCandidateRejectedReasonV3 => reason !== null),
    ...cycleRejected.map((candidate) => candidate.rejectedReason),
    ...(overlapRejectedCount > 0 ? ['excessive_repeat' as const] : []),
  ])).map((reason) => ({ candidateId: `reason-${reason}`, cycleIds: [], rejectedReason: reason }));
  const topRejected = [
    ...reasonPlaceholders,
    ...rejectedSorted.slice(0, 12),
    ...cycleRejected,
  ].slice(0, 16);
  return {
    count: summaries.length,
    selectedCandidateId,
    inEnvelopeCount: summaries.filter((candidate) => candidate.rejectedReason !== 'under_min' && candidate.rejectedReason !== 'overlong' && candidate.distanceKm > 0).length,
    overlongCount: summaries.filter((candidate) => candidate.distanceKm > 0 && candidate.rejectedReason === 'overlong').length,
    underMinCount: summaries.filter((candidate) => candidate.distanceKm > 0 && candidate.rejectedReason === 'under_min').length,
    paretoFrontier,
    topRejected,
    selectionReason: selectedCandidateId ? 'best_pareto_in_distance_envelope' : null,
  };
}

function dominatesCandidate(a: MultiCycleDwellCandidateSummaryV3, b: MultiCycleDwellCandidateSummaryV3): boolean {
  const notWorse = a.distanceErrorKm <= b.distanceErrorKm + 0.001
    && a.chainNaturalKm + 0.001 >= b.chainNaturalKm
    && a.pavedRatio <= b.pavedRatio + 0.001
    && a.chainRepeatKm <= b.chainRepeatKm + 0.001;
  const better = a.distanceErrorKm + 0.001 < b.distanceErrorKm
    || a.chainNaturalKm > b.chainNaturalKm + 0.25
    || a.pavedRatio + 0.03 < b.pavedRatio
    || a.chainRepeatKm + 0.001 < b.chainRepeatKm;
  return notWorse && better;
}

function candidateParetoScore(candidate: MultiCycleDwellCandidateSummaryV3, targetDistanceKm: number): number {
  const distancePenalty = Math.abs(candidate.distanceKm - targetDistanceKm) * 90;
  const pavedPenalty = candidate.pavedKm * 160 + candidate.pavedRatio * 240;
  const repeatPenalty = candidate.chainTargetRepeatKm * 500 + candidate.chainConnectorRepeatKm * 120 + candidate.chainRepeatKm * 80;
  const naturalReward = candidate.chainNaturalKm * 210 + candidate.connectorNaturalKm * 60;
  const closurePenalty = candidate.closurePavedKm * 90 + candidate.closureKm * 8;
  const chainBonus = Math.min(candidate.chainCount, 3) * 60;
  return naturalReward + chainBonus - distancePenalty - pavedPenalty - repeatPenalty - closurePenalty;
}

function candidateDiagnosticScore(candidate: MultiCycleDwellCandidateSummaryV3, targetDistanceKm: number): number {
  return candidate.chainNaturalKm * 100 + Math.min(candidate.distanceKm, targetDistanceKm) * 40 - candidate.pavedKm * 30 - candidate.chainRepeatKm * 100;
}

function emptyCandidateDiagnostics(): MultiCycleDwellCandidateDiagnosticsV3 {
  return {
    count: 0,
    selectedCandidateId: null,
    inEnvelopeCount: 0,
    overlongCount: 0,
    underMinCount: 0,
    paretoFrontier: [],
    topRejected: [],
    selectionReason: null,
  };
}

function diagnosticsFrom(
  failedPhase: MultiCycleDwellFailedPhaseV3,
  best: ChainStateV3 | null,
  metrics: MultiCycleDwellMetricsV3,
  rejectedCycles: MultiCycleDwellDiagnosticsV3['rejectedCycles'],
  overlapRejectedCount: number,
  prunedCandidateCount: number,
  maxCycles: number,
  beamWidth: number,
  selectedExitNode: string | null,
  multiCycleDwellCandidates: MultiCycleDwellCandidateDiagnosticsV3,
): MultiCycleDwellDiagnosticsV3 {
  return {
    ...metrics,
    cycleIds: best?.cycleIds ?? [],
    chainCount: best?.cycleIds.length ?? 0,
    candidateCount: Math.max(multiCycleDwellCandidates.count, (best?.cycleIds.length ?? 0) + rejectedCycles.length),
    selectedExitNode,
    failedPhase,
    rejectedCycles: rejectedCycles.slice(0, 24),
    overlapRejectedCount,
    prunedCandidateCount,
    maxCycles,
    beamWidth,
    multiCycleDwellCandidates,
  };
}

function orderCycleEdges(cycle: NaturalCycleCandidateV3, graph: EnrichedGraph): OrderedCycleV3 | null {
  const edges = cycle.originalEdgeIds.map((edgeId) => graph.edges.get(edgeId));
  if (edges.some((edge) => !edge)) return null;
  const remaining = new Map(edges.filter((edge): edge is EnrichedEdge => Boolean(edge)).map((edge) => [edge.id, edge]));
  const start = cycle.originalNodeIds[0] ?? remaining.values().next().value?.from;
  if (!start) return null;
  const ordered: DirectedMultiCycleEdgeV3[] = [];
  const nodes = [start];
  let current = start;
  const originalOrder = new Map(cycle.originalEdgeIds.map((edgeId, index) => [edgeId, index]));
  while (remaining.size > 0) {
    const next = Array.from(remaining.values())
      .filter((edge) => edge.from === current || edge.to === current)
      .sort((a, b) => (originalOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (originalOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id))[0];
    if (!next) return null;
    remaining.delete(next.id);
    const directed = directedEdge(next, current);
    ordered.push(directed);
    current = directed.to;
    nodes.push(current);
  }
  if (nodes[0] !== nodes.at(-1)) return null;
  return {
    id: cycle.id,
    edges: ordered,
    nodes,
    edgeIds: new Set(ordered.map((edge) => edge.edge.id)),
    pairKeys: new Set(ordered.map(edgePairKey)),
    lengthKm: round(sumDirectedLengths(ordered)),
    naturalKm: round(naturalTargetKm(ordered, new Set<TerrainComponentKindV3>(['forest', 'field_paths', 'park', 'river_corridor', 'urban_green']))),
  };
}

function rotateCycleToNode(cycle: OrderedCycleV3, entryNodeId: string): OrderedCycleV3 | null {
  const startIndex = cycle.nodes.slice(0, -1).indexOf(entryNodeId);
  if (startIndex < 0) return null;
  const edges = [...cycle.edges.slice(startIndex), ...cycle.edges.slice(0, startIndex)];
  const rotatedEdges: DirectedMultiCycleEdgeV3[] = [];
  let current = entryNodeId;
  for (const candidate of edges) {
    const edge = candidate.edge;
    if (edge.from !== current && edge.to !== current) return null;
    const directed = directedEdge(edge, current);
    rotatedEdges.push(directed);
    current = directed.to;
  }
  const nodes = nodesFromDirectedEdges(entryNodeId, rotatedEdges);
  if (nodes.at(-1) !== entryNodeId) return null;
  return { ...cycle, edges: rotatedEdges, nodes };
}

function openCycleForChaining(
  cycle: OrderedCycleV3,
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>,
): { edges: DirectedMultiCycleEdgeV3[]; nodes: string[] } {
  const outsideEdgeScore = (nodeId: string) => (adjacency.get(nodeId) ?? [])
    .filter((edge) => !cycle.edgeIds.has(edge.edge.id))
    .reduce((score, edge) => score + (edge.surface === 'paved' ? 1 : 4) + Math.max(0, edge.edge.lengthKm), 0);
  let bestPrefixLength = cycle.edges.length;
  let bestScore = outsideEdgeScore(cycle.nodes.at(-1) ?? cycle.nodes[0] ?? '');
  const minPrefixLength = Math.max(2, Math.ceil(cycle.edges.length * 0.6));
  for (let prefixLength = minPrefixLength; prefixLength < cycle.edges.length; prefixLength += 1) {
    const nodeId = cycle.nodes[prefixLength];
    if (!nodeId) continue;
    const score = outsideEdgeScore(nodeId) + prefixLength * 0.01;
    if (score > bestScore + 0.001) {
      bestScore = score;
      bestPrefixLength = prefixLength;
    }
  }
  const edges = cycle.edges.slice(0, bestPrefixLength);
  return { edges, nodes: nodesFromDirectedEdges(cycle.nodes[0] ?? edges[0]?.from ?? '', edges) };
}

function buildAdjacency(graph: EnrichedGraph): Map<string, DirectedMultiCycleEdgeV3[]> {
  const adjacency = new Map<string, DirectedMultiCycleEdgeV3[]>();
  for (const nodeId of Array.from(graph.nodes.keys())) adjacency.set(nodeId, []);
  for (const edge of Array.from(graph.edges.values())) {
    adjacency.get(edge.from)?.push(directedEdge(edge, edge.from));
    adjacency.get(edge.to)?.push(directedEdge(edge, edge.to));
  }
  return adjacency;
}

function directedEdge(edge: EnrichedEdge, from: string): DirectedMultiCycleEdgeV3 {
  const to = edge.from === from ? edge.to : edge.from;
  return { edge, from, to, kind: componentKind(edge), surface: routeSurface(edge) };
}

function shortestPathToAnyNode(
  fromNodeId: string,
  toNodeIds: string[],
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>,
  forbiddenEdgeIds: Set<string>,
  forbiddenPairKeys: Set<string>,
  options: { preferNatural: boolean },
): DirectedMultiCycleEdgeV3[] | null {
  const targets = new Set(toNodeIds);
  if (targets.has(fromNodeId)) return [];
  const bestDistances = new Map<string, number>([[fromNodeId, 0]]);
  const pending: Array<{ nodeId: string; cost: number; traversal: DirectedMultiCycleEdgeV3[] }> = [{ nodeId: fromNodeId, cost: 0, traversal: [] }];
  while (pending.length > 0) {
    const current = pending.sort((a, b) => a.cost - b.cost).shift();
    if (!current) break;
    if (targets.has(current.nodeId)) return current.traversal;
    if (current.cost > (bestDistances.get(current.nodeId) ?? Number.POSITIVE_INFINITY) + 0.000001) continue;
    for (const edge of adjacency.get(current.nodeId) ?? []) {
      if (forbiddenEdgeIds.has(edge.edge.id) || forbiddenPairKeys.has(edgePairKey(edge))) continue;
      const pavedPenalty = options.preferNatural && edge.surface === 'paved' ? 4 : 0;
      const roadPenalty = options.preferNatural && ROAD_LIKE_HIGHWAYS.has((edge.edge.highway ?? '').toLowerCase()) ? 2 : 0;
      const nextCost = current.cost + Math.max(0, edge.edge.lengthKm) + pavedPenalty + roadPenalty;
      if (nextCost + 0.000001 >= (bestDistances.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      bestDistances.set(edge.to, nextCost);
      pending.push({ nodeId: edge.to, cost: nextCost, traversal: [...current.traversal, edge] });
    }
  }
  return null;
}

function shortestClosure(
  fromNodeId: string,
  startNodeId: string,
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>,
  usedEdgeIds: Set<string>,
  usedPairKeys: Set<string>,
  targetComponents: Set<TerrainComponentKindV3>,
): DirectedMultiCycleEdgeV3[] | null {
  return shortestPathToAnyNode(fromNodeId, [startNodeId], adjacency, usedEdgeIds, usedPairKeys, { preferNatural: true })
    ?? shortestPathToAnyNode(fromNodeId, [startNodeId], adjacency, new Set(), usedPairKeys, { preferNatural: true })
    ?? (targetComponents.size > 0 ? null : []);
}

function metricsFromParts(
  access: DirectedMultiCycleEdgeV3[],
  chain: DirectedMultiCycleEdgeV3[],
  closure: DirectedMultiCycleEdgeV3[],
  connectors: DirectedMultiCycleEdgeV3[],
  targetComponents: Set<TerrainComponentKindV3>,
): MultiCycleDwellMetricsV3 {
  const all = [...access, ...chain, ...closure];
  const repeat = repeatedKm(chain, new Set(), new Set(), targetComponents);
  const closureConnectorRepeatKm = closure
    .filter((edge) => access.some((candidate) => candidate.edge.id === edge.edge.id))
    .reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
  return {
    distanceKm: round(sumDirectedLengths(all)),
    accessKm: round(sumDirectedLengths(access)),
    chainKm: round(sumDirectedLengths(chain)),
    chainNaturalKm: round(naturalTargetKm(chain, targetComponents)),
    connectorNaturalKm: round(naturalTargetKm(connectors, targetComponents)),
    connectorPavedKm: round(sumPaved(connectors)),
    closureKm: round(sumDirectedLengths(closure)),
    closurePavedKm: round(sumPaved(closure)),
    pavedKm: round(sumPaved(all)),
    chainRepeatKm: round(repeat.repeatKm),
    chainTargetRepeatKm: round(repeat.targetRepeatKm),
    chainConnectorRepeatKm: round(closureConnectorRepeatKm),
  };
}

function repeatedKm(
  edges: DirectedMultiCycleEdgeV3[],
  preUsedEdgeIds: Set<string>,
  preUsedPairKeys: Set<string>,
  targetComponents: Set<TerrainComponentKindV3>,
): { repeatKm: number; targetRepeatKm: number } {
  const seenEdgeIds = new Set(preUsedEdgeIds);
  const seenPairKeys = new Set(preUsedPairKeys);
  let repeatKm = 0;
  let targetRepeatKm = 0;
  for (const edge of edges) {
    const pairKey = edgePairKey(edge);
    const repeated = seenEdgeIds.has(edge.edge.id) || seenPairKeys.has(pairKey);
    if (repeated) {
      repeatKm += Math.max(0, edge.edge.lengthKm);
      if (targetComponents.has(edge.kind)) targetRepeatKm += Math.max(0, edge.edge.lengthKm);
    }
    seenEdgeIds.add(edge.edge.id);
    seenPairKeys.add(pairKey);
  }
  return { repeatKm, targetRepeatKm };
}

function naturalTargetKm(edges: DirectedMultiCycleEdgeV3[], targetComponents: Set<TerrainComponentKindV3>): number {
  return edges
    .filter((edge) => targetComponents.has(edge.kind) && edge.surface !== 'paved')
    .reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
}

function jaccardOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of Array.from(b)) if (a.has(value)) intersection += 1;
  return intersection / Math.min(a.size, b.size);
}

function nodesFromDirectedEdges(startNodeId: string, edges: DirectedMultiCycleEdgeV3[]): string[] {
  const nodes = [startNodeId];
  for (const edge of edges) nodes.push(edge.to);
  return nodes;
}

function edgePairKey(edge: DirectedMultiCycleEdgeV3): string {
  return [edge.from, edge.to].sort().join('::');
}

function sumDirectedLengths(edges: DirectedMultiCycleEdgeV3[]): number {
  return edges.reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
}

function sumPaved(edges: DirectedMultiCycleEdgeV3[]): number {
  return edges.filter((edge) => edge.surface === 'paved').reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
}

function routeSurface(edge: EnrichedEdge): RouteSurfaceV3 {
  const surface = (edge.surface ?? '').toLowerCase();
  if (PAVED_SURFACES.has(surface)) return 'paved';
  if (NATURAL_SURFACES.has(surface)) return 'natural';
  if (edge.terrainContext?.landcoverClass === 'forest') return 'natural';
  if (ROAD_LIKE_HIGHWAYS.has((edge.highway ?? '').toLowerCase())) return 'paved';
  return 'mixed';
}

function componentKind(edge: EnrichedEdge): TerrainComponentKindV3 {
  const surface = routeSurface(edge);
  const highway = (edge.highway ?? '').toLowerCase();
  const landcover = edge.terrainContext?.landcoverClass;

  if (surface === 'paved' && edge.scenic && ROAD_LIKE_HIGHWAYS.has(highway)) return 'scenic_paved';
  if (landcover === 'forest') return 'forest';
  if (landcover === 'park') return 'park';
  if (landcover === 'water_corridor') return 'river_corridor';
  if (landcover === 'urban') return edge.scenic ? 'urban_green' : 'residential';
  if (surface === 'paved' && edge.scenic) return 'scenic_paved';
  if (surface === 'natural' && PATH_LIKE_HIGHWAYS.has(highway)) return edge.scenic ? 'forest' : 'field_paths';
  if (edge.scenic) return 'urban_green';
  if (ROAD_LIKE_HIGHWAYS.has(highway)) return 'residential';
  return 'field_paths';
}

function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}
