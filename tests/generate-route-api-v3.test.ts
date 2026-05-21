import { beforeEach, describe, expect, it, vi } from "vitest";

const generateRouteV2Mock = vi.fn();
const generateRouteLegacyMock = vi.fn();
const generateRouteV3ApiMock = vi.fn();

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

vi.mock("@/lib/engine-v3/api-adapter", () => ({
  generateRouteV3Api: generateRouteV3ApiMock,
}));

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/generate-route", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-forwarded-for": `198.51.100.${Math.floor(Math.random() * 200) + 1}`,
    },
    body: JSON.stringify(body),
  });
}

const baseBody = {
  address: "Tourville-sur-Odon",
  profileId: "running_trail",
  targetDistanceKm: 8,
  targetElevationM: 120,
};

const v3Contract = {
  engine: "v3-clean-room" as const,
  betaOutcome: "generated" as const,
  betaOutcomeLabel: "generated_trail" as const,
  productLabel: "generated_trail" as const,
  metrics: {
    distanceKm: 8.1,
    pavedKm: 1.2,
    nonPavedKm: 6.9,
    naturalDwellKm: 5.4,
    repeatEdgeKm: 0.1,
  },
  reason: "Route V3 experimental generated from graph evidence.",
  warnings: ["Experimental V3 output."],
  userWarnings: ["Sortie V3 expérimentale."],
  routeGeoJson: {
    type: "Feature" as const,
    geometry: {
      type: "LineString" as const,
      coordinates: [[-0.51, 49.14], [-0.52, 49.15]],
    },
    properties: {},
  },
  gpxAvailable: true,
};

describe("POST /api/generate-route V3 experimental", () => {
  beforeEach(() => {
    vi.resetModules();
    generateRouteV2Mock.mockReset();
    generateRouteLegacyMock.mockReset();
    generateRouteV3ApiMock.mockReset();
  });

  it("keeps V2.5 as the default when no engineVersion flag is provided", async () => {
    generateRouteV2Mock.mockResolvedValue({ id: "v2-route", distanceKm: 8, geometry: { type: "LineString", coordinates: [] } });
    generateRouteV3ApiMock.mockResolvedValue(v3Contract);

    const { POST } = await import("@/app/api/generate-route/route");
    const response = await POST(makeRequest(baseBody) as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({ success: true, route: { id: "v2-route", betaOutcome: "generated" } });
    expect(generateRouteV2Mock).toHaveBeenCalledTimes(1);
    expect(generateRouteV3ApiMock).not.toHaveBeenCalled();
  });

  it("returns the V3 experimental product contract when engineVersion is v3_experimental", async () => {
    generateRouteV3ApiMock.mockResolvedValue(v3Contract);

    const { POST } = await import("@/app/api/generate-route/route");
    const response = await POST(makeRequest({ ...baseBody, engineVersion: "v3_experimental" }) as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      engine: "v3-clean-room",
      generationId: expect.stringMatching(/^gen_/),
      betaOutcome: "generated",
      betaOutcomeLabel: "generated_trail",
      productLabel: "generated_trail",
      metrics: v3Contract.metrics,
      reason: v3Contract.reason,
      warnings: v3Contract.warnings,
      userWarnings: v3Contract.userWarnings,
      routeGeoJson: v3Contract.routeGeoJson,
      gpxAvailable: true,
    });
    expect(payload.route).toBeUndefined();
    expect(generateRouteV3ApiMock).toHaveBeenCalledTimes(1);
    expect(generateRouteV3ApiMock).toHaveBeenCalledWith(expect.objectContaining(baseBody));
    expect(generateRouteV2Mock).not.toHaveBeenCalled();
    expect(generateRouteLegacyMock).not.toHaveBeenCalled();
  });

  it("treats V3 refused as a valid product response, not a server error", async () => {
    generateRouteV3ApiMock.mockResolvedValue({
      ...v3Contract,
      betaOutcome: "refused",
      reason: "DISTANCE_UNATTAINABLE",
      warnings: ["No honest trail loop can be assembled for this request."],
      routeGeoJson: null,
      gpxAvailable: false,
    });

    const { POST } = await import("@/app/api/generate-route/route");
    const response = await POST(makeRequest({ ...baseBody, engineVersion: "v3_experimental" }) as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      engine: "v3-clean-room",
      betaOutcome: "refused",
      reason: "DISTANCE_UNATTAINABLE",
      routeGeoJson: null,
      gpxAvailable: false,
    });
  });
});
