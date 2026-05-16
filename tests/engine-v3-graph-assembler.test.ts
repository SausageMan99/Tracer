import { describe, expect, it } from 'vitest';
import type { EnrichedEdge, EnrichedGraph, GraphNode } from '@/lib/types';
import { assembleGraphRouteV3 } from '@/lib/engine-v3/graph-route-assembler';
import { decideOutcomeV3 } from '@/lib/engine-v3/outcome-decider';
import type { CorridorMissionV3, RouteIntentV3, TerrainComponentKindV3 } from '@/lib/engine-v3/types';

function node(id: string, index: number): GraphNode {
  return { id, lat: 49 + index * 0.001, lng: -0.6 - index * 0.001, edges: [] };
}

function edge(
  id: string,
  from: string,
  to: string,
  lengthKm: number,
  surface: string,
  highway: string,
  landcoverClass: 'forest' | 'urban' = surface === 'asphalt' ? 'urban' : 'forest',
): EnrichedEdge {
  return {
    id,
    from,
    to,
    lengthKm,
    surface,
    highway,
    scenic: landcoverClass === 'forest',
    osmWayId: Math.abs([...id].reduce((sum, char) => sum + char.charCodeAt(0), 0)),
    score: surface === 'asphalt' ? 0.2 : 0.9,
    terrainContext: {
      source: 'ign_poc_fixture',
      landcoverClass,
      naturalContextScore: landcoverClass === 'forest' ? 0.9 : 0.1,
      artificializationScore: landcoverClass === 'urban' ? 0.9 : 0.1,
      confidence: 'high',
      warnings: [],
    },
  };
}

function graph(edges: EnrichedEdge[]): EnrichedGraph {
  const nodeIds = Array.from(new Set(edges.flatMap((candidate) => [candidate.from, candidate.to])));
  const nodes = new Map<string, GraphNode>(nodeIds.map((id, index) => [id, node(id, index)]));
  for (const candidate of edges) {
    nodes.get(candidate.from)?.edges.push(candidate.id);
    nodes.get(candidate.to)?.edges.push(candidate.id);
  }
  return {
    nodes,
    edges: new Map(edges.map((candidate) => [candidate.id, candidate])),
    center: { lat: 49, lng: -0.6 },
    radiusKm: 2,
  };
}

function intent(targetDistanceKm: number, targetComponents: TerrainComponentKindV3[] = ['forest']): RouteIntentV3 {
  return {
    engine: 'v3-clean-room',
    strategy: 'transition_to_woods',
    request: {
      start: { lat: 49, lng: -0.6 },
      targetDistanceKm,
      sport: 'running',
      mode: 'trail',
      loop: true,
    },
    snapshot: {
      audit: { confidence: 'high', edgeCount: 16, totalLengthKm: 18, pavedRatio: 0.15, nonPavedRatio: 0.85, warnings: [] },
      components: [
        {
          id: 'forest-main',
          kind: 'forest',
          distanceFromStartKm: 1,
          edgeCount: 8,
          totalLengthKm: 9,
          pavedRatio: 0,
          nonPavedRatio: 1,
          confidence: 'high',
        },
      ],
    },
    constraints: {
      targetDistanceKm,
      targetComponents,
      maxPavedRatio: 0.35,
      cleanReturn: 'strict',
      minNaturalDwellRatio: 0.45,
    },
    outcome: { type: 'generated', summary: 'candidate intent' },
    warnings: [],
  };
}

function mission(targetDistanceKm: number): CorridorMissionV3 {
  return {
    engine: 'v3-clean-room',
    strategy: 'transition_to_woods',
    targetDistanceKm,
    targetComponents: ['forest'],
    anchor: {
      componentId: 'forest-main',
      kind: 'forest',
      distanceFromStartKm: 1,
      totalLengthKm: 9,
      naturalCapacityKm: 9,
      pavedRatio: 0,
      nonPavedRatio: 1,
    },
    budgetPavedKm: targetDistanceKm * 0.35,
    requestedNaturalDwellKm: targetDistanceKm * 0.45,
    cleanReturn: 'strict',
    returnMode: 'clean_loop',
    warnings: [],
  };
}

