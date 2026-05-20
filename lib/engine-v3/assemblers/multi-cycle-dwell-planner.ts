import type { EnrichedEdge, EnrichedGraph } from "../../types";
import { classifyEdgeSemanticsV3 } from "../edge-semantics";
import type { RouteSurfaceV3, TerrainComponentKindV3 } from "../types";
import type {
  NaturalCycleCandidateV3,
  NaturalGraphContractionResultV3,
} from "./natural-graph-contraction";
import type { TrailSpineCandidateV3 } from "./trail-spine-selector";

interface DirectedMultiCycleEdgeV3 {
  edge: EnrichedEdge;
  from: string;
  to: string;
  kind: TerrainComponentKindV3;
  surface: RouteSurfaceV3;
}

export type MultiCycleDwellFailureReasonV3 =
  | "no_cycle_candidate"
  | "no_chainable_cycle"
  | "no_closure"
  | "excessive_repeat"
  | "assembly_timeout";
export type MultiCycleDwellFailedPhaseV3 =
  | "dwellPhase"
  | "closurePhase"
  | "finalGate"
  | "timeoutPhase"
  | null;

export interface MultiCycleAssemblyTimeoutDiagnosticsV3 {
  stage: string;
  reason: "iteration_budget_exceeded" | "time_budget_exceeded";
  iterations: number;
  maxIterations: number;
  elapsedMs: number;
  maxMs: number;
  candidateCount: number;
  frontierSize: number;
  cycleCount: number;
  depth: number | null;
  lastProgress: string;
}

export interface MultiCycleDwellMetricsV3 {
  distanceKm: number;
  accessKm: number;
  chainKm: number;
  chainNaturalKm: number;
  connectorNaturalKm: number;
  connectorPavedKm: number;
  closureKm: number;
  closurePavedKm: number;
  pavedKm: number;
  chainRepeatKm: number;
  chainTargetRepeatKm: number;
  chainConnectorRepeatKm: number;
}

export interface MultiCycleFinalPavedEquivalentDiagnosticsV3 {
  explicitPavedKm: number;
  explicitPavedRatio: number;
  mixedUnknownKm: number;
  roadLikeUnknownKm: number;
  pathTrackUnknownKm: number;
  trailCandidateKm: number;
  unverifiedTrailCandidateKm: number;
  candidateNaturalKm: number;
  finalPavedEquivalentKm: number;
  finalPavedRatioEstimate: number;
  strictNaturalKm: number;
  naturalWayEquivalentKm: number;
  naturalWayEquivalentRatio: number;
  estimatedLongestStrictTrailSegmentKm: number;
}

export type MultiCycleDwellCandidateRejectedReasonV3 =
  | "overlong"
  | "under_min"
  | "excessive_paved"
  | "excessive_repeat"
  | "missed_selected_spine"
  | "dominated";

export type RecoveryAlternativeRejectedReasonV3 =
  | "no_path"
  | "connector_paved"
  | "cycle_repeat"
  | "missed_selected_spine"
  | "candidate_excessive_paved"
  | "candidate_excessive_repeat"
  | "candidate_distance_gate";

export type AlternativeSpineRejectedReasonV3 =
  | "unsupported_target_component"
  | "insufficient_spine_distance"
  | "insufficient_strict_trail"
  | "insufficient_strict_continuity"
  | "access_too_expensive"
  | "closure_too_expensive"
  | "connector_paved_risk"
  | "repeat_risk"
  | "road_like_unknown_dominant"
  | "spine_access_unreachable"
  | "spine_recovery_unreachable"
  | "recovery_repeats_target"
  | "recovery_paved_risk";

export type TrailSpineAnchorRejectedReasonV3 =
  | "no_selected_spine"
  | "unsupported_target_component"
  | "insufficient_spine_distance"
  | "insufficient_strict_trail"
  | "insufficient_strict_continuity"
  | "access_too_expensive"
  | "closure_too_expensive"
  | "connector_paved_risk"
  | "repeat_risk"
  | "road_like_unknown_dominant"
  | "no_candidate_covers_selected_spine"
  | "spine_access_unreachable"
  | "spine_recovery_unreachable"
  | "spine_closure_unreachable"
  | "spine_candidate_under_min"
  | "spine_candidate_overlong"
  | "spine_candidate_excessive_paved"
  | "spine_candidate_excessive_repeat";

export type TrailSpineSeedFailureStageV3 =
  | "not_attempted"
  | "edge_order"
  | "access"
  | "recovery"
  | "closure"
  | "distance_gate"
  | "surface_gate"
  | "repeat_gate"
  | null;

export type MultiCycleCandidateSegmentV3 =
  | "access"
  | "spine"
  | "recovery"
  | "cycle"
  | "closure";

export interface MultiCycleRepeatedSegmentDiagnosticsV3 {
  segment: MultiCycleCandidateSegmentV3;
  repeatedPairKeys: string[];
  repeatedEdgeIds: string[];
  targetRepeatKm: number;
  repeatKm: number;
}

export interface MultiCycleDwellCandidateSummaryV3
  extends
    MultiCycleDwellMetricsV3,
    MultiCycleFinalPavedEquivalentDiagnosticsV3 {
  candidateId: string;
  cycleIds: string[];
  chainCount: number;
  source:
    | "standard-cycle-chain"
    | "trail-spine-recovery"
    | "cycle-rotation-closure"
    | "alternative-trail-spine-recovery";
  cycleEntryNodeId: string | null;
  cycleRotationPrefixLength: number | null;
  closureAlternativeRank: number | null;
  closureAlternativeCount: number;
  cycleRotationAttemptCount: number;
  repeatedTargetSegments: MultiCycleRepeatedSegmentDiagnosticsV3[];
  spineCoverageKm: number;
  spineCoverageRatio: number;
  missedSelectedSpineKm: number;
  selectedSpineAnchorApplied: boolean;
  selectedSpineAnchorRejectedReason: TrailSpineAnchorRejectedReasonV3 | null;
  distanceErrorKm: number;
  pavedRatio: number;
  returned: boolean;
  selectedExitNode: string | null;
  rejectedReason: MultiCycleDwellCandidateRejectedReasonV3 | null;
}

export interface MultiCycleDwellCandidateDiagnosticsV3 {
  count: number;
  selectedCandidateId: string | null;
  recoveryAlternativeCount: number;
  selectedRecoveryAlternativeRank: number | null;
  recoveryRejectedReasons: Array<{
    reason: RecoveryAlternativeRejectedReasonV3;
    count: number;
  }>;
  bestAlternativeDelta: {
    candidateId: string;
    distanceDeltaKm: number;
    pavedRatioDelta: number;
    targetRepeatDeltaKm: number;
    spineCoverageDelta: number;
  } | null;
  repeatAvoidanceAttemptCount: number;
  pavedAvoidanceAttemptCount: number;
  cycleRotationAttemptCount: number;
  closureAlternativeCount: number;
  selectedCandidate: MultiCycleDwellCandidateSummaryV3 | null;
  selectedCandidatePavedComparison: {
    candidateId: string;
    explicitPavedRatio: number;
    finalPavedRatioEstimate: number;
    finalPavedEquivalentKm: number;
    mixedUnknownKm: number;
    roadLikeUnknownKm: number;
    pathTrackUnknownKm: number;
    trailCandidateKm: number;
    unverifiedTrailCandidateKm: number;
    candidateNaturalKm: number;
    strictNaturalKm: number;
    naturalWayEquivalentKm: number;
  } | null;
  inEnvelopeCount: number;
  overlongCount: number;
  underMinCount: number;
  topCandidates: MultiCycleDwellCandidateSummaryV3[];
  paretoFrontier: MultiCycleDwellCandidateSummaryV3[];
  topRejected: Array<
    | MultiCycleDwellCandidateSummaryV3
    | {
        candidateId: string;
        cycleIds: string[];
        rejectedReason: MultiCycleDwellCandidateRejectedReasonV3;
      }
  >;
  selectionReason: string | null;
}

export interface MultiCycleDwellDiagnosticsV3 extends MultiCycleDwellMetricsV3 {
  cycleIds: string[];
  chainCount: number;
  candidateCount: number;
  selectedExitNode: string | null;
  failedPhase: MultiCycleDwellFailedPhaseV3;
  rejectedCycles: Array<{
    id: string;
    reason:
      | "overlap"
      | "repeat"
      | "connector_paved"
      | "no_connector"
      | "not_improving";
  }>;
  overlapRejectedCount: number;
  prunedCandidateCount: number;
  maxCycles: number;
  beamWidth: number;
  multiCycleDwellCandidates: MultiCycleDwellCandidateDiagnosticsV3;
  trailSpineAnchor: TrailSpineAnchorDiagnosticsV3;
  assemblyTimeout?: MultiCycleAssemblyTimeoutDiagnosticsV3;
}

export interface AlternativeTrailSpineDiagnosticsV3 {
  spineId: string;
  selected: boolean;
  rejectedReasons: AlternativeSpineRejectedReasonV3[];
  endpointCycleCompatibilityScore: number;
  recoveryRepeatKm: number;
  recoveryPavedKm: number;
  recoveryDistanceKm: number;
  recoveryRejectedReasons: Array<{
    reason: RecoveryAlternativeRejectedReasonV3;
    count: number;
  }>;
  strictTrailKm: number;
  longestStrictTrailSegmentKm: number;
  trailConfidence: number;
  accessCostKm: number;
  closureCostKm: number;
  connectorPavedRisk: number;
}

export interface TrailSpineAnchorDiagnosticsV3 {
  selectedSpineId: string | null;
  originalSelectedSpineId: string | null;
  alternativeSpineCount: number;
  consideredSpineIds: string[];
  alternativeSpineReason: string | null;
  endpointCycleCompatibilityScore: number;
  recoveryRepeatKm: number;
  recoveryPavedKm: number;
  recoveryDistanceKm: number;
  recoveryRejectedReasons: Array<{
    reason: RecoveryAlternativeRejectedReasonV3;
    count: number;
  }>;
  alternativeSpines: AlternativeTrailSpineDiagnosticsV3[];
  hardAnchorCredible: boolean;
  selectedSpineAnchorApplied: boolean;
  selectedSpineAnchorRejectedReason: TrailSpineAnchorRejectedReasonV3 | null;
  recoveryRepeatRootCause:
    | "none"
    | "selected_spine_to_cycle_recovery"
    | "cycle_or_closure"
    | "unknown";
  repeatedRecoveryPairKeys: string[];
  selectedSpineEndpointAdjusted: boolean;
  selectedSpineAdjustedReason: string | null;
  subSpineCoverageRatio: number;
  subSpineReason: string | null;
  targetRepeatFreeRecoveryAttemptCount: number;
  targetRepeatFreeRecoveryRejectedReasons: Array<{
    reason: RecoveryAlternativeRejectedReasonV3;
    count: number;
  }>;
  bestRepeatFreeRecoveryDelta: MultiCycleDwellCandidateDiagnosticsV3["bestAlternativeDelta"];
  spineCoverageKm: number;
  spineCoverageRatio: number;
  missedSelectedSpineKm: number;
  spineSeedCandidateBuilt: boolean;
  spineSeedFailureStage: TrailSpineSeedFailureStageV3;
  accessCostKm: number;
  recoveryCostKm: number;
  closureCostKm: number;
  connectorPavedRisk: number;
  repeatRisk: number;
  minDistanceKm: number;
  minStrictTrailKm: number;
  minLongestStrictSegmentKm: number;
}

export interface MultiCycleDwellInputV3 {
  graph: EnrichedGraph;
  startNodeId: string;
  contraction: NaturalGraphContractionResultV3;
  targetComponentIds: TerrainComponentKindV3[];
  targetDistanceKm: number;
  minDistanceKm?: number;
  maxDistanceKm?: number;
  requestedNaturalDwellKm: number;
  maxCycles?: number;
  beamWidth?: number;
  maxAssemblyIterations?: number;
  maxAssemblyMs?: number;
  trailSpines?: TrailSpineCandidateV3[];
}

export interface MultiCycleDwellSuccessV3 {
  status: "success";
  edgeIds: string[];
  nodeIds: string[];
  cycleIds: string[];
  selectedExitNode: string;
  metrics: MultiCycleDwellMetricsV3;
  diagnostics: MultiCycleDwellDiagnosticsV3;
}

export interface MultiCycleDwellFailureV3 {
  status: "failure";
  reason: MultiCycleDwellFailureReasonV3;
  edgeIds: string[];
  nodeIds: string[];
  metrics: MultiCycleDwellMetricsV3;
  diagnostics: MultiCycleDwellDiagnosticsV3;
}

export type MultiCycleDwellResultV3 =
  | MultiCycleDwellSuccessV3
  | MultiCycleDwellFailureV3;

interface OrderedCycleV3 {
  id: string;
  edges: DirectedMultiCycleEdgeV3[];
  nodes: string[];
  edgeIds: Set<string>;
  pairKeys: Set<string>;
  lengthKm: number;
  naturalKm: number;
}

interface ChainStateV3 {
  currentNodeId: string;
  cycleIds: string[];
  accessEdges: DirectedMultiCycleEdgeV3[];
  chainEdges: DirectedMultiCycleEdgeV3[];
  connectorEdges: DirectedMultiCycleEdgeV3[];
  usedEdgeIds: Set<string>;
  usedPairKeys: Set<string>;
  naturalKm: number;
  score: number;
  recoveryAlternativeRank?: number;
  recoveryAlternativePolicy?: "strict" | "repeat_fallback" | "standard";
  cycleEntryNodeId?: string;
  cycleRotationPrefixLength?: number;
  cycleRotationAttemptCount?: number;
  trailSpineId?: string;
}

interface MultiCycleEvaluatedCandidateV3 {
  state: ChainStateV3;
  edgeIds: string[];
  nodeIds: string[];
  summary: MultiCycleDwellCandidateSummaryV3;
}

interface TrailSpineAnchorAssessmentV3 {
  spine: TrailSpineCandidateV3 | null;
  hardAnchorCredible: boolean;
  diagnostics: TrailSpineAnchorDiagnosticsV3;
}

interface TrailSpineSeedAssessmentV3 {
  state: ChainStateV3 | null;
  failureStage: TrailSpineSeedFailureStageV3;
  accessCostKm: number;
}

const EMPTY_TRAIL_SPINE_ANCHOR_DIAGNOSTICS: TrailSpineAnchorDiagnosticsV3 = {
  selectedSpineId: null,
  originalSelectedSpineId: null,
  alternativeSpineCount: 0,
  consideredSpineIds: [],
  alternativeSpineReason: null,
  endpointCycleCompatibilityScore: 0,
  recoveryRepeatKm: 0,
  recoveryPavedKm: 0,
  recoveryDistanceKm: 0,
  recoveryRejectedReasons: [],
  alternativeSpines: [],
  hardAnchorCredible: false,
  selectedSpineAnchorApplied: false,
  selectedSpineAnchorRejectedReason: "no_selected_spine",
  recoveryRepeatRootCause: "none",
  repeatedRecoveryPairKeys: [],
  selectedSpineEndpointAdjusted: false,
  selectedSpineAdjustedReason: null,
  subSpineCoverageRatio: 0,
  subSpineReason: null,
  targetRepeatFreeRecoveryAttemptCount: 0,
  targetRepeatFreeRecoveryRejectedReasons: [],
  bestRepeatFreeRecoveryDelta: null,
  spineCoverageKm: 0,
  spineCoverageRatio: 0,
  missedSelectedSpineKm: 0,
  spineSeedCandidateBuilt: false,
  spineSeedFailureStage: "not_attempted",
  accessCostKm: 0,
  recoveryCostKm: 0,
  closureCostKm: 0,
  connectorPavedRisk: 0,
  repeatRisk: 0,
  minDistanceKm: 0,
  minStrictTrailKm: 0,
  minLongestStrictSegmentKm: 0,
};

