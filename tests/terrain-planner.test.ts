import { describe, expect, it } from 'vitest';
import type { EnrichedEdge, EnrichedGraph, GraphNode, SessionProfile } from '../lib/types';
import { auditTerrainData } from '../lib/engine/terrain-audit';
import { extractTerrainComponents, planRouteIntent } from '../lib/engine/terrain-planner';

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
  it('sets adjustable distance policy for recovery park loops', () => {
    const recoveryProfile = {
      ...trailProfile,
      id: 'running_recuperation',
      name: 'Recovery',
      sessionType: 'recuperation',
    } satisfies SessionProfile;
    const edges = [
      edge({ id: 'ab', from: 'a', to: 'b', highway: 'footway', surface: 'asphalt', scenic: true, lengthKm: 1.2 }),
      edge({ id: 'bc', from: 'b', to: 'c', highway: 'path', scenic: true, lengthKm: 1.1 }),
      edge({ id: 'cd', from: 'c', to: 'd', highway: 'footway', surface: 'asphalt', scenic: true, lengthKm: 1.0 }),
      edge({ id: 'de', from: 'd', to: 'e', highway: 'path', scenic: true, lengthKm: 1.0 }),
      edge({ id: 'ef', from: 'e', to: 'f', highway: 'residential', surface: 'asphalt', scenic: true, lengthKm: 0.9 }),
    ];

    const intent = planRouteIntent({
      graph: graph(edges),
      terrainAudit: auditTerrainData(edges),
      profile: recoveryProfile,
      targetDistanceKm: 6,
      targetElevationM: 50,
      scenicMode: true,
    });

    expect(intent.type).toBe('park_loop');
    expect(intent.distancePolicy).toMatchObject({
      mode: 'adjustable',
      reason: 'PARK_RECOVERY_SIZE_LIMIT',
      requestedDistanceKm: 6,
      preferCleanAdjustedOverDirtyExact: true,
    });
    if (intent.distancePolicy.mode !== 'adjustable') throw new Error('expected adjustable policy');
    expect(intent.distancePolicy.minAdjustedDistanceKm).toBeGreaterThanOrEqual(5.1);
    expect(intent.distancePolicy.minAdjustedDistanceKm).toBeLessThanOrEqual(5.2);
    expect(intent.distancePolicy.maxAdjustedDistanceKm).toBe(6);
  });

  it('keeps strict distance policy for trail intents', () => {
    const edges = [
      edge({ id: 'ab', from: 'a', to: 'b', highway: 'path', surface: 'ground', scenic: true, lengthKm: 1.2 }),
      edge({ id: 'bc', from: 'b', to: 'c', highway: 'track', surface: 'unpaved', scenic: true, lengthKm: 1.1 }),
      edge({ id: 'cd', from: 'c', to: 'd', highway: 'path', surface: 'earth', scenic: true, lengthKm: 0.9 }),
    ];

    const intent = planRouteIntent({
      graph: graph(edges),
      terrainAudit: auditTerrainData(edges),
      profile: trailProfile,
      targetDistanceKm: 8,
      targetElevationM: 120,
      scenicMode: true,
    });

    expect(intent.distancePolicy).toEqual({ mode: 'strict' });
  });

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
    expect(intent.maxPavedRatio).toBeLessThanOrEqual(0.65);
    expect(intent.userWarningsIfRelaxed).toContain('Petit parc urbain : boucle courte ou compromis probable, éviter le clean return strict.');
  });

  it('keeps scenic paved recovery parks out of forest-loop logic', () => {
    const recoveryProfile = {
      ...trailProfile,
      id: 'running_recuperation',
      name: 'Recovery',
      sessionType: 'recuperation',
    } satisfies SessionProfile;
    const edges = [
      edge({ id: 'ab', from: 'a', to: 'b', highway: 'footway', surface: 'asphalt', scenic: true, lengthKm: 1.2 }),
      edge({ id: 'bc', from: 'b', to: 'c', highway: 'path', scenic: true, lengthKm: 1.1 }),
      edge({ id: 'cd', from: 'c', to: 'd', highway: 'footway', surface: 'asphalt', scenic: true, lengthKm: 1.0 }),
      edge({ id: 'de', from: 'd', to: 'e', highway: 'path', scenic: true, lengthKm: 1.0 }),
      edge({ id: 'ef', from: 'e', to: 'f', highway: 'residential', surface: 'asphalt', scenic: true, lengthKm: 0.9 }),
    ];
    const localGraph = graph(edges);

    const intent = planRouteIntent({
      graph: localGraph,
      terrainAudit: auditTerrainData(edges),
      profile: recoveryProfile,
      targetDistanceKm: 6,
      targetElevationM: 50,
      scenicMode: true,
    });

    expect(intent.type).toBe('park_loop');
    expect(intent.targetComponents).toEqual([expect.stringContaining('-soft-')]);
    expect(intent.maxPavedRatio).toBe(0.68);
    expect(intent.maxRepeatEdgeRatio).toBe(0.06);
    expect(intent.cleanReturnMode).toBe('fallback_allowed');
    expect(intent.beamBudget.beamWidth).toBeGreaterThanOrEqual(24);
    expect(intent.beamBudget.shortlistSize).toBeGreaterThanOrEqual(24);
    expect(intent.beamBudget.maxIterations).toBeLessThanOrEqual(720);
  });

  it('sets stricter repeat and trail-streak intent for trail smoke cases', () => {
    const edges = [
      edge({ id: 'ab', from: 'a', to: 'b', highway: 'path', surface: 'ground', scenic: true, lengthKm: 1.4 }),
      edge({ id: 'bc', from: 'b', to: 'c', highway: 'track', surface: 'unpaved', scenic: true, lengthKm: 1.3 }),
      edge({ id: 'cd', from: 'c', to: 'd', highway: 'path', surface: 'earth', scenic: true, lengthKm: 1.2 }),
      edge({ id: 'de', from: 'd', to: 'e', highway: 'footway', surface: 'gravel', scenic: true, lengthKm: 1.1 }),
    ];
    const localGraph = graph(edges);

    const intent = planRouteIntent({
      graph: localGraph,
      terrainAudit: auditTerrainData(edges),
      profile: trailProfile,
      targetDistanceKm: 8,
      targetElevationM: 120,
      scenicMode: true,
    });

    expect(intent.type).toBe('forest_loop');
    expect(intent.maxRepeatEdgeRatio).toBeLessThanOrEqual(0.04);
    expect(intent.minNonPavedTrailStreakKm).toBeGreaterThanOrEqual(1.6);
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

  it('extracts a soft park subcomponent from a giant scenic paved component', () => {
    const edges = [
      edge({ id: 'ab', from: 'a', to: 'b', highway: 'footway', surface: 'asphalt', scenic: true, lengthKm: 0.8 }),
      edge({ id: 'bc', from: 'b', to: 'c', highway: 'footway', surface: 'asphalt', scenic: true, lengthKm: 0.8 }),
      edge({ id: 'cd', from: 'c', to: 'd', highway: 'residential', surface: 'asphalt', scenic: true, lengthKm: 0.8 }),
      edge({ id: 'bp1', from: 'b', to: 'p1', highway: 'path', surface: 'ground', scenic: true, lengthKm: 0.35 }),
      edge({ id: 'p1p2', from: 'p1', to: 'p2', highway: 'footway', surface: 'gravel', scenic: true, lengthKm: 0.35 }),
      edge({ id: 'p2b', from: 'p2', to: 'b', highway: 'path', surface: 'ground', scenic: true, lengthKm: 0.35 }),
    ];
    const localGraph = graph(edges);

    const components = extractTerrainComponents(localGraph, auditTerrainData(edges));
    const parent = components.find((component) => component.kind === 'scenic_paved');
    const soft = components.find((component) => component.id.includes('-soft-'));

    expect(parent).toBeDefined();
    expect(soft).toBeDefined();
    expect(soft?.kind).toMatch(/park|trail_cluster/);
    expect(soft?.pavedKm).toBe(0);
    expect(soft?.nonPavedKm).toBeGreaterThan(0.6);
  });

  it('targets extracted soft park for recovery urban nature instead of leaving target components empty', () => {
    const recoveryProfile = {
      ...trailProfile,
      id: 'running_recuperation',
      name: 'Recovery',
      sessionType: 'recuperation',
    } satisfies SessionProfile;
    const edges = [
      edge({ id: 'ab', from: 'a', to: 'b', highway: 'footway', surface: 'asphalt', scenic: true, lengthKm: 0.8 }),
      edge({ id: 'bc', from: 'b', to: 'c', highway: 'footway', surface: 'asphalt', scenic: true, lengthKm: 0.8 }),
      edge({ id: 'cd', from: 'c', to: 'd', highway: 'residential', surface: 'asphalt', scenic: true, lengthKm: 0.8 }),
      edge({ id: 'bp1', from: 'b', to: 'p1', highway: 'path', surface: 'ground', scenic: true, lengthKm: 0.35 }),
      edge({ id: 'p1p2', from: 'p1', to: 'p2', highway: 'footway', surface: 'gravel', scenic: true, lengthKm: 0.35 }),
      edge({ id: 'p2b', from: 'p2', to: 'b', highway: 'path', surface: 'ground', scenic: true, lengthKm: 0.35 }),
    ];
    const localGraph = graph(edges);

    const intent = planRouteIntent({
      graph: localGraph,
      terrainAudit: auditTerrainData(edges),
      profile: recoveryProfile,
      targetDistanceKm: 6,
      targetElevationM: 50,
      scenicMode: true,
    });
    const target = intent.terrainComponents.find((component) => component.id === intent.targetComponents[0]);

    expect(intent.type).toBe('park_loop');
    expect(intent.targetComponents).toEqual([expect.stringContaining('-soft-')]);
    expect(target?.pavedKm).toBe(0);
    expect(target?.pavedKm ?? 1 / Math.max(target?.totalKm ?? 0, 0.1)).toBeLessThanOrEqual(0.55);
  });

  it('does not classify scenic asphalt footways as soft subcomponents', () => {
    const recoveryProfile = {
      ...trailProfile,
      id: 'running_recuperation',
      name: 'Recovery',
      sessionType: 'recuperation',
    } satisfies SessionProfile;
    const edges = [
      edge({ id: 'ab', from: 'a', to: 'b', highway: 'footway', surface: 'asphalt', scenic: true, lengthKm: 0.5 }),
      edge({ id: 'bc', from: 'b', to: 'c', highway: 'path', surface: 'concrete', scenic: true, lengthKm: 0.5 }),
      edge({ id: 'cd', from: 'c', to: 'd', highway: 'footway', surface: 'paved', scenic: true, lengthKm: 0.5 }),
    ];
    const localGraph = graph(edges);

    const components = extractTerrainComponents(localGraph, auditTerrainData(edges));
    const intent = planRouteIntent({
      graph: localGraph,
      terrainAudit: auditTerrainData(edges),
      profile: recoveryProfile,
      targetDistanceKm: 6,
      targetElevationM: 50,
      scenicMode: true,
    });

    expect(components.some((component) => component.id.includes('-soft-'))).toBe(false);
    expect(components[0].kind).toBe('scenic_paved');
    expect(components[0].nonPavedKm).toBe(0);
    expect(intent.targetComponents).toEqual([]);
  });

  it('keeps unknown path soft-like without counting it as non-paved', () => {
    const edges = [
      edge({ id: 'ab', from: 'a', to: 'b', highway: 'footway', surface: 'asphalt', scenic: true, lengthKm: 0.8 }),
      edge({ id: 'bc', from: 'b', to: 'c', highway: 'footway', surface: 'asphalt', scenic: true, lengthKm: 0.8 }),
      edge({ id: 'bp1', from: 'b', to: 'p1', highway: 'path', scenic: true, lengthKm: 0.4 }),
      edge({ id: 'p1p2', from: 'p1', to: 'p2', highway: 'footway', scenic: true, lengthKm: 0.4 }),
    ];
    const localGraph = graph(edges);

    const components = extractTerrainComponents(localGraph, auditTerrainData(edges));
    const soft = components.find((component) => component.id.includes('-soft-'));

    expect(soft).toBeDefined();
    expect(soft?.unknownSurfaceKm).toBeGreaterThan(0.7);
    expect(soft?.nonPavedKm).toBe(0);
  });

  it('selects a forest candidate when the largest component is a scenic paved parent', () => {
    const edges = [
      edge({ id: 'road-ab', from: 'a', to: 'b', highway: 'footway', surface: 'asphalt', scenic: true, lengthKm: 1.2 }),
      edge({ id: 'road-bc', from: 'b', to: 'c', highway: 'footway', surface: 'asphalt', scenic: true, lengthKm: 1.1 }),
      edge({ id: 'road-cd', from: 'c', to: 'd', highway: 'residential', surface: 'asphalt', scenic: true, lengthKm: 1.0 }),
      edge({ id: 'wood-xy', from: 'x', to: 'y', highway: 'path', surface: 'ground', scenic: true, lengthKm: 0.8 }),
      edge({ id: 'wood-yz', from: 'y', to: 'z', highway: 'track', surface: 'earth', scenic: true, lengthKm: 0.8 }),
      edge({ id: 'wood-zw', from: 'z', to: 'w', highway: 'footway', surface: 'gravel', scenic: true, lengthKm: 0.7 }),
    ];
    const localGraph = graph(edges, {
      a: { lat: 49, lng: -0.5 },
      b: { lat: 49.001, lng: -0.5 },
      c: { lat: 49.002, lng: -0.5 },
      d: { lat: 49.003, lng: -0.5 },
      x: { lat: 49.01, lng: -0.5 },
      y: { lat: 49.011, lng: -0.501 },
      z: { lat: 49.012, lng: -0.502 },
      w: { lat: 49.013, lng: -0.503 },
    });

    const intent = planRouteIntent({
      graph: localGraph,
      terrainAudit: auditTerrainData(edges),
      profile: trailProfile,
      targetDistanceKm: 10,
      targetElevationM: 120,
      scenicMode: true,
    });
    const target = intent.terrainComponents.find((component) => component.id === intent.targetComponents[0]);

    expect(intent.type).toBe('transition_to_woods');
    expect(target?.kind).toMatch(/forest|trail_cluster|unknown_natural/);
    expect(target?.kind).not.toBe('scenic_paved');
  });

  it('targets extracted soft trail subcomponent instead of the paved-heavy forest parent for trail intent', () => {
    const edges = [
      edge({ id: 'road-ab', from: 'a', to: 'b', highway: 'footway', surface: 'asphalt', scenic: true, lengthKm: 1.2 }),
      edge({ id: 'road-bc', from: 'b', to: 'c', highway: 'footway', surface: 'asphalt', scenic: true, lengthKm: 1.0 }),
      edge({ id: 'road-cd', from: 'c', to: 'd', highway: 'residential', surface: 'asphalt', scenic: true, lengthKm: 0.8 }),
      edge({ id: 'b-wood-a', from: 'b', to: 'wood-a', highway: 'path', surface: 'ground', scenic: true, lengthKm: 0.7 }),
      edge({ id: 'wood-a-wood-b', from: 'wood-a', to: 'wood-b', highway: 'track', surface: 'earth', scenic: true, lengthKm: 0.7 }),
      edge({ id: 'wood-b-wood-c', from: 'wood-b', to: 'wood-c', highway: 'footway', surface: 'gravel', scenic: true, lengthKm: 0.7 }),
      edge({ id: 'wood-c-b', from: 'wood-c', to: 'b', highway: 'path', surface: 'ground', scenic: true, lengthKm: 0.3 }),
    ];
    const localGraph = graph(edges, {
      a: { lat: 49, lng: -0.5 },
      b: { lat: 49.001, lng: -0.5 },
      c: { lat: 49.002, lng: -0.5 },
      d: { lat: 49.003, lng: -0.5 },
      'wood-a': { lat: 49.010, lng: -0.5 },
      'wood-b': { lat: 49.011, lng: -0.501 },
      'wood-c': { lat: 49.012, lng: -0.502 },
    });

    const intent = planRouteIntent({
      graph: localGraph,
      terrainAudit: auditTerrainData(edges),
      profile: trailProfile,
      targetDistanceKm: 8,
      targetElevationM: 120,
      scenicMode: true,
    });
    const target = intent.terrainComponents.find((component) => component.id === intent.targetComponents[0]);

    expect(intent.type).toBe('transition_to_woods');
    expect(intent.targetComponents).toEqual([expect.stringContaining('-soft-')]);
    expect(target?.pavedKm).toBe(0);
    expect(target?.nonPavedKm).toBeGreaterThanOrEqual(1.2);
  });

  it('keeps short transition-to-woods trail intent honest but not stricter than the 8k beta gate', () => {
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

    const shortIntent = planRouteIntent({
      graph: localGraph,
      terrainAudit: auditTerrainData(edges),
      profile: trailProfile,
      targetDistanceKm: 8,
      targetElevationM: 120,
      scenicMode: true,
    });
    const longIntent = planRouteIntent({
      graph: localGraph,
      terrainAudit: auditTerrainData(edges),
      profile: trailProfile,
      targetDistanceKm: 12,
      targetElevationM: 150,
      scenicMode: true,
    });

    expect(shortIntent.type).toBe('transition_to_woods');
    expect(shortIntent.maxPavedRatio).toBe(0.48);
    expect(longIntent.maxPavedRatio).toBe(0.42);
  });

});
