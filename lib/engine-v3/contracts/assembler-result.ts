import type { CandidatePortfolioV3, RouteCandidateV3 } from './candidate-portfolio';
import type { MissionContractV3 } from './mission-contract';

export interface AssemblyPhaseDiagnosticsV3 {
  access: {
    status: 'success' | 'failure' | 'not_applicable';
    accessKm: number;
    accessPavedKm: number;
    entryNodeId: string | null;
    componentId: string | null;
    rejectedEntryReasons: Record<string, number>;
  };
  dwell: {
    status: 'success' | 'failure' | 'partial' | 'not_applicable';
    targetDwellKm: number;
    requestedTargetDwellKm: number;
    longestTrailSegmentKm: number;
    cleanExploitableKm: number;
    targetRepeatKm: number;
  };
  recovery: {
    status: 'success' | 'failure' | 'not_attempted';
    recoveredDistanceKm: number;
    recoveryPavedKm: number;
    recoveryRejectedReasons: Record<string, number>;
  };
  closure: {
    status: 'success' | 'failure' | 'not_attempted';
    closureKm: number;
    closurePavedKm: number;
    connectorRepeatKm: number;
    targetRepeatKm: number;
    closureRejectedReasons: Record<string, number>;
  };
  finalGate: {
    status: 'candidate_ready' | 'no_selectable_candidate';
    distanceKm: number;
    finalPavedRatioEstimate: number;
    trailRatio: number;
    naturalWayRatio: number;
    pavedRatio: number;
    gateFailures: string[];
  };
}

export interface AssemblerResultV3 {
  mission: MissionContractV3;
  status: 'portfolio_ready' | 'no_candidate';
  portfolio: CandidatePortfolioV3;
  selectedCandidate: RouteCandidateV3 | null;
  phaseDiagnostics: AssemblyPhaseDiagnosticsV3;
  diagnostics: {
    startNodeId: string | null;
    targetEntryAttempted: boolean;
    targetEntrySucceeded: boolean;
    closureAttempted: boolean;
    closureSucceeded: boolean;
    firstDropStage: string | null;
    blocker: string | null;
    observationOnly: Record<string, unknown>;
  };
  warnings: string[];
}