const EMPTY_TRAIL_SPINE_ANCHOR: TrailSpineAnchorAssessmentV3 = {
  spine: null,
  hardAnchorCredible: false,
  diagnostics: EMPTY_TRAIL_SPINE_ANCHOR_DIAGNOSTICS,
};

const TRAIL_SPINE_COVERAGE_THRESHOLD = 0.65;
const DEFAULT_ASSEMBLY_ITERATION_BUDGET = 12_000;
const DEFAULT_ASSEMBLY_TIME_BUDGET_MS = 45_000;

interface AssemblyBudgetV3 {
  startedAt: number;
  iterations: number;
  maxIterations: number;
  maxMs: number;
}

interface AssemblyBudgetProgressV3 {
  candidateCount: number;
  frontierSize: number;
  cycleCount: number;
  depth: number | null;
  lastProgress: string;
}

const EMPTY_METRICS: MultiCycleDwellMetricsV3 = {
  distanceKm: 0,
  accessKm: 0,
  chainKm: 0,
  chainNaturalKm: 0,
  connectorNaturalKm: 0,
  connectorPavedKm: 0,
  closureKm: 0,
  closurePavedKm: 0,
  pavedKm: 0,
  chainRepeatKm: 0,
  chainTargetRepeatKm: 0,
  chainConnectorRepeatKm: 0,
};

export function planMultiCycleDwellV3(
  input: MultiCycleDwellInputV3,
): MultiCycleDwellResultV3 {
  const maxCycles = input.maxCycles ?? 3;
  const beamWidth = input.beamWidth ?? 8;
  const assemblyBudget: AssemblyBudgetV3 = {
    startedAt: Date.now(),
    iterations: 0,
    maxIterations: input.maxAssemblyIterations ?? DEFAULT_ASSEMBLY_ITERATION_BUDGET,
    maxMs: input.maxAssemblyMs ?? DEFAULT_ASSEMBLY_TIME_BUDGET_MS,
  };
  let assemblyTimeout: MultiCycleAssemblyTimeoutDiagnosticsV3 | null = null;
  const minDistanceKm = input.minDistanceKm ?? input.targetDistanceKm * 0.7;
  const maxDistanceKm = input.maxDistanceKm ?? input.targetDistanceKm * 1.15;
  const targetComponents = new Set(input.targetComponentIds);
  const adjacency = buildAdjacency(input.graph);
  const orderedCycles = input.contraction.cycleCandidates
    .slice(0, 16)
    .map((cycle) => orderCycleEdges(cycle, input.graph))
    .filter((cycle): cycle is OrderedCycleV3 => cycle !== null)
    .sort(
      (a, b) =>
        orderedCycleScore(b, input.trailSpines ?? []) -
          orderedCycleScore(a, input.trailSpines ?? []) ||
        a.id.localeCompare(b.id),
    );
  const trailSpineAnchor = assessTrailSpineAnchor(
    input,
    targetComponents,
    adjacency,
    orderedCycles,
    beamWidth,
  );
  const rejectedCycles: MultiCycleDwellDiagnosticsV3["rejectedCycles"] = [];
  let overlapRejectedCount = input.contraction.diagnostics.jaccardDedupCount;
  let prunedCandidateCount = Math.max(
    0,
    input.contraction.cycleCandidates.length - 16,
  );
  let spineSeedAssessment: TrailSpineSeedAssessmentV3 = {
    state: null,
    failureStage: trailSpineAnchor.hardAnchorCredible
      ? "edge_order"
      : "not_attempted",
    accessCostKm: trailSpineAnchor.spine?.accessCostKm ?? 0,
  };

  if (orderedCycles.length === 0)
    return failure("no_chainable_cycle", [], [input.startNodeId], "dwellPhase");

  let frontier: ChainStateV3[] = [];
  const allStates: ChainStateV3[] = [];
  if (trailSpineAnchor.hardAnchorCredible && trailSpineAnchor.spine) {
    spineSeedAssessment = buildTrailSpineSeedState(
      input,
      adjacency,
      targetComponents,
      trailSpineAnchor.spine,
    );
    if (spineSeedAssessment.state) {
      frontier.push(spineSeedAssessment.state);
      const recoveryStates = buildTrailSpineRecoveryStates({
        seed: spineSeedAssessment.state,
        input,
        adjacency,
        orderedCycles,
        targetComponents,
        beamWidth,
      });
      frontier.push(...recoveryStates);
    }
  }
  for (const cycle of orderedCycles.slice(0, beamWidth)) {
    const access = shortestPathToAnyNode(
      input.startNodeId,
      cycle.nodes.slice(0, -1),
      adjacency,
      new Set(),
      new Set(),
      { preferNatural: false },
    );
    if (!access && !cycle.nodes.includes(input.startNodeId)) {
      rejectedCycles.push({ id: cycle.id, reason: "no_connector" });
      continue;
    }
    const entryNodeId =
      access?.at(-1)?.to ??
      (cycle.nodes.includes(input.startNodeId)
        ? input.startNodeId
        : cycle.nodes[0]);
    const rotated = rotateCycleToNode(cycle, entryNodeId);
    if (!rotated) continue;
    const chainable = openCycleForChaining(rotated, adjacency);
    const accessEdges = access ?? [];
    const initialEdges = [...accessEdges, ...chainable.edges];
    const usedEdgeIds = new Set(initialEdges.map((edge) => edge.edge.id));
    const usedPairKeys = new Set(initialEdges.map(edgePairKey));
    frontier.push({
      currentNodeId: chainable.nodes.at(-1) ?? entryNodeId,
      cycleIds: [cycle.id],
      accessEdges,
      chainEdges: [...chainable.edges],
      connectorEdges: [],
      usedEdgeIds,
      usedPairKeys,
      naturalKm: naturalTargetKm(chainable.edges, targetComponents),
      score: cycle.naturalKm * 100 - sumPaved(access ?? []) * 25,
    });
  }

  if (frontier.length === 0)
    return failure("no_chainable_cycle", [], [input.startNodeId], "dwellPhase");
  frontier = frontier.sort((a, b) => b.score - a.score).slice(0, beamWidth);
  allStates.push(...frontier);
  let best = frontier[0] ?? null;
  let bestRejectedConnectorPavedKm = 0;

  const consumeAssemblyBudget = (
    stage: string,
    increment: number,
    progress: AssemblyBudgetProgressV3,
  ): boolean => {
    if (assemblyTimeout) return true;
    assemblyBudget.iterations += Math.max(1, increment);
    const elapsedMs = Date.now() - assemblyBudget.startedAt;
    const reason = assemblyBudget.iterations > assemblyBudget.maxIterations
      ? "iteration_budget_exceeded"
      : elapsedMs > assemblyBudget.maxMs
        ? "time_budget_exceeded"
        : null;
    if (!reason) return false;
    assemblyTimeout = {
      stage,
      reason,
      iterations: assemblyBudget.iterations,
      maxIterations: assemblyBudget.maxIterations,
      elapsedMs,
      maxMs: assemblyBudget.maxMs,
      ...progress,
    };
    return true;
  };

  const timeoutFailure = (
    fallbackBest: ChainStateV3 | null,
    fallbackCandidateDiagnostics: MultiCycleDwellCandidateDiagnosticsV3 = emptyCandidateDiagnostics(),
  ): MultiCycleDwellFailureV3 => {
    const bestEdges = fallbackBest ? [...fallbackBest.accessEdges, ...fallbackBest.chainEdges] : [];
    const metrics = fallbackBest
      ? metricsFromParts(
          fallbackBest.accessEdges,
          fallbackBest.chainEdges,
          [],
          fallbackBest.connectorEdges,
          targetComponents,
        )
      : EMPTY_METRICS;
    return {
      status: "failure",
      reason: "assembly_timeout",
      edgeIds: bestEdges.map((edge) => edge.edge.id),
      nodeIds: fallbackBest
        ? nodesFromDirectedEdges(input.startNodeId, bestEdges)
        : [input.startNodeId],
      metrics,
      diagnostics: diagnosticsFrom(
        "timeoutPhase",
        fallbackBest,
        metrics,
        rejectedCycles,
        overlapRejectedCount,
        prunedCandidateCount,
        maxCycles,
        beamWidth,
        fallbackBest?.currentNodeId ?? null,
        fallbackCandidateDiagnostics,
        trailSpineAnchor,
        spineSeedAssessment,
        targetComponents,
        assemblyTimeout,
      ),
    };
  };

  for (let depth = 1; depth < maxCycles && frontier.length > 0; depth += 1) {
    const expanded: ChainStateV3[] = [];
    for (const state of frontier) {
      if (!best || state.naturalKm > best.naturalKm) best = state;
      for (const cycle of orderedCycles) {
        if (consumeAssemblyBudget("multi-cycle connector search", 1, {
          candidateCount: allStates.length + expanded.length,
          frontierSize: frontier.length,
          cycleCount: orderedCycles.length,
          depth,
          lastProgress: `${state.currentNodeId}->${cycle.id}`,
        })) return timeoutFailure(best);
        if (state.cycleIds.includes(cycle.id)) continue;
        const overlap = jaccardOverlap(state.usedEdgeIds, cycle.edgeIds);
        if (overlap > 0.35) {
          overlapRejectedCount += 1;
          rejectedCycles.push({ id: cycle.id, reason: "overlap" });
          continue;
        }
        const connector = shortestPathToAnyNode(
          state.currentNodeId,
          cycle.nodes.slice(0, -1),
          adjacency,
          state.usedEdgeIds,
          state.usedPairKeys,
          { preferNatural: true },
        );
        if (!connector) {
          rejectedCycles.push({ id: cycle.id, reason: "no_connector" });
          continue;
        }
        const connectorPavedKm = sumPaved(connector);
        bestRejectedConnectorPavedKm = Math.max(
          bestRejectedConnectorPavedKm,
          connectorPavedKm,
        );
        if (connectorPavedKm > Math.max(0.8, input.targetDistanceKm * 0.14)) {
          rejectedCycles.push({ id: cycle.id, reason: "connector_paved" });
          continue;
        }
        const entryNodeId = connector.at(-1)?.to ?? state.currentNodeId;
        const rotated = rotateCycleToNode(cycle, entryNodeId);
        if (!rotated) continue;
        const chainable = openCycleForChaining(rotated, adjacency);
        const repeatedCycleKm = repeatedKm(
          chainable.edges,
          state.usedEdgeIds,
          state.usedPairKeys,
          targetComponents,
        ).repeatKm;
        if (repeatedCycleKm > 0.001) {
          rejectedCycles.push({ id: cycle.id, reason: "repeat" });
          continue;
        }
        const nextUsedEdgeIds = new Set(state.usedEdgeIds);
        const nextUsedPairKeys = new Set(state.usedPairKeys);
        for (const edge of [...connector, ...chainable.edges]) {
          nextUsedEdgeIds.add(edge.edge.id);
          nextUsedPairKeys.add(edgePairKey(edge));
        }
        const connectorNaturalKm = naturalTargetKm(connector, targetComponents);
        const nextNaturalKm =
          state.naturalKm +
          connectorNaturalKm +
          naturalTargetKm(chainable.edges, targetComponents);
        if (nextNaturalKm <= state.naturalKm + 0.25) {
          rejectedCycles.push({ id: cycle.id, reason: "not_improving" });
          continue;
        }
        expanded.push({
          currentNodeId: chainable.nodes.at(-1) ?? entryNodeId,
          cycleIds: [...state.cycleIds, cycle.id],
          accessEdges: state.accessEdges,
          chainEdges: [...state.chainEdges, ...connector, ...chainable.edges],
          connectorEdges: [...state.connectorEdges, ...connector],
          usedEdgeIds: nextUsedEdgeIds,
          usedPairKeys: nextUsedPairKeys,
          naturalKm: nextNaturalKm,
          score:
            nextNaturalKm * 130 -
            connectorPavedKm * 160 -
            repeatedCycleKm * 400 -
            overlap * 40,
        });
      }
    }
    if (expanded.length === 0) break;
    prunedCandidateCount += Math.max(0, expanded.length - beamWidth);
    frontier = expanded.sort((a, b) => b.score - a.score).slice(0, beamWidth);
    allStates.push(...frontier);
    if (!best || frontier[0]?.naturalKm > best.naturalKm)
      best = frontier[0] ?? best;
  }

  const viableStates = allStates
    .filter(
      (state) =>
        state.naturalKm + 0.001 >= input.requestedNaturalDwellKm ||
        (trailSpineAnchor.hardAnchorCredible &&
          computeSpineCoverage(
            [...state.accessEdges, ...state.chainEdges],
            trailSpineAnchor.spine,
          ).spineCoverageRatio >= TRAIL_SPINE_COVERAGE_THRESHOLD),
    )
    .sort((a, b) => b.naturalKm - a.naturalKm || b.score - a.score);

  const candidateStates = boundedCandidateStates(
    viableStates,
    input,
    targetComponents,
    beamWidth,
  );
  if (consumeAssemblyBudget("multi-cycle candidate evaluation", candidateStates.length, {
    candidateCount: candidateStates.length,
    frontierSize: frontier.length,
    cycleCount: orderedCycles.length,
    depth: null,
    lastProgress: "evaluating closure candidates",
  })) return timeoutFailure(best);
  const evaluatedCandidates = candidateStates.flatMap((state, index) =>
    evaluateChainCandidate({
      state,
      index,
      input,
      adjacency,
      targetComponents,
      minDistanceKm,
      maxDistanceKm,
      trailSpineAnchor,
    }),
  );
  const candidateDiagnostics = buildCandidateDiagnostics(
    evaluatedCandidates,
    rejectedCycles,
    null,
    overlapRejectedCount,
  );

  if (!best || viableStates.length === 0 || evaluatedCandidates.length === 0) {
    const bestEdges = best ? [...best.accessEdges, ...best.chainEdges] : [];
    const edgeIds = bestEdges.map((edge) => edge.edge.id);
    const nodeIds = best
      ? nodesFromDirectedEdges(input.startNodeId, bestEdges)
      : [input.startNodeId];
    const metrics = best
      ? {
          ...metricsFromParts(
            best.accessEdges,
            best.chainEdges,
            [],
            best.connectorEdges,
            targetComponents,
          ),
          connectorPavedKm: round(
            Math.max(
              bestRejectedConnectorPavedKm,
              sumPaved(best.connectorEdges),
            ),
          ),
        }
      : {
          ...EMPTY_METRICS,
          connectorPavedKm: round(bestRejectedConnectorPavedKm),
        };
    return {
      status: "failure",
      reason: "no_chainable_cycle",
      edgeIds,
      nodeIds,
      metrics,
      diagnostics: diagnosticsFrom(
        "dwellPhase",
        best,
        metrics,
        rejectedCycles,
        overlapRejectedCount,
        prunedCandidateCount,
        maxCycles,
        beamWidth,
        null,
        candidateDiagnostics,
        trailSpineAnchor,
        spineSeedAssessment,
        targetComponents,
      ),
    };
  }

  const selectable = evaluatedCandidates
    .filter(
      (candidate) =>
        candidate.summary.rejectedReason === null &&
        (candidate.summary.chainCount >= 2 ||
          candidate.summary.selectedSpineAnchorApplied),
    )
    .sort(
      (a, b) =>
        candidateParetoScore(b.summary, input.targetDistanceKm) -
        candidateParetoScore(a.summary, input.targetDistanceKm),
    );
  const selected = selectable[0] ?? null;
  const selectedCandidateDiagnostics = buildCandidateDiagnostics(
    evaluatedCandidates,
    rejectedCycles,
    selected?.summary.candidateId ?? null,
    overlapRejectedCount,
  );

  if (!selected) {
    const diagnosticPool = evaluatedCandidates.filter(
      (candidate) =>
        candidate.summary.distanceKm + 0.001 >= minDistanceKm &&
        candidate.summary.distanceKm <= maxDistanceKm + 0.001,
    );
    const bestDiagnostic = (
      diagnosticPool.length > 0 ? diagnosticPool : evaluatedCandidates
    )
      .slice()
      .sort(
        (a, b) =>
          candidateDiagnosticScore(b.summary, input.targetDistanceKm) -
          candidateDiagnosticScore(a.summary, input.targetDistanceKm),
      )[0];
    const state = bestDiagnostic?.state ?? best;
    const metrics =
      bestDiagnostic?.summary ??
      metricsFromParts(
        [],
        state.chainEdges,
        [],
        state.connectorEdges,
        targetComponents,
      );
    return {
      status: "failure",
      reason:
        bestDiagnostic?.summary.rejectedReason === "overlong"
          ? "excessive_repeat"
          : "no_chainable_cycle",
      edgeIds:
        bestDiagnostic?.edgeIds ??
        [...state.accessEdges, ...state.chainEdges].map((edge) => edge.edge.id),
      nodeIds:
        bestDiagnostic?.nodeIds ??
        nodesFromDirectedEdges(input.startNodeId, [
          ...state.accessEdges,
          ...state.chainEdges,
        ]),
      metrics,
      diagnostics: diagnosticsFrom(
        "finalGate",
        state,
        metrics,
        rejectedCycles,
        overlapRejectedCount,
        prunedCandidateCount,
        maxCycles,
        beamWidth,
        state.currentNodeId,
        selectedCandidateDiagnostics,
        trailSpineAnchor,
        spineSeedAssessment,
        targetComponents,
      ),
    };
  }

  const diagnostics = diagnosticsFrom(
    null,
    selected.state,
    selected.summary,
    rejectedCycles,
    overlapRejectedCount,
    prunedCandidateCount,
    maxCycles,
    beamWidth,
    selected.state.currentNodeId,
    selectedCandidateDiagnostics,
    trailSpineAnchor,
    spineSeedAssessment,
    targetComponents,
  );
  return {
    status: "success",
    edgeIds: selected.edgeIds,
    nodeIds: selected.nodeIds,
    cycleIds: selected.state.cycleIds,
    selectedExitNode: selected.state.currentNodeId,
    metrics: selected.summary,
    diagnostics,
  };

  function failure(
    reason: MultiCycleDwellFailureReasonV3,
    edgeIds: string[],
    nodeIds: string[],
    failedPhase: Exclude<MultiCycleDwellFailedPhaseV3, null>,
  ): MultiCycleDwellFailureV3 {
    const diagnostics = diagnosticsFrom(
      failedPhase,
      null,
      EMPTY_METRICS,
      rejectedCycles,
      overlapRejectedCount,
      prunedCandidateCount,
      maxCycles,
      beamWidth,
      null,
      emptyCandidateDiagnostics(),
      trailSpineAnchor,
      spineSeedAssessment,
      targetComponents,
    );
    return {
      status: "failure",
      reason,
      edgeIds,
      nodeIds,
      metrics: EMPTY_METRICS,
      diagnostics,
    };
  }
}

