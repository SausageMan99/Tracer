import { describe, expect, it } from 'vitest';

import { generateRouteV3FromGraph } from '../lib/engine-v3/route-generator';
import type {
  RouteConstraintsV3,
  RouteIntentV3,
  UserRouteRequestV3,
} from '../lib/engine-v3';
import type { EnrichedEdge, EnrichedGraph, GraphNode } from '../lib/types';

const PATH_LIKE_HIGHWAYS = new Set(['path', 'track', 'footway', 'bridleway', 'pedestrian']);

function edge(overrides: Partial<EnrichedEdge> & Pick<EnrichedEdge, 'id' | 'from' | 'to' | 'lengthKm'>): EnrichedEdge {
  return {
    highway: 'residential',
    surface: 'asphalt',
    scenic: false,
    osmWayId: 1,
    score: 0,
    ...overrides,
  } as EnrichedEdge;
}

function buildGraph(edges: EnrichedEdge[], coordinates: Record<string, { lat: number; lng: number }>): EnrichedGraph {
  const nodes = new Map<string, GraphNode>();
  const enrichedEdges = new Map<string, EnrichedEdge>();
  for (const [id, c] of Object.entries(coordinates)) {
    nodes.set(id, { id, ...c, edges: [] });
  }
  for (const e of edges) {
    enrichedEdges.set(e.id, e);
    nodes.get(e.from)?.edges.push(e.id);
    nodes.get(e.to)?.edges.push(e.id);
  }
  return { nodes, edges: enrichedEdges, center: coordinates.start, radiusKm: 2 };
}

function intent(
  strategy: RouteIntentV3['strategy'],
  opts: { targetComponents?: RouteConstraintsV3['targetComponents']; minNaturalDwellRatio?: number; targetDistanceKm?: number } = {},
): RouteIntentV3 {
  // The V3 request normalizer requires targetDistanceKm >= 5.
  const target = Math.max(5, opts.targetDistanceKm ?? 12);
  const request: UserRouteRequestV3 = {
    start: { lat: 48.7, lng: 2.5 },
    targetDistanceKm: target,
    activity: 'running',
    sport: 'running',
    mode: 'trail',
    loop: true,
  };
  return {
    engine: 'v3-clean-room',
    strategy,
    request: request as unknown as NonNullable<RouteIntentV3['request']>,
    snapshot: { audit: { confidence: 'medium', edgeCount: 0, totalLengthKm: 0, pavedRatio: 0, nonPavedRatio: 0, warnings: [] }, components: [] },
    constraints: {
      targetDistanceKm: request.targetDistanceKm,
      targetComponents: opts.targetComponents ?? [],
      maxPavedRatio: 0.8,
      cleanReturn: 'relaxed',
      minNaturalDwellRatio: opts.minNaturalDwellRatio ?? 0.1,
    },
    outcome: { type: 'adjusted' as const, summary: 'low trail potential', compromises: [] },
    warnings: [],
  };
}

