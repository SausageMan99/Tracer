import { describe, expect, it } from 'vitest';

import {
  buildTerrainSnapshotV3FromGraph,
  generateRouteV3,
  generateRouteV3FromGraph,
  type TerrainComponentKindV3,
  type UserRouteRequestV3,
} from '../lib/engine-v3';
import type { EnrichedEdge, EnrichedGraph, GraphNode, TerrainContextLandcoverClass } from '../lib/types';

function request(overrides: Partial<UserRouteRequestV3> = {}): UserRouteRequestV3 {
  return {
    start: { lat: 49.31, lng: -0.37 },
    targetDistanceKm: 10,
    activity: 'running',
    mode: 'trail',
    loop: true,
    ...overrides,
  };
}

interface EdgeSpec {
  id: string;
  from: string;
  to: string;
  lengthKm: number;
  highway: string;
  surface?: string;
  scenic?: boolean;
  landcoverClass?: TerrainContextLandcoverClass;
  distanceFromStartKm?: number;
}

function graph(edges: EdgeSpec[]): EnrichedGraph {
  const nodes = new Map<string, GraphNode>();
  const enrichedEdges = new Map<string, EnrichedEdge>();

  for (const edge of edges) {
    for (const nodeId of [edge.from, edge.to]) {
      if (!nodes.has(nodeId)) {
        nodes.set(nodeId, {
          id: nodeId,
          lat: 49.31 + nodes.size * 0.001,
          lng: -0.37 + nodes.size * 0.001,
          edges: [],
        });
      }
    }

    const enriched: EnrichedEdge = {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      lengthKm: edge.lengthKm,
      highway: edge.highway,
      surface: edge.surface,
      scenic: edge.scenic,
      osmWayId: Number(edge.id.replace(/\D/g, '')) || enrichedEdges.size + 1,
      score: 0,
      terrainContext: edge.landcoverClass
        ? {
            source: 'ign_poc_fixture',
            landcoverClass: edge.landcoverClass,
            naturalContextScore: edge.landcoverClass === 'urban' ? 0.2 : 0.85,
            artificializationScore: edge.landcoverClass === 'urban' ? 0.8 : 0.15,
            confidence: 'high',
            warnings: [],
          }
        : undefined,
    };
    enrichedEdges.set(edge.id, enriched);
    nodes.get(edge.from)!.edges.push(edge.id);
  }

  return { nodes, edges: enrichedEdges, center: { lat: 49.31, lng: -0.37 }, radiusKm: 2 };
}

