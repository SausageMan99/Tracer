import { describe, expect, it } from "vitest";
import { orderCandidatesByHardGates } from "@/lib/engine/route-gate-selector";
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
});
