import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import {
  ENGINE_V3_BENCHMARK_CASES,
  runEngineV3BenchmarkPanel,
  type EngineV3BenchmarkCase,
} from '../lib/engine-v3/benchmark-runner';
import type { GeneratedRouteV3 } from '@/lib/engine-v3/route-generator';
import packageJson from '@/package.json';

describe('Engine V3 real OSM benchmark CLI wiring', () => {
  it('exposes RAM-safe npm scripts for the real OSM benchmark panels', () => {
    expect(packageJson.scripts['benchmark:engine-v3']).toBe(
      'node --experimental-strip-types --loader ./scripts/engine-v3-ts-loader.mjs scripts/run-engine-v3-benchmarks.ts',
    );
    expect(packageJson.scripts['benchmark:engine-v3:beta-multiterrain']).toBe(
      'node --experimental-strip-types --loader ./scripts/engine-v3-ts-loader.mjs scripts/run-engine-v3-benchmarks.ts --panel beta-multiterrain --output artifacts/engine-v3-benchmarks/beta-multiterrain-latest.json --artifact-dir artifacts/engine-v3-benchmarks/beta-multiterrain-routes',
    );
    expect(packageJson.scripts['benchmark:engine-v3:asm-3i-fontainebleau-contract']).toBe(
      'node --experimental-strip-types --loader ./scripts/engine-v3-ts-loader.mjs scripts/run-engine-v3-benchmarks.ts --panel asm-3i-fontainebleau-contract --output /tmp/trailforge-v3-asm-3i-fontainebleau-contract-latest.json --artifact-dir /tmp/trailforge-v3-asm-3i-fontainebleau-contract-routes',
    );
    expect(packageJson.scripts['benchmark:v3-golden']).toBe(
      'node --experimental-strip-types --loader ./scripts/engine-v3-ts-loader.mjs scripts/run-engine-v3-benchmarks.ts --panel asm-3-golden --output /tmp/trailforge-v3-asm-3z-latest.json --artifact-dir /tmp/trailforge-v3-asm-3z-routes',
    );
  });

  it('defaults to the two-case readiness panel requested by the autonomous board', () => {
    const source = readFileSync('scripts/run-engine-v3-benchmarks.ts', 'utf8');

    expect(source).toContain("'tourville-trail-8k'");
    expect(source).toContain("'fontainebleau-croix-augas-trail-12k'");
    expect(source).toContain('runEngineV3BenchmarkPanel');
  });

  it('documents the explicit eight-case beta-multiterrain V3 panel without changing V2.5 thresholds', () => {
    const source = readFileSync('scripts/run-engine-v3-benchmarks.ts', 'utf8');
    const requiredIds = [
      'tourville-pommiers-trail-8k',
      'tourville-pommiers-trail-12k',
      'caen-colline-aux-oiseaux-6k-soft',
      'caen-prairie-8k-mixed',
      'fontainebleau-trail-15k',
      'meudon-forest-trail-10k',
      'paris-19-canal-running',
      'osm-poor-rural-trail-8k',
    ];

    expect(source).toContain('beta-multiterrain');
    expect(source).toContain('--panel <panel-id>');
    for (const caseId of requiredIds) {
      expect(source).toContain(`'${caseId}'`);
    }
  });

  it('keeps Fontainebleau town-edge diagnostic separate from the Croix d’Augas clean-capacity case', () => {
    const byId = new Map(ENGINE_V3_BENCHMARK_CASES.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]));
    const townEdge = byId.get('fontainebleau-trail-12k');
    const croixAugas = byId.get('fontainebleau-croix-augas-trail-12k');

    expect(townEdge).toMatchObject({
      request: { start: { lat: 48.4039, lng: 2.7016 }, targetDistanceKm: 12, mode: 'trail' },
      contract: {
        role: 'diagnostic-anchor',
        expectedOutcomeTypes: ['adjusted', 'refused'],
        requiresGeometryExports: false,
      },
    });
    expect(townEdge?.description).toContain('not product-green clean 12k');
    expect(townEdge?.contract?.notes).toContain('do not weaken thresholds');

    expect(croixAugas).toMatchObject({
      request: { start: { lat: 48.4054, lng: 2.6786 }, targetDistanceKm: 12, mode: 'trail' },
      contract: {
        role: 'clean-capacity',
        expectedOutcomeTypes: ['generated', 'adjusted'],
        requiresGeometryExports: true,
      },
    });
    expect(croixAugas?.tags).toContain('clean-capacity');
    expect(croixAugas?.contract?.notes).toContain('GPX/GeoJSON present');
  });

  it('documents the compact ASM-3i Fontainebleau contract regression panel', () => {
    const source = readFileSync('scripts/run-engine-v3-benchmarks.ts', 'utf8');
    const requiredIds = [
      'fontainebleau-croix-augas-trail-12k',
      'fontainebleau-trail-12k',
      'tourville-pommiers-trail-8k',
      'caen-colline-aux-oiseaux-6k-soft',
      'paris-19-canal-running',
      'osm-poor-rural-trail-8k',
    ];

    expect(source).toContain('asm-3i-fontainebleau-contract');
    for (const caseId of requiredIds) {
      expect(source).toContain(`'${caseId}'`);
    }
  });

  it('documents the explicit ASM-3 golden V3 panel as a seven-case live benchmark gate', () => {
    const source = readFileSync('scripts/run-engine-v3-benchmarks.ts', 'utf8');
    const requiredIds = [
      'paris-buttes-chaumont-urban-nature',
      'paris-19-canal-running',
      'caen-colline-aux-oiseaux-6k-soft',
      'tourville-pommiers-trail-8k',
      'tourville-pommiers-trail-12k',
      'fontainebleau-croix-augas-trail-12k',
      'osm-poor-rural-trail-8k',
    ];

    expect(source).toContain('asm-3-golden');
    for (const caseId of requiredIds) {
      expect(source).toContain(`'${caseId}'`);
    }
  });

  it('keeps the post-URBAN Brunoy user-test regression cases runnable by id', () => {
    const byId = new Map(ENGINE_V3_BENCHMARK_CASES.map((benchmarkCase) => [benchmarkCase.id, benchmarkCase]));

    expect(byId.get('brunoy-urban-nature-8k')).toMatchObject({
      request: { start: { lat: 48.704819, lng: 2.500846 }, targetDistanceKm: 8, mode: 'nature_urbaine' },
      contract: { requiresGeometryExports: false },
    });
    expect(byId.get('brunoy-urban-nature-9_5k')).toMatchObject({
      request: { start: { lat: 48.704819, lng: 2.500846 }, targetDistanceKm: 9.5, mode: 'nature_urbaine' },
      contract: { requiresGeometryExports: false },
    });
  });

  it('marks distance-coherent benchmark geometry non-exportable when the API export validator would reject a max segment jump', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'trailforge-v3-benchmark-export-red-'));
    const artifactDir = join(tempRoot, 'routes');
    const reportPath = join(tempRoot, 'latest.json');
    const benchmark = benchmarkFixture({ id: 'distance-coherent-discontinuous', requiresGeometryExports: true });
    const generated = generatedFixture({
      outcome: 'adjusted',
      coordinates: [
        [2.6786, 48.4054],
        [2.6787, 48.4055],
        [2.6849, 48.4087],
        [2.6786, 48.4054],
      ],
      metricDistanceKm: 1.06,
    });

    try {
      const report = await runEngineV3BenchmarkPanel({
        cases: [benchmark],
        artifactDir,
        reportPath,
        graphBuilder: async () => ({ graph: {} as never, scenicWayIds: new Set() }),
        routeGenerator: () => generated,
        now: () => new Date('2026-05-21T12:00:00.000Z'),
      });

      const result = report.cases[0];
      const artifact = JSON.parse(readFileSync(result.artifacts.json, 'utf8'));

      expect(result.metrics?.distanceProducedKm).toBeCloseTo(1.06, 2);
      expect(result.exportValidity.valid).toBe(false);
      expect(result.exportValidity.maxSegmentKm).toBeGreaterThan(0.2);
      expect(result.exportInvalidReasons).toEqual(expect.arrayContaining([expect.stringContaining('max segment jump')]));
      expect(result.apiContractExportable).toBe(false);
      expect(result.gpxAvailableExpected).toBe(false);
      expect(result.benchmarkProductStatus).toBe('non_exportable');
      expect(report.summary.success).toBe(false);
      expect(report.summary.export.requiredButNonExportable).toBe(1);
      expect(artifact.exportValidity.valid).toBe(false);
      expect(artifact.apiContractExportable).toBe(false);
      expect(artifact.gpxAvailableExpected).toBe(false);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });

  it('keeps a valid generated benchmark exportable under the API export contract gate', async () => {
    const tempRoot = mkdtempSync(join(tmpdir(), 'trailforge-v3-benchmark-export-green-'));
    const artifactDir = join(tempRoot, 'routes');
    const reportPath = join(tempRoot, 'latest.json');
    const benchmark = benchmarkFixture({ id: 'valid-generated-export', requiresGeometryExports: true });
    const generated = generatedFixture({
      outcome: 'generated',
      coordinates: [
        [2.6786, 48.4054],
        [2.6791, 48.4056],
        [2.6794, 48.4052],
        [2.6786, 48.4054],
      ],
      metricDistanceKm: 0.17,
    });

    try {
      const report = await runEngineV3BenchmarkPanel({
        cases: [benchmark],
        artifactDir,
        reportPath,
        graphBuilder: async () => ({ graph: {} as never, scenicWayIds: new Set() }),
        routeGenerator: () => generated,
        now: () => new Date('2026-05-21T12:00:00.000Z'),
      });

      const result = report.cases[0];
      const artifact = JSON.parse(readFileSync(result.artifacts.json, 'utf8'));

      expect(result.exportValidity.valid).toBe(true);
      expect(result.exportInvalidReasons).toEqual([]);
      expect(result.apiContractExportable).toBe(true);
      expect(result.gpxAvailableExpected).toBe(true);
      expect(result.benchmarkProductStatus).toBe('acceptable');
      expect(report.summary.success).toBe(true);
      expect(report.summary.export.requiredButNonExportable).toBe(0);
      expect(artifact.exportValidity.valid).toBe(true);
      expect(artifact.apiContractExportable).toBe(true);
      expect(artifact.gpxAvailableExpected).toBe(true);
    } finally {
      rmSync(tempRoot, { recursive: true, force: true });
    }
  });
});

