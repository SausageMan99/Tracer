import type { AssembledRouteV3, RouteIntentV3, RouteOutcomeV3 } from './types';

export function decideOutcomeV3(intent: RouteIntentV3, route: AssembledRouteV3): RouteOutcomeV3 {
  if (intent.outcome.type === 'refused') return cloneOutcome(intent.outcome);

  const details = diagnostics(intent, route);
  const distanceRatio = ratio(route.metrics.distanceProducedKm, intent.constraints.targetDistanceKm);
  const isTrailRequest = intent.request?.mode === 'trail';
  const overPaved = route.metrics.pavedRatio > intent.constraints.maxPavedRatio;
  const insufficientDwell = route.metrics.naturalDwellKm + 0.001 < intent.constraints.targetDistanceKm * intent.constraints.minNaturalDwellRatio;
  const severeDistanceGap = distanceRatio < 0.7;

  if (route.segments.length === 0 || severeDistanceGap) {
    return {
      type: 'refused',
      reason: 'assembled route does not meet minimal distance evidence',
      details,
    };
  }

  if (intent.outcome.type === 'adjusted') {
    return {
      type: 'adjusted',
      summary: intent.outcome.summary,
      compromises: unique([...intent.outcome.compromises, ...details]),
    };
  }

  if (distanceRatio < 0.9 || overPaved || insufficientDwell || route.metrics.distanceProducedKm < intent.constraints.targetDistanceKm) {
    return {
      type: 'adjusted',
      summary: 'Route assembled with explicit compromises; not marked generated.',
      compromises: details,
    };
  }

  if (isTrailRequest && (route.metrics.pavedRatio > intent.constraints.maxPavedRatio || route.metrics.naturalWayRatio < intent.constraints.minNaturalDwellRatio)) {
    return {
      type: 'adjusted',
      summary: 'Trail intent remains constrained by paved or low-natural evidence.',
      compromises: details,
    };
  }

  return { type: 'generated', summary: 'Route assembled within V3 clean-room constraints.' };
}

function diagnostics(intent: RouteIntentV3, route: AssembledRouteV3): string[] {
  const details: string[] = [];
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const requiredDwellKm = targetDistanceKm * intent.constraints.minNaturalDwellRatio;

  if (route.metrics.distanceProducedKm < targetDistanceKm) {
    details.push(`distanceProduced ${route.metrics.distanceProducedKm}km below target ${targetDistanceKm}km`);
  }
  if (route.metrics.pavedRatio > intent.constraints.maxPavedRatio) {
    details.push(`pavedRatio ${route.metrics.pavedRatio} exceeds budget ${intent.constraints.maxPavedRatio}`);
  }
  if (route.metrics.naturalDwellKm + 0.001 < requiredDwellKm) {
    details.push(`naturalDwell ${route.metrics.naturalDwellKm}km below requested ${round(requiredDwellKm)}km`);
  }
  if (details.length === 0) details.push('minor assembly compromises');
  return details;
}

function cloneOutcome(outcome: RouteOutcomeV3): RouteOutcomeV3 {
  if (outcome.type === 'adjusted') return { ...outcome, compromises: [...outcome.compromises] };
  if (outcome.type === 'refused') return { ...outcome, details: outcome.details ? [...outcome.details] : undefined };
  return { ...outcome };
}

function ratio(value: number, total: number): number {
  if (total <= 0) return 0;
  return value / total;
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
