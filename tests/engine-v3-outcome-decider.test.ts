import { describe, expect, it } from 'vitest';

import { decideOutcomeV3 } from '../lib/engine-v3/outcome-decider';
import { createEmptyRouteTopologyMetrics } from '../lib/engine-v3/route-topology-metrics';
import type { AssembledRouteV3, CorridorMissionV3, RouteIntentV3, RouteMetricsV3, RouteSegmentV3, TerrainSnapshotV3 } from '../lib/engine-v3';

function snapshot(overrides: Partial<TerrainSnapshotV3> = {}): TerrainSnapshotV3 {
  return {
    audit: {
      confidence: 'high',
      edgeCount: 80,
      totalLengthKm: 20,
      pavedRatio: 0.2,
      nonPavedRatio: 0.8,
      warnings: [],
    },
    components: [
      {
        id: 'forest-a',
        kind: 'forest',
        distanceFromStartKm: 0.2,
        edgeCount: 48,
        totalLengthKm: 12,
        pavedRatio: 0.1,
        nonPavedRatio: 0.9,
        confidence: 'high',
      },
    ],
    ...overrides,
  };
}

function intent(overrides: Partial<RouteIntentV3> = {}): RouteIntentV3 {
  return {
    engine: 'v3-clean-room',
    strategy: 'forest_loop',
    request: {
      start: { lat: 49.18, lng: -0.52 },
      targetDistanceKm: 10,
      sport: 'running',
      mode: 'trail',
      loop: true,
    },
    snapshot: snapshot(),
    constraints: {
      targetDistanceKm: 10,
      targetComponents: ['forest'],
      maxPavedRatio: 0.35,
      cleanReturn: 'strict',
      minNaturalDwellRatio: 0.6,
    },
    outcome: { type: 'generated', summary: 'Planner believes a trail route is possible.' },
    warnings: [],
    ...overrides,
  };
}

function route(baseIntent = intent(), metricsOverride: Partial<RouteMetricsV3> = {}, segments: RouteSegmentV3[] = []): AssembledRouteV3 {
  const metrics: RouteMetricsV3 = {
    targetDistanceKm: baseIntent.constraints.targetDistanceKm,
    distanceProducedKm: baseIntent.constraints.targetDistanceKm,
    trailRatio: 0.75,
    naturalWayRatio: 0.8,
    pavedRatio: 0.2,
    pavedKm: 2,
    nonPavedKm: 8,
    naturalDwellKm: 7,
    repeatEdgeKm: 0,
    visitedComponents: ['forest'],
    repeatRatio: 0,
    overlapRatio: 0,
    busyRoadRatio: 0,
    loopClosureKm: 0.05,
    longestTrailSegmentKm: 5,
    topology: createEmptyRouteTopologyMetrics(),
    ...metricsOverride,
  };
  const mission: CorridorMissionV3 = {
    engine: 'v3-clean-room',
    strategy: baseIntent.strategy,
    targetDistanceKm: baseIntent.constraints.targetDistanceKm,
    targetComponents: [...baseIntent.constraints.targetComponents],
    anchor: null,
    budgetPavedKm: baseIntent.constraints.targetDistanceKm * baseIntent.constraints.maxPavedRatio,
    requestedNaturalDwellKm: baseIntent.constraints.targetDistanceKm * baseIntent.constraints.minNaturalDwellRatio,
    cleanReturn: baseIntent.constraints.cleanReturn,
    returnMode: 'clean_loop',
    warnings: [],
  };

  return {
    engine: 'v3-clean-room',
    strategy: baseIntent.strategy,
    mission,
    segments: segments.length > 0 ? segments : [{ kind: 'natural_dwell', surface: 'natural', distanceKm: metrics.naturalDwellKm, componentId: 'forest-a' }],
    edges: [],
    nodeIds: [],
    geometry: { type: 'LineString', coordinates: [] },
    surfaces: { pavedKm: metrics.pavedKm, nonPavedKm: metrics.nonPavedKm, naturalDwellKm: metrics.naturalDwellKm },
    metrics,
    warnings: [],
  };
}