function benchmarkFixture(options: { id: string; requiresGeometryExports: boolean }): EngineV3BenchmarkCase {
  return {
    id: options.id,
    name: options.id,
    description: 'Synthetic export contract benchmark fixture.',
    request: {
      start: { lat: 48.4054, lng: 2.6786 },
      targetDistanceKm: 1,
      activity: 'running',
      mode: 'trail',
      loop: true,
    },
    tags: ['test'],
    contract: {
      role: 'clean-capacity',
      expectedOutcomeTypes: ['generated', 'adjusted'],
      requiresGeometryExports: options.requiresGeometryExports,
      notes: 'Synthetic fixture must follow API export contract.',
    },
  };
}

function generatedFixture(options: {
  outcome: 'generated' | 'adjusted';
  coordinates: [number, number][];
  metricDistanceKm: number;
}): GeneratedRouteV3 {
  return {
    engine: 'v3-clean-room',
    intent: {
      strategy: 'forest_loop',
      warnings: [],
      snapshot: { audit: { warnings: [] } },
    },
    mission: { warnings: [] },
    route: {
      edges: [],
      geometry: { type: 'LineString', coordinates: options.coordinates },
      metrics: {
        distanceProducedKm: options.metricDistanceKm,
        pavedRatio: 0,
        naturalWayRatio: 1,
      },
      warnings: [],
    },
    outcome: options.outcome === 'generated'
      ? { type: 'generated', summary: 'Generated route.' }
      : { type: 'adjusted', summary: 'Adjusted route.', compromises: [] },
    diagnostics: { warnings: [], limitations: [] },
  } as unknown as GeneratedRouteV3;
}
