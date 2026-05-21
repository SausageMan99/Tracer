import { describe, expect, it } from 'vitest';
import { buildGenerateRouteV3ApiResponseFromGenerated } from '@/lib/engine-v3/api-adapter';
import type { GeneratedRouteV3 } from '@/lib/engine-v3/route-generator';
import type { RouteEdgeV3 } from '@/lib/engine-v3/types';

const baseGenerated = {
  engine: 'v3-clean-room',
  intent: { strategy: 'urban_nature_loop' },
  mission: {},
  route: {
    edges: [],
    geometry: {
      type: 'LineString',
      coordinates: [
        [2.4921, 48.6901],
        [2.4924, 48.6902],
        [2.5288, 48.7082],
        [2.4921, 48.6901],
      ],
    },
    metrics: { distanceProducedKm: 8.11 },
  },
  outcome: {
    type: 'adjusted',
    productLabel: 'adjusted_urban_nature',
    summary: 'Urban-nature route adjusted to local capacity.',
    compromises: [],
  },
  diagnostics: {
    warnings: [],
    limitations: [],
  },
} as unknown as GeneratedRouteV3;

describe('buildGenerateRouteV3ApiResponseFromGenerated', () => {
  it('blocks gpxAvailable and success geometry when V3 export geometry is discontinuous', () => {
    const response = buildGenerateRouteV3ApiResponseFromGenerated(baseGenerated);

    expect(response.betaOutcome).toBe('refused');
    expect(response.gpxAvailable).toBe(false);
    expect(response.routeGeoJson).toBeNull();
    expect(response.reason).toContain('EXPORT_GEOMETRY_INVALID');
    expect(response.warnings).toEqual(expect.arrayContaining([
      expect.stringContaining('V3 export geometry invalid'),
    ]));
  });

  it('keeps API geometry exportable for a true long OSM dirt track edge with matching evidence', () => {
    const generated = {
      ...baseGenerated,
      intent: { strategy: 'forest_loop' },
      route: {
        ...baseGenerated.route,
        edges: [
          edgeFixture({
            id: '1508627493-12901975860-808733631',
            lengthKm: 0.4795076331293016,
            highway: 'track',
            surface: 'natural',
            osmSurface: 'dirt',
            osmWayId: 808733631,
          }),
          edgeFixture({
            id: '808733631-12901975860-1508627493',
            lengthKm: 0.4795076331293016,
            highway: 'track',
            surface: 'natural',
            osmSurface: 'dirt',
            osmWayId: 808733631,
          }),
        ],
        geometry: {
          type: 'LineString',
          coordinates: [
            [2.6679871, 48.4048174],
            [2.6673907, 48.4005233],
            [2.6679871, 48.4048174],
          ],
        },
        metrics: { distanceProducedKm: 0.9590152662586032 },
      },
      outcome: {
        type: 'generated',
        productLabel: 'generated_trail',
        summary: 'Trail generated.',
      },
    } as unknown as GeneratedRouteV3;

    const response = buildGenerateRouteV3ApiResponseFromGenerated(generated);

    expect(response.betaOutcome).toBe('generated');
    expect(response.gpxAvailable).toBe(true);
    expect(response.routeGeoJson?.geometry.coordinates).toEqual(generated.route.geometry.coordinates);
    expect(response.reason).not.toContain('EXPORT_GEOMETRY_INVALID');
  });
});

function edgeFixture(overrides: Partial<RouteEdgeV3>): RouteEdgeV3 {
  return {
    id: overrides.id ?? 'edge-1',
    from: overrides.from ?? 'from-node',
    to: overrides.to ?? 'to-node',
    lengthKm: overrides.lengthKm ?? 0.48,
    surface: overrides.surface ?? 'natural',
    componentKind: overrides.componentKind ?? 'forest',
    highway: overrides.highway ?? 'track',
    osmWayId: overrides.osmWayId ?? 123,
    osmSurface: overrides.osmSurface,
  };
}
