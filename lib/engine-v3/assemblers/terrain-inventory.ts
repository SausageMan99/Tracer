import type { EnrichedEdge, EnrichedGraph } from '../../types';
import { classifyEdgeSemanticsV3 } from '../edge-semantics';
import type { TerrainComponentKindV3 } from '../types';

export interface TerrainInventoryInputV3 {
  graph: EnrichedGraph;
  startNodeId: string;
  targetComponentIds: TerrainComponentKindV3[];
}

export interface TerrainInventoryComponentV3 {
  componentId: string;
  nodeCount: number;
  edgeCount: number;
  reachableNonPavedKm: number;
  twoCoreKm: number;
  bridgeKm: number;
  deadEndKm: number;
  cycleRank: number;
  articulationCount: number;
  bridgeCount: number;
  portalNodeId: string | null;
  corePortalNodeId: string | null;
  portalToCoreKm: number | null;
  accessPavedKm: number;
  accessDistanceKm: number;
  estimatedClosureCostKm: number | null;
  estimatedLoopableNaturalKm: number;
  bestNaturalSkeletonKm: number;
}

export interface TerrainInventoryV3 {
  scope: 'forest_loop_observation_only';
  targetComponentIds: TerrainComponentKindV3[];
  reachableNonPavedKm: number;
  componentCount: number;
  components: TerrainInventoryComponentV3[];
  totals: {
    twoCoreKm: number;
    bridgeKm: number;
    deadEndKm: number;
    estimatedLoopableNaturalKm: number;
    bestNaturalSkeletonKm: number;
    cycleRank: number;
    articulationCount: number;
    bridgeCount: number;
  };
}

interface NaturalComponentV3 {
  componentId: string;
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  edges: EnrichedEdge[];
}

interface AccessPathV3 {
  nodeId: string;
  distanceKm: number;
  pavedKm: number;
}

const EPSILON = 0.000_001;

export function buildTerrainInventoryV3(input: TerrainInventoryInputV3): TerrainInventoryV3 {
  const naturalEdges = Array.from(input.graph.edges.values()).filter((edge) => isTargetNaturalEdge(edge, input.targetComponentIds));
  const components = naturalComponents(naturalEdges);
  const diagnostics = components
    .map((component) => diagnoseComponent(component, input))
    .filter((component): component is TerrainInventoryComponentV3 & { estimatedClosureCostKmOrInfinity: number } => component !== null)
    .sort((a, b) => {
      return b.estimatedLoopableNaturalKm - a.estimatedLoopableNaturalKm
        || b.bestNaturalSkeletonKm - a.bestNaturalSkeletonKm
        || a.estimatedClosureCostKmOrInfinity - b.estimatedClosureCostKmOrInfinity
        || b.reachableNonPavedKm - a.reachableNonPavedKm;
    })
    .map((component) => stripInternalSortKey(component));

  const totals = diagnostics.reduce(
    (accumulator, component) => ({
      twoCoreKm: accumulator.twoCoreKm + component.twoCoreKm,
      bridgeKm: accumulator.bridgeKm + component.bridgeKm,
      deadEndKm: accumulator.deadEndKm + component.deadEndKm,
      estimatedLoopableNaturalKm: accumulator.estimatedLoopableNaturalKm + component.estimatedLoopableNaturalKm,
      bestNaturalSkeletonKm: Math.max(accumulator.bestNaturalSkeletonKm, component.bestNaturalSkeletonKm),
      cycleRank: accumulator.cycleRank + component.cycleRank,
      articulationCount: accumulator.articulationCount + component.articulationCount,
      bridgeCount: accumulator.bridgeCount + component.bridgeCount,
    }),
    {
      twoCoreKm: 0,
      bridgeKm: 0,
      deadEndKm: 0,
      estimatedLoopableNaturalKm: 0,
      bestNaturalSkeletonKm: 0,
      cycleRank: 0,
      articulationCount: 0,
      bridgeCount: 0,
    },
  );

  return {
    scope: 'forest_loop_observation_only',
    targetComponentIds: [...input.targetComponentIds],
    reachableNonPavedKm: round(diagnostics.reduce((sum, component) => sum + component.reachableNonPavedKm, 0)),
    componentCount: diagnostics.length,
    components: diagnostics,
    totals: {
      twoCoreKm: round(totals.twoCoreKm),
      bridgeKm: round(totals.bridgeKm),
      deadEndKm: round(totals.deadEndKm),
      estimatedLoopableNaturalKm: round(totals.estimatedLoopableNaturalKm),
      bestNaturalSkeletonKm: round(totals.bestNaturalSkeletonKm),
      cycleRank: totals.cycleRank,
      articulationCount: totals.articulationCount,
      bridgeCount: totals.bridgeCount,
    },
  };
}

