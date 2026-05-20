import { normalizeRequestV3 } from './request-normalizer';
import type {
  NormalizedRouteRequestV3,
  RouteConstraintsV3,
  RouteIntentV3,
  TerrainComponentKindV3,
  TerrainComponentV3,
  TerrainSnapshotV3,
  UserRouteRequestV3,
} from './types';

const EMPTY_CONSTRAINTS: RouteConstraintsV3 = {
  targetDistanceKm: 0,
  targetComponents: [],
  maxPavedRatio: 1,
  cleanReturn: 'relaxed',
  minNaturalDwellRatio: 0,
};

export function planRouteIntentV3(request: UserRouteRequestV3, snapshot: TerrainSnapshotV3): RouteIntentV3 {
  const normalized = normalizeRequestV3(request);

  if (normalized.status === 'refused') {
    return buildIntent({
      strategy: 'unroutable',
      request: null,
      snapshot,
      constraints: EMPTY_CONSTRAINTS,
      outcome: normalized.outcome,
      warnings: snapshot.audit.warnings,
    });
  }

  const accepted = normalized.request;
  const unroutableReason = detectUnroutable(snapshot);
  if (unroutableReason) {
    return buildIntent({
      strategy: 'unroutable',
      request: accepted,
      snapshot,
      constraints: { ...EMPTY_CONSTRAINTS, targetDistanceKm: accepted.targetDistanceKm },
      outcome: { type: 'refused', reason: `unroutable: ${unroutableReason}` },
      warnings: snapshot.audit.warnings,
    });
  }

  const nearForest = nearestUseful(snapshot.components, ['forest', 'field_paths'], 0.4);
  if (nearForest && nearForest.nonPavedRatio >= 0.7 && snapshot.audit.nonPavedRatio >= 0.65) {
    return buildIntent({
      strategy: 'forest_loop',
      request: accepted,
      snapshot,
      constraints: constraints(accepted, [nearForest.kind], 0.35, 'strict', 0.65),
      outcome: { type: 'generated', summary: 'Forest loop can be generated from high natural surface evidence.' },
      warnings: snapshot.audit.warnings,
    });
  }

  const reachableWoods = nearestUseful(snapshot.components, ['forest', 'field_paths'], 1.5);
  const largeMixedWoodsOpportunity = strongestAbsoluteNonPavedOpportunity(
    snapshot.components,
    ['forest', 'field_paths'],
    1.5,
    accepted.targetDistanceKm * 0.45,
  );
  const transitionTarget = reachableWoods && reachableWoods.nonPavedRatio >= 0.45
    ? reachableWoods
    : largeMixedWoodsOpportunity;
  if (transitionTarget) {
    return buildIntent({
      strategy: 'transition_to_woods',
      request: accepted,
      snapshot,
      constraints: constraints(accepted, [transitionTarget.kind], 0.45, 'prefer', 0.45),
      outcome: {
        type: 'adjusted',
        summary: 'Start is not fully trail-like; route should transition honestly toward nearby woods or field paths.',
        compromises: ['paved connectors may be required before non-paved terrain'],
      },
      warnings: withWarning(snapshot.audit.warnings, 'paved connectors remain paved; scenic paved is not reclassified as trail'),
    });
  }

  const park = nearestUseful(snapshot.components, ['park'], 0.8);
  if (park && accepted.targetDistanceKm <= 8) {
    return buildIntent({
      strategy: 'park_loop',
      request: accepted,
      snapshot,
      constraints: constraints(accepted, ['park'], 0.7, 'relaxed', 0.25),
      outcome: snapshot.audit.pavedRatio > 0.5
        ? { type: 'adjusted', summary: 'Short park loop possible with paved compromises.', compromises: ['park paths may be mostly paved'] }
        : { type: 'generated', summary: 'Short park loop can be generated.' },
      warnings: withWarning(snapshot.audit.warnings, 'paved park paths are accepted as paved compromises'),
    });
  }

  const urbanNature = nearestUseful(snapshot.components, ['urban_green', 'river_corridor', 'park'], 1.2);
  if (urbanNature) {
    const strategy = accepted.mode === 'boucle_simple' ? 'simple_quiet_loop' : 'urban_nature_loop';
    return buildIntent({
      strategy,
      request: accepted,
      snapshot,
      constraints: constraints(accepted, urbanTargets(snapshot.components), 0.85, 'relaxed', 0.15),
      outcome: {
        type: 'adjusted',
        summary: 'Urban nature route uses green/river corridors without inventing trail terrain.',
        compromises: ['mostly paved urban surfaces remain paved'],
      },
      warnings: withWarning(snapshot.audit.warnings, 'no true trail inferred from paved urban components'),
    });
  }

  return buildIntent({
    strategy: 'low_trail_potential',
    request: accepted,
    snapshot,
    constraints: constraints(accepted, [], 0.8, 'relaxed', 0.1),
    outcome: {
      type: 'adjusted',
      summary: 'Low trail potential: only a simple quiet loop should be attempted.',
      compromises: ['natural dwell and non-paved ratio are expected to be low'],
    },
    warnings: withWarning(snapshot.audit.warnings, 'low trail potential in terrain snapshot'),
  });
}

