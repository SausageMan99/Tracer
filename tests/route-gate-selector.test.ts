import { describe, expect, it } from "vitest";
import {
  buildRejectedCandidatesDiagnostics,
  distanceAcceptanceForCandidate,
  evaluateRouteHardGates,
  orderCandidatesByHardGates,
  isBetaStableCandidate,
  rejectionSubCodeForCandidate,
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
    distancePolicy: { mode: "strict" },
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

  it("prefers clean adjusted recovery park distance over dirty exact-distance candidates", () => {
    const cleanAdjusted = candidate(50, {
      distanceKm: 5.35,
      ascendM: 50,
      quality: { pavedRatio: 0.62, repeatEdgeRatio: 0, uTurnRatio: 0, geometry: { ...quality().geometry!, loopCompactness: 0.12 } },
    });
    const exactButPaved = candidate(100, {
      distanceKm: 6.09,
      ascendM: 50,
      quality: { pavedRatio: 0.689, repeatEdgeRatio: 0, uTurnRatio: 0, geometry: { ...quality().geometry!, loopCompactness: 0.12 } },
    });
    const exactButDirtyGeometry = candidate(90, {
      distanceKm: 6.02,
      ascendM: 50,
      quality: { pavedRatio: 0.62, repeatEdgeRatio: 0, uTurnRatio: 0, geometry: { ...quality().geometry!, loopCompactness: 0.034 } },
    });
    const context = {
      targetDistanceKm: 6,
      targetElevationM: 50,
      profile: recoveryProfile,
      routeIntent: intent({
        type: "park_loop",
        strategy: "park_loop",
        targetDistanceKm: 6,
        targetElevationM: 50,
        maxPavedRatio: 0.68,
        maxRepeatEdgeRatio: 0.06,
        maxGeometryOverlapRatio: 0.18,
        distancePolicy: {
          mode: "adjustable",
          reason: "PARK_RECOVERY_SIZE_LIMIT",
          requestedDistanceKm: 6,
          minAdjustedDistanceKm: 5.15,
          maxAdjustedDistanceKm: 6,
          preferCleanAdjustedOverDirtyExact: true,
        },
      }),
    };

    const ordered = orderCandidatesByHardGates([exactButPaved, exactButDirtyGeometry, cleanAdjusted], context, (route) => route.totalScore);

    expect(distanceAcceptanceForCandidate(cleanAdjusted, context)).toEqual("adjusted");
    expect(isBetaStableCandidate(cleanAdjusted, context)).toBe(true);
    expect(ordered[0]).toBe(cleanAdjusted);
  });

  it("classifies near-target recovery park shortfalls as adjusted instead of silent strict success", () => {
    const nearTargetShortfall = candidate(80, {
      distanceKm: 5.8265589695294135,
      ascendM: 50,
      quality: { pavedRatio: 0.561, repeatEdgeRatio: 0, uTurnRatio: 0, geometry: { ...quality().geometry!, loopCompactness: 0.0746 } },
    });
    const context = {
      targetDistanceKm: 6,
      targetElevationM: 50,
      profile: recoveryProfile,
      routeIntent: intent({
        type: "park_loop",
        strategy: "park_loop",
        targetDistanceKm: 6,
        targetElevationM: 50,
        maxPavedRatio: 0.68,
        maxRepeatEdgeRatio: 0.06,
        maxGeometryOverlapRatio: 0.18,
        distancePolicy: {
          mode: "adjustable",
          reason: "PARK_RECOVERY_SIZE_LIMIT",
          requestedDistanceKm: 6,
          minAdjustedDistanceKm: 5.16,
          maxAdjustedDistanceKm: 6,
          preferCleanAdjustedOverDirtyExact: true,
        },
      }),
    };

    expect(distanceAcceptanceForCandidate(nearTargetShortfall, context)).toEqual("adjusted");
    expect(isBetaStableCandidate(nearTargetShortfall, context)).toBe(true);
  });

  it("classifies recovery park compactness-only rejection as park too small", () => {
    const compactnessBlocked = candidate(80, {
      distanceKm: 5.836,
      ascendM: 50,
      quality: {
        pavedRatio: 0.61,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        geometry: { ...quality().geometry!, loopCompactness: 0.05178 },
      },
    });
    const context = {
      targetDistanceKm: 6,
      targetElevationM: 50,
      profile: recoveryProfile,
      routeIntent: intent({
        type: "park_loop",
        strategy: "park_loop",
        targetDistanceKm: 6,
        targetElevationM: 50,
        maxPavedRatio: 0.68,
        maxRepeatEdgeRatio: 0.06,
        maxGeometryOverlapRatio: 0.18,
        distancePolicy: {
          mode: "adjustable",
          reason: "PARK_RECOVERY_SIZE_LIMIT",
          requestedDistanceKm: 6,
          minAdjustedDistanceKm: 5.16,
          maxAdjustedDistanceKm: 6,
          preferCleanAdjustedOverDirtyExact: true,
        },
      }),
    };

    expect(isBetaStableCandidate(compactnessBlocked, context)).toBe(false);
    expect(rejectionSubCodeForCandidate(compactnessBlocked, context)).toBe("PARK_TOO_SMALL_FOR_DISTANCE");
  });

  it("does not apply adjusted distance to strict trail candidates", () => {
    const shortTrail = candidate(80, { distanceKm: 6.9, ascendM: 100, quality: { pavedRatio: 0.2 } });
    const context = {
      targetDistanceKm: 8,
      targetElevationM: 100,
      profile: trailProfile,
      routeIntent: intent({ targetDistanceKm: 8, targetElevationM: 100, distancePolicy: { mode: "strict" } }),
    };

    expect(distanceAcceptanceForCandidate(shortTrail, context)).toEqual("rejected");
    expect(isBetaStableCandidate(shortTrail, context)).toBe(false);
  });

  it("rejects strict trail candidates when route-level trail quality is below the beta promise", () => {
    const lowQualityTrail = candidate(80, {
      distanceKm: 7.85,
      ascendM: 120,
      quality: {
        productionScore: 0.95,
        pavedRatio: 0.34,
        naturalWayRatio: 0.84,
        trailBeautyScore: 0.66,
        longestTrailSegmentKm: 2.2,
        naturalCorridorRatio: 0.53,
        routeTrailQuality: "low",
        trailPotential: "medium",
      },
    });
    const context = {
      targetDistanceKm: 8,
      targetElevationM: 120,
      profile: trailProfile,
      routeIntent: intent({ targetDistanceKm: 8, targetElevationM: 120, maxPavedRatio: 0.48 }),
    };
    const gate = evaluateRouteHardGates(lowQualityTrail, context);

    expect(gate.violations.map((violation) => violation.key)).toContain("route_trail_quality");
    expect(isBetaStableCandidate(lowQualityTrail, context)).toBe(false);
    expect(rejectionSubCodeForCandidate(lowQualityTrail, context)).toBe("TRAIL_PROMISE_UNMET");
  });

  it("rejects long strict trail candidates when route-level trail quality is below the beta promise", () => {
    const lowQualityTourville12NearMiss = candidate(95, {
      distanceKm: 11.22,
      ascendM: 204,
      quality: {
        productionScore: 0.91,
        pavedRatio: 0.39,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        trailBeautyScore: 0.62,
        naturalCorridorRatio: 0.48,
        longestTrailSegmentKm: 2.9,
        trailPotential: "medium",
        routeTrailQuality: "low",
      },
    });
    const context = {
      targetDistanceKm: 12,
      targetElevationM: 150,
      profile: trailProfile,
      routeIntent: intent({ targetDistanceKm: 12, targetElevationM: 150, maxPavedRatio: 0.42, maxRepeatEdgeRatio: 0.04 }),
    };
    const gate = evaluateRouteHardGates(lowQualityTourville12NearMiss, context);

    expect(gate.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "route_trail_quality", actual: "low", limit: "medium", relaxable: false }),
    ]));
    expect(isBetaStableCandidate(lowQualityTourville12NearMiss, context)).toBe(false);
    expect(rejectionSubCodeForCandidate(lowQualityTourville12NearMiss, context)).toBe("TRAIL_PROMISE_UNMET");
  });

  it("does not reject a Tourville12-quality candidate when the benchmark elevation contract allows its D+ error", () => {
    const benchmarkAcceptedTourville12 = candidate(80, {
      distanceKm: 11.45521134837007,
      ascendM: 36,
      quality: {
        productionScore: 0.7800015088899848,
        pavedRatio: 0.3610274315344112,
        trailRatio: 0.6389725684655879,
        naturalWayRatio: 0.8066058956350918,
        trailBeautyScore: 0.7095486288834659,
        longestTrailSegmentKm: 4.550377426364412,
        naturalCorridorRatio: 0.5593468305672051,
        repeatEdgeRatio: 0.0396524479119001,
        uTurnRatio: 0.0025526046011465423,
        trailPotential: "medium",
        routeTrailQuality: "medium",
      },
    });
    const context = {
      targetDistanceKm: 12,
      targetElevationM: 150,
      profile: trailProfile,
      routeGateElevationToleranceM: 120,
      routeIntent: intent({ targetDistanceKm: 12, targetElevationM: 150, maxPavedRatio: 0.42, maxRepeatEdgeRatio: 0.04 }),
    };
    const gate = evaluateRouteHardGates(benchmarkAcceptedTourville12, context);

    expect(Math.abs(benchmarkAcceptedTourville12.ascendM - context.targetElevationM)).toBe(114);
    expect(gate.violations.map((violation) => violation.key)).not.toContain("elevation_tolerance");
    expect(isBetaStableCandidate(benchmarkAcceptedTourville12, context)).toBe(true);
  });

  it("selects a medium/high Tourville12 candidate over a higher-scored low-quality near miss", () => {
    const lowQualityNearMiss = candidate(140, {
      distanceKm: 11.2,
      ascendM: 180,
      quality: {
        productionScore: 0.94,
        pavedRatio: 0.39,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        trailBeautyScore: 0.63,
        naturalCorridorRatio: 0.5,
        longestTrailSegmentKm: 2.9,
        trailPotential: "medium",
        routeTrailQuality: "low",
      },
    });
    const healthyMediumCandidate = candidate(70, {
      distanceKm: 11.05,
      ascendM: 176,
      quality: {
        productionScore: 0.9,
        pavedRatio: 0.28,
        repeatEdgeRatio: 0.026,
        uTurnRatio: 0.001,
        trailBeautyScore: 0.76,
        naturalCorridorRatio: 0.66,
        longestTrailSegmentKm: 4.7,
        trailPotential: "medium",
        routeTrailQuality: "medium",
      },
    });
    const context = {
      targetDistanceKm: 12,
      targetElevationM: 150,
      profile: trailProfile,
      routeIntent: intent({ targetDistanceKm: 12, targetElevationM: 150, maxPavedRatio: 0.42, maxRepeatEdgeRatio: 0.04 }),
    };

    const ordered = orderCandidatesByHardGates([lowQualityNearMiss, healthyMediumCandidate], context, (route) => route.totalScore);

    expect(evaluateRouteHardGates(healthyMediumCandidate, context).bucket).toBe(0);
    expect(evaluateRouteHardGates(lowQualityNearMiss, context).bucket).toBe(2);
    expect(ordered[0]).toBe(healthyMediumCandidate);
  });

  it("allows one geometry self-intersection on otherwise clean long transition-to-woods trail routes", () => {
    const cleanComplexTrail = candidate(80, {
      distanceKm: 11.1,
      ascendM: 160,
      quality: {
        productionScore: 0.91,
        pavedRatio: 0.27,
        repeatEdgeRatio: 0.025,
        uTurnRatio: 0.001,
        trailBeautyScore: 0.78,
        naturalCorridorRatio: 0.65,
        longestTrailSegmentKm: 5.3,
        trailPotential: "high",
        routeTrailQuality: "high",
        geometry: { ...quality().geometry!, selfIntersectionCount: 1, geometryOverlapRatio: 0.03, outAndBackSimilarityRatio: 0 },
      },
    });
    const context = {
      targetDistanceKm: 12,
      targetElevationM: 150,
      profile: trailProfile,
      routeIntent: intent({ targetDistanceKm: 12, targetElevationM: 150, maxPavedRatio: 0.42, maxRepeatEdgeRatio: 0.04 }),
    };

    expect(evaluateRouteHardGates(cleanComplexTrail, context).violations.map((violation) => violation.key)).not.toContain("geometry_self_intersection");
    expect(isBetaStableCandidate(cleanComplexTrail, context)).toBe(true);
  });

  it("rejects adjusted recovery park candidates that break pavement or geometry caps", () => {
    const overPaved = candidate(80, { distanceKm: 5.35, ascendM: 50, quality: { pavedRatio: 0.7 } });
    const dirtyGeometry = candidate(70, {
      distanceKm: 5.35,
      ascendM: 50,
      quality: { pavedRatio: 0.62, geometry: { ...quality().geometry!, loopCompactness: 0.034 } },
    });
    const context = {
      targetDistanceKm: 6,
      targetElevationM: 50,
      profile: recoveryProfile,
      routeIntent: intent({
        type: "park_loop",
        strategy: "park_loop",
        targetDistanceKm: 6,
        targetElevationM: 50,
        maxPavedRatio: 0.68,
        maxRepeatEdgeRatio: 0.06,
        maxGeometryOverlapRatio: 0.18,
        distancePolicy: {
          mode: "adjustable",
          reason: "PARK_RECOVERY_SIZE_LIMIT",
          requestedDistanceKm: 6,
          minAdjustedDistanceKm: 5.15,
          maxAdjustedDistanceKm: 6,
          preferCleanAdjustedOverDirtyExact: true,
        },
      }),
    };

    expect(distanceAcceptanceForCandidate(overPaved, context)).toEqual("adjusted");
    expect(isBetaStableCandidate(overPaved, context)).toBe(false);
    expect(rejectionSubCodeForCandidate(overPaved, context)).toBe("PARK_TOO_SMALL_FOR_DISTANCE");
    expect(distanceAcceptanceForCandidate(dirtyGeometry, context)).toEqual("adjusted");
    expect(isBetaStableCandidate(dirtyGeometry, context)).toBe(false);
  });
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

  it("accepts a recovery park route with only a tiny relaxed compactness miss", () => {
    const caenRelaxedCompactness = candidate(80, {
      distanceKm: 6.3439,
      ascendM: 94,
      quality: {
        productionScore: 0.9071,
        pavedRatio: 0.6766,
        naturalWayRatio: 0.857,
        trailRatio: 0.857,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        geometry: { ...quality().geometry!, loopCompactness: 0.05866, selfIntersectionCount: 0, geometryOverlapRatio: 0.09 },
      },
    });
    const context = {
      targetDistanceKm: 6,
      targetElevationM: 50,
      profile: recoveryProfile,
      routeIntent: intent({ type: "park_loop", strategy: "park_loop", targetDistanceKm: 6, targetElevationM: 50, maxPavedRatio: 0.68, maxRepeatEdgeRatio: 0.06, maxGeometryOverlapRatio: 0.18 }),
    };

    const gate = evaluateRouteHardGates(caenRelaxedCompactness, context);

    expect(gate).toMatchObject({
      bucket: 1,
      blockingViolationCount: 0,
      violations: [expect.objectContaining({ key: "geometry_loop_compactness", relaxable: true })],
    });
    expect(isBetaStableCandidate(caenRelaxedCompactness, context)).toBe(true);
  });

  it("rejects recovery park compactness misses that are not tiny", () => {
    const caenTooConstrained = candidate(80, {
      distanceKm: 5.776,
      ascendM: 50,
      quality: {
        productionScore: 0.934,
        pavedRatio: 0.575,
        naturalWayRatio: 0.815,
        trailRatio: 0.815,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        geometry: { ...quality().geometry!, loopCompactness: 0.0495, selfIntersectionCount: 0, geometryOverlapRatio: 0.106 },
      },
    });
    const context = {
      targetDistanceKm: 6,
      targetElevationM: 50,
      profile: recoveryProfile,
      routeIntent: intent({ type: "park_loop", strategy: "park_loop", targetDistanceKm: 6, targetElevationM: 50, maxPavedRatio: 0.68, maxRepeatEdgeRatio: 0.06, maxGeometryOverlapRatio: 0.18 }),
    };

    expect(evaluateRouteHardGates(caenTooConstrained, context).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "geometry_loop_compactness", relaxable: true }),
    ]));
    expect(isBetaStableCandidate(caenTooConstrained, context)).toBe(false);
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
    const restrictedWarning = candidate(80, { quality: { warnings: ["RESTRICTED_ACCESS"], restrictedAccessRatio: 0.02 } });

    expect(isBetaStableCandidate(overPaved, context)).toBe(false);
    expect(isBetaStableCandidate(repeatOverflow, context)).toBe(false);
    expect(isBetaStableCandidate(uTurnOverflow, context)).toBe(false);
    expect(isBetaStableCandidate(restrictedWarning, context)).toBe(false);
  });

  it("classifies dominant restricted access as access blocked instead of generic trail quality", () => {
    const restrictedOnly = candidate(80, {
      distanceKm: 9.95,
      ascendM: 158,
      quality: {
        productionScore: 0.977,
        pavedRatio: 0.227,
        trailRatio: 0.773,
        naturalWayRatio: 0.89,
        trailBeautyScore: 0.5995,
        naturalCorridorRatio: 0.73,
        longestTrailSegmentKm: 2.89,
        trailPotential: "medium",
        repeatEdgeRatio: 0.0046,
        uTurnRatio: 0,
        restrictedAccessRatio: 0.02,
        warnings: ["RESTRICTED_ACCESS"],
      },
    });
    const context = {
      targetDistanceKm: 10,
      targetElevationM: 220,
      profile: trailProfile,
      routeIntent: intent({ targetDistanceKm: 10, targetElevationM: 220, maxPavedRatio: 0.42 }),
    };

    expect(evaluateRouteHardGates(restrictedOnly, context).violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "blocking_warning", actual: "RESTRICTED_ACCESS" }),
      expect.objectContaining({ key: "trail_beauty_score" }),
    ]));
    expect(rejectionSubCodeForCandidate(restrictedOnly, context)).toBe("RESTRICTED_ACCESS_BLOCKED");
  });

  it("does not hard-reject an otherwise strong forest route for trace restricted-access noise", () => {
    const meudonLike = candidate(80, {
      distanceKm: 9.954,
      ascendM: 158,
      quality: {
        productionScore: 0.977,
        pavedRatio: 0.227,
        trailRatio: 0.773,
        naturalWayRatio: 0.89,
        trailBeautyScore: 0.635,
        naturalCorridorRatio: 0.89,
        longestTrailSegmentKm: 2.89,
        trailPotential: "medium",
        repeatEdgeRatio: 0.0046,
        uTurnRatio: 0,
        restrictedAccessRatio: 0.003,
        warnings: ["RESTRICTED_ACCESS", "TRAIL_TOO_FRAGMENTED"],
      },
    });
    const context = {
      targetDistanceKm: 10,
      targetElevationM: 220,
      profile: trailProfile,
      routeIntent: intent({ targetDistanceKm: 10, targetElevationM: 220, maxPavedRatio: 0.42 }),
    };

    const gate = evaluateRouteHardGates(meudonLike, context);

    expect(gate.violations.some((violation) => violation.key === "blocking_warning" && violation.actual === "RESTRICTED_ACCESS")).toBe(false);
    expect(isBetaStableCandidate(meudonLike, context)).toBe(true);
  });

  it("classifies recovery park paved overflow as PARK_TOO_SMALL_FOR_DISTANCE instead of a silent success", () => {
    const pavedOverflow = candidate(80, {
      distanceKm: 6,
      ascendM: 50,
      quality: {
        productionScore: 0.86,
        pavedRatio: 0.7,
        naturalWayRatio: 0.84,
        trailRatio: 0.74,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        geometry: { ...quality().geometry!, loopCompactness: 0.12, selfIntersectionCount: 0 },
      },
    });
    const context = {
      targetDistanceKm: 6,
      targetElevationM: 50,
      profile: recoveryProfile,
      routeIntent: intent({ type: "park_loop", strategy: "park_loop", targetDistanceKm: 6, targetElevationM: 50, maxPavedRatio: 0.68, maxRepeatEdgeRatio: 0.06, maxGeometryOverlapRatio: 0.18 }),
    };

    const gate = evaluateRouteHardGates(pavedOverflow, context);

    expect(gate.violations).toEqual(expect.arrayContaining([
      expect.objectContaining({ key: "paved_ratio", actual: 0.7, limit: 0.68 }),
    ]));
    expect(isBetaStableCandidate(pavedOverflow, context)).toBe(false);
    expect(rejectionSubCodeForCandidate(pavedOverflow, context)).toBe("PARK_TOO_SMALL_FOR_DISTANCE");
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

  it("prefers high route trail quality and demotes low quality below repeat overflow", () => {
    const lowQualitySaferRepeat = candidate(100, {
      distanceKm: 7.39,
      ascendM: 120,
      quality: {
        routeTrailQuality: "low",
        trailPotential: "medium",
        pavedRatio: 0.479,
        repeatEdgeRatio: 0,
        uTurnRatio: 0,
        productionScore: 0.876,
        trailBeautyScore: 0.68,
        naturalCorridorRatio: 0.76,
        longestTrailSegmentKm: 2.71,
      },
    });
    const highQualityNearRepeatLimit = candidate(60, {
      distanceKm: 7.82,
      ascendM: 120,
      quality: {
        routeTrailQuality: "high",
        trailPotential: "medium",
        pavedRatio: 0.349,
        repeatEdgeRatio: 0.0399,
        uTurnRatio: 0.0076,
        productionScore: 0.965,
        trailBeautyScore: 0.72,
        naturalCorridorRatio: 0.85,
        longestTrailSegmentKm: 3.81,
      },
    });
    const highQualityRepeatOverflow = candidate(120, {
      distanceKm: 7.82,
      ascendM: 120,
      quality: {
        routeTrailQuality: "high",
        trailPotential: "medium",
        pavedRatio: 0.349,
        repeatEdgeRatio: 0.041,
        uTurnRatio: 0.0076,
        productionScore: 0.965,
        trailBeautyScore: 0.72,
        naturalCorridorRatio: 0.85,
        longestTrailSegmentKm: 3.81,
      },
    });
    const context = {
      targetDistanceKm: 8,
      targetElevationM: 120,
      profile: trailProfile,
      routeIntent: intent({ targetDistanceKm: 8, targetElevationM: 120, maxPavedRatio: 0.48, maxRepeatEdgeRatio: 0.04 }),
    };

    expect(evaluateRouteHardGates(highQualityNearRepeatLimit, context).bucket).toBe(0);
    expect(evaluateRouteHardGates(highQualityRepeatOverflow, context).bucket).toBe(2);

    const ordered = orderCandidatesByHardGates(
      [lowQualitySaferRepeat, highQualityNearRepeatLimit, highQualityRepeatOverflow],
      context,
      (route) => route.totalScore
    );

    expect(ordered[0]).toBe(highQualityNearRepeatLimit);
    expect(ordered.indexOf(lowQualitySaferRepeat)).toBeGreaterThan(ordered.indexOf(highQualityRepeatOverflow));
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
      [
        distanceFailure,
        candidate(61, { quality: { routeTrailQuality: "medium" } }),
        candidate(62, { quality: { routeTrailQuality: "high" } }),
        pavedFailure,
      ],
      context,
      "TRAIL_PROMISE_UNMET"
    );

    expect(diagnostics).toMatchObject({
      subCode: "TRAIL_PROMISE_UNMET",
      candidateCount: 4,
      topCandidateIndex: 0,
      selectedCandidateIndex: 0,
      routeTrailQualityHistogram: {
        low: 0,
        medium: 1,
        high: 1,
        unknown: 2,
      },
      rejectionReasonsHistogram: expect.objectContaining({
        distance_tolerance: 1,
        paved_ratio: 2,
        repeat_edge_ratio: 1,
        trail_beauty_score: 1,
        longest_trail_segment: 1,
      }),
    });
    expect(diagnostics.topCandidates).toHaveLength(4);
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
