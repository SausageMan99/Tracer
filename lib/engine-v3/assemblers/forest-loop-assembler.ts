import type { EnrichedGraph } from '../../types';
import type { AssembledRouteV3, CorridorMissionV3, RouteIntentV3 } from '../types';
import { assembleGraphRouteWithStrategyV3 } from './graph-route-assembly-core';

export function assembleForestLoopGraphRouteV3(
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  graph: EnrichedGraph,
): AssembledRouteV3 {
  return assembleGraphRouteWithStrategyV3(intent, mission, graph, {
    mode: 'forest_loop',
    warning: 'forest_loop keeps the route inside proven natural forest/path terrain when available',
  });
}
