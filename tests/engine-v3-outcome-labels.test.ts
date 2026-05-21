import { describe, expect, it } from 'vitest';
import { decideOutcomeV3 } from '@/lib/engine-v3/outcome-decider';
import type { AssembledRouteV3, RouteIntentV3, RouteMetricsV3, RouteOutcomeV3, RouteStrategyV3, TerrainComponentKindV3 } from '@/lib/engine-v3/types';

function intent(options: {
  strategy?: RouteStrategyV3;
  mode?: 'trail' | 'nature_urbaine';
  targetDistanceKm?: number;
  targetComponents?: TerrainComponentKindV3[];
  minNaturalDwellRatio?: number;
  maxPavedRatio?: number;
  outcome?: RouteOutcomeV3;
} = {}): RouteIntentV3 {
  const targetDistanceKm = options.targetDistanceKm ?? 10;
  const mode = options.mode ?? 'trail';
  const targetComponents = options.targetComponents ?? (mode === 'trail' ? ['forest'] : ['urban_green']);
  return {
    engine: 'v3-clean-room',
    strategy: options.strategy ?? (mode === 'trail' ? 'transition_to_woods' : 'urban_nature_loop'),
    request: {
      start: { lat: 48.88, lng: 2.37 },
      targetDistanceKm,
      sport: 'running',
      mode,
      loop: true,
    },
    snapshot: {
      audit: { confidence: 'high', edgeCount: 80, totalLengthKm: 20, pavedRatio: 0.3, nonPavedRatio: 0.7, warnings: [] },
      components: targetComponents.map((kind) => ({
        id: `${kind}-main`,
        kind,
        distanceFromStartKm: 0.4,
        edgeCount: 24,
        totalLengthKm: 8,
        pavedRatio: kind === 'scenic_paved' ? 1 : 0.2,
        nonPavedRatio: kind === 'scenic_paved' ? 0 : 0.8,
        confidence: 'high',
      })),
    },
    constraints: {
      targetDistanceKm,
      targetComponents,
      maxPavedRatio: options.maxPavedRatio ?? (mode === 'trail' ? 0.35 : 0.85),
      cleanReturn: 'prefer',
      minNaturalDwellRatio: options.minNaturalDwellRatio ?? (mode === 'trail' ? 0.45 : 0.2),
    },
    outcome: options.outcome ?? { type: 'generated', summary: 'candidate intent' },
    warnings: [],
  };
}

function route(metrics: Partial<RouteMetricsV3> = {}, options: { strategy?: RouteStrategyV3; components?: TerrainComponentKindV3[]; selectedReason?: string; topologyInsufficient?: boolean } = {}): AssembledRouteV3 {
  const targetDistanceKm = metrics.targetDistanceKm ?? 10;
  const distanceProducedKm = metrics.distanceProducedKm ?? targetDistanceKm;
  const pavedRatio = metrics.pavedRatio ?? 0.1;
  const naturalWayRatio = metrics.naturalWayRatio ?? 0.7;
  const naturalDwellKm = metrics.naturalDwellKm ?? distanceProducedKm * naturalWayRatio;
  const strictTrailKm = metrics.strictTrailKm ?? naturalDwellKm;
  const pavedKm = metrics.pavedKm ?? distanceProducedKm * pavedRatio;
  const visitedComponents = metrics.visitedComponents ?? options.components ?? ['forest'];
  const fullMetrics: RouteMetricsV3 = {
    targetDistanceKm,
    distanceProducedKm,
    strictTrailKm,
    explicitNaturalKm: metrics.explicitNaturalKm ?? naturalDwellKm,
    explicitPavedKm: metrics.explicitPavedKm ?? pavedKm,
    roadLikeUnknownKm: metrics.roadLikeUnknownKm ?? 0,
    pathTrackUnknownKm: metrics.pathTrackUnknownKm ?? 0,
    candidateNaturalKm: metrics.candidateNaturalKm ?? naturalDwellKm,
    trailCandidateKm: metrics.trailCandidateKm ?? strictTrailKm,
    unverifiedTrailCandidateKm: metrics.unverifiedTrailCandidateKm ?? 0,
    trailRatio: metrics.trailRatio ?? naturalWayRatio,
    naturalWayRatio,
    pavedRatio,
    pavedKm,
    nonPavedKm: metrics.nonPavedKm ?? Math.max(0, distanceProducedKm - pavedKm),
    naturalDwellKm,
    repeatEdgeKm: metrics.repeatEdgeKm ?? 0,
    targetRepeatKm: metrics.targetRepeatKm ?? 0,
    connectorRepeatKm: metrics.connectorRepeatKm ?? 0,
    visitedComponents,
    repeatRatio: metrics.repeatRatio ?? 0,
    overlapRatio: metrics.overlapRatio ?? 0,
    busyRoadRatio: metrics.busyRoadRatio ?? 0,
    loopClosureKm: metrics.loopClosureKm ?? 0.1,
    longestTrailSegmentKm: metrics.longestTrailSegmentKm ?? naturalDwellKm,
  };
  return {
    engine: 'v3-clean-room',
    strategy: options.strategy ?? 'transition_to_woods',
    mission: {
      engine: 'v3-clean-room',
      strategy: options.strategy ?? 'transition_to_woods',
      targetDistanceKm,
      targetComponents: visitedComponents,
      anchor: null,
      budgetPavedKm: targetDistanceKm * 0.35,
      requestedNaturalDwellKm: targetDistanceKm * 0.45,
      cleanReturn: 'prefer',
      returnMode: 'clean_loop',
      warnings: [],
    },
    segments: [{ kind: 'natural_dwell', surface: 'natural', distanceKm: naturalDwellKm }],
    edges: [{ id: 'edge-1', from: 'a', to: 'b', lengthKm: distanceProducedKm, surface: 'natural', componentKind: visitedComponents[0] ?? 'forest', highway: 'path', osmWayId: 1 }],
    nodeIds: ['a', 'b', 'a'],
    geometry: { type: 'LineString', coordinates: [[0, 0], [0.01, 0.01], [0, 0]] },
    surfaces: { pavedKm, nonPavedKm: Math.max(0, distanceProducedKm - pavedKm), naturalDwellKm },
    metrics: fullMetrics,
    assemblyDiagnostics: {
      startNodeId: 'a',
      distanceToFirstNonPavedTargetKm: 0,
      reachableNonPavedTargetEdgeCount: 1,
      reachableNonPavedTargetKm: naturalDwellKm,
      selectedReason: options.selectedReason ?? 'mission-driven:clean',
      candidateProductionDiagnostics: options.topologyInsufficient
        ? { candidateProduction: { targetLateralSummary: { topologyInsufficient: true, bestCleanLateralNaturalDwellKm: 2.4 } } }
        : undefined,
    },
    warnings: [],
  };
}

