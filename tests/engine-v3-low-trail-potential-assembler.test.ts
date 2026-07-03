import { describe, expect, it } from 'vitest';

import { buildCorridorMissionV3 } from '../lib/engine-v3/corridor-anchor-builder';
import { generateRouteV3FromGraph } from '../lib/engine-v3/route-generator';
import type {
  RouteConstraintsV3,
  RouteIntentV3,
  TerrainComponentV3,
  TerrainSnapshotV3,
  UserRouteRequestV3,
} from '../lib/engine-v3';
import type { EnrichedEdge, EnrichedGraph, GraphNode } from '../lib/types';

const PATH_LIKE_HIGHWAYS = new Set(['path', 'track', 'footway', 'bridleway', 'pedestrian']);

function edge(overrides: Partial<EnrichedEdge> & Pick<EnrichedEdge, 'id' | 'from' | 'to' | 'lengthKm'>): EnrichedEdge {
  return {
    highway: 'residential',
    surface: 'asphalt',
    scenic: false,
    osmWayId: 1,
    score: 0,
    ...overrides,
  } as EnrichedEdge;
}

function buildGraph(edges: EnrichedEdge[], coordinates: Record<string, { lat: number; lng: number }>): EnrichedGraph {
  const nodes = new Map<string, GraphNode>();
  const enrichedEdges = new Map<string, EnrichedEdge>();
  for (const [id, c] of Object.entries(coordinates)) {
    nodes.set(id, { id, ...c, edges: [] });
  }
  for (const e of edges) {
    enrichedEdges.set(e.id, e);
    nodes.get(e.from)?.edges.push(e.id);
    nodes.get(e.to)?.edges.push(e.id);
  }
  return { nodes, edges: enrichedEdges, center: coordinates.start, radiusKm: 2 };
}

function component(overrides: Partial<TerrainComponentV3> & Pick<TerrainComponentV3, 'kind'>): TerrainComponentV3 {
  return {
    id: overrides.id ?? `${overrides.kind}-graph-component`,
    kind: overrides.kind,
    distanceFromStartKm: overrides.distanceFromStartKm ?? 0,
    edgeCount: overrides.edgeCount ?? 10,
    totalLengthKm: overrides.totalLengthKm ?? 5,
    pavedRatio: overrides.pavedRatio ?? 0.4,
    nonPavedRatio: overrides.nonPavedRatio ?? 0.6,
    confidence: overrides.confidence ?? 'medium',
  };
}

function snapshot(components: TerrainComponentV3[]): TerrainSnapshotV3 {
  const totalLengthKm = components.reduce((sum, c) => sum + c.totalLengthKm, 0);
  const pavedKm = components.reduce((sum, c) => sum + c.totalLengthKm * c.pavedRatio, 0);
  return {
    audit: {
      confidence: 'medium',
      edgeCount: components.reduce((sum, c) => sum + c.edgeCount, 0),
      totalLengthKm,
      pavedRatio: totalLengthKm > 0 ? pavedKm / totalLengthKm : 0,
      nonPavedRatio: totalLengthKm > 0 ? 1 - pavedKm / totalLengthKm : 0,
      warnings: [],
    },
    components,
  };
}

function intent(strategy: RouteIntentV3['strategy'], snapshotValue: TerrainSnapshotV3, opts: { targetComponents?: RouteConstraintsV3['targetComponents']; minNaturalDwellRatio?: number; targetDistanceKm?: number } = {}): RouteIntentV3 {
  const request: UserRouteRequestV3 = {
    start: { lat: 48.7, lng: 2.5 },
    targetDistanceKm: opts.targetDistanceKm ?? 8,
    activity: 'running',
    sport: 'running',
    mode: 'trail',
    loop: true,
  };
  return {
    engine: 'v3-clean-room',
    strategy,
    // RouteIntentV3.request is NormalizedRouteRequestV3 (loop: true, sport: 'running' literal).
    // UserRouteRequestV3 has sport optional; the test inputs always provide both activity and sport.
    request: request as unknown as NonNullable<RouteIntentV3['request']>,
    snapshot: snapshotValue,
    constraints: {
      targetDistanceKm: request.targetDistanceKm,
      targetComponents: opts.targetComponents ?? [],
      maxPavedRatio: 0.8,
      cleanReturn: 'relaxed',
      minNaturalDwellRatio: opts.minNaturalDwellRatio ?? 0.1,
    },
    outcome: { type: 'adjusted' as const, summary: 'low trail potential', compromises: [] },
    warnings: [],
  };
}