function isTargetNaturalEdge(edge: EnrichedEdge, targetComponentIds: TerrainComponentKindV3[]): boolean {
  const semantics = classifyEdgeSemanticsV3(edge);
  if (!targetComponentIds.includes(semantics.componentKind)) return false;
  if (semantics.routeSurface === 'paved') return false;
  return semantics.candidateNaturalWeight > 0;
}

function stripInternalSortKey(
  component: TerrainInventoryComponentV3 & { estimatedClosureCostKmOrInfinity: number },
): TerrainInventoryComponentV3 {
  return {
    componentId: component.componentId,
    nodeCount: component.nodeCount,
    edgeCount: component.edgeCount,
    reachableNonPavedKm: component.reachableNonPavedKm,
    twoCoreKm: component.twoCoreKm,
    bridgeKm: component.bridgeKm,
    deadEndKm: component.deadEndKm,
    cycleRank: component.cycleRank,
    articulationCount: component.articulationCount,
    bridgeCount: component.bridgeCount,
    portalNodeId: component.portalNodeId,
    corePortalNodeId: component.corePortalNodeId,
    portalToCoreKm: component.portalToCoreKm,
    accessPavedKm: component.accessPavedKm,
    accessDistanceKm: component.accessDistanceKm,
    estimatedClosureCostKm: component.estimatedClosureCostKm,
    estimatedLoopableNaturalKm: component.estimatedLoopableNaturalKm,
    bestNaturalSkeletonKm: component.bestNaturalSkeletonKm,
  };
}

function naturalComponents(edges: EnrichedEdge[]): NaturalComponentV3[] {
  const adjacency = new Map<string, EnrichedEdge[]>();
  for (const edge of edges) {
    push(adjacency, edge.from, edge);
    push(adjacency, edge.to, edge);
  }

  const visited = new Set<string>();
  const components: NaturalComponentV3[] = [];
  for (const edge of edges) {
    if (visited.has(edge.id)) continue;
    const edgeIds = new Set<string>();
    const nodeIds = new Set<string>();
    const stack = [edge.from, edge.to];
    while (stack.length > 0) {
      const nodeId = stack.pop();
      if (!nodeId) continue;
      nodeIds.add(nodeId);
      for (const adjacentEdge of adjacency.get(nodeId) ?? []) {
        if (edgeIds.has(adjacentEdge.id)) continue;
        edgeIds.add(adjacentEdge.id);
        visited.add(adjacentEdge.id);
        stack.push(adjacentEdge.from === nodeId ? adjacentEdge.to : adjacentEdge.from);
      }
    }
    components.push({
      componentId: `terrain-component-${components.length + 1}`,
      nodeIds,
      edgeIds,
      edges: edges.filter((candidate) => edgeIds.has(candidate.id)),
    });
  }
  return components;
}

function diagnoseComponent(
  component: NaturalComponentV3,
  input: TerrainInventoryInputV3,
): (TerrainInventoryComponentV3 & { estimatedClosureCostKmOrInfinity: number }) | null {
  const access = shortestAccessPath(input.graph, input.startNodeId, component.nodeIds);
  if (!access) return null;

  const componentAdjacency = componentAdjacencyMap(component.edges);
  const twoCoreNodeIds = twoCoreNodes(component.nodeIds, componentAdjacency);
  const twoCoreEdgeIds = new Set(
    component.edges
      .filter((edge) => twoCoreNodeIds.has(edge.from) && twoCoreNodeIds.has(edge.to))
      .map((edge) => edge.id),
  );
  const bridges = bridgeEdgeIds(component.nodeIds, componentAdjacency);
  const articulationNodeIds = articulationNodes(component.nodeIds, componentAdjacency);
  const portalToCore = twoCoreNodeIds.size > 0
    ? shortestNaturalPathToAny(componentAdjacency, access.nodeId, twoCoreNodeIds)
    : null;
  const portalToCoreKm = portalToCore?.distanceKm ?? null;
  const bestNaturalSkeletonKm = largestTwoCoreSkeletonKm(component.edges, twoCoreNodeIds);
  const reachableNonPavedKm = sumLengths(component.edges);
  const twoCoreKm = sumLengths(component.edges.filter((edge) => twoCoreEdgeIds.has(edge.id)));
  const bridgeKm = sumLengths(component.edges.filter((edge) => bridges.has(edge.id)));
  const deadEndKm = sumLengths(component.edges.filter((edge) => !twoCoreEdgeIds.has(edge.id)));
  const cycleRank = Math.max(0, component.edges.length - component.nodeIds.size + 1);
  const estimatedClosureCostKm = portalToCoreKm === null ? null : access.pavedKm + portalToCoreKm;

  return {
    componentId: component.componentId,
    nodeCount: component.nodeIds.size,
    edgeCount: component.edges.length,
    reachableNonPavedKm: round(reachableNonPavedKm),
    twoCoreKm: round(twoCoreKm),
    bridgeKm: round(bridgeKm),
    deadEndKm: round(deadEndKm),
    cycleRank,
    articulationCount: articulationNodeIds.size,
    bridgeCount: bridges.size,
    portalNodeId: access.nodeId,
    corePortalNodeId: portalToCore?.nodeId ?? null,
    portalToCoreKm: portalToCoreKm === null ? null : round(portalToCoreKm),
    accessPavedKm: round(access.pavedKm),
    accessDistanceKm: round(access.distanceKm),
    estimatedClosureCostKm: estimatedClosureCostKm === null ? null : round(estimatedClosureCostKm),
    estimatedLoopableNaturalKm: round(twoCoreKm),
    bestNaturalSkeletonKm: round(bestNaturalSkeletonKm),
    estimatedClosureCostKmOrInfinity: estimatedClosureCostKm ?? Number.POSITIVE_INFINITY,
  };
}

