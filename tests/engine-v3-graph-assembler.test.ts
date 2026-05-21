import { describe, expect, it } from 'vitest';
import type { EnrichedEdge, EnrichedGraph, GraphNode } from '@/lib/types';
import { assembleGraphRouteV3 } from '@/lib/engine-v3/graph-route-assembler';
import { generateRouteV3FromGraph } from '@/lib/engine-v3/route-generator';
import {
  isAdjustedMixedUnknownWithinEvidenceBudgetV3,
  isAdjustedTargetRepeatWithinEvidenceBudgetV3,
} from '@/lib/engine-v3/assemblers/graph-route-assembly-core';
import { decideOutcomeV3 } from '@/lib/engine-v3/outcome-decider';
import { buildMissionContractV3 } from '@/lib/engine-v3/mission-contract-builder';
import { assembleMissionV3 } from '@/lib/engine-v3/assemblers/mission-dispatcher';
import { assembleTransitionToWoodsMissionV3 } from '@/lib/engine-v3/assemblers/transition-to-woods-assembler';
import { assembleParkLoopMissionV3 } from '@/lib/engine-v3/assemblers/park-loop-assembler';
import { assembleUrbanNatureLoopMissionV3 } from '@/lib/engine-v3/assemblers/urban-nature-loop-assembler';
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
  landcoverClass: 'forest' | 'park' | 'water_corridor' | 'urban' | null = surface === 'asphalt' ? 'urban' : 'forest',
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
  it('keeps near-budget target repeat selectable as adjusted evidence when it stays inside the mission-derived repeat budget', () => {
    expect(isAdjustedTargetRepeatWithinEvidenceBudgetV3({
      repeatedKm: 0.509,
      distanceKm: 12.434,
      targetDistanceKm: 12,
    })).toBe(true);
  });

  it('keeps Fontainebleau-like mixed path evidence selectable as adjusted, not generated, when strict trail evidence is present', () => {
    expect(isAdjustedMixedUnknownWithinEvidenceBudgetV3({
      mixedUnknownKm: 7.101,
      strictTrailKm: 3.752,
      targetDistanceKm: 12,
    })).toBe(true);
  });

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

    expect(route.nodeIds).toEqual([]);
    expect(route.metrics.naturalDwellKm).toBe(0);
    expect(route.warnings).toContain('graph assembly found no product-valid route candidate');
    expect(outcome.type).toBe('refused');
  });

  it('uses urban-nature wording when an urban strategy has no assembled route evidence', () => {
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
    const urbanIntent: RouteIntentV3 = {
      ...intent(targetKm, []),
      strategy: 'urban_nature_loop',
      request: { ...intent(targetKm, []).request!, mode: 'nature_urbaine' },
      constraints: { ...intent(targetKm, []).constraints, targetComponents: [], maxPavedRatio: 0.85, minNaturalDwellRatio: 0.1 },
    };

    const outcome = decideOutcomeV3(urbanIntent, route);

    expect(outcome.type).toBe('refused');
    if (outcome.type !== 'refused') throw new Error('expected refused urban nature outcome');
    expect(outcome.reason).toContain('urban-nature');
    expect(outcome.reason).not.toContain('trail promise');
    expect(outcome.details?.join(' ')).not.toContain('misses target field_paths');
  });

  it('assembles an urban-nature park/canal compromise with geometry and honest paved metrics', () => {
    const targetKm = 6;
    const generated = generateRouteV3FromGraph(
      {
        start: { lat: 49, lng: -0.6 },
        targetDistanceKm: targetKm,
        sport: 'running',
        mode: 'nature_urbaine',
        loop: true,
      },
      graph([
        { ...edge('urban-canal-paved-1', 's', 'a', 1, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('urban-canal-paved-2', 'a', 'b', 1, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('urban-park-soft-1', 'b', 'c', 1, 'grass', 'path', 'urban'), scenic: true },
        { ...edge('urban-canal-paved-3', 'c', 'd', 1, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('urban-canal-paved-4', 'd', 'e', 1, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('urban-canal-return', 'e', 's', 1, 'asphalt', 'footway', 'urban'), scenic: true },
      ]),
    );

    expect(generated.intent.strategy).toBe('urban_nature_loop');
    expect(generated.route.nodeIds[0]).toBe('s');
    expect(generated.route.nodeIds.at(-1)).toBe('s');
    expect(generated.route.geometry.coordinates.length).toBeGreaterThanOrEqual(2);
    expect(generated.route.metrics.distanceProducedKm).toBeGreaterThanOrEqual(targetKm * 0.85);
    expect(generated.route.metrics.pavedRatio).toBeGreaterThan(0.75);
    expect(generated.route.metrics.naturalWayRatio).toBeLessThan(0.25);
    expect(generated.route.assemblyDiagnostics?.selectedReason).toContain('mission-driven');
    expect(generated.route.warnings.join(' ')).toContain('urban');
    expect(generated.route.warnings.join(' ')).toContain('paved');
    expect(generated.outcome.type).toBe('adjusted');
    if (generated.outcome.type !== 'adjusted') throw new Error('expected adjusted urban nature compromise');
    expect(generated.outcome.compromises.join(' ')).toContain('paved urban');
  });

  it('prioritizes a reachable soft urban-nature corridor over a longer paved loop at the start', () => {
    const targetKm = 6;
    const generated = generateRouteV3FromGraph(
      {
        start: { lat: 49, lng: -0.6 },
        targetDistanceKm: targetKm,
        sport: 'running',
        mode: 'nature_urbaine',
        loop: true,
      },
      graph([
        { ...edge('paved-decoy-1', 's', 'a', 1.3, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('paved-decoy-2', 'a', 'b', 1.3, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('paved-decoy-3', 'b', 'c', 1.3, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('paved-decoy-return', 'c', 's', 1.3, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('soft-corridor-access', 's', 'n1', 0.1, 'asphalt', 'footway', 'urban'), scenic: true },
        edge('soft-corridor-1', 'n1', 'n2', 1.2, 'grass', 'path', 'park'),
        edge('soft-corridor-2', 'n2', 'n3', 1.2, 'ground', 'path', 'park'),
        edge('soft-corridor-3', 'n3', 'n4', 1.2, 'grass', 'path', 'park'),
        edge('soft-corridor-4', 'n4', 'n5', 1.2, 'ground', 'path', 'park'),
        { ...edge('soft-corridor-return', 'n5', 's', 0.3, 'asphalt', 'footway', 'urban'), scenic: true },
      ]),
    );

    expect(['park_loop', 'urban_nature_loop']).toContain(generated.intent.strategy);
    expect(generated.route.edges.map((candidate) => candidate.id)).toEqual([
      'soft-corridor-access',
      'soft-corridor-1',
      'soft-corridor-2',
      'soft-corridor-3',
      'soft-corridor-4',
      'soft-corridor-return',
    ]);
    expect(generated.route.metrics.distanceProducedKm).toBeGreaterThanOrEqual(targetKm * 0.85);
    expect(generated.route.metrics.naturalDwellKm).toBeGreaterThanOrEqual(4.8);
    expect(generated.route.metrics.naturalWayRatio).toBeGreaterThan(0.9);
    expect(generated.route.metrics.pavedRatio).toBeLessThan(0.1);
  });

  it('keeps mixed urban-park paths as unverified corridor evidence while preserving paved accounting', () => {
    const targetKm = 6;
    const generated = generateRouteV3FromGraph(
      {
        start: { lat: 49, lng: -0.6 },
        targetDistanceKm: targetKm,
        sport: 'running',
        mode: 'nature_urbaine',
        loop: true,
      },
      graph([
        { ...edge('park-paved-access', 's', 'a', 0.4, 'asphalt', 'footway', 'urban'), scenic: true },
        edge('park-mixed-path-1', 'a', 'b', 1.2, '', 'path', 'park'),
        edge('park-mixed-path-2', 'b', 'c', 1.2, '', 'path', 'park'),
        edge('park-mixed-path-3', 'c', 'd', 1.2, '', 'footway', 'park'),
        edge('park-mixed-path-4', 'd', 'e', 1.2, '', 'path', 'park'),
        { ...edge('park-paved-return', 'e', 's', 0.4, 'asphalt', 'footway', 'urban'), scenic: true },
      ]),
    );

    expect(generated.route.metrics.distanceProducedKm).toBeGreaterThanOrEqual(targetKm * 0.85);
    expect(generated.route.metrics.pathTrackUnknownKm).toBeGreaterThanOrEqual(4.8);
    expect(generated.route.metrics.candidateNaturalKm).toBeGreaterThan(4);
    expect(generated.route.metrics.unverifiedTrailCandidateKm).toBeGreaterThanOrEqual(4.8);
    expect(generated.route.metrics.naturalDwellKm).toBeGreaterThan(4);
    expect(generated.route.metrics.naturalWayRatio).toBeGreaterThan(0.4);
    expect(generated.route.metrics.pavedKm).toBeLessThanOrEqual(3.2);
  });

  it('prefers mixed park opportunity over an equally long paved park loop for urban nature candidates', () => {
    const parkIntent: RouteIntentV3 = {
      ...intent(5, ['park']),
      strategy: 'park_loop',
      request: { ...intent(5, ['park']).request!, mode: 'nature_urbaine' },
      constraints: { ...intent(5, ['park']).constraints, targetComponents: ['park'], maxPavedRatio: 0.7, minNaturalDwellRatio: 0.25 },
    };
    const contract = buildMissionContractV3(parkIntent);
    if (!contract) throw new Error('expected park mission contract');

    const result = assembleParkLoopMissionV3(
      graph([
        edge('paved-park-loop-1', 'a', 'b', 1.3, 'asphalt', 'footway', 'park'),
        edge('paved-park-loop-2', 'b', 'c', 1.3, 'asphalt', 'footway', 'park'),
        edge('paved-park-loop-3', 'c', 'd', 1.3, 'asphalt', 'footway', 'park'),
        edge('paved-park-loop-4', 'd', 'a', 1.2, 'asphalt', 'footway', 'park'),
        edge('mixed-park-loop-1', 'a', 'x', 1.3, '', 'path', 'park'),
        edge('mixed-park-loop-2', 'x', 'y', 1.3, '', 'path', 'park'),
        edge('mixed-park-loop-3', 'y', 'z', 1.3, '', 'footway', 'park'),
        edge('mixed-park-loop-4', 'z', 'a', 1.2, '', 'path', 'park'),
      ]),
      contract,
    );

    expect(result.selectedCandidate?.metrics.pathTrackUnknownKm).toBeGreaterThanOrEqual(5);
    expect(result.selectedCandidate?.metrics.candidateNaturalKm).toBeGreaterThan(4);
    expect(result.selectedCandidate?.metrics.pavedKm).toBe(0);
  });

  it('reports mixed park-loop candidate metrics as corridor opportunity evidence before route adaptation', () => {
    const parkIntent: RouteIntentV3 = {
      ...intent(5, ['park']),
      strategy: 'park_loop',
      request: { ...intent(5, ['park']).request!, mode: 'nature_urbaine' },
      constraints: { ...intent(5, ['park']).constraints, targetComponents: ['park'], maxPavedRatio: 0.7, minNaturalDwellRatio: 0.25 },
    };
    const contract = buildMissionContractV3(parkIntent);
    if (!contract) throw new Error('expected park mission contract');

    const result = assembleParkLoopMissionV3(
      graph([
        edge('park-mixed-path-1', 'a', 'b', 1.2, '', 'path', 'park'),
        edge('park-mixed-path-2', 'b', 'c', 1.2, '', 'path', 'park'),
        edge('park-mixed-path-3', 'c', 'd', 1.2, '', 'footway', 'park'),
        edge('park-mixed-path-4', 'd', 'e', 1.2, '', 'path', 'park'),
      ]),
      contract,
    );

    expect(result.selectedCandidate?.metrics.pathTrackUnknownKm).toBeGreaterThanOrEqual(4.8);
    expect(result.selectedCandidate?.metrics.candidateNaturalKm).toBeGreaterThan(4);
    expect(result.selectedCandidate?.metrics.unverifiedTrailCandidateKm).toBeGreaterThanOrEqual(4.8);
    expect(result.selectedCandidate?.metrics.explicitNaturalKm).toBe(0);
    expect(result.selectedCandidate?.metrics.pavedKm).toBe(0);
    expect(result.diagnostics.observationOnly).toMatchObject({
      selectedOpportunity: {
        pathTrackUnknownKm: expect.any(Number),
        candidateNaturalKm: expect.any(Number),
      },
      availableOpportunity: {
        pathTrackUnknownKm: expect.any(Number),
        candidateNaturalKm: expect.any(Number),
      },
      nearestNonPavedAllowedEdges: expect.arrayContaining([
        expect.objectContaining({ edgeId: 'park-mixed-path-1', surfaceEvidence: 'path_track_unknown' }),
      ]),
    });
  });

  it('groups urban-nature candidate components and explains why visible input opportunity is excluded from the park lane', () => {
    const urbanIntent: RouteIntentV3 = {
      ...intent(6, []),
      strategy: 'urban_nature_loop',
      request: { ...intent(6, []).request!, mode: 'nature_urbaine' },
      constraints: { ...intent(6, []).constraints, targetComponents: [], maxPavedRatio: 0.9, minNaturalDwellRatio: 0.1 },
    };
    const contract = buildMissionContractV3(urbanIntent);
    if (!contract) throw new Error('expected urban-nature mission contract');

    const result = assembleUrbanNatureLoopMissionV3(
      graph([
        { ...edge('paved-safe-1', 's', 'a', 1.4, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('paved-safe-2', 'a', 'b', 1.4, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('paved-safe-3', 'b', 'c', 1.4, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('paved-safe-return', 'c', 's', 1.4, 'asphalt', 'footway', 'urban'), scenic: true },
        edge('visible-forest-path-1', 'a', 'x', 0.8, 'ground', 'path', 'forest'),
        edge('visible-forest-path-2', 'x', 'y', 0.8, 'ground', 'path', 'forest'),
        edge('visible-forest-path-3', 'y', 'a', 0.8, 'ground', 'path', 'forest'),
      ]),
      contract,
    );

    const diagnostics = result.diagnostics.observationOnly.urbanNatureOpportunityComponents as Array<Record<string, unknown>>;
    expect(diagnostics).toEqual(expect.arrayContaining([
      expect.objectContaining({
        capacityKm: 2.4,
        candidateNaturalKm: 2.4,
        routeableCandidateKm: 0,
        reachable: true,
        closurePossible: true,
        exclusionReason: 'excluded_from_routeableUrbanParkEdges_component_kind_or_contract',
        componentKinds: expect.objectContaining({ forest: 2.4 }),
        surfaceEvidenceKm: expect.objectContaining({ explicit_natural: 2.4 }),
      }),
    ]));
  });

  it('builds an urban-nature component-first candidate instead of staying on a paved-safe decoy loop', () => {
    const urbanIntent: RouteIntentV3 = {
      ...intent(6, []),
      strategy: 'urban_nature_loop',
      request: { ...intent(6, []).request!, mode: 'nature_urbaine' },
      constraints: { ...intent(6, []).constraints, targetComponents: [], maxPavedRatio: 0.9, minNaturalDwellRatio: 0.1 },
    };
    const contract = buildMissionContractV3(urbanIntent);
    if (!contract) throw new Error('expected urban-nature mission contract');

    const result = assembleUrbanNatureLoopMissionV3(
      graph([
        { ...edge('paved-safe-1', 's', 'a', 1.4, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('paved-safe-2', 'a', 'b', 1.4, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('paved-safe-3', 'b', 'c', 1.4, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('paved-safe-return', 'c', 's', 1.4, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('urban-nature-access', 's', 'n1', 0.2, 'asphalt', 'footway', 'urban'), scenic: true },
        edge('urban-nature-soft-1', 'n1', 'n2', 1.1, 'grass', 'path', 'park'),
        edge('urban-nature-soft-2', 'n2', 'n3', 1.1, 'ground', 'path', 'park'),
        edge('urban-nature-soft-3', 'n3', 'n1', 1.1, 'grass', 'path', 'park'),
        { ...edge('urban-nature-return', 'n1', 's', 0.2, 'asphalt', 'footway', 'urban'), scenic: true },
      ]),
      contract,
    );

    expect(result.selectedCandidate?.edgeIds).toEqual(expect.arrayContaining([
      'urban-nature-soft-1',
      'urban-nature-soft-2',
      'urban-nature-soft-3',
    ]));
    expect(result.selectedCandidate?.metrics.naturalDwellKm).toBeGreaterThanOrEqual(3.3);
    expect(result.selectedCandidate?.metrics.pavedRatio).toBeLessThan(0.2);
    const diagnostics = result.diagnostics.observationOnly.urbanNatureOpportunityComponents as Array<Record<string, unknown>>;
    expect(diagnostics[0]).toEqual(expect.objectContaining({
      selectedCandidateKm: 3.3,
      exclusionReason: 'selected_by_component_first_lane',
    }));
  });

  it('keeps urban-nature park edge traversal orientation in candidate nodeIds', () => {
    const urbanIntent: RouteIntentV3 = {
      ...intent(5, []),
      strategy: 'urban_nature_loop',
      request: { ...intent(5, []).request!, mode: 'nature_urbaine' },
      constraints: { ...intent(5, []).constraints, targetComponents: [], maxPavedRatio: 0.9, minNaturalDwellRatio: 0.1 },
    };
    const contract = buildMissionContractV3(urbanIntent);
    if (!contract) throw new Error('expected urban-nature mission contract');

    const result = assembleUrbanNatureLoopMissionV3(
      graph([
        edge('urban-park-forward', 'a', 'b', 1.9, 'grass', 'path', 'park'),
        edge('urban-park-reverse', 'c', 'b', 1.8, 'grass', 'path', 'park'),
        edge('urban-park-return', 'c', 'a', 1.7, 'grass', 'path', 'park'),
      ]),
      contract,
    );

    expect(result.selectedCandidate?.edgeIds).toEqual([
      'urban-park-forward',
      'urban-park-reverse',
      'urban-park-return',
    ]);
    expect(result.selectedCandidate?.nodeIds).toEqual(['a', 'b', 'c', 'a']);
    expect(result.selectedCandidate?.geometry.coordinates).toHaveLength(4);
  });

  it('keeps component-capacity urban-nature fallback geometry continuous instead of concatenating raw edge order', () => {
    const urbanIntent: RouteIntentV3 = {
      ...intent(7, []),
      strategy: 'urban_nature_loop',
      request: { ...intent(7, []).request!, mode: 'nature_urbaine' },
      constraints: { ...intent(7, []).constraints, targetComponents: [], maxPavedRatio: 0.9, minNaturalDwellRatio: 0.35 },
    };
    const contract = buildMissionContractV3(urbanIntent);
    if (!contract) throw new Error('expected urban-nature mission contract');

    const testGraph = graph([
      { ...edge('paved-safe-1', 's', 'p1', 1.4, 'asphalt', 'footway', 'urban'), scenic: true },
      { ...edge('paved-safe-2', 'p1', 'p2', 1.4, 'asphalt', 'footway', 'urban'), scenic: true },
      { ...edge('paved-safe-3', 'p2', 'p3', 1.4, 'asphalt', 'footway', 'urban'), scenic: true },
      { ...edge('paved-safe-return', 'p3', 's', 1.4, 'asphalt', 'footway', 'urban'), scenic: true },
      { ...edge('urban-nature-access', 's', 'a', 0.1, 'asphalt', 'footway', 'urban'), scenic: true },
      edge('soft-ab', 'a', 'b', 1, 'grass', 'path', 'park'),
      edge('soft-ba', 'b', 'a', 1, 'grass', 'path', 'park'),
      edge('soft-bc', 'b', 'c', 1, 'grass', 'path', 'park'),
      edge('soft-cb', 'c', 'b', 1, 'grass', 'path', 'park'),
    ]);
    const result = assembleUrbanNatureLoopMissionV3(
      testGraph,
      contract,
    );

    const nodeIds = result.selectedCandidate?.nodeIds ?? [];
    expect(result.selectedCandidate?.source).toBe('urban_corridor');
    expect(nodeIds.length).toBeGreaterThan(3);
    for (let index = 0; index < nodeIds.length - 1; index += 1) {
      const from = nodeIds[index];
      const to = nodeIds[index + 1];
      const edgeId = result.selectedCandidate?.edgeIds[index];
      const rawEdge = edgeId ? testGraph.edges.get(edgeId) : undefined;
      expect(rawEdge, `missing edge ${edgeId}`).toBeDefined();
      expect(rawEdge, `edge ${edgeId} must connect ${from}->${to}`).toSatisfy((candidate: EnrichedEdge) =>
        (candidate.from === from && candidate.to === to) || (candidate.from === to && candidate.to === from),
      );
    }
  });

  it('dispatches urban_nature_loop through an explicit targetOpportunity contract instead of a generic park candidate', () => {
    const urbanIntent: RouteIntentV3 = {
      ...intent(6, []),
      strategy: 'urban_nature_loop',
      request: { ...intent(6, []).request!, mode: 'nature_urbaine' },
      constraints: { ...intent(6, []).constraints, targetComponents: [], maxPavedRatio: 0.9, minNaturalDwellRatio: 0.1 },
    };
    const contract = buildMissionContractV3(urbanIntent);
    if (!contract) throw new Error('expected urban-nature mission contract');

    const result = assembleMissionV3(
      graph([
        { ...edge('paved-safe-1', 's', 'a', 1.4, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('paved-safe-2', 'a', 'b', 1.4, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('paved-safe-3', 'b', 'c', 1.4, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('paved-safe-return', 'c', 's', 1.4, 'asphalt', 'footway', 'urban'), scenic: true },
        { ...edge('urban-nature-access', 's', 'n1', 0.2, 'asphalt', 'footway', 'urban'), scenic: true },
        edge('urban-nature-soft-1', 'n1', 'n2', 1.1, 'grass', 'path', 'park'),
        edge('urban-nature-soft-2', 'n2', 'n3', 1.1, 'ground', 'path', 'park'),
        edge('urban-nature-soft-3', 'n3', 'n1', 1.1, 'grass', 'path', 'park'),
        { ...edge('urban-nature-return', 'n1', 's', 0.2, 'asphalt', 'footway', 'urban'), scenic: true },
      ]),
      contract,
    );

    expect(result.selectedCandidate?.source).toBe('urban_corridor');
    expect(result.selectedCandidate?.selectedReason).toBe('urban_nature_target_opportunity_selected');
    expect(result.diagnostics.observationOnly).toMatchObject({
      targetOpportunity: {
        id: 'urban-nature-opportunity-1',
        selected: true,
        reachable: true,
        closurePossible: true,
        candidateNaturalKm: 3.3,
        pathTrackUnknownKm: 0,
        explicitPavedKm: 0,
        connectorKm: expect.any(Number),
        rejectedReason: null,
      },
    });
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

    expect(route.edges).toEqual([]);
    expect(route.warnings).toContain('graph assembly found no product-valid route candidate');
    expect(Math.max(0, ...(route.assemblyDiagnostics?.frontierTrace ?? []).map((step) => step.maxNaturalDwellKm))).toBeGreaterThanOrEqual(5);
    expect(Math.max(0, ...(route.assemblyDiagnostics?.frontierTrace ?? []).map((step) => step.maxDistanceKm))).toBeGreaterThan(5);
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

    expect(route.edges).toEqual([]);
    expect(route.warnings).toContain('graph assembly found no product-valid route candidate');
    expect(Math.max(0, ...(route.assemblyDiagnostics?.frontierTrace ?? []).map((step) => step.maxNaturalDwellKm))).toBeGreaterThanOrEqual(5.4);
    expect(Math.max(0, ...(route.assemblyDiagnostics?.frontierTrace ?? []).map((step) => step.maxDistanceKm))).toBeGreaterThan(6);
  }, 420000);


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
    expect(edgeIds).toEqual([]);
    expect(route.warnings).toContain('graph assembly found no product-valid route candidate');
    expect(Math.max(0, ...(route.assemblyDiagnostics?.frontierTrace ?? []).map((step) => step.maxNaturalDwellKm))).toBeGreaterThanOrEqual(3);
    expect(Math.max(0, ...(route.assemblyDiagnostics?.frontierTrace ?? []).map((step) => step.maxDistanceKm))).toBeGreaterThan(3.5);
  }, 240000);

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
    expect(route.edges).toEqual([]);
    expect(route.warnings).toContain('graph assembly found no product-valid route candidate');
    expect(Math.max(0, ...(route.assemblyDiagnostics?.frontierTrace ?? []).map((step) => step.maxDistanceKm))).toBeGreaterThanOrEqual(6);
  }, 20000);


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
    expect(edgeIds).toEqual([]);
    expect(route.warnings).toContain('graph assembly found no product-valid route candidate');
    expect(Math.max(0, ...frontierTrace.map((step) => step.maxNaturalDwellKm))).toBeGreaterThan(5.4);
  });

  it('selects a deeper exploitable target component when a nearer pocket has only branchy raw capacity', () => {
    const targetKm = 6;
    const nearBranchPocket = Array.from({ length: 80 }, (_, index) =>
      edge(`near-pocket-tooth-${index + 1}`, 'near-pocket', `near-leaf-${index + 1}`, 0.04, 'ground', 'path', null),
    );
    const deepLoop = [
      edge('deep-loop-1', 'deep0', 'deep1', 1.1, 'dirt', 'track', null),
      edge('deep-loop-2', 'deep1', 'deep2', 1.1, 'dirt', 'path', null),
      edge('deep-loop-3', 'deep2', 'deep3', 1.1, 'dirt', 'track', null),
      edge('deep-loop-4', 'deep3', 'deep0', 1.1, 'dirt', 'path', null),
    ];

    const route = assembleGraphRouteV3(
      intent(targetKm, ['field_paths']),
      { ...mission(targetKm, ['field_paths']), returnMode: 'out_and_back_connector' },
      graph([
        edge('near-access', 's', 'near-pocket', 0.05, 'asphalt', 'residential', 'urban'),
        ...nearBranchPocket,
        edge('deep-access-out', 's', 'deep0', 0.9, 'asphalt', 'residential', 'urban'),
        ...deepLoop,
        edge('deep-access-back', 'deep0', 's', 0.9, 'asphalt', 'residential', 'urban'),
      ]),
    );

    const diagnostics = route.assemblyDiagnostics;
    const handoff = diagnostics?.targetComponentHandoff;
    expect(diagnostics).toMatchObject({
      enteredTargetComponent: true,
      selectedTargetCandidate: expect.stringContaining('deep0'),
      failureStage: null,
      closureBlockedUntilDwell: false,
    });
    expect(diagnostics?.targetComponentDwellKm).toBeGreaterThanOrEqual(targetKm * 0.45);
    expect(diagnostics?.targetCapacityKm).toBeGreaterThanOrEqual(targetKm * 0.45);
    expect(handoff?.componentCandidateCount).toBeGreaterThanOrEqual(2);
    expect(handoff?.componentCandidates.some((candidate) => candidate.entryNodeId === 'near-pocket')).toBe(true);
    expect(handoff?.componentCandidates.some((candidate) => candidate.entryNodeId === 'deep0')).toBe(true);
    expect(handoff?.componentCandidates.find((candidate) => candidate.entryNodeId === 'near-pocket')?.traversalResult.blocker).toBe('branch_repeat_limited');
    expect(handoff?.componentCandidates.find((candidate) => candidate.entryNodeId === 'deep0')?.traversalResult.status).toBe('success');
    expect(route.metrics.distanceProducedKm).toBeGreaterThanOrEqual(targetKm * 0.7);
    expect(route.metrics.naturalDwellKm).toBeGreaterThanOrEqual(targetKm * 0.45);
    expect(route.edges.map((candidate) => candidate.id)).toContain('deep-loop-1');
    expect(route.edges.map((candidate) => candidate.id)).not.toContain('near-pocket-tooth-1');
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

  it('does not expose open clean short transition evidence as the selected product route', () => {
    const targetKm = 8;
    const routeIntent = intent(targetKm, ['field_paths']);
    const contract = buildMissionContractV3(routeIntent);
    if (!contract) throw new Error('expected transition_to_woods mission contract');

    const result = assembleTransitionToWoodsMissionV3(
      graph([
        edge('connector-out', 's', 'a', 0.05, 'asphalt', 'residential', 'urban'),
        edge('field-clean-1', 'a', 'b', 1.32, 'ground', 'path', null),
        edge('field-clean-2', 'b', 'c', 1.32, 'ground', 'track', null),
        edge('field-clean-3', 'c', 'd', 1.32, 'ground', 'path', null),
        edge('field-clean-4', 'd', 'e', 1.32, 'ground', 'track', null),
      ]),
      contract,
    );

    expect(result.selectedCandidate?.selectedReason).toBe('long_dirty');
    expect(result.selectedCandidate?.selectedReason).not.toBe('clean_short');
    expect(result.selectedCandidate?.metrics.targetRepeatKm).toBeGreaterThan(0);
    expect(result.selectedCandidate?.returned).toBe(true);
    expect(result.portfolio.candidates.find((candidate) => candidate.selectedReason === 'clean_short')?.returned).toBe(false);
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
      selected: false,
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

    expect(route.edges).toEqual([]);
    expect(route.warnings).toContain('graph assembly found no product-valid route candidate');
    expect(Math.max(0, ...(route.assemblyDiagnostics?.frontierTrace ?? []).map((step) => step.maxNaturalDwellKm))).toBeGreaterThanOrEqual(5.4);
    expect(Math.max(0, ...(route.assemblyDiagnostics?.frontierTrace ?? []).map((step) => step.maxDistanceKm))).toBeGreaterThan(6);
  }, 20000);

  it('P0 mission assembler: builds a Fontainebleau-like phased route without target repeat instead of ending on an open progress candidate', () => {
    const targetKm = 12;
    const trunk = Array.from({ length: 10 }, (_, index) =>
      edge(`mission-trunk-${index + 1}`, `w${index}`, `w${index + 1}`, 0.62, 'dirt', index % 2 === 0 ? 'track' : 'path', null),
    );

    const route = assembleGraphRouteV3(
      intent(targetKm, ['field_paths']),
      { ...mission(targetKm, ['field_paths']), returnMode: 'out_and_back_connector' },
      graph([
        edge('mission-paved-access-out', 's', 'w0', 0.42, 'asphalt', 'residential', 'urban'),
        ...trunk,
        edge('mission-natural-return', 'w10', 'w0', 4.9, 'ground', 'track', null),
        edge('mission-paved-access-back', 'w0', 's', 0.42, 'asphalt', 'residential', 'urban'),
      ]),
    );

    expect(route.nodeIds[0]).toBe('s');
    expect(route.nodeIds.at(-1)).toBe('s');
    expect(route.metrics.distanceProducedKm).toBeGreaterThanOrEqual(targetKm * 0.7);
    expect(route.metrics.targetRepeatKm).toBe(0);
    expect(route.edges.map((candidate) => candidate.id)).toEqual([
      'mission-paved-access-out',
      ...trunk.map((candidate) => candidate.id),
      'mission-natural-return',
      'mission-paved-access-back',
    ]);
  });

  it('surfaces a returned under-target natural-majority route as adjusted only when product gates allow it', () => {
    const targetKm = 8;
    const route = assembleGraphRouteV3(
      intent(targetKm, ['field_paths']),
      { ...mission(targetKm, ['field_paths']), returnMode: 'out_and_back_connector' },
      graph([
        edge('adjusted-paved-access-out', 's', 'a', 0.3, 'asphalt', 'residential', 'urban'),
        edge('adjusted-natural-1', 'a', 'b', 1.3, 'ground', 'path', null),
        edge('adjusted-natural-2', 'b', 'c', 1.3, 'ground', 'track', null),
        edge('adjusted-natural-3', 'c', 'd', 1.3, 'gravel', 'path', null),
        edge('adjusted-natural-return', 'd', 'a', 1.3, 'ground', 'track', null),
        edge('adjusted-paved-access-back', 'a', 's', 0.3, 'asphalt', 'residential', 'urban'),
      ]),
    );
    const outcome = decideOutcomeV3(intent(targetKm, ['field_paths']), route);

    expect(route.nodeIds[0]).toBe('s');
    expect(route.nodeIds.at(-1)).toBe('s');
    expect(route.metrics.distanceProducedKm).toBeGreaterThanOrEqual(targetKm * 0.7);
    expect(route.metrics.distanceProducedKm).toBeLessThan(targetKm);
    expect(route.metrics.naturalDwellKm).toBeGreaterThanOrEqual(targetKm * 0.45);
    expect(route.metrics.pavedRatio).toBeLessThan(0.35);
    expect(outcome.type).toBe('adjusted');
  });

  it('refuses a returned under-distance candidate when target repeat is excessive', () => {
    const targetKm = 8;
    const route = assembleGraphRouteV3(
      intent(targetKm, ['field_paths']),
      { ...mission(targetKm, ['field_paths']), returnMode: 'out_and_back_connector' },
      graph([
        edge('repeat-access-out', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
        edge('repeat-target-out', 'a', 'b', 1.2, 'ground', 'path', null),
        edge('repeat-target-back', 'b', 'a', 1.2, 'ground', 'path', null),
        edge('repeat-target-out-2', 'a', 'b', 1.2, 'ground', 'track', null),
        edge('repeat-target-back-2', 'b', 'a', 1.2, 'ground', 'track', null),
        edge('repeat-access-back', 'a', 's', 0.2, 'asphalt', 'residential', 'urban'),
      ]),
    );
    const outcome = decideOutcomeV3(intent(targetKm, ['field_paths']), route);

    expect(outcome.type).toBe('refused');
    expect(route.edges).toEqual([]);
    expect(route.warnings).toContain('graph assembly found no product-valid route candidate');
  });

  it('P0 mission assembler: refuses impossible distance with an empty route instead of exposing a mini-route as final output', () => {
    const targetKm = 12;
    const route = assembleGraphRouteV3(
      intent(targetKm, ['field_paths']),
      { ...mission(targetKm, ['field_paths']), returnMode: 'out_and_back_connector' },
      graph([
        edge('impossible-access-out', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
        edge('impossible-natural-a', 'a', 'b', 0.45, 'ground', 'path', null),
        edge('impossible-natural-b', 'b', 'c', 0.45, 'ground', 'path', null),
        edge('impossible-natural-c', 'c', 'a', 0.45, 'ground', 'path', null),
        edge('impossible-access-back', 'a', 's', 0.2, 'asphalt', 'residential', 'urban'),
      ]),
    );
    const outcome = decideOutcomeV3(intent(targetKm, ['field_paths']), route);

    expect(outcome.type).toBe('refused');
    expect(route.edges).toEqual([]);
    expect(route.nodeIds).toEqual([]);
    expect(route.metrics.distanceProducedKm).toBe(0);
    expect(route.warnings).toContain('graph assembly found no product-valid route candidate');
    expect(route.assemblyDiagnostics?.topFinalCandidates?.length).toBeGreaterThan(0);
  });

  it('P4 gates out a returned trail candidate when final paved ratio is above product budget', () => {
    const targetKm = 8;
    const route = assembleGraphRouteV3(
      intent(targetKm, ['field_paths']),
      { ...mission(targetKm, ['field_paths']), returnMode: 'out_and_back_connector' },
      graph([
        edge('paved-budget-access-out', 's', 'a', 2, 'asphalt', 'residential', 'urban'),
        edge('paved-budget-natural-1', 'a', 'b', 1, 'ground', 'path', null),
        edge('paved-budget-natural-2', 'b', 'c', 1, 'ground', 'track', null),
        edge('paved-budget-natural-3', 'c', 'd', 1, 'ground', 'path', null),
        edge('paved-budget-natural-return', 'd', 'a', 1, 'ground', 'track', null),
        edge('paved-budget-access-back', 'a', 's', 2, 'asphalt', 'residential', 'urban'),
      ]),
    );
    const outcome = decideOutcomeV3(intent(targetKm, ['field_paths']), route);

    expect(route.edges).toEqual([]);
    expect(outcome.type).toBe('refused');
    expect(route.assemblyDiagnostics?.topFinalCandidates?.[0]).toMatchObject({
      gate: 'pavedRatio',
      rejectedReason: expect.stringContaining('final paved ratio'),
      pavedRatio: expect.any(Number),
      finalPavedRatioEstimate: expect.any(Number),
      longestTrailSegmentKm: expect.any(Number),
      strictTrailKm: expect.any(Number),
    });
  });

  it('P4 rejects aggregated natural dwell when there is no meaningful strict trail spine', () => {
    const targetKm = 7;
    const route = assembleGraphRouteV3(
      intent(targetKm, ['field_paths']),
      { ...mission(targetKm, ['field_paths']), returnMode: 'out_and_back_connector' },
      graph([
        edge('weak-spine-access-out', 's', 'a', 0.25, 'asphalt', 'residential', 'urban'),
        edge('weak-spine-natural-1', 'a', 'b', 1, 'ground', 'service', null),
        edge('weak-spine-natural-2', 'b', 'c', 1, 'ground', 'service', null),
        edge('weak-spine-natural-3', 'c', 'd', 1, 'ground', 'service', null),
        edge('weak-spine-natural-4', 'd', 'e', 1, 'ground', 'service', null),
        edge('weak-spine-natural-return', 'e', 'a', 2, 'ground', 'service', null),
        edge('weak-spine-access-back', 'a', 's', 0.25, 'asphalt', 'residential', 'urban'),
      ]),
    );

    expect(route.edges).toEqual([]);
    expect(route.assemblyDiagnostics?.topFinalCandidates?.[0]).toMatchObject({
      gate: 'longestTrailSegment',
      longestTrailSegmentKm: 0,
      strictTrailKm: 0,
      naturalDwellKm: expect.any(Number),
    });
  });

  it('preserves target-component handoff diagnostics when traversal cannot emit a product-valid route', () => {
    const targetKm = 12;
    const route = assembleGraphRouteV3(
      intent(targetKm, ['field_paths']),
      { ...mission(targetKm, ['field_paths']), returnMode: 'out_and_back_connector' },
      graph([
        edge('handoff-access-out', 's', 'entry', 0.3, 'asphalt', 'residential', 'urban'),
        edge('handoff-target-a', 'entry', 'a', 0.5, 'ground', 'path', null),
        edge('handoff-target-b', 'a', 'b', 0.5, 'ground', 'track', null),
        edge('handoff-target-c', 'b', 'entry', 0.5, 'ground', 'path', null),
        edge('handoff-access-back', 'entry', 's', 0.3, 'asphalt', 'residential', 'urban'),
      ]),
    );

    expect(route.edges).toEqual([]);
    expect(route.warnings).toContain('graph assembly found no product-valid route candidate');
    expect(route.assemblyDiagnostics?.targetComponentHandoff).toMatchObject({
      selectedTargetComponentIds: ['field_paths'],
      componentCandidateCount: expect.any(Number),
      blocker: expect.any(String),
    });
    expect(route.assemblyDiagnostics?.targetComponentHandoff?.componentCandidates[0]).toMatchObject({
      entryNodeId: expect.any(String),
      entryDistanceKm: expect.any(Number),
      traversalInputNodeCount: expect.any(Number),
      traversalInputEdgeCount: expect.any(Number),
      traversalResult: {
        status: expect.any(String),
        distanceKm: expect.any(Number),
        targetKm: expect.any(Number),
        repeatedTargetKm: expect.any(Number),
      },
      closureAttempt: {
        status: expect.any(String),
        closureDistanceKm: expect.any(Number),
        connectorRepeatKm: expect.any(Number),
        targetRepeatKm: expect.any(Number),
      },
    });
  });

  it('P5 emits candidate diversity and Pareto diagnostics for final selection', () => {
    const targetKm = 5.5;
    const route = assembleGraphRouteV3(
      intent(targetKm),
      mission(targetKm),
      graph([
        edge('p5-access-out', 's', 'a', 1, 'asphalt', 'residential', 'urban'),
        edge('p5-forest-1', 'a', 'b', 1, 'ground', 'path'),
        edge('p5-forest-2', 'b', 'c', 1, 'ground', 'path'),
        edge('p5-forest-3', 'c', 'd', 1, 'ground', 'path'),
        edge('p5-forest-4', 'd', 'a', 1, 'ground', 'path'),
        edge('p5-alt-forest-1', 'a', 'e', 0.8, 'ground', 'path'),
        edge('p5-alt-forest-2', 'e', 'a', 0.8, 'ground', 'path'),
      ]),
    );

    expect(route.edges.length).toBeGreaterThan(0);
    expect(route.assemblyDiagnostics).toMatchObject({
      candidateCount: expect.any(Number),
      inEnvelopeCount: expect.any(Number),
      overlongCount: expect.any(Number),
      underMinCount: expect.any(Number),
      selectedCandidateId: expect.any(String),
      selectedReason: expect.stringContaining('pareto'),
    });
    expect(route.assemblyDiagnostics?.candidateCountByLane).toEqual(expect.objectContaining({ seed: expect.any(Number) }));
    expect(route.assemblyDiagnostics?.paretoFrontierCandidates?.length).toBeGreaterThan(0);
    expect(route.assemblyDiagnostics?.topFinalCandidates?.[0]).toMatchObject({
      source: expect.any(String),
      distanceErrorRatio: expect.any(Number),
      pavedConnectorKm: expect.any(Number),
      busyRoadRatio: expect.any(Number),
      closureQuality: expect.any(Number),
    });
  });

  it('P5 records top rejected gates when no candidate is product-valid', () => {
    const targetKm = 8;
    const route = assembleGraphRouteV3(
      intent(targetKm, ['field_paths']),
      { ...mission(targetKm, ['field_paths']), returnMode: 'out_and_back_connector' },
      graph([
        edge('p5-reject-access-out', 's', 'a', 2, 'asphalt', 'residential', 'urban'),
        edge('p5-reject-natural-1', 'a', 'b', 1, 'ground', 'path', null),
        edge('p5-reject-natural-2', 'b', 'c', 1, 'ground', 'track', null),
        edge('p5-reject-natural-3', 'c', 'd', 1, 'ground', 'path', null),
        edge('p5-reject-natural-return', 'd', 'a', 1, 'ground', 'track', null),
        edge('p5-reject-access-back', 'a', 's', 2, 'asphalt', 'residential', 'urban'),
      ]),
    );

    expect(route.edges).toEqual([]);
    expect(route.assemblyDiagnostics).toMatchObject({
      candidateCount: expect.any(Number),
      topRejected: expect.any(Array),
    });
    expect(route.assemblyDiagnostics?.topRejected?.[0]).toMatchObject({
      gate: expect.any(String),
      rejectedReason: expect.any(String),
    });
  });

});
