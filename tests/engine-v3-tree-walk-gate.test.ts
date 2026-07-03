import { describe, expect, it } from 'vitest';

import { decideOutcomeV3 } from '../lib/engine-v3/outcome-decider';
import type { RouteTopologyMetrics } from '../lib/engine-v3/route-topology-metrics';
import type { RouteTopologyMetricsV3 } from '../lib/engine-v3/types';
import type {
  AssembledRouteV3,
  CorridorMissionV3,
  RouteEdgeV3,
  RouteIntentV3,
  RouteMetricsV3,
} from '../lib/engine-v3';

function topology(overrides: Partial<RouteTopologyMetricsV3> = {}): RouteTopologyMetricsV3 {
  const empty: RouteTopologyMetrics = {
    uniqueUndirectedDistanceKm: 0,
    repeatedTraversalKm: 0,
    repeatedTraversalRatio: 0,
    graphCyclomaticNumber: 0,
    leafCount: 0,
    branchNodeCount: 0,
    cycleDistanceKm: 0,
    outAndBackDominance: 0,
  };
  return { ...empty, ...overrides };
}

function intent(overrides: Partial<RouteIntentV3> = {}): RouteIntentV3 {
  return {
    engine: 'v3-clean-room',
    strategy: 'transition_to_woods',
    request: {
      start: { lat: 48.7, lng: 2.5 },
      targetDistanceKm: 6,
      sport: 'running',
      mode: 'trail',
      loop: true,
    },
    snapshot: {
      audit: { confidence: 'medium', edgeCount: 80, totalLengthKm: 12, pavedRatio: 0.3, nonPavedRatio: 0.7, warnings: [] },
      components: [
        { id: 'forest-a', kind: 'forest', distanceFromStartKm: 0.3, edgeCount: 30, totalLengthKm: 8, pavedRatio: 0.2, nonPavedRatio: 0.8, confidence: 'medium' },
      ],
    },
    constraints: {
      targetDistanceKm: 6,
      targetComponents: ['forest'],
      maxPavedRatio: 0.45,
      cleanReturn: 'prefer',
      minNaturalDwellRatio: 0.4,
    },
    outcome: { type: 'generated', summary: 'planner believes a route is possible' },
    warnings: [],
    ...overrides,
  };
}

function mission(): CorridorMissionV3 {
  return {
    engine: 'v3-clean-room',
    strategy: 'transition_to_woods',
    targetDistanceKm: 6,
    targetComponents: ['forest'],
    anchor: {
      componentId: 'forest-a',
      kind: 'forest',
      distanceFromStartKm: 0.3,
      totalLengthKm: 8,
      naturalCapacityKm: 6,
      pavedRatio: 0.2,
      nonPavedRatio: 0.8,
    },
    budgetPavedKm: 6 * 0.45,
    requestedNaturalDwellKm: 6 * 0.4,
    cleanReturn: 'prefer',
    returnMode: 'out_and_back_connector',
    warnings: [],
  };
}

function route(baseIntent: RouteIntentV3, metricsOverride: Partial<RouteMetricsV3> = {}): AssembledRouteV3 {
  const metrics: RouteMetricsV3 = {
    targetDistanceKm: 6,
    distanceProducedKm: 6,
    trailRatio: 0.6,
    naturalWayRatio: 0.7,
    pavedRatio: 0.3,
    pavedKm: 1.8,
    nonPavedKm: 4.2,
    naturalDwellKm: 3.5,
    repeatEdgeKm: 0,
    visitedComponents: ['forest'],
    repeatRatio: 0,
    overlapRatio: 0,
    busyRoadRatio: 0,
    loopClosureKm: 0.05,
    longestTrailSegmentKm: 2.5,
    topology: topology(),
    ...metricsOverride,
  };
  // Provide a single placeholder edge so the decider does not flag "poor graph evidence".
  const placeholderEdge: RouteEdgeV3 = {
    id: 'placeholder-edge',
    from: 'A',
    to: 'B',
    lengthKm: 1,
    highway: 'path',
    surface: 'natural',
    componentKind: 'forest',
    osmWayId: 1,
  };
  return {
    engine: 'v3-clean-room',
    strategy: baseIntent.strategy,
    mission: mission(),
    segments: [],
    edges: [placeholderEdge],
    nodeIds: ['A', 'B'],
    geometry: { type: 'LineString', coordinates: [[0, 0], [0, 0.01]] },
    surfaces: { pavedKm: metrics.pavedKm, nonPavedKm: metrics.nonPavedKm, naturalDwellKm: metrics.naturalDwellKm },
    metrics,
    warnings: [],
  };
}

