import { assembleRouteV3 } from './route-assembler';
import { assembleGraphRouteV3 } from './graph-route-assembler';
import { assembleMissionV3 } from './assemblers/mission-dispatcher';
import { buildCorridorMissionV3 } from './corridor-anchor-builder';
import { buildMissionContractV3 } from './mission-contract-builder';
import {
  buildForestLoopRouteContractV3,
  precheckForestLoopRouteContractV3,
} from './contracts/route-contract';
import { assembledRouteFromMissionCandidateV3 } from './mission-candidate-route-adapter';
import { decideOutcomeV3 } from './outcome-decider';
import { planRouteIntentV3 } from './route-intent-planner';
import { buildTerrainSnapshotV3FromGraph } from './terrain-snapshot-builder';
import { buildTerrainInventoryV3 } from './assemblers/terrain-inventory';
import type { EnrichedGraph } from '../types';
import type {
  AssembledRouteV3,
  CorridorMissionV3,
  RouteGenerationDiagnosticsV3,
  RouteAssemblyDiagnosticsV3,
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
  const snapshot = buildTerrainSnapshotV3FromGraph(graph);
  const intent = planRouteIntentV3(request, snapshot);
  const mission = buildCorridorMissionV3(intent);
  const missionContract = buildMissionContractV3(intent);
  const missionResult = missionContract ? assembleMissionV3(graph, missionContract) : null;
  const route = missionResult?.selectedCandidate
    ? assembledRouteFromMissionCandidateV3({
        intent,
        corridorMission: mission,
        graph,
        assemblerResult: missionResult,
        candidate: missionResult.selectedCandidate,
      })
    : withMissionCandidateProductionDiagnostics(assembleGraphRouteV3(intent, mission, graph), missionResult);
  const outcome = decideOutcomeV3(intent, route);
  const diagnostics = buildDiagnostics('graph_adapter', intent, mission, route, outcome);
  if (request.mode === 'trail' && (process.env.TRAILFORGE_V3_TERRAIN_INVENTORY === '1' || process.env.TRAILFORGE_V3_ROUTE_CONTRACT === '1')) {
    const terrainInventory = buildTerrainInventoryV3({
      graph,
      startNodeId: route.nodeIds[0] ?? closestNodeId(graph, request.start) ?? firstNodeId(graph) ?? '',
      targetComponentIds: inventoryTargetComponentIds(intent.constraints.targetComponents),
    });
    if (process.env.TRAILFORGE_V3_TERRAIN_INVENTORY === '1') {
      diagnostics.terrainInventory = terrainInventory;
    }
    if (process.env.TRAILFORGE_V3_ROUTE_CONTRACT === '1') {
      diagnostics.routeContractPrecheck = precheckForestLoopRouteContractV3({
        contract: buildForestLoopRouteContractV3({
          requestedDistanceKm: request.targetDistanceKm,
          targetComponentIds: inventoryTargetComponentIds(intent.constraints.targetComponents),
        }),
        inventory: terrainInventory,
      });
    }
  }

  return {
    engine: 'v3-clean-room',
    intent,
    mission,
    route,
    outcome,
    diagnostics,
  };
}

function withMissionCandidateProductionDiagnostics(
  route: AssembledRouteV3,
  missionResult: ReturnType<typeof assembleMissionV3> | null,
): AssembledRouteV3 {
  if (!missionResult || Object.keys(missionResult.diagnostics.observationOnly).length === 0) return route;
  const observation = missionResult.diagnostics.observationOnly;
  const assemblyDiagnostics: RouteAssemblyDiagnosticsV3 = route.assemblyDiagnostics ?? {
    startNodeId: null,
    distanceToFirstNonPavedTargetKm: null,
    reachableNonPavedTargetEdgeCount: 0,
    reachableNonPavedTargetKm: 0,
  };
  return {
    ...route,
    assemblyDiagnostics: {
      ...assemblyDiagnostics,
      candidateProductionDiagnostics: observation,
      returnedClosureCount: typeof observation.returnedClosureCount === 'number'
        ? observation.returnedClosureCount
        : assemblyDiagnostics.returnedClosureCount,
      closureRejectedReasons: isRecord(observation.closureRejectedReasons)
        ? observation.closureRejectedReasons as Record<string, number>
        : assemblyDiagnostics.closureRejectedReasons,
      firstDropStage: assemblyDiagnostics.firstDropStage ?? missionResult.diagnostics.firstDropStage,
    },
    warnings: unique([...route.warnings, ...missionResult.warnings]),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
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
    assemblyStatus: assemblyStatus(snapshotSource, route),
    limitations: limitations(snapshotSource, route),
    warnings: unique([...intent.warnings, ...mission.warnings, ...route.warnings]),
    metrics: { ...route.metrics },
    assemblyDiagnostics: route.assemblyDiagnostics ? { ...route.assemblyDiagnostics } : undefined,
    outcomeEvidence: { reasonsOrCompromises: reasonsOrCompromises(outcome) },
  };
}

function assemblyStatus(snapshotSource: TerrainSnapshotSourceV3, route: AssembledRouteV3): RouteGenerationDiagnosticsV3['assemblyStatus'] {
  if (snapshotSource === 'graph_adapter') return route.edges.length > 0 ? 'graph_route_assembled' : 'graph_route_unassembled';
  return 'segment_level_not_gps_geometry';
}

function limitations(snapshotSource: TerrainSnapshotSourceV3, route: AssembledRouteV3): string[] {
  if (snapshotSource === 'graph_adapter') {
    const base = ['Paved/asphalt evidence remains paved and is not reclassified as trail.'];
    if (route.edges.length === 0) return ['Graph route assembly refused to fabricate GPS geometry from insufficient graph evidence.', ...base];
    return ['V3 graph adapter assembled ordered graph edges into GPS geometry; API wiring remains intentionally disabled.', ...base];
  }
  return [
    'V3 injected-snapshot path is not production-ready: route assembly is segment-level, not GPS geometry.',
    'Use generateRouteV3FromGraph for real graph edge/node assembly.',
    'Paved/asphalt evidence remains paved and is not reclassified as trail.',
  ];
}

function reasonsOrCompromises(outcome: RouteOutcomeV3): string[] {
  if (outcome.type === 'adjusted') return [...outcome.compromises];
  if (outcome.type === 'refused') return [outcome.reason, ...(outcome.details ?? [])];
  return [outcome.summary];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function closestNodeId(graph: EnrichedGraph, point: { lat: number; lng: number }): string | null {
  let best: { id: string; distance: number } | null = null;
  for (const node of Array.from(graph.nodes.values())) {
    const distance = Math.hypot(node.lat - point.lat, node.lng - point.lng);
    if (!best || distance < best.distance) best = { id: node.id, distance };
  }
  return best?.id ?? null;
}

function firstNodeId(graph: EnrichedGraph): string | null {
  return Array.from(graph.nodes.keys())[0] ?? null;
}

function inventoryTargetComponentIds(componentIds: RouteIntentV3['constraints']['targetComponents']): RouteIntentV3['constraints']['targetComponents'] {
  const defaults: RouteIntentV3['constraints']['targetComponents'] = ['forest', 'field_paths'];
  return Array.from(new Set([...componentIds, ...defaults]));
}
