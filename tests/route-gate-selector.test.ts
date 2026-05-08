import { describe, expect, it } from "vitest";
import {
  buildRejectedCandidatesDiagnostics,
  evaluateRouteHardGates,
  orderCandidatesByHardGates,
  isBetaStableCandidate,
} from "@/lib/engine/route-gate-selector";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import type { RouteQualityMetrics } from "@/lib/engine/route-quality";
import type { RouteIntent } from "@/lib/engine/terrain-planner";
import type { RouteCandidate } from "@/lib/types";

const trailProfile = PROFILES_BY_ID.get("running_trail")!;
const recoveryProfile = PROFILES_BY_ID.get("running_recuperation")!;

function quality(overrides: Partial<RouteQualityMetrics> = {}): RouteQualityMetrics {
  return {
    distanceErrorPct: 0,
    elevationErrorPct: 0,
    loopGapKm: 0,
    busyRoadRatio: 0,
    trailRatio: 0.7,
    naturalWayRatio: 0.7,
    uTurnRatio: 0,
    restrictedAccessRatio: 0,
    onewayViolationRatio: 0,
    repeatEdgeRatio: 0,
    intersectionDensityPerKm: 4,
    productionScore: 0.82,
    warnings: [],
    pavedRatio: 0.3,
    geometry: {
      directStartEndKm: 0,
      maxDistanceFromStartKm: 1,
      meanDistanceFromStartKm: 0.5,
      boundingBoxAreaKm2: 0.5,
      loopAreaKm2: 0.2,
      loopCompactness: 0.12,
      geometryOverlapRatio: 0.04,
      outAndBackSimilarityRatio: 0,
      selfIntersectionCount: 0,
      sharpTurnCount: 0,
      sharpTurnDensityPerKm: 0,
      headingReversalRatio: 0,
      startStemKm: 0,
      endStemKm: 0,
    },
    ...overrides,
  };
}

function candidate(id: number, overrides: Omit<Partial<RouteCandidate>, "quality"> & { quality?: Partial<RouteQualityMetrics> } = {}): RouteCandidate {
  return {
    points: [],
    distanceKm: 8,
    durationSeconds: 0,
    ascendM: 100,
    descendM: 0,
    surfaceScore: 0.8,
    loopScore: 1,
    totalScore: id,
    geometry: { type: "LineString", coordinates: [] },
    ...overrides,
    quality: quality(overrides.quality),
  };
}

function intent(overrides: Partial<RouteIntent> = {}): RouteIntent {
  return {
    type: "transition_to_woods",
    strategy: "transition_to_woods",
    targetDistanceKm: 8,
    targetElevationM: 100,
    targetComponents: [],
    maxPavedRatio: 0.45,
    maxBusyRoadRatio: 0.08,
    maxRepeatEdgeRatio: 0.04,
    maxGeometryOverlapRatio: 0.12,
    cleanReturnMode: "prefer",
    timeBudgetMs: 4500,
    beamBudget: { beamWidth: 20, maxIterations: 300, shortlistSize: 12 },
    relaxationOrder: [],
    userWarningsIfRelaxed: [],
    terrainComponents: [],
    ...overrides,
  };
}

