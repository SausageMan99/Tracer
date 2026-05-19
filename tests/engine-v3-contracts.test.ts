import { describe, expect, it } from 'vitest';
import {
  normalizeCandidatePortfolioV3,
  selectCandidateFromPortfolioV3,
} from '@/lib/engine-v3/assemblers/candidate-portfolio';
import { buildOutcomeEvidenceV3 } from '@/lib/engine-v3/outcome-decider';
import * as contracts from '@/lib/engine-v3/contracts';
import type {
  AssemblerResultV3,
  CandidateLaneV3,
  CandidatePortfolioV3,
  MissionContractV3,
  OutcomeEvidenceV3,
  RouteCandidateV3,
} from '@/lib/engine-v3/contracts';

function makeCandidate(overrides: Partial<RouteCandidateV3> = {}): RouteCandidateV3 {
  return {
    id: overrides.id ?? 'candidate-1',
    source: overrides.source ?? 'strategy_assembler',
    lane: overrides.lane ?? 'complete_valid',
    lifecycle: overrides.lifecycle ?? 'gated',
    edgeIds: overrides.edgeIds ?? ['edge-1'],
    nodeIds: overrides.nodeIds ?? ['node-1', 'node-2'],
    geometry: overrides.geometry ?? { type: 'LineString', coordinates: [[0, 0], [0.01, 0.01]] },
    targetComponentIds: overrides.targetComponentIds ?? ['target-1'],
    targetComponentKinds: overrides.targetComponentKinds ?? ['forest'],
    returned: overrides.returned ?? true,
    metrics: overrides.metrics ?? {
      targetDistanceKm: 8,
      distanceProducedKm: 8,
      trailRatio: 0.7,
      naturalWayRatio: 0.8,
      pavedRatio: 0.1,
      pavedKm: 0.8,
      nonPavedKm: 7.2,
      naturalDwellKm: 6.2,
      repeatEdgeKm: 0,
      targetRepeatKm: 0,
      connectorRepeatKm: 0,
      visitedComponents: ['forest'],
      repeatRatio: 0,
      overlapRatio: 0,
      busyRoadRatio: 0,
      loopClosureKm: 0.3,
      longestTrailSegmentKm: 5.4,
    },
    gates: overrides.gates ?? [{ id: 'distance', status: 'pass', severity: 'hard' }],
    selectionScore: overrides.selectionScore ?? 10,
    selected: overrides.selected ?? false,
    selectedReason: overrides.selectedReason,
    rejectedReason: overrides.rejectedReason,
  };
}

function makePortfolio(candidates: RouteCandidateV3[]): CandidatePortfolioV3 {
  return {
    missionId: 'mission-test',
    candidates,
    selectedCandidateId: null,
    topRejected: [],
    counts: {
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
    },
    diagnostics: { firstDropStage: null, blocker: null, phaseBlockers: {} },
  };
}

