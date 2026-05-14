export type RouteModeV3 = 'trail' | 'nature_urbaine' | 'boucle_simple';
export type RouteSportV3 = 'running';
export type ConfidenceV3 = 'low' | 'medium' | 'high';

export type TerrainComponentKindV3 =
  | 'forest'
  | 'field_paths'
  | 'park'
  | 'urban_green'
  | 'river_corridor'
  | 'residential'
  | 'scenic_paved';

export type RouteStrategyV3 =
  | 'forest_loop'
  | 'transition_to_woods'
  | 'park_loop'
  | 'urban_nature_loop'
  | 'simple_quiet_loop'
  | 'low_trail_potential'
  | 'unroutable';

export interface UserRouteRequestV3 {
  start: { lat: number; lng: number };
  targetDistanceKm: number;
  activity?: RouteSportV3;
  sport?: RouteSportV3;
  mode: RouteModeV3;
  loop?: boolean;
}

export interface NormalizedRouteRequestV3 {
  start: { lat: number; lng: number };
  targetDistanceKm: number;
  sport: RouteSportV3;
  mode: RouteModeV3;
  loop: true;
}

export interface TerrainAuditV3 {
  confidence: ConfidenceV3;
  edgeCount: number;
  totalLengthKm: number;
  pavedRatio: number;
  nonPavedRatio: number;
  warnings: string[];
}

export interface TerrainComponentV3 {
  id: string;
  kind: TerrainComponentKindV3;
  distanceFromStartKm: number;
  edgeCount: number;
  totalLengthKm: number;
  pavedRatio: number;
  nonPavedRatio: number;
  confidence: ConfidenceV3;
}

export interface TerrainSnapshotV3 {
  audit: TerrainAuditV3;
  components: TerrainComponentV3[];
}

export type RouteOutcomeV3 =
  | { type: 'generated'; summary: string }
  | { type: 'adjusted'; summary: string; compromises: string[] }
  | { type: 'refused'; reason: string; details?: string[] };

export type NormalizedRequestResultV3 =
  | { status: 'accepted'; request: NormalizedRouteRequestV3 }
  | { status: 'refused'; outcome: Extract<RouteOutcomeV3, { type: 'refused' }> };

export interface RouteConstraintsV3 {
  targetDistanceKm: number;
  targetComponents: TerrainComponentKindV3[];
  maxPavedRatio: number;
  cleanReturn: 'strict' | 'prefer' | 'relaxed';
  minNaturalDwellRatio: number;
}

export interface RouteIntentV3 {
  engine: 'v3-clean-room';
  strategy: RouteStrategyV3;
  request: NormalizedRouteRequestV3 | null;
  snapshot: TerrainSnapshotV3;
  constraints: RouteConstraintsV3;
  outcome: RouteOutcomeV3;
  warnings: string[];
}

export interface RouteAnchorV3 {
  componentId: string;
  kind: TerrainComponentKindV3;
  distanceFromStartKm: number;
  naturalCapacityKm: number;
  pavedRatio: number;
  nonPavedRatio: number;
}

export interface CorridorMissionV3 {
  engine: 'v3-clean-room';
  strategy: RouteStrategyV3;
  targetDistanceKm: number;
  targetComponents: TerrainComponentKindV3[];
  anchor: RouteAnchorV3 | null;
  budgetPavedKm: number;
  requestedNaturalDwellKm: number;
  cleanReturn: RouteConstraintsV3['cleanReturn'];
  returnMode: 'clean_loop' | 'out_and_back_connector' | 'relaxed_loop';
  warnings: string[];
}

export type RouteSegmentKindV3 = 'access' | 'natural_dwell' | 'loop_fill' | 'return';
export type RouteSurfaceV3 = 'paved' | 'natural' | 'mixed';

export interface RouteSegmentV3 {
  kind: RouteSegmentKindV3;
  surface: RouteSurfaceV3;
  distanceKm: number;
  componentId?: string;
}

export interface RouteMetricsV3 {
  targetDistanceKm: number;
  distanceProducedKm: number;
  trailRatio: number;
  naturalWayRatio: number;
  pavedRatio: number;
  nonPavedKm: number;
  naturalDwellKm: number;
  repeatRatio?: number;
  overlapRatio?: number;
}

export interface AssembledRouteV3 {
  engine: 'v3-clean-room';
  strategy: RouteStrategyV3;
  mission: CorridorMissionV3;
  segments: RouteSegmentV3[];
  metrics: RouteMetricsV3;
  warnings: string[];
}
