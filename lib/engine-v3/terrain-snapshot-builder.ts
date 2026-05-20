import { haversineKm } from '../route-generator-legacy';
import type { EnrichedEdge, EnrichedGraph } from '../types';
import { classifyEdgeSemanticsV3 } from './edge-semantics';
import type { ConfidenceV3, TerrainComponentKindV3, TerrainComponentV3, TerrainSnapshotV3 } from './types';

interface ComponentAccumulator {
  kind: TerrainComponentKindV3;
  edgeCount: number;
  totalLengthKm: number;
  pavedKm: number;
  nonPavedKm: number;
  minDistanceFromStartKm: number;
  confidenceScores: ConfidenceV3[];
}

export function buildTerrainSnapshotV3FromGraph(graph: EnrichedGraph): TerrainSnapshotV3 {
  const uniqueEdges = dedupeUndirectedEdges(graph);
  const startNodeId = closestNodeIdToCenter(graph);
  const distancesFromStart = startNodeId ? shortestDistancesFromStart(graph, startNodeId) : new Map<string, number>();
  const components = new Map<TerrainComponentKindV3, ComponentAccumulator>();

  let totalLengthKm = 0;
  let pavedKm = 0;
  let nonPavedKm = 0;
  const warnings: string[] = [];
  let unknownSurfaceKm = 0;

  for (const edge of uniqueEdges) {
    const lengthKm = Math.max(0, edge.lengthKm);
    const semantics = classifyEdgeSemanticsV3(edge);
    const surface = semantics.routeSurface;
    const kind = semantics.componentKind;
    const accumulator = components.get(kind) ?? createAccumulator(kind);
    const distanceFromStartKm = estimateEdgeDistanceFromStart(edge, distancesFromStart, graph);

    totalLengthKm += lengthKm;
    accumulator.totalLengthKm += lengthKm;
    accumulator.edgeCount += 1;
    accumulator.minDistanceFromStartKm = Math.min(accumulator.minDistanceFromStartKm, distanceFromStartKm);
    accumulator.confidenceScores.push(edge.terrainContext?.confidence ?? (edge.surface ? 'medium' : 'low'));

    if (surface === 'paved') {
      pavedKm += lengthKm;
      accumulator.pavedKm += lengthKm;
    } else {
      const pavedEquivalentKm = lengthKm * semantics.pavedEquivalentWeight;
      const nonPavedEquivalentKm = lengthKm - pavedEquivalentKm;
      if (surface === 'mixed') unknownSurfaceKm += lengthKm;
      pavedKm += pavedEquivalentKm;
      nonPavedKm += nonPavedEquivalentKm;
      accumulator.pavedKm += pavedEquivalentKm;
      accumulator.nonPavedKm += nonPavedEquivalentKm;
    }

    components.set(kind, accumulator);
  }

  if (unknownSurfaceKm > 0) warnings.push(`graph adapter inferred mixed surface for ${round(unknownSurfaceKm)}km of unknown edges`);
  if (uniqueEdges.length === 0) warnings.push('graph adapter received no routeable edges');

  return {
    audit: {
      confidence: auditConfidence(uniqueEdges.length, totalLengthKm, unknownSurfaceKm),
      edgeCount: uniqueEdges.length,
      totalLengthKm: round(totalLengthKm),
      pavedRatio: ratio(pavedKm, totalLengthKm),
      nonPavedRatio: ratio(nonPavedKm, totalLengthKm),
      warnings,
    },
    components: Array.from(components.values())
      .map(toComponent)
      .sort((a, b) => a.distanceFromStartKm - b.distanceFromStartKm || b.totalLengthKm - a.totalLengthKm),
  };
}

function dedupeUndirectedEdges(graph: EnrichedGraph): EnrichedEdge[] {
  const seen = new Set<string>();
  const edges: EnrichedEdge[] = [];
  for (const edge of Array.from(graph.edges.values())) {
    const [from, to] = [edge.from, edge.to].sort();
    const key = `${from}-${to}-${edge.osmWayId}`;
    if (seen.has(key)) continue;
    seen.add(key);
    edges.push(edge);
  }
  return edges;
}

