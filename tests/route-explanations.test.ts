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
      naturalWayRatio: 0.58,
      pavedRatio: 0.18,
      scenicPavedRatio: 0.04,
      uTurnRatio: 0,
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
    expect(explanation.signals).toEqual(expect.arrayContaining([
      "Sentiers non bitumés : 46%",
      "Cadre naturel/scénique : 58%",
      "Revêtement bitumé : 18%",
    ]));
    expect(explanation.signals.length).toBeGreaterThanOrEqual(5);
  });

  it("distinguishes natural/scenic context from non-paved trail and pavement", () => {
    const explanation = buildRouteExplanation(route(candidate({
      quality: {
        productionScore: 0.62,
        distanceErrorPct: 0.04,
        elevationErrorPct: 0.12,
        loopGapKm: 0.1,
        busyRoadRatio: 0.02,
        trailRatio: 0.18,
        naturalWayRatio: 0.72,
        pavedRatio: 0.66,
        scenicPavedRatio: 0.54,
        uTurnRatio: 0,
        restrictedAccessRatio: 0,
        onewayViolationRatio: 0,
        repeatEdgeRatio: 0,
        intersectionDensityPerKm: 4,
        warnings: ["NATURAL_BUT_PAVED"],
      },
    })), {
      targetDistanceKm: 10,
      targetElevationM: 100,
      scenicMode: true,
    });

    expect(explanation.compromises).toContain("Cadre naturel mais trop bitumé");
    expect(explanation.signals).toEqual(expect.arrayContaining([
      "Sentiers non bitumés : 18%",
      "Cadre naturel/scénique : 72%",
      "Revêtement bitumé : 66%",
      "Bitumé scénique : 54%",
    ]));
    expect(explanation.signals.join(" ")).not.toContain("Chemins/nature");
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
        naturalWayRatio: 0.31,
        pavedRatio: 0.22,
        scenicPavedRatio: 0.05,
        uTurnRatio: 0,
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