function assessTrailSpineAnchor(
  input: MultiCycleDwellInputV3,
  targetComponents: Set<TerrainComponentKindV3>,
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>,
  orderedCycles: OrderedCycleV3[],
  beamWidth: number,
): TrailSpineAnchorAssessmentV3 {
  const originalSpine = input.trailSpines?.[0] ?? null;
  const candidates = (input.trailSpines ?? []).slice(0, Math.max(2, Math.min(3, beamWidth)));
  const minDistanceKm = round(Math.max(1.2, input.targetDistanceKm * 0.12));
  const minStrictTrailKm = round(Math.max(1.2, input.targetDistanceKm * 0.14));
  const minLongestStrictSegmentKm = round(
    Math.max(1, input.targetDistanceKm * 0.12),
  );

  if (candidates.length === 0) {
    return {
      ...EMPTY_TRAIL_SPINE_ANCHOR,
      diagnostics: {
        ...EMPTY_TRAIL_SPINE_ANCHOR_DIAGNOSTICS,
        minDistanceKm,
        minStrictTrailKm,
        minLongestStrictSegmentKm,
      },
    };
  }

  const assessments = candidates.map((spine) =>
    assessAlternativeTrailSpine({
      spine,
      input,
      targetComponents,
      adjacency,
      orderedCycles,
      beamWidth,
      minDistanceKm,
      minStrictTrailKm,
      minLongestStrictSegmentKm,
    }),
  );
  const originalAssessment =
    assessments.find(
      (assessment) => assessment.spine.spineId === originalSpine?.spineId,
    ) ?? assessments[0];
  const eligible = assessments.filter(
    (assessment) => assessment.rejectedReasons.length === 0,
  );
  const selectedAssessment =
    eligible.length > 0
      ? eligible
          .slice()
          .sort(
            (a, b) =>
              alternativeSpineScore(b) - alternativeSpineScore(a) ||
              a.spine.spineId.localeCompare(b.spine.spineId),
          )[0]
      : originalAssessment;
  const selected = selectedAssessment?.spine ?? originalSpine;
  const selectedIsAlternative = Boolean(
    selected && originalSpine && selected.spineId !== originalSpine.spineId,
  );
  const selectedBaseRejectedReasons = (
    selectedAssessment?.rejectedReasons ?? []
  ).filter((reason) => !isRecoveryCompatibilityRejection(reason));
  const hardAnchorCredible = Boolean(
    selectedAssessment && selectedBaseRejectedReasons.length === 0,
  );
  const selectedReason = selectedIsAlternative
    ? `alternative_spine_selected_for_cycle_compatible_endpoint:${selectedAssessment?.recoveryRepeatKm ?? 0}km_repeat_vs_original:${originalAssessment?.recoveryRepeatKm ?? 0}km`
    : selectedAssessment?.rejectedReasons.length === 0
      ? "original_spine_cycle_compatible_or_best_available"
      : null;
  const firstReason = selectedBaseRejectedReasons[0] ?? null;
  const rejectedReason = hardAnchorCredible
    ? null
    : mapAlternativeRejectionToAnchor(firstReason);

  return {
    spine: selected,
    hardAnchorCredible,
    diagnostics: {
      selectedSpineId: selected?.spineId ?? null,
      originalSelectedSpineId: originalSpine?.spineId ?? null,
      alternativeSpineCount: Math.max(0, candidates.length - 1),
      consideredSpineIds: candidates.map((candidate) => candidate.spineId),
      alternativeSpineReason: selectedReason,
      endpointCycleCompatibilityScore:
        selectedAssessment?.endpointCycleCompatibilityScore ?? 0,
      recoveryRepeatKm: selectedAssessment?.recoveryRepeatKm ?? 0,
      recoveryPavedKm: selectedAssessment?.recoveryPavedKm ?? 0,
      recoveryDistanceKm: selectedAssessment?.recoveryDistanceKm ?? 0,
      recoveryRejectedReasons:
        selectedAssessment?.recoveryRejectedReasons ?? [],
      alternativeSpines: assessments.map((assessment) => ({
        spineId: assessment.spine.spineId,
        selected: assessment.spine.spineId === selected?.spineId,
        rejectedReasons: assessment.rejectedReasons,
        endpointCycleCompatibilityScore:
          assessment.endpointCycleCompatibilityScore,
        recoveryRepeatKm: assessment.recoveryRepeatKm,
        recoveryPavedKm: assessment.recoveryPavedKm,
        recoveryDistanceKm: assessment.recoveryDistanceKm,
        recoveryRejectedReasons: assessment.recoveryRejectedReasons,
        strictTrailKm: assessment.spine.strictTrailKm,
        longestStrictTrailSegmentKm:
          assessment.spine.longestStrictTrailSegmentKm,
        trailConfidence: assessment.spine.trailConfidence,
        accessCostKm: assessment.spine.accessCostKm,
        closureCostKm: assessment.spine.estimatedClosureCostKm,
        connectorPavedRisk: assessment.spine.connectorPavedRisk,
      })),
      hardAnchorCredible,
      selectedSpineAnchorApplied: false,
      selectedSpineAnchorRejectedReason: rejectedReason,
      recoveryRepeatRootCause: "none",
      repeatedRecoveryPairKeys: [],
      selectedSpineEndpointAdjusted: selectedIsAlternative,
      selectedSpineAdjustedReason: selectedIsAlternative
        ? "alternative_spine_endpoint_cycle_compatible"
        : null,
      subSpineCoverageRatio: 0,
      subSpineReason: null,
      targetRepeatFreeRecoveryAttemptCount: 0,
      targetRepeatFreeRecoveryRejectedReasons:
        selectedAssessment?.recoveryRejectedReasons ?? [],
      bestRepeatFreeRecoveryDelta: null,
      spineCoverageKm: 0,
      spineCoverageRatio: 0,
      missedSelectedSpineKm: selected?.distanceKm ?? 0,
      spineSeedCandidateBuilt: false,
      spineSeedFailureStage: "not_attempted",
      accessCostKm: selected?.accessCostKm ?? 0,
      recoveryCostKm: selectedAssessment?.recoveryDistanceKm ?? 0,
      closureCostKm: selected?.estimatedClosureCostKm ?? 0,
      connectorPavedRisk: selected?.connectorPavedRisk ?? 0,
      repeatRisk: selected?.repeatRisk ?? 0,
      minDistanceKm,
      minStrictTrailKm,
      minLongestStrictSegmentKm,
    },
  };
}

interface AlternativeTrailSpineAssessmentV3 {
  spine: TrailSpineCandidateV3;
  rejectedReasons: AlternativeSpineRejectedReasonV3[];
  endpointCycleCompatibilityScore: number;
  recoveryRepeatKm: number;
  recoveryPavedKm: number;
  recoveryDistanceKm: number;
  recoveryRejectedReasons: Array<{
    reason: RecoveryAlternativeRejectedReasonV3;
    count: number;
  }>;
}

function assessAlternativeTrailSpine(args: {
  spine: TrailSpineCandidateV3;
  input: MultiCycleDwellInputV3;
  targetComponents: Set<TerrainComponentKindV3>;
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>;
  orderedCycles: OrderedCycleV3[];
  beamWidth: number;
  minDistanceKm: number;
  minStrictTrailKm: number;
  minLongestStrictSegmentKm: number;
}): AlternativeTrailSpineAssessmentV3 {
  const {
    spine,
    input,
    targetComponents,
    adjacency,
    orderedCycles,
    beamWidth,
    minDistanceKm,
    minStrictTrailKm,
    minLongestStrictSegmentKm,
  } = args;
  const rejectedReasons: AlternativeSpineRejectedReasonV3[] = [];
  if (!targetComponents.has(spine.componentKind))
    rejectedReasons.push("unsupported_target_component");
  if (spine.distanceKm + 0.001 < minDistanceKm)
    rejectedReasons.push("insufficient_spine_distance");
  if (spine.strictTrailKm + 0.001 < minStrictTrailKm)
    rejectedReasons.push("insufficient_strict_trail");
  if (spine.longestStrictTrailSegmentKm + 0.001 < minLongestStrictSegmentKm)
    rejectedReasons.push("insufficient_strict_continuity");
  if (spine.accessCostKm > Math.max(1.8, input.targetDistanceKm * 0.25))
    rejectedReasons.push("access_too_expensive");
  if (
    spine.estimatedClosureCostKm > Math.max(1.8, input.targetDistanceKm * 0.25)
  )
    rejectedReasons.push("closure_too_expensive");
  if (spine.connectorPavedRisk > 0.72)
    rejectedReasons.push("connector_paved_risk");
  if (spine.repeatRisk > 0.08) rejectedReasons.push("repeat_risk");
  if (spine.mixedUnknownKm > spine.strictTrailKm && spine.trailConfidence < 0.7)
    rejectedReasons.push("road_like_unknown_dominant");

  const seed = buildTrailSpineSeedState(
    input,
    adjacency,
    targetComponents,
    spine,
  );
  if (!seed.state) {
    rejectedReasons.push(
      seed.failureStage === "access"
        ? "spine_access_unreachable"
        : "spine_recovery_unreachable",
    );
    return {
      spine,
      rejectedReasons,
      endpointCycleCompatibilityScore: 0,
      recoveryRepeatKm: Number.POSITIVE_INFINITY,
      recoveryPavedKm: Number.POSITIVE_INFINITY,
      recoveryDistanceKm: Number.POSITIVE_INFINITY,
      recoveryRejectedReasons: [{ reason: "no_path", count: 1 }],
    };
  }

  const recoveryStates = buildTrailSpineRecoveryStates({
    seed: seed.state,
    input,
    adjacency,
    orderedCycles,
    targetComponents,
    beamWidth,
  });
  if (recoveryStates.length === 0) {
    const fallbackRecovery = firstPermissiveRecoveryPath(
      seed.state,
      orderedCycles,
      adjacency,
      targetComponents,
    );
    const fallbackPavedKm = fallbackRecovery ? round(sumPaved(fallbackRecovery)) : Number.POSITIVE_INFINITY;
    const fallbackDistanceKm = fallbackRecovery ? round(sumDirectedLengths(fallbackRecovery)) : Number.POSITIVE_INFINITY;
    rejectedReasons.push(
      fallbackRecovery && fallbackPavedKm > Math.max(0.8, input.targetDistanceKm * 0.14)
        ? "recovery_paved_risk"
        : "spine_recovery_unreachable",
    );
    return {
      spine,
      rejectedReasons,
      endpointCycleCompatibilityScore: 0,
      recoveryRepeatKm: fallbackRecovery ? 0 : Number.POSITIVE_INFINITY,
      recoveryPavedKm: fallbackPavedKm,
      recoveryDistanceKm: fallbackDistanceKm,
      recoveryRejectedReasons: [
        {
          reason: fallbackRecovery ? "candidate_excessive_paved" : "no_path",
          count: 1,
        },
      ],
    };
  }

  const evaluated = recoveryStates
    .map((state) => {
      const repeat = repeatedKm(
        state.connectorEdges,
        seed.state?.usedEdgeIds ?? new Set(),
        seed.state?.usedPairKeys ?? new Set(),
        targetComponents,
      );
      const recoveryPavedKm = round(sumPaved(state.connectorEdges));
      const recoveryDistanceKm = round(
        sumDirectedLengths(state.connectorEdges),
      );
      return {
        state,
        targetRepeatKm: repeat.targetRepeatKm,
        recoveryPavedKm,
        recoveryDistanceKm,
      };
    })
    .sort(
      (a, b) =>
        a.targetRepeatKm - b.targetRepeatKm ||
        a.recoveryPavedKm - b.recoveryPavedKm ||
        a.recoveryDistanceKm - b.recoveryDistanceKm,
    );
  const best = evaluated[0];
  const maxConnectorPavedKm = Math.max(0.8, input.targetDistanceKm * 0.14);
  if ((best?.targetRepeatKm ?? Infinity) > 0.001)
    rejectedReasons.push("recovery_repeats_target");
  if ((best?.recoveryPavedKm ?? Infinity) > maxConnectorPavedKm)
    rejectedReasons.push("recovery_paved_risk");
  const recoveryRejectedReasons: Array<{
    reason: RecoveryAlternativeRejectedReasonV3;
    count: number;
  }> = [];
  if (evaluated.some((candidate) => candidate.targetRepeatKm > 0.001))
    recoveryRejectedReasons.push({
      reason: "candidate_excessive_repeat",
      count: evaluated.filter((candidate) => candidate.targetRepeatKm > 0.001)
        .length,
    });
  if (
    evaluated.some(
      (candidate) => candidate.recoveryPavedKm > maxConnectorPavedKm,
    )
  )
    recoveryRejectedReasons.push({
      reason: "candidate_excessive_paved",
      count: evaluated.filter(
        (candidate) => candidate.recoveryPavedKm > maxConnectorPavedKm,
      ).length,
    });
  const endpointCycleCompatibilityScore = round(
    Math.max(
      0,
      100 +
        spine.strictTrailKm * 14 +
        spine.longestStrictTrailSegmentKm * 8 +
        spine.trailConfidence * 20 -
        (best?.targetRepeatKm ?? 5) * 160 -
        (best?.recoveryPavedKm ?? 5) * 45 -
        (best?.recoveryDistanceKm ?? 5) * 8 -
        rejectedReasons.length * 30,
    ),
  );
  return {
    spine,
    rejectedReasons: Array.from(new Set(rejectedReasons)),
    endpointCycleCompatibilityScore,
    recoveryRepeatKm: round(best?.targetRepeatKm ?? 0),
    recoveryPavedKm: round(best?.recoveryPavedKm ?? 0),
    recoveryDistanceKm: round(best?.recoveryDistanceKm ?? 0),
    recoveryRejectedReasons,
  };
}