describe('V3 mission-driven contracts', () => {
  it('exposes a contracts module boundary', () => {
    expect(contracts).toBeDefined();
  });

  it('keeps assembler result separate from product outcome', () => {
    const result = {} as AssemblerResultV3;

    expect('productOutcome' in result).toBe(false);
    expect('generated' in result).toBe(false);
    expect('adjusted' in result).toBe(false);
    expect('refused' in result).toBe(false);
  });

  it('represents trail surface metrics separately in outcome evidence', () => {
    const evidence = {
      productOutcome: 'generated',
      hardGateFailures: [],
      compromises: [],
      exportPolicy: { geoJsonAvailable: true, gpxAvailable: true, emptyOnRefusal: false },
      surfaceEvidence: {
        trailRatio: 0.42,
        naturalWayRatio: 0.67,
        pavedRatio: 0.24,
        pavedKm: 2.4,
        naturalDwellKm: 6.7,
      },
    } satisfies Partial<OutcomeEvidenceV3>;

    expect(evidence.surfaceEvidence?.trailRatio).not.toBe(evidence.surfaceEvidence?.naturalWayRatio);
    expect(evidence.surfaceEvidence?.pavedRatio).toBeGreaterThan(0);
  });

  it('forbids selecting diagnostic-only candidates', () => {
    const portfolio = {
      selectedCandidateId: null,
      candidates: [
        {
          id: 'diag-1',
          source: 'diagnostic',
          lane: 'diagnostic_only',
          lifecycle: 'rejected',
          edgeIds: [],
          nodeIds: [],
          geometry: { type: 'LineString', coordinates: [] },
          targetComponentIds: [],
          targetComponentKinds: [],
          returned: false,
          metrics: {
            targetDistanceKm: 8,
            distanceProducedKm: 0,
            trailRatio: 0,
            naturalWayRatio: 0,
            pavedRatio: 0,
            pavedKm: 0,
            nonPavedKm: 0,
            naturalDwellKm: 0,
            repeatEdgeKm: 0,
            targetRepeatKm: 0,
            connectorRepeatKm: 0,
            visitedComponents: [],
            repeatRatio: 0,
            overlapRatio: 0,
            busyRoadRatio: 0,
            loopClosureKm: 0,
            longestTrailSegmentKm: 0,
          },
          gates: [],
          selectionScore: Number.NEGATIVE_INFINITY,
          selected: false,
        },
      ],
    } satisfies Partial<CandidatePortfolioV3>;

    expect(portfolio.candidates[0]?.selected).toBe(false);
    expect(portfolio.selectedCandidateId).toBeNull();
  });

  it('mission contract exposes phase budgets instead of hidden strategy flags', () => {
    const mission = {
      version: 'v3-mission-v1',
      phases: ['access', 'target_dwell', 'distance_recovery', 'closure', 'final_gate'],
      budgets: {
        maxPavedKm: 2.4,
        maxPavedRatio: 0.32,
        maxBusyRoadRatio: 0.05,
        maxRepeatKm: 2.1,
        maxTargetRepeatKm: 0.1,
        maxConnectorRepeatKm: 2,
        maxOverlapRatio: 0.15,
        maxAccessPavedKm: 1,
        maxClosurePavedKm: 1,
        maxTargetPavedKm: 0.2,
      },
      refusalPolicy: {
        refuseIfNoTargetEntry: true,
        refuseIfUnderMinDistance: true,
        refuseIfDominantPavedTrail: true,
        refuseIfMissingGpsGeometry: true,
      },
    } satisfies Partial<MissionContractV3>;

    expect(mission.phases).toContain('target_dwell');
    expect(mission.budgets.maxPavedRatio).toBeLessThan(0.5);
    expect(mission.refusalPolicy.refuseIfDominantPavedTrail).toBe(true);
  });
});

