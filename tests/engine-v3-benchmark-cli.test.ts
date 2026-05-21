import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import { ENGINE_V3_BENCHMARK_CASES } from '../lib/engine-v3/benchmark-runner';
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
});
