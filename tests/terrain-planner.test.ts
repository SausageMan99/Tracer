import { describe, expect, it } from 'vitest';
import type { EnrichedEdge, EnrichedGraph, GraphNode, SessionProfile } from '../lib/types';
import { auditTerrainData } from '../lib/engine/terrain-audit';
import { planRouteIntent } from '../lib/engine/terrain-planner';

function node(id: string, lat: number, lng: number, edges: string[] = []): GraphNode {
  return { id, lat, lng, edges };
}

function edge(overrides: Partial<EnrichedEdge>): EnrichedEdge {
  return {
    id: overrides.id ?? `${overrides.from ?? 'a'}-${overrides.to ?? 'b'}`,
    from: overrides.from ?? 'a',
    to: overrides.to ?? 'b',
    lengthKm: overrides.lengthKm ?? 1,
    highway: overrides.highway ?? 'path',
    osmWayId: overrides.osmWayId ?? 1,
    score: overrides.score ?? 0.5,
    ...overrides,
  };
}

function graph(edges: EnrichedEdge[]): EnrichedGraph {
  const nodes = new Map<string, GraphNode>();
  for (const current of edges) {
    if (!nodes.has(current.from)) nodes.set(current.from, node(current.from, 49, -0.5));
    if (!nodes.has(current.to)) nodes.set(current.to, node(current.to, 49, -0.5));
    nodes.get(current.from)?.edges.push(current.id);
    nodes.get(current.to)?.edges.push(current.id);
  }

  let i = 0;
  for (const current of nodes.values()) {
    current.lat = 49 + i * 0.001;
    current.lng = -0.5 - i * 0.001;
    i += 1;
  }

  return {
    nodes,
    edges: new Map(edges.map((current) => [current.id, current])),
    center: { lat: 49, lng: -0.5 },
    radiusKm: 2,
  };
}

const trailProfile = {
  id: 'running_trail',
  name: 'Trail',
  sport: 'running',
  sessionType: 'trail',
  distanceRange: { min: 5, default: 10, max: 15 },
  elevationRange: { min: 0, default: 150, max: 600 },
  distancePresets: [5, 8, 10, 12, 15],
  elevationPresets: [100, 200, 400],
  description: 'Trail test',
  weights: { elevationMatch: 0.25, distanceMatch: 0.25, surfaceQuality: 0.3, loopQuality: 0.2 },
  graphhopperProfile: 'foot',
} satisfies SessionProfile;

