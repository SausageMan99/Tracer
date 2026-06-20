import { describe, expect, it } from 'vitest';
import type { EnrichedEdge, TerrainContextFeatureCollection } from '../lib/types';
import { enrichEdgesWithTerrainContext } from '../lib/engine/terrain-context-enricher';

function edge(overrides: Partial<EnrichedEdge>): EnrichedEdge {
  return {
    id: overrides.id ?? 'edge-1',
    from: overrides.from ?? 'a',
    to: overrides.to ?? 'b',
    lengthKm: overrides.lengthKm ?? 1,
    highway: overrides.highway ?? 'footway',
    surface: overrides.surface,
    osmWayId: overrides.osmWayId ?? 1,
    score: overrides.score ?? 0,
    ...overrides,
  };
}

const parkFixture: TerrainContextFeatureCollection = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      properties: {
        landcoverClass: 'park',
        naturalContextScore: 0.82,
        artificializationScore: 0.15,
        confidence: 'medium',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-0.5, -0.5],
          [0.5, -0.5],
          [0.5, 0.5],
          [-0.5, 0.5],
          [-0.5, -0.5],
        ]],
      },
    },
  ],
};

describe('fixture-based terrain context enricher', () => {
  it('annotates an edge whose midpoint is inside a fixture polygon', () => {
    const [inside] = enrichEdgesWithTerrainContext([
      edge({ fromCoordinate: { lat: 0, lng: 0 }, toCoordinate: { lat: 0.1, lng: 0.1 } }),
    ], { fixtureGeoJson: parkFixture });

    expect(inside.terrainContext).toMatchObject({
      source: 'ign_poc_fixture',
      landcoverClass: 'park',
      naturalContextScore: 0.82,
      artificializationScore: 0.15,
      confidence: 'medium',
    });
  });

  it('leaves an edge outside the fixture with a no-data terrain context', () => {
    const [outside] = enrichEdgesWithTerrainContext([
      edge({ fromCoordinate: { lat: 10, lng: 10 }, toCoordinate: { lat: 10.1, lng: 10.1 } }),
    ], { fixtureGeoJson: parkFixture });

    expect(outside.terrainContext).toMatchObject({
      source: 'none',
      naturalContextScore: 0,
      artificializationScore: 0,
      confidence: 'low',
    });
  });

  it('does not rewrite asphalt surface or paved flags when asphalt is inside natural context', () => {
    const [asphaltInPark] = enrichEdgesWithTerrainContext([
      edge({
        surface: 'asphalt',
        fromCoordinate: { lat: 0, lng: 0 },
        toCoordinate: { lat: 0.1, lng: 0.1 },
      }),
    ], { fixtureGeoJson: parkFixture });

    expect(asphaltInPark.surface).toBe('asphalt');
    expect(asphaltInPark.terrainContext?.warnings).toContain('EXPLICIT_PAVED_IN_NATURAL_CONTEXT');
  });

  // T17: nodeResolver fallback tests.
  // buildGraph does not populate fromCoordinate/toCoordinate; a nodeResolver
  // lets the enricher work on real production graphs without changing buildGraph.

  it('T17: nodeResolver enriches an edge that has no fromCoordinate/toCoordinate', () => {
    // Edge has no fromCoordinate/toCoordinate. The fixture covers (lat=0, lng=0)
    // to (lat=0.5, lng=0.5). The nodeResolver returns coords inside the fixture.
    const nodes = new Map<string, { lat: number; lng: number }>([
      ['a', { lat: 0, lng: 0 }],
      ['b', { lat: 0.1, lng: 0.1 }],
    ]);
    const nodeResolver = (id: string) => nodes.get(id);
    const [enriched] = enrichEdgesWithTerrainContext(
      [edge({ id: 'no-coord-edge', from: 'a', to: 'b' })],
      { fixtureGeoJson: parkFixture, nodeResolver },
    );
    expect(enriched.terrainContext?.landcoverClass).toBe('park');
    expect(enriched.terrainContext?.source).toBe('ign_poc_fixture');
  });

  it('T17: nodeResolver is a no-op when the resolver returns undefined for both nodes', () => {
    // Edge has no fromCoordinate/toCoordinate. Resolver returns undefined.
    // The enricher must fall back to a clean no-op (NO_TERRAIN_CONTEXT).
    const emptyNodes = new Map<string, { lat: number; lng: number }>();
    const nodeResolver = (id: string) => emptyNodes.get(id);
    const [enriched] = enrichEdgesWithTerrainContext(
      [edge({ id: 'orphan-edge', from: 'ghost-a', to: 'ghost-b' })],
      { fixtureGeoJson: parkFixture, nodeResolver },
    );
    expect(enriched.terrainContext?.landcoverClass).toBeUndefined();
    expect(enriched.terrainContext?.source).toBe('none');
  });

  it('T17: explicit fromCoordinate/toCoordinate take priority over nodeResolver', () => {
    // Edge has explicit fromCoordinate (10, 10) which is OUTSIDE the park
    // fixture. The nodeResolver returns (0, 0) which is INSIDE the park.
    // The enricher must use the explicit coords → no park match.
    const nodes = new Map<string, { lat: number; lng: number }>([
      ['a', { lat: 0, lng: 0 }],
      ['b', { lat: 0.1, lng: 0.1 }],
    ]);
    const nodeResolver = (id: string) => nodes.get(id);
    const [enriched] = enrichEdgesWithTerrainContext(
      [edge({
        id: 'priority-edge',
        from: 'a',
        to: 'b',
        fromCoordinate: { lat: 10, lng: 10 },
        toCoordinate: { lat: 10.1, lng: 10.1 },
      })],
      { fixtureGeoJson: parkFixture, nodeResolver },
    );
    // Explicit coords are outside the park fixture, so no park match.
    expect(enriched.terrainContext?.landcoverClass).toBeUndefined();
    expect(enriched.terrainContext?.source).toBe('none');
  });

  it('T17: asphalt edge inside park via nodeResolver keeps surface and gets warning', () => {
    // Production-shaped edge: no fromCoordinate/toCoordinate, surface='asphalt'.
    // The nodeResolver puts the midpoint inside the park fixture. The enricher
    // must set terrainContext.landcoverClass='park', keep surface='asphalt',
    // and attach the EXPLICIT_PAVED_IN_NATURAL_CONTEXT warning so downstream
    // edge-semantics classifies the edge as paved (not natural).
    const nodes = new Map<string, { lat: number; lng: number }>([
      ['a', { lat: 0, lng: 0 }],
      ['b', { lat: 0.1, lng: 0.1 }],
    ]);
    const nodeResolver = (id: string) => nodes.get(id);
    const [enriched] = enrichEdgesWithTerrainContext(
      [edge({
        id: 'asphalt-priority-edge',
        from: 'a',
        to: 'b',
        surface: 'asphalt',
        highway: 'footway',
      })],
      { fixtureGeoJson: parkFixture, nodeResolver },
    );
    expect(enriched.surface).toBe('asphalt');
    expect(enriched.terrainContext?.landcoverClass).toBe('park');
    expect(enriched.terrainContext?.source).toBe('ign_poc_fixture');
    expect(enriched.terrainContext?.warnings).toContain('EXPLICIT_PAVED_IN_NATURAL_CONTEXT');
  });
});