describe('engine V3 tree-walk gate', () => {
  it('refuses a severe Y-tree assembly with TREE_WALK_NOT_A_LOOP', () => {
    const baseIntent = intent();
    const treeWalkTopology = topology({
      graphCyclomaticNumber: 0,
      cycleDistanceKm: 0,
      repeatedTraversalRatio: 0.55,
      outAndBackDominance: 0.6,
      leafCount: 3,
      branchNodeCount: 1,
      uniqueUndirectedDistanceKm: 3,
      repeatedTraversalKm: 3,
    });

    const outcome = decideOutcomeV3(
      baseIntent,
      route(baseIntent, { topology: treeWalkTopology }),
    );

    expect(outcome.type).toBe('refused');
    if (outcome.type === 'refused') {
      expect(outcome.subCode).toBe('TREE_WALK_NOT_A_LOOP');
      expect(outcome.reason).toMatch(/^TREE_WALK_NOT_A_LOOP:/);
      // Terrain is not the problem: the wording must explicitly say terrain is not impossible.
      expect(outcome.reason).toMatch(/terrain is not impossible/);
      // And it must not carry the legacy "impossible" framing on its own.
      expect(outcome.reason).not.toMatch(/\bterrain is impossible\b/);
      expect(outcome.reason).not.toMatch(/unroutable|empty graph/i);
    }
  });

  it('keeps a real closed loop generated when topology is healthy', () => {
    const baseIntent = intent({ strategy: 'forest_loop' });
    const healthyTopology = topology({
      graphCyclomaticNumber: 1,
      cycleDistanceKm: 6,
      repeatedTraversalRatio: 0,
      outAndBackDominance: 0,
      leafCount: 0,
      branchNodeCount: 0,
      uniqueUndirectedDistanceKm: 6,
      repeatedTraversalKm: 0,
    });

    const outcome = decideOutcomeV3(
      baseIntent,
      route(baseIntent, { topology: healthyTopology, longestTrailSegmentKm: 5 }),
    );

    expect(outcome.type).toBe('generated');
  });

  it('downgrades a marginal tree shape to adjusted (not generated)', () => {
    const baseIntent = intent();
    const marginalTopology = topology({
      graphCyclomaticNumber: 0,
      cycleDistanceKm: 0,
      repeatedTraversalRatio: 0.35,
      outAndBackDominance: 0.3,
      leafCount: 2,
      branchNodeCount: 1,
    });

    const outcome = decideOutcomeV3(
      baseIntent,
      route(baseIntent, { topology: marginalTopology }),
    );

    expect(outcome.type).not.toBe('generated');
    expect(outcome.type).toBe('adjusted');
    if (outcome.type === 'adjusted') {
      const text = outcome.compromises.join(' ');
      expect(text).toMatch(/tree walk|topology/i);
    }
  });

  it('does not fire the gate when the intent is pre-refused before the gate', () => {
    // topology is the worst possible tree walk shape
    const treeWalkTopology = topology({
      graphCyclomaticNumber: 0,
      cycleDistanceKm: 0,
      repeatedTraversalRatio: 0.6,
      outAndBackDominance: 0.7,
    });

    const baseIntent = intent();
    // A pre-refused intent short-circuits the decider on line 22 of outcome-decider.ts
    // before the tree-walk gate is reached.
    const preRefusedIntent: RouteIntentV3 = {
      ...baseIntent,
      outcome: { type: 'refused', reason: 'invalid pre-refused' },
    };
    const outcome = decideOutcomeV3(preRefusedIntent, route(preRefusedIntent, { topology: treeWalkTopology }));

    expect(outcome.type).toBe('refused');
    if (outcome.type === 'refused') {
      expect(outcome.reason).not.toMatch(/TREE_WALK_NOT_A_LOOP/);
    }
  });

  it('does not refuse a Fontainebleau-like forest loop', () => {
    const baseIntent = intent({
      strategy: 'forest_loop',
      constraints: {
        targetDistanceKm: 12,
        targetComponents: ['forest'],
        maxPavedRatio: 0.35,
        cleanReturn: 'strict',
        minNaturalDwellRatio: 0.6,
      },
      request: { start: { lat: 48.404, lng: 2.701 }, targetDistanceKm: 12, sport: 'running', mode: 'trail', loop: true },
    });
    const healthyTopology = topology({
      graphCyclomaticNumber: 1,
      cycleDistanceKm: 11,
      repeatedTraversalRatio: 0,
      outAndBackDominance: 0,
      leafCount: 0,
      branchNodeCount: 0,
    });

    const outcome = decideOutcomeV3(
      baseIntent,
      route(baseIntent, {
        targetDistanceKm: 12,
        distanceProducedKm: 12,
        pavedKm: 2.4,
        nonPavedKm: 9.6,
        naturalDwellKm: 7.5,
        naturalWayRatio: 0.8,
        trailRatio: 0.75,
        pavedRatio: 0.2,
        longestTrailSegmentKm: 6,
        topology: healthyTopology,
      }),
    );

    expect(outcome.type).toBe('generated');
  });
});