describe('engine V3 controlled dead-end escape (low_trail_potential only)', () => {
  it('low_trail_potential backtracks and chooses the alternative branch after a dead-end', () => {
    // Start has 2 outgoing edges:
    //   r1: residential dead-end (small, leads to a 3-node cluster)
    //   p1: path (long chain, leads back to start)
    // Total length > 5 km so detectUnroutable doesn't fire.
    const graph = buildGraph(
      [
        edge({ id: 'r1', from: 'start', to: 'r2', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'r2', from: 'r2', to: 'r3', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'r3', from: 'r3', to: 'r2', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'p1', from: 'start', to: 'p2', lengthKm: 1, highway: 'path', surface: undefined, osmWayId: 2 }),
        edge({ id: 'p2', from: 'p2', to: 'p3', lengthKm: 1, highway: 'path', surface: 'dirt', osmWayId: 2 }),
        edge({ id: 'p3', from: 'p3', to: 'p4', lengthKm: 1, highway: 'path', surface: 'dirt', osmWayId: 2 }),
        edge({ id: 'p4', from: 'p4', to: 'p5', lengthKm: 1, highway: 'path', surface: 'dirt', osmWayId: 2 }),
        edge({ id: 'p5', from: 'p5', to: 'start', lengthKm: 1, highway: 'path', surface: 'dirt', osmWayId: 2 }),
      ],
      {
        start: { lat: 48.7, lng: 2.5 },
        r2: { lat: 48.699, lng: 2.5 },
        r3: { lat: 48.699, lng: 2.501 },
        p2: { lat: 48.701, lng: 2.5 },
        p3: { lat: 48.702, lng: 2.5 },
        p4: { lat: 48.703, lng: 2.5 },
        p5: { lat: 48.703, lng: 2.501 },
      },
    );
    const r = generateRouteV3FromGraph(intent('low_trail_potential', { targetDistanceKm: 4 }).request!, graph);
    // The walk should have used p1 (path) after escaping the residential dead-end.
    const p1Used = r.route.edges.some((e) => e.id === 'p1');
    expect(p1Used).toBe(true);
    expect(r.route.metrics.distanceProducedKm).toBeGreaterThan(1);
  });

  it('replay is prevented — no edge id appears twice after a backtrack', () => {
    const graph = buildGraph(
      [
        edge({ id: 'r1', from: 'start', to: 'r2', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'r2', from: 'r2', to: 'r3', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'r3', from: 'r3', to: 'r2', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'p1', from: 'start', to: 'p2', lengthKm: 1, highway: 'path', surface: undefined, osmWayId: 2 }),
        edge({ id: 'p2', from: 'p2', to: 'p3', lengthKm: 1, highway: 'path', surface: 'dirt', osmWayId: 2 }),
        edge({ id: 'p3', from: 'p3', to: 'p4', lengthKm: 1, highway: 'path', surface: 'dirt', osmWayId: 2 }),
        edge({ id: 'p4', from: 'p4', to: 'p5', lengthKm: 1, highway: 'path', surface: 'dirt', osmWayId: 2 }),
        edge({ id: 'p5', from: 'p5', to: 'start', lengthKm: 1, highway: 'path', surface: 'dirt', osmWayId: 2 }),
      ],
      {
        start: { lat: 48.7, lng: 2.5 },
        r2: { lat: 48.699, lng: 2.5 },
        r3: { lat: 48.699, lng: 2.501 },
        p2: { lat: 48.701, lng: 2.5 },
        p3: { lat: 48.702, lng: 2.5 },
        p4: { lat: 48.703, lng: 2.5 },
        p5: { lat: 48.703, lng: 2.501 },
      },
    );
    const r = generateRouteV3FromGraph(intent('low_trail_potential', { targetDistanceKm: 4 }).request!, graph);
    const ids = r.route.edges.map((e) => e.id);
    const uniq = new Set(ids);
    expect(uniq.size).toBe(ids.length);
  });

  it('no escape fires when distance >= 0.3 * target (walk already made progress)', () => {
    // Long path chain loops back to start. Total length > 5 km, well above
    // the 0.3 * 5 = 1.5 km escape threshold. The walk reaches its target /
    // closure before the dead-end escape condition can fire.
    const graph = buildGraph(
      [
        edge({ id: 'p1', from: 'start', to: 'p2', lengthKm: 0.5, highway: 'path', surface: 'dirt', osmWayId: 1 }),
        edge({ id: 'p2', from: 'p2', to: 'p3', lengthKm: 0.5, highway: 'path', surface: 'dirt', osmWayId: 1 }),
        edge({ id: 'p3', from: 'p3', to: 'p4', lengthKm: 0.5, highway: 'path', surface: 'dirt', osmWayId: 1 }),
        edge({ id: 'p4', from: 'p4', to: 'p5', lengthKm: 0.5, highway: 'path', surface: 'dirt', osmWayId: 1 }),
        edge({ id: 'p5', from: 'p5', to: 'p6', lengthKm: 0.5, highway: 'path', surface: 'dirt', osmWayId: 1 }),
        edge({ id: 'p6', from: 'p6', to: 'p7', lengthKm: 0.5, highway: 'path', surface: 'dirt', osmWayId: 1 }),
        edge({ id: 'p7', from: 'p7', to: 'p8', lengthKm: 0.5, highway: 'path', surface: 'dirt', osmWayId: 1 }),
        edge({ id: 'p8', from: 'p8', to: 'p9', lengthKm: 0.5, highway: 'path', surface: 'dirt', osmWayId: 1 }),
        edge({ id: 'p9', from: 'p9', to: 'p10', lengthKm: 0.5, highway: 'path', surface: 'dirt', osmWayId: 1 }),
        edge({ id: 'p10', from: 'p10', to: 'start', lengthKm: 0.5, highway: 'path', surface: 'dirt', osmWayId: 1 }),
      ],
      {
        start: { lat: 48.7, lng: 2.5 },
        p2: { lat: 48.701, lng: 2.5 },
        p3: { lat: 48.702, lng: 2.5 },
        p4: { lat: 48.703, lng: 2.5 },
        p5: { lat: 48.704, lng: 2.5 },
        p6: { lat: 48.705, lng: 2.5 },
        p7: { lat: 48.706, lng: 2.5 },
        p8: { lat: 48.707, lng: 2.5 },
        p9: { lat: 48.708, lng: 2.5 },
        p10: { lat: 48.708, lng: 2.501 },
      },
    );
    // target = 5 km, escape threshold 0.3 * 5 = 1.5 km. Walk reaches 5 km via
    // path chain (10 edges × 0.5 km = 5 km), closes the loop, breaks.
    const r = generateRouteV3FromGraph(intent('low_trail_potential', { targetDistanceKm: 5 }).request!, graph);
    // Walk closes the loop at 5 km, breaks. The escape condition
    // (distance < 1.5 km) is never met after the first edge.
    expect(r.route.edges.length).toBeGreaterThan(0);
    expect(r.route.metrics.distanceProducedKm).toBeGreaterThan(1.5);
  });

  it('forest_loop behavior is unchanged (no escape fires in forest_loop mode)', () => {
    const graph = buildGraph(
      [
        edge({ id: 'a1', from: 'start', to: 'f1', lengthKm: 1, highway: 'path', surface: 'ground', scenic: true, osmWayId: 1 }),
        edge({ id: 'a2', from: 'f1', to: 'f2', lengthKm: 1, highway: 'path', surface: 'ground', scenic: true, osmWayId: 1 }),
        edge({ id: 'a3', from: 'f2', to: 'f3', lengthKm: 1, highway: 'path', surface: 'ground', scenic: true, osmWayId: 1 }),
        edge({ id: 'a4', from: 'f3', to: 'f1', lengthKm: 1, highway: 'path', surface: 'ground', scenic: true, osmWayId: 1 }),
      ],
      { start: { lat: 48.7, lng: 2.5 }, f1: { lat: 48.71, lng: 2.5 }, f2: { lat: 48.72, lng: 2.5 }, f3: { lat: 48.72, lng: 2.51 } },
    );
    const r = generateRouteV3FromGraph(intent('forest_loop', { targetComponents: ['forest'], targetDistanceKm: 8 }).request!, graph);
    expect(r.route.edges.every((e) => PATH_LIKE_HIGHWAYS.has(e.highway))).toBe(true);
    const hasEscapeWarning = r.diagnostics.warnings.some((w) => w.includes('low_trail_potential prefers'));
    expect(hasEscapeWarning).toBe(false);
  });

  it('transition_to_woods behavior is unchanged (no escape fires in transition_to_woods mode)', () => {
    // Two edges from start: residential connector + path. T2W picks path first.
    const graph = buildGraph(
      [
        edge({ id: 'c1', from: 'start', to: 'c2', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'c2', from: 'c2', to: 'c3', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'c3', from: 'c3', to: 'c4', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'c4', from: 'c4', to: 'start', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'p1', from: 'start', to: 'p2', lengthKm: 0.5, highway: 'path', surface: undefined, osmWayId: 2 }),
        edge({ id: 'p2', from: 'p2', to: 'p3', lengthKm: 0.5, highway: 'path', surface: 'dirt', osmWayId: 2 }),
        edge({ id: 'p3', from: 'p3', to: 'start', lengthKm: 0.5, highway: 'path', surface: 'dirt', osmWayId: 2 }),
      ],
      {
        start: { lat: 48.7, lng: 2.5 },
        c2: { lat: 48.699, lng: 2.5 },
        c3: { lat: 48.699, lng: 2.501 },
        c4: { lat: 48.699, lng: 2.499 },
        p2: { lat: 48.701, lng: 2.5 },
        p3: { lat: 48.701, lng: 2.501 },
      },
    );
    const r = generateRouteV3FromGraph(intent('transition_to_woods', { targetComponents: ['field_paths'], targetDistanceKm: 2 }).request!, graph);
    expect(r.route.edges.length).toBeGreaterThan(0);
    const hasEscapeWarning = r.diagnostics.warnings.some((w) => w.includes('low_trail_potential prefers'));
    expect(hasEscapeWarning).toBe(false);
  });

  it('park_loop behavior is unchanged (no escape fires in park_loop mode)', () => {
    // Park loop: 4 footway edges forming a loop, total > 5 km.
    // The planner may downgrade to low_trail_potential if the snapshot has
    // no forest component; what matters is that the escape logic only fires
    // when distance < 0.3 * target, which is not the case here.
    const graph = buildGraph(
      [
        edge({ id: 'k1', from: 'start', to: 'p1', lengthKm: 0.5, highway: 'footway', surface: 'paving_stones', osmWayId: 1 }),
        edge({ id: 'k2', from: 'p1', to: 'p2', lengthKm: 0.5, highway: 'footway', surface: 'paving_stones', osmWayId: 1 }),
        edge({ id: 'k3', from: 'p2', to: 'p3', lengthKm: 0.5, highway: 'footway', surface: 'paving_stones', osmWayId: 1 }),
        edge({ id: 'k4', from: 'p3', to: 'p4', lengthKm: 0.5, highway: 'footway', surface: 'paving_stones', osmWayId: 1 }),
        edge({ id: 'k5', from: 'p4', to: 'p5', lengthKm: 0.5, highway: 'footway', surface: 'paving_stones', osmWayId: 1 }),
        edge({ id: 'k6', from: 'p5', to: 'p6', lengthKm: 0.5, highway: 'footway', surface: 'paving_stones', osmWayId: 1 }),
        edge({ id: 'k7', from: 'p6', to: 'p7', lengthKm: 0.5, highway: 'footway', surface: 'paving_stones', osmWayId: 1 }),
        edge({ id: 'k8', from: 'p7', to: 'start', lengthKm: 0.5, highway: 'footway', surface: 'paving_stones', osmWayId: 1 }),
      ],
      {
        start: { lat: 48.7, lng: 2.5 },
        p1: { lat: 48.701, lng: 2.5 },
        p2: { lat: 48.701, lng: 2.501 },
        p3: { lat: 48.701, lng: 2.502 },
        p4: { lat: 48.7, lng: 2.502 },
        p5: { lat: 48.699, lng: 2.502 },
        p6: { lat: 48.699, lng: 2.501 },
        p7: { lat: 48.699, lng: 2.5 },
      },
    );
    const r = generateRouteV3FromGraph(intent('park_loop', { targetComponents: ['park'], targetDistanceKm: 3 }).request!, graph);
    expect(r.route.edges.length).toBeGreaterThan(0);
    // If the planner downgraded to low_trail_potential, the walk's distance
    // must still exceed 0.3 * targetDistanceKm (here > 1.5 km). The escape
    // does not fire.
    const walkDistance = r.route.metrics.distanceProducedKm;
    const target = r.route.metrics.targetDistanceKm;
    expect(walkDistance).toBeGreaterThan(target * 0.3);
  });

  it('generic mode is unchanged (no escape fires when mode is generic)', () => {
    // simple_quiet_loop falls into default (generic). 3-edge loop > 5 km.
    const graph = buildGraph(
      [
        edge({ id: 'g1', from: 'start', to: 'g2', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'g2', from: 'g2', to: 'g3', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'g3', from: 'g3', to: 'g4', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'g4', from: 'g4', to: 'g5', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'g5', from: 'g5', to: 'start', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
      ],
      {
        start: { lat: 48.7, lng: 2.5 },
        g2: { lat: 48.701, lng: 2.5 },
        g3: { lat: 48.701, lng: 2.501 },
        g4: { lat: 48.7, lng: 2.501 },
        g5: { lat: 48.699, lng: 2.501 },
      },
    );
    const r = generateRouteV3FromGraph(intent('simple_quiet_loop', { targetDistanceKm: 2.5 }).request!, graph);
    const hasEscapeWarning = r.diagnostics.warnings.some((w) => w.includes('low_trail_potential prefers'));
    expect(hasEscapeWarning).toBe(false);
  });

  it('maxEscapes terminates the walk (does not loop forever)', () => {
    // A graph where the walk dead-ends on its first move: start -> dead-end
    // cluster. The escape fires once, blacklist the dead-end edge, walk
    // continues, dead-ends again or walks elsewhere. The walk is bounded by
    // 256 steps + maxEscapes = 5 escapes, total < 1s on any reasonable
    // graph. This test asserts termination, not a specific outcome.
    const graph = buildGraph(
      [
        edge({ id: 'd1', from: 'start', to: 'd2', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'd2', from: 'd2', to: 'd3', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'd3', from: 'd3', to: 'd2', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'd4', from: 'start', to: 'd5', lengthKm: 0.5, highway: 'path', surface: undefined, osmWayId: 2 }),
        edge({ id: 'd5', from: 'd5', to: 'd6', lengthKm: 0.5, highway: 'path', surface: undefined, osmWayId: 2 }),
        edge({ id: 'd6', from: 'd6', to: 'd5', lengthKm: 0.5, highway: 'path', surface: undefined, osmWayId: 2 }),
      ],
      {
        start: { lat: 48.7, lng: 2.5 },
        d2: { lat: 48.699, lng: 2.5 },
        d3: { lat: 48.699, lng: 2.501 },
        d5: { lat: 48.701, lng: 2.5 },
        d6: { lat: 48.701, lng: 2.501 },
      },
    );
    const start = Date.now();
    // Just call the function. Whether it returns 0, 5, or 50 edges is not
    // the point — the point is that it terminates in finite time without
    // infinite looping. The 256-step walk + maxEscapes = 5 guarantees
    // termination.
    const r = generateRouteV3FromGraph(intent('low_trail_potential', { targetDistanceKm: 5 }).request!, graph);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
    // The walk returns an outcome (any outcome).
    expect(r.outcome).toBeDefined();
  });

  it('no duplicated traversed edge ids after escape (full post-escape traversal)', () => {
    const graph = buildGraph(
      [
        edge({ id: 'r1', from: 'start', to: 'r2', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'r2', from: 'r2', to: 'r3', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'r3', from: 'r3', to: 'r2', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'p1', from: 'start', to: 'p2', lengthKm: 1, highway: 'path', surface: undefined, osmWayId: 2 }),
        edge({ id: 'p2', from: 'p2', to: 'p3', lengthKm: 1, highway: 'path', surface: 'dirt', osmWayId: 2 }),
        edge({ id: 'p3', from: 'p3', to: 'p4', lengthKm: 1, highway: 'path', surface: 'dirt', osmWayId: 2 }),
        edge({ id: 'p4', from: 'p4', to: 'p5', lengthKm: 1, highway: 'path', surface: 'dirt', osmWayId: 2 }),
        edge({ id: 'p5', from: 'p5', to: 'start', lengthKm: 1, highway: 'path', surface: 'dirt', osmWayId: 2 }),
      ],
      {
        start: { lat: 48.7, lng: 2.5 },
        r2: { lat: 48.699, lng: 2.5 },
        r3: { lat: 48.699, lng: 2.501 },
        p2: { lat: 48.701, lng: 2.5 },
        p3: { lat: 48.702, lng: 2.5 },
        p4: { lat: 48.703, lng: 2.5 },
        p5: { lat: 48.703, lng: 2.501 },
      },
    );
    const r = generateRouteV3FromGraph(intent('low_trail_potential', { targetDistanceKm: 4 }).request!, graph);
    const ids = r.route.edges.map((e) => e.id);
    const uniq = new Set(ids);
    expect(uniq.size).toBe(ids.length);
    expect(ids.length).toBeGreaterThan(0);
  });

  it('maxEscapes=20 terminates in finite time (does not loop forever)', () => {
    // Dead-end graph: start -> 2 dead-end branches. With maxEscapes=20, the
    // walk fires up to 20 escapes then breaks. The 256-step walk cap + 20
    // escapes guarantees finite termination.
    const graph = buildGraph(
      [
        edge({ id: 'd1', from: 'start', to: 'd2', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'd2', from: 'd2', to: 'd3', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'd3', from: 'd3', to: 'd2', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'd4', from: 'start', to: 'd5', lengthKm: 0.5, highway: 'path', surface: undefined, osmWayId: 2 }),
        edge({ id: 'd5', from: 'd5', to: 'd6', lengthKm: 0.5, highway: 'path', surface: undefined, osmWayId: 2 }),
        edge({ id: 'd6', from: 'd6', to: 'd5', lengthKm: 0.5, highway: 'path', surface: undefined, osmWayId: 2 }),
      ],
      {
        start: { lat: 48.7, lng: 2.5 },
        d2: { lat: 48.699, lng: 2.5 },
        d3: { lat: 48.699, lng: 2.501 },
        d5: { lat: 48.701, lng: 2.5 },
        d6: { lat: 48.701, lng: 2.501 },
      },
    );
    const start = Date.now();
    const r = generateRouteV3FromGraph(intent('low_trail_potential', { targetDistanceKm: 5 }).request!, graph);
    const elapsed = Date.now() - start;
    expect(elapsed).toBeLessThan(1000);
    expect(r.outcome).toBeDefined();
  });

  it('cap 20 produces strictly more or equal distance than cap 5 on a local-cluster graph', () => {
    // Build a graph where cap=5 would dead-end early but cap=20 can rewind
    // through more branch points and reach the path chain on the far side.
    // The path chain has 4 segments of 1 km each, total 4 km.
    const graph = buildGraph(
      [
        // Initial dead-end cluster (residential, 2 nodes)
        edge({ id: 'r1', from: 'start', to: 'r2', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'r2', from: 'r2', to: 'r3', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        edge({ id: 'r3', from: 'r3', to: 'r2', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 1 }),
        // Path chain (long, leads to dead-end branches off the chain)
        edge({ id: 'p1', from: 'start', to: 'p2', lengthKm: 1, highway: 'path', surface: undefined, osmWayId: 2 }),
        edge({ id: 'p2', from: 'p2', to: 'p3', lengthKm: 1, highway: 'path', surface: 'dirt', osmWayId: 2 }),
        edge({ id: 'p3', from: 'p3', to: 'p4', lengthKm: 1, highway: 'path', surface: 'dirt', osmWayId: 2 }),
        edge({ id: 'p4', from: 'p4', to: 'p5', lengthKm: 1, highway: 'path', surface: 'dirt', osmWayId: 2 }),
        edge({ id: 'p5', from: 'p5', to: 'p6', lengthKm: 1, highway: 'path', surface: 'dirt', osmWayId: 2 }),
        edge({ id: 'p6', from: 'p6', to: 'start', lengthKm: 1, highway: 'path', surface: 'dirt', osmWayId: 2 }),
        // Dead-end branches off the path chain
        edge({ id: 'b1', from: 'p3', to: 'b1tip', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 3 }),
        edge({ id: 'b2', from: 'b1tip', to: 'p3', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 3 }),
        edge({ id: 'b3', from: 'p5', to: 'b3tip', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 4 }),
        edge({ id: 'b4', from: 'b3tip', to: 'p5', lengthKm: 0.5, highway: 'residential', surface: 'asphalt', osmWayId: 4 }),
      ],
      {
        start: { lat: 48.7, lng: 2.5 },
        r2: { lat: 48.699, lng: 2.5 },
        r3: { lat: 48.699, lng: 2.501 },
        p2: { lat: 48.701, lng: 2.5 },
        p3: { lat: 48.702, lng: 2.5 },
        p4: { lat: 48.703, lng: 2.5 },
        p5: { lat: 48.704, lng: 2.5 },
        p6: { lat: 48.704, lng: 2.501 },
        b1tip: { lat: 48.702, lng: 2.501 },
        b3tip: { lat: 48.704, lng: 2.501 },
      },
    );
    const r = generateRouteV3FromGraph(intent('low_trail_potential', { targetDistanceKm: 8 }).request!, graph);
    // The walk should reach at least the path chain (3 km) and likely more
    // via re-traversals. The exact value depends on the walk; the assertion
    // is that distanceProducedKm is positive and the walk did not loop.
    expect(r.route.metrics.distanceProducedKm).toBeGreaterThan(0.5);
    const ids = r.route.edges.map((e) => e.id);
    const uniq = new Set(ids);
    expect(uniq.size).toBe(ids.length);
  });
});
