import { describe, expect, it } from 'vitest';

import { generateRouteV3FromGraph, type UserRouteRequestV3 } from '../lib/engine-v3';
import type { EnrichedEdge, EnrichedGraph, GraphNode, TerrainContextLandcoverClass } from '../lib/types';

interface EdgeSpec {
  id: string;
  from: string;
  to: string;
  lengthKm: number;
  highway: string;
  surface?: string;
  scenic?: boolean;
  landcoverClass?: TerrainContextLandcoverClass;
}

function request(overrides: Partial<UserRouteRequestV3> = {}): UserRouteRequestV3 {
  return {
    start: { lat: 49.18, lng: -0.52 },
    targetDistanceKm: 8,
    activity: 'running',
    mode: 'trail',
    loop: true,
    ...overrides,
  };
}

function graph(edges: EdgeSpec[], coordinates: Record<string, { lat: number; lng: number }>): EnrichedGraph {
  const nodes = new Map<string, GraphNode>();
  const enrichedEdges = new Map<string, EnrichedEdge>();

  for (const [id, coordinate] of Object.entries(coordinates)) {
    nodes.set(id, { id, ...coordinate, edges: [] });
  }

  for (const edge of edges) {
    const enriched: EnrichedEdge = {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      lengthKm: edge.lengthKm,
      highway: edge.highway,
      surface: edge.surface,
      scenic: edge.scenic,
      osmWayId: Number(edge.id.replace(/\D/g, '')) || enrichedEdges.size + 1,
      score: edge.scenic ? 0.8 : 0.2,
      terrainContext: edge.landcoverClass
        ? {
            source: 'ign_poc_fixture',
            landcoverClass: edge.landcoverClass,
            naturalContextScore: edge.landcoverClass === 'urban' ? 0.25 : 0.9,
            artificializationScore: edge.landcoverClass === 'urban' ? 0.75 : 0.1,
            confidence: 'high',
            warnings: [],
          }
        : undefined,
    };
    enrichedEdges.set(edge.id, enriched);
    nodes.get(edge.from)!.edges.push(edge.id);
    nodes.get(edge.to)!.edges.push(edge.id);
  }

  const first = Object.values(coordinates)[0]!;
  return { nodes, edges: enrichedEdges, center: first, radiusKm: 2 };
}

function lineGraph(): EnrichedGraph {
  return graph(
    [
      { id: 'e1', from: 'start', to: 'lane', lengthKm: 1.2, highway: 'residential', surface: 'asphalt', scenic: false, landcoverClass: 'urban' },
      { id: 'e2', from: 'lane', to: 'wood-a', lengthKm: 1.5, highway: 'track', surface: 'dirt', scenic: true, landcoverClass: 'forest' },
      { id: 'e3', from: 'wood-a', to: 'wood-b', lengthKm: 1.4, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest' },
      { id: 'e4', from: 'wood-b', to: 'wood-c', lengthKm: 1.6, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest' },
      { id: 'e5', from: 'wood-c', to: 'start', lengthKm: 1.3, highway: 'track', surface: 'gravel', scenic: true, landcoverClass: 'forest' },
    ],
    {
      start: { lat: 49.18, lng: -0.52 },
      lane: { lat: 49.181, lng: -0.519 },
      'wood-a': { lat: 49.183, lng: -0.517 },
      'wood-b': { lat: 49.185, lng: -0.516 },
      'wood-c': { lat: 49.184, lng: -0.521 },
    },
  );
}

describe('engine V3 real graph route assembly', () => {
  it('returns ordered graph edges/nodes, GPS geometry, real surfaces and assembly counters', () => {
    const generated = generateRouteV3FromGraph(request({ targetDistanceKm: 7 }), lineGraph());

    expect(generated.diagnostics.assemblyStatus).toBe('graph_route_assembled');
    expect(generated.route.edges.map((edge) => edge.id)).toEqual(['e5', 'e4', 'e3', 'e2', 'e1']);
    expect(generated.route.nodeIds).toEqual(['start', 'wood-c', 'wood-b', 'wood-a', 'lane', 'start']);
    expect(generated.route.geometry.type).toBe('LineString');
    expect(generated.route.geometry.coordinates).toEqual([
      [-0.52, 49.18],
      [-0.521, 49.184],
      [-0.516, 49.185],
      [-0.517, 49.183],
      [-0.519, 49.181],
      [-0.52, 49.18],
    ]);
    expect(generated.route.metrics.distanceProducedKm).toBeCloseTo(7, 3);
    expect(generated.route.metrics.pavedKm).toBeCloseTo(1.2, 3);
    expect(generated.route.metrics.nonPavedKm).toBeCloseTo(5.8, 3);
    expect(generated.route.metrics.naturalDwellKm).toBeCloseTo(5.8, 3);
    expect(generated.route.metrics.repeatEdgeKm).toBe(0);
    expect(generated.route.metrics.visitedComponents).toEqual(['forest', 'residential']);
    expect(generated.route.surfaces).toEqual({ pavedKm: 1.2, nonPavedKm: 5.8, naturalDwellKm: 5.8 });
    expect(generated.outcome.type).not.toBe('refused');
  });

  it('refuses a poor rural graph without fabricating GPS geometry', () => {
    const poor = graph(
      [{ id: 'e1', from: 'start', to: 'dead-end', lengthKm: 1.1, highway: 'residential', surface: 'asphalt', scenic: false, landcoverClass: 'urban' }],
      { start: { lat: 48.9, lng: 0.15 }, 'dead-end': { lat: 48.901, lng: 0.151 } },
    );

    const generated = generateRouteV3FromGraph(request({ start: { lat: 48.9, lng: 0.15 }, targetDistanceKm: 10 }), poor);

    expect(generated.outcome.type).toBe('refused');
    expect(generated.route.edges).toEqual([]);
    expect(generated.route.nodeIds).toEqual([]);
    expect(generated.route.geometry.coordinates).toEqual([]);
    expect(generated.route.metrics.distanceProducedKm).toBe(0);
  });
});
