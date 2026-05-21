import { describe, expect, it } from 'vitest';
import { buildGenerateRouteV3ApiResponseFromGenerated } from '@/lib/engine-v3/api-adapter';
import type { GeneratedRouteV3 } from '@/lib/engine-v3/route-generator';

const baseGenerated = {
  engine: 'v3-clean-room',
  intent: { strategy: 'urban_nature_loop' },
  mission: {},
  route: {
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
});