describe('terrain planner', () => {
  it('selects a natural massif loop with explicit target component on connected trail terrain', () => {
    const edges = [
      edge({ id: 'ab', from: 'a', to: 'b', highway: 'path', surface: 'ground', scenic: true, lengthKm: 1.2 }),
      edge({ id: 'bc', from: 'b', to: 'c', highway: 'track', surface: 'unpaved', scenic: true, lengthKm: 1.1 }),
      edge({ id: 'cd', from: 'c', to: 'd', highway: 'path', surface: 'earth', scenic: true, lengthKm: 0.9 }),
      edge({ id: 'de', from: 'd', to: 'e', highway: 'footway', surface: 'gravel', scenic: true, lengthKm: 0.8 }),
      edge({ id: 'ef', from: 'e', to: 'f', highway: 'residential', surface: 'asphalt', lengthKm: 0.6 }),
    ];
    const localGraph = graph(edges);

    const intent = planRouteIntent({
      graph: localGraph,
      terrainAudit: auditTerrainData(edges),
      profile: trailProfile,
      targetDistanceKm: 10,
      targetElevationM: 250,
      scenicMode: true,
    });

    expect(intent.strategy).toBe('natural_massif_loop');
    expect(intent.targetComponents).toHaveLength(1);
    expect(intent.minNaturalZoneDwellKm).toBeGreaterThanOrEqual(3);
    expect(intent.maxPavedRatio).toBeLessThanOrEqual(0.45);
    expect(intent.cleanReturnMode).toBe('prefer');
    expect(intent.beamBudget.shortlistSize).toBeGreaterThan(12);
  });

  it('selects a natural massif loop when medium audit still has a large connected natural component', () => {
    const edges = [
      edge({ id: 'ab', from: 'a', to: 'b', highway: 'path', scenic: true, lengthKm: 1.2 }),
      edge({ id: 'bc', from: 'b', to: 'c', highway: 'track', scenic: true, lengthKm: 1.2 }),
      edge({ id: 'cd', from: 'c', to: 'd', highway: 'path', scenic: true, lengthKm: 1.2 }),
      edge({ id: 'de', from: 'd', to: 'e', highway: 'footway', scenic: true, lengthKm: 1.2 }),
      edge({ id: 'fg', from: 'f', to: 'g', highway: 'residential', surface: 'asphalt', lengthKm: 1 }),
      edge({ id: 'gh', from: 'g', to: 'h', highway: 'tertiary', surface: 'asphalt', lengthKm: 1 }),
      edge({ id: 'hi', from: 'h', to: 'i', highway: 'residential', surface: 'asphalt', lengthKm: 1 }),
      edge({ id: 'ij', from: 'i', to: 'j', highway: 'secondary', surface: 'asphalt', lengthKm: 1 }),
    ];
    const localGraph = graph(edges);

    const intent = planRouteIntent({
      graph: localGraph,
      terrainAudit: auditTerrainData(edges),
      profile: trailProfile,
      targetDistanceKm: 10,
      targetElevationM: 140,
    });

    expect(intent.strategy).toBe('natural_massif_loop');
    expect(intent.targetComponents).toEqual([expect.any(String)]);
    expect(intent.terrainComponents[0].totalKm).toBeGreaterThan(4);
  });

  it('selects a trail sparse compromise on fragmented but usable natural terrain', () => {
    const edges = [
      edge({ id: 'ab', from: 'a', to: 'b', highway: 'path', scenic: true, lengthKm: 0.5 }),
      edge({ id: 'cd', from: 'c', to: 'd', highway: 'track', scenic: true, lengthKm: 0.5 }),
      edge({ id: 'ef', from: 'e', to: 'f', highway: 'path', lengthKm: 0.4 }),
      edge({ id: 'gh', from: 'g', to: 'h', highway: 'residential', surface: 'asphalt', lengthKm: 1.4 }),
    ];
    const localGraph = graph(edges);

    const intent = planRouteIntent({
      graph: localGraph,
      terrainAudit: auditTerrainData(edges),
      profile: trailProfile,
      targetDistanceKm: 8,
      targetElevationM: 100,
    });

    expect(intent.strategy).toBe('trail_sparse_compromise');
    expect(intent.cleanReturnMode).toBe('fallback_allowed');
    expect(intent.relaxationOrder).toContain('natural_dwell');
    expect(intent.userWarningsIfRelaxed).toContain('Terrain naturel fragmenté : TrailForge peut devoir relier des sections par route.');
  });

  it('keeps urban low-potential terrain on an urban nature loop instead of pretending trail quality', () => {
    const edges = [
      edge({ id: 'ab', from: 'a', to: 'b', highway: 'residential', surface: 'asphalt', lengthKm: 1 }),
      edge({ id: 'bc', from: 'b', to: 'c', highway: 'tertiary', surface: 'asphalt', lengthKm: 1 }),
      edge({ id: 'cd', from: 'c', to: 'd', highway: 'footway', surface: 'asphalt', lengthKm: 1 }),
      edge({ id: 'de', from: 'd', to: 'e', highway: 'secondary', surface: 'asphalt', lengthKm: 1 }),
    ];
    const localGraph = graph(edges);

    const intent = planRouteIntent({
      graph: localGraph,
      terrainAudit: auditTerrainData(edges),
      profile: trailProfile,
      targetDistanceKm: 6,
      targetElevationM: 50,
    });

    expect(intent.strategy).toBe('urban_nature_loop');
    expect(intent.targetComponents).toEqual([]);
    expect(intent.maxPavedRatio).toBeGreaterThanOrEqual(0.7);
    expect(intent.userWarningsIfRelaxed).toContain('Potentiel trail faible : route plutôt nature urbaine que vraie sortie trail.');
  });
});