function shortestAccessPath(graph: EnrichedGraph, startNodeId: string, targets: Set<string>): AccessPathV3 | null {
  if (targets.has(startNodeId)) return { nodeId: startNodeId, distanceKm: 0, pavedKm: 0 };
  const distances = new Map<string, { distanceKm: number; pavedKm: number }>([[startNodeId, { distanceKm: 0, pavedKm: 0 }]]);
  const visited = new Set<string>();
  while (visited.size < distances.size) {
    let current: string | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const [nodeId, value] of Array.from(distances.entries())) {
      if (!visited.has(nodeId) && value.distanceKm < best) {
        current = nodeId;
        best = value.distanceKm;
      }
    }
    if (!current) break;
    if (targets.has(current)) return { nodeId: current, ...distances.get(current)! };
    visited.add(current);
    const node = graph.nodes.get(current);
    for (const edgeId of node?.edges ?? []) {
      const edge = graph.edges.get(edgeId);
      if (!edge) continue;
      const next = edge.from === current ? edge.to : edge.to === current ? edge.from : null;
      if (!next || visited.has(next)) continue;
      const currentDistance = distances.get(current)!;
      const nextDistance = currentDistance.distanceKm + Math.max(0, edge.lengthKm);
      const semantics = classifyEdgeSemanticsV3(edge);
      const nextPaved = currentDistance.pavedKm + (semantics.routeSurface === 'paved' ? Math.max(0, edge.lengthKm) : 0);
      const previous = distances.get(next);
      if (!previous || nextDistance + EPSILON < previous.distanceKm) {
        distances.set(next, { distanceKm: nextDistance, pavedKm: nextPaved });
      }
    }
  }
  return null;
}

function componentAdjacencyMap(edges: EnrichedEdge[]): Map<string, { nodeId: string; edge: EnrichedEdge }[]> {
  const adjacency = new Map<string, { nodeId: string; edge: EnrichedEdge }[]>();
  for (const edge of edges) {
    push(adjacency, edge.from, { nodeId: edge.to, edge });
    push(adjacency, edge.to, { nodeId: edge.from, edge });
  }
  return adjacency;
}

function twoCoreNodes(
  nodes: Set<string>,
  adjacency: Map<string, { nodeId: string; edge: EnrichedEdge }[]>,
): Set<string> {
  const remaining = new Set(nodes);
  let changed = true;
  while (changed) {
    changed = false;
    for (const nodeId of Array.from(remaining)) {
      const degree = (adjacency.get(nodeId) ?? []).filter((edge) => remaining.has(edge.nodeId)).length;
      if (degree < 2) {
        remaining.delete(nodeId);
        changed = true;
      }
    }
  }
  return remaining;
}

