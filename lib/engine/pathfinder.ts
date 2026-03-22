import type { EnrichedGraph } from "../types";
import { haversineKm } from "./utils";

interface PathResult {
  distanceKm: number;
  nodeIds: string[];
  edgeIds: string[];
}

/**
 * Min-heap (binary heap) priority queue for A* pathfinding.
 * Stores [priority, nodeId] pairs sorted by ascending priority.
 */
class MinHeap {
  private data: [number, string][] = [];

  get size(): number {
    return this.data.length;
  }

  push(priority: number, value: string): void {
    this.data.push([priority, value]);
    this.bubbleUp(this.data.length - 1);
  }

  pop(): [number, string] | undefined {
    if (this.data.length === 0) return undefined;
    const top = this.data[0];
    const last = this.data.pop()!;
    if (this.data.length > 0) {
      this.data[0] = last;
      this.sinkDown(0);
    }
    return top;
  }

  private bubbleUp(i: number): void {
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.data[parent][0] <= this.data[i][0]) break;
      [this.data[parent], this.data[i]] = [this.data[i], this.data[parent]];
      i = parent;
    }
  }

  private sinkDown(i: number): void {
    const n = this.data.length;
    while (true) {
      let smallest = i;
      const left = 2 * i + 1;
      const right = 2 * i + 2;
      if (left < n && this.data[left][0] < this.data[smallest][0]) smallest = left;
      if (right < n && this.data[right][0] < this.data[smallest][0]) smallest = right;
      if (smallest === i) break;
      [this.data[smallest], this.data[i]] = [this.data[i], this.data[smallest]];
      i = smallest;
    }
  }
}

/**
 * A* pathfinder on EnrichedGraph with haversine as admissible heuristic.
 * Returns the shortest path (by distance) between two nodes.
 */
export function findShortestPath(
  graph: EnrichedGraph,
  fromNodeId: string,
  toNodeId: string
): PathResult | null {
  const toNode = graph.nodes.get(toNodeId);
  if (!toNode) return null;

  const toCoord = { lat: toNode.lat, lng: toNode.lng };

  const gScore = new Map<string, number>();
  const cameFrom = new Map<string, { nodeId: string; edgeId: string }>();
  const openSet = new MinHeap();

  gScore.set(fromNodeId, 0);
  const fromNode = graph.nodes.get(fromNodeId);
  if (!fromNode) return null;

  const hStart = haversineKm({ lat: fromNode.lat, lng: fromNode.lng }, toCoord);
  openSet.push(hStart, fromNodeId);

  const closedSet = new Set<string>();
  const maxNodes = graph.nodes.size;

  while (openSet.size > 0) {
    const [, currentId] = openSet.pop()!;

    if (closedSet.has(currentId)) continue;
    closedSet.add(currentId);

    if (currentId === toNodeId) {
      // Reconstruct path with iteration guard
      const nodeIds: string[] = [toNodeId];
      const edgeIds: string[] = [];
      let cur = toNodeId;
      let steps = 0;
      while (cameFrom.has(cur)) {
        if (++steps > maxNodes) return null; // corrupted cameFrom — abort
        const prev = cameFrom.get(cur)!;
        nodeIds.push(prev.nodeId);
        edgeIds.push(prev.edgeId);
        cur = prev.nodeId;
      }
      nodeIds.reverse();
      edgeIds.reverse();
      return {
        distanceKm: gScore.get(toNodeId)!,
        nodeIds,
        edgeIds,
      };
    }

    const currentNode = graph.nodes.get(currentId);
    if (!currentNode) continue;

    const currentG = gScore.get(currentId) ?? Infinity;

    for (const edgeId of currentNode.edges) {
      const edge = graph.edges.get(edgeId);
      if (!edge) continue;

      const neighborId = edge.to === currentId ? edge.from : edge.to;
      if (closedSet.has(neighborId)) continue;
      // Only follow edges in the correct direction (from → to)
      // But graph edges may be bidirectional stored as separate edges
      if (edge.from !== currentId && edge.to !== currentId) continue;

      const tentativeG = currentG + edge.lengthKm;
      const existingG = gScore.get(neighborId) ?? Infinity;

      if (tentativeG < existingG) {
        gScore.set(neighborId, tentativeG);
        cameFrom.set(neighborId, { nodeId: currentId, edgeId });

        const neighborNode = graph.nodes.get(neighborId);
        if (neighborNode) {
          const h = haversineKm({ lat: neighborNode.lat, lng: neighborNode.lng }, toCoord);
          openSet.push(tentativeG + h, neighborId);
        }
      }
    }
  }

  return null; // No path found
}

/**
 * Cached return-distance lookup.
 * Many beam states share the same current node, so caching avoids redundant A* runs.
 */
export class ReturnDistanceCache {
  private cache = new Map<string, number | null>();
  private pathCache = new Map<string, PathResult | null>();

  getDistance(graph: EnrichedGraph, fromNodeId: string, toNodeId: string): number | null {
    const key = `${fromNodeId}→${toNodeId}`;
    if (this.cache.has(key)) return this.cache.get(key)!;

    const result = findShortestPath(graph, fromNodeId, toNodeId);
    const dist = result?.distanceKm ?? null;
    this.cache.set(key, dist);
    if (result) this.pathCache.set(key, result);
    return dist;
  }

  getPath(graph: EnrichedGraph, fromNodeId: string, toNodeId: string): PathResult | null {
    const key = `${fromNodeId}→${toNodeId}`;
    if (this.pathCache.has(key)) return this.pathCache.get(key)!;

    const result = findShortestPath(graph, fromNodeId, toNodeId);
    this.cache.set(key, result?.distanceKm ?? null);
    this.pathCache.set(key, result ?? null);
    return result;
  }
}
