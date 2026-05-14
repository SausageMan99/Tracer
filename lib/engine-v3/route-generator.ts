import { assembleRouteV3 } from './route-assembler';
import { buildCorridorMissionV3 } from './corridor-anchor-builder';
import { decideOutcomeV3 } from './outcome-decider';
import { planRouteIntentV3 } from './route-intent-planner';
import { buildTerrainSnapshotV3FromGraph } from './terrain-snapshot-builder';
import type { EnrichedGraph } from '../types';
import type {
  AssembledRouteV3,
  CorridorMissionV3,
  RouteGenerationDiagnosticsV3,
  RouteIntentV3,
  RouteOutcomeV3,
  TerrainSnapshotSourceV3,
  TerrainSnapshotV3,
  UserRouteRequestV3,
} from './types';

export interface GeneratedRouteV3 {
  engine: 'v3-clean-room';
  intent: RouteIntentV3;
  mission: CorridorMissionV3;
  route: AssembledRouteV3;
  outcome: RouteOutcomeV3;
  diagnostics: RouteGenerationDiagnosticsV3;
}

export function generateRouteV3(request: UserRouteRequestV3, snapshot: TerrainSnapshotV3): GeneratedRouteV3 {
  return generateRouteV3WithSnapshotSource(request, snapshot, 'injected_snapshot');
}

export function generateRouteV3FromGraph(request: UserRouteRequestV3, graph: EnrichedGraph): GeneratedRouteV3 {
  return generateRouteV3WithSnapshotSource(request, buildTerrainSnapshotV3FromGraph(graph), 'graph_adapter');
}

function generateRouteV3WithSnapshotSource(
  request: UserRouteRequestV3,
  snapshot: TerrainSnapshotV3,
  snapshotSource: TerrainSnapshotSourceV3,
): GeneratedRouteV3 {
  const intent = planRouteIntentV3(request, snapshot);
  const mission = buildCorridorMissionV3(intent);
  const route = assembleRouteV3(intent, mission);
  const outcome = decideOutcomeV3(intent, route);

  return {
    engine: 'v3-clean-room',
    intent,
    mission,
    route,
    outcome,
    diagnostics: buildDiagnostics(snapshotSource, intent, mission, route, outcome),
  };
}

function buildDiagnostics(
  snapshotSource: TerrainSnapshotSourceV3,
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  route: AssembledRouteV3,
  outcome: RouteOutcomeV3,
): RouteGenerationDiagnosticsV3 {
  return {
    snapshotSource,
    assemblyStatus: 'segment_level_not_gps_geometry',
    limitations: [
      'V3 integration slice is not production-ready: route assembly is segment-level, not GPS geometry.',
      'Graph adapter summarizes available edge evidence; it does not run a graph solver yet.',
      'Paved/asphalt evidence remains paved and is not reclassified as trail.',
    ],
    warnings: unique([...intent.warnings, ...mission.warnings, ...route.warnings]),
    metrics: { ...route.metrics },
    outcomeEvidence: { reasonsOrCompromises: reasonsOrCompromises(outcome) },
  };
}

function reasonsOrCompromises(outcome: RouteOutcomeV3): string[] {
  if (outcome.type === 'adjusted') return [...outcome.compromises];
  if (outcome.type === 'refused') return [outcome.reason, ...(outcome.details ?? [])];
  return [outcome.summary];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
