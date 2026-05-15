import type { EnrichedGraph } from '../../types';
import type { AssembledRouteV3, CorridorMissionV3, RouteIntentV3 } from '../types';
import { assembleGraphRouteWithStrategyV3 } from './graph-route-assembly-core';

export function assembleParkLoopGraphRouteV3(
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  graph: EnrichedGraph,
): AssembledRouteV3 {
  return assembleGraphRouteWithStrategyV3(intent, mission, graph, {
    mode: 'park_loop',
    warning: 'park_loop may use paved park paths but keeps paved distance explicit instead of selling it as pure trail',
  });
}
