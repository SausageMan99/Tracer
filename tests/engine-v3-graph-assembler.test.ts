import { describe, expect, it } from 'vitest';
import type { EnrichedEdge, EnrichedGraph, GraphNode } from '@/lib/types';
import { assembleGraphRouteV3 } from '@/lib/engine-v3/graph-route-assembler';
import { decideOutcomeV3 } from '@/lib/engine-v3/outcome-decider';
import type { CorridorMissionV3, RouteIntentV3, TerrainComponentKindV3 } from '@/lib/engine-v3/types';

function node(id: string, index: number): GraphNode {
  return { id, lat: 49 + index * 0.001, lng: -0.6 - index * 0.001, edges: [] };
}

function edge(
  id: string,
  from: string,
  to: string,
  lengthKm: number,
  surface: string,
  highway: string,
  landcoverClass: 'forest' | 'urban' | null = surface === 'asphalt' ? 'urban' : 'forest',
): EnrichedEdge {
  return {
    id,
    from,
    to,
    lengthKm,
    surface,
    highway,
    scenic: landcoverClass === 'forest',
    osmWayId: Math.abs([...id].reduce((sum, char) => sum + char.charCodeAt(0), 0)),
    score: surface === 'asphalt' ? 0.2 : 0.9,
    terrainContext: landcoverClass
      ? {
          source: 'ign_poc_fixture',
          landcoverClass,
          naturalContextScore: landcoverClass === 'forest' ? 0.9 : 0.1,
          artificializationScore: landcoverClass === 'urban' ? 0.9 : 0.1,
          confidence: 'high',
          warnings: [],
        }
      : undefined,
  };
}

function graph(edges: EnrichedEdge[]): EnrichedGraph {
  const nodeIds = Array.from(new Set(edges.flatMap((candidate) => [candidate.from, candidate.to])));
  const nodes = new Map<string, GraphNode>(nodeIds.map((id, index) => [id, node(id, index)]));
  for (const candidate of edges) {
    nodes.get(candidate.from)?.edges.push(candidate.id);
    nodes.get(candidate.to)?.edges.push(candidate.id);
  }
  return {
    nodes,
    edges: new Map(edges.map((candidate) => [candidate.id, candidate])),
    center: { lat: 49, lng: -0.6 },
    radiusKm: 2,
  };
}

function intent(targetDistanceKm: number, targetComponents: TerrainComponentKindV3[] = ['forest']): RouteIntentV3 {
  return {
    engine: 'v3-clean-room',
    strategy: 'transition_to_woods',
    request: {
      start: { lat: 49, lng: -0.6 },
      targetDistanceKm,
      sport: 'running',
      mode: 'trail',
      loop: true,
    },
    snapshot: {
      audit: { confidence: 'high', edgeCount: 16, totalLengthKm: 18, pavedRatio: 0.15, nonPavedRatio: 0.85, warnings: [] },
      components: [
        {
          id: 'forest-main',
          kind: 'forest',
          distanceFromStartKm: 1,
          edgeCount: 8,
          totalLengthKm: 9,
          pavedRatio: 0,
          nonPavedRatio: 1,
          confidence: 'high',
        },
      ],
    },
    constraints: {
      targetDistanceKm,
      targetComponents,
      maxPavedRatio: 0.35,
      cleanReturn: 'strict',
      minNaturalDwellRatio: 0.45,
    },
    outcome: { type: 'generated', summary: 'candidate intent' },
    warnings: [],
  };
}

function mission(targetDistanceKm: number, targetComponents: TerrainComponentKindV3[] = ['forest']): CorridorMissionV3 {
  const anchorKind = targetComponents[0] ?? 'forest';
  return {
    engine: 'v3-clean-room',
    strategy: 'transition_to_woods',
    targetDistanceKm,
    targetComponents,
    anchor: {
      componentId: `${anchorKind}-main`,
      kind: anchorKind,
      distanceFromStartKm: 1,
      totalLengthKm: 9,
      naturalCapacityKm: 9,
      pavedRatio: 0,
      nonPavedRatio: 1,
    },
    budgetPavedKm: targetDistanceKm * 0.35,
    requestedNaturalDwellKm: targetDistanceKm * 0.45,
    cleanReturn: 'strict',
    returnMode: 'clean_loop',
    warnings: [],
  };
}

