import { describe, expect, it } from 'vitest';
import type { EnrichedEdge, EnrichedGraph, GraphNode } from '@/lib/types';
import { solveComponentLoopV3 } from '@/lib/engine-v3/assemblers/component-loop-solver';
import { contractNaturalGraphV3 } from '@/lib/engine-v3/assemblers/natural-graph-contraction';
import { buildOrderedCycleExpansionV3 } from '@/lib/engine-v3/assemblers/ordered-cycle-expansion';
import { planMultiCycleDwellV3 } from '@/lib/engine-v3/assemblers/multi-cycle-dwell-planner';
import { extractRankedNaturalCyclesV3 } from '@/lib/engine-v3/assemblers/ranked-natural-cycle-extractor';
import { buildTargetComponentTraversal } from '@/lib/engine-v3/assemblers/target-component-traversal';
import { computeRouteMetricsV3 } from '@/lib/engine-v3/route-metrics';
import type { RouteEdgeV3, RouteSurfaceV3 } from '@/lib/engine-v3/types';

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

function finalSurface(edge: EnrichedEdge): RouteSurfaceV3 {
  const surface = edge.surface?.toLowerCase() ?? '';
  if (['asphalt', 'concrete', 'paved', 'paving_stones', 'sett', 'cobblestone', 'compacted'].includes(surface)) return 'paved';
  if (['dirt', 'earth', 'grass', 'ground', 'gravel', 'mud', 'sand', 'soil', 'unpaved', 'woodchips'].includes(surface)) return 'natural';
  return 'mixed';
}

function finalMetricsFromResult(fixture: EnrichedGraph, edgeIds: string[], targetDistanceKm: number) {
  const routeEdges: RouteEdgeV3[] = edgeIds.map((edgeId) => {
    const candidate = fixture.edges.get(edgeId);
    if (!candidate) throw new Error(`missing edge ${edgeId}`);
    const surface = finalSurface(candidate);
    return {
      id: candidate.id,
      from: candidate.from,
      to: candidate.to,
      lengthKm: candidate.lengthKm,
      surface,
      componentKind: surface === 'paved' && candidate.scenic ? 'scenic_paved' : 'field_paths',
      highway: candidate.highway,
      osmWayId: candidate.osmWayId,
    };
  });
  return computeRouteMetricsV3({ targetDistanceKm, edges: routeEdges, geometry: { type: 'LineString', coordinates: [] }, targetComponents: ['field_paths'] });
}

describe('extractRankedNaturalCyclesV3', () => {
  it('chooses a useful long natural cycle over an accessible micro-cycle', () => {
    const fixture = graph([
      edge('micro-1', 'a', 'b', 0.3, 'ground', 'path', null),
      edge('micro-2', 'b', 'c', 0.3, 'ground', 'path', null),
      edge('micro-3', 'c', 'a', 0.3, 'ground', 'path', null),
      edge('long-1', 'a', 'd', 1.4, 'ground', 'path', null),
      edge('long-2', 'd', 'e', 1.4, 'ground', 'track', null),
      edge('long-3', 'e', 'f', 1.4, 'ground', 'path', null),
      edge('long-4', 'f', 'a', 1.4, 'ground', 'track', null),
    ]);

    const result = extractRankedNaturalCyclesV3({ graph: fixture, targetComponentIds: ['field_paths'], minUsefulCycleKm: 1.5, targetDistanceKm: 8 });

    expect(result.cycles[0]?.id).toBe('ranked-cycle-1');
    expect(result.cycles[0]?.lengthKm).toBeGreaterThan(5);
    expect(result.cycles[0]?.originalEdgeIds).toEqual(['long-1', 'long-2', 'long-3', 'long-4']);
    expect(result.diagnostics.rejectedMicroCycles).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.selectedCycleId).toBe('ranked-cycle-1');
  });

  it('builds a simple ordered cycle from a spanning-tree back edge', () => {
    const fixture = graph([
      edge('tree-1', 'a', 'b', 1, 'ground', 'path', null),
      edge('tree-2', 'b', 'c', 1, 'ground', 'track', null),
      edge('tree-3', 'c', 'd', 1, 'ground', 'path', null),
      edge('back-edge', 'd', 'a', 1, 'ground', 'track', null),
      edge('branch', 'c', 'x', 0.2, 'ground', 'path', null),
    ]);

    const result = extractRankedNaturalCyclesV3({ graph: fixture, targetComponentIds: ['field_paths'], minUsefulCycleKm: 2 });

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]?.originalNodeIds).toEqual(['a', 'b', 'c', 'd', 'a']);
    expect(result.cycles[0]?.originalEdgeIds).toEqual(['tree-1', 'tree-2', 'tree-3', 'back-edge']);
    expect(result.diagnostics.basisMethod).toBe('spanning_tree_back_edges');
  });

  it('extracts multiple useful grid cycles and jaccard-deduplicates spaghetti equivalents', () => {
    const fixture = graph([
      edge('ab', 'a', 'b', 0.9, 'ground', 'path', null),
      edge('bc', 'b', 'c', 0.9, 'ground', 'path', null),
      edge('cd', 'c', 'd', 0.9, 'ground', 'path', null),
      edge('da', 'd', 'a', 0.9, 'ground', 'path', null),
      edge('be', 'b', 'e', 0.9, 'ground', 'path', null),
      edge('ef', 'e', 'f', 0.9, 'ground', 'path', null),
      edge('fc', 'f', 'c', 0.9, 'ground', 'path', null),
      edge('ac-diagonal', 'a', 'c', 0.1, 'ground', 'path', null),
    ]);

    const result = extractRankedNaturalCyclesV3({ graph: fixture, targetComponentIds: ['field_paths'], minUsefulCycleKm: 1.5, targetDistanceKm: 6 });

    expect(result.cycles.length).toBeGreaterThanOrEqual(2);
    expect(result.cycles.every((candidate) => candidate.lengthKm >= 1.5)).toBe(true);
    expect(result.cycles.every((candidate) => new Set(candidate.originalEdgeIds).size === candidate.originalEdgeIds.length)).toBe(true);
    expect(result.diagnostics.jaccardDedupCount).toBeGreaterThan(0);
  });

  it('does not invent cycles in branch-only trees and reports no_useful_cycle', () => {
    const result = extractRankedNaturalCyclesV3({
      graph: graph([
        edge('trunk-1', 'a', 'b', 1, 'ground', 'path', null),
        edge('trunk-2', 'b', 'c', 1, 'ground', 'track', null),
        edge('branch-1', 'b', 'leaf1', 1, 'ground', 'path', null),
        edge('branch-2', 'c', 'leaf2', 1, 'ground', 'path', null),
      ]),
      targetComponentIds: ['field_paths'],
      minUsefulCycleKm: 1.5,
    });

    expect(result.cycles).toHaveLength(0);
    expect(result.diagnostics.pruningReason).toBe('no_useful_cycle');
    expect(result.diagnostics.selectedCycleId).toBeNull();
  });

  it('keeps paved forest/service edges counted as paved and penalized inside mixed cycles', () => {
    const result = extractRankedNaturalCyclesV3({
      graph: graph([
        edge('natural-1', 'a', 'b', 1, 'ground', 'path', null),
        edge('paved-forest-service', 'b', 'c', 0.8, 'asphalt', 'service', 'forest'),
        edge('natural-2', 'c', 'd', 1, 'ground', 'track', null),
        edge('natural-3', 'd', 'a', 1, 'ground', 'path', null),
      ]),
      targetComponentIds: ['field_paths', 'forest'],
      minUsefulCycleKm: 2,
      includePavedWithinNaturalContext: true,
    });

    expect(result.cycles[0]?.pavedKm).toBeCloseTo(0.8, 3);
    expect(result.cycles[0]?.naturalKm).toBeCloseTo(3, 3);
    expect(result.cycles[0]?.naturalKm).toBeLessThan(result.cycles[0]?.lengthKm ?? 0);
  });

  it('bounds large synthetic graphs without candidate explosion', () => {
    const edges = Array.from({ length: 180 }, (_, index) =>
      edge(`ring-${index}`, `n${index}`, `n${(index + 1) % 180}`, 0.05, 'ground', index % 2 === 0 ? 'path' : 'track', null),
    );

    const result = extractRankedNaturalCyclesV3({
      graph: graph(edges),
      targetComponentIds: ['field_paths'],
      minUsefulCycleKm: 2,
      maxBackEdges: 24,
      maxCandidates: 8,
    });

    expect(result.cycles.length).toBeLessThanOrEqual(8);
    expect(result.diagnostics.runtimeMs).toBeLessThan(1000);
    expect(result.diagnostics.pruningReason).toMatch(/pruned|max_candidate|bounded|none|no_useful_cycle/);
  });
});

