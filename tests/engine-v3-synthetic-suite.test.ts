import { describe, expect, it } from 'vitest';
import { assembleMissionV3 } from '@/lib/engine-v3/assemblers/mission-dispatcher';
import { generateRouteV3FromGraph } from '@/lib/engine-v3/route-generator';
import {
  makeEdge,
  makeGraph,
  makeMission,
  syntheticLargeForestLoop,
  syntheticParkSmall,
  syntheticRuralPoorSurfaceConfidence,
  syntheticScenicPavedTrap,
  syntheticTransitionWoodsConnectorThenDwell,
  type SyntheticEnrichedEdgeV3,
} from '@/lib/engine-v3/testing/synthetic-graphs';

function edgesOf(scenario: { graph: { edges: Map<string, unknown> } }): SyntheticEnrichedEdgeV3[] {
  return Array.from(scenario.graph.edges.values()) as SyntheticEnrichedEdgeV3[];
}

function lengthOf(edges: SyntheticEnrichedEdgeV3[], predicate: (edge: SyntheticEnrichedEdgeV3) => boolean): number {
  return edges.filter(predicate).reduce((sum, edge) => sum + edge.lengthKm, 0);
}

describe('V3 synthetic graph suite fixtures', () => {
  it('defines five product-critical synthetic cases', () => {
    const cases = [
      syntheticLargeForestLoop(),
      syntheticTransitionWoodsConnectorThenDwell(),
      syntheticParkSmall(),
      syntheticRuralPoorSurfaceConfidence(),
      syntheticScenicPavedTrap(),
    ];

    expect(cases.map((item) => item.id)).toEqual([
      'large_forest_loop',
      'transition_woods_connector_then_dwell',
      'park_small_adjusted_or_refused',
      'rural_poor_surface_confidence_refusal',
      'scenic_paved_trap',
    ]);
    expect(cases.every((item) => item.graph.nodes.size > 0)).toBe(true);
    expect(cases.every((item) => item.graph.edges.size > 0)).toBe(true);
    expect(cases.every((item) => item.mission.version === 'v3-mission-v1')).toBe(true);
  });

  it('large forest contains at least 8km of natural path/track and a scenic asphalt decoy', () => {
    const scenario = syntheticLargeForestLoop();
    const edges = edgesOf(scenario);
    const naturalPathTrackKm = lengthOf(edges, (edge) =>
      ['ground', 'dirt', 'earth'].includes(edge.surface ?? '')
      && ['path', 'track'].includes(edge.highway)
      && edge.componentKind === 'forest',
    );

    expect(naturalPathTrackKm).toBeGreaterThanOrEqual(8);
    expect(edges.some((edge) => edge.surface === 'asphalt' && edge.scenic && edge.componentKind === 'scenic_paved')).toBe(true);
    expect(scenario.expected.forbiddenTrailEdgeIds).toContain('scenic-paved-decoy');
  });

  it('transition woods contains an honest paved connector before natural targets', () => {
    const scenario = syntheticTransitionWoodsConnectorThenDwell();
    const edges = edgesOf(scenario);

    expect(edges.some((edge) => edge.id.includes('access') && edge.surface === 'asphalt' && edge.componentKind === 'residential')).toBe(true);
    expect(edges.some((edge) => ['field_paths', 'forest'].includes(edge.componentKind) && ['ground', 'dirt', 'earth'].includes(edge.surface ?? ''))).toBe(true);
    expect(scenario.mission.closure.mode).toBe('connector_repeat_allowed');
    expect(scenario.mission.budgets.maxTargetRepeatKm).toBeLessThan(scenario.mission.budgets.maxConnectorRepeatKm);
  });

  it('small park request exceeds park capacity without converting residential pavement into trail', () => {
    const scenario = syntheticParkSmall();
    const edges = edgesOf(scenario);
    const parkCapacityKm = lengthOf(edges, (edge) => edge.componentKind === 'park');
    const residentialPavedKm = lengthOf(edges, (edge) => edge.componentKind === 'residential' && edge.surface === 'asphalt');

    expect(scenario.mission.request.targetDistanceKm).toBeGreaterThan(parkCapacityKm);
    expect(parkCapacityKm).toBeGreaterThanOrEqual(1.8);
    expect(residentialPavedKm).toBeGreaterThan(0);
    expect(scenario.expected.expectedOutcome).toBe('adjusted');
  });

  it('rural poor fixture encodes weak surface confidence and a refusal blocker', () => {
    const scenario = syntheticRuralPoorSurfaceConfidence();
    const edges = edgesOf(scenario);

    expect(edges.some((edge) => edge.surfaceConfidence === 'low')).toBe(true);
    expect(edges.some((edge) => edge.surface === 'unknown' && ['unclassified', 'track'].includes(edge.highway))).toBe(true);
    expect(scenario.expected.selectableCandidate).toBe(false);
    expect(scenario.expected.requiredBlocker).toBe('weak_surface_confidence');
  });

  it('scenic paved trap contains a complete asphalt scenic route and a natural alternative', () => {
    const scenario = syntheticScenicPavedTrap();
    const edges = edgesOf(scenario);
    const scenicLoop = edges.filter((edge) => edge.completeRouteGroup === 'scenic-asphalt-loop');
    const naturalAlternative = edges.filter((edge) => edge.completeRouteGroup === 'natural-hard-loop');

    expect(scenicLoop.length).toBeGreaterThanOrEqual(3);
    expect(scenicLoop.every((edge) => edge.surface === 'asphalt' && edge.scenic && edge.componentKind === 'scenic_paved')).toBe(true);
    expect(naturalAlternative.length).toBeGreaterThan(0);
    expect(naturalAlternative.every((edge) => ['ground', 'dirt', 'earth'].includes(edge.surface ?? '') && edge.componentKind === 'forest')).toBe(true);
    expect(scenario.expected.requiredBlocker).toBe('dominant_paved_scenic_core');
  });
});

