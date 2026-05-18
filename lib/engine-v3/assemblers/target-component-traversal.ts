import type { EnrichedEdge, EnrichedGraph } from '../../types';
import type { RouteSurfaceV3, TerrainComponentKindV3 } from '../types';

const PAVED_SURFACES = new Set(['asphalt', 'concrete', 'paved', 'paving_stones', 'sett', 'cobblestone', 'compacted']);
const NATURAL_SURFACES = new Set(['dirt', 'earth', 'grass', 'ground', 'gravel', 'mud', 'sand', 'soil', 'unpaved', 'woodchips']);
const ROAD_LIKE_HIGHWAYS = new Set(['secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);
const PATH_LIKE_HIGHWAYS = new Set(['path', 'track', 'footway', 'bridleway', 'pedestrian']);

interface DirectedTraversalEdgeV3 {
  edge: EnrichedEdge;
  from: string;
  to: string;
  kind: TerrainComponentKindV3;
  surface: RouteSurfaceV3;
}

export interface TargetComponentTraversalInputV3 {
  graph: EnrichedGraph;
  startNodeId: string;
  entryNodeId: string;
  targetComponentIds: TerrainComponentKindV3[];
  targetDistanceKm: number;
  minDistanceRatio?: number;
  maxDistanceRatio?: number;
  usedEdgeKeys?: Set<string>;
  forbidTargetRepeat?: boolean;
}

export interface TargetComponentTraversalSuccessV3 {
  status: 'success';
  edgeIds: string[];
  nodeIds: string[];
  distanceKm: number;
  targetKm: number;
  repeatedTargetKm: number;
  closure: {
    edgeIds: string[];
    distanceKm: number;
    connectorRepeatKm: number;
    targetRepeatKm: number;
  };
  diagnostics: TargetComponentTraversalDiagnosticsV3;
}

export interface TargetComponentTraversalFailureV3 {
  status: 'failure';
  diagnostics: TargetComponentTraversalDiagnosticsV3;
}

export interface TargetComponentTraversalDiagnosticsV3 {
  reachableTargetKm: number;
  exploitableTargetKm: number;
  unusedTargetKm: number;
  targetDistanceKm: number;
  closureDistanceKm: number;
  minDistanceKm: number;
  maxDistanceKm: number;
  blocker: 'no_reachable_target_component' | 'branch_repeat_limited' | 'insufficient_clean_capacity' | 'no_clean_closure';
  bestPartialDistanceKm: number;
}

export type TargetComponentTraversalResultV3 = TargetComponentTraversalSuccessV3 | TargetComponentTraversalFailureV3;

export function buildTargetComponentTraversal(input: TargetComponentTraversalInputV3): TargetComponentTraversalResultV3 {
  const minDistanceRatio = input.minDistanceRatio ?? 0.7;
  const maxDistanceRatio = input.maxDistanceRatio ?? 1.25;
  const minDistanceKm = input.targetDistanceKm * minDistanceRatio;
  const maxDistanceKm = input.targetDistanceKm * maxDistanceRatio;
  const usedEdgeKeys = input.usedEdgeKeys ?? new Set<string>();
  const adjacency = buildAdjacency(input.graph);
  const targetComponents = new Set(input.targetComponentIds);
  const targetEdges = uniqueUndirectedTargetEdges(adjacency, targetComponents);
  const reachableComponent = reachableTargetComponent(input.entryNodeId, adjacency, targetComponents);

  if (reachableComponent.edgeIds.size === 0) {
    return {
      status: 'failure',
      diagnostics: {
        reachableTargetKm: 0,
        exploitableTargetKm: 0,
        unusedTargetKm: 0,
        targetDistanceKm: 0,
        closureDistanceKm: 0,
        minDistanceKm: round(minDistanceKm),
        maxDistanceKm: round(maxDistanceKm),
        blocker: 'no_reachable_target_component',
        bestPartialDistanceKm: 0,
      },
    };
  }

  const reachableTargetKm = sumEdgeLengths(reachableComponent.edgeIds, targetEdges);
  const bridges = findTargetBridges(reachableComponent.nodeIds, adjacency, targetComponents);
  const coreEdgeIds = new Set(
    Array.from(reachableComponent.edgeIds).filter((edgeId) => !bridges.has(edgeId)),
  );
  const pathToCore = shortestTargetPathToAnyEdge(input.entryNodeId, coreEdgeIds, adjacency, targetComponents);
  const entryToCoreEdgeIds = new Set(pathToCore.map((edge) => edge.edge.id));
  const coreStartNodeId = pathToCore.at(-1)?.to ?? input.entryNodeId;
  const reachableCoreEdgeIds = reachableCoreEdgesFrom(coreStartNodeId, coreEdgeIds, adjacency, targetComponents);
  const exploitableEdgeIds = new Set([...Array.from(reachableCoreEdgeIds), ...Array.from(entryToCoreEdgeIds)]);
  const exploitableTargetKm = sumEdgeLengths(exploitableEdgeIds, targetEdges);

  const targetTraversal = buildCleanTargetWalk(input.entryNodeId, pathToCore, reachableCoreEdgeIds, adjacency, targetComponents);
  const targetDistanceKm = sumDirectedLengths(targetTraversal);
  const repeatedTargetKm = repeatedKm(targetTraversal.filter((edge) => targetComponents.has(edge.kind)));
  const targetEndpoint = targetTraversal.at(-1)?.to ?? input.entryNodeId;
  const closure = shortestConnectorClosure(targetEndpoint, input.startNodeId, adjacency, targetComponents, new Set(targetTraversal.map((edge) => edge.edge.id)), usedEdgeKeys, maxDistanceKm - targetDistanceKm);
  const closureDistanceKm = sumDirectedLengths(closure);
  const totalDistanceKm = targetDistanceKm + sumDirectedLengths(closure);
  const fallbackPartialDistanceKm = targetTraversal.length > 0
    ? totalDistanceKm
    : longestCleanTargetPathKm(input.entryNodeId, adjacency, targetComponents, Math.min(96, reachableComponent.edgeIds.size));
  const bestPartialDistanceKm = round(fallbackPartialDistanceKm);
  const blocker = exploitableTargetKm + 0.001 < reachableTargetKm && exploitableTargetKm < minDistanceKm
    ? 'branch_repeat_limited'
    : closure.length === 0
      ? 'no_clean_closure'
      : 'insufficient_clean_capacity';
  const diagnostics: TargetComponentTraversalDiagnosticsV3 = {
    reachableTargetKm: round(reachableTargetKm),
    exploitableTargetKm: round(exploitableTargetKm),
    unusedTargetKm: round(Math.max(0, reachableTargetKm - targetDistanceKm)),
    targetDistanceKm: round(targetDistanceKm),
    closureDistanceKm: round(closureDistanceKm),
    minDistanceKm: round(minDistanceKm),
    maxDistanceKm: round(maxDistanceKm),
    blocker,
    bestPartialDistanceKm,
  };

  if (
    targetTraversal.length === 0 ||
    repeatedTargetKm > 0 ||
    closure.length === 0 ||
    totalDistanceKm + 0.001 < minDistanceKm ||
    totalDistanceKm > maxDistanceKm + 0.001
  ) {
    return { status: 'failure', diagnostics };
  }

  const traversal = [...targetTraversal, ...closure];
  return {
    status: 'success',
    edgeIds: traversal.map((edge) => edge.edge.id),
    nodeIds: nodesFromTraversal(input.entryNodeId, traversal),
    distanceKm: round(totalDistanceKm),
    targetKm: round(targetDistanceKm),
    repeatedTargetKm: round(repeatedTargetKm),
    closure: {
      edgeIds: closure.map((edge) => edge.edge.id),
      distanceKm: round(sumDirectedLengths(closure)),
      connectorRepeatKm: round(closure.filter((edge) => !targetComponents.has(edge.kind) && usedEdgeKeys.has(edge.edge.id)).reduce((sum, edge) => sum + edgeLength(edge), 0)),
      targetRepeatKm: round(closure.filter((edge) => targetComponents.has(edge.kind)).reduce((sum, edge) => sum + edgeLength(edge), 0)),
    },
    diagnostics,
  };
}

function buildCleanTargetWalk(
  entryNodeId: string,
  pathToCore: DirectedTraversalEdgeV3[],
  coreEdgeIds: Set<string>,
  adjacency: Map<string, DirectedTraversalEdgeV3[]>,
  targetComponents: Set<TerrainComponentKindV3>,
): DirectedTraversalEdgeV3[] {
  if (coreEdgeIds.size === 0) return [];
  const traversal = [...pathToCore];
  const used = new Set(pathToCore.map((edge) => edge.edge.id));
  let current = traversal.at(-1)?.to ?? entryNodeId;
  const coreStart = current;

  while (usedCoreCount(used, coreEdgeIds) < coreEdgeIds.size) {
    const next = (adjacency.get(current) ?? [])
      .filter((edge) => coreEdgeIds.has(edge.edge.id) && !used.has(edge.edge.id) && targetComponents.has(edge.kind))
      .sort((a, b) => edgeLength(b) - edgeLength(a))[0];
    if (next) {
      traversal.push(next);
      used.add(next.edge.id);
      current = next.to;
      continue;
    }

    const bridge = shortestPathToUnusedCoreEdge(current, used, coreEdgeIds, adjacency, targetComponents);
    if (bridge.length === 0) break;
    for (const edge of bridge) {
      traversal.push(edge);
      used.add(edge.edge.id);
      current = edge.to;
    }
  }

  if (current !== coreStart) {
    const closeCore = shortestPath(current, coreStart, adjacency, (edge) => coreEdgeIds.has(edge.edge.id) && !used.has(edge.edge.id) && targetComponents.has(edge.kind));
    for (const edge of closeCore) {
      traversal.push(edge);
      used.add(edge.edge.id);
    }
  }

  return traversal;
}

function reachableCoreEdgesFrom(
  startNodeId: string,
  coreEdgeIds: Set<string>,
  adjacency: Map<string, DirectedTraversalEdgeV3[]>,
  targetComponents: Set<TerrainComponentKindV3>,
): Set<string> {
  const reachableEdgeIds = new Set<string>();
  const seenNodeIds = new Set<string>();
  const pending = [startNodeId];

  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || seenNodeIds.has(current)) continue;
    seenNodeIds.add(current);

    for (const edge of adjacency.get(current) ?? []) {
      if (!coreEdgeIds.has(edge.edge.id) || !targetComponents.has(edge.kind)) continue;
      reachableEdgeIds.add(edge.edge.id);
      if (!seenNodeIds.has(edge.to)) pending.push(edge.to);
    }
  }

  return reachableEdgeIds;
}

