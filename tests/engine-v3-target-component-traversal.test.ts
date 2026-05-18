import { describe, expect, it } from 'vitest';
import type { EnrichedEdge, EnrichedGraph, GraphNode } from '@/lib/types';
import { buildTargetComponentTraversal } from '@/lib/engine-v3/assemblers/target-component-traversal';

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
});
