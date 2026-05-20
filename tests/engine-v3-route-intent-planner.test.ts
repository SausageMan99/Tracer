import { describe, expect, it } from 'vitest';
import { buildMissionContractV3 } from '@/lib/engine-v3/mission-contract-builder';
import { planRouteIntentV3 } from '@/lib/engine-v3/route-intent-planner';
import type { RouteModeV3, TerrainComponentKindV3, TerrainSnapshotV3, UserRouteRequestV3 } from '@/lib/engine-v3/types';

function request(targetDistanceKm: number, mode: RouteModeV3 = 'trail'): UserRouteRequestV3 {
  return {
    start: { lat: 49.13, lng: -0.48 },
    targetDistanceKm,
    sport: 'running',
    mode,
    loop: true,
  };
}

function trailRequest(targetDistanceKm: number): UserRouteRequestV3 {
  return request(targetDistanceKm, 'trail');
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

  it('routes nature_urbaine paved corridor opportunity as urban_nature instead of fake transition_to_woods field paths', () => {
    const intent = planRouteIntentV3(
      request(6, 'nature_urbaine'),
      snapshot([
        component('residential', 46.864, 0, 0),
        component('field_paths', 101.761, 0.199, 0.014),
      ]),
    );
    const contract = buildMissionContractV3(intent);

    expect(intent.strategy).toBe('urban_nature_loop');
    expect(intent.constraints.targetComponents).not.toContain('field_paths');
    expect(intent.constraints.maxPavedRatio).toBeGreaterThanOrEqual(0.85);
    expect(intent.outcome.type).toBe('adjusted');
    if (intent.outcome.type !== 'adjusted') throw new Error('expected adjusted urban nature intent');
    expect(intent.outcome.summary).toContain('Urban nature');
    expect(contract?.promise).toBe('urban_nature');
    expect(contract?.target.requiredEntry).toBe('preferred');
    expect(contract?.refusalPolicy.refuseIfNoTargetEntry).toBe(false);
  });

  it('keeps trail requests with absolute non-paved field-path capacity on transition_to_woods', () => {
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
