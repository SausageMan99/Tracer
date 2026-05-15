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
  score?: number;
}

function request(overrides: Partial<UserRouteRequestV3> = {}): UserRouteRequestV3 {
  return {
    start: { lat: 49.18, lng: -0.52 },
    targetDistanceKm: 6,
    activity: 'running',
    mode: 'trail',
    loop: true,
    ...overrides,
  };
}

function graph(edges: EdgeSpec[], coordinates: Record<string, { lat: number; lng: number }>): EnrichedGraph {
  const nodes = new Map<string, GraphNode>();
  const enrichedEdges = new Map<string, EnrichedEdge>();

  for (const [id, coordinate] of Object.entries(coordinates)) nodes.set(id, { id, ...coordinate, edges: [] });

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
      score: edge.score ?? (edge.scenic ? 0.8 : 0.2),
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

function forestLoopGraph(): EnrichedGraph {
  return graph(
    [
      { id: 'f1', from: 'start', to: 'wood-a', lengthKm: 1.2, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest' },
      { id: 'f2', from: 'wood-a', to: 'wood-b', lengthKm: 1.1, highway: 'track', surface: 'dirt', scenic: true, landcoverClass: 'forest' },
      { id: 'f3', from: 'wood-b', to: 'wood-c', lengthKm: 1.3, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest' },
      { id: 'f4', from: 'wood-c', to: 'start', lengthKm: 1.2, highway: 'track', surface: 'gravel', scenic: true, landcoverClass: 'forest' },
      { id: 'f5', from: 'start', to: 'road-a', lengthKm: 1.6, highway: 'residential', surface: 'asphalt', scenic: false, landcoverClass: 'urban' },
    ],
    {
      start: { lat: 48.405, lng: 2.701 },
      'wood-a': { lat: 48.406, lng: 2.702 },
      'wood-b': { lat: 48.407, lng: 2.703 },
      'wood-c': { lat: 48.406, lng: 2.704 },
      'road-a': { lat: 48.405, lng: 2.705 },
    },
  );
}

function transitionToWoodsGraph(): EnrichedGraph {
  return graph(
    [
      { id: 't1', from: 'start', to: 'lane-a', lengthKm: 0.7, highway: 'residential', surface: 'asphalt', scenic: false, landcoverClass: 'urban' },
      { id: 't2', from: 'lane-a', to: 'lane-b', lengthKm: 0.6, highway: 'service', surface: 'asphalt', scenic: false, landcoverClass: 'urban' },
      { id: 't3', from: 'lane-b', to: 'wood-a', lengthKm: 0.8, highway: 'track', surface: 'dirt', scenic: true, landcoverClass: 'forest' },
      { id: 't4', from: 'wood-a', to: 'wood-b', lengthKm: 1.3, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest' },
      { id: 't5', from: 'wood-b', to: 'wood-c', lengthKm: 1.2, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest' },
      { id: 't6', from: 'wood-c', to: 'lane-b', lengthKm: 1.1, highway: 'track', surface: 'gravel', scenic: true, landcoverClass: 'forest' },
      { id: 't7', from: 'start', to: 'suburb-a', lengthKm: 1.4, highway: 'residential', surface: 'asphalt', scenic: true, landcoverClass: 'urban' },
    ],
    {
      start: { lat: 49.18, lng: -0.52 },
      'lane-a': { lat: 49.181, lng: -0.519 },
      'lane-b': { lat: 49.182, lng: -0.518 },
      'wood-a': { lat: 49.184, lng: -0.516 },
      'wood-b': { lat: 49.185, lng: -0.517 },
      'wood-c': { lat: 49.184, lng: -0.519 },
      'suburb-a': { lat: 49.179, lng: -0.517 },
    },
  );
}

function parkLoopGraph(): EnrichedGraph {
  return graph(
    [
      { id: 'p1', from: 'start', to: 'park-a', lengthKm: 0.9, highway: 'footway', surface: 'asphalt', scenic: true, landcoverClass: 'park' },
      { id: 'p2', from: 'park-a', to: 'park-b', lengthKm: 1.0, highway: 'footway', surface: 'paved', scenic: true, landcoverClass: 'park' },
      { id: 'p3', from: 'park-b', to: 'park-c', lengthKm: 0.8, highway: 'path', surface: 'gravel', scenic: true, landcoverClass: 'park' },
      { id: 'p4', from: 'park-c', to: 'start', lengthKm: 1.0, highway: 'footway', surface: 'asphalt', scenic: true, landcoverClass: 'park' },
      { id: 'p5', from: 'park-b', to: 'street-a', lengthKm: 1.2, highway: 'residential', surface: 'asphalt', scenic: false, landcoverClass: 'urban' },
    ],
    {
      start: { lat: 49.19, lng: -0.37 },
      'park-a': { lat: 49.191, lng: -0.369 },
      'park-b': { lat: 49.192, lng: -0.368 },
      'park-c': { lat: 49.191, lng: -0.367 },
      'street-a': { lat: 49.193, lng: -0.366 },
    },
  );
}

describe('engine V3 strategy-specific graph assemblers', () => {
  it('forest_loop stays inside strong natural terrain instead of taking a paved road detour', () => {
    const generated = generateRouteV3FromGraph(request({ start: { lat: 48.405, lng: 2.701 }, targetDistanceKm: 5 }), forestLoopGraph());

    expect(generated.intent.strategy).toBe('forest_loop');
    expect(generated.route.edges.map((edge) => edge.id)).toEqual(['f1', 'f2', 'f3', 'f4']);
    expect(generated.route.metrics.visitedComponents).toEqual(['forest']);
    expect(generated.route.metrics.pavedRatio).toBe(0);
    expect(generated.route.metrics.naturalDwellKm).toBeCloseTo(4.8, 3);
  });

  it('transition_to_woods accepts a paved connector then requires real dwell inside the woods', () => {
    const generated = generateRouteV3FromGraph(request({ targetDistanceKm: 6 }), transitionToWoodsGraph());

    expect(generated.intent.strategy).toBe('transition_to_woods');
    expect(generated.route.edges.map((edge) => edge.id).slice(0, 2)).toEqual(['t1', 't2']);
    expect(generated.route.edges.map((edge) => edge.id)).toContain('t4');
    expect(generated.route.edges.map((edge) => edge.id)).toContain('t5');
    expect(generated.route.metrics.pavedKm).toBeGreaterThan(0);
    expect(generated.route.metrics.naturalDwellKm).toBeGreaterThanOrEqual(generated.mission.requestedNaturalDwellKm);
    expect(generated.route.metrics.naturalWayRatio).toBeGreaterThan(0.55);
  });

  it('park_loop permits paved park paths but keeps the paved compromise explicit', () => {
    const generated = generateRouteV3FromGraph(request({ start: { lat: 49.19, lng: -0.37 }, targetDistanceKm: 5, mode: 'nature_urbaine' }), parkLoopGraph());

    expect(generated.intent.strategy).toBe('park_loop');
    expect(generated.route.edges.map((edge) => edge.id)).toEqual(['p1', 'p2', 'p3', 'p4']);
    expect(generated.route.metrics.visitedComponents).toEqual(['park']);
    expect(generated.route.metrics.pavedRatio).toBeGreaterThan(0.7);
    expect(generated.route.metrics.naturalWayRatio).toBeLessThan(0.3);
    expect(generated.diagnostics.warnings.join(' ')).toContain('paved park paths are accepted as paved compromises');
  });

  it('produces distinct routes for forest, transition and park intentions', () => {
    const forest = generateRouteV3FromGraph(request({ start: { lat: 48.405, lng: 2.701 }, targetDistanceKm: 5 }), forestLoopGraph());
    const transition = generateRouteV3FromGraph(request({ targetDistanceKm: 6 }), transitionToWoodsGraph());
    const park = generateRouteV3FromGraph(request({ start: { lat: 49.19, lng: -0.37 }, targetDistanceKm: 5, mode: 'nature_urbaine' }), parkLoopGraph());

    expect(new Set([forest.route.edges.map((edge) => edge.id).join(','), transition.route.edges.map((edge) => edge.id).join(','), park.route.edges.map((edge) => edge.id).join(',')]).size).toBe(3);
  });
});
