import type { EnrichedEdge, EnrichedGraph } from '../../types';
import type { RouteSurfaceV3, TerrainComponentKindV3 } from '../types';
import type { NaturalCycleCandidateV3, NaturalGraphContractionResultV3 } from './natural-graph-contraction';
import { planMultiCycleDwellV3 } from './multi-cycle-dwell-planner';
import type { MultiCycleDwellDiagnosticsV3 } from './multi-cycle-dwell-planner';

const PAVED_SURFACES = new Set(['asphalt', 'concrete', 'paved', 'paving_stones', 'sett', 'cobblestone', 'compacted']);
const NATURAL_SURFACES = new Set(['dirt', 'earth', 'grass', 'ground', 'gravel', 'mud', 'sand', 'soil', 'unpaved', 'woodchips']);
const ROAD_LIKE_HIGHWAYS = new Set(['secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);
const PATH_LIKE_HIGHWAYS = new Set(['path', 'track', 'footway', 'bridleway', 'pedestrian']);

interface DirectedOrderedCycleEdgeV3 {
  edge: EnrichedEdge;
  from: string;
  to: string;
  kind: TerrainComponentKindV3;
  surface: RouteSurfaceV3;
}

export type OrderedCycleExpansionFailureReasonV3 =
  | 'no_cycle_candidate'
  | 'invalid_cycle_expansion'
  | 'no_access'
  | 'no_closure';

export interface OrderedCycleExpansionMetricsV3 {
  distanceKm: number;
  accessKm: number;
  cycleKm: number;
  naturalCycleKm: number;
  closureKm: number;
  pavedKm: number;
  repeatEdgeKm: number;
  targetRepeatKm: number;
  connectorRepeatKm: number;
}

export interface OrderedCycleExpansionValidationV3 {
  continuous: boolean;
  closedCycle: boolean;
  reconstructibleGeometry: boolean;
  missingOriginalEdgeIds: string[];
  disconnectedAtEdgeIds: string[];
}

export interface OrderedCycleExpansionCoreV3 {
  cycleId: string;
  entryNodeId: string;
  exitNodeId: string;
  originalEdgeIds: string[];
  originalNodeIds: string[];
  lengthKm: number;
}

export interface OrderedCycleExpansionDiagnosticsV3 {
  candidateCount: number;
  selectedCycleId: string | null;
  rejectedCycles: Array<{ id: string; reason: OrderedCycleExpansionFailureReasonV3 }>;
  validation: OrderedCycleExpansionValidationV3;
  metrics: OrderedCycleExpansionMetricsV3;
  rankedNaturalCycles?: NaturalGraphContractionResultV3['diagnostics']['rankedNaturalCycles'];
  multiCycleDwell?: MultiCycleDwellDiagnosticsV3;
}

export interface OrderedCycleExpansionInputV3 {
  graph: EnrichedGraph;
  startNodeId: string;
  contraction: NaturalGraphContractionResultV3;
  targetComponentIds: TerrainComponentKindV3[];
  targetDistanceKm: number;
}

export interface OrderedCycleExpansionSuccessV3 {
  status: 'success';
  edgeIds: string[];
  nodeIds: string[];
  core: OrderedCycleExpansionCoreV3;
  metrics: OrderedCycleExpansionMetricsV3;
  validation: OrderedCycleExpansionValidationV3;
  diagnostics: OrderedCycleExpansionDiagnosticsV3;
}

export interface OrderedCycleExpansionFailureV3 {
  status: 'failure';
  reason: OrderedCycleExpansionFailureReasonV3;
  edgeIds: string[];
  nodeIds: string[];
  metrics: OrderedCycleExpansionMetricsV3;
  validation: OrderedCycleExpansionValidationV3;
  diagnostics: OrderedCycleExpansionDiagnosticsV3;
}

export type OrderedCycleExpansionResultV3 = OrderedCycleExpansionSuccessV3 | OrderedCycleExpansionFailureV3;

const EMPTY_VALIDATION: OrderedCycleExpansionValidationV3 = {
  continuous: false,
  closedCycle: false,
  reconstructibleGeometry: false,
  missingOriginalEdgeIds: [],
  disconnectedAtEdgeIds: [],
};

export function buildOrderedCycleExpansionV3(input: OrderedCycleExpansionInputV3): OrderedCycleExpansionResultV3 {
  const adjacency = buildAdjacency(input.graph);
  const rejectedCycles: Array<{ id: string; reason: OrderedCycleExpansionFailureReasonV3 }> = [];
  const multiCycle = planMultiCycleDwellV3({
    graph: input.graph,
    startNodeId: input.startNodeId,
    contraction: input.contraction,
    targetComponentIds: input.targetComponentIds,
    targetDistanceKm: input.targetDistanceKm,
    requestedNaturalDwellKm: Math.max(2.5, input.targetDistanceKm * 0.55),
  });
  if (multiCycle.status === 'success') {
    const metrics = metricsFromMultiCycle(multiCycle.metrics);
    const core = {
      cycleId: 'multi-cycle-dwell',
      entryNodeId: multiCycle.nodeIds[0] ?? input.startNodeId,
      exitNodeId: multiCycle.selectedExitNode,
      originalEdgeIds: multiCycle.edgeIds,
      originalNodeIds: multiCycle.nodeIds,
      lengthKm: multiCycle.metrics.chainKm,
    };
    const validation = validateOrderedCycle(input.graph, edgeIdsToDirectedTraversal(input.startNodeId, multiCycle.edgeIds, input.graph, adjacency), multiCycle.nodeIds);
    const diagnostics = {
      candidateCount: input.contraction.cycleCandidates.length,
      selectedCycleId: 'multi-cycle-dwell',
      rejectedCycles,
      validation,
      metrics,
      rankedNaturalCycles: input.contraction.diagnostics.rankedNaturalCycles,
      multiCycleDwell: multiCycle.diagnostics,
    };
    return { status: 'success', edgeIds: multiCycle.edgeIds, nodeIds: multiCycle.nodeIds, core, metrics, validation, diagnostics };
  }
  const candidates = [...input.contraction.cycleCandidates]
    .sort((a, b) => cycleScore(b, input) - cycleScore(a, input));

  for (const cycle of candidates) {
    const ordered = orderCycleEdges(cycle, input.graph);
    if (!ordered) {
      rejectedCycles.push({ id: cycle.id, reason: 'invalid_cycle_expansion' });
      continue;
    }
    const validation = validateOrderedCycle(input.graph, ordered.edges, ordered.nodes);
    if (!validation.continuous || !validation.reconstructibleGeometry) {
      rejectedCycles.push({ id: cycle.id, reason: 'invalid_cycle_expansion' });
      continue;
    }

    const access = shortestPath(input.startNodeId, ordered.nodes[0], adjacency, () => true);
    if (ordered.nodes[0] !== input.startNodeId && access.length === 0) {
      rejectedCycles.push({ id: cycle.id, reason: 'no_access' });
      continue;
    }
    const usedCycleEdgeIds = new Set(ordered.edges.map((edge) => edge.edge.id));
    const usedAccessEdgeIds = new Set(access.map((edge) => edge.edge.id));
    const closureStart = ordered.nodes.at(-1) ?? ordered.nodes[0];
    const cleanClosure = shortestPath(closureStart, input.startNodeId, adjacency, (edge) => {
      if (usedCycleEdgeIds.has(edge.edge.id)) return false;
      return !usedAccessEdgeIds.has(edge.edge.id);
    });
    const closure = cleanClosure.length > 0
      ? cleanClosure
      : shortestPath(closureStart, input.startNodeId, adjacency, (edge) => !usedCycleEdgeIds.has(edge.edge.id));
    if (closureStart !== input.startNodeId && closure.length === 0) {
      rejectedCycles.push({ id: cycle.id, reason: 'no_closure' });
      continue;
    }

    const edgeIds = [...access, ...ordered.edges, ...closure].map((edge) => edge.edge.id);
    const directed = edgeIdsToDirectedTraversal(input.startNodeId, edgeIds, input.graph, adjacency);
    const nodeIds = nodesFromDirectedEdges(input.startNodeId, directed);
    const metrics = metricsFromPhases(access, ordered.edges, closure, input.targetComponentIds, usedCycleEdgeIds, usedAccessEdgeIds);
    const core = {
      cycleId: cycle.id,
      entryNodeId: ordered.nodes[0],
      exitNodeId: ordered.nodes.at(-1) ?? ordered.nodes[0],
      originalEdgeIds: ordered.edges.map((edge) => edge.edge.id),
      originalNodeIds: ordered.nodes,
      lengthKm: round(sumDirectedLengths(ordered.edges)),
    };
    const diagnostics = {
      candidateCount: input.contraction.cycleCandidates.length,
      selectedCycleId: cycle.id,
      rejectedCycles,
      validation,
      metrics,
      rankedNaturalCycles: input.contraction.diagnostics.rankedNaturalCycles,
      multiCycleDwell: multiCycle.diagnostics,
    };
    return { status: 'success', edgeIds, nodeIds, core, metrics, validation, diagnostics };
  }

  const reason = candidates.length === 0 ? 'no_cycle_candidate' : rejectedCycles[0]?.reason ?? 'invalid_cycle_expansion';
  const metrics = emptyMetrics();
  const diagnostics = {
    candidateCount: input.contraction.cycleCandidates.length,
    selectedCycleId: null,
    rejectedCycles,
    validation: EMPTY_VALIDATION,
    metrics,
    rankedNaturalCycles: input.contraction.diagnostics.rankedNaturalCycles,
    multiCycleDwell: multiCycle.diagnostics,
  };
  return { status: 'failure', reason, edgeIds: [], nodeIds: [input.startNodeId], metrics, validation: EMPTY_VALIDATION, diagnostics };
}

function metricsFromMultiCycle(metrics: import('./multi-cycle-dwell-planner').MultiCycleDwellMetricsV3): OrderedCycleExpansionMetricsV3 {
  return {
    distanceKm: metrics.distanceKm,
    accessKm: metrics.accessKm,
    cycleKm: metrics.chainKm,
    naturalCycleKm: metrics.chainNaturalKm,
    closureKm: metrics.closureKm,
    pavedKm: metrics.pavedKm,
    repeatEdgeKm: metrics.chainRepeatKm,
    targetRepeatKm: metrics.chainTargetRepeatKm,
    connectorRepeatKm: metrics.chainConnectorRepeatKm,
  };
}

function cycleScore(cycle: NaturalCycleCandidateV3, input: OrderedCycleExpansionInputV3): number {
  const targetNaturalKm = Math.max(1, input.targetDistanceKm * 0.45);
  const lengthFit = Math.min(cycle.lengthKm, targetNaturalKm) * 100 - Math.max(0, cycle.lengthKm - input.targetDistanceKm * 0.9) * 20;
  return cycle.qualityScore * 10 + lengthFit;
}

function orderCycleEdges(
  cycle: NaturalCycleCandidateV3,
  graph: EnrichedGraph,
): { edges: DirectedOrderedCycleEdgeV3[]; nodes: string[] } | null {
  const undirected = cycle.originalEdgeIds.map((edgeId) => graph.edges.get(edgeId));
  if (undirected.some((edge) => !edge)) return null;
  const edges = undirected.filter((edge): edge is EnrichedEdge => Boolean(edge));
  const remaining = new Map(edges.map((edge) => [edge.id, edge]));
  const nodeIds = Array.from(new Set(edges.flatMap((edge) => [edge.from, edge.to]))).sort();
  const endpointCounts = new Map<string, number>();
  for (const edge of edges) {
    endpointCounts.set(edge.from, (endpointCounts.get(edge.from) ?? 0) + 1);
    endpointCounts.set(edge.to, (endpointCounts.get(edge.to) ?? 0) + 1);
  }
  const start = nodeIds.find((nodeId) => endpointCounts.get(nodeId) === 2) ?? nodeIds[0];
  if (!start) return null;

  const ordered: DirectedOrderedCycleEdgeV3[] = [];
  const nodes = [start];
  let current = start;
  const originalOrder = new Map(cycle.originalEdgeIds.map((edgeId, index) => [edgeId, index]));
  while (remaining.size > 0) {
    const next = Array.from(remaining.values())
      .filter((edge) => edge.from === current || edge.to === current)
      .sort((a, b) => (originalOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (originalOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id))[0];
    if (!next) return simpleCycleFromCandidateEdges(cycle, graph);
    remaining.delete(next.id);
    const directed = directedEdge(next, current);
    ordered.push(directed);
    current = directed.to;
    nodes.push(current);
  }

  if (current !== start) return simpleCycleFromCandidateEdges(cycle, graph);
  return { edges: ordered, nodes };
}

function simpleCycleFromCandidateEdges(
  cycle: NaturalCycleCandidateV3,
  graph: EnrichedGraph,
): { edges: DirectedOrderedCycleEdgeV3[]; nodes: string[] } | null {
  const edgeSet = new Set(cycle.originalEdgeIds);
  const adjacency = new Map<string, DirectedOrderedCycleEdgeV3[]>();
  for (const edgeId of cycle.originalEdgeIds) {
    const edge = graph.edges.get(edgeId);
    if (!edge) return null;
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, []);
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, []);
    adjacency.get(edge.from)?.push(directedEdge(edge, edge.from));
    adjacency.get(edge.to)?.push(directedEdge(edge, edge.to));
  }

  let best: { edges: DirectedOrderedCycleEdgeV3[]; nodes: string[]; lengthKm: number } | null = null;
  for (const seedId of cycle.originalEdgeIds.slice(0, 96)) {
    const seed = graph.edges.get(seedId);
    if (!seed) continue;
    const path = shortestPathWithinEdgeSet(seed.to, seed.from, adjacency, edgeSet, new Set([seed.id]), 48);
    if (path.length === 0) continue;
    const edges = [directedEdge(seed, seed.from), ...path];
    const nodes = nodesFromDirectedEdges(seed.from, edges);
    const lengthKm = sumDirectedLengths(edges);
    if (lengthKm < 0.5) continue;
    if (!best || lengthKm > best.lengthKm) best = { edges, nodes, lengthKm };
  }
  return best ? { edges: best.edges, nodes: best.nodes } : null;
}

function shortestPathWithinEdgeSet(
  fromNodeId: string,
  toNodeId: string,
  adjacency: Map<string, DirectedOrderedCycleEdgeV3[]>,
  allowedEdgeIds: Set<string>,
  forbiddenEdgeIds: Set<string>,
  maxHops: number,
): DirectedOrderedCycleEdgeV3[] {
  const pending: Array<{ nodeId: string; traversal: DirectedOrderedCycleEdgeV3[]; used: Set<string> }> = [{ nodeId: fromNodeId, traversal: [], used: new Set(forbiddenEdgeIds) }];
  const bestHopCount = new Map<string, number>([[fromNodeId, 0]]);
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current) break;
    if (current.nodeId === toNodeId && current.traversal.length > 0) return current.traversal;
    if (current.traversal.length >= maxHops) continue;
    const nextEdges = (adjacency.get(current.nodeId) ?? [])
      .filter((edge) => allowedEdgeIds.has(edge.edge.id) && !current.used.has(edge.edge.id))
      .sort((a, b) => b.edge.lengthKm - a.edge.lengthKm || a.edge.id.localeCompare(b.edge.id));
    for (const edge of nextEdges.slice(0, 6)) {
      const nextHopCount = current.traversal.length + 1;
      if (nextHopCount > (bestHopCount.get(edge.to) ?? Number.POSITIVE_INFINITY) + 6) continue;
      bestHopCount.set(edge.to, Math.min(bestHopCount.get(edge.to) ?? Number.POSITIVE_INFINITY, nextHopCount));
      const used = new Set(current.used);
      used.add(edge.edge.id);
      pending.push({ nodeId: edge.to, traversal: [...current.traversal, edge], used });
    }
  }
  return [];
}

