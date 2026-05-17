import { existsSync, mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  compareEngineSamples,
  runEngineComparison,
  sampleFromV25BenchmarkSummary,
  type EngineSample,
} from '@/lib/engine-v3/comparison';
import { BENCHMARK_CASES } from '@/lib/route-benchmarks';

const benchmark = BENCHMARK_CASES.find((candidate) => candidate.id === 'tourville-pommiers-trail-8k') ?? BENCHMARK_CASES[0];

function sample(overrides: Partial<EngineSample>): EngineSample {
  return {
    engine: overrides.engine ?? 'v2.5',
    outcome: overrides.outcome ?? 'generated',
    distanceKm: overrides.distanceKm ?? 8,
    targetDistanceKm: overrides.targetDistanceKm ?? 8,
    distanceErrorRatio: overrides.distanceErrorRatio ?? 0.02,
    pavedRatio: overrides.pavedRatio ?? 0.25,
    naturalWayRatio: overrides.naturalWayRatio ?? 0.65,
    trailRatio: overrides.trailRatio ?? 0.35,
    repeatRatio: overrides.repeatRatio ?? 0.03,
    durationMs: overrides.durationMs ?? 10_000,
    gpxAvailable: overrides.gpxAvailable ?? true,
    geometryAvailable: overrides.geometryAvailable ?? true,
    reason: overrides.reason ?? ['ok'],
    opportunityCaptureScore: overrides.opportunityCaptureScore ?? 0.7,
    terrainTruthScore: overrides.terrainTruthScore ?? 0.68,
    raw: overrides.raw,
  };
}