describe('V3 mission dispatcher synthetic behavior', () => {
  it('large_forest_loop builds complete_valid and rejects scenic paved trap', () => {
    const scenario = syntheticLargeForestLoop();
    const result = assembleMissionV3(scenario.graph, scenario.mission);

    expect(result.portfolio.selectedCandidateId).not.toBeNull();
    expect(result.selectedCandidate?.lane).toBe('complete_valid');
    expect(result.selectedCandidate?.metrics.naturalDwellKm).toBeGreaterThanOrEqual(scenario.expected.minNaturalDwellKm!);
    expect(result.selectedCandidate?.metrics.pavedRatio).toBeLessThanOrEqual(scenario.expected.maxPavedRatio!);
    expect(result.selectedCandidate?.metrics.trailRatio).toBeGreaterThan(0);
    expect(result.selectedCandidate?.edgeIds).not.toEqual(expect.arrayContaining(scenario.expected.forbiddenTrailEdgeIds!));
  });

  it('transition_woods_connector_then_dwell delays closure until dwell succeeds', () => {
    const scenario = syntheticTransitionWoodsConnectorThenDwell();
    const result = assembleMissionV3(scenario.graph, scenario.mission);

    expect(result.phaseDiagnostics.access.status).toBe('success');
    expect(result.phaseDiagnostics.dwell.status).toBe('success');
    expect(result.phaseDiagnostics.closure.status).toBe('success');
    expect(result.phaseDiagnostics.dwell.targetDwellKm).toBeGreaterThanOrEqual(scenario.expected.minNaturalDwellKm!);
    expect(result.phaseDiagnostics.closure.targetRepeatKm).toBeLessThanOrEqual(scenario.mission.budgets.maxTargetRepeatKm);
    expect(result.phaseDiagnostics.closure.connectorRepeatKm).toBeGreaterThan(0);
    expect(result.portfolio.candidates.find((candidate) => candidate.id.includes('residential'))?.lane).not.toBe('complete_valid');
  });

  it('transition_to_woods produces a returned candidate after multi-edge paved access to target dwell', () => {
    const scenario = syntheticTransitionWoodsConnectorThenDwell();
    const graph = makeGraph([
      makeEdge({ id: 'village-access-1', from: 'start', to: 'village-mid', lengthKm: 0.45, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'village-access-2', from: 'village-mid', to: 'woods-entry', lengthKm: 0.45, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'field-dwell-1', from: 'woods-entry', to: 'field-1', lengthKm: 1.8, surface: 'ground', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'forest-dwell-1', from: 'field-1', to: 'forest-1', lengthKm: 2.1, surface: 'dirt', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'forest-dwell-2', from: 'forest-1', to: 'woods-entry', lengthKm: 2, surface: 'earth', highway: 'track', componentKind: 'forest' }),
      makeEdge({ id: 'residential-decoy-loop', from: 'start', to: 'start-loop', lengthKm: 1.2, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
    ]);

    const result = assembleMissionV3(graph, scenario.mission);

    expect(result.selectedCandidate?.returned).toBe(true);
    expect(result.selectedCandidate?.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(result.selectedCandidate?.edgeIds).toEqual([
      'village-access-1',
      'village-access-2',
      'field-dwell-1',
      'forest-dwell-1',
      'forest-dwell-2',
      'village-access-2',
      'village-access-1',
    ]);
    expect(result.phaseDiagnostics.dwell.targetDwellKm).toBeGreaterThanOrEqual(scenario.expected.minNaturalDwellKm!);
    expect(result.phaseDiagnostics.closure.connectorRepeatKm).toBeGreaterThan(0);
    expect(result.phaseDiagnostics.closure.targetRepeatKm).toBe(0);
  });

  it('transition_to_woods prefers a lateral target traverse with separate connector closure over target out-and-back repeat', () => {
    const scenario = syntheticTransitionWoodsConnectorThenDwell();
    const graph = makeGraph([
      makeEdge({ id: 'village-access', from: 'start', to: 'woods-entry', lengthKm: 0.7, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'repeat-prone-target-1', from: 'woods-entry', to: 'spur-1', lengthKm: 2.1, surface: 'ground', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'repeat-prone-target-2', from: 'spur-1', to: 'dead-end', lengthKm: 2.1, surface: 'dirt', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'lateral-target-1', from: 'woods-entry', to: 'lateral-1', lengthKm: 2.2, surface: 'ground', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'lateral-target-2', from: 'lateral-1', to: 'woods-exit', lengthKm: 2.3, surface: 'earth', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'separate-connector-closure', from: 'woods-exit', to: 'start', lengthKm: 0.8, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
    ]);

    const result = assembleMissionV3(graph, scenario.mission);

    expect(result.selectedCandidate?.selectedReason).toBe('entry_exit_lateral');
    expect(result.selectedCandidate?.returned).toBe(true);
    expect(result.selectedCandidate?.edgeIds).toEqual([
      'village-access',
      'lateral-target-1',
      'lateral-target-2',
      'separate-connector-closure',
    ]);
    expect(result.selectedCandidate?.metrics.naturalDwellKm).toBeGreaterThanOrEqual(scenario.expected.minNaturalDwellKm!);
    expect(result.phaseDiagnostics.closure.targetRepeatKm).toBe(0);
    expect(result.selectedCandidate?.metrics.repeatRatio).toBe(0);
  });

  it('transition_to_woods exposes target_lateral insufficiency when real topology is only a clean dead-end below dwell', () => {
    const graph = makeGraph([
      makeEdge({ id: 'village-access', from: 'start', to: 'woods-entry', lengthKm: 0.7, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'short-clean-branch-1', from: 'woods-entry', to: 'branch-1', lengthKm: 1.6, surface: 'ground', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'short-clean-branch-2', from: 'branch-1', to: 'dead-end', lengthKm: 1.6, surface: 'dirt', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      ...Array.from({ length: 10 }, (_, index) => makeEdge({
        id: `audit-context-residential-${index}`,
        from: `ctx-${index}`,
        to: `ctx-${index + 1}`,
        lengthKm: 0.2,
        surface: 'asphalt' as const,
        highway: 'residential' as const,
        componentKind: 'residential' as const,
        landcoverClass: 'urban' as const,
      })),
    ]);
    const mission = makeMission({
      id: 'mission-transition-lateral-insufficient-dwell',
      strategy: 'transition_to_woods',
      promise: 'trail_with_connector',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 8, minDistanceKm: 6.8, maxDistanceKm: 9.2, sport: 'running', mode: 'trail', loop: true },
      closure: { required: true, mode: 'connector_repeat_allowed', maxClosureKm: 1.2 },
      target: { componentIds: ['field-core'], componentKinds: ['field_paths', 'forest'], requiredEntry: 'mandatory', minNaturalDwellKm: 3.6, minContinuousTrailKm: 1.5 },
      budgets: { maxPavedKm: 2.4, maxPavedRatio: 0.32, maxBusyRoadRatio: 0.08, maxRepeatKm: 2.1, maxTargetRepeatKm: 0.1, maxConnectorRepeatKm: 1.2, maxOverlapRatio: 0.18, maxAccessPavedKm: 1.2, maxClosurePavedKm: 1.2, maxTargetPavedKm: 0.2 },
    });

    const result = assembleMissionV3(graph, mission);
    const production = result.diagnostics.observationOnly.candidateProduction as Record<string, unknown>;

    expect(production.byProductionSource).toEqual({ target_out_and_back: 1 });
    expect(production.targetLateralSummary).toMatchObject({
      emittedEntryCount: 0,
      topologyInsufficient: true,
      bestCleanLateralNaturalDwellKm: 3.2,
    });
    expect(production.targetLateralDiagnostics).toMatchObject({
      source: 'target_lateral',
      topologyStopReason: 'insufficient_clean_lateral_dwell',
      maxCleanLateralNaturalDwellKm: 3.2,
      requestedNaturalDwellKm: 3.6,
    });
    expect(result.selectedCandidate?.selectedReason).toBe('long_dirty');

    const generated = generateRouteV3FromGraph(
      { start: mission.request.start, targetDistanceKm: mission.request.targetDistanceKm, mode: 'trail', sport: 'running', loop: true },
      graph,
    );
    expect(generated.outcome.type).toBe('refused');
    expect(generated.outcome.type === 'refused' ? generated.outcome.reason : '').toBe(
      'trail topology insufficient: clean target traversal cannot support the requested distance without excessive repeat',
    );
    expect(generated.outcome.type === 'refused' ? generated.outcome.details ?? [] : []).toEqual(
      expect.arrayContaining([
        expect.stringContaining('topology_insufficient: transition_to_woods only produced a long_dirty repeated target route'),
      ]),
    );
  });

  it('transition_to_woods selects adjusted clean_short lateral over repetitive long_dirty when dwell is narrowly under target', () => {
    const graph = makeGraph([
      makeEdge({ id: 'village-access', from: 'start', to: 'woods-entry', lengthKm: 0.7, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'clean-lateral-1', from: 'woods-entry', to: 'lateral-a', lengthKm: 1.62, surface: 'ground', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'clean-lateral-2', from: 'lateral-a', to: 'woods-exit', lengthKm: 1.63, surface: 'dirt', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'clean-short-connector-closure', from: 'woods-exit', to: 'start', lengthKm: 1.7, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'dirty-target-spur-1', from: 'woods-entry', to: 'dirty-a', lengthKm: 3.6, surface: 'ground', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'dirty-target-spur-2', from: 'dirty-a', to: 'dirty-dead', lengthKm: 3.6, surface: 'dirt', highway: 'path', componentKind: 'forest' }),
    ]);
    const mission = makeMission({
      id: 'mission-transition-clean-short-lateral-fallback',
      strategy: 'transition_to_woods',
      promise: 'trail_with_connector',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 8, minDistanceKm: 6.8, maxDistanceKm: 9.2, sport: 'running', mode: 'trail', loop: true },
      closure: { required: true, mode: 'connector_repeat_allowed', maxClosureKm: 1.8 },
      target: { componentIds: ['field-core', 'forest-core'], componentKinds: ['field_paths', 'forest'], requiredEntry: 'mandatory', minNaturalDwellKm: 3.6, minContinuousTrailKm: 1.5 },
      budgets: { maxPavedKm: 2.6, maxPavedRatio: 0.32, maxBusyRoadRatio: 0.08, maxRepeatKm: 8, maxTargetRepeatKm: 0.1, maxConnectorRepeatKm: 2.1, maxOverlapRatio: 0.18, maxAccessPavedKm: 1.2, maxClosurePavedKm: 1.8, maxTargetPavedKm: 0.2 },
    });

    const result = assembleMissionV3(graph, mission);
    const generated = generateRouteV3FromGraph(
      { start: mission.request.start, targetDistanceKm: mission.request.targetDistanceKm, mode: 'trail', sport: 'running', loop: true },
      graph,
    );

    expect(result.selectedCandidate?.selectedReason).toBe('clean_short');
    expect(result.selectedCandidate?.edgeIds).toEqual(['village-access', 'clean-lateral-1', 'clean-lateral-2', 'clean-short-connector-closure']);
    expect(result.selectedCandidate?.metrics.naturalDwellKm).toBeGreaterThanOrEqual(mission.target.minNaturalDwellKm * 0.9);
    expect(result.selectedCandidate?.metrics.naturalDwellKm).toBeLessThan(mission.target.minNaturalDwellKm);
    expect(result.selectedCandidate?.metrics.targetRepeatKm).toBe(0);
    expect(result.selectedCandidate?.lane).toBe('complete_adjustable');
    expect(result.portfolio.candidates.find((candidate) => candidate.selectedReason === 'long_dirty')?.metrics.targetRepeatKm).toBeGreaterThan(0);
    expect(generated.outcome.type).toBe('adjusted');
    expect(generated.outcome.type).not.toBe('generated');
    expect(result.warnings).toContain('transition_to_woods_clean_short_lateral_under_requested_dwell');
    expect(result.portfolio.candidates.map((candidate) => candidate.selectedReason)).toEqual(expect.arrayContaining(['clean_short', 'long_dirty']));
  });

  it('transition_to_woods surfaces moderate repeated-target truth as adjusted instead of refusing useful route evidence', () => {
    const graph = makeGraph([
      makeEdge({ id: 'long-access-1', from: 'start', to: 'access-mid', lengthKm: 1.05, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'long-access-2', from: 'access-mid', to: 'woods-entry', lengthKm: 1.05, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'useful-branch-1', from: 'woods-entry', to: 'branch-a', lengthKm: 1.65, surface: 'ground', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'useful-branch-2', from: 'branch-a', to: 'dead-end', lengthKm: 1.65, surface: 'dirt', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
    ]);
    const mission = makeMission({
      id: 'mission-transition-moderate-repeat-adjusted',
      strategy: 'transition_to_woods',
      promise: 'trail_with_connector',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 8, minDistanceKm: 6.8, maxDistanceKm: 9.2, sport: 'running', mode: 'trail', loop: true },
      closure: { required: true, mode: 'connector_repeat_allowed', maxClosureKm: 2.2 },
      target: { componentIds: ['field-core'], componentKinds: ['field_paths', 'forest'], requiredEntry: 'mandatory', minNaturalDwellKm: 3.6, minContinuousTrailKm: 1.5 },
      budgets: { maxPavedKm: 4.4, maxPavedRatio: 0.45, maxBusyRoadRatio: 0.08, maxRepeatKm: 6, maxTargetRepeatKm: 0.1, maxConnectorRepeatKm: 4.4, maxOverlapRatio: 0.2, maxAccessPavedKm: 2.2, maxClosurePavedKm: 2.2, maxTargetPavedKm: 0.2 },
    });

    const result = assembleMissionV3(graph, mission);
    const generated = generateRouteV3FromGraph(
      { start: mission.request.start, targetDistanceKm: mission.request.targetDistanceKm, mode: 'trail', sport: 'running', loop: true },
      graph,
    );

    expect(result.selectedCandidate?.selectedReason).toBe('long_dirty');
    expect(result.selectedCandidate?.metrics.distanceProducedKm).toBeGreaterThanOrEqual(mission.request.minDistanceKm);
    expect(result.selectedCandidate?.metrics.repeatRatio).toBeGreaterThan(0.2);
    expect(result.selectedCandidate?.metrics.repeatRatio).toBeLessThan(0.35);
    expect(result.selectedCandidate?.metrics.naturalDwellKm).toBeGreaterThanOrEqual(mission.target.minNaturalDwellKm);
    expect(generated.outcome.type).toBe('adjusted');
    expect(generated.outcome.type === 'adjusted' ? generated.outcome.compromises : []).toEqual(expect.arrayContaining([
      expect.stringContaining('repeatRatio'),
    ]));
  });

  it('transition_to_woods rejects clean_short lateral fallback when the route is far below useful distance', () => {
    const graph = makeGraph([
      makeEdge({ id: 'village-access', from: 'start', to: 'woods-entry', lengthKm: 0.4, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'too-short-lateral-1', from: 'woods-entry', to: 'lateral-a', lengthKm: 1.4, surface: 'ground', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'too-short-lateral-2', from: 'lateral-a', to: 'woods-exit', lengthKm: 1.2, surface: 'dirt', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'too-short-closure', from: 'woods-exit', to: 'start', lengthKm: 0.6, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'dirty-target-spur-1', from: 'woods-entry', to: 'dirty-a', lengthKm: 3.6, surface: 'ground', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'dirty-target-spur-2', from: 'dirty-a', to: 'dirty-dead', lengthKm: 3.6, surface: 'dirt', highway: 'path', componentKind: 'forest' }),
    ]);
    const mission = makeMission({
      id: 'mission-transition-too-short-lateral-rejected',
      strategy: 'transition_to_woods',
      promise: 'trail_with_connector',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 8, minDistanceKm: 6.8, maxDistanceKm: 9.2, sport: 'running', mode: 'trail', loop: true },
      closure: { required: true, mode: 'connector_repeat_allowed', maxClosureKm: 1.2 },
      target: { componentIds: ['field-core', 'forest-core'], componentKinds: ['field_paths', 'forest'], requiredEntry: 'mandatory', minNaturalDwellKm: 3.6, minContinuousTrailKm: 1.5 },
      budgets: { maxPavedKm: 2.4, maxPavedRatio: 0.32, maxBusyRoadRatio: 0.08, maxRepeatKm: 8, maxTargetRepeatKm: 0.1, maxConnectorRepeatKm: 2.1, maxOverlapRatio: 0.18, maxAccessPavedKm: 1.2, maxClosurePavedKm: 1.2, maxTargetPavedKm: 0.2 },
    });

    const result = assembleMissionV3(graph, mission);

    expect(result.selectedCandidate?.selectedReason).toBe('long_dirty');
    expect(result.selectedCandidate?.metrics.targetRepeatKm).toBeGreaterThan(0);
    expect(result.portfolio.candidates.find((candidate) => candidate.selectedReason === 'clean_short')?.metrics.distanceProducedKm ?? 0).toBeLessThan(mission.request.minDistanceKm * 0.8);
  });

  it('transition_to_woods does not select open clean_short lateral evidence as the product route', () => {
    const graph = makeGraph([
      makeEdge({ id: 'village-access', from: 'start', to: 'woods-entry', lengthKm: 2.0, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'open-clean-lateral-1', from: 'woods-entry', to: 'lateral-a', lengthKm: 1.65, surface: 'ground', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'open-clean-lateral-2', from: 'lateral-a', to: 'open-exit', lengthKm: 1.65, surface: 'dirt', highway: 'path', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'dirty-target-spur-1', from: 'woods-entry', to: 'dirty-a', lengthKm: 3.6, surface: 'ground', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'dirty-target-spur-2', from: 'dirty-a', to: 'dirty-dead', lengthKm: 3.6, surface: 'dirt', highway: 'path', componentKind: 'forest', landcoverClass: 'forest' }),
    ]);
    const mission = makeMission({
      id: 'mission-transition-open-clean-short-evidence',
      strategy: 'transition_to_woods',
      promise: 'trail_with_connector',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 8, minDistanceKm: 6.8, maxDistanceKm: 9.2, sport: 'running', mode: 'trail', loop: true },
      closure: { required: true, mode: 'connector_repeat_allowed', maxClosureKm: 1.2 },
      target: { componentIds: ['field-core', 'forest-core'], componentKinds: ['field_paths', 'forest'], requiredEntry: 'mandatory', minNaturalDwellKm: 3.6, minContinuousTrailKm: 1.5 },
      budgets: { maxPavedKm: 2.4, maxPavedRatio: 0.32, maxBusyRoadRatio: 0.08, maxRepeatKm: 8, maxTargetRepeatKm: 0.1, maxConnectorRepeatKm: 2.1, maxOverlapRatio: 0.18, maxAccessPavedKm: 2.1, maxClosurePavedKm: 1.2, maxTargetPavedKm: 0.2 },
    });

    const result = assembleMissionV3(graph, mission);

    expect(result.selectedCandidate?.selectedReason).toBe('long_dirty');
    expect(result.selectedCandidate?.returned).toBe(true);
    expect(result.selectedCandidate?.metrics.targetRepeatKm).toBeGreaterThan(0);
    expect(result.portfolio.candidates.find((candidate) => candidate.selectedReason === 'clean_short')?.returned).toBe(false);
  });

  it('transition_to_woods chains multiple clean target cycles before connector closure', () => {
    const graph = makeGraph([
      makeEdge({ id: 'village-access', from: 'start', to: 'woods-entry', lengthKm: 0.5, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'cycle-a-1', from: 'woods-entry', to: 'a1', lengthKm: 1.4, surface: 'ground', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'cycle-a-2', from: 'a1', to: 'a2', lengthKm: 1.4, surface: 'dirt', highway: 'path', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'cycle-a-3', from: 'a2', to: 'woods-entry', lengthKm: 1.4, surface: 'earth', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'cycle-b-1', from: 'woods-entry', to: 'b1', lengthKm: 1.5, surface: 'ground', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'cycle-b-2', from: 'b1', to: 'b2', lengthKm: 1.5, surface: 'dirt', highway: 'path', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'cycle-b-3', from: 'b2', to: 'woods-entry', lengthKm: 1.5, surface: 'earth', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'dirty-spur-1', from: 'woods-entry', to: 'dirty-a', lengthKm: 2.1, surface: 'ground', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'dirty-spur-2', from: 'dirty-a', to: 'dirty-dead-end', lengthKm: 2.1, surface: 'dirt', highway: 'path', componentKind: 'forest', landcoverClass: 'forest' }),
    ]);
    const mission = makeMission({
      id: 'mission-transition-multi-cycle-chain',
      strategy: 'transition_to_woods',
      promise: 'trail_with_connector',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 10, minDistanceKm: 8.5, maxDistanceKm: 11.5, sport: 'running', mode: 'trail', loop: true },
      closure: { required: true, mode: 'connector_repeat_allowed', maxClosureKm: 1.2 },
      target: { componentIds: ['forest-core'], componentKinds: ['forest'], requiredEntry: 'mandatory', minNaturalDwellKm: 4, minContinuousTrailKm: 1.5 },
      budgets: { maxPavedKm: 2.4, maxPavedRatio: 0.32, maxBusyRoadRatio: 0.08, maxRepeatKm: 2.1, maxTargetRepeatKm: 0.1, maxConnectorRepeatKm: 1.2, maxOverlapRatio: 0.18, maxAccessPavedKm: 1.2, maxClosurePavedKm: 1.2, maxTargetPavedKm: 0.2 },
    });

    const result = assembleMissionV3(graph, mission);
    const cycleCandidate = result.portfolio.candidates.find((candidate) => candidate.selectedReason === 'cycle_or_lateral');

    expect(cycleCandidate?.edgeIds).toEqual(expect.arrayContaining(['cycle-a-1', 'cycle-a-2', 'cycle-a-3', 'cycle-b-1', 'cycle-b-2', 'cycle-b-3']));
    expect(cycleCandidate?.metrics.distanceProducedKm).toBeGreaterThanOrEqual(mission.request.minDistanceKm);
    expect(cycleCandidate?.metrics.targetRepeatKm).toBe(0);
    expect(result.selectedCandidate?.selectedReason).toBe('cycle_or_lateral');
    expect(result.diagnostics.observationOnly.topologyLaneCounts).toMatchObject({
      cycle_or_lateral: expect.any(Number),
    });
    expect(result.diagnostics.observationOnly.candidateProduction).toMatchObject({
      eligiblePlanCount: expect.any(Number),
      returnedPlanCount: expect.any(Number),
      maxCleanReturnedDistancePlan: expect.objectContaining({ targetRepeatKm: 0 }),
      selectedProductionDiagnostics: expect.objectContaining({
        source: expect.stringMatching(/^(multi_cycle_chain|indexed_cycle_sequence)$/),
      }),
      indexedTopologyDiagnostics: expect.objectContaining({
        source: 'indexed_cycle_sequence',
        cycleUnitCount: expect.any(Number),
        longestCleanSequenceDistanceKm: expect.any(Number),
      }),
    });
  });

  it('transition_to_woods crosses a clean non-target bridge to chain distinct unused target cycles', () => {
    const graph = makeGraph([
      makeEdge({ id: 'village-access', from: 'start', to: 'woods-entry', lengthKm: 0.5, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'cycle-a-1', from: 'woods-entry', to: 'a1', lengthKm: 1.1, surface: 'ground', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'cycle-a-2', from: 'a1', to: 'a2', lengthKm: 1.1, surface: 'dirt', highway: 'path', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'natural-bridge-to-b', from: 'a2', to: 'b-entry', lengthKm: 0.35, surface: 'ground', highway: 'track', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'cycle-b-1', from: 'b-entry', to: 'b1', lengthKm: 1.25, surface: 'ground', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'cycle-b-2', from: 'b1', to: 'b2', lengthKm: 1.25, surface: 'dirt', highway: 'path', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'cycle-b-3', from: 'b2', to: 'b-entry', lengthKm: 1.25, surface: 'earth', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'natural-bridge-to-exit', from: 'a2', to: 'exit-junction', lengthKm: 0.35, surface: 'ground', highway: 'track', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'cycle-a-3', from: 'exit-junction', to: 'woods-entry', lengthKm: 1.1, surface: 'earth', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'dirty-spur-1', from: 'woods-entry', to: 'dirty-a', lengthKm: 2.6, surface: 'ground', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'dirty-spur-2', from: 'dirty-a', to: 'dirty-dead-end', lengthKm: 2.6, surface: 'dirt', highway: 'path', componentKind: 'forest', landcoverClass: 'forest' }),
    ]);
    const mission = makeMission({
      id: 'mission-transition-clean-bridge-cycle-chain',
      strategy: 'transition_to_woods',
      promise: 'trail_with_connector',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 9, minDistanceKm: 7.65, maxDistanceKm: 10.35, sport: 'running', mode: 'trail', loop: true },
      closure: { required: true, mode: 'connector_repeat_allowed', maxClosureKm: 1.2 },
      target: { componentIds: ['forest-core'], componentKinds: ['forest'], requiredEntry: 'mandatory', minNaturalDwellKm: 4, minContinuousTrailKm: 1.5 },
      budgets: { maxPavedKm: 2.4, maxPavedRatio: 0.32, maxBusyRoadRatio: 0.08, maxRepeatKm: 2.1, maxTargetRepeatKm: 0.1, maxConnectorRepeatKm: 1.2, maxOverlapRatio: 0.18, maxAccessPavedKm: 1.2, maxClosurePavedKm: 1.2, maxTargetPavedKm: 0.2 },
    });

    const result = assembleMissionV3(graph, mission);
    const cycleCandidate = result.selectedCandidate;

    expect(cycleCandidate?.selectedReason).toBe('cycle_or_lateral');
    expect(cycleCandidate?.edgeIds).toEqual(expect.arrayContaining(['cycle-a-1', 'cycle-a-2', 'cycle-a-3', 'natural-bridge-to-b', 'cycle-b-1', 'cycle-b-2', 'cycle-b-3']));
    expect(cycleCandidate?.edgeIds).not.toEqual(expect.arrayContaining(['dirty-spur-1', 'dirty-spur-2']));
    expect(cycleCandidate?.metrics.distanceProducedKm).toBeGreaterThanOrEqual(mission.request.minDistanceKm);
    expect(cycleCandidate?.metrics.targetRepeatKm).toBe(0);
    expect(result.diagnostics.observationOnly.candidateProduction).toMatchObject({
      selectedProductionDiagnostics: expect.objectContaining({
        bridgeExpansion: expect.objectContaining({
          usedCount: expect.any(Number),
          unlockedTargetEdgeCount: expect.any(Number),
        }),
      }),
    });
  });

  it('transition_to_woods indexes cycle units to insert a branch cycle before returning to the trap node', () => {
    const graph = makeGraph([
      makeEdge({ id: 'village-access', from: 'start', to: 'woods-entry', lengthKm: 0.5, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'entry-cycle-1', from: 'woods-entry', to: 'junction-a', lengthKm: 1.05, surface: 'ground', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'entry-cycle-2', from: 'junction-a', to: 'junction-b', lengthKm: 1.05, surface: 'dirt', highway: 'path', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'entry-cycle-3', from: 'junction-b', to: 'woods-entry', lengthKm: 1.05, surface: 'earth', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'branch-cycle-1', from: 'junction-a', to: 'branch-c', lengthKm: 1.15, surface: 'ground', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'branch-cycle-2', from: 'branch-c', to: 'branch-d', lengthKm: 1.15, surface: 'dirt', highway: 'path', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'branch-cycle-3', from: 'branch-d', to: 'junction-a', lengthKm: 1.15, surface: 'earth', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'dirty-repeat-spur', from: 'woods-entry', to: 'dirty-dead-end', lengthKm: 3.1, surface: 'ground', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
    ]);
    const mission = makeMission({
      id: 'mission-transition-indexed-cycle-topology',
      strategy: 'transition_to_woods',
      promise: 'trail_with_connector',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 8, minDistanceKm: 6.8, maxDistanceKm: 9.2, sport: 'running', mode: 'trail', loop: true },
      closure: { required: true, mode: 'connector_repeat_allowed', maxClosureKm: 1.2 },
      target: { componentIds: ['forest-core'], componentKinds: ['forest'], requiredEntry: 'mandatory', minNaturalDwellKm: 5.5, minContinuousTrailKm: 1.5 },
      budgets: { maxPavedKm: 2.4, maxPavedRatio: 0.32, maxBusyRoadRatio: 0.08, maxRepeatKm: 2.1, maxTargetRepeatKm: 0.1, maxConnectorRepeatKm: 1.2, maxOverlapRatio: 0.18, maxAccessPavedKm: 1.2, maxClosurePavedKm: 1.2, maxTargetPavedKm: 0.2 },
    });

    const result = assembleMissionV3(graph, mission);
    const cycleCandidate = result.selectedCandidate;

    expect(cycleCandidate?.selectedReason).toBe('cycle_or_lateral');
    expect(cycleCandidate?.edgeIds).toEqual(expect.arrayContaining(['entry-cycle-1', 'entry-cycle-2', 'entry-cycle-3', 'branch-cycle-1', 'branch-cycle-2', 'branch-cycle-3']));
    expect(cycleCandidate?.edgeIds).not.toContain('dirty-repeat-spur');
    expect(cycleCandidate?.metrics.targetRepeatKm).toBe(0);
    expect(result.diagnostics.observationOnly.candidateProduction).toMatchObject({
      selectedProductionDiagnostics: expect.objectContaining({
        source: 'indexed_cycle_sequence',
        cycleUnitCount: expect.any(Number),
        branchUnitCount: expect.any(Number),
        candidateSequenceCount: expect.any(Number),
        longestCleanSequenceDistanceKm: expect.any(Number),
        topologyStopReason: expect.any(String),
      }),
    });
  });

  it('transition_to_woods diagnoses a nearer insufficient entry and selects a farther cycle-bearing entry', () => {
    const graph = makeGraph([
      makeEdge({ id: 'near-access', from: 'start', to: 'near-entry', lengthKm: 0.2, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'far-access', from: 'start', to: 'cycle-entry', lengthKm: 0.45, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'near-dead-natural', from: 'near-entry', to: 'near-dead', lengthKm: 1.2, surface: 'ground', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'alt-cycle-1', from: 'cycle-entry', to: 'alt-a', lengthKm: 2.0, surface: 'ground', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'alt-cycle-2', from: 'alt-a', to: 'alt-b', lengthKm: 2.0, surface: 'dirt', highway: 'path', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'alt-cycle-3', from: 'alt-b', to: 'cycle-entry', lengthKm: 2.0, surface: 'earth', highway: 'track', componentKind: 'forest', landcoverClass: 'forest' }),
    ]);
    const mission = makeMission({
      id: 'mission-transition-alternative-cycle-entry',
      strategy: 'transition_to_woods',
      promise: 'trail_with_connector',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 7, minDistanceKm: 5.95, maxDistanceKm: 8.05, sport: 'running', mode: 'trail', loop: true },
      closure: { required: true, mode: 'connector_repeat_allowed', maxClosureKm: 1.2 },
      target: { componentIds: ['forest-core'], componentKinds: ['forest'], requiredEntry: 'mandatory', minNaturalDwellKm: 5.5, minContinuousTrailKm: 1.5 },
      budgets: { maxPavedKm: 1.2, maxPavedRatio: 0.32, maxBusyRoadRatio: 0.08, maxRepeatKm: 1.2, maxTargetRepeatKm: 0.1, maxConnectorRepeatKm: 1.2, maxOverlapRatio: 0.18, maxAccessPavedKm: 0.8, maxClosurePavedKm: 0.8, maxTargetPavedKm: 0.2 },
    });

    const result = assembleMissionV3(graph, mission);
    const production = result.diagnostics.observationOnly.candidateProduction as Record<string, unknown>;

    const topAccessEntryDiagnostics = production.topAccessEntryDiagnostics as Record<string, unknown>[];

    expect(result.selectedCandidate?.edgeIds).toEqual(expect.arrayContaining(['far-access', 'alt-cycle-1', 'alt-cycle-2', 'alt-cycle-3']));
    expect(result.selectedCandidate?.edgeIds).not.toContain('near-dead-natural');
    expect(result.selectedCandidate?.metrics.targetRepeatKm).toBe(0);
    expect(production.accessEntrySummary).toMatchObject({
      inspectedEntryCount: expect.any(Number),
      viableCycleEntryCount: expect.any(Number),
      selectedEntryInsufficientCount: expect.any(Number),
      topologyInsufficient: false,
    });
    expect(topAccessEntryDiagnostics[0]).toMatchObject({
      entryNodeId: 'cycle-entry',
      routeEmitted: true,
      entryCycleCount: expect.any(Number),
      closureFeasibleViaAccessReverse: true,
    });
    expect(topAccessEntryDiagnostics.some((entry) => entry.entryNodeId === 'near-entry' && entry.topologyStopReason === 'selected-entry-insufficient')).toBe(true);
  });

  it('transition_to_woods retains clean_short, long_dirty, and cycle_or_lateral topology lanes in the portfolio', () => {
    const graph = makeGraph([
      makeEdge({ id: 'village-access', from: 'start', to: 'woods-entry', lengthKm: 0.5, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'clean-loop-1', from: 'woods-entry', to: 'clean-a', lengthKm: 1.4, surface: 'ground', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'clean-loop-2', from: 'clean-a', to: 'clean-b', lengthKm: 1.4, surface: 'dirt', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'clean-loop-3', from: 'clean-b', to: 'woods-entry', lengthKm: 1.4, surface: 'earth', highway: 'track', componentKind: 'forest' }),
      makeEdge({ id: 'dirty-spur-1', from: 'woods-entry', to: 'dirty-a', lengthKm: 2.1, surface: 'ground', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'dirty-spur-2', from: 'dirty-a', to: 'dirty-dead-end', lengthKm: 2.1, surface: 'dirt', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'lateral-cycle-1', from: 'woods-entry', to: 'lateral-a', lengthKm: 2.8, surface: 'ground', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'lateral-cycle-2', from: 'lateral-a', to: 'woods-exit', lengthKm: 2.9, surface: 'earth', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'lateral-connector-closure', from: 'woods-exit', to: 'start', lengthKm: 0.7, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
    ]);
    const mission = makeMission({
      id: 'mission-transition-topology-portfolio',
      strategy: 'transition_to_woods',
      promise: 'trail_with_connector',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 8, minDistanceKm: 6.8, maxDistanceKm: 9.2, sport: 'running', mode: 'trail', loop: true },
      closure: { required: true, mode: 'connector_repeat_allowed', maxClosureKm: 1.2 },
      target: { componentIds: ['field-core', 'forest-core'], componentKinds: ['field_paths', 'forest'], requiredEntry: 'mandatory', minNaturalDwellKm: 4, minContinuousTrailKm: 1.5 },
      budgets: { maxPavedKm: 2.4, maxPavedRatio: 0.32, maxBusyRoadRatio: 0.08, maxRepeatKm: 4.8, maxTargetRepeatKm: 0.1, maxConnectorRepeatKm: 2.1, maxOverlapRatio: 0.18, maxAccessPavedKm: 1.2, maxClosurePavedKm: 1.2, maxTargetPavedKm: 0.2 },
    });

    const result = assembleMissionV3(graph, mission);
    const candidateReasons = result.portfolio.candidates.map((candidate) => candidate.selectedReason);

    expect(candidateReasons).toEqual(expect.arrayContaining(['clean_short', 'long_dirty', 'entry_exit_lateral', 'cycle_or_lateral']));
    expect(result.diagnostics.observationOnly.topologyLaneCounts).toMatchObject({
      clean_short: expect.any(Number),
      long_dirty: expect.any(Number),
      entry_exit_lateral: expect.any(Number),
      cycle_or_lateral: expect.any(Number),
    });
    expect(result.portfolio.candidates.find((candidate) => candidate.selectedReason === 'long_dirty')?.metrics.targetRepeatKm).toBeGreaterThan(0);
    expect(result.portfolio.candidates.find((candidate) => candidate.selectedReason === 'clean_short')?.metrics.targetRepeatKm).toBe(0);
    expect(result.selectedCandidate?.selectedReason).toBe('entry_exit_lateral');
    expect(result.selectedCandidate?.edgeIds).toEqual(expect.arrayContaining([
      'village-access',
      'lateral-cycle-1',
      'lateral-cycle-2',
      'lateral-connector-closure',
    ]));
    expect(result.selectedCandidate?.metrics.distanceProducedKm).toBeGreaterThanOrEqual(mission.request.minDistanceKm);
  });

  it('park_small returns adjusted/refused but never generated trail', () => {
    const scenario = syntheticParkSmall();
    const result = assembleMissionV3(scenario.graph, scenario.mission);

    expect(result.selectedCandidate?.lane ?? 'no_candidate').not.toBe('complete_valid');
    expect(result.selectedCandidate?.metrics.trailRatio ?? 0).toBeLessThan(0.5);
    expect(result.selectedCandidate?.metrics.pavedRatio ?? 0).toBeGreaterThanOrEqual(0);
    expect(result.diagnostics.blocker ?? result.warnings.join(' ')).toBe('park_capacity_below_requested_distance');
  });

  it('rural_poor_surface_confidence refuses with empty exports policy evidence', () => {
    const scenario = syntheticRuralPoorSurfaceConfidence();
    const result = assembleMissionV3(scenario.graph, scenario.mission);

    expect(result.portfolio.selectedCandidateId).toBeNull();
    expect(result.phaseDiagnostics.finalGate.gateFailures).toEqual(expect.arrayContaining([scenario.expected.requiredBlocker!]));
    expect(result.diagnostics.blocker).toBe(scenario.expected.requiredBlocker);
    expect(result.diagnostics.observationOnly.exportPolicy).toEqual({ emptyOnRefusal: true });
    expect(result.selectedCandidate).toBeNull();
  });

  it('scenic_paved_trap keeps scenic asphalt out of trailRatio', () => {
    const scenario = syntheticScenicPavedTrap();
    const result = assembleMissionV3(scenario.graph, scenario.mission);
    const scenicCandidate = result.portfolio.candidates.find((candidate) => candidate.edgeIds.some((edgeId) => edgeId.includes('scenic')));

    expect(scenicCandidate?.metrics.pavedKm).toBeGreaterThan(0);
    expect(scenicCandidate?.metrics.pavedRatio).toBeGreaterThan(0);
    expect(scenicCandidate?.metrics.trailRatio ?? 0).toBe(0);
    expect(scenicCandidate?.lane).not.toBe('complete_valid');
    expect(scenicCandidate?.rejectedReason ?? result.diagnostics.blocker).toBe(scenario.expected.requiredBlocker);
  });

  it('real graph generator uses mission-driven selected candidate instead of old scenic paved shortcut', () => {
    const scenario = syntheticLargeForestLoop();
    const generated = generateRouteV3FromGraph(
      {
        start: scenario.mission.request.start,
        targetDistanceKm: scenario.mission.request.targetDistanceKm,
        mode: scenario.mission.request.mode,
        sport: 'running',
        loop: true,
      },
      scenario.graph,
    );

    expect(generated.route.edges.map((edge) => edge.id)).not.toContain('scenic-paved-decoy');
    expect(generated.route.metrics.distanceProducedKm).toBeGreaterThanOrEqual(scenario.expected.minDistanceKm!);
    expect(generated.route.metrics.naturalDwellKm).toBeGreaterThanOrEqual(scenario.expected.minNaturalDwellKm!);
    expect(generated.route.assemblyDiagnostics?.selectedReason).toContain('mission-driven');
    expect(generated.outcome.type).not.toBe('refused');
  });
});
