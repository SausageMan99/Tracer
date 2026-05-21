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

export type ProductOutcomeLabelV3 =
  | 'generated_trail'
  | 'generated_urban_nature'
  | 'adjusted_trail'
  | 'adjusted_urban_nature'
  | 'adjusted_paved_scenic'
  | 'adjusted_short'
  | 'refused_topology'
  | 'refused_poor_graph'
  | 'refused_repeat_overlap'
  | 'refused_no_geometry'
  | 'refused_assembly_timeout'
  | 'refused_other';

export type RouteOutcomeV3 =
  | { type: 'generated'; summary: string; productLabel?: ProductOutcomeLabelV3 }
  | { type: 'adjusted'; summary: string; compromises: string[]; productLabel?: ProductOutcomeLabelV3 }
  | { type: 'refused'; reason: string; details?: string[]; productLabel?: ProductOutcomeLabelV3 };

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
  totalLengthKm: number;
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
  strictTrailKm?: number;
  explicitNaturalKm?: number;
  explicitPavedKm?: number;
  roadLikeUnknownKm?: number;
  pathTrackUnknownKm?: number;
  candidateNaturalKm?: number;
  trailCandidateKm?: number;
  unverifiedTrailCandidateKm?: number;
  trailRatio: number;
  naturalWayRatio: number;
  pavedRatio: number;
  pavedKm: number;
  nonPavedKm: number;
  naturalDwellKm: number;
  repeatEdgeKm: number;
  targetRepeatKm: number;
  connectorRepeatKm: number;
  visitedComponents: TerrainComponentKindV3[];
  repeatRatio: number;
  overlapRatio: number;
  busyRoadRatio: number;
  loopClosureKm: number;
  longestTrailSegmentKm: number;
}

export interface RouteEdgeV3 {
  id: string;
  from: string;
  to: string;
  lengthKm: number;
  surface: RouteSurfaceV3;
  componentKind: TerrainComponentKindV3;
  highway: string;
  osmWayId: number;
  /** Original OSM surface tag when available; keeps export diagnostics honest instead of collapsing to route surface. */
  osmSurface?: string;
}

export interface RouteGeometryV3 {
  type: 'LineString';
  coordinates: number[][];
}

export interface RouteAssemblyDiagnosticsV3 {
  startNodeId: string | null;
  distanceToFirstNonPavedTargetKm: number | null;
  reachableNonPavedTargetEdgeCount: number;
  reachableNonPavedTargetKm: number;
  frontierTrace?: RouteAssemblyFrontierStepDiagnosticsV3[];
  topFinalCandidates?: RouteAssemblyFinalCandidateDiagnosticsV3[];
  targetComponentHandoff?: RouteAssemblyTargetComponentHandoffDiagnosticsV3;
  candidateCount?: number;
  inEnvelopeCount?: number;
  overlongCount?: number;
  underMinCount?: number;
  candidateCountByLane?: Record<string, number>;
  paretoFrontierCandidates?: RouteAssemblyFinalCandidateDiagnosticsV3[];
  selectedCandidateId?: string | null;
  selectedReason?: string | null;
  rejectedDominatedCandidates?: string[];
  topRejected?: RouteAssemblyFinalCandidateDiagnosticsV3[];
  closureAttemptCount?: number;
  returnedClosureCount?: number;
  closureRejectedReasons?: Record<string, number>;
  recoveryExpansionKm?: number;
  recoveryBudgetKm?: number;
  firstDropStage?: string | null;
  enteredTargetComponent?: boolean;
  targetComponentDwellKm?: number;
  targetCapacityKm?: number;
  closureBlockedUntilDwell?: boolean;
  selectedTargetCandidate?: string | null;
  failureStage?: string | null;
  assemblyTimeout?: {
    stage: string;
    reason: 'iteration_budget_exceeded' | 'time_budget_exceeded';
    iterations: number;
    maxIterations: number;
    elapsedMs: number;
    maxMs: number;
    candidateCount: number;
    frontierSize: number;
    cycleCount: number;
    depth: number | null;
    lastProgress: string;
  };
  candidateProductionDiagnostics?: Record<string, unknown>;
}

