import { describe, expect, it } from 'vitest';
import { assembleMissionV3 } from '@/lib/engine-v3/assemblers/mission-dispatcher';
import { generateRouteV3FromGraph } from '@/lib/engine-v3/route-generator';
import {
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
