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
});
