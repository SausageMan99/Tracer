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

function graph(edges: EnrichedEdge[], coords: Record<string, { lat: number; lng: number }> = {}): EnrichedGraph {
  const nodes = new Map<string, GraphNode>();
  for (const current of edges) {
    if (!nodes.has(current.from)) nodes.set(current.from, node(current.from, 49, -0.5));
    if (!nodes.has(current.to)) nodes.set(current.to, node(current.to, 49, -0.5));
    nodes.get(current.from)?.edges.push(current.id);
    nodes.get(current.to)?.edges.push(current.id);
  }

  let i = 0;
  for (const current of nodes.values()) {
    const override = coords[current.id];
    current.lat = override?.lat ?? 49 + i * 0.001;
    current.lng = override?.lng ?? -0.5 - i * 0.001;
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
  it('selects forest_loop with explicit target component on rich connected forest terrain', () => {
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

    expect(intent.type).toBe('forest_loop');
    expect(intent.strategy).toBe('forest_loop');
    expect(intent.targetComponents).toHaveLength(1);
    expect(intent.minNaturalZoneDwellKm).toBeGreaterThanOrEqual(3);
    expect(intent.maxPavedRatio).toBeLessThanOrEqual(0.45);
    expect(intent.cleanReturnMode).toBe('prefer');
    expect(intent.beamBudget.shortlistSize).toBeGreaterThan(12);
  });

  it('selects transition_to_woods when a residential start has a sizeable nearby massif', () => {
    const edges = [
      edge({ id: 'home-road', from: 'home', to: 'gate', highway: 'residential', surface: 'asphalt', lengthKm: 0.8 }),
      edge({ id: 'gate-a', from: 'gate', to: 'a', highway: 'path', surface: 'ground', scenic: true, lengthKm: 0.8 }),
      edge({ id: 'ab', from: 'a', to: 'b', highway: 'path', surface: 'earth', scenic: true, lengthKm: 1.2 }),
      edge({ id: 'bc', from: 'b', to: 'c', highway: 'track', surface: 'unpaved', scenic: true, lengthKm: 1.1 }),
      edge({ id: 'cd', from: 'c', to: 'd', highway: 'footway', surface: 'gravel', scenic: true, lengthKm: 0.9 }),
    ];
    const localGraph = graph(edges, {
      home: { lat: 49, lng: -0.5 },
      gate: { lat: 49.006, lng: -0.5 },
      a: { lat: 49.010, lng: -0.5 },
      b: { lat: 49.011, lng: -0.501 },
      c: { lat: 49.012, lng: -0.502 },
      d: { lat: 49.013, lng: -0.503 },
    });

    const intent = planRouteIntent({
      graph: localGraph,
      terrainAudit: auditTerrainData(edges),
      profile: trailProfile,
      targetDistanceKm: 10,
      targetElevationM: 140,
      scenicMode: true,
    });

    expect(intent.type).toBe('transition_to_woods');
    expect(intent.targetComponents).toEqual([expect.any(String)]);
    expect(intent.terrainComponents[0].distanceFromStartKm).toBeGreaterThan(0.45);
    expect(intent.userWarningsIfRelaxed).toContain('Massif naturel détecté hors du départ : accepter une section d’accès puis rester dans les bois.');
  });

  it('selects park_loop for a small urban park instead of forcing forest logic', () => {
    const edges = [
      edge({ id: 'ab', from: 'a', to: 'b', highway: 'footway', surface: 'gravel', scenic: true, lengthKm: 0.35 }),
      edge({ id: 'bc', from: 'b', to: 'c', highway: 'path', surface: 'ground', scenic: true, lengthKm: 0.4 }),
      edge({ id: 'cd', from: 'c', to: 'd', highway: 'footway', surface: 'asphalt', scenic: true, lengthKm: 0.35 }),
      edge({ id: 'de', from: 'd', to: 'e', highway: 'residential', surface: 'asphalt', lengthKm: 1.2 }),
      edge({ id: 'ef', from: 'e', to: 'f', highway: 'tertiary', surface: 'asphalt', lengthKm: 1.1 }),
    ];
    const localGraph = graph(edges);

    const intent = planRouteIntent({
      graph: localGraph,
      terrainAudit: auditTerrainData(edges),
      profile: trailProfile,
      targetDistanceKm: 6,
      targetElevationM: 50,
    });

    expect(intent.type).toBe('park_loop');
    expect(intent.cleanReturnMode).toBe('fallback_allowed');
    expect(intent.maxPavedRatio).toBeGreaterThanOrEqual(0.65);
    expect(intent.userWarningsIfRelaxed).toContain('Petit parc urbain : boucle courte ou compromis probable, éviter le clean return strict.');
  });

  it('selects urban_nature_loop on mixed scenic corridors without enough forest mass', () => {
    const edges = [
      edge({ id: 'ab', from: 'a', to: 'b', highway: 'footway', surface: 'asphalt', scenic: true, lengthKm: 0.9 }),
      edge({ id: 'bc', from: 'b', to: 'c', highway: 'residential', surface: 'asphalt', scenic: true, lengthKm: 0.8 }),
      edge({ id: 'cd', from: 'c', to: 'd', highway: 'tertiary', surface: 'asphalt', lengthKm: 0.8 }),
      edge({ id: 'de', from: 'd', to: 'e', highway: 'cycleway', surface: 'asphalt', scenic: true, lengthKm: 0.7 }),
    ];
    const localGraph = graph(edges);

    const intent = planRouteIntent({
      graph: localGraph,
      terrainAudit: auditTerrainData(edges),
      profile: trailProfile,
      targetDistanceKm: 8,
      targetElevationM: 70,
      scenicMode: true,
    });

    expect(intent.type).toBe('urban_nature_loop');
    expect(intent.targetComponents).toEqual([]);
    expect(intent.userWarningsIfRelaxed).toContain('Terrain mixte : route plutôt nature urbaine que vrai trail continu.');
  });

  it('selects low_trail_potential on asphalt-heavy terrain with no useful nature signal', () => {
    const edges = [
      edge({ id: 'ab', from: 'a', to: 'b', highway: 'residential', surface: 'asphalt', lengthKm: 1 }),
      edge({ id: 'bc', from: 'b', to: 'c', highway: 'tertiary', surface: 'asphalt', lengthKm: 1 }),
      edge({ id: 'cd', from: 'c', to: 'd', highway: 'secondary', surface: 'asphalt', lengthKm: 1 }),
      edge({ id: 'de', from: 'd', to: 'e', highway: 'residential', surface: 'concrete', lengthKm: 1 }),
    ];
    const localGraph = graph(edges);

    const intent = planRouteIntent({
      graph: localGraph,
      terrainAudit: auditTerrainData(edges),
      profile: trailProfile,
      targetDistanceKm: 6,
      targetElevationM: 50,
    });

    expect(intent.type).toBe('low_trail_potential');
    expect(intent.targetComponents).toEqual([]);
    expect(intent.userWarningsIfRelaxed).toContain('Potentiel trail faible : refuser ou relaxer explicitement la promesse terrain.');
  });
});
