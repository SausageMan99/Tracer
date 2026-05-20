import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import packageJson from '@/package.json';

describe('Engine V3 real OSM benchmark CLI wiring', () => {
  it('exposes RAM-safe npm scripts for the real OSM benchmark panels', () => {
    expect(packageJson.scripts['benchmark:engine-v3']).toBe(
      'node --experimental-strip-types --loader ./scripts/engine-v3-ts-loader.mjs scripts/run-engine-v3-benchmarks.ts',
    );
    expect(packageJson.scripts['benchmark:engine-v3:beta-multiterrain']).toBe(
      'node --experimental-strip-types --loader ./scripts/engine-v3-ts-loader.mjs scripts/run-engine-v3-benchmarks.ts --panel beta-multiterrain --output artifacts/engine-v3-benchmarks/beta-multiterrain-latest.json --artifact-dir artifacts/engine-v3-benchmarks/beta-multiterrain-routes',
    );
  });

  it('defaults to the two-case readiness panel requested by the autonomous board', () => {
    const source = readFileSync('scripts/run-engine-v3-benchmarks.ts', 'utf8');

    expect(source).toContain("'tourville-trail-8k'");
    expect(source).toContain("'fontainebleau-trail-12k'");
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
});
