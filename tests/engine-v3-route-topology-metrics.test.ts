import { describe, expect, it } from 'vitest';

import { computeRouteTopologyMetrics, createEmptyRouteTopologyMetrics } from '../lib/engine-v3/route-topology-metrics';
import type { RouteEdgeV3 } from '../lib/engine-v3';

function edge(overrides: Partial<RouteEdgeV3> & Pick<RouteEdgeV3, 'id' | 'from' | 'to' | 'lengthKm'>): RouteEdgeV3 {
  return {
    highway: 'path',
    surface: 'natural',
    componentKind: 'forest',
    osmWayId: Number(overrides.id.replace(/\D/g, '')) || 1,
    ...overrides,
  } as RouteEdgeV3;
}

describe('engine V3 route topology metrics', () => {
  it('returns zeroed metrics for an empty traversal', () => {
    const result = computeRouteTopologyMetrics({ edges: [], targetDistanceKm: 5 });
    expect(result).toEqual(createEmptyRouteTopologyMetrics());
  });

  it('detects a simple closed loop as one cycle with no repeated edges and no leaves', () => {
    // Pentagon: A-B-C-D-E-A, each edge 1 km, all on the same OSM way id range
    const edges: RouteEdgeV3[] = [
      edge({ id: 'e1', from: 'A', to: 'B', lengthKm: 1, osmWayId: 1 }),
      edge({ id: 'e2', from: 'B', to: 'C', lengthKm: 1, osmWayId: 2 }),
      edge({ id: 'e3', from: 'C', to: 'D', lengthKm: 1, osmWayId: 3 }),
      edge({ id: 'e4', from: 'D', to: 'E', lengthKm: 1, osmWayId: 4 }),
      edge({ id: 'e5', from: 'E', to: 'A', lengthKm: 1, osmWayId: 5 }),
    ];

    const result = computeRouteTopologyMetrics({ edges, targetDistanceKm: 5 });

    expect(result.uniqueUndirectedDistanceKm).toBeCloseTo(5, 5);
    expect(result.repeatedTraversalKm).toBe(0);
    expect(result.repeatedTraversalRatio).toBe(0);
    expect(result.graphCyclomaticNumber).toBe(1);
    expect(result.cycleDistanceKm).toBeCloseTo(5, 5);
    expect(result.leafCount).toBe(0);
    expect(result.branchNodeCount).toBe(0);
    expect(result.outAndBackDominance).toBe(0);
  });

  it('flags a Y-tree with high repeat ratio, no cycle, leaves and a branch', () => {
    // Y-tree: branch A. Three arms: A->B, A->C, A->D, each walked both ways.
    // Start at A, walk to B, back to A, walk to C, back to A, walk to D, back to A.
    const edges: RouteEdgeV3[] = [
      edge({ id: 'e1', from: 'A', to: 'B', lengthKm: 1, osmWayId: 1 }),
      edge({ id: 'e2', from: 'B', to: 'A', lengthKm: 1, osmWayId: 1 }),
      edge({ id: 'e3', from: 'A', to: 'C', lengthKm: 1, osmWayId: 2 }),
      edge({ id: 'e4', from: 'C', to: 'A', lengthKm: 1, osmWayId: 2 }),
      edge({ id: 'e5', from: 'A', to: 'D', lengthKm: 1, osmWayId: 3 }),
      edge({ id: 'e6', from: 'D', to: 'A', lengthKm: 1, osmWayId: 3 }),
    ];

    const result = computeRouteTopologyMetrics({ edges, targetDistanceKm: 6 });

    // Unique undirected: A|B (1) + A|C (1) + A|D (1) = 3
    expect(result.uniqueUndirectedDistanceKm).toBeCloseTo(3, 5);
    // Total: 6
    expect(result.repeatedTraversalKm).toBeCloseTo(3, 5);
    expect(result.repeatedTraversalRatio).toBeCloseTo(0.5, 5);
    expect(result.graphCyclomaticNumber).toBe(0);
    expect(result.cycleDistanceKm).toBe(0);
    expect(result.leafCount).toBe(3);
    expect(result.branchNodeCount).toBe(1);
    // All 3 undirected edges traversed twice → 3 reversed / (3 + 3) = 0.5
    expect(result.outAndBackDominance).toBeCloseTo(0.5, 5);
  });

  it('detects a lollipop (stem + loop) as a single cycle with non-zero cycleDistanceKm', () => {
    // A->B->C, then C->D->E->C (loop), then E->A. Each edge 1 km.
    const edges: RouteEdgeV3[] = [
      edge({ id: 'e1', from: 'A', to: 'B', lengthKm: 1, osmWayId: 1 }),
      edge({ id: 'e2', from: 'B', to: 'C', lengthKm: 1, osmWayId: 2 }),
      edge({ id: 'e3', from: 'C', to: 'D', lengthKm: 1, osmWayId: 3 }),
      edge({ id: 'e4', from: 'D', to: 'E', lengthKm: 1, osmWayId: 4 }),
      edge({ id: 'e5', from: 'E', to: 'C', lengthKm: 1, osmWayId: 3 }),
      edge({ id: 'e6', from: 'C', to: 'B', lengthKm: 1, osmWayId: 2 }),
      edge({ id: 'e7', from: 'B', to: 'A', lengthKm: 1, osmWayId: 1 }),
    ];

    const result = computeRouteTopologyMetrics({ edges, targetDistanceKm: 7 });

    expect(result.graphCyclomaticNumber).toBe(1);
    expect(result.cycleDistanceKm).toBeGreaterThan(0);
    // Stem edges (A|B, B|C) are bridges and excluded; loop edges (C|D, D|E) form the cycle.
    // The cycle has 2 unique undirected edges (C|D = 1, D|E = 1), but the lollipop visits the
    // C|D segment twice (out and back), so cycleDistanceKm equals 2 km.
    expect(result.cycleDistanceKm).toBeGreaterThanOrEqual(2);
    // No real out-and-back dominance: the C|D edge is walked in both directions but only one
    // edge is reversed out of 3 unique undirected edges, so dominance is bounded below 0.5.
    expect(result.outAndBackDominance).toBeLessThanOrEqual(0.5);
    // The lollipop must NOT look like a tree walk: low repeat ratio.
    expect(result.repeatedTraversalRatio).toBeLessThan(0.45);
  });

  it('detects a figure-8 (two loops sharing one node) as two cycles', () => {
    // Loop1: A-B-C-A. Loop2: A-D-E-A. Sharing node A. Each edge 1 km.
    const edges: RouteEdgeV3[] = [
      edge({ id: 'e1', from: 'A', to: 'B', lengthKm: 1, osmWayId: 1 }),
      edge({ id: 'e2', from: 'B', to: 'C', lengthKm: 1, osmWayId: 2 }),
      edge({ id: 'e3', from: 'C', to: 'A', lengthKm: 1, osmWayId: 3 }),
      edge({ id: 'e4', from: 'A', to: 'D', lengthKm: 1, osmWayId: 4 }),
      edge({ id: 'e5', from: 'D', to: 'E', lengthKm: 1, osmWayId: 5 }),
      edge({ id: 'e6', from: 'E', to: 'A', lengthKm: 1, osmWayId: 6 }),
    ];

    const result = computeRouteTopologyMetrics({ edges, targetDistanceKm: 6 });

    expect(result.graphCyclomaticNumber).toBe(2);
    expect(result.cycleDistanceKm).toBeGreaterThan(0);
    // No repeated edges: every undirected edge walked once.
    expect(result.repeatedTraversalKm).toBe(0);
    expect(result.repeatedTraversalRatio).toBe(0);
    expect(result.outAndBackDominance).toBe(0);
  });
});
