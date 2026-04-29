import { describe, expect, it, vi } from "vitest";
import type { EnrichedEdge, EnrichedGraph, GraphNode, SessionProfile } from "@/lib/types";
import { deriveWeights, scoreEdges } from "@/lib/engine/edge-scorer";
import { PROFILES_BY_ID } from "@/lib/session-profiles";

describe("deriveWeights", () => {
  it("returns weights that sum to 1", () => {
    for (const profile of PROFILES_BY_ID.values()) {
      const w = deriveWeights(profile);
      const sum = w.surface + w.elevation + w.nature + w.quietness;
      expect(sum).toBeCloseTo(1.0, 5);
    }
  });

  it("returns weights summing to 1 in scenic mode", () => {
    for (const profile of PROFILES_BY_ID.values()) {
      const w = deriveWeights(profile, true);
      const sum = w.surface + w.elevation + w.nature + w.quietness;
      expect(sum).toBeCloseTo(1.0, 5);
    }
  });

  it("scenic mode boosts nature weight", () => {
    const profile = PROFILES_BY_ID.get("running_endurance")!;
    const normal = deriveWeights(profile, false);
    const scenic = deriveWeights(profile, true);
    expect(scenic.nature).toBeGreaterThan(normal.nature);
  });

  it("intervals profile reduces elevation weight", () => {
    const profile = PROFILES_BY_ID.get("running_intervals")!;
    const w = deriveWeights(profile);
    expect(w.elevation).toBeLessThan(0.1);
  });

  it("gran fondo profile increases elevation weight", () => {
    const profile = PROFILES_BY_ID.get("cycling_road_gran_fondo")!;
    const w = deriveWeights(profile);
    expect(w.elevation).toBeGreaterThan(0.2);
  });

  it("does not mutate the profile object", () => {
    const profile = PROFILES_BY_ID.get("running_endurance")!;
    const before = JSON.stringify(profile);
    deriveWeights(profile, true);
    expect(JSON.stringify(profile)).toBe(before);
  });
});

function makeDenseGraph(nodeCount: number): EnrichedGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, EnrichedEdge>();

  for (let i = 0; i < nodeCount; i++) {
    const id = String(i);
    nodes.set(id, { id, lat: 48.87 + i * 0.000001, lng: 2.32, edges: [] });
  }

  for (let i = 0; i < nodeCount - 1; i++) {
    const id = `${i}-${i + 1}-1`;
    edges.set(id, {
      id,
      from: String(i),
      to: String(i + 1),
      lengthKm: 0.01,
      highway: "footway",
      osmWayId: 1,
      score: 0,
    });
    nodes.get(String(i))!.edges.push(id);
  }

  return { nodes, edges, center: { lat: 48.87, lng: 2.32 }, radiusKm: 3 };
}

const denseGraphProfile = {
  sport: "running",
  sessionType: "seuil_lactique",
} as SessionProfile;

describe("scoreEdges dense graphs", () => {
  it("does not request elevation for every OSM node in dense city graphs", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ elevation: Array.from({ length: 100 }, () => 35) }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await scoreEdges(
      makeDenseGraph(25_000),
      { surface: 0.3, elevation: 0.1, nature: 0.2, quietness: 0.4 },
      denseGraphProfile,
      new Set()
    );

    const requestedCoordinates = fetchMock.mock.calls.reduce((total, call) => {
      const url = new URL(String(call[0]));
      return total + (url.searchParams.get("latitude")?.split(",").length ?? 0);
    }, 0);

    expect(requestedCoordinates).toBeLessThanOrEqual(1_000);
  });
});
