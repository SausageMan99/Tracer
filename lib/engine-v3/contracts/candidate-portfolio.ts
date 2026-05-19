import type { RouteGeometryV3, RouteMetricsV3, TerrainComponentKindV3 } from '../types';

export type CandidateLaneV3 =
  | 'complete_valid'
  | 'complete_adjustable'
  | 'progress_no_closure'
  | 'dwell_only'
  | 'connector_heavy'
  | 'diagnostic_only'
  | 'negative_evidence';

export type CandidateLifecycleV3 =
  | 'discovered'
  | 'expanded'
  | 'closed'
  | 'metricized'
  | 'gated'
  | 'selected'
  | 'rejected';

export interface CandidateGateV3 {
  id: string;
  status: 'pass' | 'fail' | 'warning';
  severity: 'info' | 'soft' | 'hard';
  reason?: string;
}

export interface RouteCandidateV3 {
  id: string;
  source:
    | 'strategy_assembler'
    | 'target_component'
    | 'cycle_chain'
    | 'park_loop'
    | 'urban_corridor'
    | 'fallback'
    | 'diagnostic';
  lane: CandidateLaneV3;
  lifecycle: CandidateLifecycleV3;
  edgeIds: string[];
  nodeIds: string[];
  geometry: RouteGeometryV3;
  targetComponentIds: string[];
  targetComponentKinds: TerrainComponentKindV3[];
  returned: boolean;
  metrics: RouteMetricsV3;
  gates: CandidateGateV3[];
  selectionScore: number;
  selected: boolean;
  selectedReason?: string;
  rejectedReason?: string;
}

export interface CandidatePortfolioV3 {
  missionId: string;
  candidates: RouteCandidateV3[];
  selectedCandidateId: string | null;
  topRejected: RouteCandidateV3[];
  counts: Record<CandidateLaneV3, number> & {
    discovered: number;
    closed: number;
    inEnvelope: number;
    rejected: number;
  };
  diagnostics: {
    firstDropStage: string | null;
    blocker: string | null;
    phaseBlockers: Record<string, string[]>;
  };
}