function firstPermissiveRecoveryPath(
  seed: ChainStateV3,
  orderedCycles: OrderedCycleV3[],
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>,
  targetComponents: Set<TerrainComponentKindV3>,
): DirectedMultiCycleEdgeV3[] | null {
  for (const cycle of orderedCycles) {
    if (seed.cycleIds.includes(cycle.id)) continue;
    const connector = shortestPathToAnyNode(
      seed.currentNodeId,
      cycle.nodes.slice(0, -1),
      adjacency,
      seed.usedEdgeIds,
      new Set(),
      { preferNatural: false },
    );
    if (!connector) continue;
    if (sumPaved(connector) > 0 || naturalTargetKm(connector, targetComponents) > 0) return connector;
  }
  return null;
}

function alternativeSpineScore(assessment: AlternativeTrailSpineAssessmentV3): number {
  return (
    assessment.endpointCycleCompatibilityScore +
    assessment.spine.strictTrailKm * 80 +
    assessment.spine.longestStrictTrailSegmentKm * 50 -
    assessment.recoveryRepeatKm * 1_000 -
    assessment.recoveryPavedKm * 220 -
    assessment.rejectedReasons.length * 10_000
  );
}

function isRecoveryCompatibilityRejection(
  reason: AlternativeSpineRejectedReasonV3,
): boolean {
  return (
    reason === "spine_recovery_unreachable" ||
    reason === "recovery_repeats_target" ||
    reason === "recovery_paved_risk"
  );
}

function mapAlternativeRejectionToAnchor(
  reason: AlternativeSpineRejectedReasonV3 | null,
): TrailSpineAnchorRejectedReasonV3 | null {
  if (!reason) return null;
  if (reason === "recovery_repeats_target")
    return "spine_candidate_excessive_repeat";
  if (reason === "recovery_paved_risk")
    return "spine_candidate_excessive_paved";
  return reason;
}

function buildTrailSpineSeedState(
  input: MultiCycleDwellInputV3,
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>,
  targetComponents: Set<TerrainComponentKindV3>,
  spine: TrailSpineCandidateV3,
): TrailSpineSeedAssessmentV3 {
  const initialSpineEdges = directedTraversalFromEdgeIds(
    spine.edgeIds,
    input.graph,
    spine.nodeIds,
  );
  const reversedSpineEdges = reverseDirectedTraversal(initialSpineEdges);
  const spineEdges = chooseAccessibleSpineOrientation(
    input.startNodeId,
    [initialSpineEdges, reversedSpineEdges],
    adjacency,
  );
  if (spineEdges.length === 0)
    return { state: null, failureStage: "edge_order", accessCostKm: 0 };
  const spineEdgeIds = new Set(spineEdges.map((edge) => edge.edge.id));
  const spinePairKeys = new Set(spineEdges.map(edgePairKey));
  const access =
    spineEdges[0]?.from === input.startNodeId
      ? []
      : shortestPathToAnyNode(
          input.startNodeId,
          [spineEdges[0]?.from ?? input.startNodeId],
          adjacency,
          spineEdgeIds,
          spinePairKeys,
          { preferNatural: false },
        );
  if (!access && spineEdges[0]?.from !== input.startNodeId)
    return {
      state: null,
      failureStage: "access",
      accessCostKm: Number.POSITIVE_INFINITY,
    };
  const accessEdges = access ?? [];
  const usedEdgeIds = new Set([
    ...accessEdges.map((edge) => edge.edge.id),
    ...Array.from(spineEdgeIds),
  ]);
  const usedPairKeys = new Set([
    ...accessEdges.map(edgePairKey),
    ...Array.from(spinePairKeys),
  ]);
  const naturalKm = naturalTargetKm(spineEdges, targetComponents);
  const pavedPenalty = sumPaved(accessEdges) * 80 + spine.pavedKm * 160;
  return {
    state: {
      currentNodeId: spineEdges.at(-1)?.to ?? input.startNodeId,
      cycleIds: [spine.spineId],
      trailSpineId: spine.spineId,
      accessEdges,
      chainEdges: spineEdges,
      connectorEdges: [],
      usedEdgeIds,
      usedPairKeys,
      naturalKm,
      score:
        100_000 + naturalKm * 180 + spine.strictTrailKm * 220 - pavedPenalty,
    },
    failureStage: null,
    accessCostKm: round(sumDirectedLengths(accessEdges)),
  };
}

function buildTrailSpineRecoveryStates(args: {
  seed: ChainStateV3;
  input: MultiCycleDwellInputV3;
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>;
  orderedCycles: OrderedCycleV3[];
  targetComponents: Set<TerrainComponentKindV3>;
  beamWidth: number;
}): ChainStateV3[] {
  const strictStates = buildTrailSpineRecoveryStatesWithPairPolicy(args, false);
  const fallbackStates = buildTrailSpineRecoveryStatesWithPairPolicy(
    args,
    true,
  );
  const bySignature = new Map<string, ChainStateV3>();
  for (const state of [...strictStates, ...fallbackStates]) {
    const signature = `${state.currentNodeId}:${state.cycleIds.join(",")}:${state.connectorEdges.map((edge) => edge.edge.id).join(",")}`;
    const existing = bySignature.get(signature);
    if (!existing || state.score > existing.score)
      bySignature.set(signature, state);
  }
  return Array.from(bySignature.values())
    .sort((a, b) => b.score - a.score || b.naturalKm - a.naturalKm)
    .slice(0, Math.max(args.beamWidth * 2, 8))
    .map((state, index) => ({ ...state, recoveryAlternativeRank: index + 1 }));
}

function buildTrailSpineRecoveryStatesWithPairPolicy(
  args: {
    seed: ChainStateV3;
    input: MultiCycleDwellInputV3;
    adjacency: Map<string, DirectedMultiCycleEdgeV3[]>;
    orderedCycles: OrderedCycleV3[];
    targetComponents: Set<TerrainComponentKindV3>;
    beamWidth: number;
  },
  allowTargetPairRepeatFallback: boolean,
): ChainStateV3[] {
  const { seed, input, adjacency, orderedCycles, targetComponents, beamWidth } =
    args;
  const states: ChainStateV3[] = [];
  const maxConnectorPavedKm = Math.max(0.8, input.targetDistanceKm * 0.14);
  for (const cycle of orderedCycles) {
    if (seed.cycleIds.includes(cycle.id)) continue;
    const connectorAlternatives = kShortestPathsToAnyNode(
      seed.currentNodeId,
      cycle.nodes.slice(0, -1),
      adjacency,
      seed.usedEdgeIds,
      allowTargetPairRepeatFallback ? new Set() : seed.usedPairKeys,
      {
        preferNatural: true,
        k: Math.max(beamWidth, 6),
        maxVisitedStates: 2400,
      },
    );
    const legacyShortestConnector = shortestPathToAnyNode(
      seed.currentNodeId,
      cycle.nodes.slice(0, -1),
      adjacency,
      seed.usedEdgeIds,
      allowTargetPairRepeatFallback ? new Set() : seed.usedPairKeys,
      { preferNatural: true },
    );
    const connectors = uniqueConnectorAlternatives([
      ...(legacyShortestConnector ? [legacyShortestConnector] : []),
      ...connectorAlternatives,
    ]);
    for (const connector of connectors) {
      const connectorPavedKm = sumPaved(connector);
      if (connectorPavedKm > maxConnectorPavedKm) continue;
      const entryNodeId = connector.at(-1)?.to ?? seed.currentNodeId;
      const rotated = rotateCycleToNode(cycle, entryNodeId);
      if (!rotated) continue;
      const chainableVariants = openCycleVariantsForChaining(
        rotated,
        adjacency,
        Math.max(beamWidth, 6),
      );
      for (const chainable of chainableVariants) {
        const repeatedCycleKm = repeatedKm(
          chainable.edges,
          seed.usedEdgeIds,
          seed.usedPairKeys,
          targetComponents,
        ).repeatKm;
        if (repeatedCycleKm > 0.001) continue;
        const nextUsedEdgeIds = new Set(seed.usedEdgeIds);
        const nextUsedPairKeys = new Set(seed.usedPairKeys);
        for (const edge of [...connector, ...chainable.edges]) {
          nextUsedEdgeIds.add(edge.edge.id);
          nextUsedPairKeys.add(edgePairKey(edge));
        }
        const connectorNaturalKm = naturalTargetKm(connector, targetComponents);
        const cycleNaturalKm = naturalTargetKm(
          chainable.edges,
          targetComponents,
        );
        const connectorRepeat = repeatedKm(
          connector,
          seed.usedEdgeIds,
          seed.usedPairKeys,
          targetComponents,
        );
        const nextNaturalKm =
          seed.naturalKm + connectorNaturalKm + cycleNaturalKm;
        states.push({
          currentNodeId: chainable.nodes.at(-1) ?? entryNodeId,
          cycleIds: [...seed.cycleIds, cycle.id],
          accessEdges: seed.accessEdges,
          chainEdges: [...seed.chainEdges, ...connector, ...chainable.edges],
          connectorEdges: [...seed.connectorEdges, ...connector],
          usedEdgeIds: nextUsedEdgeIds,
          usedPairKeys: nextUsedPairKeys,
          naturalKm: nextNaturalKm,
          score:
            seed.score +
            cycleNaturalKm * 150 +
            connectorNaturalKm * 90 -
            connectorPavedKm * 220 -
            connectorRepeat.targetRepeatKm * 900 -
            repeatedCycleKm * 500 +
            chainable.prefixLength * 0.02,
          recoveryAlternativePolicy: allowTargetPairRepeatFallback
            ? "repeat_fallback"
            : "strict",
          trailSpineId: seed.trailSpineId,
          cycleEntryNodeId: entryNodeId,
          cycleRotationPrefixLength: chainable.prefixLength,
          cycleRotationAttemptCount: chainableVariants.length,
        });
      }
    }
  }
  return states
    .sort((a, b) => b.score - a.score || b.naturalKm - a.naturalKm)
    .slice(0, Math.max(beamWidth * 2, 8));
}

function uniqueConnectorAlternatives(
  connectors: DirectedMultiCycleEdgeV3[][],
): DirectedMultiCycleEdgeV3[][] {
  const unique = new Map<string, DirectedMultiCycleEdgeV3[]>();
  for (const connector of connectors) {
    const key = connector.map((edge) => edge.edge.id).join("|");
    if (!unique.has(key)) unique.set(key, connector);
  }
  return Array.from(unique.values());
}

function reverseDirectedTraversal(
  edges: DirectedMultiCycleEdgeV3[],
): DirectedMultiCycleEdgeV3[] {
  return edges
    .slice()
    .reverse()
    .map((edge) => ({ ...edge, from: edge.to, to: edge.from }));
}

function chooseAccessibleSpineOrientation(
  startNodeId: string,
  candidates: DirectedMultiCycleEdgeV3[][],
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>,
): DirectedMultiCycleEdgeV3[] {
  return (
    candidates
      .filter((candidate) => candidate.length > 0)
      .sort(
        (a, b) =>
          accessDistanceToSpineStart(startNodeId, a, adjacency) -
          accessDistanceToSpineStart(startNodeId, b, adjacency),
      )[0] ?? []
  );
}

function accessDistanceToSpineStart(
  startNodeId: string,
  spineEdges: DirectedMultiCycleEdgeV3[],
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>,
): number {
  const firstNode = spineEdges[0]?.from;
  if (!firstNode || firstNode === startNodeId) return 0;
  const forbiddenEdgeIds = new Set(spineEdges.map((edge) => edge.edge.id));
  const forbiddenPairKeys = new Set(spineEdges.map(edgePairKey));
  const access = shortestPathToAnyNode(
    startNodeId,
    [firstNode],
    adjacency,
    forbiddenEdgeIds,
    forbiddenPairKeys,
    { preferNatural: false },
  );
  return access ? sumDirectedLengths(access) : Number.POSITIVE_INFINITY;
}

function directedTraversalFromEdgeIds(
  edgeIds: string[],
  graph: EnrichedGraph,
  nodeIds?: string[],
): DirectedMultiCycleEdgeV3[] {
  if (nodeIds && nodeIds.length === edgeIds.length + 1) {
    const fromNodes = directedTraversalFromEdgeIdsWithNodes(
      edgeIds,
      nodeIds,
      graph,
    );
    if (fromNodes.length > 0) return fromNodes;
  }
  const forward = directedTraversalFromEdgeIdsWithInitialDirection(
    edgeIds,
    graph,
    false,
  );
  if (forward.length > 0) return forward;
  return directedTraversalFromEdgeIdsWithInitialDirection(edgeIds, graph, true);
}

function directedTraversalFromEdgeIdsWithNodes(
  edgeIds: string[],
  nodeIds: string[],
  graph: EnrichedGraph,
): DirectedMultiCycleEdgeV3[] {
  const result: DirectedMultiCycleEdgeV3[] = [];
  for (let index = 0; index < edgeIds.length; index += 1) {
    const edge = graph.edges.get(edgeIds[index] ?? "");
    const from = nodeIds[index];
    const to = nodeIds[index + 1];
    if (!edge || !from || !to) return [];
    if (
      !(
        (edge.from === from && edge.to === to) ||
        (edge.from === to && edge.to === from)
      )
    )
      return [];
    const semantics = classifyEdgeSemanticsV3(edge);
    result.push({
      edge,
      from,
      to,
      kind: semantics.componentKind,
      surface: semantics.routeSurface,
    });
  }
  return result;
}

function directedTraversalFromEdgeIdsWithInitialDirection(
  edgeIds: string[],
  graph: EnrichedGraph,
  reverseFirstEdge: boolean,
): DirectedMultiCycleEdgeV3[] {
  const result: DirectedMultiCycleEdgeV3[] = [];
  let current: string | null = null;
  for (let index = 0; index < edgeIds.length; index += 1) {
    const edge = graph.edges.get(edgeIds[index] ?? "");
    if (!edge) return [];
    const semantics = classifyEdgeSemanticsV3(edge);
    const reverse: boolean =
      index === 0 ? reverseFirstEdge : current !== null && edge.to === current;
    const forward: boolean =
      index === 0
        ? !reverseFirstEdge
        : current === null || edge.from === current;
    if (!forward && !reverse) return [];
    const from: string = reverse ? edge.to : edge.from;
    const to: string = reverse ? edge.from : edge.to;
    result.push({
      edge,
      from,
      to,
      kind: semantics.componentKind,
      surface: semantics.routeSurface,
    });
    current = to;
  }
  return result;
}

function computeSpineCoverage(
  edges: DirectedMultiCycleEdgeV3[],
  spine: TrailSpineCandidateV3 | null,
): Pick<
  TrailSpineAnchorDiagnosticsV3,
  "spineCoverageKm" | "spineCoverageRatio" | "missedSelectedSpineKm"
