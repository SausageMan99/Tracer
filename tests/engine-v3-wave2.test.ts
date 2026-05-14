import { describe, expect, it } from 'vitest';
import {
  assembleRouteV3,
  buildCorridorMissionV3,
  decideOutcomeV3,
  planRouteIntentV3,
  type TerrainSnapshotV3,
  type UserRouteRequestV3,
} from '../lib/engine-v3';

function request(overrides: Partial<UserRouteRequestV3> = {}): UserRouteRequestV3 {
  return {
    start: { lat: 49.31, lng: 0.88 },
    targetDistanceKm: 12,
    activity: 'running',
    mode: 'trail',
    loop: true,
    ...overrides,
  };
}

function snapshot(overrides: Partial<TerrainSnapshotV3> = {}): TerrainSnapshotV3 {
  return {
    audit: {
      confidence: 'medium',
      edgeCount: 160,
      totalLengthKm: 32,
      pavedRatio: 0.45,
      nonPavedRatio: 0.55,
      warnings: [],
    },
    components: [],
    ...overrides,
  };
}

describe('engine V3 wave 2 clean-room corridor, assembly and outcome', () => {
  it('Tourville transition_to_woods anchors real natural dwell in the woods instead of only skirting paved contour', () => {
    const intent = planRouteIntentV3(
      request({ targetDistanceKm: 12, mode: 'trail' }),
      snapshot({
        audit: { confidence: 'medium', edgeCount: 210, totalLengthKm: 39, pavedRatio: 0.42, nonPavedRatio: 0.58, warnings: [] },
        components: [
          { id: 'tourville-asphalt-scenic', kind: 'scenic_paved', distanceFromStartKm: 0.2, edgeCount: 25, totalLengthKm: 7, pavedRatio: 1, nonPavedRatio: 0, confidence: 'high' },
          { id: 'tourville-woods', kind: 'forest', distanceFromStartKm: 1.1, edgeCount: 95, totalLengthKm: 18, pavedRatio: 0.18, nonPavedRatio: 0.82, confidence: 'medium' },
        ],
      }),
    );

    const mission = buildCorridorMissionV3(intent);
    const route = assembleRouteV3(intent, mission);
    const outcome = decideOutcomeV3(intent, route);

    expect(intent.strategy).toBe('transition_to_woods');
    expect(mission.anchor?.componentId).toBe('tourville-woods');
    expect(route.segments.some((segment) => segment.kind === 'natural_dwell' && segment.componentId === 'tourville-woods')).toBe(true);
    expect(route.metrics.naturalDwellKm).toBeGreaterThanOrEqual(4.8);
    expect(route.metrics.pavedRatio).toBeLessThanOrEqual(intent.constraints.maxPavedRatio);
    expect(route.metrics.repeatRatio).toBeCloseTo(2.2 / route.metrics.distanceProducedKm, 3);
    expect(route.metrics.overlapRatio).toBeCloseTo(2.2 / route.metrics.distanceProducedKm, 3);
    expect(outcome.type).toBe('adjusted');
    if (outcome.type === 'adjusted') {
      expect(outcome.compromises).toContain('paved connectors may be required before non-paved terrain');
      expect(outcome.compromises).toContain('minor assembly compromises');
    }
  });

  it('keeps asphalt scenic paved as paved and never reports generated for an over-paved trail route', () => {
    const intent = planRouteIntentV3(
      request({ targetDistanceKm: 10, mode: 'trail' }),
      snapshot({
        audit: { confidence: 'high', edgeCount: 180, totalLengthKm: 30, pavedRatio: 0.82, nonPavedRatio: 0.18, warnings: ['scenic asphalt'] },
        components: [
          { id: 'asphalt-scenic', kind: 'scenic_paved', distanceFromStartKm: 0.1, edgeCount: 80, totalLengthKm: 16, pavedRatio: 1, nonPavedRatio: 0, confidence: 'high' },
          { id: 'thin-green-strip', kind: 'urban_green', distanceFromStartKm: 0.4, edgeCount: 35, totalLengthKm: 5, pavedRatio: 0.85, nonPavedRatio: 0.15, confidence: 'medium' },
        ],
      }),
    );

    const mission = buildCorridorMissionV3(intent);
    const route = assembleRouteV3(intent, mission);
    const outcome = decideOutcomeV3(intent, route);

    expect(route.metrics.pavedRatio).toBeGreaterThan(intent.constraints.maxPavedRatio);
    expect(route.metrics.naturalWayRatio).toBeLessThan(0.4);
    expect(outcome.type).not.toBe('generated');
  });

  it('small park cannot silently generate a 15 km route when natural dwell and available distance are insufficient', () => {
    const intent = planRouteIntentV3(
      request({ targetDistanceKm: 15, mode: 'nature_urbaine' }),
      snapshot({
        audit: { confidence: 'medium', edgeCount: 70, totalLengthKm: 8, pavedRatio: 0.72, nonPavedRatio: 0.28, warnings: ['small park'] },
        components: [
          { id: 'small-park', kind: 'park', distanceFromStartKm: 0.15, edgeCount: 40, totalLengthKm: 3.2, pavedRatio: 0.65, nonPavedRatio: 0.35, confidence: 'medium' },
        ],
      }),
    );

    const route = assembleRouteV3(intent, buildCorridorMissionV3(intent));
    const outcome = decideOutcomeV3(intent, route);

    expect(route.metrics.distanceProducedKm).toBeLessThan(13.5);
    expect(outcome.type).toMatch(/adjusted|refused/);
    expect(outcome.type).not.toBe('generated');
  });

  it('distance-insufficient assemblies expose distanceProduced vs target and do not get a silent generated outcome', () => {
    const intent = planRouteIntentV3(
      request({ targetDistanceKm: 14, mode: 'trail' }),
      snapshot({
        audit: { confidence: 'high', edgeCount: 130, totalLengthKm: 9, pavedRatio: 0.2, nonPavedRatio: 0.8, warnings: [] },
        components: [
          { id: 'short-forest', kind: 'forest', distanceFromStartKm: 0.1, edgeCount: 90, totalLengthKm: 5.2, pavedRatio: 0.1, nonPavedRatio: 0.9, confidence: 'high' },
        ],
      }),
    );

    const route = assembleRouteV3(intent, buildCorridorMissionV3(intent));
    const outcome = decideOutcomeV3(intent, route);

    expect(route.metrics.targetDistanceKm).toBe(14);
    expect(route.metrics.distanceProducedKm).toBeLessThan(12.6);
    expect(outcome.type).not.toBe('generated');
  });
});
