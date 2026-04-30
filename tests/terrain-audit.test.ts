import { describe, expect, it } from 'vitest';
import { createEmptyTerrainAuditReport } from '../lib/engine/terrain-audit';

describe('terrain audit', () => {
  it('creates an empty report with conservative defaults', () => {
    const report = createEmptyTerrainAuditReport();

    expect(report.confidence).toBe('low');
    expect(report.trailPotential).toBe('low');
    expect(report.metrics.totalEdges).toBe(0);
    expect(report.warnings).toContain('Aucune donnée routable analysée.');
  });
});