describe('contractNaturalGraphV3', () => {
  it('contracts degree-2 natural chains while preserving length, surfaces, highways, and original edge ids', () => {
    const result = contractNaturalGraphV3({
      graph: graph([
        edge('access-paved', 's', 'a', 0.4, 'asphalt', 'residential', 'urban'),
        edge('chain-1', 'a', 'b', 0.7, 'ground', 'path', null),
        edge('chain-2', 'b', 'c', 0.8, 'gravel', 'track', null),
        edge('chain-3', 'c', 'd', 0.9, 'ground', 'path', null),
        edge('branch', 'c', 'x', 0.3, 'ground', 'path', null),
        edge('scenic-paved', 'd', 'e', 0.5, 'asphalt', 'service', 'forest'),
      ]),
      targetComponentIds: ['field_paths'],
    });

    expect(result.diagnostics.originalNaturalEdgeCount).toBe(4);
    expect(result.diagnostics.contractedNodeCount).toBeGreaterThanOrEqual(4);
    expect(result.diagnostics.contractedCorridorCount).toBeGreaterThanOrEqual(3);
    const main = result.corridors.find((corridor) => corridor.originalEdgeIds.join(',') === 'chain-1,chain-2');
    expect(main).toBeDefined();
    expect(main?.lengthKm).toBeCloseTo(1.5, 3);
    expect(main?.surfaceSummary).toEqual(['natural']);
    expect(main?.highways.sort()).toEqual(['path', 'track']);
    expect(result.corridors.some((corridor) => corridor.originalEdgeIds.includes('scenic-paved'))).toBe(false);
  });

  it('detects useful natural cycles and expands them back to original edge ids', () => {
    const result = contractNaturalGraphV3({
      graph: graph([
        edge('cycle-1', 'a', 'b', 1, 'ground', 'path', null),
        edge('cycle-2', 'b', 'c', 1, 'ground', 'track', null),
        edge('cycle-3', 'c', 'd', 1, 'ground', 'path', null),
        edge('cycle-4', 'd', 'a', 1, 'ground', 'track', null),
        edge('gateway', 's', 'a', 0.25, 'asphalt', 'residential', 'urban'),
      ]),
      targetComponentIds: ['field_paths'],
      startNodeId: 's',
      minUsefulCycleKm: 2,
    });

    expect(result.diagnostics.cycleCandidateCount).toBeGreaterThanOrEqual(1);
    expect(result.cycleCandidates[0]?.originalEdgeIds).toEqual(['cycle-1', 'cycle-2', 'cycle-3', 'cycle-4']);
    expect(result.cycleCandidates[0]?.lengthKm).toBeCloseTo(4, 3);
    expect(result.diagnostics.expansionValidity.valid).toBe(true);
    expect(result.diagnostics.selectedCycleOrLandmarkPlan?.type).toBe('cycle');
  });

  it('keeps grid cycles useful without returning every micro-cycle duplicate', () => {
    const result = contractNaturalGraphV3({
      graph: graph([
        edge('ab', 'a', 'b', 0.8, 'ground', 'path', null),
        edge('bc', 'b', 'c', 0.8, 'ground', 'path', null),
        edge('cd', 'c', 'd', 0.8, 'ground', 'path', null),
        edge('da', 'd', 'a', 0.8, 'ground', 'path', null),
        edge('be', 'b', 'e', 0.8, 'ground', 'path', null),
        edge('ef', 'e', 'f', 0.8, 'ground', 'path', null),
        edge('fc', 'f', 'c', 0.8, 'ground', 'path', null),
        edge('ac-diagonal', 'a', 'c', 0.1, 'ground', 'path', null),
      ]),
      targetComponentIds: ['field_paths'],
      minUsefulCycleKm: 2,
    });

    expect(result.diagnostics.cycleCandidateCount).toBeGreaterThanOrEqual(1);
    expect(result.cycleCandidates.every((candidate) => candidate.lengthKm >= 2)).toBe(true);
    expect(result.diagnostics.jaccardDedupCount).toBeGreaterThan(0);
  });

  it('reports branch-only natural trees without pretending to find a clean loop', () => {
    const result = contractNaturalGraphV3({
      graph: graph([
        edge('spine-1', 'a', 'b', 0.5, 'ground', 'path', null),
        edge('spine-2', 'b', 'c', 0.5, 'ground', 'path', null),
        edge('tooth-1', 'b', 'leaf1', 0.6, 'ground', 'path', null),
        edge('tooth-2', 'c', 'leaf2', 0.6, 'ground', 'path', null),
      ]),
      targetComponentIds: ['field_paths'],
    });

    expect(result.diagnostics.cycleCandidateCount).toBe(0);
    expect(result.diagnostics.selectedCycleOrLandmarkPlan?.type).toBe('none');
    expect(result.diagnostics.expansionValidity.valid).toBe(true);
  });

  it('marks expansion invalid when a corridor references a missing original edge id', () => {
    const result = contractNaturalGraphV3({
      graph: graph([
        edge('cycle-1', 'a', 'b', 1, 'ground', 'path', null),
        edge('cycle-2', 'b', 'c', 1, 'ground', 'path', null),
        edge('cycle-3', 'c', 'a', 1, 'ground', 'path', null),
      ]),
      targetComponentIds: ['field_paths'],
      debugInjectMissingOriginalEdgeId: true,
    });

    expect(result.diagnostics.expansionValidity.valid).toBe(false);
    expect(result.diagnostics.expansionValidity.missingOriginalEdgeIds).toContain('debug-missing-edge');
  });
});