describe('engine V3 low_trail_potential assembler + mission targetComponents', () => {
  it('low_trail_potential prefers path-like / mixed-surface edge over paved when both available', () => {
    // Start has 2 outgoing edges: one paved residential (short, dead-end),
    // one path with unset (mixed) surface leading to a long path chain.
    // Total graph length: 5 km (above the 3 km `detectUnroutable` floor).
    const graph = buildGraph(
      [
        edge({ id: 'p1', from: 'start', to: 'p2', lengthKm: 0.5, highway: 'path', surface: undefined, osmWayId: 11 }),
        edge({ id: 'p2', from: 'p2', to: 'p3', lengthKm: 0.5, highway: 'path', surface: undefined, osmWayId: 11 }),
        edge({ id: 'p3', from: 'p3', to: 'p4', lengthKm: 0.5, highway: 'path', surface: 'dirt', osmWayId: 11 }),
        edge({ id: 'p4', from: 'p4', to: 'p5', lengthKm: 0.5, highway: 'path', surface: 'dirt', osmWayId: 11 }),
        edge({ id: 'p5', from: 'p5', to: 'p6', lengthKm: 0.5, highway: 'path', surface: 'dirt', osmWayId: 11 }),
        edge({ id: 'p6', from: 'p6', to: 'start', lengthKm: 0.5, highway: 'path', surface: 'dirt', osmWayId: 11 }),
        edge({ id: 'r1', from: 'start', to: 'r2', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 12 }),
        edge({ id: 'r2', from: 'r2', to: 'r3', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 12 }),
        edge({ id: 'r3', from: 'r3', to: 'r2', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 12 }),
      ],
      {
        start: { lat: 48.7, lng: 2.5 },
        p2: { lat: 48.701, lng: 2.5 },
        p3: { lat: 48.702, lng: 2.5 },
        p4: { lat: 48.703, lng: 2.5 },
        p5: { lat: 48.703, lng: 2.501 },
        p6: { lat: 48.702, lng: 2.501 },
        r2: { lat: 48.699, lng: 2.5 },
        r3: { lat: 48.699, lng: 2.501 },
      },
    );

    const intentValue = intent(
      'low_trail_potential',
      snapshot([component({ kind: 'field_paths', totalLengthKm: 4, pavedRatio: 0.2, nonPavedRatio: 0.8 })]),
    );
    const r = generateRouteV3FromGraph(intentValue.request!, graph);

    // The route must have used at least one path-like edge.
    const pathLikeUsed = r.route.edges.filter((e) => PATH_LIKE_HIGHWAYS.has(e.highway));
    expect(pathLikeUsed.length).toBeGreaterThan(0);
    // And the walk should not be 100% paved.
    expect(r.route.metrics.pavedRatio).toBeLessThan(1);
  });

  it('low_trail_potential falls back to paved / residential when no path-like edge exists', () => {
    // Graph with only residential edges, total length 4 km (above floor).
    const graph = buildGraph(
      [
        edge({ id: 'r1', from: 'start', to: 'r2', lengthKm: 1, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'r2', from: 'r2', to: 'r3', lengthKm: 1, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'r3', from: 'r3', to: 'r4', lengthKm: 1, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'r4', from: 'r4', to: 'start', lengthKm: 1, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
      ],
      {
        start: { lat: 48.7, lng: 2.5 },
        r2: { lat: 48.701, lng: 2.5 },
        r3: { lat: 48.702, lng: 2.5 },
        r4: { lat: 48.701, lng: 2.501 },
      },
    );

    const intentValue = intent(
      'low_trail_potential',
      snapshot([component({ kind: 'residential', totalLengthKm: 4, pavedRatio: 0.95, nonPavedRatio: 0.05 })]),
    );
    const r = generateRouteV3FromGraph(intentValue.request!, graph);

    // The route was walked, but every edge is paved (no path-like to prefer).
    expect(r.route.edges.length).toBeGreaterThan(0);
    expect(r.route.edges.every((e) => e.highway === 'residential')).toBe(true);
  });

  it('mission targetComponents includes field_paths when selected anchor is field_paths', () => {
    const intentValue = intent(
      'low_trail_potential',
      snapshot([component({ kind: 'field_paths', totalLengthKm: 4, pavedRatio: 0.4, nonPavedRatio: 0.6 })]),
    );
    const mission = buildCorridorMissionV3(intentValue);
    expect(mission.anchor?.kind).toBe('field_paths');
    expect(mission.targetComponents).toContain('field_paths');
  });

  it('mission targetComponents does not duplicate an existing component', () => {
    const intentValue = intent(
      'low_trail_potential',
      snapshot([component({ kind: 'field_paths', totalLengthKm: 4, pavedRatio: 0.4, nonPavedRatio: 0.6 })]),
      { targetComponents: ['field_paths'] },
    );
    const mission = buildCorridorMissionV3(intentValue);
    const occurrences = mission.targetComponents.filter((k) => k === 'field_paths').length;
    expect(occurrences).toBe(1);
  });

  it('mission targetComponents stays empty when anchor is not in ROUTABLE_ANCHOR_KINDS', () => {
    const intentValue = intent(
      'low_trail_potential',
      snapshot([component({ kind: 'residential', totalLengthKm: 4, pavedRatio: 0.95, nonPavedRatio: 0.05 })]),
    );
    const mission = buildCorridorMissionV3(intentValue);
    expect(mission.anchor?.kind).toBe('residential');
    expect(mission.targetComponents).toEqual([]);
  });

  it('forest_loop behavior is unchanged by the new low_trail_potential mode', () => {
    // Build a graph with a path chain that loops back to start, total 4 km.
    const graph = buildGraph(
      [
        edge({ id: 'a1', from: 'start', to: 'f1', lengthKm: 1, highway: 'path', surface: 'ground', scenic: true, osmWayId: 1 }),
        edge({ id: 'a2', from: 'f1', to: 'f2', lengthKm: 1, highway: 'path', surface: 'ground', scenic: true, osmWayId: 1 }),
        edge({ id: 'a3', from: 'f2', to: 'f3', lengthKm: 1, highway: 'path', surface: 'ground', scenic: true, osmWayId: 1 }),
        edge({ id: 'a4', from: 'f3', to: 'f1', lengthKm: 1, highway: 'path', surface: 'ground', scenic: true, osmWayId: 1 }),
      ],
      {
        start: { lat: 48.7, lng: 2.5 },
        f1: { lat: 48.71, lng: 2.5 },
        f2: { lat: 48.72, lng: 2.5 },
        f3: { lat: 48.72, lng: 2.51 },
      },
    );
    const intentValue = intent(
      'forest_loop',
      snapshot([component({ kind: 'forest', totalLengthKm: 4, pavedRatio: 0.05, nonPavedRatio: 0.95 })]),
      { targetComponents: ['forest'] },
    );
    const r = generateRouteV3FromGraph(intentValue.request!, graph);
    // forest_loop: all edges should be path-like, surface=natural (ground), and naturalDwell > 0.
    expect(r.route.edges.every((e) => PATH_LIKE_HIGHWAYS.has(e.highway))).toBe(true);
    expect(r.route.metrics.naturalDwellKm).toBeGreaterThan(0);
  });

  it('anchor fallback test for field_paths (regression of 97b074e) still holds', () => {
    const intentValue = intent(
      'low_trail_potential',
      snapshot([
        component({ id: 'residential-graph-component', kind: 'residential', totalLengthKm: 51.7, pavedRatio: 0.851, nonPavedRatio: 0.149 }),
        component({ id: 'field_paths-graph-component', kind: 'field_paths', totalLengthKm: 103.1, pavedRatio: 0.558, nonPavedRatio: 0.442 }),
      ]),
    );
    const mission = buildCorridorMissionV3(intentValue);
    expect(mission.anchor?.kind).toBe('field_paths');
    expect(mission.targetComponents).toContain('field_paths');
  });
});