> {
  if (!spine || spine.edgeIds.length === 0 || spine.distanceKm <= 0)
    return {
      spineCoverageKm: 0,
      spineCoverageRatio: 0,
      missedSelectedSpineKm: 0,
    };
  const routeEdgeIds = new Set(edges.map((edge) => edge.edge.id));
  const spineEdgeIdSet = new Set(spine.edgeIds);
  const spineCoverageKm = round(
    edges.reduce((sum, edge) => {
      if (!spineEdgeIdSet.has(edge.edge.id) || !routeEdgeIds.has(edge.edge.id))
        return sum;
      return sum + Math.max(0, edge.edge.lengthKm);
    }, 0),
  );
  const spineCoverageRatio = round(
    Math.min(1, spineCoverageKm / Math.max(0.001, spine.distanceKm)),
  );
  return {
    spineCoverageKm,
    spineCoverageRatio,
    missedSelectedSpineKm: round(
      Math.max(0, spine.distanceKm - spineCoverageKm),
    ),
  };
}

function boundedCandidateStates(
  states: ChainStateV3[],
  input: MultiCycleDwellInputV3,
  targetComponents: Set<TerrainComponentKindV3>,
  beamWidth: number,
): ChainStateV3[] {
  const variants: ChainStateV3[] = [];
  for (const state of states) {
    variants.push(state);
    const minPrefixEdges = Math.max(
      2,
      Math.floor(state.chainEdges.length * 0.45),
    );
    const step = Math.max(1, Math.floor(state.chainEdges.length / 16));
    for (let end = minPrefixEdges; end < state.chainEdges.length; end += step) {
      const chainEdges = state.chainEdges.slice(0, end);
      const naturalKm = naturalTargetKm(chainEdges, targetComponents);
      if (naturalKm + 0.001 < input.requestedNaturalDwellKm) continue;
      const currentNodeId = chainEdges.at(-1)?.to;
      if (!currentNodeId) continue;
      const usedEdgeIds = new Set(chainEdges.map((edge) => edge.edge.id));
      const usedPairKeys = new Set(chainEdges.map(edgePairKey));
      const prefixEdgeIds = usedEdgeIds;
      const connectorEdges = state.connectorEdges.filter((edge) =>
        prefixEdgeIds.has(edge.edge.id),
      );
      variants.push({
        currentNodeId,
        cycleIds: state.cycleIds,
        accessEdges: state.accessEdges,
        chainEdges,
        connectorEdges,
        usedEdgeIds,
        usedPairKeys,
        naturalKm,
        score:
          naturalKm * 120 -
          sumPaved(chainEdges) * 180 -
          Math.abs(sumDirectedLengths(chainEdges) - input.targetDistanceKm) *
            20,
      });
    }
  }
  const deduped = new Map<string, ChainStateV3>();
  for (const variant of variants) {
    const key = `${variant.cycleIds.join("+")}::${variant.currentNodeId}::${variant.chainEdges.length}`;
    const existing = deduped.get(key);
    if (!existing || variant.score > existing.score) deduped.set(key, variant);
  }
  const unique = Array.from(deduped.values());
  const cap = Math.max(beamWidth * 8, 64);
  const halfCap = Math.ceil(cap / 2);
  const byScore = unique
    .slice()
    .sort((a, b) => b.score - a.score)
    .slice(0, halfCap);
  const byDistance = unique
    .slice()
    .sort(
      (a, b) =>
        estimatedStateDistanceError(a, input) -
          estimatedStateDistanceError(b, input) || b.score - a.score,
    )
    .slice(0, halfCap);
  const selected = new Map<string, ChainStateV3>();
  for (const variant of [...byScore, ...byDistance]) {
    const key = `${variant.cycleIds.join("+")}::${variant.currentNodeId}::${variant.chainEdges.length}`;
    if (!selected.has(key)) selected.set(key, variant);
  }
  return Array.from(selected.values()).slice(0, cap);
}

function estimatedStateDistanceError(
  state: ChainStateV3,
  input: MultiCycleDwellInputV3,
): number {
  const estimatedDistanceKm =
    sumDirectedLengths(state.accessEdges) +
    sumDirectedLengths(state.chainEdges);
  const minDistanceKm = input.minDistanceKm ?? input.targetDistanceKm * 0.7;
  const maxDistanceKm = input.maxDistanceKm ?? input.targetDistanceKm * 1.15;
  if (
    estimatedDistanceKm >= minDistanceKm &&
    estimatedDistanceKm <= maxDistanceKm
  )
    return 0;
  return Math.min(
    Math.abs(estimatedDistanceKm - minDistanceKm),
    Math.abs(estimatedDistanceKm - maxDistanceKm),
    Math.abs(estimatedDistanceKm - input.targetDistanceKm),
  );
}

function evaluateChainCandidate(args: {
  state: ChainStateV3;
  index: number;
  input: MultiCycleDwellInputV3;
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>;
  targetComponents: Set<TerrainComponentKindV3>;
  minDistanceKm: number;
  maxDistanceKm: number;
  trailSpineAnchor: TrailSpineAnchorAssessmentV3;
}): MultiCycleEvaluatedCandidateV3[] {
  const {
    state,
    index,
    input,
    adjacency,
    targetComponents,
    minDistanceKm,
    maxDistanceKm,
    trailSpineAnchor,
  } = args;
  const isSelectedSpineRecovery = Boolean(
    trailSpineAnchor.spine?.spineId &&
    state.cycleIds.includes(trailSpineAnchor.spine.spineId),
  );
  const repeatableClosurePairKeys = new Set(
    (isSelectedSpineRecovery ? state.connectorEdges : [])
      .filter((edge) => !targetComponents.has(edge.kind))
      .map(edgePairKey),
  );
  const closureAlternatives =
    state.currentNodeId === input.startNodeId
      ? [[]]
      : closureAlternativesToStart(
          state.currentNodeId,
          input.startNodeId,
          adjacency,
          state.usedEdgeIds,
          state.usedPairKeys,
          targetComponents,
          repeatableClosurePairKeys,
        );
  if (closureAlternatives.length === 0) return [];
  const access =
    state.accessEdges.length > 0
      ? state.accessEdges
      : state.chainEdges[0]?.from === input.startNodeId
        ? []
        : (shortestPathToAnyNode(
            input.startNodeId,
            [state.chainEdges[0]?.from ?? input.startNodeId],
            adjacency,
            new Set(),
            new Set(),
            { preferNatural: false },
          ) ?? []);
  return closureAlternatives.map((closure, closureIndex) => {
    const all = [...access, ...state.chainEdges, ...closure];
    const metrics = metricsFromParts(
      access,
      state.chainEdges,
      closure,
      state.connectorEdges,
      targetComponents,
    );
    const pavedRatio =
      metrics.distanceKm > 0 ? round(metrics.pavedKm / metrics.distanceKm) : 0;
    const distanceErrorKm = round(
      Math.abs(metrics.distanceKm - input.targetDistanceKm),
    );
    let rejectedReason: MultiCycleDwellCandidateRejectedReasonV3 | null = null;
    if (metrics.distanceKm > maxDistanceKm + 0.001) rejectedReason = "overlong";
    else if (metrics.distanceKm + 0.001 < minDistanceKm)
      rejectedReason = "under_min";
    else if (
      metrics.chainTargetRepeatKm > 0.001 ||
      metrics.chainConnectorRepeatKm >
        Math.max(0.35, input.targetDistanceKm * 0.08)
    )
      rejectedReason = "excessive_repeat";
    else if (
      pavedRatio > 0.48 &&
      metrics.pavedKm > Math.max(1.2, metrics.chainNaturalKm * 0.45)
    )
      rejectedReason = "excessive_paved";

    const finalPavedDiagnostics = finalPavedEquivalentDiagnostics(all);
    const spineCoverage = computeSpineCoverage(all, trailSpineAnchor.spine);
    const hardAnchorMissed =
      trailSpineAnchor.hardAnchorCredible &&
      spineCoverage.spineCoverageRatio < TRAIL_SPINE_COVERAGE_THRESHOLD;
    if (hardAnchorMissed) rejectedReason = "missed_selected_spine";
    const source =
      state.trailSpineId &&
      state.trailSpineId !==
        trailSpineAnchor.diagnostics.originalSelectedSpineId
        ? ("alternative-trail-spine-recovery" as const)
        : state.cycleIds.some((cycleId) =>
              cycleId.startsWith("trail-spine-"),
            ) || state.recoveryAlternativePolicy
          ? ("trail-spine-recovery" as const)
          : ("standard-cycle-chain" as const);
    const summary: MultiCycleDwellCandidateSummaryV3 = {
      ...metrics,
      ...finalPavedDiagnostics,
      candidateId: `multi-cycle-${index}-${closureIndex}-${state.cycleIds.join("-") || "candidate"}`,
      cycleIds: state.cycleIds,
      chainCount: state.cycleIds.length,
      source:
        source === "alternative-trail-spine-recovery"
          ? source
          : (closureAlternatives.length > 1 ||
                (state.cycleRotationAttemptCount ?? 0) > 1
              ? "cycle-rotation-closure"
              : source),
      cycleEntryNodeId: state.cycleEntryNodeId ?? null,
      cycleRotationPrefixLength: state.cycleRotationPrefixLength ?? null,
      closureAlternativeRank: closureIndex + 1,
      closureAlternativeCount: closureAlternatives.length,
      cycleRotationAttemptCount: state.cycleRotationAttemptCount ?? 1,
      repeatedTargetSegments: repeatedSegmentDiagnostics(
        access,
        state.chainEdges,
        closure,
        state.connectorEdges,
        trailSpineAnchor.spine?.edgeIds ?? [],
        targetComponents,
      ),
      spineCoverageKm: spineCoverage.spineCoverageKm,
      spineCoverageRatio: spineCoverage.spineCoverageRatio,
      missedSelectedSpineKm: spineCoverage.missedSelectedSpineKm,
      selectedSpineAnchorApplied:
        trailSpineAnchor.hardAnchorCredible &&
        spineCoverage.spineCoverageRatio >= TRAIL_SPINE_COVERAGE_THRESHOLD,
      selectedSpineAnchorRejectedReason: hardAnchorMissed
        ? "no_candidate_covers_selected_spine"
        : trailSpineAnchor.diagnostics.selectedSpineAnchorRejectedReason,
      distanceErrorKm,
      pavedRatio,
      returned: state.currentNodeId === input.startNodeId || closure.length > 0,
      selectedExitNode: state.currentNodeId,
      rejectedReason,
    };
    return {
      state,
      edgeIds: all.map((edge) => edge.edge.id),
      nodeIds: nodesFromDirectedEdges(input.startNodeId, all),
      summary,
    };
  });
}

function buildCandidateDiagnostics(
  candidates: MultiCycleEvaluatedCandidateV3[],
  rejectedCycles: MultiCycleDwellDiagnosticsV3["rejectedCycles"],
  selectedCandidateId: string | null,
  overlapRejectedCount: number,
): MultiCycleDwellCandidateDiagnosticsV3 {
  const summaries = candidates.map((candidate) => ({
    ...candidate.summary,
    cycleIds: [...candidate.summary.cycleIds],
  }));
  const acceptable = summaries.filter(
    (candidate) => candidate.rejectedReason === null,
  );
  const dominatedIds = new Set<string>();
  for (const candidate of acceptable) {
    const dominated = acceptable.some(
      (other) =>
        other.candidateId !== candidate.candidateId &&
        dominatesCandidate(other, candidate),
    );
    if (dominated && candidate.candidateId !== selectedCandidateId)
      dominatedIds.add(candidate.candidateId);
  }
  for (const summary of summaries) {
    if (dominatedIds.has(summary.candidateId))
      summary.rejectedReason = "dominated";
  }
  const finalAcceptable = summaries.filter(
    (candidate) => candidate.rejectedReason === null,
  );
  const paretoFrontier = finalAcceptable
    .slice()
    .sort(
      (a, b) =>
        candidateParetoScore(b, b.distanceKm + b.distanceErrorKm) -
        candidateParetoScore(a, a.distanceKm + a.distanceErrorKm),
    )
    .slice(0, 8);
  const cycleRejected = rejectedCycles.slice(0, 8).map((cycle) => ({
    candidateId: cycle.id,
    cycleIds: [cycle.id],
    rejectedReason:
      cycle.reason === "connector_paved"
        ? ("excessive_paved" as const)
        : cycle.reason === "repeat" || cycle.reason === "overlap"
          ? ("excessive_repeat" as const)
          : ("dominated" as const),
  }));
  const rejectedSorted = summaries
    .filter((candidate) => candidate.rejectedReason !== null)
    .sort(
      (a, b) =>
        rejectedCandidateDiagnosticScore(b) -
        rejectedCandidateDiagnosticScore(a),
    );
  const reasonPlaceholders = Array.from(
    new Set([
      ...rejectedSorted
        .map((candidate) => candidate.rejectedReason)
        .filter(
          (reason): reason is MultiCycleDwellCandidateRejectedReasonV3 =>
            reason !== null,
        ),
      ...cycleRejected.map((candidate) => candidate.rejectedReason),
      ...(overlapRejectedCount > 0 ? ["excessive_repeat" as const] : []),
    ]),
  ).map((reason) => ({
    candidateId: `reason-${reason}`,
    cycleIds: [],
    rejectedReason: reason,
  }));
  const topRejected = [
    ...reasonPlaceholders,
    ...rejectedSorted.slice(0, 12),
    ...cycleRejected,
  ].slice(0, 16);
  const selectedCandidate =
    summaries.find(
      (candidate) => candidate.candidateId === selectedCandidateId,
    ) ?? null;
  const selectedCandidatePavedComparison = selectedCandidate
    ? {
        candidateId: selectedCandidate.candidateId,
        explicitPavedRatio: selectedCandidate.explicitPavedRatio,
        finalPavedRatioEstimate: selectedCandidate.finalPavedRatioEstimate,
        finalPavedEquivalentKm: selectedCandidate.finalPavedEquivalentKm,
        mixedUnknownKm: selectedCandidate.mixedUnknownKm,
        roadLikeUnknownKm: selectedCandidate.roadLikeUnknownKm,
        pathTrackUnknownKm: selectedCandidate.pathTrackUnknownKm,
        trailCandidateKm: selectedCandidate.trailCandidateKm,
        unverifiedTrailCandidateKm:
          selectedCandidate.unverifiedTrailCandidateKm,
        candidateNaturalKm: selectedCandidate.candidateNaturalKm,
        strictNaturalKm: selectedCandidate.strictNaturalKm,
        naturalWayEquivalentKm: selectedCandidate.naturalWayEquivalentKm,
      }
    : null;
  return {
    count: summaries.length,
    selectedCandidateId,
    recoveryAlternativeCount:
      summaries.filter(
        (candidate) =>
          candidate.cycleIds.some((cycleId) =>
            cycleId.startsWith("trail-spine-"),
          ) || candidate.selectedSpineAnchorApplied,
      ).length || summaries.length,
    selectedRecoveryAlternativeRank:
      candidates.find(
        (candidate) => candidate.summary.candidateId === selectedCandidateId,
      )?.state.recoveryAlternativeRank ?? null,
    recoveryRejectedReasons: recoveryRejectedReasons(summaries, topRejected),
    bestAlternativeDelta: bestAlternativeDelta(summaries, selectedCandidateId),
    repeatAvoidanceAttemptCount: candidates.filter(
      (candidate) => candidate.state.recoveryAlternativePolicy === "strict",
    ).length,
    pavedAvoidanceAttemptCount: summaries.filter(
      (candidate) =>
        candidate.finalPavedRatioEstimate <= 0.48 ||
        candidate.pavedRatio <= 0.48,
    ).length,
    cycleRotationAttemptCount: summaries.reduce(
      (sum, candidate) => sum + candidate.cycleRotationAttemptCount,
      0,
    ),
    closureAlternativeCount: summaries.reduce(
      (sum, candidate) => sum + candidate.closureAlternativeCount,
      0,
    ),
    selectedCandidate,
    selectedCandidatePavedComparison,
    inEnvelopeCount: summaries.filter(
      (candidate) =>
        candidate.rejectedReason !== "under_min" &&
        candidate.rejectedReason !== "overlong" &&
        candidate.distanceKm > 0,
    ).length,
    overlongCount: summaries.filter(
      (candidate) =>
        candidate.distanceKm > 0 && candidate.rejectedReason === "overlong",
    ).length,
    underMinCount: summaries.filter(
      (candidate) =>
        candidate.distanceKm > 0 && candidate.rejectedReason === "under_min",
    ).length,
    topCandidates: paretoFrontier,
    paretoFrontier,
    topRejected,
    selectionReason: selectedCandidateId
      ? "best_pareto_in_distance_envelope"
      : null,
  };
}

