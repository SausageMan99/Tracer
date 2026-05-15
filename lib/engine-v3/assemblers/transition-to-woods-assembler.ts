import type { EnrichedGraph } from '../../types';
import type { AssembledRouteV3, CorridorMissionV3, RouteIntentV3 } from '../types';
import { assembleGraphRouteWithStrategyV3 } from './graph-route-assembly-core';

export function assembleTransitionToWoodsGraphRouteV3(
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  graph: EnrichedGraph,
): AssembledRouteV3 {
  return assembleGraphRouteWithStrategyV3(intent, mission, graph, {
    mode: 'transition_to_woods',
    requireNaturalDwell: true,
    warning: 'transition_to_woods allows paved access only as a connector before requiring real non-paved woods dwell',
  });
}