describe('V2.5/V3 terrain-aware comparison harness', () => {
  it('marks V3 better when product outcome and terrain evidence improve without export regression', () => {
    const verdict = compareEngineSamples(
      sample({ engine: 'v2.5', outcome: 'adjusted', terrainTruthScore: 0.55, opportunityCaptureScore: 0.5 }),
      sample({ engine: 'v3', outcome: 'generated', pavedRatio: 0.16, naturalWayRatio: 0.78, terrainTruthScore: 0.78, opportunityCaptureScore: 0.8 }),
    );

    expect(verdict.label).toBe('v3_better');
    expect(verdict.productOutcomeDelta).toBe('better');
    expect(verdict.exportRegression).toBe(false);
  });

  it('marks V3 worse when V2.5 has a usable exported route and V3 refuses', () => {
    const verdict = compareEngineSamples(
      sample({ engine: 'v2.5', outcome: 'generated', gpxAvailable: true, geometryAvailable: true }),
      sample({ engine: 'v3', outcome: 'refused', distanceKm: null, distanceErrorRatio: null, gpxAvailable: false, geometryAvailable: false, terrainTruthScore: 0 }),
    );

    expect(verdict.label).toBe('v3_worse');
    expect(verdict.productOutcomeDelta).toBe('worse');
    expect(verdict.exportRegression).toBe(true);
    expect(verdict.reason.join(' ')).toContain('assembly/product weakness');
  });

  it('does not describe an errored V2.5 sample as usable route evidence', () => {
    const verdict = compareEngineSamples(
      sample({ engine: 'v2.5', outcome: 'errored', gpxAvailable: false, geometryAvailable: false, distanceKm: null, distanceErrorRatio: null }),
      sample({ engine: 'v3', outcome: 'refused', gpxAvailable: false, geometryAvailable: false, distanceKm: null, distanceErrorRatio: null }),
    );

    expect(verdict.label).toBe('errored');
    expect(verdict.reason.join(' ')).not.toContain('V2.5 produced route evidence');
  });

  it('keeps equivalent refusal equivalent even if V3 is faster', () => {
    const verdict = compareEngineSamples(
      sample({ engine: 'v2.5', outcome: 'refused', durationMs: 90_000, gpxAvailable: false, geometryAvailable: false }),
      sample({ engine: 'v3', outcome: 'refused', durationMs: 2_000, gpxAvailable: false, geometryAvailable: false }),
    );

    expect(verdict.label).toBe('v3_equivalent');
    expect(verdict.productOutcomeDelta).toBe('equivalent');
    expect(verdict.reason.join(' ')).toContain('speed alone does not make V3 better');
  });

  it('keeps V2.5 route/export evidence even when benchmark hard gates fail', () => {
    const v25 = sampleFromV25BenchmarkSummary(benchmark, {
      id: benchmark.id,
      label: benchmark.label,
      tags: benchmark.tags ?? [],
      passed: false,
      failures: ['geometry_self_intersection'],
      metrics: {
        expectedOutcome: 'exact_distance',
        actualOutcome: 'route_success',
        distanceKm: 8,
        ascendM: 120,
        distanceErrorRatio: 0.01,
        elevationErrorM: 2,
        productionScore: 0.8,
        loopClosureKm: 0.02,
        busyRoadRatio: 0.01,
        trailRatio: 0.35,
        naturalWayRatio: 0.7,
        pavedRatio: 0.2,
        scenicPavedRatio: 0,
        trailBeautyScore: 0.7,
        longestTrailSegmentKm: 2.4,
        naturalCorridorRatio: 0.55,
        repeatEdgeRatio: 0.02,
        uTurnRatio: 0,
        terrainDataConfidence: 'high',
        trailPotential: 'high',
        routeTrailQuality: 'medium',
        durationMs: 12000,
        warnings: [],
        elevationErrorPct: 0.02,
        elevationWithinTolerance: true,
        elevationDiagnosticCode: null,
        geometry: {
          loopCompactness: 0.14,
          geometryOverlapRatio: 0.02,
          selfIntersectionCount: 1,
          sharpTurnDensityPerKm: 1,
          headingReversalRatio: 0.02,
          outAndBackSimilarityRatio: 0.04,
          startStemKm: 0.03,
          endStemKm: 0.03,
          maxDistanceFromStartKm: 2,
        },
      },
    });

    expect(v25.outcome).toBe('generated');
    expect(v25.gpxAvailable).toBe(true);
    expect(v25.geometryAvailable).toBe(true);
  });

  it('runs both engines with the same request and writes aggregate plus per-case artifacts', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'engine-comparison-'));
    const outputPath = join(dir, 'report.json');
    const artifactDir = join(dir, 'cases');
    const requests: unknown[] = [];

    const report = await runEngineComparison({
      cases: [benchmark],
      outputPath,
      artifactDir,
      baseUrl: 'http://example.test',
      runV25: async ({ request }) => {
        requests.push(request);
        return sample({ engine: 'v2.5' });
      },
      runV3: async ({ request }) => {
        requests.push(request);
        return sample({ engine: 'v3', naturalWayRatio: 0.72, terrainTruthScore: 0.75 });
      },
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(requests).toHaveLength(2);
    expect(requests[0]).toEqual(requests[1]);
    expect(report.total).toBe(1);
    expect(report.cases[0].artifactPath).toContain(`${benchmark.id}.comparison.json`);
    expect(JSON.parse(readFileSync(outputPath, 'utf8')).summary).toEqual(report.summary);
    expect(JSON.parse(readFileSync(join(artifactDir, `${benchmark.id}.comparison.json`), 'utf8')).id).toBe(benchmark.id);
  });

  it('writes an incremental aggregate report after each completed case', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'engine-comparison-incremental-'));
    const outputPath = join(dir, 'report.json');
    const artifactDir = join(dir, 'cases');
    const cases = BENCHMARK_CASES.filter((candidate) => [
      'tourville-pommiers-trail-8k',
      'fontainebleau-trail-15k',
    ].includes(candidate.id));

    const report = await runEngineComparison({
      cases,
      outputPath,
      artifactDir,
      baseUrl: 'http://example.test',
      runV25: async () => sample({ engine: 'v2.5' }),
      runV3: async ({ benchmark: currentBenchmark }) => {
        if (currentBenchmark.id === 'fontainebleau-trail-15k') {
          expect(existsSync(outputPath)).toBe(true);
          const partial = JSON.parse(readFileSync(outputPath, 'utf8'));
          expect(partial.total).toBe(1);
          expect(partial.cases.map((item: { id: string }) => item.id)).toEqual(['tourville-pommiers-trail-8k']);
        }
        return sample({ engine: 'v3' });
      },
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(report.total).toBe(2);
    expect(JSON.parse(readFileSync(outputPath, 'utf8')).total).toBe(2);
  });

  it('weights true forest trail regressions above negative impossible wins in the global verdict', async () => {
    const forest = BENCHMARK_CASES.find((candidate) => candidate.id === 'fontainebleau-trail-15k')!;
    const negative = BENCHMARK_CASES.find((candidate) => candidate.id === 'paris-buttes-chaumont-5k-constrained')!;

    const report = await runEngineComparison({
      cases: [forest, negative],
      writeArtifacts: false,
      runV25: async ({ benchmark: currentBenchmark }) => currentBenchmark.id === forest.id
        ? sample({ engine: 'v2.5', outcome: 'generated', gpxAvailable: true, geometryAvailable: true })
        : sample({ engine: 'v2.5', outcome: 'refused', gpxAvailable: false, geometryAvailable: false }),
      runV3: async ({ benchmark: currentBenchmark }) => currentBenchmark.id === forest.id
        ? sample({ engine: 'v3', outcome: 'refused', distanceKm: null, distanceErrorRatio: null, gpxAvailable: false, geometryAvailable: false, terrainTruthScore: 0 })
        : sample({ engine: 'v3', outcome: 'generated', gpxAvailable: true, geometryAvailable: true, terrainTruthScore: 0.8 }),
      now: () => new Date('2026-01-01T00:00:00.000Z'),
    });

    expect(report.overallVerdict.label).toBe('red');
    expect(report.overallVerdict.reason.join(' ')).toContain('true_forest_trail');
    expect(report.panelSummary.true_forest_trail.weightedScore).toBeLessThan(0);
  });

  it('exposes the one-command npm script', () => {
    const packageJson = JSON.parse(readFileSync('package.json', 'utf8'));
    expect(packageJson.scripts['benchmark:engine-v25-v3']).toBe('node scripts/compare-engine-v25-v3.mjs');
  });
});
