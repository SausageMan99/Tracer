export { normalizeRequestV3 } from './request-normalizer';
export { planRouteIntentV3 } from './route-intent-planner';
export { buildCorridorMissionV3 } from './corridor-anchor-builder';
export { assembleRouteV3 } from './route-assembler';
export { assembleGraphRouteV3 } from './graph-route-assembler';
export { computeRouteMetricsV3, createEmptyRouteMetricsV3 } from './route-metrics';
export { decideOutcomeV3 } from './outcome-decider';
export { generateRouteV3, generateRouteV3FromGraph } from './route-generator';
export { buildTerrainSnapshotV3FromGraph } from './terrain-snapshot-builder';
export { ENGINE_V3_SMOKE_CASES, runEngineV3SmokePanel } from './smoke-harness';
export type { GeneratedRouteV3 } from './route-generator';
export type { EngineV3SmokeCase, EngineV3SmokeDiagnostic, EngineV3SmokeReport, RunEngineV3SmokePanelOptions } from './smoke-harness';
export type {
  AssembledRouteV3,
  ConfidenceV3,
  CorridorMissionV3,
  NormalizedRequestResultV3,
  NormalizedRouteRequestV3,
  RouteAnchorV3,
  RouteConstraintsV3,
  RouteEdgeV3,
  RouteGeometryV3,
  RouteIntentV3,
  RouteMetricsV3,
  RouteModeV3,
  RouteOutcomeV3,
  RouteGenerationDiagnosticsV3,
  RouteOutcomeEvidenceV3,
  RouteSegmentKindV3,
  RouteSegmentV3,
  RouteSportV3,
  RouteStrategyV3,
  RouteSurfaceV3,
  TerrainAuditV3,
  TerrainComponentKindV3,
  TerrainComponentV3,
  TerrainSnapshotSourceV3,
  TerrainSnapshotV3,
  UserRouteRequestV3,
} from './types';
