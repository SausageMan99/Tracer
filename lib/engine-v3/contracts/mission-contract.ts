import type {
  NormalizedRouteRequestV3,
  RouteModeV3,
  RouteStrategyV3,
  TerrainComponentKindV3,
} from '../types';

export type MissionPhaseV3 = 'access' | 'target_dwell' | 'distance_recovery' | 'closure' | 'final_gate';

export type MissionPromiseV3 =
  | 'pure_trail'
  | 'trail_with_connector'
  | 'park_compromise'
  | 'urban_nature'
  | 'best_effort_non_trail'
  | 'impossible';

export interface MissionContractV3 {
  id: string;
  version: 'v3-mission-v1';
  strategy: Exclude<RouteStrategyV3, 'low_trail_potential' | 'unroutable'> | 'poor_osm_rural';
  promise: MissionPromiseV3;
  request: NormalizedRouteRequestV3 & {
    minDistanceKm: number;
    maxDistanceKm: number;
    mode: RouteModeV3;
  };
  phases: MissionPhaseV3[];
  target: {
    componentIds: string[];
    componentKinds: TerrainComponentKindV3[];
    requiredEntry: 'mandatory' | 'preferred' | 'none';
    minNaturalDwellKm: number;
    minContinuousTrailKm: number;
  };
  budgets: {
    maxPavedKm: number;
    maxPavedRatio: number;
    maxBusyRoadRatio: number;
    maxRepeatKm: number;
    maxTargetRepeatKm: number;
    maxConnectorRepeatKm: number;
    maxOverlapRatio: number;
    maxAccessPavedKm: number;
    maxClosurePavedKm: number;
    maxTargetPavedKm: number;
  };
  closure: {
    required: true;
    mode: 'clean_loop' | 'connector_repeat_allowed' | 'relaxed_urban_loop';
    maxClosureKm: number;
  };
  relaxations: Array<{
    id: string;
    allowed: boolean;
    order: number;
    userFacingCompromise: string;
  }>;
  refusalPolicy: {
    refuseIfNoTargetEntry: boolean;
    refuseIfUnderMinDistance: boolean;
    refuseIfDominantPavedTrail: boolean;
    refuseIfMissingGpsGeometry: boolean;
  };
}
