import type { AssemblerResultV3, AssemblyPhaseDiagnosticsV3, MissionContractV3 } from '../contracts';
import { createEmptyCandidatePortfolioV3 } from './candidate-portfolio';

export function createEmptyPhaseDiagnosticsV3(
  blocker: string | null,
): AssemblyPhaseDiagnosticsV3 {
  return {
    access: {
      status: 'not_applicable',
      accessKm: 0,
      accessPavedKm: 0,
      entryNodeId: null,
      componentId: null,
      rejectedEntryReasons: blocker ? { [blocker]: 1 } : {},
    },
    dwell: {
      status: 'not_applicable',
      targetDwellKm: 0,
      requestedTargetDwellKm: 0,
      longestTrailSegmentKm: 0,
      cleanExploitableKm: 0,
      targetRepeatKm: 0,
    },
    recovery: {
      status: 'not_attempted',
      recoveredDistanceKm: 0,
      recoveryPavedKm: 0,
      recoveryRejectedReasons: {},
    },
    closure: {
      status: 'not_attempted',
      closureKm: 0,
      closurePavedKm: 0,
      connectorRepeatKm: 0,
      targetRepeatKm: 0,
      closureRejectedReasons: {},
    },
    finalGate: {
      status: 'no_selectable_candidate',
      distanceKm: 0,
      finalPavedRatioEstimate: 0,
      trailRatio: 0,
      naturalWayRatio: 0,
      pavedRatio: 0,
      gateFailures: blocker ? [blocker] : [],
    },
  };
}

export function createNoCandidateAssemblerResultV3(
  mission: MissionContractV3,
  blocker: string,
): AssemblerResultV3 {
  const portfolio = createEmptyCandidatePortfolioV3(mission.id, blocker);

  return {
    mission,
    status: 'no_candidate',
    portfolio,
    selectedCandidate: null,
    phaseDiagnostics: createEmptyPhaseDiagnosticsV3(blocker),
    diagnostics: {
      startNodeId: null,
      targetEntryAttempted: false,
      targetEntrySucceeded: false,
      closureAttempted: false,
      closureSucceeded: false,
      firstDropStage: 'dispatch',
      blocker,
      observationOnly: {},
    },
    warnings: [blocker],
  };
}
