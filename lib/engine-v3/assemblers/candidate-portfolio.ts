import type {
  CandidateLaneV3,
  CandidatePortfolioV3,
  RouteCandidateV3,
} from '../contracts';

const NON_SELECTABLE_LANES: ReadonlySet<CandidateLaneV3> = new Set<CandidateLaneV3>([
  'diagnostic_only',
  'negative_evidence',
  'progress_no_closure',
]);

function hasGpsGeometry(candidate: RouteCandidateV3): boolean {
  return candidate.geometry.type === 'LineString' && candidate.geometry.coordinates.length >= 2;
}

function hasHardGateFailure(candidate: RouteCandidateV3): boolean {
  return candidate.gates.some((gate) => gate.status === 'fail' && gate.severity === 'hard');
}

function normalizeCandidate(candidate: RouteCandidateV3): RouteCandidateV3 {
  const structuralRejectReason = getStructuralRejectReason(candidate);

  if (!structuralRejectReason) {
    return { ...candidate, selected: false };
  }

  return {
    ...candidate,
    lane: NON_SELECTABLE_LANES.has(candidate.lane) ? candidate.lane : 'diagnostic_only',
    lifecycle: candidate.lifecycle === 'selected' ? 'rejected' : candidate.lifecycle,
    selected: false,
    rejectedReason: candidate.rejectedReason ?? structuralRejectReason,
  };
}

function getStructuralRejectReason(candidate: RouteCandidateV3): string | null {
  if (NON_SELECTABLE_LANES.has(candidate.lane)) {
    return 'non_selectable_lane';
  }

  if ((candidate.lane === 'complete_valid' || candidate.lane === 'complete_adjustable') && !candidate.returned) {
    return 'route_not_returned';
  }

  if ((candidate.lane === 'complete_valid' || candidate.lane === 'complete_adjustable') && !hasGpsGeometry(candidate)) {
    return 'missing_gps_geometry';
  }

  if (candidate.lane === 'complete_valid' && hasHardGateFailure(candidate)) {
    return 'hard_gate_failure';
  }

  return null;
}

function emptyLaneCounts(): CandidatePortfolioV3['counts'] {
  return {
    complete_valid: 0,
    complete_adjustable: 0,
    progress_no_closure: 0,
    dwell_only: 0,
    connector_heavy: 0,
    diagnostic_only: 0,
    negative_evidence: 0,
    discovered: 0,
    closed: 0,
    inEnvelope: 0,
    rejected: 0,
  };
}

function countCandidates(candidates: RouteCandidateV3[]): CandidatePortfolioV3['counts'] {
  const counts = emptyLaneCounts();

  for (const candidate of candidates) {
    counts[candidate.lane] += 1;
    if (candidate.lifecycle === 'discovered') counts.discovered += 1;
    if (candidate.lifecycle === 'closed') counts.closed += 1;
    if (candidate.lane === 'complete_valid' || candidate.lane === 'complete_adjustable') counts.inEnvelope += 1;
    if (candidate.rejectedReason || getStructuralRejectReason(candidate)) counts.rejected += 1;
  }

  return counts;
}

export function normalizeCandidatePortfolioV3(portfolio: CandidatePortfolioV3): CandidatePortfolioV3 {
  const candidates = portfolio.candidates.map(normalizeCandidate);
  const selectedCandidateId = candidates.some(
    (candidate) => candidate.id === portfolio.selectedCandidateId && isSelectableCandidateV3(candidate),
  )
    ? portfolio.selectedCandidateId
    : null;
  const topRejected = [...portfolio.topRejected, ...candidates.filter((candidate) => candidate.rejectedReason)]
    .sort((left, right) => right.selectionScore - left.selectionScore)
    .slice(0, 5);

  return {
    ...portfolio,
    candidates,
    selectedCandidateId,
    topRejected,
    counts: countCandidates(candidates),
    diagnostics: {
      ...portfolio.diagnostics,
      blocker: portfolio.diagnostics.blocker ?? (selectedCandidateId ? null : firstBlocker(candidates)),
    },
  };
}

export function selectCandidateFromPortfolioV3(portfolio: CandidatePortfolioV3): RouteCandidateV3 | null {
  const normalized = normalizeCandidatePortfolioV3(portfolio);
  const selected = normalized.candidates
    .filter(isSelectableCandidateV3)
    .sort((left, right) => right.selectionScore - left.selectionScore)[0];

  return selected ?? null;
}

export function isSelectableCandidateV3(candidate: RouteCandidateV3): boolean {
  return getStructuralRejectReason(candidate) === null;
}

export function createEmptyCandidatePortfolioV3(missionId: string, blocker: string | null): CandidatePortfolioV3 {
  return {
    missionId,
    candidates: [],
    selectedCandidateId: null,
    topRejected: [],
    counts: emptyLaneCounts(),
    diagnostics: {
      firstDropStage: blocker ? 'dispatch' : null,
      blocker,
      phaseBlockers: blocker ? { dispatch: [blocker] } : {},
    },
  };
}

function firstBlocker(candidates: RouteCandidateV3[]): string | null {
  return candidates.find((candidate) => candidate.rejectedReason)?.rejectedReason ?? null;
}
