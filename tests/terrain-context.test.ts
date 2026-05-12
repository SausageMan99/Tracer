import { describe, expect, it } from 'vitest';
import type { EnrichedEdge } from '../lib/types';
import { hasExplicitPavedSurface, isSurfaceRatioPaved } from '../lib/engine/terrain-context';

function edge(overrides: Partial<EnrichedEdge>): EnrichedEdge {
  return {
    id: overrides.id ?? 'edge-1',
    from: overrides.from ?? 'a',
    to: overrides.to ?? 'b',
    lengthKm: overrides.lengthKm ?? 1,
    highway: overrides.highway ?? 'footway',
    osmWayId: overrides.osmWayId ?? 1,
    score: overrides.score ?? 0,
    ...overrides,
  };
}

describe('terrain context surface honesty helpers', () => {
  it('keeps explicit paved surfaces paved even with high natural terrain context', () => {
    const asphaltInForest = edge({
      surface: 'asphalt',
      terrainContext: {
        source: 'ign_poc_fixture',
        landcoverClass: 'forest',
        naturalContextScore: 1,
        artificializationScore: 0,
        forestProximityM: 0,
        confidence: 'high',
        warnings: [],
      },
    });

    expect(hasExplicitPavedSurface(asphaltInForest)).toBe(true);
    expect(isSurfaceRatioPaved(asphaltInForest)).toBe(true);
  });

  it.each(['asphalt', 'concrete', 'paved', 'sett', 'paving_stones'])('%s is explicit paved for ratio accounting', (surface) => {
    expect(hasExplicitPavedSurface(edge({ surface }))).toBe(true);
  });

  it('does not treat natural context as a replacement for OSM surface classification', () => {
    const unknownPathInPark = edge({
      highway: 'path',
      terrainContext: {
        source: 'ign_poc_fixture',
        landcoverClass: 'park',
        naturalContextScore: 0.9,
        artificializationScore: 0.1,
        parkProximityM: 0,
        confidence: 'medium',
        warnings: [],
      },
    });

    expect(hasExplicitPavedSurface(unknownPathInPark)).toBe(false);
    expect(isSurfaceRatioPaved(unknownPathInPark)).toBe(false);
  });
});
