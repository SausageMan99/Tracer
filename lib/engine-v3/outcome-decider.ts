import type { AssembledRouteV3, RouteIntentV3, RouteOutcomeV3 } from './types';
import type { OutcomeEvidenceV3, ProductVerdictV3, RouteCandidateV3 } from './contracts';

const STRICT_OUTCOME_RULES = {
  minimumGeneratedDistanceRatio: 1,
  refusedDistanceRatio: 0.7,
  repeatAdjustRatio: 0.2,
  repeatRefuseRatio: 0.35,
  overlapAdjustRatio: 0.2,
  overlapRefuseRatio: 0.35,
  busyRoadAdjustRatio: 0.2,
  busyRoadRefuseRatio: 0.4,
  dominantPavedTrailRatio: 0.75,
  smallParkMaxTrailDistanceKm: 8,
  minimumGraphEdges: 12,
  minimumGraphLengthKm: 3,
} as const;

export function decideOutcomeV3(intent: RouteIntentV3, route: AssembledRouteV3): RouteOutcomeV3 {
  if (intent.outcome.type === 'refused') return cloneOutcome(intent.outcome);

  const details = diagnostics(intent, route);
  const distanceRatio = ratio(route.metrics.distanceProducedKm, intent.constraints.targetDistanceKm);
  const severeDistanceGap = distanceRatio < STRICT_OUTCOME_RULES.refusedDistanceRatio;
  if (route.assemblyDiagnostics?.assemblyTimeout) {
    const timeout = route.assemblyDiagnostics.assemblyTimeout;
    return {
      type: 'refused',
      reason: 'assembly timeout: V3 graph assembly exceeded its bounded diagnostic budget',
      details: [
        `stage ${timeout.stage} stopped after ${timeout.iterations}/${timeout.maxIterations} iteration budget and ${timeout.elapsedMs}/${timeout.maxMs}ms`,
        `lastProgress ${timeout.lastProgress}; candidates ${timeout.candidateCount}; frontier ${timeout.frontierSize}; cycles ${timeout.cycleCount}`,
        ...details,
      ],
    };
  }
  const hardRefusals = hardRefusalReasons(intent, route, distanceRatio);

  if (hardRefusals.length > 0 || severeDistanceGap) {
    return {
      type: 'refused',
      reason: hardRefusals[0] ?? 'assembled route does not meet minimal distance evidence',
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

  if (adjustmentReasons(intent, route, distanceRatio).length > 0) {
    return {
      type: 'adjusted',
      summary: 'Route assembled with explicit compromises; not marked generated.',
      compromises: details,
    };
  }

  return { type: 'generated', summary: 'Route assembled within V3 clean-room constraints.' };
}

function hardRefusalReasons(intent: RouteIntentV3, route: AssembledRouteV3, distanceRatio: number): string[] {
  const reasons: string[] = [];

  if ((route.segments.length === 0 && route.edges.length === 0) || poorGraph(intent)) {
    reasons.push(noAssemblyEvidenceReason(intent));
  }

  if (!hasUsableGpsGeometry(route)) {
    reasons.push('route refused: GPS geometry evidence is missing or unusable');
  }

  if (distanceRatio < STRICT_OUTCOME_RULES.refusedDistanceRatio) {
    reasons.push('assembled route is too short for the requested distance');
  }

  if (isTrailRequest(intent) && route.metrics.pavedRatio >= STRICT_OUTCOME_RULES.dominantPavedTrailRatio) {
    reasons.push('trail promise refused: paved evidence dominates the produced route');
  }

  if (isTrailRequest(intent) && roadLikeUnknownDominates(route)) {
    reasons.push('trail promise refused: road-like unknown evidence dominates the produced route');
  }

  if (route.metrics.repeatRatio >= STRICT_OUTCOME_RULES.repeatRefuseRatio || route.metrics.overlapRatio >= STRICT_OUTCOME_RULES.overlapRefuseRatio) {
    reasons.push('route is too repetitive to be a valid generated loop');
  }

  if (route.metrics.busyRoadRatio >= STRICT_OUTCOME_RULES.busyRoadRefuseRatio) {
    reasons.push('route uses too much busy road evidence');
  }

  if (isSmallParkOverclaim(intent, route)) {
    reasons.push('park route refused: a small park cannot honestly satisfy the requested trail distance');
  }

  return unique(reasons);
}

function adjustmentReasons(intent: RouteIntentV3, route: AssembledRouteV3, distanceRatio: number): string[] {
  const reasons: string[] = [];
  const requiredDwellKm = intent.constraints.targetDistanceKm * intent.constraints.minNaturalDwellRatio;

  if (distanceRatio < STRICT_OUTCOME_RULES.minimumGeneratedDistanceRatio) {
    reasons.push('under-distance route must be surfaced as adjusted');
  }

  if (route.metrics.pavedRatio > intent.constraints.maxPavedRatio) {
    reasons.push('paved ratio exceeds the route intent budget');
  }

  if (route.metrics.naturalDwellKm + 0.001 < requiredDwellKm) {
    reasons.push('natural dwell is below the route intent requirement');
  }

  if (route.metrics.repeatRatio > STRICT_OUTCOME_RULES.repeatAdjustRatio || route.metrics.overlapRatio > STRICT_OUTCOME_RULES.overlapAdjustRatio) {
    reasons.push('repeat or overlap exceeds generated-route limits');
  }

  if (route.metrics.busyRoadRatio > STRICT_OUTCOME_RULES.busyRoadAdjustRatio) {
    reasons.push('busy road share exceeds generated-route limits');
  }

  if (intent.constraints.targetComponents.length > 0 && missesRequestedTerrain(intent, route)) {
    reasons.push('assembled route misses the requested terrain components');
  }

  if (isTrailRequest(intent) && route.metrics.naturalWayRatio < intent.constraints.minNaturalDwellRatio) {
    reasons.push('trail route has too little natural-way evidence');
  }

  if (isTrailRequest(intent) && route.metrics.longestTrailSegmentKm + 0.001 < requiredDwellKm * 0.5) {
    reasons.push('trail route lacks a meaningful continuous trail segment');
  }

  if (isTrailRequest(intent) && (route.metrics.unverifiedTrailCandidateKm ?? 0) > (route.metrics.strictTrailKm ?? 0) + 0.5) {
    reasons.push('route depends on credible but unverified path/track trail candidates');
  }

  return unique(reasons);
}

function diagnostics(intent: RouteIntentV3, route: AssembledRouteV3): string[] {
  const details: string[] = [];
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const requiredDwellKm = targetDistanceKm * intent.constraints.minNaturalDwellRatio;

  if (poorGraph(intent)) {
    details.push(`poor graph evidence: confidence ${intent.snapshot.audit.confidence}, edgeCount ${intent.snapshot.audit.edgeCount}, totalLength ${intent.snapshot.audit.totalLengthKm}km`);
  }
  if (route.segments.length === 0 && route.edges.length === 0) {
    details.push('no assembled route evidence');
  }
  if (!hasUsableGpsGeometry(route)) {
    details.push(`GPS geometry has ${route.geometry.coordinates.length} coordinate point(s); at least 2 are required`);
  }
  if (route.metrics.distanceProducedKm < targetDistanceKm) {
    details.push(`distanceProduced ${route.metrics.distanceProducedKm}km below target ${targetDistanceKm}km`);
  }
  if (route.metrics.pavedRatio > intent.constraints.maxPavedRatio) {
    details.push(`pavedRatio ${route.metrics.pavedRatio} exceeds budget ${intent.constraints.maxPavedRatio}`);
  }
  if ((route.metrics.pathTrackUnknownKm ?? 0) > 0) {
    details.push(`pathTrackUnknown ${round(route.metrics.pathTrackUnknownKm ?? 0)}km; candidateNatural ${round(route.metrics.candidateNaturalKm ?? 0)}km kept separate from strictTrail ${round(route.metrics.strictTrailKm ?? 0)}km`);
  }
  if (roadLikeUnknownDominates(route)) {
    details.push(`roadLikeUnknown ${round(route.metrics.roadLikeUnknownKm ?? 0)}km dominates credible path/track evidence`);
  }
  if (route.metrics.naturalDwellKm + 0.001 < requiredDwellKm) {
    details.push(`naturalDwell ${route.metrics.naturalDwellKm}km below requested ${round(requiredDwellKm)}km`);
  }
  if (route.metrics.repeatRatio > STRICT_OUTCOME_RULES.repeatAdjustRatio) {
    details.push(`repeatRatio ${route.metrics.repeatRatio} exceeds generated limit ${STRICT_OUTCOME_RULES.repeatAdjustRatio}`);
  }
  if (route.metrics.overlapRatio > STRICT_OUTCOME_RULES.overlapAdjustRatio) {
    details.push(`overlapRatio ${route.metrics.overlapRatio} exceeds generated limit ${STRICT_OUTCOME_RULES.overlapAdjustRatio}`);
  }
  if (route.metrics.busyRoadRatio > STRICT_OUTCOME_RULES.busyRoadAdjustRatio) {
    details.push(`busyRoadRatio ${route.metrics.busyRoadRatio} exceeds generated limit ${STRICT_OUTCOME_RULES.busyRoadAdjustRatio}`);
  }
  if (intent.constraints.targetComponents.length > 0 && missesRequestedTerrain(intent, route)) {
    details.push(`visitedComponents ${route.metrics.visitedComponents.join(',') || 'none'} misses target ${intent.constraints.targetComponents.join(',')}`);
  }
  if (isTrailRequest(intent) && route.metrics.longestTrailSegmentKm + 0.001 < requiredDwellKm * 0.5) {
    details.push(`longestTrailSegment ${route.metrics.longestTrailSegmentKm}km too short for trail intent`);
  }
  if (isSmallParkOverclaim(intent, route)) {
    details.push(`park capacity cannot support ${targetDistanceKm}km trail request without fabricating distance`);
  }
  if (details.length === 0) details.push('minor assembly compromises');
  return details;
}

function poorGraph(intent: RouteIntentV3): boolean {
  return intent.snapshot.audit.confidence === 'low'
    && (intent.snapshot.audit.edgeCount < STRICT_OUTCOME_RULES.minimumGraphEdges || intent.snapshot.audit.totalLengthKm < STRICT_OUTCOME_RULES.minimumGraphLengthKm);
}

function isTrailRequest(intent: RouteIntentV3): boolean {
  return intent.request?.mode === 'trail';
}

function noAssemblyEvidenceReason(intent: RouteIntentV3): string {
  if (intent.strategy === 'park_loop') return 'park route refused: no assembled route can support the park-loop promise';
  if (intent.strategy === 'urban_nature_loop') return 'urban-nature route refused: no assembled route can support the urban corridor promise';
  if (intent.strategy === 'simple_quiet_loop' || intent.strategy === 'low_trail_potential') return 'quiet loop refused: no assembled route can support the requested loop';
  return 'poor graph evidence: no assembled route can support the requested trail promise';
}

function roadLikeUnknownDominates(route: AssembledRouteV3): boolean {
  const distance = route.metrics.distanceProducedKm;
  if (distance <= 0) return false;
  const roadLikeUnknownKm = route.metrics.roadLikeUnknownKm ?? 0;
  const pathTrackUnknownKm = route.metrics.pathTrackUnknownKm ?? 0;
  return roadLikeUnknownKm / distance >= 0.5 && roadLikeUnknownKm > pathTrackUnknownKm + 0.25;
}

function hasUsableGpsGeometry(route: AssembledRouteV3): boolean {
  return route.geometry.coordinates.length >= 2;
}

function missesRequestedTerrain(intent: RouteIntentV3, route: AssembledRouteV3): boolean {
  return !intent.constraints.targetComponents.some((target) => route.metrics.visitedComponents.includes(target));
}

function isSmallParkOverclaim(intent: RouteIntentV3, route: AssembledRouteV3): boolean {
  if (intent.strategy !== 'park_loop') return false;
  if (!isTrailRequest(intent)) return false;
  if (intent.constraints.targetDistanceKm <= STRICT_OUTCOME_RULES.smallParkMaxTrailDistanceKm) return false;

  const parkCapacityKm = intent.snapshot.components
    .filter((component) => component.kind === 'park')
    .reduce((sum, component) => sum + component.totalLengthKm, 0);
  const distanceWasReduced = route.metrics.distanceProducedKm < intent.constraints.targetDistanceKm;

  return !distanceWasReduced && parkCapacityKm < intent.constraints.targetDistanceKm;
}

interface BuildOutcomeEvidenceV3Input {
  missionId: string;
  selectedCandidate: RouteCandidateV3 | null;
  outcome: RouteOutcomeV3;
  hardGateFailures?: string[];
  commandSucceeded?: boolean;
}

export function buildOutcomeEvidenceV3(input: BuildOutcomeEvidenceV3Input): OutcomeEvidenceV3 {
  const hardGateFailures = unique([
    ...(input.hardGateFailures ?? []),
    ...((input.selectedCandidate?.gates ?? [])
      .filter((gate) => gate.status === 'fail' && gate.severity === 'hard')
      .map((gate) => gate.reason ?? gate.id)),
  ]);
  const adjustedWithoutCompromise = input.outcome.type === 'adjusted' && input.outcome.compromises.length === 0;
  const productOutcome: OutcomeEvidenceV3['productOutcome'] =
    input.outcome.type === 'generated' && hardGateFailures.length > 0
      ? 'refused'
      : adjustedWithoutCompromise
        ? 'refused'
        : input.outcome.type;
  const refused = productOutcome === 'refused';
  const reasons = reasonsFromOutcome(input.outcome, hardGateFailures, adjustedWithoutCompromise);
  const compromises = input.outcome.type === 'adjusted' && !adjustedWithoutCompromise
    ? unique(input.outcome.compromises)
    : [];
  const primaryReason = reasons[0] ?? compromises[0] ?? outcomeSummary(input.outcome) ?? 'outcome evidence recorded';

  return {
    missionId: input.missionId,
    selectedCandidateId: refused ? null : input.selectedCandidate?.id ?? null,
    productOutcome,
    primaryReason,
    userFacingSummary: summaryFromOutcome(productOutcome, input.outcome, primaryReason),
    reasons,
    compromises,
    hardGateFailures,
    benchmarkEvidence: {
      commandSucceeded: input.commandSucceeded,
      productVerdict: productVerdict(productOutcome),
    },
    exportPolicy: {
      geoJsonAvailable: !refused && hasCandidateGeometry(input.selectedCandidate),
      gpxAvailable: !refused && hasCandidateGeometry(input.selectedCandidate),
      emptyOnRefusal: refused,
    },
    surfaceEvidence: input.selectedCandidate ? {
      trailRatio: input.selectedCandidate.metrics.trailRatio,
      naturalWayRatio: input.selectedCandidate.metrics.naturalWayRatio,
      pavedRatio: input.selectedCandidate.metrics.pavedRatio,
      pavedKm: input.selectedCandidate.metrics.pavedKm,
      naturalDwellKm: input.selectedCandidate.metrics.naturalDwellKm,
    } : null,
  };
}

function reasonsFromOutcome(outcome: RouteOutcomeV3, hardGateFailures: string[], adjustedWithoutCompromise: boolean): string[] {
  if (hardGateFailures.length > 0) return hardGateFailures;
  if (adjustedWithoutCompromise) return ['adjusted outcome missing user-facing compromise'];
  if (outcome.type === 'refused') return unique([outcome.reason, ...(outcome.details ?? [])]);
  return [];
}

function summaryFromOutcome(productOutcome: OutcomeEvidenceV3['productOutcome'], outcome: RouteOutcomeV3, primaryReason: string): string {
  if (productOutcome === 'refused') return outcome.type === 'refused' ? outcome.reason : primaryReason;
  return outcomeSummary(outcome) ?? primaryReason;
}

function outcomeSummary(outcome: RouteOutcomeV3): string | null {
  return outcome.type === 'refused' ? null : outcome.summary;
}

function productVerdict(productOutcome: OutcomeEvidenceV3['productOutcome']): ProductVerdictV3 {
  if (productOutcome === 'generated') return 'good_route';
  if (productOutcome === 'adjusted') return 'acceptable_adjusted';
  return 'honest_refusal';
}

function hasCandidateGeometry(candidate: RouteCandidateV3 | null): boolean {
  return (candidate?.geometry.coordinates.length ?? 0) >= 2;
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
