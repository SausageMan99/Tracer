import { describe, expect, it } from 'vitest';
import {
  normalizeRequestV3,
  planRouteIntentV3,
  type TerrainSnapshotV3,
  type UserRouteRequestV3,
} from '../lib/engine-v3';

function request(overrides: Partial<UserRouteRequestV3> = {}): UserRouteRequestV3 {
  return {
    start: { lat: 48.4, lng: 2.7 },
    targetDistanceKm: 10,
    activity: 'running',
    mode: 'trail',
    loop: true,
    ...overrides,
  };
}

function snapshot(overrides: Partial<TerrainSnapshotV3> = {}): TerrainSnapshotV3 {
  return {
    audit: {
      confidence: 'high',
      edgeCount: 160,
      totalLengthKm: 42,
      pavedRatio: 0.2,
      nonPavedRatio: 0.8,
      warnings: [],
    },
    components: [],
    ...overrides,
  };
}

describe('engine V3 clean-room request normalizer', () => {
  it('normalizes phase-1 supported requests without invoking V2', () => {
    const normalized = normalizeRequestV3(request({ targetDistanceKm: 15, mode: 'nature_urbaine' }));

    expect(normalized.status).toBe('accepted');
    if (normalized.status !== 'accepted') throw new Error('expected accepted normalization');
    expect(normalized.request).toMatchObject({ targetDistanceKm: 15, sport: 'running', mode: 'nature_urbaine', loop: true });
  });

  it('accepts exact phase-1 distance boundaries', () => {
    const min = normalizeRequestV3(request({ targetDistanceKm: 5 }));
    const max = normalizeRequestV3(request({ targetDistanceKm: 15 }));

    expect(min.status).toBe('accepted');
    expect(max.status).toBe('accepted');
  });

  it('refuses explicit non-loop requests instead of silently forcing them to loops', () => {
    const normalized = normalizeRequestV3(request({ loop: false }));

    expect(normalized.status).toBe('refused');
    if (normalized.status !== 'refused') throw new Error('expected refused normalization');
    expect(normalized.outcome.reason).toContain('loop');
  });

  it('refuses non-finite, negative and out-of-range distances', () => {
    for (const targetDistanceKm of [Number.NaN, Number.POSITIVE_INFINITY, Number.NEGATIVE_INFINITY, -1]) {
      const normalized = normalizeRequestV3(request({ targetDistanceKm }));

      expect(normalized.status).toBe('refused');
      if (normalized.status !== 'refused') throw new Error('expected refused normalization');
      expect(normalized.outcome.reason).toContain('distance');
    }
  });

  it('refuses invalid runtime start coordinates', () => {
    const invalidStarts = [
      { lat: Number.NaN, lng: 2.7 },
      { lat: Number.POSITIVE_INFINITY, lng: 2.7 },
      { lat: -90.1, lng: 2.7 },
      { lat: 90.1, lng: 2.7 },
      { lat: 48.4, lng: Number.NaN },
      { lat: 48.4, lng: Number.NEGATIVE_INFINITY },
      { lat: 48.4, lng: -180.1 },
      { lat: 48.4, lng: 180.1 },
    ];

    for (const start of invalidStarts) {
      const normalized = normalizeRequestV3(request({ start }));

      expect(normalized.status).toBe('refused');
      if (normalized.status !== 'refused') throw new Error('expected refused normalization');
      expect(normalized.outcome.reason).toContain('start coordinates');
    }
  });

  it('returns a typed refused outcome for unsupported phase-1 distances', () => {
    const normalized = normalizeRequestV3(request({ targetDistanceKm: 21 }));

    expect(normalized.status).toBe('refused');
    if (normalized.status !== 'refused') throw new Error('expected refused normalization');
    expect(normalized.outcome.type).toBe('refused');
    expect(normalized.outcome.reason).toContain('distance');
  });
});

