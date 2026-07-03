import type { RouteEdgeV3 } from './types';

export interface RouteTopologyMetrics {
  uniqueUndirectedDistanceKm: number;
  repeatedTraversalKm: number;
  repeatedTraversalRatio: number;
  graphCyclomaticNumber: number;
  leafCount: number;
  branchNodeCount: number;
  cycleDistanceKm: number;
  outAndBackDominance: number;
}

export interface ComputeRouteTopologyMetricsInput {
  edges: RouteEdgeV3[];
  nodeIds?: string[];
  targetDistanceKm: number;
}

export function createEmptyRouteTopologyMetrics(): RouteTopologyMetrics {
  return {
    uniqueUndirectedDistanceKm: 0,
    repeatedTraversalKm: 0,
    repeatedTraversalRatio: 0,
    graphCyclomaticNumber: 0,
    leafCount: 0,
    branchNodeCount: 0,
    cycleDistanceKm: 0,
    outAndBackDominance: 0,
  };
}

export function computeRouteTopologyMetrics(input: ComputeRouteTopologyMetricsInput): RouteTopologyMetrics {
  if (input.edges.length === 0) return createEmptyRouteTopologyMetrics();

  const totalKm = input.edges.reduce((sum, edge) => sum + Math.max(0, edge.lengthKm), 0);
  if (totalKm <= 0) return createEmptyRouteTopologyMetrics();

  const undirectedKey = (edge: RouteEdgeV3): string | null => {
    if (!edge.from || !edge.to) return null;
    const wayKey = edge.osmWayId ?? edge.id;
    if (wayKey == null) return null;
    const [a, b] = [edge.from, edge.to].sort();
    return `${a}|${b}|${wayKey}`;
  };

  const keyToLength = new Map<string, number>();
  const keyToCount = new Map<string, number>();
  const nodeAdjacency = new Map<string, Set<string>>();
  const traversalNodes = new Set<string>();

  for (const edge of input.edges) {
    const key = undirectedKey(edge);
    if (key == null) continue;
    const lengthKm = Math.max(0, edge.lengthKm);
    if (!keyToLength.has(key)) keyToLength.set(key, lengthKm);
    keyToCount.set(key, (keyToCount.get(key) ?? 0) + 1);
    if (!traversalNodes.has(edge.from)) traversalNodes.add(edge.from);
    if (!traversalNodes.has(edge.to)) traversalNodes.add(edge.to);
    const aNeighbors = nodeAdjacency.get(edge.from) ?? new Set<string>();
    aNeighbors.add(key);
    nodeAdjacency.set(edge.from, aNeighbors);
    const bNeighbors = nodeAdjacency.get(edge.to) ?? new Set<string>();
    bNeighbors.add(key);
    nodeAdjacency.set(edge.to, bNeighbors);
  }

  if (keyToLength.size === 0) return createEmptyRouteTopologyMetrics();

  let uniqueUndirectedDistanceKm = 0;
  for (const lengthKm of keyToLength.values()) uniqueUndirectedDistanceKm += lengthKm;
  const repeatedTraversalKm = Math.max(0, totalKm - uniqueUndirectedDistanceKm);
  const repeatedTraversalRatio = round(repeatedTraversalKm / totalKm);

  const components = findConnectedComponents(traversalNodes, nodeAdjacency);
  let graphCyclomaticNumber = 0;
  for (const component of components) {
    const componentEdgeKeys = new Set<string>();
    for (const node of component) {
      for (const key of nodeAdjacency.get(node) ?? new Set<string>()) componentEdgeKeys.add(key);
    }
    const e = componentEdgeKeys.size;
    const v = component.length;
    const cycles = e - v + 1;
    if (cycles > 0) graphCyclomaticNumber += cycles;
  }

  let leafCount = 0;
  let branchNodeCount = 0;
  for (const node of traversalNodes) {
    const degree = (nodeAdjacency.get(node) ?? new Set<string>()).size;
    if (degree === 1) leafCount += 1;
    if (degree >= 3) branchNodeCount += 1;
  }

  const bridgeKeys = findBridgeKeys(components, nodeAdjacency);
  let cycleDistanceKm = 0;
  for (const [key, lengthKm] of keyToLength) {
    if (!bridgeKeys.has(key)) cycleDistanceKm += lengthKm;
  }
  cycleDistanceKm = round(cycleDistanceKm);

  let reversedEdgeCount = 0;
  for (const count of keyToCount.values()) {
    if (count > 1) reversedEdgeCount += count - 1;
  }
  const totalIncidentEdgeCount = keyToCount.size + reversedEdgeCount;
  const outAndBackDominance = totalIncidentEdgeCount > 0
    ? round(reversedEdgeCount / totalIncidentEdgeCount)
    : 0;

  return {
    uniqueUndirectedDistanceKm: round(uniqueUndirectedDistanceKm),
    repeatedTraversalKm: round(repeatedTraversalKm),
    repeatedTraversalRatio,
    graphCyclomaticNumber,
    leafCount,
    branchNodeCount,
    cycleDistanceKm,
    outAndBackDominance,
  };
}

