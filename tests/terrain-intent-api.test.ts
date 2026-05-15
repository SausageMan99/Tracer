import { beforeEach, describe, expect, it, vi } from "vitest";

const geocodeAddressMock = vi.fn();
const buildGraphMock = vi.fn();

vi.mock("@/lib/route-generator-legacy", async () => {
  const actual = await vi.importActual<typeof import("@/lib/route-generator-legacy")>("@/lib/route-generator-legacy");
  return {
    ...actual,
    geocodeAddress: geocodeAddressMock,
  };
});

vi.mock("@/lib/engine/graph-builder", () => ({
  buildGraph: buildGraphMock,
}));

const baseBody = {
  address: "Tourville-sur-Odon",
  profileId: "running_trail",
  targetDistanceKm: 8,
  targetElevationM: 120,
};

function makeRequest(body: unknown): Request {
  return new Request("http://localhost/api/terrain-intent", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

describe("POST /api/terrain-intent", () => {
  beforeEach(() => {
    vi.resetModules();
    geocodeAddressMock.mockReset();
    buildGraphMock.mockReset();
  });

  it("returns V3 terrain snapshot, components, strategy, possible outcomes, risks, and user summary before generation", async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 49.141, lng: -0.501 });
    buildGraphMock.mockResolvedValue({
      graph: makeGraph([
        { id: "road", from: "a", to: "b", lengthKm: 1.6, highway: "residential", surface: "asphalt", scenic: false },
        { id: "path", from: "b", to: "c", lengthKm: 4.4, highway: "path", surface: "dirt", scenic: true, landcoverClass: "forest" },
      ]),
    });

    const { POST } = await import("@/app/api/terrain-intent/route");
    const response = await POST(makeRequest(baseBody) as never);
    const payload = await response.json();

    expect(response.status).toBe(200);
    expect(payload).toMatchObject({
      success: true,
      generationId: expect.stringMatching(/^terrain_/),
      engine: "v3-clean-room",
      recommendedStrategy: "transition_to_woods",
      userSummary: "Trail possible mais nécessite une transition route vers les bois.",
    });
    expect(payload.terrainSnapshot.audit.edgeCount).toBeGreaterThan(0);
    expect(payload.components.map((component: { kind: string }) => component.kind)).toContain("forest");
    expect(payload.possibleOutcomes.map((outcome: { type: string }) => outcome.type)).toContain("adjusted");
    expect(payload.risks.join(" ")).toContain("paved connectors");
    expect(buildGraphMock).toHaveBeenCalledTimes(1);
  });

  it("rejects invalid input without hitting the terrain inspector", async () => {
    const { POST } = await import("@/app/api/terrain-intent/route");
    const response = await POST(makeRequest({ ...baseBody, profileId: "missing" }) as never);
    const payload = await response.json();

    expect(response.status).toBe(400);
    expect(payload).toMatchObject({
      success: false,
      betaOutcome: "refused",
      error: "Profil de séance inconnu.",
    });
    expect(buildGraphMock).not.toHaveBeenCalled();
  });
});

describe("inspectTerrainIntentV3Api", () => {
  beforeEach(() => {
    vi.resetModules();
    geocodeAddressMock.mockReset();
    buildGraphMock.mockReset();
  });

  it("builds a French user summary and risk list from snapshot and planned intent", async () => {
    geocodeAddressMock.mockResolvedValue({ lat: 49.141, lng: -0.501 });
    buildGraphMock.mockResolvedValue({
      graph: makeGraph([
        { id: "road", from: "a", to: "b", lengthKm: 1.6, highway: "residential", surface: "asphalt", scenic: false },
        { id: "path", from: "b", to: "c", lengthKm: 4.4, highway: "path", surface: "dirt", scenic: true, landcoverClass: "forest" },
      ]),
    });

    const { inspectTerrainIntentV3Api } = await import("@/lib/engine-v3/api-adapter");
    const response = await inspectTerrainIntentV3Api(baseBody);

    expect(response.engine).toBe("v3-clean-room");
    expect(response.terrainSnapshot.audit.edgeCount).toBeGreaterThan(0);
    expect(response.components.map((component) => component.kind)).toContain("forest");
    expect(response.recommendedStrategy).toBe("transition_to_woods");
    expect(response.possibleOutcomes.map((outcome) => outcome.type)).toContain("adjusted");
    expect(response.risks.join(" ")).toContain("paved connectors");
    expect(response.userSummary).toBe("Trail possible mais nécessite une transition route vers les bois.");
  });
});

function makeGraph(edgeInputs: Array<{
  id: string;
  from: string;
  to: string;
  lengthKm: number;
  highway: string;
  surface?: string;
  scenic?: boolean;
  landcoverClass?: "forest" | "park" | "urban" | "water_corridor";
}>) {
  const nodes = new Map([
    ["a", { id: "a", lat: 49.141, lng: -0.501, edges: [] as string[] }],
    ["b", { id: "b", lat: 49.142, lng: -0.502, edges: [] as string[] }],
    ["c", { id: "c", lat: 49.143, lng: -0.503, edges: [] as string[] }],
  ]);
  const edges = new Map();

  for (const input of edgeInputs) {
    const forwardId = `${input.id}-f`;
    const backwardId = `${input.id}-b`;
    const base = {
      lengthKm: input.lengthKm,
      highway: input.highway,
      surface: input.surface,
      scenic: input.scenic ?? false,
      osmWayId: Math.abs(hashCode(input.id)),
      terrainContext: input.landcoverClass
        ? { landcoverClass: input.landcoverClass, confidence: "high" as const }
        : undefined,
    };
    edges.set(forwardId, { ...base, id: forwardId, from: input.from, to: input.to });
    edges.set(backwardId, { ...base, id: backwardId, from: input.to, to: input.from });
    nodes.get(input.from)!.edges.push(forwardId);
    nodes.get(input.to)!.edges.push(backwardId);
  }

  return {
    center: { lat: 49.141, lng: -0.501 },
    nodes,
    edges,
  };
}

function hashCode(value: string): number {
  return value.split("").reduce((hash, char) => ((hash << 5) - hash + char.charCodeAt(0)) | 0, 0);
}