describe('planMultiCycleDwellV3', () => {
  it('documents that mixed unknown trail edges are the source of planner-vs-final pavedRatio mismatch', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
      edge('c1-1', 'a', 'b', 1, 'unknown', 'path'),
      edge('c1-2', 'b', 'c', 1, 'unknown', 'track'),
      edge('c1-3', 'c', 'd', 1, 'unknown', 'path'),
      edge('c1-4', 'd', 'a', 1, 'unknown', 'track'),
      edge('bridge', 'd', 'e', 0.4, 'unknown', 'path'),
      edge('c2-1', 'e', 'f', 1, 'unknown', 'path'),
      edge('c2-2', 'f', 'g', 1, 'unknown', 'track'),
      edge('c2-3', 'g', 'h', 1, 'unknown', 'path'),
      edge('c2-4', 'h', 'e', 1, 'unknown', 'track'),
      edge('closure-e', 'e', 's', 0.2, 'asphalt', 'residential', 'urban'),
      edge('closure', 'd', 's', 0.2, 'asphalt', 'residential', 'urban'),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        { id: 'ranked-cycle-1', originalEdgeIds: ['c1-1', 'c1-2', 'c1-3', 'c1-4'], originalNodeIds: ['a', 'b', 'c', 'd', 'a'], lengthKm: 4, naturalKm: 4, pavedKm: 0 },
        { id: 'ranked-cycle-2', originalEdgeIds: ['c2-1', 'c2-2', 'c2-3', 'c2-4'], originalNodeIds: ['e', 'f', 'g', 'h', 'e'], lengthKm: 4, naturalKm: 4, pavedKm: 0 },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({ graph: fixture, startNodeId: 's', contraction, targetComponentIds: ['field_paths', 'forest'], targetDistanceKm: 10, minDistanceKm: 6, maxDistanceKm: 11.5, requestedNaturalDwellKm: 3.5, maxCycles: 2 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    const finalMetrics = finalMetricsFromResult(fixture, result.edgeIds, 10);
    expect(result.metrics.pavedKm / result.metrics.distanceKm).toBeLessThan(finalMetrics.pavedRatio);
    expect(result.metrics.pavedKm).toBeLessThan(finalMetrics.pavedKm);
    expect(finalMetrics.naturalDwellKm).toBeLessThanOrEqual(result.metrics.chainNaturalKm);
  });

  it('chooses a slightly longer non-paved closure over a short paved closure when distance remains in envelope', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
      edge('c1-1', 'a', 'b', 1, 'ground', 'path', null),
      edge('c1-2', 'b', 'c', 1, 'ground', 'track', null),
      edge('c1-3', 'c', 'd', 1, 'ground', 'path', null),
      edge('c1-4', 'd', 'a', 1, 'ground', 'track', null),
      edge('bridge', 'd', 'e', 0.4, 'ground', 'path', null),
      edge('c2-1', 'e', 'f', 1, 'ground', 'path', null),
      edge('c2-2', 'f', 'g', 1, 'ground', 'track', null),
      edge('c2-3', 'g', 'h', 1, 'ground', 'path', null),
      edge('c2-4', 'h', 'e', 1, 'ground', 'track', null),
      edge('short-paved-closure', 'e', 's', 0.2, 'asphalt', 'residential', 'urban'),
      edge('natural-closure-1', 'e', 'x', 0.45, 'ground', 'path', null),
      edge('natural-closure-2', 'x', 's', 0.45, 'ground', 'path', null),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths'], startNodeId: 's', minUsefulCycleKm: 2 });

    const result = planMultiCycleDwellV3({ graph: fixture, startNodeId: 's', contraction, targetComponentIds: ['field_paths'], targetDistanceKm: 10, minDistanceKm: 7, maxDistanceKm: 11.5, requestedNaturalDwellKm: 5, maxCycles: 2 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.edgeIds).toContain('natural-closure-1');
    expect(result.edgeIds).toContain('natural-closure-2');
    expect(result.edgeIds).not.toContain('short-paved-closure');
    expect(result.metrics.closurePavedKm).toBe(0);
  });

  it('chains two natural cycles through a non-paved corridor before closure', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.25, 'asphalt', 'residential', 'urban'),
      edge('c1-1', 'a', 'b', 1, 'ground', 'path', null),
      edge('c1-2', 'b', 'c', 1, 'ground', 'track', null),
      edge('c1-3', 'c', 'd', 1, 'ground', 'path', null),
      edge('c1-4', 'd', 'a', 1, 'ground', 'track', null),
      edge('natural-corridor', 'd', 'e', 0.8, 'ground', 'path', null),
      edge('c2-1', 'e', 'f', 1, 'ground', 'path', null),
      edge('c2-2', 'f', 'g', 1, 'ground', 'track', null),
      edge('c2-3', 'g', 'h', 1, 'ground', 'path', null),
      edge('c2-4', 'h', 'e', 1, 'ground', 'track', null),
      edge('closure', 'e', 's', 0.3, 'asphalt', 'residential', 'urban'),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths'], startNodeId: 's', minUsefulCycleKm: 2 });

    const result = planMultiCycleDwellV3({ graph: fixture, startNodeId: 's', contraction, targetComponentIds: ['field_paths'], targetDistanceKm: 10, requestedNaturalDwellKm: 7 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.cycleIds.length).toBeGreaterThanOrEqual(2);
    expect(result.edgeIds).toContain('natural-corridor');
    expect(result.metrics.chainNaturalKm).toBeGreaterThan(7);
    expect(result.metrics.connectorPavedKm).toBe(0);
    expect(result.diagnostics.failedPhase).toBeNull();
  });

  it('does not close after the first insufficient cycle when a second useful cycle is reachable', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
      edge('early-closure', 'a', 's', 0.2, 'asphalt', 'residential', 'urban'),
      edge('c1-1', 'a', 'b', 0.8, 'ground', 'path', null),
      edge('c1-2', 'b', 'c', 0.8, 'ground', 'track', null),
      edge('c1-3', 'c', 'a', 0.8, 'ground', 'path', null),
      edge('natural-corridor', 'c', 'd', 0.6, 'ground', 'path', null),
      edge('c2-1', 'd', 'e', 1, 'ground', 'path', null),
      edge('c2-2', 'e', 'f', 1, 'ground', 'track', null),
      edge('c2-3', 'f', 'd', 1, 'ground', 'path', null),
      edge('closure', 'd', 's', 0.25, 'asphalt', 'residential', 'urban'),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths'], startNodeId: 's', minUsefulCycleKm: 2 });

    const result = planMultiCycleDwellV3({ graph: fixture, startNodeId: 's', contraction, targetComponentIds: ['field_paths'], targetDistanceKm: 8, requestedNaturalDwellKm: 5 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.edgeIds).toContain('c2-1');
    expect(result.edgeIds).not.toEqual(['access', 'early-closure']);
    expect(result.metrics.chainNaturalKm).toBeGreaterThan(5);
  });

  it('keeps a long paved connector honest and refuses the second cycle when it would dominate the route', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
      edge('c1-1', 'a', 'b', 1, 'ground', 'path', null),
      edge('c1-2', 'b', 'c', 1, 'ground', 'track', null),
      edge('c1-3', 'c', 'a', 1, 'ground', 'path', null),
      edge('long-paved-connector', 'c', 'd', 3.2, 'asphalt', 'service', 'forest'),
      edge('c2-1', 'd', 'e', 1, 'ground', 'path', null),
      edge('c2-2', 'e', 'f', 1, 'ground', 'track', null),
      edge('c2-3', 'f', 'd', 1, 'ground', 'path', null),
      edge('closure', 'a', 's', 0.2, 'asphalt', 'residential', 'urban'),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths', 'forest'], startNodeId: 's', minUsefulCycleKm: 2 });

    const result = planMultiCycleDwellV3({ graph: fixture, startNodeId: 's', contraction, targetComponentIds: ['field_paths', 'forest'], targetDistanceKm: 8, requestedNaturalDwellKm: 5 });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;
    expect(result.reason).toBe('no_chainable_cycle');
    expect(result.diagnostics.connectorPavedKm).toBeGreaterThan(3);
    expect(result.diagnostics.failedPhase).toBe('dwellPhase');
  });

  it('deduplicates highly overlapping cycles instead of building a dense mower chain', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
      edge('ab', 'a', 'b', 1, 'ground', 'path', null),
      edge('bc', 'b', 'c', 1, 'ground', 'path', null),
      edge('cd', 'c', 'd', 1, 'ground', 'path', null),
      edge('da', 'd', 'a', 1, 'ground', 'path', null),
      edge('ac-diagonal', 'a', 'c', 0.05, 'ground', 'path', null),
      edge('closure', 'a', 's', 0.2, 'asphalt', 'residential', 'urban'),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths'], startNodeId: 's', minUsefulCycleKm: 1.5 });

    const result = planMultiCycleDwellV3({ graph: fixture, startNodeId: 's', contraction, targetComponentIds: ['field_paths'], targetDistanceKm: 8, requestedNaturalDwellKm: 6 });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;
    expect(result.reason).toBe('no_chainable_cycle');
    expect(result.diagnostics.overlapRejectedCount).toBeGreaterThan(0);
    expect(result.diagnostics.chainCount).toBeLessThanOrEqual(1);
  });

  it('reports no_chainable_cycle on branch-only trees without inventing cycles', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
      edge('trunk-1', 'a', 'b', 1, 'ground', 'path', null),
      edge('branch-1', 'b', 'leaf1', 1, 'ground', 'path', null),
      edge('branch-2', 'b', 'leaf2', 1, 'ground', 'track', null),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths'], startNodeId: 's', minUsefulCycleKm: 1.5 });

    const result = planMultiCycleDwellV3({ graph: fixture, startNodeId: 's', contraction, targetComponentIds: ['field_paths'], targetDistanceKm: 7, requestedNaturalDwellKm: 5 });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;
    expect(result.reason).toBe('no_chainable_cycle');
    expect(result.diagnostics.chainCount).toBe(0);
    expect(result.diagnostics.failedPhase).toBe('dwellPhase');
  });

  it('measures repeat on original edges without double-counting a clean chained route', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.25, 'asphalt', 'residential', 'urban'),
      edge('c1-1', 'a', 'b', 1, 'ground', 'path', null),
      edge('c1-2', 'b', 'c', 1, 'ground', 'track', null),
      edge('c1-3', 'c', 'a', 1, 'ground', 'path', null),
      edge('natural-corridor', 'c', 'd', 0.8, 'ground', 'path', null),
      edge('c2-1', 'd', 'e', 1, 'ground', 'path', null),
      edge('c2-2', 'e', 'f', 1, 'ground', 'track', null),
      edge('c2-3', 'f', 'd', 1, 'ground', 'path', null),
      edge('closure', 'd', 's', 0.25, 'asphalt', 'residential', 'urban'),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths'], startNodeId: 's', minUsefulCycleKm: 2 });

    const result = planMultiCycleDwellV3({ graph: fixture, startNodeId: 's', contraction, targetComponentIds: ['field_paths'], targetDistanceKm: 8, requestedNaturalDwellKm: 5 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.metrics.chainRepeatKm).toBe(0);
    expect(result.metrics.chainTargetRepeatKm).toBe(0);
    expect(new Set(result.edgeIds).size).toBe(result.edgeIds.length);
  });

  it('selects an in-envelope multi-cycle candidate over a more natural overlong chain', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
      edge('c1-1', 'a', 'b', 1, 'ground', 'path', null),
      edge('c1-2', 'b', 'c', 1, 'ground', 'track', null),
      edge('c1-3', 'c', 'd', 1, 'ground', 'path', null),
      edge('c1-4', 'd', 'a', 1, 'ground', 'track', null),
      edge('bridge-12', 'd', 'e', 0.3, 'ground', 'path', null),
      edge('c2-1', 'e', 'f', 1, 'ground', 'path', null),
      edge('c2-2', 'f', 'g', 1, 'ground', 'track', null),
      edge('c2-3', 'g', 'h', 1, 'ground', 'path', null),
      edge('c2-4', 'h', 'e', 1, 'ground', 'track', null),
      edge('bridge-23', 'h', 'i', 0.3, 'ground', 'path', null),
      edge('c3-1', 'i', 'j', 1, 'ground', 'path', null),
      edge('c3-2', 'j', 'k', 1, 'ground', 'track', null),
      edge('c3-3', 'k', 'l', 1, 'ground', 'path', null),
      edge('c3-4', 'l', 'i', 1, 'ground', 'track', null),
      edge('closure-in-envelope', 'h', 's', 0.2, 'asphalt', 'residential', 'urban'),
      edge('closure-overlong', 'l', 's', 0.2, 'asphalt', 'residential', 'urban'),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths'], startNodeId: 's', minUsefulCycleKm: 2 });

    const result = planMultiCycleDwellV3({ graph: fixture, startNodeId: 's', contraction, targetComponentIds: ['field_paths'], targetDistanceKm: 10, minDistanceKm: 6.5, maxDistanceKm: 8.5, requestedNaturalDwellKm: 5, maxCycles: 3 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.metrics.distanceKm).toBeLessThanOrEqual(8.5);
    expect(result.diagnostics.multiCycleDwellCandidates.inEnvelopeCount).toBeGreaterThan(0);
    expect(result.diagnostics.multiCycleDwellCandidates.selectedCandidateId).toBeTruthy();
  });

  it('prefers a less exact but natural in-envelope candidate over a paved distance match', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
      edge('n1', 'a', 'b', 1, 'ground', 'path', null),
      edge('n2', 'b', 'c', 1, 'ground', 'track', null),
      edge('n3', 'c', 'd', 1, 'ground', 'path', null),
      edge('n4', 'd', 'a', 1, 'ground', 'track', null),
      edge('natural-bridge', 'd', 'e', 0.4, 'ground', 'path', null),
      edge('n5', 'e', 'f', 1, 'ground', 'path', null),
      edge('n6', 'f', 'g', 1, 'ground', 'track', null),
      edge('n7', 'g', 'h', 1, 'ground', 'path', null),
      edge('n8', 'h', 'e', 1, 'ground', 'track', null),
      edge('natural-closure', 'h', 's', 1.4, 'asphalt', 'residential', 'urban'),
      edge('p1', 'a', 'p', 1, 'ground', 'path', null),
      edge('p2', 'p', 'q', 1, 'ground', 'track', null),
      edge('p3', 'q', 'r', 1, 'ground', 'path', null),
      edge('p4', 'r', 'a', 1, 'ground', 'track', null),
      edge('paved-bridge', 'r', 'u', 1.6, 'asphalt', 'service', 'forest'),
      edge('p5', 'u', 'v', 1, 'ground', 'path', null),
      edge('p6', 'v', 'w', 1, 'ground', 'track', null),
      edge('p7', 'w', 'x', 1, 'ground', 'path', null),
      edge('p8', 'x', 'u', 1, 'ground', 'track', null),
      edge('paved-closure', 'x', 's', 0.1, 'asphalt', 'residential', 'urban'),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths', 'forest'], startNodeId: 's', minUsefulCycleKm: 2 });

    const result = planMultiCycleDwellV3({ graph: fixture, startNodeId: 's', contraction, targetComponentIds: ['field_paths', 'forest'], targetDistanceKm: 10, minDistanceKm: 7, maxDistanceKm: 11.5, requestedNaturalDwellKm: 5, maxCycles: 2 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.edgeIds).not.toContain('paved-bridge');
    expect(result.metrics.connectorPavedKm).toBe(0);
  });

  it('keeps overlong candidates diagnostic-only and never promotes them as product route', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
      edge('c1-1', 'a', 'b', 1.2, 'ground', 'path', null),
      edge('c1-2', 'b', 'c', 1.2, 'ground', 'track', null),
      edge('c1-3', 'c', 'd', 1.2, 'ground', 'path', null),
      edge('c1-4', 'd', 'a', 1.2, 'ground', 'track', null),
      edge('bridge', 'd', 'e', 0.5, 'ground', 'path', null),
      edge('c2-1', 'e', 'f', 1.2, 'ground', 'path', null),
      edge('c2-2', 'f', 'g', 1.2, 'ground', 'track', null),
      edge('c2-3', 'g', 'h', 1.2, 'ground', 'path', null),
      edge('c2-4', 'h', 'e', 1.2, 'ground', 'track', null),
      edge('closure', 'e', 's', 0.2, 'asphalt', 'residential', 'urban'),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths'], startNodeId: 's', minUsefulCycleKm: 2 });

    const result = planMultiCycleDwellV3({ graph: fixture, startNodeId: 's', contraction, targetComponentIds: ['field_paths'], targetDistanceKm: 7, minDistanceKm: 4.9, maxDistanceKm: 5, requestedNaturalDwellKm: 5, maxCycles: 2 });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;
    expect(result.metrics.distanceKm).toBeGreaterThan(5);
    expect(result.diagnostics.multiCycleDwellCandidates.overlongCount).toBeGreaterThan(0);
    expect(result.diagnostics.multiCycleDwellCandidates.selectedCandidateId).toBeNull();
    expect(result.diagnostics.multiCycleDwellCandidates.topRejected.some((candidate) => candidate.rejectedReason === 'overlong')).toBe(true);
  });

  it('classifies under-min returned candidates without reporting them as generated success', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.1, 'asphalt', 'residential', 'urban'),
      edge('c1-1', 'a', 'b', 0.8, 'ground', 'path', null),
      edge('c1-2', 'b', 'c', 0.8, 'ground', 'track', null),
      edge('c1-3', 'c', 'a', 0.8, 'ground', 'path', null),
      edge('bridge', 'c', 'd', 0.2, 'ground', 'path', null),
      edge('c2-1', 'd', 'e', 0.8, 'ground', 'path', null),
      edge('c2-2', 'e', 'f', 0.8, 'ground', 'track', null),
      edge('c2-3', 'f', 'd', 0.8, 'ground', 'path', null),
      edge('closure', 'd', 's', 0.1, 'asphalt', 'residential', 'urban'),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths'], startNodeId: 's', minUsefulCycleKm: 1.5 });

    const result = planMultiCycleDwellV3({ graph: fixture, startNodeId: 's', contraction, targetComponentIds: ['field_paths'], targetDistanceKm: 10, minDistanceKm: 7, maxDistanceKm: 11.5, requestedNaturalDwellKm: 3, maxCycles: 2 });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;
    expect(result.metrics.distanceKm).toBeLessThan(7);
    expect(result.diagnostics.multiCycleDwellCandidates.underMinCount).toBeGreaterThan(0);
    expect(result.diagnostics.multiCycleDwellCandidates.topRejected.some((candidate) => candidate.rejectedReason === 'under_min')).toBe(true);
  });

  it('exposes rejected reasons for overlong, under-min, paved, repeat, and dominated candidates', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
      edge('good-1', 'a', 'b', 1, 'ground', 'path', null),
      edge('good-2', 'b', 'c', 1, 'ground', 'track', null),
      edge('good-3', 'c', 'd', 1, 'ground', 'path', null),
      edge('good-4', 'd', 'a', 1, 'ground', 'track', null),
      edge('good-bridge', 'd', 'e', 0.3, 'ground', 'path', null),
      edge('good-5', 'e', 'f', 1, 'ground', 'path', null),
      edge('good-6', 'f', 'g', 1, 'ground', 'track', null),
      edge('good-7', 'g', 'h', 1, 'ground', 'path', null),
      edge('good-8', 'h', 'e', 1, 'ground', 'track', null),
      edge('good-closure', 'h', 's', 0.2, 'asphalt', 'residential', 'urban'),
      edge('under-1', 'a', 'u1', 0.6, 'ground', 'path', null),
      edge('under-2', 'u1', 'u2', 0.6, 'ground', 'track', null),
      edge('under-3', 'u2', 'a', 0.6, 'ground', 'path', null),
      edge('paved-link', 'd', 'p1', 2.5, 'asphalt', 'service', 'forest'),
      edge('paved-1', 'p1', 'p2', 1, 'ground', 'path', null),
      edge('paved-2', 'p2', 'p3', 1, 'ground', 'track', null),
      edge('paved-3', 'p3', 'p1', 1, 'ground', 'path', null),
      edge('over-link', 'h', 'o1', 0.3, 'ground', 'path', null),
      edge('over-1', 'o1', 'o2', 1.5, 'ground', 'path', null),
      edge('over-2', 'o2', 'o3', 1.5, 'ground', 'track', null),
      edge('over-3', 'o3', 'o4', 1.5, 'ground', 'path', null),
      edge('over-4', 'o4', 'o1', 1.5, 'ground', 'track', null),
      edge('over-closure', 'o4', 's', 0.2, 'asphalt', 'residential', 'urban'),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths', 'forest'], startNodeId: 's', minUsefulCycleKm: 1.5 });

    const result = planMultiCycleDwellV3({ graph: fixture, startNodeId: 's', contraction, targetComponentIds: ['field_paths', 'forest'], targetDistanceKm: 10, minDistanceKm: 7, maxDistanceKm: 11.5, requestedNaturalDwellKm: 4, maxCycles: 3, beamWidth: 12 });

    expect(result.diagnostics.multiCycleDwellCandidates.count).toBeGreaterThan(1);
    const reasons = result.diagnostics.multiCycleDwellCandidates.topRejected.map((candidate) => candidate.rejectedReason);
    expect(reasons).toContain('under_min');
    expect(reasons).toContain('excessive_paved');
    expect(reasons).toContain('dominated');
    expect(reasons).toContain('excessive_repeat');
  });

  it('bounds dense multi-cycle pruning and preserves paved accounting in access connectors and closure', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.4, 'asphalt', 'residential', 'urban'),
      edge('c1-1', 'a', 'b', 1, 'ground', 'path', null), edge('c1-2', 'b', 'c', 1, 'ground', 'track', null), edge('c1-3', 'c', 'd', 1, 'ground', 'path', null), edge('c1-4', 'd', 'a', 1, 'ground', 'track', null),
      edge('c2-1', 'd', 'e', 0.2, 'ground', 'path', null), edge('c2-2', 'e', 'f', 1, 'ground', 'path', null), edge('c2-3', 'f', 'g', 1, 'ground', 'track', null), edge('c2-4', 'g', 'h', 1, 'ground', 'path', null), edge('c2-5', 'h', 'e', 1, 'ground', 'track', null),
      edge('c3-1', 'h', 'i', 0.2, 'ground', 'path', null), edge('c3-2', 'i', 'j', 1, 'ground', 'path', null), edge('c3-3', 'j', 'k', 1, 'ground', 'track', null), edge('c3-4', 'k', 'l', 1, 'ground', 'path', null), edge('c3-5', 'l', 'i', 1, 'ground', 'track', null),
      edge('dense-ac', 'a', 'c', 0.1, 'ground', 'path', null), edge('dense-bd', 'b', 'd', 0.1, 'ground', 'path', null), edge('dense-eg', 'e', 'g', 0.1, 'ground', 'path', null), edge('dense-fh', 'f', 'h', 0.1, 'ground', 'path', null),
      edge('paved-closure', 'h', 's', 0.6, 'asphalt', 'residential', 'urban'),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths'], startNodeId: 's', minUsefulCycleKm: 1.5 });

    const result = planMultiCycleDwellV3({ graph: fixture, startNodeId: 's', contraction, targetComponentIds: ['field_paths'], targetDistanceKm: 10, minDistanceKm: 7, maxDistanceKm: 11.5, requestedNaturalDwellKm: 5, maxCycles: 3, beamWidth: 4 });

    expect(result.diagnostics.beamWidth).toBe(4);
    expect(result.diagnostics.prunedCandidateCount).toBeGreaterThan(0);
    expect(result.diagnostics.multiCycleDwellCandidates.count).toBeLessThanOrEqual(24);
    if (result.status === 'success') {
      expect(result.metrics.accessKm).toBeCloseTo(0.4, 3);
      expect(result.metrics.closurePavedKm).toBeGreaterThan(0);
      expect(result.metrics.pavedKm).toBeGreaterThanOrEqual(result.metrics.accessKm + result.metrics.closurePavedKm - 0.001);
    }
  });
});