function findConnectedComponents(nodes: Set<string>, adjacency: Map<string, Set<string>>): string[][] {
  const visited = new Set<string>();
  const components: string[][] = [];
  for (const start of nodes) {
    if (visited.has(start)) continue;
    const component: string[] = [];
    const stack: string[] = [start];
    while (stack.length > 0) {
      const node = stack.pop()!;
      if (visited.has(node)) continue;
      visited.add(node);
      component.push(node);
      for (const neighbour of adjacency.get(node) ?? new Set<string>()) {
        for (const candidate of neighbourEndpoints(node, neighbour, adjacency)) {
          if (!visited.has(candidate)) stack.push(candidate);
        }
      }
    }
    if (component.length > 0) components.push(component);
  }
  return components;
}

function neighbourEndpoints(node: string, key: string, adjacency: Map<string, Set<string>>): string[] {
  const endpoints: string[] = [];
  for (const [endpoint, keys] of adjacency) {
    if (endpoint === node) continue;
    if (keys.has(key)) endpoints.push(endpoint);
  }
  return endpoints;
}

function findBridgeKeys(components: string[][], adjacency: Map<string, Set<string>>): Set<string> {
  const bridges = new Set<string>();
  for (const component of components) {
    if (component.length < 2) continue;
    const componentNodeSet = new Set(component);
    const componentKeys = new Set<string>();
    for (const node of component) {
      for (const key of adjacency.get(node) ?? new Set<string>()) componentKeys.add(key);
    }
    for (const key of componentKeys) {
      if (isBridgeKey(key, component, componentNodeSet, adjacency)) bridges.add(key);
    }
  }
  return bridges;
}

function isBridgeKey(
  key: string,
  component: string[],
  componentNodeSet: Set<string>,
  adjacency: Map<string, Set<string>>,
): boolean {
  const [endA, endB] = endpointsOfKey(key, adjacency);
  if (!endA || !endB) return false;
  const visited = new Set<string>([endA]);
  const stack: string[] = [endA];
  while (stack.length > 0) {
    const node = stack.pop()!;
    if (node === endB && node !== endA) return false;
    for (const neighbourKey of adjacency.get(node) ?? new Set<string>()) {
      if (neighbourKey === key) continue;
      if (!componentKeysContainNode(neighbourKey, componentNodeSet, adjacency)) continue;
      const next = otherEndpoint(neighbourKey, node, adjacency);
      if (!next) continue;
      if (!visited.has(next)) {
        visited.add(next);
        stack.push(next);
      }
    }
  }
  void component;
  return true;
}

function endpointsOfKey(key: string, adjacency: Map<string, Set<string>>): [string | null, string | null] {
  const endpoints: string[] = [];
  for (const [node, keys] of adjacency) {
    if (keys.has(key)) {
      endpoints.push(node);
      if (endpoints.length === 2) break;
    }
  }
  return [endpoints[0] ?? null, endpoints[1] ?? null];
}

function componentKeysContainNode(key: string, componentNodeSet: Set<string>, adjacency: Map<string, Set<string>>): boolean {
  for (const [node, keys] of adjacency) {
    if (keys.has(key) && componentNodeSet.has(node)) return true;
  }
  return false;
}

function otherEndpoint(key: string, fromNode: string, adjacency: Map<string, Set<string>>): string | null {
  for (const [node, keys] of adjacency) {
    if (node === fromNode) continue;
    if (keys.has(key)) return node;
  }
  return null;
}

function round(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.round(value * 1000) / 1000;
}
