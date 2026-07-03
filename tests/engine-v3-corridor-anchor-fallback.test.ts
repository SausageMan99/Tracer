import { describe, expect, it } from 'vitest';

import { buildCorridorMissionV3 } from '../lib/engine-v3/corridor-anchor-builder';
import type {
  RouteConstraintsV3,
  RouteIntentV3,
  TerrainComponentV3,
  TerrainSnapshotV3,
} from '../lib/engine-v3/types';

function component(overrides: Partial<TerrainComponentV3>): TerrainComponentV3 {
  return {
    id: overrides.id ?? `${overrides.kind}-graph-component`,
    kind: overrides.kind ?? 'field_paths',
    distanceFromStartKm: overrides.distanceFromStartKm ?? 0,
    edgeCount: overrides.edgeCount ?? 100,
    totalLengthKm: overrides.totalLengthKm ?? 10,
    pavedRatio: overrides.pavedRatio ?? 0.4,
    nonPavedRatio: overrides.nonPavedRatio ?? 0.6,
    confidence: overrides.confidence ?? 'medium',
  };
}

function snapshot(components: TerrainComponentV3[]): TerrainSnapshotV3 {
  const totalLengthKm = components.reduce((sum, c) => sum + c.totalLengthKm, 0);
  const pavedKm = components.reduce((sum, c) => sum + c.totalLengthKm * c.pavedRatio, 0);
  return {
    audit: {
      confidence: 'medium',
      edgeCount: components.reduce((sum, c) => sum + c.edgeCount, 0),
      totalLengthKm,
      pavedRatio: totalLengthKm > 0 ? pavedKm / totalLengthKm : 0,
      nonPavedRatio: totalLengthKm > 0 ? 1 - pavedKm / totalLengthKm : 0,
      warnings: [],
    },
    components,
  };
}

function lowTrailIntent(snapshotValue: TerrainSnapshotV3): RouteIntentV3 {
  const constraints: RouteConstraintsV3 = {
    targetDistanceKm: 8,
    targetComponents: [],
    maxPavedRatio: 0.8,
    cleanReturn: 'relaxed',
    minNaturalDwellRatio: 0.1,
  };
  return {
    engine: 'v3-clean-room',
    strategy: 'low_trail_potential',
    request: {
      start: { lat: 48.7, lng: 2.5 },
      targetDistanceKm: 8,
      sport: 'running',
      mode: 'trail',
      loop: true,
    },
    snapshot: snapshotValue,
    constraints,
    outcome: {
      type: 'adjusted',
      summary: 'Low trail potential: only a simple quiet loop should be attempted.',
      compromises: ['natural dwell and non-paved ratio are expected to be low'],
    },
    warnings: [],
  };
}

describe('engine V3 corridor anchor fallback (low_trail_potential)', () => {
  it('picks field_paths over residential when both exist in a real forest grid', () => {
    const intent = lowTrailIntent(
      snapshot([
        component({
          id: 'residential-graph-component',
          kind: 'residential',
          totalLengthKm: 51.7,
          pavedRatio: 0.851,
          nonPavedRatio: 0.149,
        }),
        component({
          id: 'field_paths-graph-component',
          kind: 'field_paths',
          totalLengthKm: 103.1,
          pavedRatio: 0.558,
          nonPavedRatio: 0.442,
        }),
      ]),
    );
    const mission = buildCorridorMissionV3(intent);
    expect(mission.anchor?.kind).toBe('field_paths');
    expect(mission.anchor?.componentId).toBe('field_paths-graph-component');
  });

  it('still picks residential when field_paths is absent (urban-only snapshot)', () => {
    const intent = lowTrailIntent(
      snapshot([
        component({
          id: 'residential-graph-component',
          kind: 'residential',
          totalLengthKm: 51.7,
          pavedRatio: 0.851,
          nonPavedRatio: 0.149,
        }),
        component({
          id: 'scenic_paved-graph-component',
          kind: 'scenic_paved',
          totalLengthKm: 12,
          pavedRatio: 0.95,
          nonPavedRatio: 0.05,
        }),
      ]),
    );
    const mission = buildCorridorMissionV3(intent);
    expect(mission.anchor?.kind).toBe('residential');
    expect(mission.anchor?.componentId).toBe('residential-graph-component');
  });

  it('lets urban_green beat field_paths when urban_green has a stronger score', () => {
    // urban_green with high nonPavedRatio and sizeable length should still
    // win over a small field_paths component, preserving urban behavior.
    const intent = lowTrailIntent(
      snapshot([
        component({
          id: 'urban_green-graph-component',
          kind: 'urban_green',
          totalLengthKm: 30,
          pavedRatio: 0.2,
          nonPavedRatio: 0.8,
        }),
        component({
          id: 'field_paths-graph-component',
          kind: 'field_paths',
          totalLengthKm: 5,
          pavedRatio: 0.6,
          nonPavedRatio: 0.4,
        }),
      ]),
    );
    const mission = buildCorridorMissionV3(intent);
    expect(mission.anchor?.kind).toBe('urban_green');
  });

  it('lets park beat field_paths when park has a stronger score', () => {
    const intent = lowTrailIntent(
      snapshot([
        component({
          id: 'park-graph-component',
          kind: 'park',
          totalLengthKm: 18,
          pavedRatio: 0.3,
          nonPavedRatio: 0.7,
        }),
        component({
          id: 'field_paths-graph-component',
          kind: 'field_paths',
          totalLengthKm: 6,
          pavedRatio: 0.6,
          nonPavedRatio: 0.4,
        }),
      ]),
    );
    const mission = buildCorridorMissionV3(intent);
    expect(mission.anchor?.kind).toBe('park');
  });

  it('still works for simple_quiet_loop (boucle_simple) intent', () => {
    const intent = lowTrailIntent(
      snapshot([
        component({
          id: 'residential-graph-component',
          kind: 'residential',
          totalLengthKm: 20,
          pavedRatio: 0.9,
          nonPavedRatio: 0.1,
        }),
        component({
          id: 'field_paths-graph-component',
          kind: 'field_paths',
          totalLengthKm: 40,
          pavedRatio: 0.5,
          nonPavedRatio: 0.5,
        }),
      ]),
    );
    const simpleQuietIntent: RouteIntentV3 = { ...intent, strategy: 'simple_quiet_loop' };
    const mission = buildCorridorMissionV3(simpleQuietIntent);
    expect(mission.anchor?.kind).toBe('field_paths');
  });

  it('scoring formula is unchanged: same input scores produce same anchor as before', () => {
    // Pre-patch behavior for urban-only snapshots: residential wins over scenic_paved
    // (because residential has totalLengthKm * nonPavedRatio + 1 - 8 = -1.8 vs
    //  scenic_paved: 0.6 + 1 - 8 = -6.4). We assert residential still wins here.
    const intent = lowTrailIntent(
      snapshot([
        component({
          id: 'residential-graph-component',
          kind: 'residential',
          totalLengthKm: 10,
          pavedRatio: 0.9,
          nonPavedRatio: 0.1,
        }),
        component({
          id: 'scenic_paved-graph-component',
          kind: 'scenic_paved',
          totalLengthKm: 10,
          pavedRatio: 0.95,
          nonPavedRatio: 0.05,
        }),
      ]),
    );
    const mission = buildCorridorMissionV3(intent);
    // score(residential) = 10*0.1 + 1 - 0 - 8 = -6
    // score(scenic_paved) = 10*0.05 + 1 - 0 - 8 = -6.5
    // → residential wins (less negative). Verifies the relative ranking is preserved.
    expect(mission.anchor?.kind).toBe('residential');
  });
});