function shortestPathToUnusedCoreEdge(
  startNodeId: string,
  used: Set<string>,
  coreEdgeIds: Set<string>,
  adjacency: Map<string, DirectedTraversalEdgeV3[]>,
  targetComponents: Set<TerrainComponentKindV3>,
): DirectedTraversalEdgeV3[] {
  const distances = new Map<string, number>([[startNodeId, 0]]);
  const pending: Array<{ nodeId: string; distanceKm: number; traversal: DirectedTraversalEdgeV3[] }> = [
    { nodeId: startNodeId, distanceKm: 0, traversal: [] },
  ];
  while (pending.length > 0) {
    const current = pending.sort((a, b) => a.distanceKm - b.distanceKm).shift();
    if (!current) break;
    for (const edge of adjacency.get(current.nodeId) ?? []) {
      if (!coreEdgeIds.has(edge.edge.id) || used.has(edge.edge.id) || !targetComponents.has(edge.kind)) continue;
      return [...current.traversal, edge];
    }
    for (const edge of adjacency.get(current.nodeId) ?? []) {
      if (!coreEdgeIds.has(edge.edge.id) || used.has(edge.edge.id) || !targetComponents.has(edge.kind)) continue;
      const nextDistanceKm = current.distanceKm + edgeLength(edge);
      if (nextDistanceKm + 0.000001 >= (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      distances.set(edge.to, nextDistanceKm);
      pending.push({ nodeId: edge.to, distanceKm: nextDistanceKm, traversal: [...current.traversal, edge] });
    }
  }
  return [];
}

function shortestConnectorClosure(
  fromNodeId: string,
  startNodeId: string,
  adjacency: Map<string, DirectedTraversalEdgeV3[]>,
  targetComponents: Set<TerrainComponentKindV3>,
  usedTargetEdgeIds: Set<string>,
  usedConnectorEdgeIds: Set<string>,
  maxDistanceKm: number,
): DirectedTraversalEdgeV3[] {
  const cleanConnectorClosure = shortestPath(fromNodeId, startNodeId, adjacency, (edge, traversal) => {
    if (sumDirectedLengths(traversal) + edgeLength(edge) > maxDistanceKm + 0.001) return false;
    if (targetComponents.has(edge.kind)) return !usedTargetEdgeIds.has(edge.edge.id);
    return !usedConnectorEdgeIds.has(edge.edge.id);
  });
  if (cleanConnectorClosure.length > 0) return cleanConnectorClosure;

  return shortestPath(fromNodeId, startNodeId, adjacency, (edge, traversal) => {
    if (sumDirectedLengths(traversal) + edgeLength(edge) > maxDistanceKm + 0.001) return false;
    if (targetComponents.has(edge.kind)) return !usedTargetEdgeIds.has(edge.edge.id);
    if (usedConnectorEdgeIds.has(edge.edge.id)) return edge.to === startNodeId;
    return true;
  });
}

function shortestPath(
  fromNodeId: string,
  toNodeId: string,
  adjacency: Map<string, DirectedTraversalEdgeV3[]>,
  allowed: (edge: DirectedTraversalEdgeV3, traversal: DirectedTraversalEdgeV3[]) => boolean,
): DirectedTraversalEdgeV3[] {
  const bestDistances = new Map<string, number>([[fromNodeId, 0]]);
  const pending: Array<{ nodeId: string; distanceKm: number; traversal: DirectedTraversalEdgeV3[] }> = [
    { nodeId: fromNodeId, distanceKm: 0, traversal: [] },
  ];
  while (pending.length > 0) {
    const current = pending.sort((a, b) => a.distanceKm - b.distanceKm).shift();
    if (!current) break;
    if (current.nodeId === toNodeId && current.traversal.length > 0) return current.traversal;
    if (current.distanceKm > (bestDistances.get(current.nodeId) ?? Number.POSITIVE_INFINITY) + 0.000001) continue;
    for (const edge of adjacency.get(current.nodeId) ?? []) {
      if (!allowed(edge, current.traversal)) continue;
      const nextDistanceKm = current.distanceKm + edgeLength(edge);
      if (nextDistanceKm + 0.000001 >= (bestDistances.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      bestDistances.set(edge.to, nextDistanceKm);
      pending.push({ nodeId: edge.to, distanceKm: nextDistanceKm, traversal: [...current.traversal, edge] });
    }
  }
  return [];
}

function reachableTargetComponent(
  entryNodeId: string,
  adjacency: Map<string, DirectedTraversalEdgeV3[]>,
  targetComponents: Set<TerrainComponentKindV3>,
): { nodeIds: Set<string>; edgeIds: Set<string> } {
  const nodeIds = new Set<string>();
  const edgeIds = new Set<string>();
  const pending = [entryNodeId];
  while (pending.length > 0) {
    const current = pending.shift();
    if (!current || nodeIds.has(current)) continue;
    nodeIds.add(current);
    for (const edge of adjacency.get(current) ?? []) {
      if (!targetComponents.has(edge.kind) || edge.surface === 'paved') continue;
      edgeIds.add(edge.edge.id);
      if (!nodeIds.has(edge.to)) pending.push(edge.to);
    }
  }
  return { nodeIds, edgeIds };
}

function shortestTargetPathToAnyEdge(
  entryNodeId: string,
  targetEdgeIds: Set<string>,
  adjacency: Map<string, DirectedTraversalEdgeV3[]>,
  targetComponents: Set<TerrainComponentKindV3>,
): DirectedTraversalEdgeV3[] {
  if (targetEdgeIds.size === 0) return [];
  const bestDistances = new Map<string, number>([[entryNodeId, 0]]);
  const pending: Array<{ nodeId: string; distanceKm: number; traversal: DirectedTraversalEdgeV3[] }> = [
    { nodeId: entryNodeId, distanceKm: 0, traversal: [] },
  ];
  while (pending.length > 0) {
    const current = pending.sort((a, b) => a.distanceKm - b.distanceKm).shift();
    if (!current) break;
    if ((adjacency.get(current.nodeId) ?? []).some((edge) => targetEdgeIds.has(edge.edge.id))) return current.traversal;
    if (current.distanceKm > (bestDistances.get(current.nodeId) ?? Number.POSITIVE_INFINITY) + 0.000001) continue;
    for (const edge of adjacency.get(current.nodeId) ?? []) {
      if (!targetComponents.has(edge.kind) || edge.surface === 'paved' || targetEdgeIds.has(edge.edge.id)) continue;
      const nextDistanceKm = current.distanceKm + edgeLength(edge);
      if (nextDistanceKm + 0.000001 >= (bestDistances.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      bestDistances.set(edge.to, nextDistanceKm);
      pending.push({ nodeId: edge.to, distanceKm: nextDistanceKm, traversal: [...current.traversal, edge] });
    }
  }
  return [];
}

function longestCleanTargetPathKm(
  entryNodeId: string,
  adjacency: Map<string, DirectedTraversalEdgeV3[]>,
  targetComponents: Set<TerrainComponentKindV3>,
  maxSteps: number,
): number {
  let best = 0;
  const stack: Array<{ nodeId: string; distanceKm: number; usedEdgeIds: Set<string> }> = [
    { nodeId: entryNodeId, distanceKm: 0, usedEdgeIds: new Set() },
  ];
  while (stack.length > 0) {
    const current = stack.pop();
    if (!current) break;
    best = Math.max(best, current.distanceKm);
    if (current.usedEdgeIds.size >= maxSteps) continue;
    for (const edge of adjacency.get(current.nodeId) ?? []) {
      if (!targetComponents.has(edge.kind) || edge.surface === 'paved' || current.usedEdgeIds.has(edge.edge.id)) continue;
      const usedEdgeIds = new Set(current.usedEdgeIds);
      usedEdgeIds.add(edge.edge.id);
      stack.push({ nodeId: edge.to, distanceKm: current.distanceKm + edgeLength(edge), usedEdgeIds });
    }
  }
  return best;
}

function findTargetBridges(
  componentNodeIds: Set<string>,
  adjacency: Map<string, DirectedTraversalEdgeV3[]>,
  targetComponents: Set<TerrainComponentKindV3>,
): Set<string> {
  const discovery = new Map<string, number>();
  const low = new Map<string, number>();
  const bridges = new Set<string>();
  let time = 0;

  const visit = (nodeId: string, parentEdgeId: string | null): void => {
    discovery.set(nodeId, time);
    low.set(nodeId, time);
    time += 1;

    for (const edge of adjacency.get(nodeId) ?? []) {
      if (!componentNodeIds.has(edge.to) || !targetComponents.has(edge.kind) || edge.surface === 'paved') continue;
      if (edge.edge.id === parentEdgeId) continue;
      if (!discovery.has(edge.to)) {
        visit(edge.to, edge.edge.id);
        low.set(nodeId, Math.min(low.get(nodeId) ?? 0, low.get(edge.to) ?? 0));
        if ((low.get(edge.to) ?? 0) > (discovery.get(nodeId) ?? 0)) bridges.add(edge.edge.id);
      } else {
        low.set(nodeId, Math.min(low.get(nodeId) ?? 0, discovery.get(edge.to) ?? 0));
      }
    }
  };

  for (const nodeId of Array.from(componentNodeIds)) {
    if (!discovery.has(nodeId)) visit(nodeId, null);
  }
  return bridges;
}

function uniqueUndirectedTargetEdges(
  adjacency: Map<string, DirectedTraversalEdgeV3[]>,
  targetComponents: Set<TerrainComponentKindV3>,
): Map<string, DirectedTraversalEdgeV3> {
  const edges = new Map<string, DirectedTraversalEdgeV3>();
  for (const candidates of Array.from(adjacency.values())) {
    for (const edge of candidates) {
      if (targetComponents.has(edge.kind) && edge.surface !== 'paved') edges.set(edge.edge.id, edge);
    }
  }
  return edges;
}

function sumEdgeLengths(edgeIds: Set<string>, edges: Map<string, DirectedTraversalEdgeV3>): number {
  let total = 0;
  for (const edgeId of Array.from(edgeIds)) total += edgeLength(edges.get(edgeId));
  return total;
}

function sumDirectedLengths(edges: DirectedTraversalEdgeV3[]): number {
  return edges.reduce((sum, edge) => sum + edgeLength(edge), 0);
}

function edgeLength(edge: DirectedTraversalEdgeV3 | undefined): number {
  return Math.max(0, edge?.edge.lengthKm ?? 0);
}

function repeatedKm(edges: DirectedTraversalEdgeV3[]): number {
  const seenPairs = new Set<string>();
  let repeated = 0;
  for (const edge of edges) {
    const key = edge.from < edge.to ? `${edge.from}::${edge.to}` : `${edge.to}::${edge.from}`;
    if (seenPairs.has(key)) repeated += edgeLength(edge);
    seenPairs.add(key);
  }
  return repeated;
}

function usedCoreCount(used: Set<string>, coreEdgeIds: Set<string>): number {
  let count = 0;
  for (const edgeId of Array.from(coreEdgeIds)) if (used.has(edgeId)) count += 1;
  return count;
}

function nodesFromTraversal(startNodeId: string, traversal: DirectedTraversalEdgeV3[]): string[] {
  return traversal.reduce<string[]>((nodeIds, edge) => [...nodeIds, edge.to], [startNodeId]);
}

function buildAdjacency(graph: EnrichedGraph): Map<string, DirectedTraversalEdgeV3[]> {
  const adjacency = new Map<string, DirectedTraversalEdgeV3[]>();
  for (const edge of Array.from(graph.edges.values())) {
    const surface = classifySurface(edge);
    const kind = classifyComponentKind(edge, surface);
    pushAdjacency(adjacency, edge.from, { edge, from: edge.from, to: edge.to, kind, surface });
    pushAdjacency(adjacency, edge.to, { edge, from: edge.to, to: edge.from, kind, surface });
  }
  return adjacency;
}

function pushAdjacency(adjacency: Map<string, DirectedTraversalEdgeV3[]>, nodeId: string, edge: DirectedTraversalEdgeV3): void {
  const edges = adjacency.get(nodeId) ?? [];
  edges.push(edge);
  adjacency.set(nodeId, edges);
}

function classifySurface(edge: EnrichedEdge): RouteSurfaceV3 {
  const surface = edge.surface?.toLowerCase();
  if (surface && PAVED_SURFACES.has(surface)) return 'paved';
  if (surface && NATURAL_SURFACES.has(surface)) return 'natural';
  return 'mixed';
}

function classifyComponentKind(edge: EnrichedEdge, surface: RouteSurfaceV3): TerrainComponentKindV3 {
  const landcover = edge.terrainContext?.landcoverClass;
  const highway = edge.highway.toLowerCase();

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
  return Math.round(value * 1000) / 1000;
}