function validateOrderedCycle(
  graph: EnrichedGraph,
  edges: DirectedOrderedCycleEdgeV3[],
  nodes: string[],
): OrderedCycleExpansionValidationV3 {
  const missingOriginalEdgeIds: string[] = [];
  const disconnectedAtEdgeIds: string[] = [];
  let current = nodes[0];
  for (const edge of edges) {
    if (!graph.edges.has(edge.edge.id)) {
      missingOriginalEdgeIds.push(edge.edge.id);
      continue;
    }
    if (edge.from !== current || !((edge.edge.from === edge.from && edge.edge.to === edge.to) || (edge.edge.from === edge.to && edge.edge.to === edge.from))) {
      disconnectedAtEdgeIds.push(edge.edge.id);
      break;
    }
    current = edge.to;
  }
  const continuous = disconnectedAtEdgeIds.length === 0 && missingOriginalEdgeIds.length === 0 && edges.length > 0;
  const closedCycle = nodes.length > 1 && nodes[0] === nodes.at(-1);
  return {
    continuous,
    closedCycle,
    reconstructibleGeometry: continuous && nodes.every((nodeId) => graph.nodes.has(nodeId)),
    missingOriginalEdgeIds,
    disconnectedAtEdgeIds,
  };
}

function buildAdjacency(graph: EnrichedGraph): Map<string, DirectedOrderedCycleEdgeV3[]> {
  const adjacency = new Map<string, DirectedOrderedCycleEdgeV3[]>();
  for (const nodeId of Array.from(graph.nodes.keys())) adjacency.set(nodeId, []);
  for (const edge of Array.from(graph.edges.values())) {
    adjacency.get(edge.from)?.push(directedEdge(edge, edge.from));
    adjacency.get(edge.to)?.push(directedEdge(edge, edge.to));
  }
  return adjacency;
}

