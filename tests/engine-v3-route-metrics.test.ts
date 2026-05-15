import { describe, expect, it } from 'vitest';

import { computeRouteMetricsV3 } from '../lib/engine-v3/route-metrics';
import type { RouteEdgeV3, RouteGeometryV3, TerrainComponentKindV3 } from '../lib/engine-v3';

const oneKmLng = 0.008993216;

function geometry(points: number[][]): RouteGeometryV3 {
  return { type: 'LineString', coordinates: points };
}

function edge(overrides: Partial<RouteEdgeV3> & Pick<RouteEdgeV3, 'id' | 'highway' | 'surface' | 'componentKind'>): RouteEdgeV3 {
  return {
    from: `${overrides.id}-from`,
    to: `${overrides.id}-to`,
    lengthKm: 1,
    osmWayId: Number(overrides.id.replace(/\D/g, '')) || 1,
    ...overrides,
  };
}

function metrics(edges: RouteEdgeV3[], coordinates: number[][], targetComponents: TerrainComponentKindV3[] = ['forest', 'field_paths']) {
  return computeRouteMetricsV3({
    targetDistanceKm: 10,
    edges,
    geometry: geometry(coordinates),
    targetComponents,
  });
}

describe('engine V3 route metrics from final geometry', () => {
  it('measures produced distance from the ordered final route edges rather than segment estimates', () => {
    const result = metrics(
      [
        edge({ id: 'e1', highway: 'residential', surface: 'paved', componentKind: 'scenic_paved' }),
        edge({ id: 'e2', highway: 'path', surface: 'natural', componentKind: 'forest' }),
      ],
      [
        [0, 0],
        [oneKmLng, 0],
        [oneKmLng * 2, 0],
      ],
      ['forest'],
    );

    expect(result.distanceProducedKm).toBeCloseTo(2, 2);
    expect(result.pavedKm).toBeCloseTo(1, 2);
    expect(result.nonPavedKm).toBeCloseTo(1, 2);
    expect(result.pavedRatio).toBeCloseTo(0.5, 2);
    expect(result.naturalWayRatio).toBeCloseTo(0.5, 2);
    expect(result.trailRatio).toBeCloseTo(0.5, 2);
    expect(result.naturalDwellKm).toBeCloseTo(1, 2);
  });

  it('keeps scenic asphalt paved and does not promote unknown natural ways to trail', () => {
    const result = metrics(
      [
        edge({ id: 'e1', highway: 'residential', surface: 'paved', componentKind: 'scenic_paved' }),
        edge({ id: 'e2', highway: 'unclassified', surface: 'natural', componentKind: 'field_paths' }),
      ],
      [
        [0, 0],
        [oneKmLng, 0],
        [oneKmLng * 2, 0],
      ],
    );

    expect(result.pavedKm).toBeCloseTo(1, 2);
    expect(result.pavedRatio).toBeCloseTo(0.5, 2);
    expect(result.naturalWayRatio).toBeCloseTo(0.5, 2);
    expect(result.trailRatio).toBe(0);
    expect(result.longestTrailSegmentKm).toBe(0);
  });

  it('computes repeat, overlap, busy road, loop closure and longest continuous trail metrics from the final route', () => {
    const result = metrics(
      [
        edge({ id: 'busy', highway: 'secondary', surface: 'paved', componentKind: 'residential' }),
        edge({ id: 'trail-a', highway: 'path', surface: 'natural', componentKind: 'forest' }),
        edge({ id: 'trail-b', highway: 'track', surface: 'natural', componentKind: 'forest' }),
        edge({ id: 'busy', from: 'b', to: 'a', highway: 'secondary', surface: 'paved', componentKind: 'residential' }),
      ],
      [
        [0, 0],
        [oneKmLng, 0],
        [oneKmLng * 2, 0],
        [oneKmLng * 3, 0],
        [oneKmLng, 0],
      ],
      ['forest'],
    );

    expect(result.distanceProducedKm).toBeCloseTo(4, 2);
    expect(result.repeatEdgeKm).toBeCloseTo(1, 2);
    expect(result.repeatRatio).toBeCloseTo(0.25, 2);
    expect(result.overlapRatio).toBeCloseTo(0.25, 2);
    expect(result.busyRoadRatio).toBeCloseTo(0.5, 2);
    expect(result.loopClosureKm).toBeCloseTo(1, 2);
    expect(result.longestTrailSegmentKm).toBeCloseTo(2, 2);
  });
});
