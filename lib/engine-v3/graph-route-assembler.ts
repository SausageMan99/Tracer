import type { EnrichedGraph } from '../types';
import { assembleForestLoopGraphRouteV3 } from './assemblers/forest-loop-assembler';
import { assembleLowTrailPotentialGraphRouteV3 } from './assemblers/low-trail-potential-assembler';
import { assembleParkLoopGraphRouteV3 } from './assemblers/park-loop-assembler';
import { assembleTransitionToWoodsGraphRouteV3 } from './assemblers/transition-to-woods-assembler';
import { assembleGraphRouteWithStrategyV3 } from './assemblers/graph-route-assembly-core';
import type { AssembledRouteV3, CorridorMissionV3, RouteIntentV3 } from './types';

export function assembleGraphRouteV3(intent: RouteIntentV3, mission: CorridorMissionV3, graph: EnrichedGraph): AssembledRouteV3 {
  switch (intent.strategy) {
    case 'forest_loop':
      return assembleForestLoopGraphRouteV3(intent, mission, graph);
    case 'transition_to_woods':
      return assembleTransitionToWoodsGraphRouteV3(intent, mission, graph);
    case 'park_loop':
      return assembleParkLoopGraphRouteV3(intent, mission, graph);
    case 'low_trail_potential':
      return assembleLowTrailPotentialGraphRouteV3(intent, mission, graph);
    default:
      return assembleGraphRouteWithStrategyV3(intent, mission, graph, { mode: 'generic' });
  }
}