describe('assembleGraphRouteV3 graph assembler', () => {
  it('assembles a returned target-component candidate within 70%-115% with dwell and used-edge accounting', () => {
    const targetKm = 5.5;
    const assembled = assembleGraphRouteV3(
      intent(targetKm),
      mission(targetKm),
      graph([
        edge('access-out', 's', 'a', 1, 'asphalt', 'residential', 'urban'),
        edge('forest-1', 'a', 'b', 1, 'ground', 'path'),
        edge('forest-2', 'b', 'c', 1, 'ground', 'path'),
        edge('forest-3', 'c', 'd', 1, 'ground', 'path'),
        edge('forest-4', 'd', 'a', 1, 'ground', 'path'),
        edge('short-paved-decoy-1', 's', 'x', 0.8, 'asphalt', 'residential', 'urban'),
        edge('short-paved-decoy-2', 'x', 's', 0.8, 'asphalt', 'residential', 'urban'),
      ]),
    );

    expect(assembled.nodeIds[0]).toBe('s');
    expect(assembled.nodeIds.at(-1)).toBe('s');
    expect(assembled.metrics.distanceProducedKm).toBeGreaterThanOrEqual(targetKm * 0.7);
    expect(assembled.metrics.distanceProducedKm).toBeLessThanOrEqual(targetKm * 1.15);
    expect(assembled.metrics.visitedComponents).toContain('forest');
    expect(assembled.metrics.naturalDwellKm).toBeGreaterThanOrEqual(targetKm * 0.45);
    expect(assembled.metrics.repeatEdgeKm).toBeCloseTo(1, 3);
    expect(assembled.edges.map((candidate) => candidate.id)).toEqual([
      'access-out',
      'forest-1',
      'forest-2',
      'forest-3',
      'forest-4',
      'access-out',
    ]);
  });

  it('lets the strict outcome decider refuse a returned target route below the 70% floor', () => {
    const targetKm = 10;
    const route = assembleGraphRouteV3(
      intent(targetKm),
      mission(targetKm),
      graph([
        edge('access-out', 's', 'a', 1, 'asphalt', 'residential', 'urban'),
        edge('forest-1', 'a', 'b', 1, 'ground', 'path'),
        edge('forest-2', 'b', 'a', 1, 'ground', 'path'),
        edge('access-back', 'a', 's', 1, 'asphalt', 'residential', 'urban'),
      ]),
    );

    const outcome = decideOutcomeV3(intent(targetKm), route);

    expect(route.nodeIds[0]).toBe('s');
    expect(route.nodeIds.at(-1)).toBe('s');
    expect(route.metrics.distanceProducedKm).toBeLessThan(targetKm * 0.7);
    expect(outcome.type).toBe('refused');
  });

  it('refuses a route that otherwise passes metrics but has no usable GPS geometry', () => {
    const targetKm = 5.5;
    const route = assembleGraphRouteV3(
      intent(targetKm),
      mission(targetKm),
      graph([
        edge('access-out', 's', 'a', 1, 'asphalt', 'residential', 'urban'),
        edge('forest-1', 'a', 'b', 1, 'ground', 'path'),
        edge('forest-2', 'b', 'c', 1, 'ground', 'path'),
        edge('forest-3', 'c', 'd', 1, 'ground', 'path'),
        edge('forest-4', 'd', 'a', 1, 'ground', 'path'),
      ]),
    );

    const outcome = decideOutcomeV3(intent(targetKm), {
      ...route,
      geometry: { type: 'LineString', coordinates: [] },
    });

    expect(route.metrics.distanceProducedKm).toBeGreaterThanOrEqual(targetKm);
    expect(outcome.type).toBe('refused');
    expect(outcome).toMatchObject({ reason: expect.stringContaining('GPS geometry') });
  });
});
