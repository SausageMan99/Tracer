import type { AssembledRouteV3, CorridorMissionV3, RouteIntentV3, RouteSegmentV3 } from './types';

export function assembleRouteV3(intent: RouteIntentV3, mission: CorridorMissionV3): AssembledRouteV3 {
  if (!mission.anchor || intent.strategy === 'unroutable') return emptyRoute(intent, mission, 'no usable anchor for assembly');

  const segments = assembleSegments(intent, mission);
  const metrics = computeMetrics(intent, segments);

  return {
    engine: 'v3-clean-room',
    strategy: intent.strategy,
    mission: cloneMission(mission),
    segments,
    metrics,
    warnings: [...mission.warnings],
  };
}

function assembleSegments(intent: RouteIntentV3, mission: CorridorMissionV3): RouteSegmentV3[] {
  switch (intent.strategy) {
    case 'forest_loop':
      return assembleForestLoop(mission);
    case 'transition_to_woods':
      return assembleTransitionToWoods(mission);
    case 'park_loop':
      return assembleParkLoop(mission);
    case 'urban_nature_loop':
    case 'simple_quiet_loop':
    case 'low_trail_potential':
      return assembleUrbanNatureLoop(intent, mission);
    default:
      return [];
  }
}

function assembleForestLoop(mission: CorridorMissionV3): RouteSegmentV3[] {
  const accessKm = round(mission.anchor!.distanceFromStartKm);
  const dwellKm = boundedNaturalDwell(mission, mission.targetDistanceKm - accessKm * 2);
  const fillKm = Math.max(0, Math.min(mission.anchor!.naturalCapacityKm - dwellKm, mission.targetDistanceKm - accessKm * 2 - dwellKm));
  return compact([
    segment('access', accessKm, 'mixed'),
    segment('natural_dwell', dwellKm, 'natural', mission.anchor!.componentId),
    segment('loop_fill', fillKm, 'natural', mission.anchor!.componentId),
    segment('return', accessKm, 'mixed'),
  ]);
}

function assembleTransitionToWoods(mission: CorridorMissionV3): RouteSegmentV3[] {
  const connectorKm = round(mission.anchor!.distanceFromStartKm);
  const availableAfterConnectors = Math.max(0, mission.targetDistanceKm - connectorKm * 2);
  const dwellKm = boundedNaturalDwell(mission, availableAfterConnectors);
  const remainingKm = Math.max(0, mission.targetDistanceKm - connectorKm * 2 - dwellKm);
  const fillKm = Math.min(remainingKm, Math.max(0, mission.anchor!.naturalCapacityKm - dwellKm));
  return compact([
    segment('access', connectorKm, 'paved'),
    segment('natural_dwell', dwellKm, 'natural', mission.anchor!.componentId),
    segment('loop_fill', fillKm, 'mixed', mission.anchor!.componentId),
    segment('return', connectorKm, 'paved'),
  ]);
}

function assembleParkLoop(mission: CorridorMissionV3): RouteSegmentV3[] {
  const connectorKm = round(mission.anchor!.distanceFromStartKm);
  const naturalKm = Math.min(mission.anchor!.naturalCapacityKm, mission.requestedNaturalDwellKm, mission.targetDistanceKm - connectorKm * 2);
  const pavedParkCapacityKm = Math.max(0, mission.anchor!.naturalCapacityKm * (mission.anchor!.pavedRatio / Math.max(0.01, mission.anchor!.nonPavedRatio)));
  const fillKm = Math.min(pavedParkCapacityKm, Math.max(0, mission.targetDistanceKm - connectorKm * 2 - naturalKm));
  return compact([
    segment('access', connectorKm, 'paved'),
    segment('natural_dwell', naturalKm, 'natural', mission.anchor!.componentId),
    segment('loop_fill', fillKm, 'paved', mission.anchor!.componentId),
    segment('return', connectorKm, 'paved'),
  ]);
}