function dominatesCandidate(
  a: MultiCycleDwellCandidateSummaryV3,
  b: MultiCycleDwellCandidateSummaryV3,
): boolean {
  const notWorse =
    a.distanceErrorKm <= b.distanceErrorKm + 0.001 &&
    a.chainNaturalKm + 0.001 >= b.chainNaturalKm &&
    a.pavedRatio <= b.pavedRatio + 0.001 &&
    a.chainRepeatKm <= b.chainRepeatKm + 0.001;
  const better =
    a.distanceErrorKm + 0.001 < b.distanceErrorKm ||
    a.chainNaturalKm > b.chainNaturalKm + 0.25 ||
    a.pavedRatio + 0.03 < b.pavedRatio ||
    a.chainRepeatKm + 0.001 < b.chainRepeatKm;
  return notWorse && better;
}

function candidateParetoScore(
  candidate: MultiCycleDwellCandidateSummaryV3,
  targetDistanceKm: number,
): number {
  const distancePenalty =
    Math.abs(candidate.distanceKm - targetDistanceKm) * 90;
  const pavedPenalty = candidate.pavedKm * 160 + candidate.pavedRatio * 240;
  const repeatPenalty =
    candidate.chainTargetRepeatKm * 500 +
    candidate.chainConnectorRepeatKm * 120 +
    candidate.chainRepeatKm * 80;
  const naturalReward =
    candidate.chainNaturalKm * 210 + candidate.connectorNaturalKm * 60;
  const closurePenalty =
    candidate.closurePavedKm * 90 + candidate.closureKm * 8;
  const chainBonus = Math.min(candidate.chainCount, 3) * 60;
  const spineBonus = candidate.selectedSpineAnchorApplied
    ? candidate.spineCoverageKm * 650 + candidate.spineCoverageRatio * 700
    : 0;
  return (
    naturalReward +
    chainBonus +
    spineBonus -
    distancePenalty -
    pavedPenalty -
    repeatPenalty -
    closurePenalty
  );
}

function candidateDiagnosticScore(
  candidate: MultiCycleDwellCandidateSummaryV3,
  targetDistanceKm: number,
): number {
  return (
    candidate.chainNaturalKm * 100 +
    Math.min(candidate.distanceKm, targetDistanceKm) * 40 -
    candidate.pavedKm * 30 -
    candidate.chainRepeatKm * 100
  );
}

function rejectedCandidateDiagnosticScore(
  candidate: MultiCycleDwellCandidateSummaryV3,
): number {
  const distanceGatePenalty =
    candidate.rejectedReason === "overlong" ||
    candidate.rejectedReason === "under_min"
      ? 0
      : 10_000;
  const spineBonus = candidate.selectedSpineAnchorApplied
    ? 5_000 + candidate.spineCoverageRatio * 1_000
    : 0;
  const actionability =
    candidate.rejectedReason === "excessive_paved" ||
    candidate.rejectedReason === "excessive_repeat"
      ? 2_000
      : 0;
  return (
    distanceGatePenalty +
    spineBonus +
    actionability +
    candidate.chainNaturalKm * 100 -
    candidate.pavedKm * 30 -
    candidate.chainRepeatKm * 100 -
    candidate.distanceErrorKm * 10
  );
}

function recoveryRejectedReasons(
  summaries: MultiCycleDwellCandidateSummaryV3[],
  topRejected: Array<
    | MultiCycleDwellCandidateSummaryV3
    | {
        candidateId: string;
        cycleIds: string[];
        rejectedReason: MultiCycleDwellCandidateRejectedReasonV3;
      }
  > = [],
): Array<{ reason: RecoveryAlternativeRejectedReasonV3; count: number }> {
  const counts = new Map<RecoveryAlternativeRejectedReasonV3, number>();
  const add = (reason: RecoveryAlternativeRejectedReasonV3) =>
    counts.set(reason, (counts.get(reason) ?? 0) + 1);
  for (const candidate of [...summaries, ...topRejected]) {
    if (candidate.rejectedReason === "missed_selected_spine")
      add("missed_selected_spine");
    else if (candidate.rejectedReason === "excessive_paved")
      add("candidate_excessive_paved");
    else if (candidate.rejectedReason === "excessive_repeat")
      add("candidate_excessive_repeat");
    else if (
      candidate.rejectedReason === "under_min" ||
      candidate.rejectedReason === "overlong"
    )
      add("candidate_distance_gate");
  }
  return Array.from(counts.entries()).map(([reason, count]) => ({
    reason,
    count,
  }));
}

function bestAlternativeDelta(
  summaries: MultiCycleDwellCandidateSummaryV3[],
  selectedCandidateId: string | null,
): MultiCycleDwellCandidateDiagnosticsV3["bestAlternativeDelta"] {
  if (summaries.length < 2) return null;
  const selected =
    summaries.find(
      (candidate) => candidate.candidateId === selectedCandidateId,
    ) ??
    summaries
      .slice()
      .sort(
        (a, b) =>
          candidateDiagnosticScore(b, b.distanceKm + b.distanceErrorKm) -
          candidateDiagnosticScore(a, a.distanceKm + a.distanceErrorKm),
      )[0];
  if (!selected) return null;
  const bestRepeatOrPavedAlternative = summaries
    .filter((candidate) => candidate.candidateId !== selected.candidateId)
    .sort(
      (a, b) =>
        (selected.chainTargetRepeatKm - a.chainTargetRepeatKm) * 1_000 +
        (selected.pavedRatio - a.pavedRatio) * 500 +
        a.spineCoverageRatio * 100 -
        ((selected.chainTargetRepeatKm - b.chainTargetRepeatKm) * 1_000 +
          (selected.pavedRatio - b.pavedRatio) * 500 +
          b.spineCoverageRatio * 100),
    )[0];
  if (!bestRepeatOrPavedAlternative) return null;
  return {
    candidateId: bestRepeatOrPavedAlternative.candidateId,
    distanceDeltaKm: round(
      bestRepeatOrPavedAlternative.distanceKm - selected.distanceKm,
    ),
    pavedRatioDelta: round(
      bestRepeatOrPavedAlternative.pavedRatio - selected.pavedRatio,
    ),
    targetRepeatDeltaKm: round(
      bestRepeatOrPavedAlternative.chainTargetRepeatKm -
        selected.chainTargetRepeatKm,
    ),
    spineCoverageDelta: round(
      bestRepeatOrPavedAlternative.spineCoverageRatio -
        selected.spineCoverageRatio,
    ),
  };
}

function emptyCandidateDiagnostics(): MultiCycleDwellCandidateDiagnosticsV3 {
  return {
    count: 0,
    selectedCandidateId: null,
    recoveryAlternativeCount: 0,
    selectedRecoveryAlternativeRank: null,
    recoveryRejectedReasons: [],
    bestAlternativeDelta: null,
    repeatAvoidanceAttemptCount: 0,
    pavedAvoidanceAttemptCount: 0,
    cycleRotationAttemptCount: 0,
    closureAlternativeCount: 0,
    selectedCandidate: null,
    selectedCandidatePavedComparison: null,
    inEnvelopeCount: 0,
    overlongCount: 0,
    underMinCount: 0,
    topCandidates: [],
    paretoFrontier: [],
    topRejected: [],
    selectionReason: null,
  };
}

function diagnosticsFrom(
  failedPhase: MultiCycleDwellFailedPhaseV3,
  best: ChainStateV3 | null,
  metrics: MultiCycleDwellMetricsV3,
  rejectedCycles: MultiCycleDwellDiagnosticsV3["rejectedCycles"],
  overlapRejectedCount: number,
  prunedCandidateCount: number,
  maxCycles: number,
  beamWidth: number,
  selectedExitNode: string | null,
  multiCycleDwellCandidates: MultiCycleDwellCandidateDiagnosticsV3,
  trailSpineAnchor: TrailSpineAnchorAssessmentV3,
  spineSeedAssessment: TrailSpineSeedAssessmentV3,
  targetComponents: Set<TerrainComponentKindV3>,
  assemblyTimeout: MultiCycleAssemblyTimeoutDiagnosticsV3 | null = null,
): MultiCycleDwellDiagnosticsV3 {
  const bestCoverage = best
    ? computeSpineCoverage(
        [...best.accessEdges, ...best.chainEdges],
        trailSpineAnchor.spine,
      )
    : {
        spineCoverageKm: 0,
        spineCoverageRatio: 0,
        missedSelectedSpineKm: trailSpineAnchor.spine?.distanceKm ?? 0,
      };
  const selectedCoverage = multiCycleDwellCandidates.selectedCandidate
    ? {
        spineCoverageKm:
          multiCycleDwellCandidates.selectedCandidate.spineCoverageKm,
        spineCoverageRatio:
          multiCycleDwellCandidates.selectedCandidate.spineCoverageRatio,
        missedSelectedSpineKm:
          multiCycleDwellCandidates.selectedCandidate.missedSelectedSpineKm,
      }
    : bestCoverage;
  const missedCredibleAnchor =
    trailSpineAnchor.hardAnchorCredible &&
    !multiCycleDwellCandidates.selectedCandidate &&
    (multiCycleDwellCandidates.topRejected.some(
      (candidate) => candidate.rejectedReason === "missed_selected_spine",
    ) ||
      selectedCoverage.spineCoverageRatio < TRAIL_SPINE_COVERAGE_THRESHOLD);
  const bestSummary =
    multiCycleDwellCandidates.selectedCandidate ??
    multiCycleDwellCandidates.topRejected.find(
      (candidate): candidate is MultiCycleDwellCandidateSummaryV3 =>
        "distanceKm" in candidate && typeof candidate.distanceKm === "number",
    ) ??
    null;
  const seedFailureStage = deriveSpineSeedFailureStage(
    spineSeedAssessment,
    bestSummary,
    failedPhase,
    missedCredibleAnchor,
  );
  const seedRejectedReason = deriveSpineSeedRejectedReason(
    seedFailureStage,
    bestSummary,
    missedCredibleAnchor,
    trailSpineAnchor.diagnostics.selectedSpineAnchorRejectedReason,
  );
  const rawRecoveryRepeatEvidence = deriveRecoveryRepeatEvidence(
    bestSummary,
    multiCycleDwellCandidates.topRejected,
    best && trailSpineAnchor.spine
      ? repeatedSegmentDiagnostics(
          best.accessEdges,
          best.chainEdges,
          [],
          best.connectorEdges,
          trailSpineAnchor.spine.edgeIds,
          targetComponents,
        )
      : [],
  );
  const seedRecoveryBlocked =
    trailSpineAnchor.hardAnchorCredible &&
    Boolean(spineSeedAssessment.state) &&
    rawRecoveryRepeatEvidence.rootCause === "none" &&
    failedPhase !== null;
  const recoveryRepeatEvidence = seedRecoveryBlocked
    ? {
        rootCause: "selected_spine_to_cycle_recovery" as const,
        pairKeys: terminalSpinePairKeys(trailSpineAnchor.spine),
      }
    : rawRecoveryRepeatEvidence;
  const selectedSpineEndpointAdjusted = Boolean(
    trailSpineAnchor.hardAnchorCredible &&
    selectedCoverage.spineCoverageRatio >= TRAIL_SPINE_COVERAGE_THRESHOLD &&
    selectedCoverage.spineCoverageRatio < 0.999,
  );
  return {
    ...metrics,
    cycleIds: best?.cycleIds ?? [],
    chainCount: best?.cycleIds.length ?? 0,
    candidateCount: Math.max(
      multiCycleDwellCandidates.count,
      (best?.cycleIds.length ?? 0) + rejectedCycles.length,
    ),
    selectedExitNode,
    failedPhase,
    rejectedCycles: rejectedCycles.slice(0, 24),
    overlapRejectedCount,
    prunedCandidateCount,
    maxCycles,
    beamWidth,
    multiCycleDwellCandidates,
    ...(assemblyTimeout ? { assemblyTimeout } : {}),
    trailSpineAnchor: {
      ...trailSpineAnchor.diagnostics,
      recoveryRejectedReasons:
        multiCycleDwellCandidates.recoveryRejectedReasons.length > 0
          ? multiCycleDwellCandidates.recoveryRejectedReasons
          : trailSpineAnchor.diagnostics.recoveryRejectedReasons,
      selectedSpineAnchorApplied:
        trailSpineAnchor.diagnostics.selectedSpineAnchorApplied ||
        Boolean(
          multiCycleDwellCandidates.selectedCandidate
            ?.selectedSpineAnchorApplied,
        ),
      selectedSpineAnchorRejectedReason: seedRejectedReason,
      recoveryRepeatRootCause: recoveryRepeatEvidence.rootCause,
      repeatedRecoveryPairKeys: recoveryRepeatEvidence.pairKeys,
      selectedSpineEndpointAdjusted,
      selectedSpineAdjustedReason: selectedSpineEndpointAdjusted
        ? "sub_spine_endpoint_avoids_recovery_repeat_or_distance_risk"
        : null,
      subSpineCoverageRatio: selectedSpineEndpointAdjusted
        ? selectedCoverage.spineCoverageRatio
        : 0,
      subSpineReason: selectedSpineEndpointAdjusted
        ? "credible_sub_spine_preserved_strict_trail_moment"
        : null,
      targetRepeatFreeRecoveryAttemptCount: Math.max(
        multiCycleDwellCandidates.repeatAvoidanceAttemptCount,
        trailSpineAnchor.hardAnchorCredible && spineSeedAssessment.state
          ? 1
          : 0,
      ),
      targetRepeatFreeRecoveryRejectedReasons: seedRecoveryBlocked
        ? [
            { reason: "candidate_excessive_repeat", count: 1 },
            ...(multiCycleDwellCandidates.recoveryRejectedReasons.length > 0
              ? multiCycleDwellCandidates.recoveryRejectedReasons
              : trailSpineAnchor.diagnostics
                  .targetRepeatFreeRecoveryRejectedReasons),
          ]
        : multiCycleDwellCandidates.recoveryRejectedReasons.length > 0
          ? multiCycleDwellCandidates.recoveryRejectedReasons
          : trailSpineAnchor.diagnostics.targetRepeatFreeRecoveryRejectedReasons
                .length > 0 &&
              !trailSpineAnchor.diagnostics.targetRepeatFreeRecoveryRejectedReasons.every(
                (entry) => entry.reason === "no_path",
              )
            ? trailSpineAnchor.diagnostics
                .targetRepeatFreeRecoveryRejectedReasons
            : [],
      bestRepeatFreeRecoveryDelta:
        multiCycleDwellCandidates.bestAlternativeDelta,
      spineSeedCandidateBuilt: Boolean(spineSeedAssessment.state),
      spineSeedFailureStage: seedFailureStage,
      accessCostKm: round(spineSeedAssessment.accessCostKm),
      recoveryCostKm: round(
        bestSummary?.connectorPavedKm !== undefined
          ? bestSummary.connectorNaturalKm + bestSummary.connectorPavedKm
          : 0,
      ),
      closureCostKm: round(bestSummary?.closureKm ?? 0),
      connectorPavedRisk:
        bestSummary && bestSummary.distanceKm > 0
          ? round(
              (bestSummary.connectorPavedKm + bestSummary.closurePavedKm) /
                bestSummary.distanceKm,
            )
          : trailSpineAnchor.diagnostics.connectorPavedRisk,
      repeatRisk:
        bestSummary && bestSummary.distanceKm > 0
          ? round(bestSummary.chainRepeatKm / bestSummary.distanceKm)
          : trailSpineAnchor.diagnostics.repeatRisk,
      ...selectedCoverage,
    },
  };
}

