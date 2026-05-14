export { normalizeRequestV3 } from './request-normalizer';
export { planRouteIntentV3 } from './route-intent-planner';
export { buildCorridorMissionV3 } from './corridor-anchor-builder';
export { assembleRouteV3 } from './route-assembler';
export { decideOutcomeV3 } from './outcome-decider';
export type {
  AssembledRouteV3,
  ConfidenceV3,
  CorridorMissionV3,
  NormalizedRequestResultV3,
  NormalizedRouteRequestV3,
  RouteAnchorV3,
  RouteConstraintsV3,
  RouteIntentV3,
  RouteMetricsV3,
  RouteModeV3,
  RouteOutcomeV3,
  RouteSegmentKindV3,
  RouteSegmentV3,
  RouteSportV3,
  RouteStrategyV3,
  RouteSurfaceV3,
  TerrainAuditV3,
  TerrainComponentKindV3,
  TerrainComponentV3,
  TerrainSnapshotV3,
  UserRouteRequestV3,
} from './types';