describe('engine V3 clean-room route intent planner', () => {
  it('plans a Fontainebleau-like forest loop with strict natural constraints', () => {
    const intent = planRouteIntentV3(
      request({ targetDistanceKm: 15, mode: 'trail' }),
      snapshot({
        audit: { confidence: 'high', edgeCount: 320, totalLengthKm: 86, pavedRatio: 0.14, nonPavedRatio: 0.86, warnings: [] },
        components: [
          { id: 'fontainebleau-forest', kind: 'forest', distanceFromStartKm: 0.1, edgeCount: 260, totalLengthKm: 62, pavedRatio: 0.12, nonPavedRatio: 0.88, confidence: 'high' },
        ],
      }),
    );

    expect(intent.strategy).toBe('forest_loop');
    expect(intent.outcome.type).toBe('generated');
    expect(intent.constraints.targetComponents).toContain('forest');
    expect(intent.constraints.maxPavedRatio).toBeLessThanOrEqual(0.35);
    expect(intent.constraints.cleanReturn).toMatch(/prefer|strict/);
    expect(intent.constraints.minNaturalDwellRatio).toBeGreaterThanOrEqual(0.6);
  });

  it('plans a Tourville-like transition to woods while keeping scenic paved honest', () => {
    const intent = planRouteIntentV3(
      request({ targetDistanceKm: 12, mode: 'trail' }),
      snapshot({
        audit: { confidence: 'medium', edgeCount: 190, totalLengthKm: 38, pavedRatio: 0.38, nonPavedRatio: 0.62, warnings: [] },
        components: [
          { id: 'residential-start', kind: 'residential', distanceFromStartKm: 0, edgeCount: 46, totalLengthKm: 8, pavedRatio: 0.85, nonPavedRatio: 0.15, confidence: 'high' },
          { id: 'scenic-paved-lane', kind: 'scenic_paved', distanceFromStartKm: 0.3, edgeCount: 32, totalLengthKm: 6, pavedRatio: 1, nonPavedRatio: 0, confidence: 'high' },
          { id: 'woods-field-paths', kind: 'forest', distanceFromStartKm: 1.05, edgeCount: 105, totalLengthKm: 21, pavedRatio: 0.25, nonPavedRatio: 0.75, confidence: 'medium' },
        ],
      }),
    );

    expect(intent.strategy).toBe('transition_to_woods');
    expect(intent.outcome.type).toBe('adjusted');
    expect(intent.constraints.targetComponents).toContain('forest');
    expect(intent.constraints.maxPavedRatio).toBeLessThanOrEqual(0.45);
    expect(intent.constraints.minNaturalDwellRatio).toBeGreaterThan(0);
    expect(intent.snapshot.components.find((component) => component.id === 'scenic-paved-lane')).toMatchObject({ kind: 'scenic_paved', pavedRatio: 1, nonPavedRatio: 0 });
  });

  it('plans a Caen park-like short loop with honest paved compromises', () => {
    const intent = planRouteIntentV3(
      request({ targetDistanceKm: 6, mode: 'nature_urbaine' }),
      snapshot({
        audit: { confidence: 'medium', edgeCount: 90, totalLengthKm: 15, pavedRatio: 0.62, nonPavedRatio: 0.38, warnings: ['small park, paved connectors likely'] },
        components: [
          { id: 'caen-park', kind: 'park', distanceFromStartKm: 0.2, edgeCount: 52, totalLengthKm: 6.5, pavedRatio: 0.55, nonPavedRatio: 0.45, confidence: 'medium' },
        ],
      }),
    );

    expect(intent.strategy).toBe('park_loop');
    expect(intent.outcome.type).toMatch(/generated|adjusted/);
    expect(intent.constraints.maxPavedRatio).toBeGreaterThanOrEqual(0.55);
    expect(intent.warnings.join(' ')).toContain('paved');
  });

  it('plans a Paris urban nature route without inventing forest or trail', () => {
    const intent = planRouteIntentV3(
      request({ targetDistanceKm: 8, mode: 'nature_urbaine' }),
      snapshot({
        audit: { confidence: 'high', edgeCount: 220, totalLengthKm: 30, pavedRatio: 0.82, nonPavedRatio: 0.18, warnings: ['mostly paved urban graph'] },
        components: [
          { id: 'urban-green', kind: 'urban_green', distanceFromStartKm: 0.1, edgeCount: 88, totalLengthKm: 9, pavedRatio: 0.78, nonPavedRatio: 0.22, confidence: 'high' },
          { id: 'seine-corridor', kind: 'river_corridor', distanceFromStartKm: 0.8, edgeCount: 64, totalLengthKm: 8, pavedRatio: 0.9, nonPavedRatio: 0.1, confidence: 'high' },
        ],
      }),
    );

    expect(['urban_nature_loop', 'simple_quiet_loop']).toContain(intent.strategy);
    expect(intent.constraints.targetComponents).not.toContain('forest');
    expect(intent.constraints.targetComponents).not.toContain('trail');
    expect(intent.snapshot.audit.pavedRatio).toBeGreaterThan(0.8);
  });

  it('keeps returned intents isolated from caller mutations across calls', () => {
    const sourceRequest = request({ targetDistanceKm: 8, mode: 'nature_urbaine' });
    const sourceSnapshot = snapshot({
      audit: { confidence: 'high', edgeCount: 220, totalLengthKm: 30, pavedRatio: 0.82, nonPavedRatio: 0.18, warnings: ['mostly paved urban graph'] },
      components: [
        { id: 'urban-green', kind: 'urban_green', distanceFromStartKm: 0.1, edgeCount: 88, totalLengthKm: 9, pavedRatio: 0.78, nonPavedRatio: 0.22, confidence: 'high' },
      ],
    });

    const firstIntent = planRouteIntentV3(sourceRequest, sourceSnapshot);
    firstIntent.constraints.targetComponents.push('forest');
    firstIntent.warnings.push('mutated warning');
    firstIntent.snapshot.components.push({ id: 'mutated-forest', kind: 'forest', distanceFromStartKm: 0, edgeCount: 999, totalLengthKm: 99, pavedRatio: 0, nonPavedRatio: 1, confidence: 'high' });
    firstIntent.snapshot.audit.warnings.push('mutated audit warning');
    if (firstIntent.request) firstIntent.request.start.lat = 0;

    const secondIntent = planRouteIntentV3(sourceRequest, sourceSnapshot);

    expect(secondIntent.strategy).toBe('urban_nature_loop');
    expect(secondIntent.constraints.targetComponents).toEqual(['urban_green']);
    expect(secondIntent.warnings).not.toContain('mutated warning');
    expect(secondIntent.snapshot.components).toHaveLength(1);
    expect(secondIntent.snapshot.components.map((component) => component.id)).not.toContain('mutated-forest');
    expect(secondIntent.snapshot.audit.warnings).not.toContain('mutated audit warning');
    expect(secondIntent.request?.start).toEqual({ lat: 48.4, lng: 2.7 });
  });

  it('plans boucle_simple as a simple quiet loop in urban context', () => {
    const intent = planRouteIntentV3(
      request({ targetDistanceKm: 8, mode: 'boucle_simple' }),
      snapshot({
        audit: { confidence: 'high', edgeCount: 220, totalLengthKm: 30, pavedRatio: 0.82, nonPavedRatio: 0.18, warnings: ['mostly paved urban graph'] },
        components: [
          { id: 'urban-green', kind: 'urban_green', distanceFromStartKm: 0.1, edgeCount: 88, totalLengthKm: 9, pavedRatio: 0.78, nonPavedRatio: 0.22, confidence: 'high' },
        ],
      }),
    );

    expect(intent.strategy).toBe('simple_quiet_loop');
    expect(intent.constraints.targetComponents).toEqual(['urban_green']);
  });

  it('refuses an unroutable poor rural snapshot with no safe loop evidence', () => {
    const intent = planRouteIntentV3(
      request({ targetDistanceKm: 10, mode: 'trail' }),
      snapshot({
        audit: { confidence: 'low', edgeCount: 4, totalLengthKm: 1.2, pavedRatio: 0.95, nonPavedRatio: 0.05, warnings: ['insufficient graph coverage'] },
        components: [],
      }),
    );

    expect(intent.strategy).toBe('unroutable');
    expect(intent.outcome.type).toBe('refused');
    if (intent.outcome.type !== 'refused') throw new Error('expected refused outcome');
    expect(intent.outcome.reason).toContain('unroutable');
  });
});