function closestNodeIdToCenter(graph: EnrichedGraph): string | null {
  let best: { id: string; distanceKm: number } | null = null;
  for (const node of Array.from(graph.nodes.values())) {
    const distanceKm = haversineKm(graph.center, { lat: node.lat, lng: node.lng });
    if (!best || distanceKm < best.distanceKm) best = { id: node.id, distanceKm };
  }
  return best?.id ?? null;
}

function shortestDistancesFromStart(graph: EnrichedGraph, startNodeId: string): Map<string, number> {
  const distances = new Map<string, number>([[startNodeId, 0]]);
  const queue: Array<{ nodeId: string; distanceKm: number }> = [{ nodeId: startNodeId, distanceKm: 0 }];

  while (queue.length > 0) {
    queue.sort((a, b) => a.distanceKm - b.distanceKm);
    const current = queue.shift()!;
    if (current.distanceKm > (distances.get(current.nodeId) ?? Infinity)) continue;
    const node = graph.nodes.get(current.nodeId);
    if (!node) continue;

    for (const edgeId of node.edges) {
      const edge = graph.edges.get(edgeId);
      if (!edge) continue;
      const nextDistanceKm = current.distanceKm + Math.max(0, edge.lengthKm);
      if (nextDistanceKm < (distances.get(edge.to) ?? Infinity)) {
        distances.set(edge.to, nextDistanceKm);
        queue.push({ nodeId: edge.to, distanceKm: nextDistanceKm });
      }
    }
  }

  return distances;
}

function estimateEdgeDistanceFromStart(edge: EnrichedEdge, distances: Map<string, number>, graph: EnrichedGraph): number {
  const fromDistance = distances.get(edge.from);
  const toDistance = distances.get(edge.to);
  const graphDistance = Math.min(fromDistance ?? Infinity, toDistance ?? Infinity);
  if (Number.isFinite(graphDistance)) return round(Math.max(0, graphDistance * 0.5));

  const from = graph.nodes.get(edge.from);
  const to = graph.nodes.get(edge.to);
  if (!from && !to) return 0;
  const distancesToCenter = [from, to]
    .filter((node): node is NonNullable<typeof node> => Boolean(node))
    .map((node) => haversineKm(graph.center, { lat: node.lat, lng: node.lng }));
  return round(Math.min(...distancesToCenter));
}

function createAccumulator(kind: TerrainComponentKindV3): ComponentAccumulator {
  return {
    kind,
    edgeCount: 0,
    totalLengthKm: 0,
    pavedKm: 0,
    nonPavedKm: 0,
    minDistanceFromStartKm: Infinity,
    confidenceScores: [],
  };
}

function toComponent(accumulator: ComponentAccumulator): TerrainComponentV3 {
  return {
    id: `${accumulator.kind}-graph-component`,
    kind: accumulator.kind,
    distanceFromStartKm: Number.isFinite(accumulator.minDistanceFromStartKm) ? round(accumulator.minDistanceFromStartKm) : 0,
    edgeCount: accumulator.edgeCount,
    totalLengthKm: round(accumulator.totalLengthKm),
    pavedRatio: ratio(accumulator.pavedKm, accumulator.totalLengthKm),
    nonPavedRatio: ratio(accumulator.nonPavedKm, accumulator.totalLengthKm),
    confidence: componentConfidence(accumulator.confidenceScores),
  };
}

function auditConfidence(edgeCount: number, totalLengthKm: number, unknownSurfaceKm: number): ConfidenceV3 {
  if (edgeCount === 0 || totalLengthKm < 3) return 'low';
  if (totalLengthKm >= 15 && unknownSurfaceKm / Math.max(0.001, totalLengthKm) < 0.35) return 'high';
  return 'medium';
}

function componentConfidence(confidences: ConfidenceV3[]): ConfidenceV3 {
  if (confidences.includes('low')) return 'medium';
  if (confidences.length > 0 && confidences.every((confidence) => confidence === 'high')) return 'high';
  return 'medium';
}

function ratio(value: number, total: number): number {
  if (total <= 0) return 0;
  return round(value / total);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
