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
});
