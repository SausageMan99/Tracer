import { describe, expect, it } from 'vitest';
import { planRouteIntentV3 } from '@/lib/engine-v3/route-intent-planner';
import type { TerrainComponentKindV3, TerrainSnapshotV3, UserRouteRequestV3 } from '@/lib/engine-v3/types';

function trailRequest(targetDistanceKm: number): UserRouteRequestV3 {
  return {
    start: { lat: 49.13, lng: -0.48 },
    targetDistanceKm,
    sport: 'running',
    mode: 'trail',
    loop: true,
  };
}

function component(
  kind: TerrainComponentKindV3,
  totalLengthKm: number,
  nonPavedRatio: number,
  distanceFromStartKm = 0.04,
) {
  return {
    id: `${kind}-graph-component`,
    kind,
    distanceFromStartKm,
    edgeCount: 120,
    totalLengthKm,
    pavedRatio: 1 - nonPavedRatio,
    nonPavedRatio,
    confidence: 'medium' as const,
  };
}

function snapshot(components: TerrainSnapshotV3['components']): TerrainSnapshotV3 {
  return {
    audit: {
      confidence: 'medium',
      edgeCount: 240,
      totalLengthKm: components.reduce((sum, item) => sum + item.totalLengthKm, 0),
      pavedRatio: 0.58,
      nonPavedRatio: 0.42,
      warnings: [],
    },
    components,
  };
}

describe('planRouteIntentV3 target-component reachability', () => {
  it('uses a large nearby field-path opportunity as transition target even when the component ratio is mixed', () => {
    const intent = planRouteIntentV3(
      trailRequest(8),
      snapshot([
        component('residential', 26.461, 0, 0),
        component('field_paths', 22.564, 0.415, 0.034),
      ]),
    );

    expect(intent.strategy).toBe('transition_to_woods');
    expect(intent.constraints.targetComponents).toContain('field_paths');
    expect(intent.constraints.minNaturalDwellRatio).toBeGreaterThanOrEqual(0.45);
    expect(intent.warnings.join(' ')).toContain('paved connectors remain paved');
  });

  it('does not drop a park-ish field-path component to low_trail_potential when absolute non-paved opportunity can satisfy dwell', () => {
    const intent = planRouteIntentV3(
      trailRequest(6),
      snapshot([
        component('residential', 46.864, 0, 0),
        component('field_paths', 101.761, 0.199, 0.014),
      ]),
    );

    expect(intent.strategy).toBe('transition_to_woods');
    expect(intent.constraints.targetComponents).toContain('field_paths');
    expect(intent.outcome.type).toBe('adjusted');
  });
});
