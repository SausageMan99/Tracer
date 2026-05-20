import type { EnrichedEdge, EnrichedGraph } from '../../types';
import { classifyEdgeSemanticsV3 } from '../edge-semantics';
import type { TerrainComponentKindV3 } from '../types';

interface DirectedTrailSpineEdgeV3 {
  edge: EnrichedEdge;
  from: string;
  to: string;
  componentKind: TerrainComponentKindV3;
}

export interface TrailSpineCandidateV3 {
  spineId: string;
  componentId: string;
  componentKind: TerrainComponentKindV3;
  edgeIds: string[];
  nodeIds?: string[];
  distanceKm: number;
  strictTrailKm: number;
  naturalWayKm: number;
  mixedUnknownKm: number;
  pavedKm: number;
  longestStrictTrailSegmentKm: number;
  trailConfidence: number;
  accessCostKm: number;
  estimatedClosureCostKm: number;
  connectorPavedRisk: number;
  repeatRisk: number;
  expansionPotentialKm: number;
  explanation: string;
}

export interface TrailSpineSelectorInputV3 {
  graph: EnrichedGraph;
  startNodeId: string;
  targetComponentIds: TerrainComponentKindV3[];
  maxCandidates?: number;
  minDistanceKm?: number;
}

export interface TrailSpineSelectorDiagnosticsV3 {
  candidateCount: number;
  selectedSpineId: string | null;
  rejectedComponentCount: number;
  topCandidates: TrailSpineCandidateV3[];
}

export interface TrailSpineSelectorResultV3 {
  candidates: TrailSpineCandidateV3[];
  selected: TrailSpineCandidateV3 | null;
  diagnostics: TrailSpineSelectorDiagnosticsV3;
}

export function selectTrailSpinesV3(input: TrailSpineSelectorInputV3): TrailSpineSelectorResultV3 {
  const maxCandidates = input.maxCandidates ?? 8;
  const minDistanceKm = input.minDistanceKm ?? 1.2;
  const targetComponents = new Set(input.targetComponentIds);
  let adjacency = buildCandidateAdjacency(input.graph, targetComponents);
  if (adjacency.size === 0) {
    adjacency = buildCandidateAdjacency(input.graph, targetComponents, true);
  }
  const fullAdjacency = buildFullAdjacency(input.graph);
  const components = connectedComponents(adjacency);
  const candidates: TrailSpineCandidateV3[] = [];
  let rejectedComponentCount = 0;

  for (const component of components) {
    const componentEdges = uniqueDirectedEdges(component.nodeIds, adjacency);
    const expansionPotentialKm = round(componentEdges.reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm) * classifyEdgeSemanticsV3(edge.edge).candidateNaturalWeight, 0));
    const path = longestCandidatePath(input.startNodeId, component.nodeIds, adjacency);
    if (path.length === 0) {
      rejectedComponentCount += 1;
      continue;
    }
    const metrics = metricsFor(path);
    const componentKind = dominantComponentKind(path);
    const pathStartNodeId = path[0]?.from ?? Array.from(component.nodeIds)[0] ?? input.startNodeId;
    const access = shortestPathToAny(input.startNodeId, new Set([pathStartNodeId]), fullAdjacency, new Set(path.map((edge) => edge.edge.id)));
    const endNodeId = path.at(-1)?.to ?? pathStartNodeId;
    const closure = shortestPathToAny(endNodeId, new Set([input.startNodeId]), fullAdjacency, new Set(path.map((edge) => edge.edge.id)));
    const accessPavedKm = sumPavedEquivalent(access);
    const closurePavedKm = sumPavedEquivalent(closure);
    const accessCostKm = round(sumLength(access));
    const estimatedClosureCostKm = round(sumLength(closure));
    const connectorKm = accessCostKm + estimatedClosureCostKm;
    const connectorPavedRisk = connectorKm > 0 ? round((accessPavedKm + closurePavedKm) / connectorKm) : 0;
    const repeatRisk = round(repeatedPairRatio(path));
    const scoreEligible = metrics.distanceKm >= minDistanceKm && metrics.trailConfidence >= 0.45 && metrics.pavedKm <= Math.max(0.2, metrics.distanceKm * 0.18);
    if (!scoreEligible) {
      rejectedComponentCount += 1;
    }
    candidates.push({
      spineId: `trail-spine-${candidates.length + 1}`,
      componentId: component.componentId,
      componentKind,
      edgeIds: path.map((edge) => edge.edge.id),
      nodeIds: nodesFromPath(path),
      distanceKm: metrics.distanceKm,
      strictTrailKm: metrics.strictTrailKm,
      naturalWayKm: metrics.naturalWayKm,
      mixedUnknownKm: metrics.mixedUnknownKm,
      pavedKm: metrics.pavedKm,
      longestStrictTrailSegmentKm: metrics.longestStrictTrailSegmentKm,
      trailConfidence: metrics.trailConfidence,
      accessCostKm,
      estimatedClosureCostKm,
      connectorPavedRisk,
      repeatRisk,
      expansionPotentialKm,
      explanation: explanationFor(metrics, accessCostKm, estimatedClosureCostKm, connectorPavedRisk),
    });
  }

  const ranked = candidates
    .sort((a, b) => trailSpineScore(b) - trailSpineScore(a) || a.spineId.localeCompare(b.spineId))
    .slice(0, maxCandidates);
  const selected = ranked[0] ?? null;

  return {
    candidates: ranked,
    selected,
    diagnostics: {
      candidateCount: ranked.length,
      selectedSpineId: selected?.spineId ?? null,
      rejectedComponentCount,
      topCandidates: ranked,
    },
  };
}

