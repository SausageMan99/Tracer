import { describe, expect, it } from 'vitest';

import {
  summarizeEngineV3BenchmarkReport,
  renderEngineV3BenchmarkSummaryMarkdown,
} from '../lib/engine-v3/benchmark-summary';

const baseMetrics = {
  targetDistanceKm: 8,
  distanceProducedKm: 0,
  trailRatio: 0,
  naturalWayRatio: 0,
  pavedRatio: 1,
  naturalDwellKm: 0,
  longestTrailSegmentKm: 0,
  repeatEdgeKm: 0,
  targetRepeatKm: 0,
  connectorRepeatKm: 0,
  busyRoadRatio: 0,
};

describe('Engine V3 benchmark CTO summary', () => {
  it('extracts CTO-readable fields, best rejected candidate, and honest refusal verdicts without treating refusal as technical failure', () => {
    const summary = summarizeEngineV3BenchmarkReport({
      engine: 'v3-clean-room',
      panelKind: 'real-osm-overpass',
      generatedAt: '2026-05-19T06:36:59.388Z',
      summary: { success: true, total: 1, byOutcome: { generated: 0, adjusted: 0, refused: 1, errored: 0 } },
      cases: [
        {
          id: 'tourville-pommiers-trail-8k',
          name: 'Tourville Pommiers 8k',
          outcome: { type: 'refused', reason: 'poor graph evidence' },
          outcomeReasons: ['poor graph evidence', 'no assembled route evidence'],
          metrics: baseMetrics,
          warnings: ['Paved/asphalt evidence remains paved and is not reclassified as trail.'],
          artifacts: { json: '/tmp/tourville.json', geojson: '/tmp/tourville.geojson', gpx: '/tmp/tourville.gpx' },
          timings: { totalMs: 123, graphMs: 1, generationMs: 120, artifactMs: 2 },
          diagnostics: {
            assemblyDiagnostics: {
              topRejected: [
                {
                  id: 'candidate-a',
                  rank: 1,
                  distanceKm: 5.261,
                  naturalDwellKm: 0,
                  pavedRatio: 0.881,
                  repeatKm: 0.648,
                  targetRepeatKm: 0,
                  connectorRepeatKm: 0.648,
                  busyRoadRatio: 0.084,
                  rejectedReason: 'candidate is not a returned loop',
                },
              ],
            },
          },
        },
      ],
    });

    expect(summary.verdictCounts).toEqual({
      good_route: 0,
      acceptable_adjusted: 0,
      honest_refusal: 1,
      engine_failure: 0,
      fake_success: 0,
    });
    expect(summary.cases[0]).toMatchObject({
      id: 'tourville-pommiers-trail-8k',
      outcome: 'refused',
      verdict: 'honest_refusal',
      targetDistanceKm: 8,
      distanceProducedKm: 0,
      trailRatio: 0,
      naturalWayRatio: 0,
      pavedRatio: 1,
      naturalDwellKm: 0,
      longestTrailSegmentKm: 0,
      repeatEdgeKm: 0,
      targetRepeatKm: 0,
      connectorRepeatKm: 0,
      busyRoadRatio: 0,
      rejectionReason: 'poor graph evidence',
      bestRejectedCandidate: {
        id: 'candidate-a',
        distanceKm: 5.261,
        naturalDwellKm: 0,
        pavedRatio: 0.881,
        rejectionReason: 'candidate is not a returned loop',
      },
    });
  });

  it('labels generated or adjusted under-distance/no-geometry cases as fake success and errored cases as engine failures', () => {
    const summary = summarizeEngineV3BenchmarkReport({
      engine: 'v3-clean-room',
      panelKind: 'real-osm-overpass',
      generatedAt: '2026-05-19T06:36:59.388Z',
      summary: { success: false, total: 2, byOutcome: { generated: 1, adjusted: 0, refused: 0, errored: 1 } },
      cases: [
        {
          id: 'fake-generated',
          name: 'Fake generated',
          outcome: { type: 'generated', summary: 'route generated' },
          outcomeReasons: ['route generated'],
          metrics: { ...baseMetrics, targetDistanceKm: 10, distanceProducedKm: 1, pavedRatio: 0.1 },
          warnings: [],
          artifacts: { json: '/tmp/fake.json', geojson: '/tmp/fake.geojson', gpx: '/tmp/fake.gpx' },
          timings: { totalMs: 1, graphMs: 1, generationMs: 1, artifactMs: 1 },
        },
        {
          id: 'errored-case',
          name: 'Errored case',
          outcome: { type: 'errored', reason: 'Overpass failed' },
          outcomeReasons: ['Overpass failed'],
          metrics: null,
          warnings: [],
          artifacts: { json: '/tmp/error.json', geojson: '/tmp/error.geojson', gpx: '/tmp/error.gpx' },
          timings: { totalMs: 1, graphMs: 1, generationMs: 1, artifactMs: 1 },
        },
      ],
    });

    expect(summary.verdictCounts.fake_success).toBe(1);
    expect(summary.verdictCounts.engine_failure).toBe(1);
    expect(summary.cases.map((entry) => entry.verdict)).toEqual(['fake_success', 'engine_failure']);
  });

  it('renders a markdown table that separates command success from product verdicts', () => {
    const markdown = renderEngineV3BenchmarkSummaryMarkdown({
      sourceReport: 'artifacts/engine-v3-benchmarks/beta-multiterrain-latest.json',
      engine: 'v3-clean-room',
      panelKind: 'real-osm-overpass',
      generatedAt: '2026-05-19T06:36:59.388Z',
      harnessSuccess: true,
      outcomeCounts: { generated: 0, adjusted: 0, refused: 1, errored: 0 },
      verdictCounts: { good_route: 0, acceptable_adjusted: 0, honest_refusal: 1, engine_failure: 0, fake_success: 0 },
      cases: [
        {
          id: 'tourville-pommiers-trail-8k',
          name: 'Tourville Pommiers 8k',
          outcome: 'refused',
          verdict: 'honest_refusal',
          targetDistanceKm: 8,
          distanceProducedKm: 0,
          trailRatio: 0,
          naturalWayRatio: 0,
          pavedRatio: 1,
          naturalDwellKm: 0,
          longestTrailSegmentKm: 0,
          repeatEdgeKm: 0,
          targetRepeatKm: 0,
          connectorRepeatKm: 0,
          busyRoadRatio: 0,
          bestRejectedCandidate: null,
          rejectionReason: 'poor graph evidence',
          artifacts: { json: '/tmp/tourville.json', geojson: '/tmp/tourville.geojson', gpx: '/tmp/tourville.gpx' },
        },
      ],
    });

    expect(markdown).toContain('Commande benchmark réussie: oui');
    expect(markdown).toContain('| tourville-pommiers-trail-8k | refused | honest_refusal |');
    expect(markdown).toContain('Fake success: aucun');
    expect(markdown).toContain('Engine failure: aucun');
  });
});
