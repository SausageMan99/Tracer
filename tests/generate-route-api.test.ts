import { beforeEach, describe, expect, it, vi } from "vitest";
import { RouteGenerationError } from "@/lib/errors";

const generateRouteV2Mock = vi.fn();
const generateRouteLegacyMock = vi.fn();

vi.mock("@/lib/engine", () => ({
  generateRouteV2: generateRouteV2Mock,
}));

vi.mock("@/lib/route-generator-legacy", async () => {
  const actual = await vi.importActual<typeof import("@/lib/route-generator-legacy")>("@/lib/route-generator-legacy");
  return {
    ...actual,
    generateRoute: generateRouteLegacyMock,
  };
});

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/generate-route", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `203.0.113.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  address: "Lille",
  profileId: "running_endurance",
  targetDistanceKm: 10,
  targetElevationM: 100,
};

describe("POST /api/generate-route", () => {
  beforeEach(() => {
    vi.resetModules();
    generateRouteV2Mock.mockReset();
    generateRouteLegacyMock.mockReset();
  });

  it("does not silently fall back to legacy when V2 loop generation fails", async () => {
    generateRouteV2Mock.mockRejectedValue(
      new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "SOLVER_EMPTY" })
    );
    generateRouteLegacyMock.mockResolvedValue({ id: "legacy-route" });

    const { POST } = await import("@/app/api/generate-route/route");
    const response = await POST(makeRequest(baseBody) as never);
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload).toMatchObject({
      success: false,
      errorCode: "NO_ROAD_NETWORK",
      subCode: "SOLVER_EMPTY",
    });
    expect(generateRouteV2Mock).toHaveBeenCalledTimes(1);
    expect(generateRouteV2Mock).toHaveBeenCalledWith(expect.objectContaining(baseBody), {
      includeGenerationDiagnostics: false,
    });
    expect(generateRouteLegacyMock).not.toHaveBeenCalled();
  });

  it("maps beta clean-refusal candidate rejection to a typed 422 instead of success or 500", async () => {
    generateRouteV2Mock.mockRejectedValue(
      new RouteGenerationError("ROUTE_CANDIDATES_REJECTED", { subCode: "TRAIL_PROMISE_UNMET" })
    );

    const { POST } = await import("@/app/api/generate-route/route");
    const response = await POST(makeRequest(baseBody) as never);
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload).toMatchObject({
      success: false,
      errorCode: "ROUTE_CANDIDATES_REJECTED",
      subCode: "TRAIL_PROMISE_UNMET",
    });
    expect(payload.rejectedCandidatesDiagnostics).toBeUndefined();
    expect(generateRouteLegacyMock).not.toHaveBeenCalled();
  });

  it("maps constrained recovery park refusals to user-facing shorter-distance copy", async () => {
    generateRouteV2Mock.mockRejectedValue(
      new RouteGenerationError("ROUTE_CANDIDATES_REJECTED", { subCode: "PARK_TOO_SMALL_FOR_DISTANCE" })
    );

    const { POST } = await import("@/app/api/generate-route/route");
    const response = await POST(makeRequest({
      ...baseBody,
      profileId: "running_recuperation",
      targetDistanceKm: 6,
      targetElevationM: 50,
    }) as never);
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload).toMatchObject({
      success: false,
      errorCode: "ROUTE_CANDIDATES_REJECTED",
      subCode: "PARK_TOO_SMALL_FOR_DISTANCE",
    });
    expect(payload.error).toMatch(/distance plus courte/i);
    expect(payload.rejectedCandidatesDiagnostics).toBeUndefined();
    expect(generateRouteLegacyMock).not.toHaveBeenCalled();
  });

  it("exposes rejected candidate diagnostics only when benchmark generation diagnostics are requested", async () => {
    const rejectedCandidatesDiagnostics = {
      subCode: "TRAIL_PROMISE_UNMET",
      candidateCount: 422,
      topCandidateIndex: 0,
      selectedCandidateIndex: 0,
      rejectionReasonsHistogram: { paved_ratio: 17 },
      topCandidates: [{
        candidateIndex: 0,
        distanceKm: 7.9,
        ascendM: 110,
        productionScore: 0.72,
        pavedRatio: 0.51,
        trailRatio: 0.3,
        naturalWayRatio: 0.6,
        trailBeautyScore: 0.7,
        longestTrailSegmentKm: 2.1,
        repeatEdgeRatio: 0.01,
        uTurnRatio: 0,
        warnings: [],
        gate: {
          strictViable: false,
          relaxedViable: true,
          bucket: 1 as const,
          violations: [],
          blockingViolationCount: 0,
          totalSeverity: 0,
          criticalStabilityRisk: 0.08,
        },
        criticalStabilityRisk: 0.08,
        thresholds: { maxPavedRatio: 0.45 },
        deltas: [{ key: "paved_ratio", actual: 0.51, limit: 0.45, deltaToPass: -0.06 }],
      }],
    };
    generateRouteV2Mock.mockRejectedValue(
      new RouteGenerationError("ROUTE_CANDIDATES_REJECTED", {
        subCode: "TRAIL_PROMISE_UNMET",
        rejectedCandidatesDiagnostics,
      })
    );

    const { POST } = await import("@/app/api/generate-route/route");
    const response = await POST(makeRequest({ ...baseBody, includeGenerationDiagnostics: true }) as never);
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload).toMatchObject({
      success: false,
      errorCode: "ROUTE_CANDIDATES_REJECTED",
      subCode: "TRAIL_PROMISE_UNMET",
      rejectedCandidatesDiagnostics,
    });
  });


  it("exposes recovery park adjusted distance instead of a silent short 200", async () => {
    const distanceAdjustment = {
      requestedDistanceKm: 6,
      adjustedDistanceKm: 5.35,
      reason: "PARK_RECOVERY_SIZE_LIMIT",
      policy: "adjusted_distance",
      messageCode: "PARK_RECOVERY_DISTANCE_ADJUSTED",
    };
    generateRouteV2Mock.mockResolvedValue({
      best: { id: "best", distanceKm: 5.35 },
      candidates: [{ id: "best", distanceKm: 5.35 }],
      distanceAdjustment,
    });

    const { POST } = await import("@/app/api/generate-route/route");
    const response = await POST(makeRequest({
      ...baseBody,
      profileId: "running_recuperation",
      targetDistanceKm: 6,
      targetElevationM: 50,
    }) as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.route.distanceAdjustment).toEqual(distanceAdjustment);
  });

  it("keeps legacy generation for waypoint or end-address routes", async () => {
    generateRouteLegacyMock.mockResolvedValue({ id: "point-to-point-route" });

    const { POST } = await import("@/app/api/generate-route/route");
    const response = await POST(
      makeRequest({ ...baseBody, endAddress: "Roubaix" }) as never
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true, route: { id: "point-to-point-route" } });
    expect(generateRouteV2Mock).not.toHaveBeenCalled();
    expect(generateRouteLegacyMock).toHaveBeenCalledTimes(1);
  });

  it("routes long cycling loops through the controlled external-routing strategy instead of V2", async () => {
    generateRouteLegacyMock.mockResolvedValue({ id: "road-bike-loop" });

    const { POST } = await import("@/app/api/generate-route/route");
    const response = await POST(
      makeRequest({
        address: "Place Sainte-Anne, Rennes",
        profileId: "cycling_road_endurance",
        targetDistanceKm: 70,
        targetElevationM: 500,
      }) as never
    );
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true, route: { id: "road-bike-loop" } });
    expect(generateRouteV2Mock).not.toHaveBeenCalled();
    expect(generateRouteLegacyMock).toHaveBeenCalledTimes(1);
  });

  it("strips edge and generation diagnostics from public API responses by default", async () => {
    generateRouteV2Mock.mockResolvedValue({
      best: {
        id: "best",
        quality: {
          trailRatio: 0.2,
          naturalWayRatio: 0.8,
          pavedRatio: 0.65,
          scenicPavedRatio: 0.5,
        },
        edgeDiagnostics: [{ edgeId: "best-edge" }],
      },
      candidates: [
        { id: "candidate", edgeDiagnostics: [{ edgeId: "candidate-edge" }] },
      ],
      stageTimings: { totalMs: 12, stages: [{ stage: "total", durationMs: 12, ok: true }] },
      diagnostics: { version: 1, strategy: "v2-local-graph" },
    });

    const { POST } = await import("@/app/api/generate-route/route");
    const response = await POST(makeRequest(baseBody) as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.route.stageTimings).toBeUndefined();
    expect(payload.route.diagnostics).toBeUndefined();
    expect(payload.route.best.edgeDiagnostics).toBeUndefined();
    expect(payload.route.candidates[0].edgeDiagnostics).toBeUndefined();
    expect(payload.route.best.quality).toMatchObject({
      trailRatio: 0.2,
      naturalWayRatio: 0.8,
      pavedRatio: 0.65,
      scenicPavedRatio: 0.5,
    });
  });

  it("keeps edge diagnostics when the benchmark runner explicitly asks for them", async () => {
    const edgeDiagnostics = [{ edgeId: "candidate-edge" }];
    generateRouteV2Mock.mockResolvedValue({
      best: { id: "best", edgeDiagnostics },
      candidates: [
        { id: "candidate", edgeDiagnostics },
      ],
      stageTimings: { totalMs: 12, stages: [{ stage: "total", durationMs: 12, ok: true }] },
      diagnostics: { version: 1, strategy: "v2-local-graph" },
    });

    const { POST } = await import("@/app/api/generate-route/route");
    const response = await POST(makeRequest({ ...baseBody, includeEdgeDiagnostics: true }) as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload.route.best.edgeDiagnostics).toEqual(edgeDiagnostics);
    expect(payload.route.candidates[0].edgeDiagnostics).toEqual(edgeDiagnostics);
    expect(payload.route.stageTimings).toBeUndefined();
    expect(payload.route.diagnostics).toBeUndefined();
  });

  it("keeps generation diagnostics separately from edge diagnostics", async () => {
    const edgeDiagnostics = [{ edgeId: "candidate-edge" }];
    const stageTimings = {
      totalMs: 42,
      stages: [{ stage: "profile.resolve", durationMs: 1, ok: true }],
    };
    const diagnostics = {
      version: 1,
      strategy: "v2-local-graph",
      solver: { pathCount: 2, candidateCount: 1 },
    };
    generateRouteV2Mock.mockResolvedValue({
      best: { id: "best", edgeDiagnostics },
      candidates: [{ id: "candidate", edgeDiagnostics }],
      stageTimings,
      diagnostics,
    });

    const { POST } = await import("@/app/api/generate-route/route");
    const response = await POST(makeRequest({ ...baseBody, includeGenerationDiagnostics: true }) as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(generateRouteV2Mock).toHaveBeenCalledWith(expect.objectContaining(baseBody), {
      includeGenerationDiagnostics: true,
    });
    expect(payload.route.stageTimings).toEqual(stageTimings);
    expect(payload.route.diagnostics).toEqual(diagnostics);
    expect(payload.route.best.edgeDiagnostics).toBeUndefined();
    expect(payload.route.candidates[0].edgeDiagnostics).toBeUndefined();
  });
});