export function trailSpineScore(candidate: TrailSpineCandidateV3): number {
  const continuityBonus = candidate.longestStrictTrailSegmentKm * 90 + candidate.distanceKm * 40;
  const strictBonus = candidate.strictTrailKm * 120 + candidate.naturalWayKm * 35;
  const confidenceBonus = candidate.trailConfidence * 180;
  const potentialBonus = Math.min(candidate.expansionPotentialKm, candidate.distanceKm * 2) * 8;
  const pavedPenalty = candidate.pavedKm * 180 + candidate.mixedUnknownKm * 16;
  const connectorPenalty = candidate.accessCostKm * 10 + candidate.estimatedClosureCostKm * 7 + candidate.connectorPavedRisk * 85;
  const repeatPenalty = candidate.repeatRisk * 150;
  return continuityBonus + strictBonus + confidenceBonus + potentialBonus - pavedPenalty - connectorPenalty - repeatPenalty;
}

function buildCandidateAdjacency(
  graph: EnrichedGraph,
  targetComponents: Set<TerrainComponentKindV3>,
  ignoreTargetComponentFilter = false,
): Map<string, DirectedTrailSpineEdgeV3[]> {
  const adjacency = new Map<string, DirectedTrailSpineEdgeV3[]>();
  for (const nodeId of Array.from(graph.nodes.keys())) adjacency.set(nodeId, []);
  for (const edge of Array.from(graph.edges.values())) {
    const semantics = classifyEdgeSemanticsV3(edge);
    if (!ignoreTargetComponentFilter && !targetComponents.has(semantics.componentKind)) continue;
    if (semantics.pavedEquivalentWeight >= 1) continue;
    if (!semantics.isTrailCandidate && semantics.candidateNaturalWeight < 0.3) continue;
    const directed = { edge, from: edge.from, to: edge.to, componentKind: semantics.componentKind };
    const reverse = { edge, from: edge.to, to: edge.from, componentKind: semantics.componentKind };
    adjacency.get(edge.from)?.push(directed);
    adjacency.get(edge.to)?.push(reverse);
  }
  return new Map(Array.from(adjacency.entries()).filter(([, edges]) => edges.length > 0));
}

function buildFullAdjacency(graph: EnrichedGraph): Map<string, DirectedTrailSpineEdgeV3[]> {
  const adjacency = new Map<string, DirectedTrailSpineEdgeV3[]>();
  for (const nodeId of Array.from(graph.nodes.keys())) adjacency.set(nodeId, []);
  for (const edge of Array.from(graph.edges.values())) {
    const componentKind = classifyEdgeSemanticsV3(edge).componentKind;
    adjacency.get(edge.from)?.push({ edge, from: edge.from, to: edge.to, componentKind });
    adjacency.get(edge.to)?.push({ edge, from: edge.to, to: edge.from, componentKind });
  }
  return adjacency;
}