describe('assembleGraphRouteV3 graph assembler', () => {
  it('assembles a returned target-component candidate within 70%-115% with dwell and used-edge accounting', () => {
    const targetKm = 5.5;
    const assembled = assembleGraphRouteV3(
      intent(targetKm),
      mission(targetKm),
      graph([
        edge('access-out', 's', 'a', 1, 'asphalt', 'residential', 'urban'),
        edge('forest-1', 'a', 'b', 1, 'ground', 'path'),
        edge('forest-2', 'b', 'c', 1, 'ground', 'path'),
        edge('forest-3', 'c', 'd', 1, 'ground', 'path'),
        edge('forest-4', 'd', 'a', 1, 'ground', 'path'),
        edge('short-paved-decoy-1', 's', 'x', 0.8, 'asphalt', 'residential', 'urban'),
        edge('short-paved-decoy-2', 'x', 's', 0.8, 'asphalt', 'residential', 'urban'),
      ]),
    );

    expect(assembled.nodeIds[0]).toBe('s');
    expect(assembled.nodeIds.at(-1)).toBe('s');
    expect(assembled.metrics.distanceProducedKm).toBeGreaterThanOrEqual(targetKm * 0.7);
    expect(assembled.metrics.distanceProducedKm).toBeLessThanOrEqual(targetKm * 1.15);
    expect(assembled.metrics.visitedComponents).toContain('forest');
    expect(assembled.metrics.naturalDwellKm).toBeGreaterThanOrEqual(targetKm * 0.45);
    expect(assembled.metrics.repeatEdgeKm).toBeCloseTo(1, 3);
    expect(assembled.metrics.connectorRepeatKm).toBeCloseTo(1, 3);
    expect(assembled.metrics.targetRepeatKm).toBe(0);
    expect(assembled.metrics.repeatRatio).toBe(0);
    expect(assembled.edges.map((candidate) => candidate.id)).toEqual([
      'access-out',
      'forest-1',
      'forest-2',
      'forest-3',
      'forest-4',
      'access-out',
    ]);
  });

  it('keeps transition_to_woods inside the target until dwell is sufficient before closing', () => {
    const targetKm = 10;
    const route = assembleGraphRouteV3(
      intent(targetKm),
      mission(targetKm),
      graph([
        edge('access-out', 's', 'a', 1, 'asphalt', 'residential', 'urban'),
        edge('forest-1', 'a', 'b', 1, 'ground', 'path'),
        edge('forest-2', 'b', 'a', 1, 'ground', 'path'),
        edge('access-back', 'a', 's', 1, 'asphalt', 'residential', 'urban'),
      ]),
    );

    const outcome = decideOutcomeV3(intent(targetKm), route);

    expect(route.nodeIds[0]).toBe('s');
    expect(route.nodeIds.at(-1)).not.toBe('s');
    expect(route.metrics.naturalDwellKm).toBeLessThan(targetKm * 0.45);
    expect(outcome.type).toBe('refused');
  });

  it('refuses a route that otherwise passes metrics but has no usable GPS geometry', () => {
    const targetKm = 5.5;
    const route = assembleGraphRouteV3(
      intent(targetKm),
      mission(targetKm),
      graph([
        edge('access-out', 's', 'a', 1, 'asphalt', 'residential', 'urban'),
        edge('forest-1', 'a', 'b', 1, 'ground', 'path'),
        edge('forest-2', 'b', 'c', 1, 'ground', 'path'),
        edge('forest-3', 'c', 'd', 1, 'ground', 'path'),
        edge('forest-4', 'd', 'a', 1, 'ground', 'path'),
      ]),
    );

    const outcome = decideOutcomeV3(intent(targetKm), {
      ...route,
      geometry: { type: 'LineString', coordinates: [] },
    });

    expect(route.metrics.distanceProducedKm).toBeGreaterThanOrEqual(targetKm);
    expect(outcome.type).toBe('refused');
    expect(outcome).toMatchObject({ reason: expect.stringContaining('GPS geometry') });
  });

  it('keeps exploring a significant non-paved target path instead of selecting a tiny returned target loop', () => {
    const targetKm = 12;
    const route = assembleGraphRouteV3(
      intent(targetKm),
      mission(targetKm),
      graph([
        edge('tiny-target-out', 's', 'p1', 0.1, 'ground', 'path'),
        edge('tiny-target-back', 'p1', 's', 0.1, 'ground', 'path'),
        edge('access-to-forest', 's', 'a', 0.25, 'ground', 'path'),
        edge('forest-1', 'a', 'b', 1.1, 'ground', 'path'),
        edge('forest-2', 'b', 'c', 1.1, 'ground', 'track'),
        edge('forest-3', 'c', 'd', 1.1, 'gravel', 'path'),
        edge('forest-4', 'd', 'e', 1.1, 'ground', 'track'),
        edge('forest-5', 'e', 'f', 1.1, 'ground', 'path'),
      ]),
    );

    expect(route.edges.map((candidate) => candidate.id)).toContain('forest-5');
    expect(route.metrics.naturalDwellKm).toBeGreaterThanOrEqual(5);
    expect(route.metrics.distanceProducedKm).toBeGreaterThan(5);
  });

  it('reproduces Fontainebleau: does not lose a real dirt field-path corridor behind a nearer mixed footway spur', () => {
    const targetKm = 12;
    const mixedFootwaySpurs = Array.from({ length: 90 }, (_, index) => [
      edge(`fontainebleau-mixed-spur-${index + 1}-out`, 's', `m${index + 1}`, 0.012, '', 'footway', null),
      edge(`fontainebleau-mixed-spur-${index + 1}-back`, `m${index + 1}`, 's', 0.012, '', 'footway', null),
    ]).flat();
    const realDirtCorridor = Array.from({ length: 80 }, (_, index) =>
      edge(`fontainebleau-dirt-track-${index + 1}`, `n${index}`, `n${index + 1}`, 0.08, 'dirt', 'track', null),
    );

    const route = assembleGraphRouteV3(
      intent(targetKm, ['field_paths']),
      { ...mission(targetKm, ['field_paths']), returnMode: 'out_and_back_connector' },
      graph([
        ...mixedFootwaySpurs,
        edge('fontainebleau-paved-access', 's', 'n0', 0.168, 'asphalt', 'residential', 'urban'),
        ...realDirtCorridor,
      ]),
    );

    expect(route.edges.map((candidate) => candidate.id)).toContain('fontainebleau-dirt-track-80');
    expect(route.metrics.naturalDwellKm).toBeGreaterThanOrEqual(5.4);
    expect(route.metrics.distanceProducedKm).toBeGreaterThan(6);
  });


  it('reproduces Fontainebleau: ignores nearby natural micro-loops when a short paved access reaches a large natural target network', () => {
    const targetKm = 5;
    const nearbyNaturalMicroLoops = Array.from({ length: 66 }, (_, index) => [
      edge(`fontainebleau-near-micro-${index + 1}-out`, 'access', `near${index + 1}`, 0.045, 'ground', 'path', null),
      edge(`fontainebleau-near-micro-${index + 1}-back`, `near${index + 1}`, 'access', 0.045, 'ground', 'path', null),
    ]).flat();
    const reachableNaturalNetwork = Array.from({ length: 70 }, (_, index) =>
      edge(`fontainebleau-real-natural-${index + 1}`, `far${index}`, `far${index + 1}`, 0.055, 'dirt', index % 3 === 0 ? 'track' : 'path', null),
    );

    const route = assembleGraphRouteV3(
      intent(targetKm, ['field_paths']),
      { ...mission(targetKm, ['field_paths']), returnMode: 'out_and_back_connector' },
      graph([
        edge('fontainebleau-short-paved-access', 's', 'access', 0.18, 'asphalt', 'residential', 'urban'),
        ...nearbyNaturalMicroLoops,
        edge('fontainebleau-natural-gateway', 'access', 'far0', 0.04, 'ground', 'path', null),
        ...reachableNaturalNetwork,
      ]),
    );

    const edgeIds = route.edges.map((candidate) => candidate.id);
    expect(route.assemblyDiagnostics).toMatchObject({
      distanceToFirstNonPavedTargetKm: 0.18,
      reachableNonPavedTargetEdgeCount: 203,
    });
    expect(route.assemblyDiagnostics?.reachableNonPavedTargetKm).toBeGreaterThan(9.5);
    expect(edgeIds.filter((id) => id.includes('fontainebleau-near-micro')).length).toBeLessThan(8);
    expect(route.metrics.naturalDwellKm).toBeGreaterThanOrEqual(3);
    expect(route.metrics.distanceProducedKm).toBeGreaterThan(3.5);
  });

  it('locks Fontainebleau against the 0.842 km micro-route when a large non-paved target network is reachable nearby', () => {
    const targetKm = 12;
    const nearbyNaturalMicroLoops = Array.from({ length: 8 }, (_, index) => [
      edge(`fontainebleau-0842-micro-${index + 1}-out`, 'access', `micro${index + 1}`, 0.045, 'ground', 'path', null),
      edge(`fontainebleau-0842-micro-${index + 1}-back`, `micro${index + 1}`, 'access', 0.045, 'ground', 'path', null),
    ]).flat();
    const reachableNonPavedNetwork = Array.from({ length: 640 }, (_, index) =>
      edge(`fontainebleau-large-target-${index + 1}`, `large${index}`, `large${index + 1}`, 0.08, 'dirt', index % 4 === 0 ? 'track' : 'path', null),
    );

    const route = assembleGraphRouteV3(
      intent(targetKm, ['field_paths']),
      { ...mission(targetKm, ['field_paths']), returnMode: 'out_and_back_connector' },
      graph([
        edge('fontainebleau-short-paved-access', 's', 'access', 0.18, 'asphalt', 'residential', 'urban'),
        ...nearbyNaturalMicroLoops,
        edge('fontainebleau-large-network-gateway', 'access', 'large0', 0.01, 'ground', 'path', null),
        ...reachableNonPavedNetwork,
      ]),
    );

    expect(route.assemblyDiagnostics).toMatchObject({
      distanceToFirstNonPavedTargetKm: 0.18,
    });
    expect(route.assemblyDiagnostics?.reachableNonPavedTargetKm).toBeGreaterThan(50);
    expect(route.metrics.distanceProducedKm).toBeGreaterThanOrEqual(6);
  });


  it('reproduces Fontainebleau: seeds deeper high-capacity field corridor instead of a nearer local dead-end star', () => {
    const targetKm = 12;
    const localDeadEndStar = Array.from({ length: 140 }, (_, index) =>
      edge(`fontainebleau-local-star-${index + 1}`, 'local-hub', `local-leaf-${index + 1}`, 0.05, 'ground', 'path', null),
    );
    const deepNaturalCorridor = Array.from({ length: 95 }, (_, index) =>
      edge(`fontainebleau-deep-corridor-${index + 1}`, `deep${index}`, `deep${index + 1}`, 0.075, 'dirt', index % 4 === 0 ? 'track' : 'path', null),
    );

    const route = assembleGraphRouteV3(
      intent(targetKm, ['field_paths']),
      { ...mission(targetKm, ['field_paths']), returnMode: 'out_and_back_connector' },
      graph([
        edge('fontainebleau-nearest-local-entry', 's', 'local-hub', 0.06, 'ground', 'path', null),
        ...localDeadEndStar,
        edge('fontainebleau-paved-transition-to-deep-corridor', 's', 'deep0', 0.42, 'asphalt', 'residential', 'urban'),
        ...deepNaturalCorridor,
      ]),
    );

    const edgeIds = route.edges.map((candidate) => candidate.id);
    const frontierTrace = route.assemblyDiagnostics?.frontierTrace ?? [];

    expect(route.assemblyDiagnostics).toMatchObject({
      distanceToFirstNonPavedTargetKm: 0,
    });
    expect(route.assemblyDiagnostics?.reachableNonPavedTargetKm).toBeGreaterThan(14);
    expect(edgeIds).toContain('fontainebleau-deep-corridor-70');
    expect(edgeIds.filter((id) => id.includes('fontainebleau-local-star')).length).toBeLessThan(6);
    expect(route.metrics.naturalDwellKm).toBeGreaterThanOrEqual(5.4);
    expect(route.metrics.distanceProducedKm).toBeGreaterThan(6);
    expect(Math.max(0, ...frontierTrace.map((step) => step.maxNaturalDwellKm))).toBeGreaterThan(5.4);
  });

  it('does not repeat target-field edges when a clean connector can preserve natural access', () => {
    const targetKm = 6;
    const route = assembleGraphRouteV3(
      intent(targetKm, ['field_paths']),
      { ...mission(targetKm, ['field_paths']), returnMode: 'out_and_back_connector' },
      graph([
        edge('connector-out', 's', 'a', 0.25, 'asphalt', 'residential', 'urban'),
        edge('field-1', 'a', 'b', 1.2, 'ground', 'path', null),
        edge('field-2', 'b', 'c', 1.2, 'ground', 'track', null),
        edge('field-3', 'c', 'd', 1.2, 'ground', 'path', null),
        edge('field-clean-return', 'd', 'a', 1.2, 'ground', 'track', null),
        edge('connector-back', 'a', 's', 0.25, 'asphalt', 'residential', 'urban'),
      ]),
    );

    const targetEdgeTraversals = route.edges.filter((candidate) => candidate.componentKind === 'field_paths').map((candidate) => candidate.id);
    expect(new Set(targetEdgeTraversals).size).toBe(targetEdgeTraversals.length);
    expect(route.metrics.targetRepeatKm).toBe(0);
    expect(route.metrics.repeatRatio).toBeLessThanOrEqual(0.1);
    expect(route.metrics.naturalDwellKm).toBeGreaterThanOrEqual(targetKm * 0.45);
  });

  it('reports reachable non-paved target evidence from the start node without changing the outcome gates', () => {
    const targetKm = 8;
    const route = assembleGraphRouteV3(
      intent(targetKm),
      mission(targetKm),
      graph([
        edge('paved-connector', 's', 'a', 0.4, 'asphalt', 'residential', 'urban'),
        edge('natural-target-1', 'a', 'b', 1.2, 'ground', 'path', 'forest'),
        edge('natural-target-2', 'b', 'c', 0.8, 'gravel', 'track', 'forest'),
        edge('natural-decoy-disconnected', 'x', 'y', 3, 'ground', 'path', 'forest'),
      ]),
    );

    expect(route.assemblyDiagnostics).toMatchObject({
      startNodeId: 's',
      distanceToFirstNonPavedTargetKm: 0.4,
      reachableNonPavedTargetEdgeCount: 2,
      reachableNonPavedTargetKm: 2,
    });
    expect(route.assemblyDiagnostics?.frontierTrace?.[0]).toMatchObject({
      step: 0,
      frontierSize: expect.any(Number),
      maxDistanceKm: expect.any(Number),
      maxNaturalDwellKm: expect.any(Number),
      countEnteredTarget: expect.any(Number),
      countReturned: expect.any(Number),
      topCandidateIds: expect.any(Array),
    });
    expect(route.assemblyDiagnostics?.frontierTrace?.[0]).toHaveProperty('bestReturnedDistanceKm');
    expect(route.assemblyDiagnostics?.frontierTrace?.[0]).toHaveProperty('bestReturnedNaturalDwellKm');
    expect(route.assemblyDiagnostics?.frontierTrace?.some((step) => step.maxNaturalDwellKm >= 2)).toBe(true);
    expect(route.assemblyDiagnostics?.frontierTrace?.some((step) => step.topCandidateIds.length > 0)).toBe(true);
    expect(route.assemblyDiagnostics?.topFinalCandidates?.[0]).toMatchObject({
      selected: true,
      distanceKm: expect.any(Number),
      naturalDwellKm: expect.any(Number),
      pavedKm: expect.any(Number),
      repeatKm: expect.any(Number),
      targetRepeatKm: expect.any(Number),
      connectorRepeatKm: expect.any(Number),
      returned: expect.any(Boolean),
      scoreComplete: expect.any(Number),
      scoreProgress: expect.any(Number),
    });
    expect(route.assemblyDiagnostics?.topFinalCandidates?.length).toBeGreaterThan(0);
  });

  it('does not build a Fontainebleau target-zone comb from immediate out-and-back field-path teeth', () => {
    const targetKm = 6;
    const combTeeth = Array.from({ length: 16 }, (_, index) => [
      edge(`comb-tooth-${index + 1}-out`, `spine${index}`, `tooth${index + 1}`, 0.18, 'ground', 'path', null),
      edge(`comb-tooth-${index + 1}-back`, `tooth${index + 1}`, `spine${index}`, 0.18, 'ground', 'path', null),
      edge(`spine-${index + 1}`, `spine${index}`, `spine${index + 1}`, 0.22, 'ground', 'track', null),
    ]).flat();

    const route = assembleGraphRouteV3(
      intent(targetKm, ['field_paths']),
      { ...mission(targetKm, ['field_paths']), returnMode: 'out_and_back_connector' },
      graph([
        edge('connector-out', 's', 'spine0', 0.35, 'asphalt', 'residential', 'urban'),
        ...combTeeth,
        edge('target-clean-return', 'spine16', 'spine0', 2.2, 'ground', 'track', null),
        edge('connector-back', 'spine0', 's', 0.35, 'asphalt', 'residential', 'urban'),
      ]),
    );

    const targetPairCounts = new Map<string, number>();
    for (const candidate of route.edges.filter((edgeItem) => edgeItem.componentKind === 'field_paths')) {
      const pairKey = [candidate.from, candidate.to].sort().join('::');
      targetPairCounts.set(pairKey, (targetPairCounts.get(pairKey) ?? 0) + 1);
    }

    expect(route.metrics.distanceProducedKm).toBeGreaterThanOrEqual(targetKm * 0.7);
    expect(route.metrics.naturalDwellKm).toBeGreaterThanOrEqual(targetKm * 0.45);
    expect([...targetPairCounts.values()].filter((count) => count > 1)).toEqual([]);
    expect(route.edges.map((candidate) => candidate.id).filter((id) => id.includes('comb-tooth'))).toEqual([]);
    expect(route.metrics.targetRepeatKm).toBe(0);
    expect(route.assemblyDiagnostics?.topFinalCandidates?.[0]).toMatchObject({
      selected: true,
      targetRepeatKm: 0,
      connectorRepeatKm: expect.any(Number),
    });
  });

  it('never uses a new target edge to traverse a target pair already used earlier for distance recovery', () => {
    const targetKm = 5.5;
    const route = assembleGraphRouteV3(
      intent(targetKm, ['field_paths']),
      { ...mission(targetKm, ['field_paths']), returnMode: 'out_and_back_connector' },
      graph([
        edge('connector-out', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
        edge('target-ab-first', 'a', 'b', 1, 'ground', 'path', null),
        edge('target-bc', 'b', 'c', 1, 'ground', 'path', null),
        edge('target-ca', 'c', 'a', 1, 'ground', 'track', null),
        edge('target-ab-repeat-different-osm-edge', 'a', 'b', 1, 'ground', 'track', null),
        edge('connector-back-from-b', 'b', 's', 0.2, 'asphalt', 'residential', 'urban'),
      ]),
    );

    const targetPairCounts = new Map<string, number>();
    for (const candidate of route.edges.filter((edgeItem) => edgeItem.componentKind === 'field_paths')) {
      const pairKey = [candidate.from, candidate.to].sort().join('::');
      targetPairCounts.set(pairKey, (targetPairCounts.get(pairKey) ?? 0) + 1);
    }

    expect(route.edges.map((candidate) => candidate.id)).not.toContain('target-ab-repeat-different-osm-edge');
    expect([...targetPairCounts.values()].filter((count) => count > 1)).toEqual([]);
    expect(route.metrics.targetRepeatKm).toBe(0);
  });

  it('recovers distance through lateral target alternatives instead of reverse-traversing target pairs', () => {
    const targetKm = 5.5;
    const route = assembleGraphRouteV3(
      intent(targetKm, ['field_paths']),
      { ...mission(targetKm, ['field_paths']), returnMode: 'out_and_back_connector' },
      graph([
        edge('connector-out', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
        edge('target-entry', 'a', 'b', 1, 'ground', 'path', null),
        edge('target-forward', 'b', 'c', 1, 'ground', 'path', null),
        edge('target-reverse-forbidden', 'c', 'b', 1, 'ground', 'path', null),
        edge('target-lateral-1', 'c', 'd', 1, 'ground', 'track', null),
        edge('target-lateral-2', 'd', 'e', 1, 'ground', 'track', null),
        edge('target-lateral-return', 'e', 'a', 1, 'ground', 'path', null),
        edge('connector-back', 'a', 's', 0.2, 'asphalt', 'residential', 'urban'),
      ]),
    );

    const targetPairCounts = new Map<string, number>();
    for (const candidate of route.edges.filter((edgeItem) => edgeItem.componentKind === 'field_paths')) {
      const pairKey = [candidate.from, candidate.to].sort().join('::');
      targetPairCounts.set(pairKey, (targetPairCounts.get(pairKey) ?? 0) + 1);
    }

    expect(route.edges.map((candidate) => candidate.id)).not.toContain('target-reverse-forbidden');
    expect(route.edges.map((candidate) => candidate.id)).toEqual([
      'connector-out',
      'target-entry',
      'target-forward',
      'target-lateral-1',
      'target-lateral-2',
      'target-lateral-return',
      'connector-back',
    ]);
    expect([...targetPairCounts.values()].filter((count) => count > 1)).toEqual([]);
    expect(route.metrics.targetRepeatKm).toBe(0);
    expect(route.metrics.distanceProducedKm).toBeGreaterThanOrEqual(targetKm * 0.7);
    expect(route.metrics.naturalDwellKm).toBeGreaterThanOrEqual(targetKm * 0.45);
  });

  it('does not truncate reachable natural progress only because OSM split the path into many tiny edges', () => {
    const targetKm = 8;
    const tinyNaturalChain = Array.from({ length: 180 }, (_, index) =>
      edge(`tiny-natural-${index + 1}`, `n${index}`, `n${index + 1}`, 0.035, 'ground', 'path', 'forest'),
    );

    const route = assembleGraphRouteV3(
      intent(targetKm),
      { ...mission(targetKm), returnMode: 'out_and_back_connector' },
      graph([
        edge('access-to-chain', 's', 'n0', 0.2, 'asphalt', 'residential', 'urban'),
        ...tinyNaturalChain,
      ]),
    );

    expect(route.metrics.naturalDwellKm).toBeGreaterThanOrEqual(5.4);
    expect(route.metrics.distanceProducedKm).toBeGreaterThan(6);
  });
});