function assembleUrbanNatureLoop(intent: RouteIntentV3, mission: CorridorMissionV3): RouteSegmentV3[] {
  const connectorKm = round(mission.anchor!.distanceFromStartKm);
  const naturalCapacityKm = Math.min(mission.anchor!.naturalCapacityKm, Math.max(0, mission.targetDistanceKm - connectorKm * 2));
  const requestedNaturalKm = intent.request?.mode === 'trail' ? mission.requestedNaturalDwellKm : Math.min(mission.requestedNaturalDwellKm, naturalCapacityKm);
  const naturalKm = Math.min(naturalCapacityKm, requestedNaturalKm);
  const pavedFillCapacityKm = intent.request?.mode === 'trail'
    ? mission.targetDistanceKm
    : Math.max(0, mission.anchor!.naturalCapacityKm * mission.anchor!.pavedRatio * 3);
  const fillKm = Math.min(pavedFillCapacityKm, Math.max(0, mission.targetDistanceKm - connectorKm * 2 - naturalKm));
  return compact([
    segment('access', connectorKm, 'paved'),
    segment('natural_dwell', naturalKm, 'natural', mission.anchor!.componentId),
    segment('loop_fill', fillKm, 'paved', mission.anchor!.componentId),
    segment('return', connectorKm, 'paved'),
  ]);
}

function boundedNaturalDwell(mission: CorridorMissionV3, maxDistanceKm: number): number {
  return round(Math.max(0, Math.min(mission.requestedNaturalDwellKm, mission.anchor!.naturalCapacityKm, maxDistanceKm)));
}

function computeMetrics(intent: RouteIntentV3, segments: RouteSegmentV3[]): AssembledRouteV3['metrics'] {
  const distanceProducedKm = round(segments.reduce((sum, segment) => sum + segment.distanceKm, 0));
  const naturalDwellKm = round(segments.filter((segment) => segment.kind === 'natural_dwell').reduce((sum, segment) => sum + segment.distanceKm, 0));
  const nonPavedKm = round(segments.reduce((sum, segment) => sum + nonPavedDistance(segment), 0));
  const pavedKm = Math.max(0, distanceProducedKm - nonPavedKm);
  const naturalWayRatio = ratio(nonPavedKm, distanceProducedKm);
  return {
    targetDistanceKm: intent.constraints.targetDistanceKm,
    distanceProducedKm,
    trailRatio: naturalWayRatio,
    naturalWayRatio,
    pavedRatio: ratio(pavedKm, distanceProducedKm),
    nonPavedKm,
    naturalDwellKm,
    // Segment-level estimate only: transition_to_woods uses mirrored access/return
    // connectors, so count the repeated connector traversal without fabricating geometry.
    repeatRatio: ratio(knownRepeatedConnectorKm(intent, segments), distanceProducedKm),
    overlapRatio: ratio(knownRepeatedConnectorKm(intent, segments), distanceProducedKm),
  };
}

function nonPavedDistance(segment: RouteSegmentV3): number {
  if (segment.surface === 'natural') return segment.distanceKm;
  if (segment.surface === 'mixed') return segment.distanceKm * 0.5;
  return 0;
}

function knownRepeatedConnectorKm(intent: RouteIntentV3, segments: RouteSegmentV3[]): number {
  if (intent.strategy !== 'transition_to_woods') return 0;
  const accessKm = segments.find((segment) => segment.kind === 'access')?.distanceKm ?? 0;
  const returnKm = segments.find((segment) => segment.kind === 'return')?.distanceKm ?? 0;
  if (accessKm <= 0 || returnKm <= 0) return 0;
  return round(Math.min(accessKm, returnKm) * 2);
}

function emptyRoute(intent: RouteIntentV3, mission: CorridorMissionV3, warning: string): AssembledRouteV3 {
  return {
    engine: 'v3-clean-room',
    strategy: intent.strategy,
    mission: cloneMission(mission),
    segments: [],
    metrics: {
      targetDistanceKm: intent.constraints.targetDistanceKm,
      distanceProducedKm: 0,
      trailRatio: 0,
      naturalWayRatio: 0,
      pavedRatio: 1,
      nonPavedKm: 0,
      naturalDwellKm: 0,
      repeatRatio: 0,
      overlapRatio: 0,
    },
    warnings: [...mission.warnings, warning],
  };
}

function segment(kind: RouteSegmentV3['kind'], distanceKm: number, surface: RouteSegmentV3['surface'], componentId?: string): RouteSegmentV3 {
  return { kind, distanceKm: round(Math.max(0, distanceKm)), surface, componentId };
}

function compact(segments: RouteSegmentV3[]): RouteSegmentV3[] {
  return segments.filter((segment) => segment.distanceKm > 0);
}

function ratio(value: number, total: number): number {
  if (total <= 0) return 0;
  return round(value / total);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function cloneMission(mission: CorridorMissionV3): CorridorMissionV3 {
  return {
    ...mission,
    targetComponents: [...mission.targetComponents],
    anchor: mission.anchor ? { ...mission.anchor } : null,
    warnings: [...mission.warnings],
  };
}
