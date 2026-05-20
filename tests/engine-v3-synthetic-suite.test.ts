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

    expect(candidateReasons).toEqual(expect.arrayContaining(['clean_short', 'long_dirty', 'cycle_or_lateral']));
    expect(result.diagnostics.observationOnly.topologyLaneCounts).toMatchObject({
      clean_short: expect.any(Number),
      long_dirty: expect.any(Number),
      cycle_or_lateral: expect.any(Number),
    });
    expect(result.portfolio.candidates.find((candidate) => candidate.selectedReason === 'long_dirty')?.metrics.targetRepeatKm).toBeGreaterThan(0);
    expect(result.portfolio.candidates.find((candidate) => candidate.selectedReason === 'clean_short')?.metrics.targetRepeatKm).toBe(0);
    expect(result.selectedCandidate?.selectedReason).toBe('cycle_or_lateral');
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