describe('engine V3 outcome decider strict gates', () => {
  it('generates only when distance, trail surface, repetition and intent evidence are all inside the hard gates', () => {
    const baseIntent = intent();

    expect(decideOutcomeV3(baseIntent, route(baseIntent)).type).toBe('generated');
  });

  it('never marks generated for a trail route that is mostly paved', () => {
    const baseIntent = intent();

    const outcome = decideOutcomeV3(baseIntent, route(baseIntent, {
      pavedRatio: 0.62,
      pavedKm: 6.2,
      nonPavedKm: 3.8,
      naturalWayRatio: 0.38,
      trailRatio: 0.25,
      naturalDwellKm: 3,
      longestTrailSegmentKm: 1.2,
    }));

    expect(outcome.type).not.toBe('generated');
    expect(outcome.type).toBe('adjusted');
  });

  it('refuses a trail route when paved evidence dominates the produced route', () => {
    const baseIntent = intent();

    const outcome = decideOutcomeV3(baseIntent, route(baseIntent, {
      pavedRatio: 0.82,
      pavedKm: 8.2,
      nonPavedKm: 1.8,
      naturalWayRatio: 0.18,
      trailRatio: 0.05,
      naturalDwellKm: 0.8,
      longestTrailSegmentKm: 0.4,
    }));

    expect(outcome.type).toBe('refused');
    if (outcome.type === 'refused') expect(outcome.reason).toMatch(/trail promise/i);
  });

  it('marks every under-distance route as adjusted or refused instead of a silent generated success', () => {
    const baseIntent = intent();

    const outcome = decideOutcomeV3(baseIntent, route(baseIntent, {
      distanceProducedKm: 9.4,
      pavedRatio: 0.2,
      pavedKm: 1.88,
      nonPavedKm: 7.52,
      naturalWayRatio: 0.8,
      trailRatio: 0.75,
      naturalDwellKm: 7,
    }));

    expect(outcome.type).toBe('adjusted');
    if (outcome.type === 'adjusted') expect(outcome.compromises.join(' ')).toMatch(/distanceProduced/i);
  });

  it('refuses a tiny park presented as a full 15 km trail route instead of generating outside the requested intent', () => {
    const smallParkIntent = intent({
      strategy: 'park_loop',
      snapshot: snapshot({
        components: [
          {
            id: 'park-small',
            kind: 'park',
            distanceFromStartKm: 0.1,
            edgeCount: 8,
            totalLengthKm: 2.2,
            pavedRatio: 0.55,
            nonPavedRatio: 0.45,
            confidence: 'medium',
          },
        ],
      }),
      constraints: {
        targetDistanceKm: 15,
        targetComponents: ['park'],
        maxPavedRatio: 0.7,
        cleanReturn: 'relaxed',
        minNaturalDwellRatio: 0.25,
      },
      request: {
        start: { lat: 49.18, lng: -0.52 },
        targetDistanceKm: 15,
        sport: 'running',
        mode: 'trail',
        loop: true,
      },
    });

    const outcome = decideOutcomeV3(smallParkIntent, route(smallParkIntent, {
      targetDistanceKm: 15,
      distanceProducedKm: 15,
      pavedRatio: 0.55,
      pavedKm: 8.25,
      nonPavedKm: 6.75,
      naturalWayRatio: 0.45,
      trailRatio: 0.1,
      naturalDwellKm: 2,
      visitedComponents: ['park'],
      longestTrailSegmentKm: 0.8,
    }, [{ kind: 'loop_fill', surface: 'paved', distanceKm: 13, componentId: 'park-small' }]));

    expect(outcome.type).toBe('refused');
    if (outcome.type === 'refused') expect(outcome.reason).toMatch(/park/i);
  });

  it('never marks generated when the assembled route misses the requested terrain components', () => {
    const baseIntent = intent({
      constraints: {
        targetDistanceKm: 10,
        targetComponents: ['forest'],
        maxPavedRatio: 0.35,
        cleanReturn: 'strict',
        minNaturalDwellRatio: 0.6,
      },
    });

    const outcome = decideOutcomeV3(baseIntent, route(baseIntent, {
      visitedComponents: ['scenic_paved'],
      pavedRatio: 0.3,
      naturalWayRatio: 0.7,
      trailRatio: 0.65,
      naturalDwellKm: 6.5,
    }));

    expect(outcome.type).not.toBe('generated');
  });

  it('never marks generated for too much repeated or overlapping route geometry', () => {
    const baseIntent = intent();

    const outcome = decideOutcomeV3(baseIntent, route(baseIntent, {
      repeatEdgeKm: 2.1,
      repeatRatio: 0.21,
      overlapRatio: 0.24,
    }));

    expect(outcome.type).toBe('adjusted');
    if (outcome.type === 'adjusted') expect(outcome.compromises.join(' ')).toMatch(/repeat|overlap/i);
  });

  it('refuses cleanly when graph evidence is poor and no route is assembled', () => {
    const poorGraphIntent = intent({
      snapshot: snapshot({
        audit: {
          confidence: 'low',
          edgeCount: 5,
          totalLengthKm: 1.8,
          pavedRatio: 1,
          nonPavedRatio: 0,
          warnings: ['low graph coverage'],
        },
        components: [],
      }),
    });

    const outcome = decideOutcomeV3(poorGraphIntent, route(poorGraphIntent, {
      distanceProducedKm: 0,
      pavedRatio: 1,
      pavedKm: 0,
      nonPavedKm: 0,
      naturalWayRatio: 0,
      trailRatio: 0,
      naturalDwellKm: 0,
      visitedComponents: [],
      longestTrailSegmentKm: 0,
    }, []));

    expect(outcome.type).toBe('refused');
    if (outcome.type === 'refused') expect(outcome.details?.join(' ')).toMatch(/poor graph|no assembled route/i);
  });
});