function terminalSpinePairKeys(spine: TrailSpineCandidateV3 | null): string[] {
  if (!spine?.nodeIds || spine.nodeIds.length < 2) return [];
  const from = spine.nodeIds.at(-2);
  const to = spine.nodeIds.at(-1);
  if (!from || !to) return [];
  return [[from, to].sort().join("::")];
}

function isMultiCycleCandidateSummary(
  candidate:
    | MultiCycleDwellCandidateSummaryV3
    | {
        candidateId: string;
        cycleIds: string[];
        rejectedReason: MultiCycleDwellCandidateRejectedReasonV3;
      },
): candidate is MultiCycleDwellCandidateSummaryV3 {
  return (
    "repeatedTargetSegments" in candidate &&
    Array.isArray(candidate.repeatedTargetSegments)
  );
}

function deriveRecoveryRepeatEvidence(
  selected: MultiCycleDwellCandidateSummaryV3 | null,
  rejected: Array<
    | MultiCycleDwellCandidateSummaryV3
    | {
        candidateId: string;
        cycleIds: string[];
        rejectedReason: MultiCycleDwellCandidateRejectedReasonV3;
      }
  >,
  fallbackSegments: MultiCycleRepeatedSegmentDiagnosticsV3[] = [],
): {
  rootCause: TrailSpineAnchorDiagnosticsV3["recoveryRepeatRootCause"];
  pairKeys: string[];
} {
  const summaries: MultiCycleDwellCandidateSummaryV3[] = [];
  for (const candidate of [selected, ...rejected]) {
    if (candidate && isMultiCycleCandidateSummary(candidate))
      summaries.push(candidate);
  }
  const recoverySegments = [
    ...summaries.flatMap((candidate) => candidate.repeatedTargetSegments),
    ...fallbackSegments,
  ].filter(
    (segment) => segment.segment === "recovery" && segment.targetRepeatKm > 0,
  );
  if (recoverySegments.length > 0) {
    return {
      rootCause: "selected_spine_to_cycle_recovery",
      pairKeys: Array.from(
        new Set(
          recoverySegments.flatMap((segment) => segment.repeatedPairKeys),
        ),
      ).slice(0, 24),
    };
  }
  const otherRepeatedTargetSegments = [
    ...summaries.flatMap((candidate) => candidate.repeatedTargetSegments),
    ...fallbackSegments,
  ].filter((segment) => segment.targetRepeatKm > 0);
  if (otherRepeatedTargetSegments.length > 0) {
    return {
      rootCause: "cycle_or_closure",
      pairKeys: Array.from(
        new Set(
          otherRepeatedTargetSegments.flatMap(
            (segment) => segment.repeatedPairKeys,
          ),
        ),
      ).slice(0, 24),
    };
  }
  return { rootCause: "none", pairKeys: [] };
}

function deriveSpineSeedFailureStage(
  seed: TrailSpineSeedAssessmentV3,
  bestSummary: MultiCycleDwellCandidateSummaryV3 | null,
  failedPhase: MultiCycleDwellFailedPhaseV3,
  missedCredibleAnchor: boolean,
): TrailSpineSeedFailureStageV3 {
  if (!seed.state) return seed.failureStage;
  if (!bestSummary)
    return failedPhase === "closurePhase" ? "closure" : "recovery";
  if (
    !missedCredibleAnchor &&
    bestSummary.selectedSpineAnchorApplied &&
    bestSummary.rejectedReason === null
  )
    return null;
  if (bestSummary.rejectedReason === "under_min") return "distance_gate";
  if (bestSummary.rejectedReason === "overlong") return "distance_gate";
  if (bestSummary.rejectedReason === "excessive_paved") return "surface_gate";
  if (bestSummary.rejectedReason === "excessive_repeat") return "repeat_gate";
  if (
    missedCredibleAnchor ||
    bestSummary.rejectedReason === "missed_selected_spine"
  )
    return "recovery";
  if (failedPhase === "finalGate") return "distance_gate";
  return seed.failureStage;
}

function deriveSpineSeedRejectedReason(
  failureStage: TrailSpineSeedFailureStageV3,
  bestSummary: MultiCycleDwellCandidateSummaryV3 | null,
  missedCredibleAnchor: boolean,
  fallback: TrailSpineAnchorRejectedReasonV3 | null,
): TrailSpineAnchorRejectedReasonV3 | null {
  if (
    !failureStage &&
    bestSummary?.selectedSpineAnchorApplied &&
    bestSummary.rejectedReason === null
  )
    return fallback;
  if (bestSummary?.rejectedReason === "under_min")
    return "spine_candidate_under_min";
  if (bestSummary?.rejectedReason === "overlong")
    return "spine_candidate_overlong";
  if (bestSummary?.rejectedReason === "excessive_paved")
    return "spine_candidate_excessive_paved";
  if (bestSummary?.rejectedReason === "excessive_repeat")
    return "spine_candidate_excessive_repeat";
  if (failureStage === "access") return "spine_access_unreachable";
  if (failureStage === "closure") return "spine_closure_unreachable";
  if (failureStage === "recovery")
    return missedCredibleAnchor ? "spine_recovery_unreachable" : fallback;
  if (failureStage === "distance_gate")
    return bestSummary &&
      bestSummary.distanceKm > 0 &&
      bestSummary.distanceKm <
        bestSummary.distanceKm + bestSummary.distanceErrorKm
      ? "spine_candidate_under_min"
      : "spine_candidate_overlong";
  if (failureStage === "surface_gate") return "spine_candidate_excessive_paved";
  if (failureStage === "repeat_gate") return "spine_candidate_excessive_repeat";
  return fallback;
}

function orderedCycleScore(
  cycle: OrderedCycleV3,
  trailSpines: TrailSpineCandidateV3[],
): number {
  const cycleEdgeIds = new Set(cycle.edgeIds);
  const bestSpine = trailSpines.reduce((best, spine) => {
    const overlapKm = spine.edgeIds.filter((edgeId) =>
      cycleEdgeIds.has(edgeId),
    ).length;
    return overlapKm > best ? overlapKm : best;
  }, 0);
  return cycle.naturalKm * 140 + cycle.lengthKm * 35 + bestSpine * 120;
}

function orderCycleEdges(
  cycle: NaturalCycleCandidateV3,
  graph: EnrichedGraph,
): OrderedCycleV3 | null {
  const edges = cycle.originalEdgeIds.map((edgeId) => graph.edges.get(edgeId));
  if (edges.some((edge) => !edge)) return null;
  const remaining = new Map(
    edges
      .filter((edge): edge is EnrichedEdge => Boolean(edge))
      .map((edge) => [edge.id, edge]),
  );
  const start =
    cycle.originalNodeIds[0] ?? remaining.values().next().value?.from;
  if (!start) return null;
  const ordered: DirectedMultiCycleEdgeV3[] = [];
  const nodes = [start];
  let current = start;
  const originalOrder = new Map(
    cycle.originalEdgeIds.map((edgeId, index) => [edgeId, index]),
  );
  while (remaining.size > 0) {
    const next = Array.from(remaining.values())
      .filter((edge) => edge.from === current || edge.to === current)
      .sort(
        (a, b) =>
          (originalOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) -
            (originalOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER) ||
          a.id.localeCompare(b.id),
      )[0];
    if (!next) return null;
    remaining.delete(next.id);
    const directed = directedEdge(next, current);
    ordered.push(directed);
    current = directed.to;
    nodes.push(current);
  }
  if (nodes[0] !== nodes.at(-1)) return null;
  return {
    id: cycle.id,
    edges: ordered,
    nodes,
    edgeIds: new Set(ordered.map((edge) => edge.edge.id)),
    pairKeys: new Set(ordered.map(edgePairKey)),
    lengthKm: round(sumDirectedLengths(ordered)),
    naturalKm: round(
      naturalTargetKm(
        ordered,
        new Set<TerrainComponentKindV3>([
          "forest",
          "field_paths",
          "park",
          "river_corridor",
          "urban_green",
        ]),
      ),
    ),
  };
}

function rotateCycleToNode(
  cycle: OrderedCycleV3,
  entryNodeId: string,
): OrderedCycleV3 | null {
  const startIndex = cycle.nodes.slice(0, -1).indexOf(entryNodeId);
  if (startIndex < 0) return null;
  const edges = [
    ...cycle.edges.slice(startIndex),
    ...cycle.edges.slice(0, startIndex),
  ];
  const rotatedEdges: DirectedMultiCycleEdgeV3[] = [];
  let current = entryNodeId;
  for (const candidate of edges) {
    const edge = candidate.edge;
    if (edge.from !== current && edge.to !== current) return null;
    const directed = directedEdge(edge, current);
    rotatedEdges.push(directed);
    current = directed.to;
  }
  const nodes = nodesFromDirectedEdges(entryNodeId, rotatedEdges);
  if (nodes.at(-1) !== entryNodeId) return null;
  return { ...cycle, edges: rotatedEdges, nodes };
}

function openCycleForChaining(
  cycle: OrderedCycleV3,
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>,
): {
  edges: DirectedMultiCycleEdgeV3[];
  nodes: string[];
  prefixLength: number;
} {
  return (
    openCycleVariantsForChaining(cycle, adjacency, 1)[0] ?? {
      edges: [],
      nodes: [],
      prefixLength: 0,
    }
  );
}

function openCycleVariantsForChaining(
  cycle: OrderedCycleV3,
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>,
  maxVariants: number,
): Array<{
  edges: DirectedMultiCycleEdgeV3[];
  nodes: string[];
  prefixLength: number;
}> {
  const outsideEdgeScore = (nodeId: string) =>
    (adjacency.get(nodeId) ?? [])
      .filter((edge) => !cycle.edgeIds.has(edge.edge.id))
      .reduce(
        (score, edge) =>
          score +
          (edge.surface === "paved" ? 1 : 4) +
          Math.max(0, edge.edge.lengthKm),
        0,
      );
  const minPrefixLength = Math.max(2, Math.ceil(cycle.edges.length * 0.6));
  const scored: Array<{ prefixLength: number; score: number }> = [
    {
      prefixLength: cycle.edges.length,
      score:
        outsideEdgeScore(cycle.nodes.at(-1) ?? cycle.nodes[0] ?? "") +
        cycle.edges.length * 0.01,
    },
  ];
  for (
    let prefixLength = minPrefixLength;
    prefixLength < cycle.edges.length;
    prefixLength += 1
  ) {
    const nodeId = cycle.nodes[prefixLength];
    if (!nodeId) continue;
    scored.push({
      prefixLength,
      score: outsideEdgeScore(nodeId) + prefixLength * 0.01,
    });
  }
  const unique = new Map<
    number,
    { edges: DirectedMultiCycleEdgeV3[]; nodes: string[]; prefixLength: number }
  >();
  for (const item of scored.sort(
    (a, b) => b.score - a.score || b.prefixLength - a.prefixLength,
  )) {
    const edges = cycle.edges.slice(0, item.prefixLength);
    if (edges.length === 0) continue;
    unique.set(item.prefixLength, {
      edges,
      nodes: nodesFromDirectedEdges(
        cycle.nodes[0] ?? edges[0]?.from ?? "",
        edges,
      ),
      prefixLength: item.prefixLength,
    });
  }
  return Array.from(unique.values()).slice(0, Math.max(1, maxVariants));
}

function buildAdjacency(
  graph: EnrichedGraph,
): Map<string, DirectedMultiCycleEdgeV3[]> {
  const adjacency = new Map<string, DirectedMultiCycleEdgeV3[]>();
  for (const nodeId of Array.from(graph.nodes.keys()))
    adjacency.set(nodeId, []);
  for (const edge of Array.from(graph.edges.values())) {
    adjacency.get(edge.from)?.push(directedEdge(edge, edge.from));
    adjacency.get(edge.to)?.push(directedEdge(edge, edge.to));
  }
  return adjacency;
}

function directedEdge(
  edge: EnrichedEdge,
  from: string,
): DirectedMultiCycleEdgeV3 {
  const to = edge.from === from ? edge.to : edge.from;
  return {
    edge,
    from,
    to,
    kind: componentKind(edge),
    surface: routeSurface(edge),
  };
}

function shortestPathToAnyNode(
  fromNodeId: string,
  toNodeIds: string[],
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>,
  forbiddenEdgeIds: Set<string>,
  forbiddenPairKeys: Set<string>,
  options: { preferNatural: boolean },
): DirectedMultiCycleEdgeV3[] | null {
  const targets = new Set(toNodeIds);
  if (targets.has(fromNodeId)) return [];
  const bestDistances = new Map<string, number>([[fromNodeId, 0]]);
  const pending: Array<{
    nodeId: string;
    cost: number;
    traversal: DirectedMultiCycleEdgeV3[];
  }> = [{ nodeId: fromNodeId, cost: 0, traversal: [] }];
  while (pending.length > 0) {
    const current = pending.sort((a, b) => a.cost - b.cost).shift();
    if (!current) break;
    if (targets.has(current.nodeId)) return current.traversal;
    if (
      current.cost >
      (bestDistances.get(current.nodeId) ?? Number.POSITIVE_INFINITY) + 0.000001
    )
      continue;
    for (const edge of adjacency.get(current.nodeId) ?? []) {
      if (
        forbiddenEdgeIds.has(edge.edge.id) ||
        forbiddenPairKeys.has(edgePairKey(edge))
      )
        continue;
      const pavedPenalty =
        options.preferNatural && edge.surface === "paved" ? 4 : 0;
      const roadPenalty =
        options.preferNatural &&
        classifyEdgeSemanticsV3(edge.edge).isConnectorLike
          ? 2
          : 0;
      const nextCost =
        current.cost +
        Math.max(0, edge.edge.lengthKm) +
        pavedPenalty +
        roadPenalty;
      if (
        nextCost + 0.000001 >=
        (bestDistances.get(edge.to) ?? Number.POSITIVE_INFINITY)
      )
        continue;
      bestDistances.set(edge.to, nextCost);
      pending.push({
        nodeId: edge.to,
        cost: nextCost,
        traversal: [...current.traversal, edge],
      });
    }
  }
  return null;
}

