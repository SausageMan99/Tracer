import { assembleRouteV3 } from './route-assembler';
import { buildCorridorMissionV3 } from './corridor-anchor-builder';
import { decideOutcomeV3 } from './outcome-decider';
import { planRouteIntentV3 } from './route-intent-planner';
import type {
  AssembledRouteV3,
  CorridorMissionV3,
  RouteIntentV3,
  RouteOutcomeV3,
  TerrainSnapshotV3,
  UserRouteRequestV3,
} from './types';

export interface GeneratedRouteV3 {
  engine: 'v3-clean-room';
  intent: RouteIntentV3;
  mission: CorridorMissionV3;
  route: AssembledRouteV3;
  outcome: RouteOutcomeV3;
}

export function generateRouteV3(request: UserRouteRequestV3, snapshot: TerrainSnapshotV3): GeneratedRouteV3 {
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
  };
}
