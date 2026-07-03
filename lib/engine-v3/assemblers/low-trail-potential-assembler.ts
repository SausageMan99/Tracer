import type { EnrichedGraph } from '../../types';
import type { AssembledRouteV3, CorridorMissionV3, RouteIntentV3 } from '../types';
import { assembleGraphRouteWithStrategyV3 } from './graph-route-assembly-core';

/**
 * low_trail_potential graph assembler.
 *
 * When the planner falls back to low_trail_potential (e.g. the snapshot has
 * no forest component but a field_paths / urban_green / park component was
 * still selected as anchor), the dedicated forest_loop / transition_to_woods
 * filters don't apply. This assembler mirrors their spirit: prefer
 * path-like highways (path, track, footway, bridleway, pedestrian) and
 * accept both natural and mixed (unset) surfaces on those edges. Paved
 * edges are accepted as a fallback when no path-like candidate exists.
 *
 * Behaviour summary:
 *  - filterCandidatesForStrategy keeps path-like + natural|mixed first;
 *    falls back to any path-like; falls back to all candidates.
 *  - chooseNextEdge scoring is unchanged from generic, but the
 *    mission.targetComponents now includes the selected anchor.kind
 *    (set in corridor-anchor-builder), so the existing aTarget boost
 *    steers the walk towards anchor-matching kinds.
 *  - The closed-loop greedy walk and topology gate are untouched.
 *
 * This is an additive strategy: it does not modify forest_loop,
 * transition_to_woods, park_loop, or generic behaviour.
 */
export function assembleLowTrailPotentialGraphRouteV3(
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  graph: EnrichedGraph,
): AssembledRouteV3 {
  return assembleGraphRouteWithStrategyV3(intent, mission, graph, {
    mode: 'low_trail_potential',
    warning:
      'low_trail_potential prefers path/track/footway edges inside the selected anchor and accepts unset surface as probable natural; paved edges are a fallback only',
    lowTrailEscape: {
      blacklist: new Set<string>(),
      branchStack: [],
      escapesUsed: 0,
      maxEscapes: 5,
    },
  });
}