export interface RouteAssemblyTargetComponentHandoffDiagnosticsV3 {
  selectedTargetComponentIds: TerrainComponentKindV3[];
  targetComponentKinds: TerrainComponentKindV3[];
  componentCandidateCount: number;
  componentCandidates: RouteAssemblyTargetComponentCandidateDiagnosticsV3[];
  blocker: string | null;
}

export interface RouteAssemblyTargetComponentCandidateDiagnosticsV3 {
  rank: number;
  componentId: string;
  selected: boolean;
  rejectedReason: string | null;
  entryNodeId: string;
  entryDistanceKm: number;
  targetComponentKinds: TerrainComponentKindV3[];
  reachableTargetKm: number;
  cleanExploitableKm: number;
  componentTargetKmRaw?: number;
  componentTargetKmFinal?: number;
  targetDistanceKm?: number;
  minDistanceKm?: number;
  maxDistanceKm?: number;
  usedEdgeKeyCount?: number;
  traversalInputNodeCount: number;
  traversalInputEdgeCount: number;
  traversalResult: {
    status: 'success' | 'failure';
    distanceKm: number;
    targetKm: number;
    repeatedTargetKm: number;
    blocker: string | null;
  };
  closureAttempt: {
    status: 'success' | 'failure' | 'not_attempted';
    closureDistanceKm: number;
    connectorRepeatKm: number;
    targetRepeatKm: number;
  };
}

export interface RouteAssemblyFinalCandidateDiagnosticsV3 {
  id: string;
  rank: number;
  selected: boolean;
  inSelectionPool: boolean;
  rejectedReason: string | null;
  gate: string | null;
  distanceKm: number;
  naturalDwellKm: number;
  pavedKm: number;
  pavedRatio: number;
  finalPavedRatioEstimate: number;
  mixedUnknownKm: number;
  strictTrailKm: number;
  longestTrailSegmentKm: number;
  repeatKm: number;
  targetRepeatKm: number;
  connectorRepeatKm: number;
  returned: boolean;
  scoreComplete: number;
  scoreProgress: number;
  source?: string;
  distanceErrorRatio?: number;
  pavedConnectorKm?: number;
  busyRoadRatio?: number;
  closureQuality?: number;
  selectedReason?: string | null;
  dominatedBy?: string | null;
}

export interface RouteAssemblyFrontierStepDiagnosticsV3 {
  step: number;
  frontierSize: number;
  maxDistanceKm: number;
  maxNaturalDwellKm: number;
  bestReturnedDistanceKm: number | null;
  bestReturnedNaturalDwellKm: number | null;
  countEnteredTarget: number;
  countReturned: number;
  topCandidateIds: string[];
}

export interface AssembledRouteV3 {
  engine: 'v3-clean-room';
  strategy: RouteStrategyV3;
  mission: CorridorMissionV3;
  segments: RouteSegmentV3[];
  edges: RouteEdgeV3[];
  nodeIds: string[];
  geometry: RouteGeometryV3;
  surfaces: {
    pavedKm: number;
    nonPavedKm: number;
    naturalDwellKm: number;
  };
  metrics: RouteMetricsV3;
  assemblyDiagnostics?: RouteAssemblyDiagnosticsV3;
  warnings: string[];
}

export type TerrainSnapshotSourceV3 = 'injected_snapshot' | 'graph_adapter';

export interface RouteOutcomeEvidenceV3 {
  reasonsOrCompromises: string[];
}

export interface RouteGenerationDiagnosticsV3 {
  snapshotSource: TerrainSnapshotSourceV3;
  assemblyStatus: 'segment_level_not_gps_geometry' | 'graph_route_assembled' | 'graph_route_unassembled';
  limitations: string[];
  warnings: string[];
  metrics: RouteMetricsV3;
  assemblyDiagnostics?: RouteAssemblyDiagnosticsV3;
  terrainInventory?: import('./assemblers/terrain-inventory').TerrainInventoryV3;
  routeContractPrecheck?: import('./contracts/route-contract').RouteContractPrecheckV3;
  outcomeEvidence: RouteOutcomeEvidenceV3;
}
