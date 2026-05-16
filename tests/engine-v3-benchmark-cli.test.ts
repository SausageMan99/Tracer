import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

import packageJson from '@/package.json';

describe('Engine V3 real OSM benchmark CLI wiring', () => {
  it('exposes a RAM-safe npm script for the real OSM benchmark panel', () => {
    expect(packageJson.scripts['benchmark:engine-v3']).toBe(
      'node --experimental-strip-types --loader ./scripts/engine-v3-ts-loader.mjs scripts/run-engine-v3-benchmarks.ts',
    );
  });

  it('defaults to the two-case readiness panel requested by the autonomous board', () => {
    const source = readFileSync('scripts/run-engine-v3-benchmarks.ts', 'utf8');

    expect(source).toContain("'tourville-trail-8k'");
    expect(source).toContain("'fontainebleau-trail-12k'");
    expect(source).toContain('runEngineV3BenchmarkPanel');
  });
});
