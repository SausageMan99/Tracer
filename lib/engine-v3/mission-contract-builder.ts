import type { MissionContractV3, MissionPhaseV3, MissionPromiseV3 } from './contracts';
import type { NormalizedRouteRequestV3, RouteIntentV3, RouteStrategyV3 } from './types';

type SupportedMissionStrategyV3 = Exclude<MissionContractV3['strategy'], 'poor_osm_rural'>;

const SUPPORTED_STRATEGIES = new Set<RouteStrategyV3>([
  'forest_loop',
  'transition_to_woods',
  'park_loop',
  'urban_nature_loop',
  'simple_quiet_loop',
]);

const DEFAULT_PHASES: MissionPhaseV3[] = ['access', 'target_dwell', 'distance_recovery', 'closure', 'final_gate'];

export function buildMissionContractV3(intent: RouteIntentV3): MissionContractV3 | null {
  if (!intent.request) return null;
  if (!isSupportedMissionStrategy(intent.strategy)) return null;

  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const minDistanceKm = round(targetDistanceKm * 0.85);
  const maxDistanceKm = round(targetDistanceKm * 1.15);
  const maxPavedKm = round(targetDistanceKm * intent.constraints.maxPavedRatio);
  const minNaturalDwellKm = round(targetDistanceKm * intent.constraints.minNaturalDwellRatio);

  return {
    id: `mission-${intent.strategy}-${targetDistanceKm}k`,
    version: 'v3-mission-v1',
    strategy: intent.strategy,
    promise: promiseFor(intent),
    request: {
      ...cloneRequest(intent.request),
      minDistanceKm,
      maxDistanceKm,
    },
    phases: DEFAULT_PHASES,
    target: {
      componentIds: intent.snapshot.components
        .filter((component) => intent.constraints.targetComponents.includes(component.kind))
        .map((component) => component.id),
      componentKinds: [...intent.constraints.targetComponents],
      requiredEntry: intent.constraints.targetComponents.length > 0 ? 'mandatory' : 'preferred',
      minNaturalDwellKm,
      minContinuousTrailKm: round(Math.max(0.5, minNaturalDwellKm * 0.35)),
    },
    budgets: {
      maxPavedKm,
      maxPavedRatio: intent.constraints.maxPavedRatio,
      maxBusyRoadRatio: 0.05,
      maxRepeatKm: round(targetDistanceKm * 0.2),
      maxTargetRepeatKm: intent.strategy === 'transition_to_woods' ? 0.1 : round(targetDistanceKm * 0.08),
      maxConnectorRepeatKm: intent.strategy === 'transition_to_woods' ? round(targetDistanceKm * 0.2) : round(targetDistanceKm * 0.1),
      maxOverlapRatio: 0.12,
      maxAccessPavedKm: round(Math.max(1.2, maxPavedKm * 0.6)),
      maxClosurePavedKm: round(Math.max(1.2, maxPavedKm * 0.6)),
      maxTargetPavedKm: round(Math.max(0.25, maxPavedKm * 0.15)),
    },
    closure: {
      required: true,
      mode: closureModeFor(intent),
      maxClosureKm: round(Math.max(1.5, targetDistanceKm * 0.2)),
    },
    relaxations: [],
    refusalPolicy: {
      refuseIfNoTargetEntry: intent.constraints.targetComponents.length > 0,
      refuseIfUnderMinDistance: true,
      refuseIfDominantPavedTrail: intent.request.mode === 'trail',
      refuseIfMissingGpsGeometry: true,
    },
  };
}

function isSupportedMissionStrategy(strategy: RouteStrategyV3): strategy is SupportedMissionStrategyV3 {
  return SUPPORTED_STRATEGIES.has(strategy);
}

function promiseFor(intent: RouteIntentV3): MissionPromiseV3 {
  if (intent.strategy === 'forest_loop') return 'pure_trail';
  if (intent.strategy === 'transition_to_woods') return 'trail_with_connector';
  if (intent.strategy === 'park_loop') return 'park_compromise';
  if (intent.strategy === 'urban_nature_loop') return 'urban_nature';
  return 'best_effort_non_trail';
}

function closureModeFor(intent: RouteIntentV3): MissionContractV3['closure']['mode'] {
  if (intent.strategy === 'transition_to_woods') return 'connector_repeat_allowed';
  if (intent.constraints.cleanReturn === 'relaxed') return 'relaxed_urban_loop';
  return 'clean_loop';
}

function cloneRequest(request: NormalizedRouteRequestV3): NormalizedRouteRequestV3 {
  return {
    ...request,
    start: { ...request.start },
  };
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
