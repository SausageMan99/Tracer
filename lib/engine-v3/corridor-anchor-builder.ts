import type { CorridorMissionV3, RouteAnchorV3, RouteIntentV3, TerrainComponentKindV3, TerrainComponentV3 } from './types';

const NATURAL_COMPONENTS: TerrainComponentKindV3[] = ['forest', 'field_paths', 'park', 'urban_green', 'river_corridor'];

export function buildCorridorMissionV3(intent: RouteIntentV3): CorridorMissionV3 {
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const anchor = selectAnchor(intent);
  const warnings = [...intent.warnings];

  if (!anchor) warnings.push('no corridor anchor selected for requested target components');

  return {
    engine: 'v3-clean-room',
    strategy: intent.strategy,
    targetDistanceKm,
    targetComponents: [...intent.constraints.targetComponents],
    anchor,
    budgetPavedKm: round(targetDistanceKm * intent.constraints.maxPavedRatio),
    requestedNaturalDwellKm: round(targetDistanceKm * intent.constraints.minNaturalDwellRatio),
    cleanReturn: intent.constraints.cleanReturn,
    returnMode: returnMode(intent),
    warnings,
  };
}

function selectAnchor(intent: RouteIntentV3): RouteAnchorV3 | null {
  const targets = intent.constraints.targetComponents.length > 0 ? intent.constraints.targetComponents : fallbackTargets(intent);
  const candidates = intent.snapshot.components.filter((component) => targets.includes(component.kind));
  if (candidates.length === 0) return null;

  const selected = [...candidates].sort((a, b) => score(b) - score(a))[0];
  return toAnchor(selected);
}

function fallbackTargets(intent: RouteIntentV3): TerrainComponentKindV3[] {
  if (intent.strategy === 'low_trail_potential' || intent.strategy === 'simple_quiet_loop') {
    // field_paths is included before scenic_paved/residential so that real
    // path-heavy terrain (e.g. dense forest grids in Fontainebleau) can
    // still be picked as anchor when no urban_green/river_corridor/park
    // component is present. The score formula in selectAnchor naturally
    // ranks field_paths above residential when both exist.
    return ['urban_green', 'river_corridor', 'park', 'field_paths', 'scenic_paved', 'residential'];
  }
  return NATURAL_COMPONENTS;
}

function score(component: TerrainComponentV3): number {
  const kindBonus = component.kind === 'forest' || component.kind === 'field_paths' ? 4 : component.kind === 'park' ? 2 : 1;
  const scenicPenalty = component.kind === 'scenic_paved' || component.kind === 'residential' ? 8 : 0;
  return component.totalLengthKm * component.nonPavedRatio + kindBonus - component.distanceFromStartKm * 1.5 - scenicPenalty;
}

function toAnchor(component: TerrainComponentV3): RouteAnchorV3 {
  return {
    componentId: component.id,
    kind: component.kind,
    distanceFromStartKm: component.distanceFromStartKm,
    totalLengthKm: round(component.totalLengthKm),
    naturalCapacityKm: round(component.totalLengthKm * component.nonPavedRatio),
    pavedRatio: component.pavedRatio,
    nonPavedRatio: component.nonPavedRatio,
  };
}

function returnMode(intent: RouteIntentV3): CorridorMissionV3['returnMode'] {
  if (intent.constraints.cleanReturn === 'strict') return 'clean_loop';
  if (intent.strategy === 'transition_to_woods') return 'out_and_back_connector';
  return 'relaxed_loop';
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
