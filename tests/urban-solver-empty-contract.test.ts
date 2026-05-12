import { describe, expect, it } from "vitest";
import { determineSolverEmptyErrorContract } from "@/lib/engine";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import type { RouteIntent } from "@/lib/engine/terrain-planner";

function intent(overrides: Partial<RouteIntent> = {}): RouteIntent {
  return {
    type: "urban_nature_loop",
    strategy: "urban_nature_loop",
    targetDistanceKm: 8,
    targetElevationM: 60,
    targetComponents: [],
    distancePolicy: { mode: "strict" },
    maxPavedRatio: 0.68,
    maxBusyRoadRatio: 0.1,
    maxRepeatEdgeRatio: 0.06,
    maxGeometryOverlapRatio: 0.18,
    cleanReturnMode: "fallback_allowed",
    timeBudgetMs: 4500,
    beamBudget: { beamWidth: 20, maxIterations: 300, shortlistSize: 12 },
    relaxationOrder: [],
    userWarningsIfRelaxed: [],
    terrainComponents: [],
    ...overrides,
  };
}

describe("urban solver-empty refusal contract", () => {
  it("does not expose a healthy urban graph paved-cap exhaustion as raw NO_ROAD_NETWORK", () => {
    const profile = PROFILES_BY_ID.get("running_endurance")!;

    expect(determineSolverEmptyErrorContract({
      profile,
      routeIntent: intent(),
      graphNodeCount: 21_802,
      graphEdgeCount: 48_242,
      emptyReason: "PAVED_CAP_EXHAUSTED",
    })).toEqual({
      code: "ROUTE_CANDIDATES_REJECTED",
      subCode: "URBAN_NATURE_PROMISE_UNMET",
    });
  });

  it("keeps truly empty graphs as NO_ROAD_NETWORK", () => {
    const profile = PROFILES_BY_ID.get("running_endurance")!;

    expect(determineSolverEmptyErrorContract({
      profile,
      routeIntent: intent(),
      graphNodeCount: 0,
      graphEdgeCount: 0,
      emptyReason: "UNKNOWN_EMPTY",
    })).toEqual({
      code: "NO_ROAD_NETWORK",
      subCode: "SOLVER_EMPTY",
    });
  });
});