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

  it("trail running boosts nature weight above normal running", () => {
    const trail = PROFILES_BY_ID.get("running_trail")!;
    const endurance = PROFILES_BY_ID.get("running_endurance")!;
    const trailW = deriveWeights(trail, false);
    const enduranceW = deriveWeights(endurance, false);
    expect(trailW.nature).toBeGreaterThan(enduranceW.nature);
  });

  it("trail running reduces surface weight vs normal running", () => {
    const trail = PROFILES_BY_ID.get("running_trail")!;
    const endurance = PROFILES_BY_ID.get("running_endurance")!;
    const trailW = deriveWeights(trail, false);
    const enduranceW = deriveWeights(endurance, false);
    expect(trailW.surface).toBeLessThan(enduranceW.surface);
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

// Helper to build a minimal graph with a single edge for surface/nature tests
function makeSingleEdgeGraph(edge: Partial<EnrichedEdge>): EnrichedGraph {
  const nodes = new Map<string, GraphNode>();
  nodes.set("1", { id: "1", lat: 48.87, lng: 2.32, edges: ["1-2-10"] });
  nodes.set("2", { id: "2", lat: 48.871, lng: 2.321, edges: [] });
  const e: EnrichedEdge = {
    id: "1-2-10",
    from: "1",
    to: "2",
    lengthKm: 0.1,
    highway: edge.highway ?? "footway",
    surface: edge.surface,
    osmWayId: edge.osmWayId ?? 10,
    score: 0,
    access: edge.access,
    foot: edge.foot,
    scenic: edge.scenic,
  };
  const edges = new Map<string, EnrichedEdge>([[e.id, e]]);
  return { nodes, edges, center: { lat: 48.87, lng: 2.32 }, radiusKm: 1 };
}

function makeCorridorVsIsolatedGraph(): EnrichedGraph {
  const nodes = new Map<string, GraphNode>();
  nodes.set("a", { id: "a", lat: 48.87, lng: 2.32, edges: ["ab", "ad"] });
  nodes.set("b", { id: "b", lat: 48.871, lng: 2.321, edges: ["bc"] });
  nodes.set("c", { id: "c", lat: 48.872, lng: 2.322, edges: [] });
  nodes.set("d", { id: "d", lat: 48.871, lng: 2.319, edges: [] });

  const edges = new Map<string, EnrichedEdge>([
    ["ab", { id: "ab", from: "a", to: "b", lengthKm: 0.5, highway: "path", surface: "dirt", osmWayId: 20, score: 0 }],
    ["bc", { id: "bc", from: "b", to: "c", lengthKm: 0.5, highway: "path", surface: "dirt", osmWayId: 21, score: 0 }],
    ["ad", { id: "ad", from: "a", to: "d", lengthKm: 0.5, highway: "path", surface: "dirt", osmWayId: 22, score: 0 }],
  ]);

  return { nodes, edges, center: { lat: 48.87, lng: 2.32 }, radiusKm: 1 };
}

describe("scoreEdges natural corridor continuity", () => {
  it("scores an edge leading into a natural corridor higher than an isolated trail fragment", async () => {
    const trailProfile = PROFILES_BY_ID.get("running_trail")!;
    const weights = deriveWeights(trailProfile, false);
    const graph = makeCorridorVsIsolatedGraph();

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ elevation: [35, 35, 35, 35] }), { status: 200 })
    ));

    await scoreEdges(graph, weights, trailProfile, new Set());

    expect(graph.edges.get("ab")!.score).toBeGreaterThan(graph.edges.get("ad")!.score);
  });
});

describe("scoreEdges trail running surface preferences", () => {
  it("prefers unpaved surfaces for trail running", async () => {
    const trailProfile = PROFILES_BY_ID.get("running_trail")!;
    const weights = deriveWeights(trailProfile, false);

    const gDirt = makeSingleEdgeGraph({ highway: "path", surface: "dirt", osmWayId: 1 });
    const gAsphalt = makeSingleEdgeGraph({ highway: "tertiary", surface: "asphalt", osmWayId: 2 });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ elevation: [35, 36] }), { status: 200 })
    ));

    await scoreEdges(gDirt, weights, trailProfile, new Set());
    await scoreEdges(gAsphalt, weights, trailProfile, new Set());

    const dirtScore = gDirt.edges.get("1-2-10")!.score;
    const asphaltScore = gAsphalt.edges.get("1-2-10")!.score;

    expect(dirtScore).toBeGreaterThan(asphaltScore);
  });

  it("prefers paths and tracks for trail running over roads", async () => {
    const trailProfile = PROFILES_BY_ID.get("running_trail")!;
    const weights = deriveWeights(trailProfile, false);

    const gPath = makeSingleEdgeGraph({ highway: "path", surface: "dirt", osmWayId: 1 });
    const gRoad = makeSingleEdgeGraph({ highway: "primary", surface: "asphalt", osmWayId: 2 });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ elevation: [35, 36] }), { status: 200 })
    ));

    await scoreEdges(gPath, weights, trailProfile, new Set());
    await scoreEdges(gRoad, weights, trailProfile, new Set());

    const pathScore = gPath.edges.get("1-2-10")!.score;
    const roadScore = gRoad.edges.get("1-2-10")!.score;

    expect(pathScore).toBeGreaterThan(roadScore);
  });

  it("scores unknown-surface scenic paths as strong trail candidates", async () => {
    const trailProfile = PROFILES_BY_ID.get("running_trail")!;
    const weights = deriveWeights(trailProfile, false);
    const graph = makeSingleEdgeGraph({ highway: "path", scenic: true, osmWayId: 3 });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ elevation: [35, 36] }), { status: 200 })
    ));

    await scoreEdges(graph, weights, trailProfile, new Set());

    expect(graph.edges.get("1-2-10")!.score).toBeGreaterThan(0.91);
  });

  it("normal running still prefers paved over unpaved (no regression)", async () => {
    const endurance = PROFILES_BY_ID.get("running_endurance")!;
    const weights = deriveWeights(endurance, false);

    const gDirt = makeSingleEdgeGraph({ highway: "path", surface: "dirt", osmWayId: 1 });
    const gAsphalt = makeSingleEdgeGraph({ highway: "tertiary", surface: "asphalt", osmWayId: 2 });

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ elevation: [35, 36] }), { status: 200 })
    ));

    await scoreEdges(gDirt, weights, endurance, new Set());
    await scoreEdges(gAsphalt, weights, endurance, new Set());

    const dirtScore = gDirt.edges.get("1-2-10")!.score;
    const asphaltScore = gAsphalt.edges.get("1-2-10")!.score;

    expect(asphaltScore).toBeGreaterThan(dirtScore);
  });
});