describe('V3 product outcome labels', () => {
  it('labels path/track urban-nature evidence as urban nature, not trail, when strict trail is zero', () => {
    const outcome = decideOutcomeV3(intent({
      mode: 'nature_urbaine',
      strategy: 'urban_nature_loop',
      targetComponents: ['urban_green'],
      targetDistanceKm: 7,
      outcome: { type: 'adjusted', summary: 'Urban nature route uses park/canal/corridor evidence without inventing trail terrain.', compromises: ['mostly paved urban surfaces remain paved'] },
    }), route({
      targetDistanceKm: 7,
      distanceProducedKm: 6.9,
      strictTrailKm: 0,
      naturalDwellKm: 2.2,
      naturalWayRatio: 0.319,
      pavedRatio: 0.088,
      pavedKm: 0.607,
      pathTrackUnknownKm: 6.292,
      candidateNaturalKm: 2.2,
      visitedComponents: ['urban_green'],
    }, { strategy: 'urban_nature_loop', components: ['urban_green'] }));

    expect(outcome.type).toBe('adjusted');
    expect(outcome.productLabel).toBe('adjusted_urban_nature');
  });

  it('labels full-distance high-strict-trail forest evidence as trail', () => {
    const outcome = decideOutcomeV3(intent({ mode: 'trail', strategy: 'transition_to_woods', targetComponents: ['forest'] }), route({
      targetDistanceKm: 12,
      distanceProducedKm: 12.12,
      strictTrailKm: 11.9,
      naturalDwellKm: 11.9,
      naturalWayRatio: 0.982,
      trailRatio: 0.982,
      pavedRatio: 0.018,
      pavedKm: 0.218,
      repeatRatio: 0.009,
      overlapRatio: 0.009,
      visitedComponents: ['forest'],
    }, { strategy: 'transition_to_woods', components: ['forest'] }));

    expect(outcome.productLabel).toBe('generated_trail');
  });

  it('labels topology-limited repeated trail attempts as refused repeat/overlap instead of generic refused', () => {
    const outcome = decideOutcomeV3(intent({ mode: 'trail', strategy: 'transition_to_woods', targetComponents: ['forest'], targetDistanceKm: 12 }), route({
      targetDistanceKm: 12,
      distanceProducedKm: 11.78,
      strictTrailKm: 6.53,
      naturalDwellKm: 6.53,
      naturalWayRatio: 0.554,
      pavedRatio: 0.158,
      pavedKm: 1.858,
      repeatRatio: 0.277,
      overlapRatio: 0.277,
      targetRepeatKm: 3.266,
      visitedComponents: ['forest'],
    }, { strategy: 'transition_to_woods', components: ['forest'], selectedReason: 'mission-driven:long_dirty', topologyInsufficient: true }));

    expect(outcome.type).toBe('refused');
    expect(outcome.productLabel).toBe('refused_repeat_overlap');
  });
});
