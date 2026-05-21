import type { EnrichedGraph } from '../../types';
import type { AssemblerResultV3, MissionContractV3 } from '../contracts';
import { assembleUrbanNatureLoopMissionCoreV3 } from './park-loop-assembler';

export function assembleUrbanNatureLoopMissionV3(
  graph: EnrichedGraph,
  mission: MissionContractV3,
): AssemblerResultV3 {
  return assembleUrbanNatureLoopMissionCoreV3(graph, mission);
}