function connectedComponents(adjacency: Map<string, DirectedTrailSpineEdgeV3[]>): Array<{ componentId: string; nodeIds: Set<string> }> {
  const seen = new Set<string>();
  const components: Array<{ componentId: string; nodeIds: Set<string> }> = [];
  for (const nodeId of Array.from(adjacency.keys()).sort()) {
    if (seen.has(nodeId)) continue;
    const stack = [nodeId];
    const nodeIds = new Set<string>();
    while (stack.length > 0) {
      const current = stack.pop();
      if (!current || seen.has(current)) continue;
      seen.add(current);
      nodeIds.add(current);
      for (const edge of adjacency.get(current) ?? []) {
        if (!seen.has(edge.to)) stack.push(edge.to);
      }
    }
    components.push({ componentId: `spine-component-${components.length + 1}`, nodeIds });
  }
  return components;
}

function uniqueDirectedEdges(nodeIds: Set<string>, adjacency: Map<string, DirectedTrailSpineEdgeV3[]>): DirectedTrailSpineEdgeV3[] {
  const seen = new Set<string>();
  const result: DirectedTrailSpineEdgeV3[] = [];
  for (const nodeId of Array.from(nodeIds)) {
    for (const edge of adjacency.get(nodeId) ?? []) {
      if (seen.has(edge.edge.id)) continue;
      seen.add(edge.edge.id);
      result.push(edge);
    }
  }
  return result;
}

function longestCandidatePath(startNodeId: string, nodeIds: Set<string>, adjacency: Map<string, DirectedTrailSpineEdgeV3[]>): DirectedTrailSpineEdgeV3[] {
  const starts = Array.from(nodeIds)
    .sort((a, b) => (a === startNodeId ? -1 : b === startNodeId ? 1 : 0)
      || (adjacency.get(a)?.length ?? 0) - (adjacency.get(b)?.length ?? 0)
      || a.localeCompare(b))
    .slice(0, 12);
  let best: DirectedTrailSpineEdgeV3[] = [];
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const start of starts) {
    const path = greedyTrailPath(start, adjacency, 256);
    const score = pathScore(path);
    if (path.length > 0 && score > bestScore) {
      best = path;
      bestScore = score;
    }
  }
  return best;
}

function greedyTrailPath(start: string, adjacency: Map<string, DirectedTrailSpineEdgeV3[]>, maxSteps: number): DirectedTrailSpineEdgeV3[] {
  let current = start;
  const used = new Set<string>();
  const usedPairs = new Set<string>();
  const path: DirectedTrailSpineEdgeV3[] = [];
  for (let step = 0; step < maxSteps; step += 1) {
    const next = (adjacency.get(current) ?? [])
      .filter((edge) => !used.has(edge.edge.id) && !usedPairs.has(edgePairKey(edge)))
      .sort((a, b) => directedEdgeScore(b) - directedEdgeScore(a) || a.edge.id.localeCompare(b.edge.id))[0];
    if (!next) break;
    used.add(next.edge.id);
    usedPairs.add(edgePairKey(next));
    path.push(next);
    current = next.to;
  }
  return path;
}

function edgePairKey(edge: DirectedTrailSpineEdgeV3): string {
  return [edge.from, edge.to].sort().join('::');
}

function nodesFromPath(path: DirectedTrailSpineEdgeV3[]): string[] {
  if (path.length === 0) return [];
  return [path[0]?.from ?? '', ...path.map((edge) => edge.to)].filter(Boolean);
}

function pathScore(path: DirectedTrailSpineEdgeV3[]): number {
  const metrics = metricsFor(path);
  return metrics.strictTrailKm * 220 + metrics.naturalWayKm * 100 + metrics.distanceKm * 50 - metrics.pavedKm * 80 - metrics.mixedUnknownKm * 5;
}

function directedEdgeScore(edge: DirectedTrailSpineEdgeV3): number {
  const semantics = classifyEdgeSemanticsV3(edge.edge);
  return semantics.trailConfidence * 100 + semantics.candidateNaturalWeight * 50 + Math.max(0, edge.edge.lengthKm) * 12 - semantics.pavedEquivalentWeight * 120;
}