function directedEdge(edge: EnrichedEdge, from: string): DirectedOrderedCycleEdgeV3 {
  const to = edge.from === from ? edge.to : edge.from;
  return { edge, from, to, kind: componentKind(edge), surface: routeSurface(edge) };
}

function shortestPath(
  fromNodeId: string,
  toNodeId: string,
  adjacency: Map<string, DirectedOrderedCycleEdgeV3[]>,
  allowed: (edge: DirectedOrderedCycleEdgeV3) => boolean,
): DirectedOrderedCycleEdgeV3[] {
  if (fromNodeId === toNodeId) return [];
  const bestDistances = new Map<string, number>([[fromNodeId, 0]]);
  const pending: Array<{ nodeId: string; distanceKm: number; traversal: DirectedOrderedCycleEdgeV3[] }> = [{ nodeId: fromNodeId, distanceKm: 0, traversal: [] }];
  while (pending.length > 0) {
    const current = pending.sort((a, b) => a.distanceKm - b.distanceKm).shift();
    if (!current) break;
    if (current.nodeId === toNodeId) return current.traversal;
    if (current.distanceKm > (bestDistances.get(current.nodeId) ?? Number.POSITIVE_INFINITY) + 0.000001) continue;
    for (const edge of adjacency.get(current.nodeId) ?? []) {
      if (!allowed(edge)) continue;
      const nextDistanceKm = current.distanceKm + Math.max(0, edge.edge.lengthKm);
      if (nextDistanceKm + 0.000001 >= (bestDistances.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      bestDistances.set(edge.to, nextDistanceKm);
      pending.push({ nodeId: edge.to, distanceKm: nextDistanceKm, traversal: [...current.traversal, edge] });
    }
  }
  return [];
}

function edgeIdsToDirectedTraversal(
  startNodeId: string,
  edgeIds: string[],
  graph: EnrichedGraph,
  adjacency: Map<string, DirectedOrderedCycleEdgeV3[]>,
): DirectedOrderedCycleEdgeV3[] {
  const traversal: DirectedOrderedCycleEdgeV3[] = [];
  let current = startNodeId;
  for (const edgeId of edgeIds) {
    const edge = (adjacency.get(current) ?? []).find((candidate) => candidate.edge.id === edgeId);
    const fallback = edge ?? graph.edges.get(edgeId);
    if (!fallback) return traversal;
    const directed = 'edge' in fallback ? fallback : directedEdge(fallback, current);
    traversal.push(directed);
    current = directed.to;
  }
  return traversal;
}

function metricsFromPhases(
  access: DirectedOrderedCycleEdgeV3[],
  cycle: DirectedOrderedCycleEdgeV3[],
  closure: DirectedOrderedCycleEdgeV3[],
  targetComponentIds: TerrainComponentKindV3[],
  cycleEdgeIds: Set<string>,
  accessEdgeIds: Set<string>,
): OrderedCycleExpansionMetricsV3 {
  const all = [...access, ...cycle, ...closure];
  const targetComponents = new Set(targetComponentIds);
  const seen = new Set<string>();
  let repeatEdgeKm = 0;
  for (const edge of all) {
    if (seen.has(edge.edge.id)) repeatEdgeKm += Math.max(0, edge.edge.lengthKm);
    seen.add(edge.edge.id);
  }
  const targetRepeatKm = repeatedTargetPairKm(cycle, targetComponents) + closure
    .filter((edge) => cycleEdgeIds.has(edge.edge.id) || (targetComponents.has(edge.kind) && cycle.some((candidate) => edgePairKey(candidate) === edgePairKey(edge))))
    .reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
  const connectorRepeatKm = closure
    .filter((edge) => accessEdgeIds.has(edge.edge.id))
    .reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
  return {
    distanceKm: round(sumDirectedLengths(all)),
    accessKm: round(sumDirectedLengths(access)),
    cycleKm: round(sumDirectedLengths(cycle)),
    naturalCycleKm: round(sumDirectedLengths(cycle.filter((edge) => targetComponents.has(edge.kind) && edge.surface !== 'paved'))),
    closureKm: round(sumDirectedLengths(closure)),
    pavedKm: round(sumPaved(all)),
    repeatEdgeKm: round(repeatEdgeKm),
    targetRepeatKm: round(targetRepeatKm),
    connectorRepeatKm: round(connectorRepeatKm),
  };
}

function nodesFromDirectedEdges(startNodeId: string, edges: DirectedOrderedCycleEdgeV3[]): string[] {
  const nodes = [startNodeId];
  for (const edge of edges) nodes.push(edge.to);
  return nodes;
}

function edgePairKey(edge: DirectedOrderedCycleEdgeV3): string {
  return [edge.from, edge.to].sort().join('::');
}

function repeatedTargetPairKm(edges: DirectedOrderedCycleEdgeV3[], targetComponents: Set<TerrainComponentKindV3>): number {
  const seenPairs = new Set<string>();
  let repeatedKm = 0;
  for (const edge of edges) {
    if (!targetComponents.has(edge.kind)) continue;
    const key = edgePairKey(edge);
    if (seenPairs.has(key)) repeatedKm += Math.max(0, edge.edge.lengthKm);
    seenPairs.add(key);
  }
  return repeatedKm;
}

function sumDirectedLengths(edges: DirectedOrderedCycleEdgeV3[]): number {
  return edges.reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
}

function sumPaved(edges: DirectedOrderedCycleEdgeV3[]): number {
  return edges.filter((edge) => edge.surface === 'paved').reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
}

function emptyMetrics(): OrderedCycleExpansionMetricsV3 {
  return { distanceKm: 0, accessKm: 0, cycleKm: 0, naturalCycleKm: 0, closureKm: 0, pavedKm: 0, repeatEdgeKm: 0, targetRepeatKm: 0, connectorRepeatKm: 0 };
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
