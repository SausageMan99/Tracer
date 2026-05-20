import { describe, expect, it } from 'vitest';
import type { EnrichedEdge } from '@/lib/types';
import { classifyEdgeSemanticsV3 } from '@/lib/engine-v3/edge-semantics';
import { computeRouteMetricsV3 } from '@/lib/engine-v3/route-metrics';
import type { RouteEdgeV3 } from '@/lib/engine-v3/types';

function edge(overrides: Partial<EnrichedEdge>): EnrichedEdge {
  return {
    id: 'e1',
    from: 'a',
    to: 'b',
    lengthKm: 1,
    highway: 'path',
    surface: undefined,
    scenic: false,
    osmWayId: 1,
    score: 0.5,
    ...overrides,
  };
}

describe('classifyEdgeSemanticsV3', () => {
  it('keeps asphalt forest paths paved and never strict trail', () => {
    const semantics = classifyEdgeSemanticsV3(edge({
      highway: 'path',
      surface: 'asphalt',
      scenic: true,
      terrainContext: { source: 'ign_poc_fixture', landcoverClass: 'forest', naturalContextScore: 0.9, artificializationScore: 0.1, confidence: 'high', warnings: [] },
    }));

    expect(semantics.surfaceEvidence).toBe('explicit_paved');
    expect(semantics.routeSurface).toBe('paved');
    expect(semantics.pavedEquivalentWeight).toBe(1);
    expect(semantics.isStrictTrailLike).toBe(false);
    expect(semantics.isConnectorLike).toBe(true);
    expect(semantics.componentKind).toBe('forest');
  });

  it('keeps unknown track as path_track_unknown, not strict natural trail', () => {
    const semantics = classifyEdgeSemanticsV3(edge({
      highway: 'track',
      surface: undefined,
      terrainContext: { source: 'ign_poc_fixture', landcoverClass: 'forest', naturalContextScore: 0.9, artificializationScore: 0.1, confidence: 'high', warnings: [] },
    }));

    expect(semantics.surfaceEvidence).toBe('path_track_unknown');
    expect(semantics.routeSurface).toBe('mixed');
    expect(semantics.pavedEquivalentWeight).toBe(0.5);
    expect(semantics.candidateNaturalWeight).toBe(0.85);
    expect(semantics.isUnverifiedTrailCandidate).toBe(true);
    expect(semantics.isStrictTrailLike).toBe(false);
  });

  it('classifies gravel and dirt paths as explicit natural strict trail', () => {
    for (const surface of ['gravel', 'dirt']) {
      const semantics = classifyEdgeSemanticsV3(edge({ highway: 'path', surface }));
      expect(semantics.surfaceEvidence).toBe('explicit_natural');
      expect(semantics.routeSurface).toBe('natural');
      expect(semantics.pavedEquivalentWeight).toBe(0);
      expect(semantics.isStrictTrailLike).toBe(true);
    }
  });

  it('treats residential unknown as road_like_unknown and paved-equivalent', () => {
    const semantics = classifyEdgeSemanticsV3(edge({ highway: 'residential', surface: undefined }));

    expect(semantics.surfaceEvidence).toBe('road_like_unknown');
    expect(semantics.routeSurface).toBe('mixed');
    expect(semantics.pavedEquivalentWeight).toBe(1);
    expect(semantics.candidateNaturalWeight).toBeLessThan(0.2);
    expect(semantics.isTrailCandidate).toBe(false);
    expect(semantics.componentKind).toBe('residential');
    expect(semantics.isStrictTrailLike).toBe(false);
  });

  it('lets forest context increase confidence without changing explicit surface evidence', () => {
    const open = classifyEdgeSemanticsV3(edge({ highway: 'track', surface: undefined, scenic: false }));
    const forest = classifyEdgeSemanticsV3(edge({
      highway: 'track',
      surface: undefined,
      scenic: true,
      terrainContext: { source: 'ign_poc_fixture', landcoverClass: 'forest', naturalContextScore: 0.9, artificializationScore: 0.1, confidence: 'high', warnings: [] },
    }));

    expect(forest.surfaceEvidence).toBe(open.surfaceEvidence);
    expect(forest.routeSurface).toBe(open.routeSurface);
    expect(forest.trailConfidence).toBeGreaterThan(open.trailConfidence);
    expect(forest.isStrictTrailLike).toBe(false);
  });

  it('splits strict truth metrics from candidate natural search metrics', () => {
    const edges: RouteEdgeV3[] = [
      { id: 'forest-unknown', from: 'a', to: 'b', lengthKm: 4, surface: 'mixed', componentKind: 'forest', highway: 'track', osmWayId: 10 },
      { id: 'strict-natural', from: 'b', to: 'c', lengthKm: 1, surface: 'natural', componentKind: 'forest', highway: 'path', osmWayId: 11 },
      { id: 'road-unknown', from: 'c', to: 'd', lengthKm: 1, surface: 'mixed', componentKind: 'residential', highway: 'residential', osmWayId: 12 },
    ];

    const metrics = computeRouteMetricsV3({
      targetDistanceKm: 6,
      edges,
      geometry: { type: 'LineString', coordinates: [[0, 0], [0.01, 0.01]] },
      targetComponents: ['forest'],
    });

    expect(metrics.strictTrailKm).toBe(1);
    expect(metrics.trailRatio).toBeCloseTo(1 / 6, 3);
    expect(metrics.pathTrackUnknownKm).toBe(4);
    expect(metrics.roadLikeUnknownKm).toBe(1);
    expect(metrics.candidateNaturalKm).toBeCloseTo(4.42, 2);
    expect(metrics.unverifiedTrailCandidateKm).toBe(4);
    expect(metrics.naturalDwellKm).toBeCloseTo(4.4, 2);
  });
});
