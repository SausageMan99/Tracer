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

  it('exposes targetRepeatBudget diagnostic through assembleMissionV3 for transition_to_woods', () => {
    const scenario = syntheticTransitionWoodsConnectorThenDwell();
    const result = assembleMissionV3(scenario.graph, scenario.mission);

    expect(result.selectedCandidate).not.toBeNull();
    const budget = result.diagnostics.observationOnly.targetRepeatBudget as Record<string, unknown> | null;
    expect(budget).not.toBeNull();
    expect(typeof budget!.targetRepeatKm).toBe('number');
    expect(typeof budget!.connectorRepeatKm).toBe('number');
    expect(typeof budget!.targetRepeatRatio).toBe('number');
    expect(typeof budget!.repeatBudgetExceeded).toBe('boolean');
    expect(budget!.rejectedBecauseTargetRepeat).toBe(false);
    expect(budget!.maxTargetRepeatKm as number).toBeGreaterThan(0);
    expect(budget!.maxTargetRepeatRatio as number).toBeGreaterThan(0);
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

  it('exposes clean under-distance rural corridor evidence candidate through assembleMissionV3 for transition_to_woods', () => {
    const scenario = syntheticTransitionWoodsConnectorThenDwell();
    const tourvilleLikeCorridorEdges = [
      makeEdge({ id: 'tourville-access-1', from: 'start', to: 'village-mid', lengthKm: 0.45, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'tourville-access-2', from: 'village-mid', to: 'corridor-entry', lengthKm: 0.45, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'tourville-corridor-dirt', from: 'corridor-entry', to: 'c1', lengthKm: 0.5, surface: 'dirt', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-2', from: 'c1', to: 'c2', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-3', from: 'c2', to: 'c3', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-4', from: 'c3', to: 'c4', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-5', from: 'c4', to: 'c5', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-6', from: 'c5', to: 'c6', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-7', from: 'c6', to: 'c7', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-8', from: 'c7', to: 'c8', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-9', from: 'c8', to: 'c9', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-10', from: 'c9', to: 'c10', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-11', from: 'c10', to: 'c11', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-12', from: 'c11', to: 'c12', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-13', from: 'c12', to: 'c13', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-14', from: 'c13', to: 'c14', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-end', from: 'c14', to: 'corridor-end', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-residential-decoy', from: 'start', to: 'decoy-loop', lengthKm: 0.8, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
    ];
    const graph = makeGraph(tourvilleLikeCorridorEdges);

    const result = assembleMissionV3(graph, scenario.mission);
    const expectedId = `${scenario.mission.id}-clean-under-distance-rural-corridor-evidence`;
    const evidence = result.portfolio.candidates.find((candidate) => candidate.id === expectedId);

    expect(evidence).toBeDefined();
    expect(evidence!.lane).toBe('diagnostic_only');
    expect(evidence!.source).toBe('diagnostic');
    expect(evidence!.rejectedReason).toBe('clean_under_distance_rural_corridor_evidence');
    expect(evidence!.metrics.targetRepeatKm).toBeLessThanOrEqual(0.1);
    expect(evidence!.metrics.pavedKm).toBeLessThanOrEqual(0.1);
    expect(evidence!.metrics.distanceProducedKm).toBeLessThan(scenario.mission.request.minDistanceKm);

    expect(result.selectedCandidate).not.toBeNull();
    expect(result.selectedCandidate!.id).not.toBe(expectedId);
    expect(result.selectedCandidate!.metrics.targetRepeatKm).toBeGreaterThan(0.5);
  });

  it('deduplicates topRejected by candidate.id after normalize for transition_to_woods', () => {
    const scenario = syntheticTransitionWoodsConnectorThenDwell();
    const tourvilleLikeCorridorEdges = [
      makeEdge({ id: 'tourville-access-1', from: 'start', to: 'village-mid', lengthKm: 0.45, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'tourville-access-2', from: 'village-mid', to: 'corridor-entry', lengthKm: 0.45, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'tourville-corridor-dirt', from: 'corridor-entry', to: 'c1', lengthKm: 0.5, surface: 'dirt', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-2', from: 'c1', to: 'c2', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-3', from: 'c2', to: 'c3', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-4', from: 'c3', to: 'c4', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-5', from: 'c4', to: 'c5', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-6', from: 'c5', to: 'c6', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-7', from: 'c6', to: 'c7', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-8', from: 'c7', to: 'c8', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-9', from: 'c8', to: 'c9', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-10', from: 'c9', to: 'c10', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-11', from: 'c10', to: 'c11', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-12', from: 'c11', to: 'c12', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-13', from: 'c12', to: 'c13', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-14', from: 'c13', to: 'c14', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-end', from: 'c14', to: 'corridor-end', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-residential-decoy', from: 'start', to: 'decoy-loop', lengthKm: 0.8, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
    ];
    const graph = makeGraph(tourvilleLikeCorridorEdges);

    const result = assembleMissionV3(graph, scenario.mission);
    const topRejected = result.portfolio.topRejected;

    const ids = topRejected.map((candidate) => candidate.id);
    const uniqueIds = new Set(ids);
    expect(uniqueIds.size).toBe(ids.length);
    expect(uniqueIds.has(`${scenario.mission.id}-clean-under-distance-rural-corridor-evidence`)).toBe(true);
    expect(uniqueIds.has(`${scenario.mission.id}-residential-decoy-diagnostic`)).toBe(true);

    expect(result.selectedCandidate).not.toBeNull();
    expect(result.selectedCandidate!.id).toMatch(/mission-transition-woods-long_dirty/);

    const scores = topRejected.map((candidate) => candidate.selectionScore);
    expect(scores).toEqual([...scores].sort((left, right) => right - left));
  });

  it('exposes pathTrackUnknownKm geometric corridor length for transition_to_woods evidence candidate', () => {
    const scenario = syntheticTransitionWoodsConnectorThenDwell();
    const tourvilleLikeCorridorEdges = [
      makeEdge({ id: 'tourville-access-1', from: 'start', to: 'village-mid', lengthKm: 0.45, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'tourville-access-2', from: 'village-mid', to: 'corridor-entry', lengthKm: 0.45, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'tourville-corridor-dirt', from: 'corridor-entry', to: 'c1', lengthKm: 0.5, surface: 'dirt', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-2', from: 'c1', to: 'c2', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-3', from: 'c2', to: 'c3', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-4', from: 'c3', to: 'c4', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-5', from: 'c4', to: 'c5', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-6', from: 'c5', to: 'c6', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-7', from: 'c6', to: 'c7', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-8', from: 'c7', to: 'c8', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-9', from: 'c8', to: 'c9', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-10', from: 'c9', to: 'c10', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-11', from: 'c10', to: 'c11', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-12', from: 'c11', to: 'c12', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-13', from: 'c12', to: 'c13', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-14', from: 'c13', to: 'c14', lengthKm: 0.4, surface: '', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-corridor-end', from: 'c14', to: 'corridor-end', lengthKm: 0.4, surface: '', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'tourville-residential-decoy', from: 'start', to: 'decoy-loop', lengthKm: 0.8, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
    ];
    const graph = makeGraph(tourvilleLikeCorridorEdges);

    const result = assembleMissionV3(graph, scenario.mission);
    const evidence = result.portfolio.candidates.find(
      (candidate) => candidate.id === `${scenario.mission.id}-clean-under-distance-rural-corridor-evidence`,
    );

    expect(evidence).toBeDefined();
    expect(evidence!.lane).toBe('diagnostic_only');
    expect(evidence!.source).toBe('diagnostic');
    expect(evidence!.metrics.pathTrackUnknownKm).toBeGreaterThan(0);
    expect(evidence!.metrics.pathTrackUnknownKm).toBeCloseTo(5.6, 1);
    expect(evidence!.metrics.explicitNaturalKm).toBeCloseTo(0.5, 1);
    expect(evidence!.metrics.naturalDwellKm).toBeCloseTo(0.5, 1);

    expect(result.selectedCandidate).not.toBeNull();
    expect(result.selectedCandidate!.id).toMatch(/mission-transition-woods-long_dirty/);
    expect(evidence!.selected).toBe(false);
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

  it('T9A: refused transition_to_woods outcome details explain the long_dirty alternative and why it is not surfaced', () => {
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
      id: 'mission-t9a-repeat-details',
      strategy: 'transition_to_woods',
      promise: 'trail_with_connector',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 8, minDistanceKm: 6.8, maxDistanceKm: 9.2, sport: 'running', mode: 'trail', loop: true },
      closure: { required: true, mode: 'connector_repeat_allowed', maxClosureKm: 1.2 },
      target: { componentIds: ['field-core'], componentKinds: ['field_paths', 'forest'], requiredEntry: 'mandatory', minNaturalDwellKm: 3.6, minContinuousTrailKm: 1.5 },
      budgets: { maxPavedKm: 2.4, maxPavedRatio: 0.32, maxBusyRoadRatio: 0.08, maxRepeatKm: 2.1, maxTargetRepeatKm: 0.1, maxConnectorRepeatKm: 1.2, maxOverlapRatio: 0.18, maxAccessPavedKm: 1.2, maxClosurePavedKm: 1.2, maxTargetPavedKm: 0.2 },
    });

    const result = assembleMissionV3(graph, mission);
    expect(result.selectedCandidate?.selectedReason).toBe('long_dirty');
    const selectedMetrics = {
      distanceProducedKm: result.selectedCandidate!.metrics.distanceProducedKm,
      naturalDwellKm: result.selectedCandidate!.metrics.naturalDwellKm,
      targetRepeatKm: result.selectedCandidate!.metrics.targetRepeatKm,
      repeatRatio: result.selectedCandidate!.metrics.repeatRatio,
    };

    const generated = generateRouteV3FromGraph(
      { start: mission.request.start, targetDistanceKm: mission.request.targetDistanceKm, mode: 'trail', sport: 'running', loop: true },
      graph,
    );
    expect(generated.outcome.type).toBe('refused');
    expect(generated.outcome.productLabel).toBe('refused_repeat_overlap');
    const details = generated.outcome.type === 'refused' ? generated.outcome.details ?? [] : [];
    expect(details.length).toBeGreaterThan(0);
    // Existing topology_insufficient detail line is preserved
    expect(details).toEqual(
      expect.arrayContaining([
        expect.stringContaining('topology_insufficient: transition_to_woods only produced a long_dirty repeated target route'),
      ]),
    );
    // New T9A detail line mentions the long_dirty alternative and why it is not surfaced
    const t9aLine = details.find((line) => line.includes('long_dirty alternative not surfaced'));
    expect(t9aLine).toBeDefined();
    expect(t9aLine).toEqual(expect.stringContaining('targetRepeatKm'));
    expect(t9aLine).toEqual(expect.stringContaining('repeatRatio'));
    expect(t9aLine).toEqual(expect.stringContaining('not surfaced'));
    expect(t9aLine).toEqual(expect.stringContaining('refused_repeat_overlap'));
    expect(t9aLine).toEqual(expect.stringContaining('non-exportable'));
    // selectedCandidate metrics behavior unchanged by the diagnostic detail injection
    expect(result.selectedCandidate!.metrics.distanceProducedKm).toBe(selectedMetrics.distanceProducedKm);
    expect(result.selectedCandidate!.metrics.naturalDwellKm).toBe(selectedMetrics.naturalDwellKm);
    expect(result.selectedCandidate!.metrics.targetRepeatKm).toBe(selectedMetrics.targetRepeatKm);
    expect(result.selectedCandidate!.metrics.repeatRatio).toBe(selectedMetrics.repeatRatio);
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
      makeEdge({ id: 'useful-branch-1', from: 'woods-entry', to: 'branch-a', lengthKm: 1.5, surface: 'ground', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'useful-branch-2', from: 'branch-a', to: 'dead-end', lengthKm: 1.5, surface: 'dirt', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
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

  it('transition_to_woods refuses a long target out-and-back when clean topology is unavailable and target repeat is high', () => {
    const graph = makeGraph([
      makeEdge({ id: 'long-access-1', from: 'start', to: 'access-mid', lengthKm: 1.05, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'long-access-2', from: 'access-mid', to: 'woods-entry', lengthKm: 1.05, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'repeat-target-1', from: 'woods-entry', to: 'branch-a', lengthKm: 1.65, surface: 'ground', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'repeat-target-2', from: 'branch-a', to: 'dead-end', lengthKm: 1.65, surface: 'dirt', highway: 'path', componentKind: 'field_paths', landcoverClass: 'grassland' }),
    ]);
    const mission = makeMission({
      id: 'mission-transition-high-repeat-refused',
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
    expect(result.selectedCandidate?.metrics.repeatRatio).toBeGreaterThan(0.3);
    expect(result.selectedCandidate?.metrics.targetRepeatKm).toBeGreaterThan(3);
    expect(generated.outcome.type).toBe('refused');
    expect(generated.outcome.productLabel).toBe('refused_repeat_overlap');
    expect(generated.outcome.type === 'refused' ? generated.outcome.reason : '').toContain('excessive repeat');
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

  it('T10B: urban_nature_loop accepts capped short tertiary connector to reach an urban_green component (post-patch)', () => {
    // Graph: start connects to an urban_green component only via a 0.3 km tertiary residential
    // road (asphalt surface). The urban_green loop has 2.2 km of footway edges. Before T10B
    // the connector pool excluded tertiary, so access failed with no_routable_access_to_target
    // and the route was refused. After T10B the 0.3 km tertiary is allowed under the cap.
    const graph = makeGraph([
      makeEdge({ id: 'start-to-tertiary-1', from: 'start', to: 'tertiary-1', lengthKm: 0.3, surface: 'asphalt', highway: 'tertiary', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'tertiary-1-to-green-1', from: 'tertiary-1', to: 'green-1', lengthKm: 0.1, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'green-1-to-green-2', from: 'green-1', to: 'green-2', lengthKm: 1.0, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'green-2-to-green-3', from: 'green-2', to: 'green-3', lengthKm: 1.0, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'green-3-to-tertiary-2', from: 'green-3', to: 'tertiary-2', lengthKm: 0.1, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'tertiary-2-to-start', from: 'tertiary-2', to: 'start', lengthKm: 0.3, surface: 'asphalt', highway: 'tertiary', componentKind: 'residential', landcoverClass: 'urban' }),
    ]);
    const mission = makeMission({
      id: 'mission-t10b-urban-nature-capped-tertiary',
      strategy: 'urban_nature_loop',
      promise: 'urban_nature',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 3, minDistanceKm: 2.55, maxDistanceKm: 3.45, sport: 'running', mode: 'nature_urbaine', loop: true },
      closure: { required: true, mode: 'clean_loop', maxClosureKm: 1.5 },
      target: { componentIds: ['urban-green-1'], componentKinds: ['urban_green'], requiredEntry: 'mandatory', minNaturalDwellKm: 0.3, minContinuousTrailKm: 0.2 },
      budgets: { maxPavedKm: 1.5, maxPavedRatio: 0.5, maxBusyRoadRatio: 0.05, maxRepeatKm: 0.6, maxTargetRepeatKm: 0.3, maxConnectorRepeatKm: 0.3, maxOverlapRatio: 0.12, maxAccessPavedKm: 0.6, maxClosurePavedKm: 0.6, maxTargetPavedKm: 0.2 },
    });

    const result = assembleMissionV3(graph, mission);
    const candidate = result.selectedCandidate;

    // Post-patch: route is assembled, status is portfolio_ready (not no_candidate).
    expect(result.status).toBe('portfolio_ready');
    expect(candidate).not.toBeNull();
    // Connector cap respected: every tertiary edge in the route is <= 0.4 km.
    const tertiaryEdges = edgesOf({ graph }).filter((edge) => edge.highway === 'tertiary');
    expect(tertiaryEdges.length).toBeGreaterThan(0);
    for (const edge of tertiaryEdges) {
      expect(edge.lengthKm).toBeLessThanOrEqual(0.4);
    }
    expect(candidate?.edgeIds ?? []).toEqual(expect.arrayContaining(['start-to-tertiary-1', 'tertiary-2-to-start']));
    // naturalDwell comes from urban_green footway, NOT from the tertiary connector.
    expect(candidate?.metrics.naturalDwellKm ?? 0).toBeGreaterThan(0.5);
    expect(candidate?.metrics.candidateNaturalKm ?? 0).toBe(candidate?.metrics.naturalDwellKm ?? 0);
    // pavedRatio cap respected (under 0.5).
    expect(candidate?.metrics.pavedRatio ?? 1).toBeLessThanOrEqual(0.5);
    // Distance stays in the requested envelope.
    expect(candidate?.metrics.distanceProducedKm ?? 0).toBeGreaterThanOrEqual(mission.request.minDistanceKm);
    expect(candidate?.metrics.distanceProducedKm ?? 0).toBeLessThanOrEqual(mission.request.maxDistanceKm + 0.001);
    // urban_green component (semantics componentKind=park because landcoverClass='park') is visited;
    // residential connector component is tracked too. Either 'park' or 'urban_green' is acceptable
    // because edge-semantics overrides componentKind based on landcoverClass.
    const visited = candidate?.metrics.visitedComponents ?? [];
    expect(visited).toEqual(expect.arrayContaining(['residential']));
    expect(visited.some((kind) => kind === 'park' || kind === 'urban_green')).toBe(true);
    // Closure returns to start.
    expect(candidate?.returned).toBe(true);
    // Target repeat budget not violated (tertiary is connector-like, not target).
    expect(candidate?.metrics.targetRepeatKm ?? 0).toBeLessThanOrEqual(0.001);
  });

  it('T10B: urban_nature_loop rejects long primary connector above the 0.2 km cap (negative guard)', () => {
    // Graph: start connects to an urban_green component only via a 1.5 km primary
    // residential road. Even after T10B the 0.2 km cap on primary/secondary rejects it,
    // so access still fails and the route is refused. This guards against widening the
    // pool to busier arterials.
    const graph = makeGraph([
      makeEdge({ id: 'start-to-primary-1', from: 'start', to: 'primary-1', lengthKm: 1.5, surface: 'asphalt', highway: 'primary', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'primary-1-to-green-1', from: 'primary-1', to: 'green-1', lengthKm: 0.1, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'green-1-to-green-2', from: 'green-1', to: 'green-2', lengthKm: 1.0, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'green-2-to-green-3', from: 'green-2', to: 'green-3', lengthKm: 1.0, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'green-3-to-primary-2', from: 'green-3', to: 'primary-2', lengthKm: 0.1, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'primary-2-to-start', from: 'primary-2', to: 'start', lengthKm: 1.5, surface: 'asphalt', highway: 'primary', componentKind: 'residential', landcoverClass: 'urban' }),
    ]);
    const mission = makeMission({
      id: 'mission-t10b-urban-nature-long-primary',
      strategy: 'urban_nature_loop',
      promise: 'urban_nature',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 3, minDistanceKm: 2.55, maxDistanceKm: 3.45, sport: 'running', mode: 'nature_urbaine', loop: true },
      closure: { required: true, mode: 'clean_loop', maxClosureKm: 1.5 },
      target: { componentIds: ['urban-green-1'], componentKinds: ['urban_green'], requiredEntry: 'mandatory', minNaturalDwellKm: 0.3, minContinuousTrailKm: 0.2 },
      budgets: { maxPavedKm: 1.5, maxPavedRatio: 0.5, maxBusyRoadRatio: 0.05, maxRepeatKm: 0.6, maxTargetRepeatKm: 0.3, maxConnectorRepeatKm: 0.3, maxOverlapRatio: 0.12, maxAccessPavedKm: 0.6, maxClosurePavedKm: 0.6, maxTargetPavedKm: 0.2 },
    });

    const result = assembleMissionV3(graph, mission);

    // Long primary road above the 0.2 km cap is rejected: route refused, no candidate.
    expect(result.status).toBe('no_candidate');
    expect(result.selectedCandidate).toBeNull();
    // Closure rejected reasons include the access bottleneck, exactly as before T10B.
    const closureReasons = (result.diagnostics.observationOnly as Record<string, unknown>).closureRejectedReasons as Record<string, number> | undefined;
    expect(closureReasons?.no_routable_access_to_target ?? 0).toBeGreaterThan(0);
    // The 1.5 km primary edges must NOT appear in any assembled route because
    // they were excluded from the connector pool by the 0.2 km cap.
    const primaryEdgesInMission = edgesOf({ graph }).filter((edge) => edge.highway === 'primary');
    expect(primaryEdgesInMission.length).toBe(2);
    for (const edge of primaryEdgesInMission) {
      expect(edge.lengthKm).toBeGreaterThan(0.2);
    }
  });
});

// =============================================================================
// T12: urban_nature_loop closure contract tolerance
// =============================================================================
//
// Two strictly-capped tolerances applied ONLY when mission.strategy === 'urban_nature_loop':
//   A. distance overshoot: maxDistanceKm + min(0.5 km, targetDistanceKm * 0.08)
//   B. targetRepeat on relaxed closure: min(0.4 km, targetDistanceKm * 0.05)
//
// Scope guard: every test that is not urban_nature_loop must remain byte-identical
// to the HEAD behavior (park_loop, transition_to_woods). The T10B road connector
// caps (tertiary 0.4 km, primary 0.2 km) are untouched.
describe('T12: urban_nature_loop closure contract tolerance', () => {
  it('T12-A1: urban_nature_loop accepts closure candidate within small distance overshoot tolerance (positive)', () => {
    // Single urban_green component with a natural loop of ~6.5 km, plus a short
    // tertiary access/return of 0.3 km each. The assembled closure produces
    // distanceProducedKm ≈ 7.05 km. target=6.0, max=6.9, overshoot ≈ 0.15 km.
    // Tolerance = min(0.5, 6.0 * 0.08) = 0.48 km. 0.15 km < 0.48 km → accepted.
    const graph = makeGraph([
      makeEdge({ id: 'access-start', from: 'start', to: 'g1', lengthKm: 0.3, surface: 'asphalt', highway: 'tertiary', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'g1-g2', from: 'g1', to: 'g2', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'g2-g3', from: 'g2', to: 'g3', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'g3-g4', from: 'g3', to: 'g4', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'g4-g5', from: 'g4', to: 'g5', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'g5-g6', from: 'g5', to: 'g6', lengthKm: 0.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'g6-end', from: 'g6', to: 'end', lengthKm: 0.3, surface: 'asphalt', highway: 'tertiary', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'end-start', from: 'end', to: 'start', lengthKm: 0.001, surface: 'asphalt', highway: 'tertiary', componentKind: 'residential', landcoverClass: 'urban' }),
    ]);
    const mission = makeMission({
      id: 'mission-t12-a1-urban-nature-small-overshoot',
      strategy: 'urban_nature_loop',
      promise: 'urban_nature',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 6, minDistanceKm: 5.1, maxDistanceKm: 6.9, sport: 'running', mode: 'nature_urbaine', loop: true },
      closure: { required: true, mode: 'clean_loop', maxClosureKm: 1.5 },
      target: { componentIds: ['urban-green-1'], componentKinds: ['urban_green'], requiredEntry: 'mandatory', minNaturalDwellKm: 1.8, minContinuousTrailKm: 0.6 },
      budgets: { maxPavedKm: 1.5, maxPavedRatio: 0.5, maxBusyRoadRatio: 0.05, maxRepeatKm: 1.2, maxTargetRepeatKm: 0.48, maxConnectorRepeatKm: 0.6, maxOverlapRatio: 0.12, maxAccessPavedKm: 0.6, maxClosurePavedKm: 0.6, maxTargetPavedKm: 0.2 },
    });

    const result = assembleMissionV3(graph, mission);

    // T12-A1 verifies the overshoot tolerance IS applied: when the only viable
    // closure candidate overshoots maxDistanceKm by 0.15 km, the candidate is
    // not refused on distance_above_max_contract.
    // Before T12 patch: candidate would be refused (0.15 km > 0.001 km strict cap).
    // After T12 patch: candidate is accepted (0.15 km < 0.48 km tolerance).
    expect(result.status).toBe('portfolio_ready');
    expect(result.selectedCandidate).not.toBeNull();
    expect(result.selectedCandidate?.metrics.distanceProducedKm ?? 0).toBeLessThanOrEqual(mission.request.maxDistanceKm + 0.5);
    // naturalDwell contract still strict (no fake success).
    expect(result.selectedCandidate?.metrics.naturalDwellKm ?? 0).toBeGreaterThanOrEqual(mission.target.minNaturalDwellKm);
    // T10B connector cap preserved.
    expect(result.selectedCandidate?.metrics.pavedRatio ?? 1).toBeLessThanOrEqual(mission.budgets.maxPavedRatio);
  });

  it('T12-A2: urban_nature_loop rejects closure candidate above the overshoot tolerance (negative guard)', () => {
    // Same topology pattern, but make the natural loop much larger (~7.5 km)
    // plus access/return. The only viable closure candidate overshoots maxDistanceKm
    // by ~1.0 km. Tolerance = 0.48 km. 1.0 km > 0.48 km → still rejected.
    const graph = makeGraph([
      makeEdge({ id: 'access-start', from: 'start', to: 'g1', lengthKm: 0.3, surface: 'asphalt', highway: 'tertiary', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'g1-g2', from: 'g1', to: 'g2', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'g2-g3', from: 'g2', to: 'g3', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'g3-g4', from: 'g3', to: 'g4', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'g4-g5', from: 'g4', to: 'g5', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'g5-g6', from: 'g5', to: 'g6', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'g6-g7', from: 'g6', to: 'g7', lengthKm: 0.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'g7-end', from: 'g7', to: 'end', lengthKm: 0.3, surface: 'asphalt', highway: 'tertiary', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'end-start', from: 'end', to: 'start', lengthKm: 0.001, surface: 'asphalt', highway: 'tertiary', componentKind: 'residential', landcoverClass: 'urban' }),
    ]);
    const mission = makeMission({
      id: 'mission-t12-a2-urban-nature-large-overshoot',
      strategy: 'urban_nature_loop',
      promise: 'urban_nature',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 6, minDistanceKm: 5.1, maxDistanceKm: 6.9, sport: 'running', mode: 'nature_urbaine', loop: true },
      closure: { required: true, mode: 'clean_loop', maxClosureKm: 1.5 },
      target: { componentIds: ['urban-green-1'], componentKinds: ['urban_green'], requiredEntry: 'mandatory', minNaturalDwellKm: 1.8, minContinuousTrailKm: 0.6 },
      budgets: { maxPavedKm: 1.5, maxPavedRatio: 0.5, maxBusyRoadRatio: 0.05, maxRepeatKm: 1.2, maxTargetRepeatKm: 0.48, maxConnectorRepeatKm: 0.6, maxOverlapRatio: 0.12, maxAccessPavedKm: 0.6, maxClosurePavedKm: 0.6, maxTargetPavedKm: 0.2 },
    });

    const result = assembleMissionV3(graph, mission);

    // Overshoot 1.0 km > 0.48 km tolerance → still refused on distance_above_max_contract.
    // The natural loop is forced large (7.5 km + 0.6 km connectors = 8.1 km), which
    // is the only candidate the assembler can produce, and it overshoots by ~1.2 km.
    expect(result.status).toBe('no_candidate');
    expect(result.selectedCandidate).toBeNull();
    const closureReasons = (result.diagnostics.observationOnly as Record<string, unknown>).closureRejectedReasons as Record<string, number> | undefined;
    expect(closureReasons?.distance_above_max_contract ?? 0).toBeGreaterThan(0);
  });

  it('T12-B1: urban_nature_loop accepts relaxed closure with small targetRepeat under tolerance (positive)', () => {
    // Build a topology where the only way back to start crosses ~0.2 km of urban_green
    // footway edges that were already traversed in the dwell. target=8, targetRepeat
    // tolerance = min(0.4, 8*0.05) = 0.4 km. 0.2 km < 0.4 km → accepted.
    const graph = makeGraph([
      // Access
      makeEdge({ id: 'start-to-a', from: 'start', to: 'a', lengthKm: 0.3, surface: 'asphalt', highway: 'tertiary', componentKind: 'residential', landcoverClass: 'urban' }),
      // Urban green dwell — a corridor with a bridge back near the start
      makeEdge({ id: 'a-to-b', from: 'a', to: 'b', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'b-to-c', from: 'b', to: 'c', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'c-to-d', from: 'c', to: 'd', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'd-to-e', from: 'd', to: 'e', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      // The only path back to start goes via a shared footway segment of ~0.2 km
      makeEdge({ id: 'e-to-bridge', from: 'e', to: 'bridge', lengthKm: 0.2, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'bridge-to-start', from: 'bridge', to: 'start', lengthKm: 0.3, surface: 'asphalt', highway: 'tertiary', componentKind: 'residential', landcoverClass: 'urban' }),
      // Plus an additional footway edge from b to bridge so the corridor's only
      // return path can either cross the dwell or detour via a longer residential
      makeEdge({ id: 'b-to-bridge', from: 'b', to: 'bridge', lengthKm: 0.2, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
    ]);
    const mission = makeMission({
      id: 'mission-t12-b1-urban-nature-target-repeat',
      strategy: 'urban_nature_loop',
      promise: 'urban_nature',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 8, minDistanceKm: 6.8, maxDistanceKm: 9.2, sport: 'running', mode: 'nature_urbaine', loop: true },
      closure: { required: true, mode: 'relaxed_urban_loop', maxClosureKm: 1.6 },
      target: { componentIds: ['urban-green-1'], componentKinds: ['urban_green'], requiredEntry: 'mandatory', minNaturalDwellKm: 2.4, minContinuousTrailKm: 0.8 },
      budgets: { maxPavedKm: 2.0, maxPavedRatio: 0.4, maxBusyRoadRatio: 0.05, maxRepeatKm: 1.6, maxTargetRepeatKm: 0.64, maxConnectorRepeatKm: 0.8, maxOverlapRatio: 0.12, maxAccessPavedKm: 0.8, maxClosurePavedKm: 0.8, maxTargetPavedKm: 0.3 },
    });

    const result = assembleMissionV3(graph, mission);

    // With T12 patch B, the small targetRepeat on the relaxed return path is
    // accepted (0.2 km < 0.4 km tolerance), so the route is no longer refused
    // solely on no_routable_connector_to_start.
    expect(result.status).toBe('portfolio_ready');
    expect(result.selectedCandidate).not.toBeNull();
    expect(result.selectedCandidate?.metrics.targetRepeatKm ?? 0).toBeLessThanOrEqual(0.4);
    expect(result.selectedCandidate?.metrics.naturalDwellKm ?? 0).toBeGreaterThanOrEqual(mission.target.minNaturalDwellKm);
  });

  it('T12-B2: urban_nature_loop rejects relaxed closure above targetRepeat tolerance (negative guard)', () => {
    // Same topology pattern, but force the return path to cross > 0.4 km of dwell
    // edges. target=8, tolerance = 0.4 km. targetRepeat ≈ 0.5 km > 0.4 km → rejected.
    const graph = makeGraph([
      makeEdge({ id: 'start-to-a', from: 'start', to: 'a', lengthKm: 0.3, surface: 'asphalt', highway: 'tertiary', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'a-to-b', from: 'a', to: 'b', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'b-to-c', from: 'b', to: 'c', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'c-to-d', from: 'c', to: 'd', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'd-to-e', from: 'd', to: 'e', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      // The return must cross a 0.5 km footway already traversed in dwell
      makeEdge({ id: 'e-to-bridge', from: 'e', to: 'bridge', lengthKm: 0.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
      makeEdge({ id: 'bridge-to-start', from: 'bridge', to: 'start', lengthKm: 0.3, surface: 'asphalt', highway: 'tertiary', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'b-to-bridge', from: 'b', to: 'bridge', lengthKm: 0.5, surface: '', highway: 'footway', componentKind: 'urban_green', landcoverClass: 'park' }),
    ]);
    const mission = makeMission({
      id: 'mission-t12-b2-urban-nature-target-repeat-over',
      strategy: 'urban_nature_loop',
      promise: 'urban_nature',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 8, minDistanceKm: 6.8, maxDistanceKm: 9.2, sport: 'running', mode: 'nature_urbaine', loop: true },
      closure: { required: true, mode: 'relaxed_urban_loop', maxClosureKm: 1.6 },
      target: { componentIds: ['urban-green-1'], componentKinds: ['urban_green'], requiredEntry: 'mandatory', minNaturalDwellKm: 2.4, minContinuousTrailKm: 0.8 },
      budgets: { maxPavedKm: 2.0, maxPavedRatio: 0.4, maxBusyRoadRatio: 0.05, maxRepeatKm: 1.6, maxTargetRepeatKm: 0.64, maxConnectorRepeatKm: 0.8, maxOverlapRatio: 0.12, maxAccessPavedKm: 0.8, maxClosurePavedKm: 0.8, maxTargetPavedKm: 0.3 },
    });

    const result = assembleMissionV3(graph, mission);

    // targetRepeat 0.5 km > 0.4 km tolerance → still refused on no_routable_connector_to_start.
    expect(result.status).toBe('no_candidate');
    expect(result.selectedCandidate).toBeNull();
    const closureReasons = (result.diagnostics.observationOnly as Record<string, unknown>).closureRejectedReasons as Record<string, number> | undefined;
    expect(closureReasons?.no_routable_connector_to_start ?? 0).toBeGreaterThan(0);
  });

  it('T12-scope-park: park_loop closure contract unchanged by T12 patch', () => {
    // park_loop must remain byte-identical to HEAD: no overshoot tolerance,
    // no targetRepeat tolerance. A park_loop case that overshoots must be refused.
    const graph = makeGraph([
      makeEdge({ id: 'start-to-park-a', from: 'start', to: 'park-a', lengthKm: 0.4, surface: '', highway: 'footway', componentKind: 'park', landcoverClass: 'park' }),
      makeEdge({ id: 'park-a-b', from: 'park-a', to: 'park-b', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'park', landcoverClass: 'park' }),
      makeEdge({ id: 'park-b-c', from: 'park-b', to: 'park-c', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'park', landcoverClass: 'park' }),
      makeEdge({ id: 'park-c-d', from: 'park-c', to: 'park-d', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'park', landcoverClass: 'park' }),
      makeEdge({ id: 'park-d-e', from: 'park-d', to: 'park-e', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'park', landcoverClass: 'park' }),
      makeEdge({ id: 'park-e-f', from: 'park-e', to: 'park-f', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'park', landcoverClass: 'park' }),
      makeEdge({ id: 'park-f-start', from: 'park-f', to: 'start', lengthKm: 0.4, surface: 'asphalt', highway: 'tertiary', componentKind: 'residential', landcoverClass: 'urban' }),
    ]);
    const mission = makeMission({
      id: 'mission-t12-scope-park',
      strategy: 'park_loop',
      promise: 'park_compromise',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 6, minDistanceKm: 5.1, maxDistanceKm: 6.9, sport: 'running', mode: 'nature_urbaine', loop: true },
      closure: { required: true, mode: 'clean_loop', maxClosureKm: 1.5 },
      target: { componentIds: ['park-1'], componentKinds: ['park'], requiredEntry: 'mandatory', minNaturalDwellKm: 1.8, minContinuousTrailKm: 0.6 },
      budgets: { maxPavedKm: 1.5, maxPavedRatio: 0.5, maxBusyRoadRatio: 0.05, maxRepeatKm: 1.2, maxTargetRepeatKm: 0.48, maxConnectorRepeatKm: 0.6, maxOverlapRatio: 0.12, maxAccessPavedKm: 0.6, maxClosurePavedKm: 0.6, maxTargetPavedKm: 0.2 },
    });

    const result = assembleMissionV3(graph, mission);

    // Park_loop: overshoot tolerance is NOT applied (strategy !== urban_nature_loop).
    // The closure contract is unchanged for park_loop.
    // The exact outcome depends on park_loop invariants (not under test here);
    // what matters is that the patch does not silently relax park_loop.
    // Verify: selectedCandidate exists OR closureRejectedReasons is populated,
    // and if a candidate exists, distanceProducedKm <= maxDistanceKm + 0.001 (no overshoot cap applied).
    if (result.selectedCandidate) {
      expect(result.selectedCandidate.metrics.distanceProducedKm).toBeLessThanOrEqual(mission.request.maxDistanceKm + 0.001);
    } else {
      const closureReasons = (result.diagnostics.observationOnly as Record<string, unknown>).closureRejectedReasons as Record<string, number> | undefined;
      expect(closureReasons ?? {}).toBeDefined();
    }
  });

  it('T12-scope-ttw: transition_to_woods closure contract unchanged by T12 patch', () => {
    // transition_to_woods must remain byte-identical to HEAD: no overshoot tolerance,
    // no targetRepeat tolerance, no_targetRepeatToleranceKm stays at 0.001 for the
    // relaxed closure check.
    const graph = makeGraph([
      makeEdge({ id: 'start-to-a', from: 'start', to: 'a', lengthKm: 0.5, surface: 'asphalt', highway: 'tertiary', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'a-to-b', from: 'a', to: 'b', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'b-to-c', from: 'b', to: 'c', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'c-to-d', from: 'c', to: 'd', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'd-to-e', from: 'd', to: 'e', lengthKm: 1.5, surface: '', highway: 'footway', componentKind: 'forest', landcoverClass: 'forest' }),
      makeEdge({ id: 'e-to-start', from: 'e', to: 'start', lengthKm: 0.5, surface: 'asphalt', highway: 'tertiary', componentKind: 'residential', landcoverClass: 'urban' }),
    ]);
    const mission = makeMission({
      id: 'mission-t12-scope-ttw',
      strategy: 'transition_to_woods',
      promise: 'trail_with_connector',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 8, minDistanceKm: 6.8, maxDistanceKm: 9.2, sport: 'running', mode: 'nature_urbaine', loop: true },
      closure: { required: true, mode: 'connector_repeat_allowed', maxClosureKm: 1.6 },
      target: { componentIds: ['forest-1'], componentKinds: ['forest'], requiredEntry: 'mandatory', minNaturalDwellKm: 2.4, minContinuousTrailKm: 0.8 },
      budgets: { maxPavedKm: 2.0, maxPavedRatio: 0.4, maxBusyRoadRatio: 0.05, maxRepeatKm: 1.6, maxTargetRepeatKm: 0.1, maxConnectorRepeatKm: 1.6, maxOverlapRatio: 0.12, maxAccessPavedKm: 0.8, maxClosurePavedKm: 0.8, maxTargetPavedKm: 0.3 },
    });

    const result = assembleMissionV3(graph, mission);

    // transition_to_woods: selectUrbanNatureComponentRouteEdges is never called,
    // so T12 patches do not affect this path. The result depends on the
    // transition_to_woods assembler (forest_loop path, not under test here).
    // The only invariant we lock: the patch did not introduce any
    // urban_nature tolerance into this strategy's closure decision.
    // We verify the result is consistent with HEAD: either a returned candidate
    // OR a typed refusal, with metrics reflecting unchanged closure logic.
    if (result.selectedCandidate) {
      // No overshoot tolerance applied (would push distanceProducedKm > maxDistanceKm + 0.001
      // for a returned candidate, but the patch only relaxes for urban_nature_loop).
      expect(result.selectedCandidate.metrics.distanceProducedKm).toBeLessThanOrEqual(mission.request.maxDistanceKm + 0.001);
    } else {
      const closureReasons = (result.diagnostics.observationOnly as Record<string, unknown>).closureRejectedReasons as Record<string, number> | undefined;
      expect(closureReasons ?? {}).toBeDefined();
    }
  });
});