function kShortestPathsToAnyNode(
  fromNodeId: string,
  toNodeIds: string[],
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>,
  forbiddenEdgeIds: Set<string>,
  forbiddenPairKeys: Set<string>,
  options: { preferNatural: boolean; k: number; maxVisitedStates: number },
): DirectedMultiCycleEdgeV3[][] {
  const targets = new Set(toNodeIds);
  if (targets.has(fromNodeId)) return [[]];
  const maxPathLength = Math.max(8, Math.min(80, adjacency.size));
  const results: Array<{
    cost: number;
    traversal: DirectedMultiCycleEdgeV3[];
  }> = [];
  const pending: Array<{
    nodeId: string;
    cost: number;
    traversal: DirectedMultiCycleEdgeV3[];
    visitedNodeIds: Set<string>;
  }> = [
    {
      nodeId: fromNodeId,
      cost: 0,
      traversal: [],
      visitedNodeIds: new Set([fromNodeId]),
    },
  ];
  const bestSignatureCosts = new Map<string, number>();
  let visitedStates = 0;
  while (
    pending.length > 0 &&
    results.length < options.k &&
    visitedStates < options.maxVisitedStates
  ) {
    const current = pending
      .sort(
        (a, b) => a.cost - b.cost || a.traversal.length - b.traversal.length,
      )
      .shift();
    if (!current) break;
    visitedStates += 1;
    if (targets.has(current.nodeId)) {
      results.push({ cost: current.cost, traversal: current.traversal });
      continue;
    }
    if (current.traversal.length >= maxPathLength) continue;
    for (const edge of adjacency.get(current.nodeId) ?? []) {
      if (
        forbiddenEdgeIds.has(edge.edge.id) ||
        forbiddenPairKeys.has(edgePairKey(edge))
      )
        continue;
      if (current.visitedNodeIds.has(edge.to) && !targets.has(edge.to))
        continue;
      const pavedPenalty =
        options.preferNatural && edge.surface === "paved" ? 4 : 0;
      const semantics = classifyEdgeSemanticsV3(edge.edge);
      const roadPenalty =
        options.preferNatural && semantics.isConnectorLike ? 2 : 0;
      const mixedPenalty =
        options.preferNatural && semantics.routeSurface === "mixed" ? 0.8 : 0;
      const repeatWithinPathPenalty = current.traversal.some(
        (used) => edgePairKey(used) === edgePairKey(edge),
      )
        ? 6
        : 0;
      const nextCost =
        current.cost +
        Math.max(0, edge.edge.lengthKm) +
        pavedPenalty +
        roadPenalty +
        mixedPenalty +
        repeatWithinPathPenalty;
      const signature = `${edge.to}:${current.traversal
        .slice(-3)
        .map((item) => item.edge.id)
        .join("|")}:${edge.edge.id}`;
      if (
        nextCost + 0.000001 >=
        (bestSignatureCosts.get(signature) ?? Number.POSITIVE_INFINITY)
      )
        continue;
      bestSignatureCosts.set(signature, nextCost);
      pending.push({
        nodeId: edge.to,
        cost: nextCost,
        traversal: [...current.traversal, edge],
        visitedNodeIds: new Set([
          ...Array.from(current.visitedNodeIds),
          edge.to,
        ]),
      });
    }
    if (pending.length > options.maxVisitedStates)
      pending.splice(options.maxVisitedStates);
  }
  const unique = new Map<string, DirectedMultiCycleEdgeV3[]>();
  for (const result of results.sort((a, b) => a.cost - b.cost)) {
    const key = result.traversal.map((edge) => edge.edge.id).join("|");
    if (!unique.has(key)) unique.set(key, result.traversal);
  }
  return Array.from(unique.values()).slice(0, options.k);
}

function shortestClosure(
  fromNodeId: string,
  startNodeId: string,
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>,
  usedEdgeIds: Set<string>,
  usedPairKeys: Set<string>,
  targetComponents: Set<TerrainComponentKindV3>,
  repeatableConnectorPairKeys: Set<string> = new Set(),
): DirectedMultiCycleEdgeV3[] | null {
  const targetSafePairKeys = new Set(
    Array.from(usedPairKeys).filter(
      (pairKey) => !repeatableConnectorPairKeys.has(pairKey),
    ),
  );
  return (
    shortestPathToAnyNode(
      fromNodeId,
      [startNodeId],
      adjacency,
      usedEdgeIds,
      usedPairKeys,
      { preferNatural: true },
    ) ??
    shortestPathToAnyNode(
      fromNodeId,
      [startNodeId],
      adjacency,
      new Set(),
      usedPairKeys,
      { preferNatural: true },
    ) ??
    shortestPathToAnyNode(
      fromNodeId,
      [startNodeId],
      adjacency,
      new Set(),
      targetSafePairKeys,
      { preferNatural: true },
    ) ??
    (targetComponents.size > 0 ? null : [])
  );
}

function closureAlternativesToStart(
  fromNodeId: string,
  startNodeId: string,
  adjacency: Map<string, DirectedMultiCycleEdgeV3[]>,
  usedEdgeIds: Set<string>,
  usedPairKeys: Set<string>,
  targetComponents: Set<TerrainComponentKindV3>,
  repeatableConnectorPairKeys: Set<string> = new Set(),
): DirectedMultiCycleEdgeV3[][] {
  const targetSafePairKeys = new Set(
    Array.from(usedPairKeys).filter(
      (pairKey) => !repeatableConnectorPairKeys.has(pairKey),
    ),
  );
  const strict = kShortestPathsToAnyNode(
    fromNodeId,
    [startNodeId],
    adjacency,
    usedEdgeIds,
    usedPairKeys,
    { preferNatural: true, k: 4, maxVisitedStates: 1600 },
  );
  const noEdgeRepeat = kShortestPathsToAnyNode(
    fromNodeId,
    [startNodeId],
    adjacency,
    new Set(),
    usedPairKeys,
    { preferNatural: true, k: 4, maxVisitedStates: 1600 },
  );
  const connectorFallback = kShortestPathsToAnyNode(
    fromNodeId,
    [startNodeId],
    adjacency,
    new Set(),
    targetSafePairKeys,
    { preferNatural: true, k: 4, maxVisitedStates: 1600 },
  );
  const legacy = shortestClosure(
    fromNodeId,
    startNodeId,
    adjacency,
    usedEdgeIds,
    usedPairKeys,
    targetComponents,
    repeatableConnectorPairKeys,
  );
  return uniqueConnectorAlternatives([
    ...(legacy ? [legacy] : []),
    ...strict,
    ...noEdgeRepeat,
    ...connectorFallback,
  ])
    .sort(
      (a, b) =>
        closureLocalScore(a, targetComponents) -
        closureLocalScore(b, targetComponents),
    )
    .slice(0, 8);
}

function closureLocalScore(
  edges: DirectedMultiCycleEdgeV3[],
  targetComponents: Set<TerrainComponentKindV3>,
): number {
  const repeat = repeatedKm(edges, new Set(), new Set(), targetComponents);
  return (
    sumPaved(edges) * 120 +
    repeat.targetRepeatKm * 500 +
    sumDirectedLengths(edges)
  );
}

function repeatedSegmentDiagnostics(
  access: DirectedMultiCycleEdgeV3[],
  chain: DirectedMultiCycleEdgeV3[],
  closure: DirectedMultiCycleEdgeV3[],
  connectors: DirectedMultiCycleEdgeV3[],
  spineEdgeIds: string[],
  targetComponents: Set<TerrainComponentKindV3>,
): MultiCycleRepeatedSegmentDiagnosticsV3[] {
  const spineIds = new Set(spineEdgeIds);
  const connectorIds = new Set(connectors.map((edge) => edge.edge.id));
  const seenEdgeIds = new Set<string>();
  const seenPairKeys = new Set<string>();
  const bySegment = new Map<
    MultiCycleCandidateSegmentV3,
    {
      pairKeys: Set<string>;
      edgeIds: Set<string>;
      repeatKm: number;
      targetRepeatKm: number;
    }
  >();
  const touch = (segment: MultiCycleCandidateSegmentV3) => {
    const existing = bySegment.get(segment);
    if (existing) return existing;
    const created = {
      pairKeys: new Set<string>(),
      edgeIds: new Set<string>(),
      repeatKm: 0,
      targetRepeatKm: 0,
    };
    bySegment.set(segment, created);
    return created;
  };
  const visit = (
    edge: DirectedMultiCycleEdgeV3,
    segment: MultiCycleCandidateSegmentV3,
  ) => {
    const pairKey = edgePairKey(edge);
    const repeated = seenEdgeIds.has(edge.edge.id) || seenPairKeys.has(pairKey);
    if (repeated) {
      const bucket = touch(segment);
      bucket.pairKeys.add(pairKey);
      bucket.edgeIds.add(edge.edge.id);
      const lengthKm = Math.max(0, edge.edge.lengthKm);
      bucket.repeatKm += lengthKm;
      if (targetComponents.has(edge.kind)) bucket.targetRepeatKm += lengthKm;
    }
    seenEdgeIds.add(edge.edge.id);
    seenPairKeys.add(pairKey);
  };
  for (const edge of access) visit(edge, "access");
  for (const edge of chain) {
    const segment: MultiCycleCandidateSegmentV3 = spineIds.has(edge.edge.id)
      ? "spine"
      : connectorIds.has(edge.edge.id)
        ? "recovery"
        : "cycle";
    visit(edge, segment);
  }
  for (const edge of closure) visit(edge, "closure");
  return Array.from(bySegment.entries())
    .map(([segment, value]) => ({
      segment,
      repeatedPairKeys: Array.from(value.pairKeys).slice(0, 24),
      repeatedEdgeIds: Array.from(value.edgeIds).slice(0, 24),
      targetRepeatKm: round(value.targetRepeatKm),
      repeatKm: round(value.repeatKm),
    }))
    .filter((entry) => entry.repeatKm > 0);
}

function metricsFromParts(
  access: DirectedMultiCycleEdgeV3[],
  chain: DirectedMultiCycleEdgeV3[],
  closure: DirectedMultiCycleEdgeV3[],
  connectors: DirectedMultiCycleEdgeV3[],
  targetComponents: Set<TerrainComponentKindV3>,
): MultiCycleDwellMetricsV3 {
  const all = [...access, ...chain, ...closure];
  const repeat = repeatedKm(chain, new Set(), new Set(), targetComponents);
  const repeatableConnectorPairs = new Set(
    connectors
      .filter((edge) => !targetComponents.has(edge.kind))
      .map(edgePairKey),
  );
  const closureConnectorRepeatKm = closure
    .filter((edge) => repeatableConnectorPairs.has(edgePairKey(edge)))
    .reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
  return {
    distanceKm: round(sumDirectedLengths(all)),
    accessKm: round(sumDirectedLengths(access)),
    chainKm: round(sumDirectedLengths(chain)),
    chainNaturalKm: round(naturalTargetKm(chain, targetComponents)),
    connectorNaturalKm: round(naturalTargetKm(connectors, targetComponents)),
    connectorPavedKm: round(sumPaved(connectors)),
    closureKm: round(sumDirectedLengths(closure)),
    closurePavedKm: round(sumPaved(closure)),
    pavedKm: round(sumPaved(all)),
    chainRepeatKm: round(repeat.repeatKm),
    chainTargetRepeatKm: round(repeat.targetRepeatKm),
    chainConnectorRepeatKm: round(closureConnectorRepeatKm),
  };
}

function finalPavedEquivalentDiagnostics(
  edges: DirectedMultiCycleEdgeV3[],
): MultiCycleFinalPavedEquivalentDiagnosticsV3 {
  const totalKm = sumDirectedLengths(edges);
  let explicitPavedKm = 0;
  let mixedUnknownKm = 0;
  let roadLikeUnknownKm = 0;
  let pathTrackUnknownKm = 0;
  let trailCandidateKm = 0;
  let unverifiedTrailCandidateKm = 0;
  let candidateNaturalKm = 0;
  let strictNaturalKm = 0;
  let finalPavedEquivalentKm = 0;
  let estimatedLongestStrictTrailSegmentKm = 0;
  let currentStrictTrailSegmentKm = 0;

  for (const edge of edges) {
    const lengthKm = Math.max(0, edge.edge.lengthKm);
    const semantics = classifyEdgeSemanticsV3(edge.edge);
    if (semantics.routeSurface === "paved") {
      explicitPavedKm += lengthKm;
    } else if (semantics.routeSurface === "mixed") {
      mixedUnknownKm += lengthKm;
    } else {
      strictNaturalKm += lengthKm;
    }
    if (semantics.surfaceEvidence === "road_like_unknown")
      roadLikeUnknownKm += lengthKm;
    if (semantics.surfaceEvidence === "path_track_unknown")
      pathTrackUnknownKm += lengthKm;
    if (semantics.isTrailCandidate) trailCandidateKm += lengthKm;
    if (semantics.isUnverifiedTrailCandidate)
      unverifiedTrailCandidateKm += lengthKm;
    candidateNaturalKm += lengthKm * semantics.candidateNaturalWeight;

    finalPavedEquivalentKm += lengthKm * semantics.pavedEquivalentWeight;

    if (semantics.isStrictTrailLike) {
      currentStrictTrailSegmentKm += lengthKm;
      estimatedLongestStrictTrailSegmentKm = Math.max(
        estimatedLongestStrictTrailSegmentKm,
        currentStrictTrailSegmentKm,
      );
    } else {
      currentStrictTrailSegmentKm = 0;
    }
  }

  const naturalWayEquivalentKm = totalKm - finalPavedEquivalentKm;
  return {
    explicitPavedKm: round(explicitPavedKm),
    explicitPavedRatio: totalKm > 0 ? round(explicitPavedKm / totalKm) : 0,
    mixedUnknownKm: round(mixedUnknownKm),
    roadLikeUnknownKm: round(roadLikeUnknownKm),
    pathTrackUnknownKm: round(pathTrackUnknownKm),
    trailCandidateKm: round(trailCandidateKm),
    unverifiedTrailCandidateKm: round(unverifiedTrailCandidateKm),
    candidateNaturalKm: round(candidateNaturalKm),
    finalPavedEquivalentKm: round(finalPavedEquivalentKm),
    finalPavedRatioEstimate:
      totalKm > 0 ? round(finalPavedEquivalentKm / totalKm) : 0,
    strictNaturalKm: round(strictNaturalKm),
    naturalWayEquivalentKm: round(naturalWayEquivalentKm),
    naturalWayEquivalentRatio:
      totalKm > 0 ? round(naturalWayEquivalentKm / totalKm) : 0,
    estimatedLongestStrictTrailSegmentKm: round(
      estimatedLongestStrictTrailSegmentKm,
    ),
  };
}

function repeatedKm(
  edges: DirectedMultiCycleEdgeV3[],
  preUsedEdgeIds: Set<string>,
  preUsedPairKeys: Set<string>,
  targetComponents: Set<TerrainComponentKindV3>,
): { repeatKm: number; targetRepeatKm: number } {
  const seenEdgeIds = new Set(preUsedEdgeIds);
  const seenPairKeys = new Set(preUsedPairKeys);
  let repeatKm = 0;
  let targetRepeatKm = 0;
  for (const edge of edges) {
    const pairKey = edgePairKey(edge);
    const repeated = seenEdgeIds.has(edge.edge.id) || seenPairKeys.has(pairKey);
    if (repeated) {
      repeatKm += Math.max(0, edge.edge.lengthKm);
      if (targetComponents.has(edge.kind))
        targetRepeatKm += Math.max(0, edge.edge.lengthKm);
    }
    seenEdgeIds.add(edge.edge.id);
    seenPairKeys.add(pairKey);
  }
  return { repeatKm, targetRepeatKm };
}

function naturalTargetKm(
  edges: DirectedMultiCycleEdgeV3[],
  targetComponents: Set<TerrainComponentKindV3>,
): number {
  return edges
    .filter(
      (edge) =>
        targetComponents.has(edge.kind) &&
        classifyEdgeSemanticsV3(edge.edge).routeSurface !== "paved",
    )
    .reduce(
      (sum, edge) =>
        sum +
        Math.max(0, edge.edge.lengthKm) *
          classifyEdgeSemanticsV3(edge.edge).candidateNaturalWeight,
      0,
    );
}

function jaccardOverlap(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let intersection = 0;
  for (const value of Array.from(b)) if (a.has(value)) intersection += 1;
  return intersection / Math.min(a.size, b.size);
}

function nodesFromDirectedEdges(
  startNodeId: string,
  edges: DirectedMultiCycleEdgeV3[],
): string[] {
  const nodes = [startNodeId];
  for (const edge of edges) nodes.push(edge.to);
  return nodes;
}

function edgePairKey(edge: DirectedMultiCycleEdgeV3): string {
  return [edge.from, edge.to].sort().join("::");
}

function sumDirectedLengths(edges: DirectedMultiCycleEdgeV3[]): number {
  return edges.reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
}

function sumPaved(edges: DirectedMultiCycleEdgeV3[]): number {
  return edges
    .filter(
      (edge) =>
        classifyEdgeSemanticsV3(edge.edge).surfaceEvidence === "explicit_paved",
    )
    .reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
}

function routeSurface(edge: EnrichedEdge): RouteSurfaceV3 {
  return classifyEdgeSemanticsV3(edge).routeSurface;
}

function componentKind(edge: EnrichedEdge): TerrainComponentKindV3 {
  return classifyEdgeSemanticsV3(edge).componentKind;
}

function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}