function buildIntent(intent: Omit<RouteIntentV3, 'engine'>): RouteIntentV3 {
  return {
    ...intent,
    request: intent.request ? cloneRequest(intent.request) : null,
    snapshot: cloneSnapshot(intent.snapshot),
    constraints: cloneConstraints(intent.constraints),
    outcome: cloneOutcome(intent.outcome),
    warnings: [...intent.warnings],
    engine: 'v3-clean-room',
  };
}

function cloneRequest(request: NormalizedRouteRequestV3): NormalizedRouteRequestV3 {
  return {
    ...request,
    start: { lat: request.start.lat, lng: request.start.lng },
  };
}

function cloneSnapshot(snapshot: TerrainSnapshotV3): TerrainSnapshotV3 {
  return {
    audit: {
      ...snapshot.audit,
      warnings: [...snapshot.audit.warnings],
    },
    components: snapshot.components.map((component) => ({ ...component })),
  };
}

function cloneConstraints(constraints: RouteConstraintsV3): RouteConstraintsV3 {
  return {
    ...constraints,
    targetComponents: [...constraints.targetComponents],
  };
}

function cloneOutcome(outcome: RouteIntentV3['outcome']): RouteIntentV3['outcome'] {
  if (outcome.type === 'adjusted') return { ...outcome, compromises: [...outcome.compromises] };
  if (outcome.type === 'refused') return { ...outcome, details: outcome.details ? [...outcome.details] : undefined };
  return { ...outcome };
}

function constraints(
  request: NormalizedRouteRequestV3,
  targetComponents: TerrainComponentKindV3[],
  maxPavedRatio: number,
  cleanReturn: RouteConstraintsV3['cleanReturn'],
  minNaturalDwellRatio: number,
): RouteConstraintsV3 {
  return {
    targetDistanceKm: request.targetDistanceKm,
    targetComponents,
    maxPavedRatio,
    cleanReturn,
    minNaturalDwellRatio,
  };
}

function detectUnroutable(snapshot: TerrainSnapshotV3): string | null {
  if (snapshot.audit.confidence === 'low' && snapshot.audit.edgeCount < 12) return 'low confidence and insufficient edge coverage';
  if (snapshot.audit.totalLengthKm < 3) return 'insufficient routeable length';
  if (snapshot.components.length === 0 && snapshot.audit.edgeCount < 20) return 'no usable terrain components';
  return null;
}

function nearestUseful(
  components: TerrainComponentV3[],
  kinds: TerrainComponentKindV3[],
  maxDistanceKm: number,
): TerrainComponentV3 | undefined {
  return components
    .filter((component) => kinds.includes(component.kind) && component.distanceFromStartKm <= maxDistanceKm)
    .sort((a, b) => a.distanceFromStartKm - b.distanceFromStartKm || b.nonPavedRatio - a.nonPavedRatio)[0];
}

function strongestAbsoluteNonPavedOpportunity(
  components: TerrainComponentV3[],
  kinds: TerrainComponentKindV3[],
  maxDistanceKm: number,
  minNonPavedKm: number,
): TerrainComponentV3 | undefined {
  return components
    .filter((component) => kinds.includes(component.kind) && component.distanceFromStartKm <= maxDistanceKm)
    .filter((component) => nonPavedOpportunityKm(component) + 0.001 >= minNonPavedKm)
    .sort((a, b) => nonPavedOpportunityKm(b) - nonPavedOpportunityKm(a) || a.distanceFromStartKm - b.distanceFromStartKm)[0];
}

function nonPavedOpportunityKm(component: TerrainComponentV3): number {
  return component.totalLengthKm * component.nonPavedRatio;
}

function urbanTargets(components: TerrainComponentV3[]): TerrainComponentKindV3[] {
  const targets = components
    .map((component) => component.kind)
    .filter((kind): kind is TerrainComponentKindV3 => ['urban_green', 'river_corridor', 'park'].includes(kind));
  return Array.from(new Set(targets));
}

function withWarning(warnings: string[], warning: string): string[] {
  return warnings.some((existing) => existing.includes(warning)) ? warnings : [...warnings, warning];
}
