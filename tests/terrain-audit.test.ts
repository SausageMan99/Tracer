import { describe, expect, it } from 'vitest';
import type { EnrichedEdge } from '../lib/types';
import { auditTerrainData, createEmptyTerrainAuditReport } from '../lib/engine/terrain-audit';

function edge(overrides: Partial<EnrichedEdge>): EnrichedEdge {
  return {
    id: overrides.id ?? `${overrides.from ?? 'a'}-${overrides.to ?? 'b'}`,
    from: overrides.from ?? 'a',
    to: overrides.to ?? 'b',
    lengthKm: overrides.lengthKm ?? 1,
    highway: overrides.highway ?? 'path',
    osmWayId: overrides.osmWayId ?? 1,
    score: overrides.score ?? 0,
    ...overrides,
  };
}

describe('terrain audit', () => {
  it('creates an empty report with conservative defaults', () => {
    const report = createEmptyTerrainAuditReport();

    expect(report.confidence).toBe('low');
    expect(report.trailPotential).toBe('low');
    expect(report.metrics.totalEdges).toBe(0);
    expect(report.warnings).toContain('Aucune donnée routable analysée.');
  });

  it('computes path, surface, asphalt and scenic ratios', () => {
    const report = auditTerrainData([
      edge({ highway: 'path', surface: 'ground', scenic: true }),
      edge({ highway: 'track' }),
      edge({ highway: 'residential', surface: 'asphalt' }),
      edge({ highway: 'footway', surface: 'concrete' }),
    ]);

    expect(report.metrics.totalEdges).toBe(4);
    expect(report.metrics.pathLikeEdgeRatio).toBe(0.75);
    expect(report.metrics.naturalSurfaceRatio).toBe(0.25);
    expect(report.metrics.unknownSurfaceRatio).toBe(0.25);
    expect(report.metrics.asphaltRatio).toBe(0.25);
    expect(report.metrics.scenicEdgeRatio).toBe(0.25);
  });

  it('classifies high trail potential when path-like and scenic signals are strong', () => {
    const report = auditTerrainData([
      edge({ highway: 'path', surface: 'ground', scenic: true }),
      edge({ highway: 'track', surface: 'unpaved', scenic: true }),
      edge({ highway: 'path', surface: 'earth' }),
      edge({ highway: 'residential', surface: 'asphalt' }),
    ]);

    expect(report.trailPotential).toBe('high');
  });

  it('classifies low trail potential when graph is asphalt-road heavy', () => {
    const report = auditTerrainData([
      edge({ highway: 'residential', surface: 'asphalt' }),
      edge({ highway: 'tertiary', surface: 'asphalt' }),
      edge({ highway: 'secondary', surface: 'asphalt' }),
      edge({ highway: 'footway', surface: 'asphalt' }),
    ]);

    expect(report.trailPotential).toBe('low');
    expect(report.warnings).toContain('Zone très routière pour une boucle trail.');
  });

  it('keeps confidence medium when trail potential is good but surfaces are poorly tagged', () => {
    const report = auditTerrainData([
      edge({ highway: 'path', scenic: true }),
      edge({ highway: 'track', scenic: true }),
      edge({ highway: 'path' }),
      edge({ highway: 'residential', surface: 'asphalt' }),
    ]);

    expect(report.trailPotential).toBe('high');
    expect(report.confidence).toBe('medium');
    expect(report.warnings).toContain('Beaucoup de chemins existent mais les surfaces OSM sont peu renseignées.');
  });

  it('detects low fragmentation when natural edges form a continuous corridor', () => {
    const report = auditTerrainData([
      edge({ from: 'a', to: 'b', highway: 'path', surface: 'ground', scenic: true }),
      edge({ from: 'b', to: 'c', highway: 'path', surface: 'ground', scenic: true }),
      edge({ from: 'c', to: 'd', highway: 'track', surface: 'unpaved', scenic: true }),
    ]);

    expect(report.metrics.fragmentationScore).toBeLessThan(0.35);
  });

  it('detects high fragmentation when natural edges are isolated', () => {
    const report = auditTerrainData([
      edge({ from: 'a', to: 'b', highway: 'path', surface: 'ground', scenic: true }),
      edge({ from: 'c', to: 'd', highway: 'path', surface: 'ground', scenic: true }),
      edge({ from: 'e', to: 'f', highway: 'track', surface: 'unpaved', scenic: true }),
    ]);

    expect(report.metrics.fragmentationScore).toBeGreaterThan(0.65);
    expect(report.warnings).toContain('Les chemins naturels semblent fragmentés autour du départ.');
  });
});