function shortestPathToAny(
  startNodeId: string,
  targetNodeIds: Set<string>,
  adjacency: Map<string, DirectedTrailSpineEdgeV3[]>,
  forbiddenEdgeIds: Set<string>,
): DirectedTrailSpineEdgeV3[] {
  if (targetNodeIds.has(startNodeId)) return [];
  const queue: Array<{ nodeId: string; path: DirectedTrailSpineEdgeV3[]; cost: number }> = [{ nodeId: startNodeId, path: [], cost: 0 }];
  const bestCost = new Map<string, number>([[startNodeId, 0]]);
  while (queue.length > 0) {
    queue.sort((a, b) => a.cost - b.cost);
    const current = queue.shift();
    if (!current) break;
    if (targetNodeIds.has(current.nodeId)) return current.path;
    for (const edge of adjacency.get(current.nodeId) ?? []) {
      if (forbiddenEdgeIds.has(edge.edge.id)) continue;
      const semantics = classifyEdgeSemanticsV3(edge.edge);
      const nextCost = current.cost + Math.max(0, edge.edge.lengthKm) * (1 + semantics.pavedEquivalentWeight * 1.5);
      if (nextCost + 0.001 >= (bestCost.get(edge.to) ?? Infinity)) continue;
      bestCost.set(edge.to, nextCost);
      queue.push({ nodeId: edge.to, path: [...current.path, edge], cost: nextCost });
    }
  }
  return [];
}

function metricsFor(path: DirectedTrailSpineEdgeV3[]) {
  let distanceKm = 0;
  let strictTrailKm = 0;
  let naturalWayKm = 0;
  let mixedUnknownKm = 0;
  let pavedKm = 0;
  let confidenceWeightedKm = 0;
  let currentStrict = 0;
  let longestStrictTrailSegmentKm = 0;
  for (const edge of path) {
    const length = Math.max(0, edge.edge.lengthKm);
    const semantics = classifyEdgeSemanticsV3(edge.edge);
    distanceKm += length;
    pavedKm += length * semantics.pavedEquivalentWeight;
    naturalWayKm += length * semantics.candidateNaturalWeight;
    confidenceWeightedKm += length * semantics.trailConfidence;
    if (semantics.surfaceEvidence === 'path_track_unknown' || semantics.surfaceEvidence === 'contextual_natural_unknown' || semantics.surfaceEvidence === 'unknown') {
      mixedUnknownKm += length;
    }
    if (semantics.isStrictTrailLike && semantics.pavedEquivalentWeight === 0) {
      strictTrailKm += length;
      currentStrict += length;
      longestStrictTrailSegmentKm = Math.max(longestStrictTrailSegmentKm, currentStrict);
    } else {
      currentStrict = 0;
    }
  }
  return {
    distanceKm: round(distanceKm),
    strictTrailKm: round(strictTrailKm),
    naturalWayKm: round(naturalWayKm),
    mixedUnknownKm: round(mixedUnknownKm),
    pavedKm: round(pavedKm),
    longestStrictTrailSegmentKm: round(longestStrictTrailSegmentKm),
    trailConfidence: distanceKm > 0 ? round(confidenceWeightedKm / distanceKm) : 0,
  };
}

function dominantComponentKind(path: DirectedTrailSpineEdgeV3[]): TerrainComponentKindV3 {
  const byKind = new Map<TerrainComponentKindV3, number>();
  for (const edge of path) byKind.set(edge.componentKind, (byKind.get(edge.componentKind) ?? 0) + Math.max(0, edge.edge.lengthKm));
  return Array.from(byKind.entries()).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))[0]?.[0] ?? 'field_paths';
}

function explanationFor(
  metrics: ReturnType<typeof metricsFor>,
  accessCostKm: number,
  estimatedClosureCostKm: number,
  connectorPavedRisk: number,
): string {
  if (metrics.strictTrailKm >= Math.max(1.2, metrics.distanceKm * 0.55)) return 'credible continuous strict trail spine; compose access, dwell, recovery, and closure around it';
  if (metrics.naturalWayKm >= Math.max(1.5, metrics.distanceKm * 0.65) && metrics.mixedUnknownKm > 0) return 'credible natural-way spine but partly unverified; may support adjusted evidence, not strict trail success';
  if (connectorPavedRisk > 0.6 && accessCostKm + estimatedClosureCostKm > metrics.distanceKm * 0.5) return 'natural spine exists but connector paved risk is high';
  return 'weak trail spine; continuity is low or too much mixed/paved evidence';
}

function repeatedPairRatio(path: DirectedTrailSpineEdgeV3[]): number {
  const pairs = path.map((edge) => [edge.from, edge.to].sort().join('::'));
  if (pairs.length === 0) return 0;
  return (pairs.length - new Set(pairs).size) / pairs.length;
}

function sumLength(path: DirectedTrailSpineEdgeV3[]): number {
  return path.reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
}

function sumPavedEquivalent(path: DirectedTrailSpineEdgeV3[]): number {
  return path.reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm) * classifyEdgeSemanticsV3(edge.edge).pavedEquivalentWeight, 0);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