function edge(id: string, kind: TerrainComponentKindV3, lengthKm: number, overrides: Partial<EdgeSpec> = {}): EdgeSpec {
  const base = Number(id.replace(/\D/g, '')) || 1;
  const from = overrides.from ?? `${id}-from`;
  const to = overrides.to ?? `${id}-to`;
  const byKind: Record<TerrainComponentKindV3, Pick<EdgeSpec, 'highway' | 'surface' | 'scenic' | 'landcoverClass'>> = {
    forest: { highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest' },
    field_paths: { highway: 'track', surface: 'dirt', scenic: false, landcoverClass: 'agriculture' },
    park: { highway: 'footway', surface: 'asphalt', scenic: true, landcoverClass: 'park' },
    urban_green: { highway: 'footway', surface: 'paving_stones', scenic: true, landcoverClass: 'urban' },
    river_corridor: { highway: 'cycleway', surface: 'asphalt', scenic: true, landcoverClass: 'water_corridor' },
    residential: { highway: 'residential', surface: 'asphalt', scenic: false, landcoverClass: 'urban' },
    scenic_paved: { highway: 'tertiary', surface: 'asphalt', scenic: true, landcoverClass: 'grassland' },
  };
  return {
    id,
    from,
    to,
    lengthKm,
    distanceFromStartKm: base / 10,
    ...byKind[kind],
    ...overrides,
  };
}

describe('engine V3 integration slice over real graph-shaped evidence', () => {
  it('adapts graph edges into an honest terrain snapshot without relabelling scenic asphalt as trail', () => {
    const snapshot = buildTerrainSnapshotV3FromGraph(
      graph([
        edge('e1', 'scenic_paved', 2, { from: 'a', to: 'b' }),
        edge('e2', 'forest', 4, { from: 'b', to: 'c' }),
        edge('e3', 'forest', 4, { from: 'c', to: 'd' }),
      ]),
    );

    expect(snapshot.audit.edgeCount).toBe(3);
    expect(snapshot.audit.totalLengthKm).toBe(10);
    expect(snapshot.audit.pavedRatio).toBeCloseTo(0.2, 3);
    expect(snapshot.components.find((component) => component.kind === 'scenic_paved')).toMatchObject({ pavedRatio: 1, nonPavedRatio: 0 });
    expect(snapshot.components.find((component) => component.kind === 'forest')).toMatchObject({ totalLengthKm: 8, nonPavedRatio: 1 });
  });

  it('runs Tourville transition-to-woods through the graph adapter and exposes segment-level limitations', () => {
    const generated = generateRouteV3FromGraph(
      request({ start: { lat: 49.18, lng: -0.52 }, targetDistanceKm: 12, mode: 'trail' }),
      graph([
        edge('e1', 'scenic_paved', 2.2, { from: 'start', to: 'lane' }),
        edge('e2', 'forest', 9, { from: 'lane', to: 'woods-a' }),
        edge('e3', 'forest', 7, { from: 'woods-a', to: 'woods-b' }),
      ]),
    );

    expect(generated.intent.strategy).toBe('transition_to_woods');
    expect(generated.mission.anchor?.kind).toBe('forest');
    expect(generated.route.metrics.naturalDwellKm).toBeGreaterThanOrEqual(5);
    expect(generated.outcome.type).toBe('adjusted');
    expect(generated.diagnostics.snapshotSource).toBe('graph_adapter');
    expect(generated.diagnostics.assemblyStatus).toBe('segment_level_not_gps_geometry');
    expect(generated.diagnostics.limitations.join(' ')).toContain('not production-ready');
  });

  it('covers Fontainebleau forest, Caen park, Paris urban nature, and poor rural/unroutable graph paths', () => {
    const fontainebleau = generateRouteV3FromGraph(
      request({ start: { lat: 48.404, lng: 2.701 }, targetDistanceKm: 12, mode: 'trail' }),
      graph([edge('e1', 'forest', 12, { from: 'start', to: 'forest-a' }), edge('e2', 'forest', 13, { from: 'forest-a', to: 'forest-b' })]),
    );
    expect(fontainebleau.intent.strategy).toBe('forest_loop');
    expect(fontainebleau.outcome.type).toBe('generated');

    const caen = generateRouteV3FromGraph(
      request({ start: { lat: 49.2, lng: -0.37 }, targetDistanceKm: 6, mode: 'nature_urbaine' }),
      graph([edge('e1', 'park', 4, { from: 'start', to: 'park-a' }), edge('e2', 'park', 4, { surface: 'grass', from: 'park-a', to: 'park-b' })]),
    );
    expect(caen.intent.strategy).toBe('park_loop');
    expect(caen.mission.anchor?.kind).toBe('park');

    const paris = generateRouteV3FromGraph(
      request({ start: { lat: 48.879, lng: 2.381 }, targetDistanceKm: 7, mode: 'nature_urbaine' }),
      graph([edge('e1', 'urban_green', 6, { from: 'start', to: 'green-a' }), edge('e2', 'river_corridor', 6, { from: 'green-a', to: 'river-a' })]),
    );
    expect(paris.intent.strategy).toBe('urban_nature_loop');
    expect(paris.intent.constraints.targetComponents).not.toContain('forest');
    expect(paris.route.metrics.pavedRatio).toBeGreaterThan(0.5);

    const rural = generateRouteV3FromGraph(
      request({ start: { lat: 48.9, lng: 0.15 }, targetDistanceKm: 10, mode: 'trail' }),
      graph([edge('e1', 'residential', 1.1, { from: 'start', to: 'dead-end' })]),
    );
    expect(rural.intent.strategy).toBe('unroutable');
    expect(rural.outcome.type).toBe('refused');
  });

  it('generateRouteV3 exposes outcome diagnostics even when called with an injected synthetic snapshot', () => {
    const generated = generateRouteV3(request({ targetDistanceKm: 10, mode: 'trail' }), {
      audit: { confidence: 'low', edgeCount: 4, totalLengthKm: 1.2, pavedRatio: 0.95, nonPavedRatio: 0.05, warnings: ['insufficient graph coverage'] },
      components: [],
    });

    expect(generated.diagnostics.snapshotSource).toBe('injected_snapshot');
    expect(generated.diagnostics.outcomeEvidence.reasonsOrCompromises.join(' ')).toContain('unroutable');
    expect(generated.diagnostics.metrics.distanceProducedKm).toBe(0);
  });
});