describe('buildOrderedCycleExpansionV3', () => {
  it('expands a simple accessible contracted cycle into a continuous original edge chain', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.25, 'asphalt', 'residential', 'urban'),
      edge('cycle-1', 'a', 'b', 1, 'ground', 'path', null),
      edge('cycle-2', 'b', 'c', 1, 'ground', 'track', null),
      edge('cycle-3', 'c', 'd', 1, 'ground', 'path', null),
      edge('cycle-4', 'd', 'a', 1, 'ground', 'track', null),
      edge('closure', 'a', 's', 0.25, 'asphalt', 'residential', 'urban'),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths'], startNodeId: 's', minUsefulCycleKm: 2 });

    const result = buildOrderedCycleExpansionV3({ graph: fixture, startNodeId: 's', contraction, targetComponentIds: ['field_paths'], targetDistanceKm: 6 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.core.originalEdgeIds).toEqual(['cycle-1', 'cycle-2', 'cycle-3', 'cycle-4']);
    expect(result.edgeIds).toEqual(['access', 'cycle-1', 'cycle-2', 'cycle-3', 'cycle-4', 'closure']);
    expect(result.validation.continuous).toBe(true);
    expect(result.metrics.naturalCycleKm).toBeCloseTo(4, 3);
  });

  it('preserves degree-2 corridor order, length, surface accounting, and original edge ids', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
      edge('corridor-1', 'a', 'b', 0.6, 'ground', 'path', null),
      edge('corridor-2', 'b', 'c', 0.7, 'gravel', 'track', null),
      edge('corridor-3', 'c', 'd', 0.8, 'ground', 'path', null),
      edge('corridor-4', 'd', 'a', 0.9, 'ground', 'track', null),
      edge('closure', 'a', 's', 0.2, 'asphalt', 'residential', 'urban'),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths'], startNodeId: 's', minUsefulCycleKm: 2 });

    const result = buildOrderedCycleExpansionV3({ graph: fixture, startNodeId: 's', contraction, targetComponentIds: ['field_paths'], targetDistanceKm: 5 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.core.originalEdgeIds).toEqual(['corridor-1', 'corridor-2', 'corridor-3', 'corridor-4']);
    expect(result.core.lengthKm).toBeCloseTo(3, 3);
    expect(result.metrics.naturalCycleKm).toBeCloseTo(3, 3);
    expect(result.metrics.pavedKm).toBeCloseTo(0.4, 3);
  });

  it('refuses ambiguous discontinuous cycle expansion with a phase-level reason', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
      edge('cycle-1', 'a', 'b', 1, 'ground', 'path', null),
      edge('cycle-2', 'b', 'c', 1, 'ground', 'path', null),
      edge('island-1', 'x', 'y', 1, 'ground', 'path', null),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths'], startNodeId: 's', minUsefulCycleKm: 0.5 });
    const patched = {
      ...contraction,
      cycleCandidates: [{ id: 'debug-discontinuous', originalNodeIds: ['a', 'b', 'c', 'x', 'y'], originalEdgeIds: ['cycle-1', 'cycle-2', 'island-1'], lengthKm: 3, corridorIds: [], qualityScore: 3 }],
    };

    const result = buildOrderedCycleExpansionV3({ graph: fixture, startNodeId: 's', contraction: patched, targetComponentIds: ['field_paths'], targetDistanceKm: 5 });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;
    expect(result.reason).toBe('invalid_cycle_expansion');
    expect(result.validation.continuous).toBe(false);
  });

  it('prefers a natural cycle continuation over an early short paved closure when distance remains acceptable', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.25, 'asphalt', 'residential', 'urban'),
      edge('early-paved-closure', 'a', 's', 0.3, 'asphalt', 'residential', 'urban'),
      edge('cycle-1', 'a', 'b', 1.1, 'ground', 'path', null),
      edge('cycle-2', 'b', 'c', 1.1, 'ground', 'track', null),
      edge('cycle-3', 'c', 'd', 1.1, 'ground', 'path', null),
      edge('cycle-4', 'd', 'a', 1.1, 'ground', 'track', null),
      edge('closure', 'a', 's', 0.25, 'asphalt', 'residential', 'urban'),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths'], startNodeId: 's', minUsefulCycleKm: 2 });

    const result = buildOrderedCycleExpansionV3({ graph: fixture, startNodeId: 's', contraction, targetComponentIds: ['field_paths'], targetDistanceKm: 6 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.edgeIds).toContain('cycle-4');
    expect(result.edgeIds).not.toEqual(['access', 'early-paved-closure']);
    expect(result.metrics.naturalCycleKm).toBeGreaterThan(4);
  });

  it('keeps paved surfaces inside the selected corridor counted as paved', () => {
    const fixture = graph([
      edge('access', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
      edge('cycle-1', 'a', 'b', 1, 'ground', 'path', null),
      edge('paved-in-woods', 'b', 'c', 0.5, 'asphalt', 'service', 'forest'),
      edge('cycle-2', 'c', 'd', 1, 'ground', 'track', null),
      edge('cycle-3', 'd', 'a', 1, 'ground', 'path', null),
      edge('closure', 'a', 's', 0.2, 'asphalt', 'residential', 'urban'),
    ]);
    const contraction = contractNaturalGraphV3({ graph: fixture, targetComponentIds: ['field_paths', 'forest'], startNodeId: 's', minUsefulCycleKm: 2 });
    const patched = {
      ...contraction,
      cycleCandidates: [{ id: 'mixed-surface-cycle', originalNodeIds: ['a', 'b', 'c', 'd'], originalEdgeIds: ['cycle-1', 'paved-in-woods', 'cycle-2', 'cycle-3'], lengthKm: 3.5, corridorIds: [], qualityScore: 3.5 }],
    };

    const result = buildOrderedCycleExpansionV3({ graph: fixture, startNodeId: 's', contraction: patched, targetComponentIds: ['field_paths', 'forest'], targetDistanceKm: 5 });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.core.originalEdgeIds).toEqual(['cycle-1', 'paved-in-woods', 'cycle-2', 'cycle-3']);
    expect(result.metrics.naturalCycleKm).toBeCloseTo(3, 3);
    expect(result.metrics.pavedKm).toBeCloseTo(0.9, 3);
  });
});