describe("route hard-gate selector", () => {
  it("prefers a u-turn-safe trail candidate over a higher-score candidate that breaches the u-turn gate", () => {
    const unsafe = candidate(100, { quality: { uTurnRatio: 0.02, pavedRatio: 0.42 } });
    const safe = candidate(50, { quality: { uTurnRatio: 0, pavedRatio: 0.42 } });

    const ordered = orderCandidatesByHardGates(
      [unsafe, safe],
      { targetDistanceKm: 8, targetElevationM: 100, profile: trailProfile, routeIntent: intent() },
      (route) => route.totalScore
    );

    expect(ordered[0]).toBe(safe);
    expect(ordered).toHaveLength(2);
  });

  it("prefers an in-distance park candidate over a prettier candidate just below the distance floor", () => {
    const shortPretty = candidate(100, {
      distanceKm: 5.23,
      ascendM: 50,
      quality: { productionScore: 0.72, pavedRatio: 0.63, trailRatio: 0.98, naturalWayRatio: 0.98 },
    });
    const inDistance = candidate(60, {
      distanceKm: 5.55,
      ascendM: 50,
      quality: { productionScore: 0.71, pavedRatio: 0.64, trailRatio: 0.82, naturalWayRatio: 0.82 },
    });

    const ordered = orderCandidatesByHardGates(
      [shortPretty, inDistance],
      {
        targetDistanceKm: 6,
        targetElevationM: 50,
        profile: recoveryProfile,
        routeIntent: intent({ type: "park_loop", strategy: "park_loop", targetDistanceKm: 6, targetElevationM: 50, maxPavedRatio: 0.65, maxRepeatEdgeRatio: 0.12, maxGeometryOverlapRatio: 0.18 }),
      },
      (route) => route.totalScore
    );

    expect(ordered[0]).toBe(inDistance);
  });

  it("keeps soft ranking inside the strict viable bucket", () => {
    const lower = candidate(10);
    const higher = candidate(20);

    const ordered = orderCandidatesByHardGates(
      [lower, higher],
      { targetDistanceKm: 8, targetElevationM: 100, profile: trailProfile, routeIntent: intent() },
      (route) => route.totalScore
    );

    expect(ordered[0]).toBe(higher);
  });

  it("does not reject 12 km medium-potential trail candidates when they satisfy distance and pavement gates", () => {
    const shortHighPotential = candidate(100, {
      distanceKm: 10.68,
      ascendM: 184,
      quality: { trailPotential: "high", pavedRatio: 0.398, productionScore: 0.79 },
    });
    const inDistanceMediumPotential = candidate(60, {
      distanceKm: 11.13,
      ascendM: 202,
      quality: { trailPotential: "medium", pavedRatio: 0.377, productionScore: 0.78 },
    });

    const ordered = orderCandidatesByHardGates(
      [shortHighPotential, inDistanceMediumPotential],
      { targetDistanceKm: 12, targetElevationM: 120, profile: trailProfile, routeIntent: intent({ targetDistanceKm: 12, targetElevationM: 120, maxPavedRatio: 0.42 }) },
      (route) => route.totalScore
    );

    expect(ordered[0]).toBe(inDistanceMediumPotential);
  });

  it("prefers the smallest relaxed paved overflow before soft score", () => {
    const overPavedPretty = candidate(100, {
      distanceKm: 6,
      ascendM: 50,
      quality: { pavedRatio: 0.67, productionScore: 0.82, trailRatio: 0.98, naturalWayRatio: 0.98 },
    });
    const nearCap = candidate(60, {
      distanceKm: 6,
      ascendM: 50,
      quality: { pavedRatio: 0.655, productionScore: 0.72, trailRatio: 0.82, naturalWayRatio: 0.82 },
    });

    const ordered = orderCandidatesByHardGates(
      [overPavedPretty, nearCap],
      {
        targetDistanceKm: 6,
        targetElevationM: 50,
        profile: recoveryProfile,
        routeIntent: intent({ type: "park_loop", strategy: "park_loop", targetDistanceKm: 6, targetElevationM: 50, maxPavedRatio: 0.65, maxRepeatEdgeRatio: 0.12, maxGeometryOverlapRatio: 0.18 }),
      },
      (route) => route.totalScore
    );

    expect(ordered[0]).toBe(nearCap);
  });

  it("accepts strict candidates close to a beta margin while keeping low-margin diagnostics", () => {
    const overPaved = candidate(80, {
      distanceKm: 6,
      ascendM: 50,
      quality: { pavedRatio: 0.655, repeatEdgeRatio: 0.005, uTurnRatio: 0.001, productionScore: 0.82 },
    });
    const insideButBorderline = candidate(80, {
      distanceKm: 6,
      ascendM: 50,
      quality: { pavedRatio: 0.646, repeatEdgeRatio: 0.005, uTurnRatio: 0.001, productionScore: 0.82 },
    });
    const healthy = candidate(80, {
      distanceKm: 6,
      ascendM: 50,
      quality: { pavedRatio: 0.54, repeatEdgeRatio: 0.005, uTurnRatio: 0.001, productionScore: 0.82 },
    });
    const context = {
      targetDistanceKm: 6,
      targetElevationM: 50,
      profile: recoveryProfile,
      routeIntent: intent({ type: "park_loop", strategy: "park_loop", targetDistanceKm: 6, targetElevationM: 50, maxPavedRatio: 0.65, maxRepeatEdgeRatio: 0.12, maxGeometryOverlapRatio: 0.18 }),
    };

    const borderlineGate = evaluateRouteHardGates(insideButBorderline, context);
    const diagnostics = buildRejectedCandidatesDiagnostics([insideButBorderline], context, "TRAIL_PROMISE_UNMET");

    expect(isBetaStableCandidate(overPaved, context)).toBe(false);
    expect(isBetaStableCandidate(insideButBorderline, context)).toBe(true);
    expect(isBetaStableCandidate(healthy, context)).toBe(true);
    expect(borderlineGate).toMatchObject({ bucket: 0, violations: [] });
    expect(borderlineGate.criticalStabilityRisk).toBeGreaterThan(0.05);
    expect(diagnostics.rejectionReasonsHistogram).toMatchObject({ critical_stability_risk: 1 });
  });

  it("still rejects candidates above product caps or with non-relaxable safety violations", () => {
    const context = {
      targetDistanceKm: 8,
      targetElevationM: 100,
      profile: trailProfile,
      routeIntent: intent({ maxPavedRatio: 0.45, maxRepeatEdgeRatio: 0.04 }),
    };

    const overPaved = candidate(80, { quality: { pavedRatio: 0.451 } });
    const repeatOverflow = candidate(80, { quality: { repeatEdgeRatio: 0.041 } });
    const uTurnOverflow = candidate(80, { quality: { uTurnRatio: 0.011 } });
    const restrictedWarning = candidate(80, { quality: { warnings: ["RESTRICTED_ACCESS"] } });

    expect(isBetaStableCandidate(overPaved, context)).toBe(false);
    expect(isBetaStableCandidate(repeatOverflow, context)).toBe(false);
    expect(isBetaStableCandidate(uTurnOverflow, context)).toBe(false);
    expect(isBetaStableCandidate(restrictedWarning, context)).toBe(false);
  });

  it("accepts a short transition-to-woods candidate inside the 8k paved beta gate", () => {
    const tourvilleLike = candidate(80, {
      distanceKm: 7.294177041648547,
      ascendM: 72,
      quality: {
        pavedRatio: 0.42824393594260796,
        repeatEdgeRatio: 0.013967040052076147,
        uTurnRatio: 0.0019290270456284453,
        productionScore: 0.7176609186535239,
        trailBeautyScore: 0.6804550489620724,
        naturalCorridorRatio: 0.45261023008939233,
        longestTrailSegmentKm: 3.3014191491333116,
        trailPotential: "high",
      },
    });
    const context = {
      targetDistanceKm: 8,
      targetElevationM: 120,
      profile: trailProfile,
      routeIntent: intent({ targetDistanceKm: 8, targetElevationM: 120, maxPavedRatio: 0.48 }),
    };

    expect(isBetaStableCandidate(tourvilleLike, context)).toBe(true);
  });

  it("does not reject a compliant long trail route solely by summing independent beta margins", () => {
    const tourville12kLike = candidate(80, {
      distanceKm: 11.271095464114607,
      ascendM: 234,
      quality: {
        productionScore: 0.7568082964182472,
        pavedRatio: 0.38534428416576333,
        repeatEdgeRatio: 0.031597163741458795,
        uTurnRatio: 0.0011220580910018827,
        trailBeautyScore: 0.6581733784491937,
        naturalCorridorRatio: 0.5247745834686102,
        longestTrailSegmentKm: 4.169383126331206,
        trailPotential: "medium",
      },
    });
    const context = {
      targetDistanceKm: 12,
      targetElevationM: 150,
      profile: trailProfile,
      routeIntent: intent({ targetDistanceKm: 12, targetElevationM: 150, maxPavedRatio: 0.42 }),
    };

    expect(isBetaStableCandidate(tourville12kLike, context)).toBe(true);
  });

  it("prefers a stable hard-gate margin over a prettier borderline trail candidate", () => {
    const prettierBorderline = candidate(100, {
      quality: {
        pavedRatio: 0.449,
        repeatEdgeRatio: 0.039,
        uTurnRatio: 0.0095,
        naturalCorridorRatio: 0.405,
        longestTrailSegmentKm: 1.61,
        trailBeautyScore: 0.72,
        productionScore: 0.9,
      },
    });
    const saferMargin = candidate(60, {
      quality: {
        pavedRatio: 0.32,
        repeatEdgeRatio: 0.005,
        uTurnRatio: 0.001,
        naturalCorridorRatio: 0.6,
        longestTrailSegmentKm: 2.4,
        trailBeautyScore: 0.68,
        productionScore: 0.82,
      },
    });

    const ordered = orderCandidatesByHardGates(
      [prettierBorderline, saferMargin],
      { targetDistanceKm: 8, targetElevationM: 100, profile: trailProfile, routeIntent: intent() },
      (route) => route.totalScore
    );

    expect(ordered[0]).toBe(saferMargin);
  });

  it("does not let compactness heuristics outrank a safer paved-margin park loop", () => {
    const compactButOverPaved = candidate(100, {
      distanceKm: 5.96,
      ascendM: 50,
      quality: {
        pavedRatio: 0.658,
        repeatEdgeRatio: 0.008,
        uTurnRatio: 0.009,
        productionScore: 0.8,
        geometry: { ...quality().geometry!, loopCompactness: 0.12, geometryOverlapRatio: 0.08 },
      },
    });
    const lowerPavedConstrainedLoop = candidate(60, {
      distanceKm: 5.64,
      ascendM: 100,
      quality: {
        pavedRatio: 0.58,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        productionScore: 0.74,
        geometry: { ...quality().geometry!, loopCompactness: 0.04, geometryOverlapRatio: 0.15 },
      },
    });

    const ordered = orderCandidatesByHardGates(
      [compactButOverPaved, lowerPavedConstrainedLoop],
      {
        targetDistanceKm: 6,
        targetElevationM: 50,
        profile: recoveryProfile,
        routeIntent: intent({ type: "park_loop", strategy: "park_loop", targetDistanceKm: 6, targetElevationM: 50, maxPavedRatio: 0.65, maxRepeatEdgeRatio: 0.12, maxGeometryOverlapRatio: 0.18 }),
      },
      (route) => route.totalScore
    );

    expect(ordered[0]).toBe(lowerPavedConstrainedLoop);
  });

  it("blocks self-intersecting and over-repeat park recovery routes before soft score", () => {
    const caenBadButPretty = candidate(100, {
      distanceKm: 5.92,
      ascendM: 46,
      quality: {
        productionScore: 0.92,
        pavedRatio: 0.674,
        repeatEdgeRatio: 0.085,
        uTurnRatio: 0.004,
        naturalWayRatio: 0.77,
        trailRatio: 0.77,
        geometry: { ...quality().geometry!, selfIntersectionCount: 6, geometryOverlapRatio: 0.098, loopCompactness: 0.25 },
      },
    });
    const caenCleaner = candidate(40, {
      distanceKm: 5.85,
      ascendM: 50,
      quality: {
        productionScore: 0.79,
        pavedRatio: 0.636,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        naturalWayRatio: 0.83,
        trailRatio: 0.83,
        geometry: { ...quality().geometry!, selfIntersectionCount: 0, geometryOverlapRatio: 0.11, loopCompactness: 0.08 },
      },
    });
    const context = {
      targetDistanceKm: 6,
      targetElevationM: 50,
      profile: recoveryProfile,
      routeIntent: intent({ type: "park_loop", strategy: "park_loop", targetDistanceKm: 6, targetElevationM: 50, maxPavedRatio: 0.68, maxRepeatEdgeRatio: 0.06, maxGeometryOverlapRatio: 0.18 }),
    };

    const badGate = evaluateRouteHardGates(caenBadButPretty, context);
    const ordered = orderCandidatesByHardGates([caenBadButPretty, caenCleaner], context, (route) => route.totalScore);

    expect(isBetaStableCandidate(caenBadButPretty, context)).toBe(false);
    expect(badGate.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "repeat_edge_ratio", relaxable: false }),
      expect.objectContaining({ key: "geometry_self_intersection", relaxable: false }),
    ]));
    expect(ordered[0]).toBe(caenCleaner);
  });

  it("summarizes rejected candidates with gate reasons, thresholds, and deltas for benchmark diagnostics", () => {
    const distanceFailure = candidate(100, {
      distanceKm: 6.7,
      ascendM: 90,
      quality: {
        productionScore: 0.66,
        pavedRatio: 0.52,
        trailRatio: 0.24,
        naturalWayRatio: 0.51,
        repeatEdgeRatio: 0.055,
        uTurnRatio: 0.014,
        trailBeautyScore: 0.5,
        longestTrailSegmentKm: 1.2,
        warnings: ["LOW_TRAIL_SHARE"],
      },
    });
    const pavedFailure = candidate(60, {
      distanceKm: 7.9,
      ascendM: 110,
      quality: {
        productionScore: 0.73,
        pavedRatio: 0.54,
        trailRatio: 0.32,
        naturalWayRatio: 0.6,
        repeatEdgeRatio: 0.01,
        uTurnRatio: 0,
        trailBeautyScore: 0.7,
        longestTrailSegmentKm: 2.1,
        warnings: [],
      },
    });
    const context = {
      targetDistanceKm: 8,
      targetElevationM: 100,
      profile: trailProfile,
      routeIntent: intent({ maxPavedRatio: 0.45 }),
    };

    const diagnostics = buildRejectedCandidatesDiagnostics(
      [distanceFailure, pavedFailure],
      context,
      "TRAIL_PROMISE_UNMET"
    );

    expect(diagnostics).toMatchObject({
      subCode: "TRAIL_PROMISE_UNMET",
      candidateCount: 2,
      topCandidateIndex: 0,
      selectedCandidateIndex: 0,
      rejectionReasonsHistogram: expect.objectContaining({
        distance_tolerance: 1,
        paved_ratio: 2,
        repeat_edge_ratio: 1,
        trail_beauty_score: 1,
        longest_trail_segment: 1,
      }),
    });
    expect(diagnostics.topCandidates).toHaveLength(2);
    expect(diagnostics.topCandidates[0]).toMatchObject({
      candidateIndex: 0,
      distanceKm: 6.7,
      ascendM: 90,
      productionScore: 0.66,
      pavedRatio: 0.52,
      trailRatio: 0.24,
      naturalWayRatio: 0.51,
      longestTrailSegmentKm: 1.2,
      repeatEdgeRatio: 0.055,
      uTurnRatio: 0.014,
      warnings: ["LOW_TRAIL_SHARE"],
      gate: {
        bucket: 2,
        violations: expect.arrayContaining([
          expect.objectContaining({ key: "distance_tolerance" }),
          expect.objectContaining({ key: "paved_ratio" }),
        ]),
      },
    });
    expect(diagnostics.topCandidates[0].thresholds).toMatchObject({
      maxPavedRatio: 0.45,
      minProductionScore: 0.7,
      maxRepeatEdgeRatio: 0.04,
      maxUTurnRatio: 0.01,
    });
    expect(diagnostics.topCandidates[0].deltas).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "paved_ratio", actual: 0.52, limit: 0.45, deltaToPass: -0.07 }),
      expect.objectContaining({ key: "production_score", actual: 0.66, limit: 0.7, deltaToPass: -0.04 }),
    ]));
  });
});
