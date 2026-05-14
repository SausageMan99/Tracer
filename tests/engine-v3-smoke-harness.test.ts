import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

import { ENGINE_V3_SMOKE_CASES, runEngineV3SmokePanel } from '../lib/engine-v3/smoke-harness';

describe('engine V3 isolated smoke harness', () => {
  it('runs the five Wave 3 smoke cases through generateRouteV3 and writes a lightweight diagnostic artifact', () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'engine-v3-smoke-'));
    const artifactPath = join(artifactDir, 'panel.json');

    try {
      const report = runEngineV3SmokePanel({ writeArtifactPath: artifactPath });

      expect(ENGINE_V3_SMOKE_CASES.map((smokeCase) => smokeCase.caseId)).toEqual([
        'tourville-like-transition-to-woods',
        'fontainebleau-like-forest-loop',
        'caen-park-short-loop',
        'paris-urban-nature',
        'poor-rural-refusal',
      ]);
      expect(report.engine).toBe('v3-clean-room');
      expect(report.cases).toHaveLength(5);
      expect(report.cases.map((result) => result.caseId)).toEqual(ENGINE_V3_SMOKE_CASES.map((smokeCase) => smokeCase.caseId));

      for (const result of report.cases) {
        expect(result.name).toEqual(expect.any(String));
        expect(result.outcome.type).toMatch(/generated|adjusted|refused/);
        expect(result.intent.strategy).toEqual(expect.any(String));
        expect(result.intent.constraints).toEqual(expect.objectContaining({ targetDistanceKm: expect.any(Number) }));
        expect(result.mission).toEqual(expect.objectContaining({ returnMode: expect.any(String) }));
        expect(result.metrics).toEqual(expect.objectContaining({
          targetDistanceKm: expect.any(Number),
          distanceProducedKm: expect.any(Number),
          pavedRatio: expect.any(Number),
          naturalWayRatio: expect.any(Number),
          naturalDwellKm: expect.any(Number),
        }));
        expect(result).not.toHaveProperty('edgeDiagnostics');
      }

      const byId = Object.fromEntries(report.cases.map((result) => [result.caseId, result]));

      expect(byId['tourville-like-transition-to-woods']).toMatchObject({
        outcome: { type: 'adjusted' },
        intent: { strategy: 'transition_to_woods' },
        mission: { anchor: { componentId: 'tourville-woods' }, returnMode: 'out_and_back_connector' },
      });
      expect(byId['tourville-like-transition-to-woods'].reasonsOrCompromises).toContain('paved connectors may be required before non-paved terrain');

      expect(byId['fontainebleau-like-forest-loop']).toMatchObject({
        outcome: { type: 'generated' },
        intent: { strategy: 'forest_loop' },
        mission: { anchor: { componentId: 'fontainebleau-forest' }, returnMode: 'clean_loop' },
      });
      expect(byId['fontainebleau-like-forest-loop'].metrics.naturalDwellKm).toBeGreaterThan(7);

      expect(byId['caen-park-short-loop'].outcome.type).toMatch(/generated|adjusted/);
      expect(byId['caen-park-short-loop']).toMatchObject({
        intent: { strategy: 'park_loop' },
        mission: { anchor: { componentId: 'caen-park' } },
      });

      expect(byId['paris-urban-nature'].outcome.type).toMatch(/generated|adjusted/);
      expect(byId['paris-urban-nature']).toMatchObject({ intent: { strategy: 'urban_nature_loop' } });
      expect(byId['paris-urban-nature'].intent.constraints.targetComponents).not.toContain('forest');

      expect(byId['poor-rural-refusal']).toMatchObject({
        outcome: { type: 'refused' },
        intent: { strategy: 'unroutable' },
      });
      expect(byId['poor-rural-refusal'].metrics.distanceProducedKm).toBe(0);
      expect(byId['poor-rural-refusal'].reasonsOrCompromises.join(' ')).toContain('unroutable');

      const artifact = JSON.parse(readFileSync(artifactPath, 'utf8'));
      expect(artifact).toEqual(report);
    } finally {
      rmSync(artifactDir, { recursive: true, force: true });
    }
  });
});