describe('buildTargetComponentTraversal', () => {
  it('finds a long clean target loop in a linear-plus-cycle natural component', () => {
    const result = buildTargetComponentTraversal({
      graph: graph([
        edge('access', 's', 'a', 0.4, 'asphalt', 'residential', 'urban'),
        edge('linear-entry', 'a', 'b', 0.2, 'ground', 'path', null),
        edge('cycle-1', 'b', 'c', 1.2, 'ground', 'path', null),
        edge('cycle-2', 'c', 'd', 1.2, 'ground', 'track', null),
        edge('cycle-3', 'd', 'e', 1.2, 'ground', 'path', null),
        edge('cycle-4', 'e', 'b', 1.2, 'ground', 'track', null),
        edge('closure', 'b', 's', 0.4, 'asphalt', 'residential', 'urban'),
      ]),
      startNodeId: 's',
      entryNodeId: 'a',
      targetComponentIds: ['field_paths'],
      targetDistanceKm: 6,
      minDistanceRatio: 0.7,
      maxDistanceRatio: 1.25,
      usedEdgeKeys: new Set(['access']),
      forbidTargetRepeat: true,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.distanceKm).toBeGreaterThanOrEqual(4.2);
    expect(result.repeatedTargetKm).toBe(0);
    expect(result.edgeIds).toEqual(['linear-entry', 'cycle-1', 'cycle-2', 'cycle-3', 'cycle-4', 'closure']);
    expect(result.closure.connectorRepeatKm).toBe(0);
  });

  it('refuses branchy target teeth whose raw capacity requires target repeat to exploit', () => {
    const teeth = Array.from({ length: 8 }, (_, index) =>
      edge(`tooth-${index + 1}`, `spine${index}`, `leaf${index + 1}`, 0.55, 'ground', 'path', null),
    );
    const spine = Array.from({ length: 8 }, (_, index) =>
      edge(`spine-${index + 1}`, `spine${index}`, `spine${index + 1}`, 0.18, 'ground', 'track', null),
    );

    const result = buildTargetComponentTraversal({
      graph: graph([edge('access', 's', 'spine0', 0.3, 'asphalt', 'residential', 'urban'), ...spine, ...teeth, edge('closure', 'spine8', 's', 0.3, 'asphalt', 'residential', 'urban')]),
      startNodeId: 's',
      entryNodeId: 'spine0',
      targetComponentIds: ['field_paths'],
      targetDistanceKm: 7,
      minDistanceRatio: 0.7,
      maxDistanceRatio: 1.25,
      usedEdgeKeys: new Set(['access']),
      forbidTargetRepeat: true,
    });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;
    expect(result.diagnostics.reachableTargetKm).toBeGreaterThan(5);
    expect(result.diagnostics.exploitableTargetKm).toBeLessThan(1);
    expect(result.diagnostics.blocker).toBe('branch_repeat_limited');
    expect(result.diagnostics.bestPartialDistanceKm).toBeGreaterThan(0);
  });

  it('splits repeated access connector from non-repeated target traversal', () => {
    const result = buildTargetComponentTraversal({
      graph: graph([
        edge('access', 's', 'a', 0.5, 'asphalt', 'residential', 'urban'),
        edge('cycle-1', 'a', 'b', 1.2, 'ground', 'path', null),
        edge('cycle-2', 'b', 'c', 1.2, 'ground', 'track', null),
        edge('cycle-3', 'c', 'a', 1.2, 'ground', 'path', null),
      ]),
      startNodeId: 's',
      entryNodeId: 'a',
      targetComponentIds: ['field_paths'],
      targetDistanceKm: 4.5,
      minDistanceRatio: 0.7,
      maxDistanceRatio: 1.25,
      usedEdgeKeys: new Set(['access']),
      forbidTargetRepeat: true,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.repeatedTargetKm).toBe(0);
    expect(result.closure.connectorRepeatKm).toBeGreaterThan(0);
    expect(result.closure.targetRepeatKm).toBe(0);
    expect(result.edgeIds.at(-1)).toBe('access');
  });

  it('refuses impossible target capacity without emitting a product-valid route', () => {
    const result = buildTargetComponentTraversal({
      graph: graph([
        edge('access', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
        edge('tiny-1', 'a', 'b', 0.3, 'ground', 'path', null),
        edge('tiny-2', 'b', 'c', 0.3, 'ground', 'track', null),
        edge('tiny-3', 'c', 'a', 0.3, 'ground', 'path', null),
        edge('closure', 'a', 's', 0.2, 'asphalt', 'residential', 'urban'),
      ]),
      startNodeId: 's',
      entryNodeId: 'a',
      targetComponentIds: ['field_paths'],
      targetDistanceKm: 8,
      minDistanceRatio: 0.7,
      maxDistanceRatio: 1.25,
      usedEdgeKeys: new Set(['access']),
      forbidTargetRepeat: true,
    });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;
    expect(result.diagnostics.reachableTargetKm).toBeCloseTo(0.9, 3);
    expect(result.diagnostics.exploitableTargetKm).toBeCloseTo(0.9, 3);
    expect(result.diagnostics.bestPartialDistanceKm).toBeCloseTo(1.1, 3);
    expect(result.diagnostics.unusedTargetKm).toBe(0);
  });

  it('does not report bridge-separated core capacity as cleanly exploitable from the selected entry', () => {
    const result = buildTargetComponentTraversal({
      graph: graph([
        edge('access', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
        edge('near-cycle-1', 'a', 'b', 0.8, 'ground', 'path', null),
        edge('near-cycle-2', 'b', 'c', 0.8, 'ground', 'track', null),
        edge('near-cycle-3', 'c', 'a', 0.8, 'ground', 'path', null),
        edge('single-bridge', 'c', 'd', 0.2, 'ground', 'path', null),
        edge('far-cycle-1', 'd', 'e', 1.4, 'ground', 'path', null),
        edge('far-cycle-2', 'e', 'f', 1.4, 'ground', 'track', null),
        edge('far-cycle-3', 'f', 'd', 1.4, 'ground', 'path', null),
        edge('closure', 'a', 's', 0.2, 'asphalt', 'residential', 'urban'),
      ]),
      startNodeId: 's',
      entryNodeId: 'a',
      targetComponentIds: ['field_paths'],
      targetDistanceKm: 7,
      minDistanceRatio: 0.7,
      maxDistanceRatio: 1.25,
      usedEdgeKeys: new Set(['access']),
      forbidTargetRepeat: true,
    });

    expect(result.status).toBe('failure');
    expect(result.diagnostics.reachableTargetKm).toBeCloseTo(6.8, 3);
    expect(result.diagnostics.exploitableTargetKm).toBeCloseTo(2.4, 3);
    expect(result.diagnostics.targetDistanceKm).toBeCloseTo(2.4, 3);
    expect(result.diagnostics.blocker).toBe('branch_repeat_limited');
  });
});

describe('solveComponentLoopV3', () => {
  it('builds a component-first loop when a large natural component is reachable through a short paved connector', () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge('access', 's', 'a', 0.35, 'asphalt', 'residential', 'urban'),
        edge('loop-1', 'a', 'b', 1.1, 'ground', 'path', null),
        edge('loop-2', 'b', 'c', 1.1, 'ground', 'track', null),
        edge('loop-3', 'c', 'd', 1.1, 'ground', 'path', null),
        edge('loop-4', 'd', 'a', 1.1, 'ground', 'track', null),
        edge('closure', 'a', 's', 0.35, 'asphalt', 'residential', 'urban'),
      ]),
      startNodeId: 's',
      targetComponentIds: ['field_paths'],
      targetDistanceKm: 6,
      requestedNaturalDwellKm: 3.2,
    });

    expect(result.status).toBe('success');
    expect(result.diagnostics.selectedComponentId).toBe('target-component-1');
    expect(result.diagnostics.accessCandidates.count).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.dwellCandidates.count).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.closureCandidates.count).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.naturalGraphContraction.originalNaturalEdgeCount).toBe(4);
    expect(result.diagnostics.naturalGraphContraction.cycleCandidateCount).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.naturalGraphContraction.expansionValidity.valid).toBe(true);
    if (result.status !== 'success') return;
    expect(result.edgeIds).toEqual(['access', 'loop-1', 'loop-2', 'loop-3', 'loop-4', 'closure']);
    expect(result.metrics.accessPavedKm).toBeCloseTo(0.35, 3);
    expect(result.metrics.naturalDwellKm).toBeCloseTo(4.4, 3);
  });

  it('refuses a massive branch-only natural component with a phase-level reason', () => {
    const branchTeeth = Array.from({ length: 12 }, (_, index) =>
      edge(`dead-end-tooth-${index + 1}`, 'entry', `leaf-${index + 1}`, 0.55, 'ground', 'path', null),
    );
    const result = solveComponentLoopV3({
      graph: graph([edge('access', 's', 'entry', 0.2, 'asphalt', 'residential', 'urban'), ...branchTeeth]),
      startNodeId: 's',
      targetComponentIds: ['field_paths'],
      targetDistanceKm: 7,
      requestedNaturalDwellKm: 4.5,
    });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;
    expect(result.reason).toBe('no_dwell');
    expect(['dwellPhase', 'closurePhase']).toContain(result.diagnostics.failedPhase);
    expect(result.diagnostics.componentReachableTargetKm).toBeGreaterThan(6);
    expect(['branch_repeat_limited', 'no_clean_closure']).toContain(result.diagnostics.topComponentLoopCandidates[0]?.reason);
  });

  it('extends dwell through a deep natural branch before recovering to a clean returned loop', () => {
    const deepBranch = Array.from({ length: 8 }, (_, index) =>
      edge(`deep-branch-${index + 1}`, `deep${index}`, `deep${index + 1}`, 0.55, 'ground', index % 2 === 0 ? 'path' : 'track', null),
    );
    const result = solveComponentLoopV3({
      graph: graph([
        edge('access', 's', 'entry', 0.45, 'asphalt', 'residential', 'urban'),
        edge('local-trap-1', 'entry', 'trap1', 0.8, 'ground', 'path', null),
        edge('local-trap-2', 'trap1', 'trap2', 0.8, 'ground', 'track', null),
        edge('local-trap-return', 'trap2', 'entry', 0.8, 'ground', 'path', null),
        edge('deep-gateway', 'entry', 'deep0', 0.35, 'ground', 'path', null),
        ...deepBranch,
        edge('deep-clean-return', 'deep8', 'entry', 1.9, 'ground', 'track', null),
        edge('closure', 'entry', 's', 0.45, 'asphalt', 'residential', 'urban'),
      ]),
      startNodeId: 's',
      targetComponentIds: ['field_paths'],
      targetDistanceKm: 9,
      requestedNaturalDwellKm: 4.8,
    });

    expect(result.status).toBe('success');
    expect(result.metrics.naturalDwellKm).toBeGreaterThan(6);
    expect(result.metrics.targetRepeatKm).toBe(0);
    expect(result.edgeIds).toContain('deep-clean-return');
  });

  it('selects the best recoverable partial loop over a larger component that is shorter after dwell', () => {
    const hugeButShort = Array.from({ length: 70 }, (_, index) =>
      edge(`huge-short-${index + 1}`, 'huge-entry', `huge-leaf-${index + 1}`, 0.3, 'ground', 'path', null),
    );
    const recoverableLoop = [
      edge('recoverable-1', 'recoverable-entry', 'r1', 1.4, 'ground', 'path', null),
      edge('recoverable-2', 'r1', 'r2', 1.4, 'ground', 'track', null),
      edge('recoverable-3', 'r2', 'r3', 1.4, 'ground', 'path', null),
      edge('recoverable-return', 'r3', 'recoverable-entry', 1.4, 'ground', 'track', null),
    ];
    const result = solveComponentLoopV3({
      graph: graph([
        edge('short-access', 's', 'huge-entry', 0.25, 'asphalt', 'residential', 'urban'),
        ...hugeButShort,
        edge('recoverable-access', 's', 'recoverable-entry', 0.9, 'asphalt', 'residential', 'urban'),
        ...recoverableLoop,
        edge('recoverable-closure', 'recoverable-entry', 's', 0.9, 'asphalt', 'residential', 'urban'),
      ]),
      startNodeId: 's',
      targetComponentIds: ['field_paths'],
      targetDistanceKm: 12,
      requestedNaturalDwellKm: 5.4,
    });

    expect(result.diagnostics.selectedComponentId).toBe('target-component-2');
    expect(result.edgeIds).toContain('recoverable-return');
    expect(result.metrics.distanceKm).toBeGreaterThan(7);
    expect(result.metrics.naturalDwellKm).toBeGreaterThan(5);
  });

  it('exposes ordered cycle core as a component-loop lane when it satisfies dwell and distance gates', () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge('access', 's', 'a', 0.3, 'asphalt', 'residential', 'urban'),
        edge('z-cycle-entry', 'a', 'b', 1.25, 'ground', 'path', null),
        edge('m-cycle-mid', 'b', 'c', 1.25, 'ground', 'track', null),
        edge('a-cycle-mid', 'c', 'd', 1.25, 'ground', 'path', null),
        edge('q-cycle-return', 'd', 'a', 1.25, 'ground', 'track', null),
        edge('closure', 'a', 's', 0.3, 'asphalt', 'residential', 'urban'),
      ]),
      startNodeId: 's',
      targetComponentIds: ['field_paths'],
      targetDistanceKm: 7,
      requestedNaturalDwellKm: 4.8,
    });

    expect(result.status).toBe('success');
    expect(result.diagnostics.orderedCycleExpansion?.selectedCycleId).toBeTruthy();
    expect(result.diagnostics.topComponentLoopCandidates.some((candidate) => candidate.componentId === 'ordered-cycle-core')).toBe(true);
    expect(result.diagnostics.orderedCycleExpansion?.metrics.naturalCycleKm).toBeCloseTo(5, 3);
  });

  it('keeps asphalt access and closure counted as paved while the internal dwell stays natural', () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge('asphalt-access', 's', 'a', 0.6, 'asphalt', 'residential', 'urban'),
        edge('natural-1', 'a', 'b', 1.1, 'ground', 'path', null),
        edge('natural-2', 'b', 'c', 1.1, 'ground', 'track', null),
        edge('natural-3', 'c', 'd', 1.1, 'gravel', 'path', null),
        edge('natural-return', 'd', 'a', 1.1, 'ground', 'track', null),
        edge('asphalt-closure', 'a', 's', 0.6, 'asphalt', 'residential', 'urban'),
      ]),
      startNodeId: 's',
      targetComponentIds: ['field_paths'],
      targetDistanceKm: 6,
      requestedNaturalDwellKm: 3.2,
    });

    expect(result.status).toBe('success');
    expect(result.metrics.accessPavedKm).toBeCloseTo(0.6, 3);
    expect(result.metrics.closurePavedKm).toBeCloseTo(0.6, 3);
    expect(result.metrics.pavedKm).toBeCloseTo(1.2, 3);
    expect(result.metrics.naturalDwellKm).toBeCloseTo(4.4, 3);
  });

  it('refuses a returned under-distance candidate when closure repeats a target pair through a different edge id', () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge('access', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
        edge('target-ab-first', 'a', 'b', 1.2, 'ground', 'path', null),
        edge('target-bc', 'b', 'c', 1.2, 'ground', 'track', null),
        edge('target-ca', 'c', 'a', 1.2, 'ground', 'path', null),
        edge('target-ab-repeat-different-osm-edge', 'b', 'a', 1.2, 'ground', 'track', null),
      ]),
      startNodeId: 's',
      targetComponentIds: ['field_paths'],
      targetDistanceKm: 7,
      requestedNaturalDwellKm: 2.4,
      allowConnectorRepeatClosure: true,
    });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;
    expect(result.reason).toBe('no_clean_closure');
    expect(result.metrics.targetRepeatKm).toBe(0);
    expect(result.edgeIds).not.toContain('target-ab-repeat-different-osm-edge');
    expect(result.diagnostics.failedPhase).toBe('closurePhase');
  });

  it('downgrades dwell success when closure would require massive target repeat', () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge('access', 's', 'a', 0.25, 'asphalt', 'residential', 'urban'),
        edge('cycle-1', 'a', 'b', 1.2, 'ground', 'path', null),
        edge('cycle-2', 'b', 'c', 1.2, 'ground', 'track', null),
        edge('cycle-3', 'c', 'a', 1.2, 'ground', 'path', null),
      ]),
      startNodeId: 's',
      targetComponentIds: ['field_paths'],
      targetDistanceKm: 6,
      requestedNaturalDwellKm: 2.4,
      allowConnectorRepeatClosure: false,
    });

    expect(result.status).toBe('failure');
    if (result.status !== 'failure') return;
    expect(result.reason).toBe('no_clean_closure');
    expect(result.diagnostics.failedPhase).toBe('closurePhase');
    expect(result.diagnostics.dwellCandidates.top[0]?.naturalDwellKm).toBeGreaterThanOrEqual(2.4);
  });

  it('keeps required paved access counted as paved when natural dwell is majority', () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge('access', 's', 'a', 0.8, 'asphalt', 'residential', 'urban'),
        edge('loop-1', 'a', 'b', 1.2, 'ground', 'path', null),
        edge('loop-2', 'b', 'c', 1.2, 'ground', 'track', null),
        edge('loop-3', 'c', 'd', 1.2, 'ground', 'path', null),
        edge('loop-4', 'd', 'a', 1.2, 'ground', 'track', null),
        edge('closure', 'a', 's', 0.8, 'asphalt', 'residential', 'urban'),
      ]),
      startNodeId: 's',
      targetComponentIds: ['field_paths'],
      targetDistanceKm: 7,
      requestedNaturalDwellKm: 4,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.metrics.accessPavedKm).toBeCloseTo(0.8, 3);
    expect(result.metrics.closurePavedKm).toBeCloseTo(0.8, 3);
    expect(result.metrics.pavedKm).toBeCloseTo(1.6, 3);
    expect(result.metrics.naturalDwellKm).toBeCloseTo(4.8, 3);
    expect(result.metrics.pavedKm).toBeLessThan(result.metrics.naturalDwellKm);
  });

  it('keeps component-loop dwell aligned with route-countable target dwell instead of counting non-target natural closure', () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge('access', 's', 'a', 0.2, 'asphalt', 'residential', 'urban'),
        edge('target-1', 'a', 'b', 1.2, 'ground', 'path', null),
        edge('target-2', 'b', 'c', 1.2, 'ground', 'track', null),
        edge('target-3', 'c', 'a', 1.2, 'ground', 'path', null),
        edge('non-target-natural-closure-1', 'a', 'x', 0.7, 'ground', 'path', 'urban'),
        edge('non-target-natural-closure-2', 'x', 's', 0.3, 'ground', 'path', 'urban'),
      ]),
      startNodeId: 's',
      targetComponentIds: ['field_paths'],
      targetDistanceKm: 6,
      requestedNaturalDwellKm: 3.2,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.metrics.naturalDwellKm).toBeCloseTo(3.6, 3);
    expect(result.edgeIds).toContain('non-target-natural-closure-1');
  });

  it('adds available target recovery before closure instead of closing early through residential pavement', () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge('access', 's', 'a', 0.25, 'asphalt', 'residential', 'urban'),
        edge('target-1', 'a', 'b', 1.1, 'ground', 'path', null),
        edge('target-2', 'b', 'c', 1.1, 'ground', 'track', null),
        edge('target-3', 'c', 'd', 1.1, 'ground', 'path', null),
        edge('target-recovery', 'd', 'e', 1.1, 'ground', 'track', null),
        edge('paved-early-closure', 'd', 's', 0.35, 'asphalt', 'residential', 'urban'),
        edge('natural-return', 'e', 'a', 1.1, 'ground', 'path', null),
        edge('access-back', 'a', 's', 0.25, 'asphalt', 'residential', 'urban'),
      ]),
      startNodeId: 's',
      targetComponentIds: ['field_paths'],
      targetDistanceKm: 7,
      requestedNaturalDwellKm: 3.6,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.edgeIds).toContain('target-recovery');
    expect(result.edgeIds).toContain('natural-return');
    expect(result.edgeIds).not.toContain('paved-early-closure');
    expect(result.metrics.naturalDwellKm).toBeGreaterThan(5);
    expect(result.metrics.closurePavedKm).toBeCloseTo(0.25, 3);
  });

  it('keeps paved-only closure honest instead of reclassifying it as trail dwell', () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge('access', 's', 'a', 0.4, 'asphalt', 'residential', 'urban'),
        edge('target-1', 'a', 'b', 1.2, 'ground', 'path', null),
        edge('target-2', 'b', 'c', 1.2, 'ground', 'track', null),
        edge('target-3', 'c', 'd', 1.2, 'ground', 'path', null),
        edge('paved-only-closure', 'd', 's', 0.4, 'asphalt', 'residential', 'urban'),
      ]),
      startNodeId: 's',
      targetComponentIds: ['field_paths'],
      targetDistanceKm: 6,
      requestedNaturalDwellKm: 3.2,
    });

    expect(result.status).toBe('success');
    if (result.status !== 'success') return;
    expect(result.metrics.closurePavedKm).toBeCloseTo(0.4, 3);
    expect(result.metrics.pavedKm).toBeCloseTo(0.8, 3);
    expect(result.metrics.naturalDwellKm).toBeCloseTo(3.6, 3);
  });
});
