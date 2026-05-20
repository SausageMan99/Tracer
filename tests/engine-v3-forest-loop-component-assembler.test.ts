import { describe, expect, it } from 'vitest';
import { assembleForestLoopMissionV3 } from '@/lib/engine-v3/assemblers/forest-loop-assembler';
import { makeEdge, makeGraph, makeMission } from '@/lib/engine-v3/testing/synthetic-graphs';

function forestMission(overrides: Parameters<typeof makeMission>[0] = {}) {
  return makeMission({
    id: 'mission-component-first-forest-loop',
    strategy: 'forest_loop',
    promise: 'pure_trail',
    request: {
      start: { lat: 49, lng: -0.4 },
      targetDistanceKm: 10,
      minDistanceKm: 8,
      maxDistanceKm: 12,
      sport: 'running',
      mode: 'trail',
      loop: true,
    },
    target: {
      componentIds: ['forest'],
      componentKinds: ['forest'],
      requiredEntry: 'mandatory',
      minNaturalDwellKm: 5.5,
      minContinuousTrailKm: 2,
    },
    budgets: {
      maxPavedKm: 2,
      maxPavedRatio: 0.2,
      maxBusyRoadRatio: 0.05,
      maxRepeatKm: 1.2,
      maxTargetRepeatKm: 0.8,
      maxConnectorRepeatKm: 0.8,
      maxOverlapRatio: 0.12,
      maxAccessPavedKm: 1.2,
      maxClosurePavedKm: 1.2,
      maxTargetPavedKm: 0.25,
    },
    ...overrides,
  });
}

describe('forest_loop component-first mission assembler', () => {
  it('selects the viable loopable component instead of mixing a nearer weak portal component', () => {
    const graph = makeGraph([
      makeEdge({ id: 'weak-loop-1', from: 'start', to: 'w1', lengthKm: 0.4, surface: 'ground', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'weak-loop-2', from: 'w1', to: 'w2', lengthKm: 0.4, surface: 'ground', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'weak-loop-3', from: 'w2', to: 'start', lengthKm: 0.4, surface: 'ground', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'access-to-deep-component', from: 'start', to: 'portal', lengthKm: 0.6, surface: 'asphalt', highway: 'service', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'portal-to-core', from: 'portal', to: 'core-a', lengthKm: 0.8, surface: 'ground', highway: 'track', componentKind: 'forest' }),
      makeEdge({ id: 'core-loop-1', from: 'core-a', to: 'core-b', lengthKm: 2.1, surface: 'dirt', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'core-loop-2', from: 'core-b', to: 'core-c', lengthKm: 2.1, surface: 'earth', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'core-loop-3', from: 'core-c', to: 'core-d', lengthKm: 2.1, surface: 'ground', highway: 'track', componentKind: 'forest' }),
      makeEdge({ id: 'core-loop-4', from: 'core-d', to: 'core-a', lengthKm: 2.1, surface: 'dirt', highway: 'track', componentKind: 'forest' }),
    ]);

    const result = assembleForestLoopMissionV3(graph, forestMission());

    expect(result.status).toBe('portfolio_ready');
    expect(result.selectedCandidate?.source).toBe('strategy_assembler');
    expect(result.selectedCandidate?.lane).toBe('complete_valid');
    expect(result.selectedCandidate?.edgeIds).toEqual(expect.arrayContaining(['portal-to-core', 'core-loop-1', 'core-loop-2', 'core-loop-3', 'core-loop-4']));
    expect(result.selectedCandidate?.edgeIds).not.toEqual(expect.arrayContaining(['weak-loop-1', 'weak-loop-2', 'weak-loop-3']));
    expect(result.phaseDiagnostics.access.componentId).toBe('terrain-component-2');
    expect(result.phaseDiagnostics.dwell.targetDwellKm).toBeGreaterThanOrEqual(8);
  });

  it('refuses when a component has distance but no two-core closure', () => {
    const graph = makeGraph([
      makeEdge({ id: 'forest-chain-1', from: 'start', to: 'a', lengthKm: 2, surface: 'ground', highway: 'track', componentKind: 'forest' }),
      makeEdge({ id: 'forest-chain-2', from: 'a', to: 'b', lengthKm: 2, surface: 'dirt', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'forest-chain-3', from: 'b', to: 'c', lengthKm: 2, surface: 'earth', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'forest-chain-4', from: 'c', to: 'd', lengthKm: 2, surface: 'ground', highway: 'track', componentKind: 'forest' }),
    ]);

    const result = assembleForestLoopMissionV3(graph, forestMission());

    expect(result.status).toBe('no_candidate');
    expect(result.selectedCandidate).toBeNull();
    expect(result.diagnostics.firstDropStage).toBe('closure');
    expect(result.diagnostics.blocker).toBe('no_two_core_clean_closure');
    expect(result.phaseDiagnostics.closure.status).toBe('failure');
  });

  it('keeps a component-first partial forest loop as adjusted evidence when RouteContract precheck is adjusted-plausible', () => {
    const graph = makeGraph([
      makeEdge({ id: 'adjusted-core-1', from: 'start', to: 'a', lengthKm: 1.25, surface: 'ground', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'adjusted-core-2', from: 'a', to: 'b', lengthKm: 1.25, surface: 'dirt', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'adjusted-core-3', from: 'b', to: 'c', lengthKm: 1.25, surface: 'earth', highway: 'track', componentKind: 'forest' }),
      makeEdge({ id: 'adjusted-core-4', from: 'c', to: 'start', lengthKm: 1.25, surface: 'ground', highway: 'track', componentKind: 'forest' }),
    ]);

    const result = assembleForestLoopMissionV3(graph, forestMission({
      request: {
        start: { lat: 49, lng: -0.4 },
        targetDistanceKm: 12,
        minDistanceKm: 4,
        maxDistanceKm: 15,
        sport: 'running',
        mode: 'trail',
        loop: true,
      },
      target: {
        componentIds: ['forest'],
        componentKinds: ['forest'],
        requiredEntry: 'mandatory',
        minNaturalDwellKm: 6.6,
        minContinuousTrailKm: 2,
      },
    }));

    expect(result.status).toBe('portfolio_ready');
    expect(result.selectedCandidate?.lane).toBe('complete_adjustable');
    expect(result.selectedCandidate?.metrics.distanceProducedKm).toBe(5);
    expect(result.selectedCandidate?.gates).toEqual(expect.arrayContaining([
      expect.objectContaining({ id: 'forest_loop_route_contract_adjusted', status: 'pass', severity: 'soft' }),
    ]));
    expect(result.warnings).toContain('forest_loop_route_contract_adjusted_plausible');
  });
});
