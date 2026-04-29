import { describe, expect, it } from "vitest";
import { buildRouteExplanation } from "@/lib/route-explanations";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import type { GeneratedRoute, RouteCandidate } from "@/lib/types";

function candidate(overrides: Partial<RouteCandidate> = {}): RouteCandidate {
  return {
    points: [],
    distanceKm: 10.8,
    durationSeconds: 3600,
    ascendM: 120,
    descendM: 110,
    surfaceScore: 0.8,
    loopScore: 0.9,
    totalScore: 0.82,
    geometry: { type: "LineString", coordinates: [] },
    quality: {
      productionScore: 0.84,
      distanceErrorPct: 0.08,
      elevationErrorPct: 0.2,
      loopGapKm: 0.14,
      busyRoadRatio: 0.03,
      trailRatio: 0.46,
      restrictedAccessRatio: 0,
      onewayViolationRatio: 0,
      repeatEdgeRatio: 0,
      intersectionDensityPerKm: 4,
      warnings: [],
    },
    ...overrides,
  };
}

function route(best: RouteCandidate): GeneratedRoute {
  return {
    best,
    candidates: [best],
    startCoordinate: { lat: 48.8566, lng: 2.3522 },
    profile: PROFILES_BY_ID.get("running_endurance")!,
  };
}

describe("route explanations", () => {
  it("explains a clean route as an intentional product decision", () => {
    const explanation = buildRouteExplanation(route(candidate()), {
      targetDistanceKm: 10,
      targetElevationM: 100,
      scenicMode: true,
    });

    expect(explanation.headline).toContain("Boucle propre");
    expect(explanation.summary).toContain("nature");
    expect(explanation.signals.length).toBeGreaterThanOrEqual(3);
  });

  it("calls out the main compromise when distance is off target", () => {
    const explanation = buildRouteExplanation(route(candidate({
      distanceKm: 8.1,
      quality: {
        productionScore: 0.68,
        distanceErrorPct: 0.19,
        elevationErrorPct: 0.1,
        loopGapKm: 0.25,
        busyRoadRatio: 0.04,
        trailRatio: 0.2,
        restrictedAccessRatio: 0,
        onewayViolationRatio: 0,
        repeatEdgeRatio: 0,
        intersectionDensityPerKm: 4,
        warnings: ["DISTANCE_OFF_TARGET"],
      },
    })), {
      targetDistanceKm: 10,
      targetElevationM: 100,
    });

    expect(explanation.headline).toContain("compromis");
    expect(explanation.summary).toContain("distance");
    expect(explanation.compromises).toContain("Distance éloignée de la cible");
  });
});
