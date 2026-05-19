import type { EnrichedGraph } from '../../types';
import type { AssemblerResultV3, MissionContractV3 } from '../contracts';
import { createNoCandidateAssemblerResultV3 } from './assembler-result-factory';
import { assembleForestLoopMissionV3 } from './forest-loop-assembler';
import { assembleParkLoopMissionV3 } from './park-loop-assembler';
import { assemblePoorOsmRuralMissionV3 } from './poor-osm-rural-assembler';
import { assembleTransitionToWoodsMissionV3 } from './transition-to-woods-assembler';

export function assembleMissionV3(
  graph: EnrichedGraph,
  mission: MissionContractV3,
): AssemblerResultV3 {
  switch (mission.strategy) {
    case 'forest_loop':
      return assembleForestLoopMissionV3(graph, mission);
    case 'transition_to_woods':
      return assembleTransitionToWoodsMissionV3(graph, mission);
    case 'park_loop':
      return assembleParkLoopMissionV3(graph, mission);
    case 'urban_nature_loop':
    case 'simple_quiet_loop':
      return createNoCandidateAssemblerResultV3(mission, 'strategy_not_supported_yet');
    case 'poor_osm_rural':
      return assemblePoorOsmRuralMissionV3(graph, mission);
    default:
      return createNoCandidateAssemblerResultV3(mission, 'strategy_not_supported_yet');
  }
}