describe('OutcomeEvidenceV3 mapping', () => {
  it('downgrades generated attempts with hard gate failures to honest refusal evidence', () => {
    const candidate = makeCandidate({
      gates: [{ id: 'distance', status: 'fail', severity: 'hard', reason: 'under_min_distance' }],
    });

    const evidence = buildOutcomeEvidenceV3({
      missionId: 'mission-test',
      selectedCandidate: candidate,
      outcome: { type: 'generated', summary: 'should not survive hard gates' },
      hardGateFailures: ['under_min_distance'],
    });

    expect(evidence.productOutcome).toBe('refused');
    expect(evidence.benchmarkEvidence.productVerdict).toBe('honest_refusal');
    expect(evidence.primaryReason).toBe('under_min_distance');
    expect(evidence.hardGateFailures).toEqual(['under_min_distance']);
  });

  it('refuses adjusted outcomes that do not expose a user-facing compromise', () => {
    const evidence = buildOutcomeEvidenceV3({
      missionId: 'mission-test',
      selectedCandidate: makeCandidate(),
      outcome: { type: 'adjusted', summary: 'adjusted without actual compromise', compromises: [] },
    });

    expect(evidence.productOutcome).toBe('refused');
    expect(evidence.primaryReason).toBe('adjusted outcome missing user-facing compromise');
    expect(evidence.benchmarkEvidence.productVerdict).toBe('honest_refusal');
  });

  it('marks exports unavailable and selected candidate empty on refused outcomes', () => {
    const evidence = buildOutcomeEvidenceV3({
      missionId: 'mission-test',
      selectedCandidate: makeCandidate({ id: 'candidate-that-must-not-export' }),
      outcome: { type: 'refused', reason: 'no clean candidate', details: ['all candidates failed final gate'] },
    });

    expect(evidence.productOutcome).toBe('refused');
    expect(evidence.selectedCandidateId).toBeNull();
    expect(evidence.exportPolicy).toEqual({
      geoJsonAvailable: false,
      gpxAvailable: false,
      emptyOnRefusal: true,
    });
  });

  it('preserves separate trail, natural-way, and paved ratios when route evidence exists', () => {
    const evidence = buildOutcomeEvidenceV3({
      missionId: 'mission-test',
      selectedCandidate: makeCandidate({
        metrics: {
          ...makeCandidate().metrics,
          trailRatio: 0.31,
          naturalWayRatio: 0.64,
          pavedRatio: 0.22,
          pavedKm: 1.76,
          naturalDwellKm: 5.12,
        },
      }),
      outcome: { type: 'generated', summary: 'valid route' },
    });

    expect(evidence.surfaceEvidence).toEqual({
      trailRatio: 0.31,
      naturalWayRatio: 0.64,
      pavedRatio: 0.22,
      pavedKm: 1.76,
      naturalDwellKm: 5.12,
    });
    expect(evidence.surfaceEvidence?.trailRatio).not.toBe(evidence.surfaceEvidence?.naturalWayRatio);
    expect(evidence.surfaceEvidence?.naturalWayRatio).not.toBe(evidence.surfaceEvidence?.pavedRatio);
  });
});

describe('V3 candidate portfolio guards', () => {
  it('normalizeCandidatePortfolioV3 force selected=false on diagnostic-only candidates', () => {
    const portfolio = makePortfolio([
      makeCandidate({ id: 'diag-1', source: 'diagnostic', lane: 'diagnostic_only', selected: true, selectionScore: 99 }),
    ]);

    const normalized = normalizeCandidatePortfolioV3(portfolio);

    expect(normalized.candidates[0]?.selected).toBe(false);
    expect(normalized.candidates[0]?.rejectedReason).toBe('non_selectable_lane');
    expect(normalized.selectedCandidateId).toBeNull();
  });

  it('selectCandidateFromPortfolioV3 ignores progress_no_closure', () => {
    const progressLane: CandidateLaneV3 = 'progress_no_closure';
    const portfolio = makePortfolio([
      makeCandidate({ id: 'progress-1', lane: progressLane, returned: false, selectionScore: 100 }),
      makeCandidate({ id: 'valid-1', lane: 'complete_valid', selectionScore: 10 }),
    ]);

    const selected = selectCandidateFromPortfolioV3(portfolio);

    expect(selected?.id).toBe('valid-1');
  });

  it('complete_valid requires returned route, GPS geometry, and no hard gate failures', () => {
    const portfolio = makePortfolio([
      makeCandidate({ id: 'not-returned', returned: false, selectionScore: 100 }),
      makeCandidate({ id: 'no-geometry', geometry: { type: 'LineString', coordinates: [] }, selectionScore: 90 }),
      makeCandidate({
        id: 'hard-failed',
        gates: [{ id: 'distance', status: 'fail', severity: 'hard', reason: 'under_min_distance' }],
        selectionScore: 80,
      }),
      makeCandidate({ id: 'valid-1', selectionScore: 1 }),
    ]);

    const normalized = normalizeCandidatePortfolioV3(portfolio);
    const selected = selectCandidateFromPortfolioV3(normalized);

    expect(selected?.id).toBe('valid-1');
    expect(normalized.candidates.find((candidate) => candidate.id === 'not-returned')?.lane).not.toBe('complete_valid');
    expect(normalized.candidates.find((candidate) => candidate.id === 'no-geometry')?.lane).not.toBe('complete_valid');
    expect(normalized.candidates.find((candidate) => candidate.id === 'hard-failed')?.selected).toBe(false);
  });
});