function bridgeEdgeIds(
  nodes: Set<string>,
  adjacency: Map<string, { nodeId: string; edge: EnrichedEdge }[]>,
): Set<string> {
  const visited = new Set<string>();
  const discovery = new Map<string, number>();
  const low = new Map<string, number>();
  const bridges = new Set<string>();
  let time = 0;

  const visit = (nodeId: string, parentEdgeId: string | null): void => {
    visited.add(nodeId);
    discovery.set(nodeId, time);
    low.set(nodeId, time);
    time += 1;
    for (const next of adjacency.get(nodeId) ?? []) {
      if (next.edge.id === parentEdgeId) continue;
      if (!visited.has(next.nodeId)) {
        visit(next.nodeId, next.edge.id);
        low.set(nodeId, Math.min(low.get(nodeId)!, low.get(next.nodeId)!));
        if (low.get(next.nodeId)! > discovery.get(nodeId)!) bridges.add(next.edge.id);
      } else {
        low.set(nodeId, Math.min(low.get(nodeId)!, discovery.get(next.nodeId)!));
      }
    }
  };

  for (const nodeId of Array.from(nodes)) {
    if (!visited.has(nodeId)) visit(nodeId, null);
  }
  return bridges;
}

function articulationNodes(
  nodes: Set<string>,
  adjacency: Map<string, { nodeId: string; edge: EnrichedEdge }[]>,
): Set<string> {
  const visited = new Set<string>();
  const discovery = new Map<string, number>();
  const low = new Map<string, number>();
  const articulations = new Set<string>();
  let time = 0;

  const visit = (nodeId: string, parent: string | null): void => {
    visited.add(nodeId);
    discovery.set(nodeId, time);
    low.set(nodeId, time);
    time += 1;
    let childCount = 0;
    for (const next of adjacency.get(nodeId) ?? []) {
      if (next.nodeId === parent) continue;
      if (!visited.has(next.nodeId)) {
        childCount += 1;
        visit(next.nodeId, nodeId);
        low.set(nodeId, Math.min(low.get(nodeId)!, low.get(next.nodeId)!));
        if (parent !== null && low.get(next.nodeId)! >= discovery.get(nodeId)!) articulations.add(nodeId);
      } else {
        low.set(nodeId, Math.min(low.get(nodeId)!, discovery.get(next.nodeId)!));
      }
    }
    if (parent === null && childCount > 1) articulations.add(nodeId);
  };

  for (const nodeId of Array.from(nodes)) {
    if (!visited.has(nodeId)) visit(nodeId, null);
  }
  return articulations;
}

function shortestNaturalPathToAny(
  adjacency: Map<string, { nodeId: string; edge: EnrichedEdge }[]>,
  startNodeId: string,
  targets: Set<string>,
): { nodeId: string; distanceKm: number } | null {
  if (targets.has(startNodeId)) return { nodeId: startNodeId, distanceKm: 0 };
  const distances = new Map<string, number>([[startNodeId, 0]]);
  const visited = new Set<string>();
  while (visited.size < distances.size) {
    let current: string | null = null;
    let best = Number.POSITIVE_INFINITY;
    for (const [nodeId, distance] of Array.from(distances.entries())) {
      if (!visited.has(nodeId) && distance < best) {
        current = nodeId;
        best = distance;
      }
    }
    if (!current) break;
    if (targets.has(current)) return { nodeId: current, distanceKm: distances.get(current)! };
    visited.add(current);
    for (const next of adjacency.get(current) ?? []) {
      if (visited.has(next.nodeId)) continue;
      const nextDistance = distances.get(current)! + Math.max(0, next.edge.lengthKm);
      const previous = distances.get(next.nodeId);
      if (previous === undefined || nextDistance + EPSILON < previous) distances.set(next.nodeId, nextDistance);
    }
  }
  return null;
}

function largestTwoCoreSkeletonKm(edges: EnrichedEdge[], twoCoreNodeIds: Set<string>): number {
  const coreEdges = edges.filter((edge) => twoCoreNodeIds.has(edge.from) && twoCoreNodeIds.has(edge.to));
  const adjacency = componentAdjacencyMap(coreEdges);
  const visitedEdges = new Set<string>();
  let best = 0;
  for (const edge of coreEdges) {
    if (visitedEdges.has(edge.id)) continue;
    const stack = [edge.from, edge.to];
    const edgeIds = new Set<string>();
    while (stack.length > 0) {
      const nodeId = stack.pop();
      if (!nodeId) continue;
      for (const next of adjacency.get(nodeId) ?? []) {
        if (edgeIds.has(next.edge.id)) continue;
        edgeIds.add(next.edge.id);
        visitedEdges.add(next.edge.id);
        stack.push(next.nodeId);
      }
    }
    best = Math.max(best, sumLengths(coreEdges.filter((candidate) => edgeIds.has(candidate.id))));
  }
  return best;
}

function sumLengths(edges: EnrichedEdge[]): number {
  return edges.reduce((sum, edge) => sum + Math.max(0, edge.lengthKm), 0);
}

function push<K, V>(map: Map<K, V[]>, key: K, value: V): void {
  const values = map.get(key);
  if (values) values.push(value);
  else map.set(key, [value]);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
