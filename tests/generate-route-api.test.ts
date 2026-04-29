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
      new RouteGenerationError("NO_ROAD_NETWORK", "SOLVER_EMPTY")
    );
    generateRouteLegacyMock.mockResolvedValue({ id: "legacy-route" });

    const { POST } = await import("@/app/api/generate-route/route");
    const response = await POST(makeRequest(baseBody) as never);
    const payload = await response.json();

    expect(response.status).toBe(422);
    expect(payload).toMatchObject({
      success: false,
      errorCode: "NO_ROAD_NETWORK",
    });
    expect(generateRouteV2Mock).toHaveBeenCalledTimes(1);
    expect(generateRouteLegacyMock).not.toHaveBeenCalled();
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
});
