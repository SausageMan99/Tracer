import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { buildIgnPocArtifact, writeIgnPocArtifact } from '../lib/ign-poc-artifacts.mjs';

const edges = [
  {
    edgeId: 'paved-park',
    osmWayId: 1001,
    highway: 'footway',
    surface: 'asphalt',
    lengthKm: 0.4,
    score: 0.8,
    terrainContext: {
      source: 'ign_poc_fixture',
      landcoverClass: 'park',
      naturalContextScore: 0.9,
      artificializationScore: 0.1,
      confidence: 'medium',
      warnings: ['EXPLICIT_PAVED_IN_NATURAL_CONTEXT'],
    },
    hugeDebugField: 'must be stripped',
  },
  {
    edgeId: 'forest-path',
    osmWayId: 1002,
    highway: 'path',
    surface: 'ground',
    lengthKm: 0.6,
    score: 0.9,
    terrainContext: {
      source: 'ign_poc_fixture',
      landcoverClass: 'forest',
      naturalContextScore: 1,
      artificializationScore: 0,
      confidence: 'high',
      warnings: [],
    },
  },
];

describe('IGN POC artifacts', () => {
  it('summarizes terrain context separately from surface flags', () => {
    const artifact = buildIgnPocArtifact({ caseId: 'caen-colline-aux-oiseaux-6k-soft', edges, generatedAt: '2026-05-12T00:00:00.000Z' });

    expect(artifact.summary.edges).toBe(2);
    expect(artifact.summary.withHighNaturalContext).toBe(2);
    expect(artifact.summary.explicitPavedInNaturalContextKm).toBe(0.4);
    expect(artifact.summary.parkContextKm).toBe(0.4);
    expect(artifact.summary.forestContextKm).toBe(0.6);
    expect(artifact.edgeDiagnostics[0]).toEqual({
      edgeId: 'paved-park',
      osmWayId: 1001,
      highway: 'footway',
      surface: 'asphalt',
      lengthKm: 0.4,
      terrainContext: edges[0].terrainContext,
    });
    expect(JSON.stringify(artifact)).not.toContain('hugeDebugField');
  });

  it('writes a readable per-case artifact file', () => {
    const dir = mkdtempSync(join(tmpdir(), 'ign-poc-artifact-'));
    const path = writeIgnPocArtifact({ caseId: 'tourville-pommiers-trail-8k', edges, artifactDir: dir, generatedAt: '2026-05-12T00:00:00.000Z' });
    const parsed = JSON.parse(readFileSync(path, 'utf8'));

    expect(path.endsWith('tourville-pommiers-trail-8k.ign-edge-context.json')).toBe(true);
    expect(parsed.caseId).toBe('tourville-pommiers-trail-8k');
    expect(parsed.edgeDiagnostics).toHaveLength(2);
  });
});
