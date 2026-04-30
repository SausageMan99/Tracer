import { describe, expect, it } from "vitest";
import type { EnrichedEdge, EnrichedGraph, GraphNode } from "@/lib/types";
import { solve } from "@/lib/engine/orienteering-solver";

function makeNode(id: string, lat: number, lng: number): GraphNode {
  return { id, lat, lng, edges: [] };
}

function addEdge(
  graph: EnrichedGraph,
  id: string,
  from: string,
  to: string,
  partial: Pick<EnrichedEdge, "highway" | "surface" | "score"> & Partial<EnrichedEdge>
): void {
  const edge: EnrichedEdge = {
    id,
    from,
    to,
    lengthKm: partial.lengthKm ?? 1,
    highway: partial.highway,
    surface: partial.surface,
    scenic: partial.scenic,
    osmWayId: partial.osmWayId ?? graph.edges.size + 1,
    score: partial.score,
  };
  graph.edges.set(id, edge);
  graph.nodes.get(from)!.edges.push(id);
}

function makeCorridorVsFragmentLoopGraph(): EnrichedGraph {
  const nodes = new Map<string, GraphNode>([
    ["start", makeNode("start", 49.14, -0.50)],
    ["wood-a", makeNode("wood-a", 49.145, -0.50)],
    ["wood-b", makeNode("wood-b", 49.145, -0.492)],
    ["wood-c", makeNode("wood-c", 49.14, -0.492)],
    ["fragment-a", makeNode("fragment-a", 49.135, -0.50)],
    ["road-b", makeNode("road-b", 49.135, -0.508)],
    ["road-c", makeNode("road-c", 49.14, -0.508)],
  ]);
  const graph: EnrichedGraph = {
    nodes,
    edges: new Map<string, EnrichedEdge>(),
    center: { lat: 49.14, lng: -0.50 },
    radiusKm: 2,
  };

  addEdge(graph, "start-wood-a", "start", "wood-a", {
    highway: "path",
    surface: "dirt",
    score: 0.62,
  });
  addEdge(graph, "wood-a-wood-b", "wood-a", "wood-b", {
    highway: "path",
    surface: "dirt",
    score: 0.62,
  });
  addEdge(graph, "wood-b-wood-c", "wood-b", "wood-c", {
    highway: "track",
    surface: "ground",
    score: 0.62,
  });
  addEdge(graph, "wood-c-start", "wood-c", "start", {
    highway: "path",
    surface: "dirt",
    score: 0.62,
  });

  addEdge(graph, "start-fragment-a", "start", "fragment-a", {
    highway: "path",
    surface: "dirt",
    score: 0.95,
  });
  addEdge(graph, "fragment-a-road-b", "fragment-a", "road-b", {
    highway: "residential",
    surface: "asphalt",
    score: 0.72,
  });
  addEdge(graph, "road-b-road-c", "road-b", "road-c", {
    highway: "residential",
    surface: "asphalt",
    score: 0.72,
  });
  addEdge(graph, "road-c-start", "road-c", "start", {
    highway: "residential",
    surface: "asphalt",
    score: 0.72,
  });

  return graph;
}

function makeDistantMassifVsLocalFragmentGraph(): EnrichedGraph {
  const nodes = new Map<string, GraphNode>([
    ["start", makeNode("start", 49.14, -0.50)],
    ["local-fragment", makeNode("local-fragment", 49.139, -0.501)],
    ["local-road-a", makeNode("local-road-a", 49.138, -0.502)],
    ["local-road-b", makeNode("local-road-b", 49.139, -0.504)],
    ["local-road-c", makeNode("local-road-c", 49.141, -0.504)],
    ["local-road-d", makeNode("local-road-d", 49.142, -0.502)],
    ["access-road", makeNode("access-road", 49.145, -0.500)],
    ["massif-a", makeNode("massif-a", 49.150, -0.500)],
    ["massif-b", makeNode("massif-b", 49.151, -0.492)],
    ["massif-c", makeNode("massif-c", 49.146, -0.488)],
    ["massif-d", makeNode("massif-d", 49.141, -0.492)],
  ]);
  const graph: EnrichedGraph = {
    nodes,
    edges: new Map<string, EnrichedEdge>(),
    center: { lat: 49.14, lng: -0.50 },
    radiusKm: 3,
  };

  addEdge(graph, "start-local-fragment", "start", "local-fragment", {
    highway: "path",
    surface: "dirt",
    score: 0.95,
  });
  addEdge(graph, "local-fragment-road-a", "local-fragment", "local-road-a", {
    highway: "residential",
    surface: "asphalt",
    score: 0.72,
  });
  addEdge(graph, "local-road-a-road-b", "local-road-a", "local-road-b", {
    highway: "residential",
    surface: "asphalt",
    score: 0.72,
  });
  addEdge(graph, "local-road-b-road-c", "local-road-b", "local-road-c", {
    highway: "residential",
    surface: "asphalt",
    score: 0.72,
  });
  addEdge(graph, "local-road-c-road-d", "local-road-c", "local-road-d", {
    highway: "residential",
    surface: "asphalt",
    score: 0.72,
  });
  addEdge(graph, "local-road-d-start", "local-road-d", "start", {
    highway: "residential",
    surface: "asphalt",
    score: 0.72,
  });

  addEdge(graph, "start-access-road", "start", "access-road", {
    highway: "residential",
    surface: "asphalt",
    score: 0.35,
  });
  addEdge(graph, "access-road-massif-a", "access-road", "massif-a", {
    highway: "track",
    surface: "ground",
    score: 0.58,
  });
  addEdge(graph, "massif-a-massif-b", "massif-a", "massif-b", {
    highway: "path",
    surface: "dirt",
    score: 0.58,
  });
  addEdge(graph, "massif-b-massif-c", "massif-b", "massif-c", {
    highway: "path",
    surface: "earth",
    score: 0.58,
  });
  addEdge(graph, "massif-c-massif-d", "massif-c", "massif-d", {
    highway: "track",
    surface: "ground",
    score: 0.58,
  });
  addEdge(graph, "massif-d-start", "massif-d", "start", {
    highway: "residential",
    surface: "asphalt",
    score: 0.35,
  });

  return graph;
}

function makePerimeterVsWoodEntryGraph(): EnrichedGraph {
  const nodes = new Map<string, GraphNode>([
    ["start", makeNode("start", 49.14, -0.50)],
    ["perimeter-a", makeNode("perimeter-a", 49.145, -0.505)],
    ["perimeter-b", makeNode("perimeter-b", 49.150, -0.500)],
    ["perimeter-c", makeNode("perimeter-c", 49.145, -0.495)],
    ["wood-gate", makeNode("wood-gate", 49.143, -0.500)],
    ["wood-a", makeNode("wood-a", 49.146, -0.499)],
    ["wood-b", makeNode("wood-b", 49.148, -0.496)],
    ["wood-c", makeNode("wood-c", 49.145, -0.493)],
    ["wood-exit", makeNode("wood-exit", 49.142, -0.496)],
  ]);
  const graph: EnrichedGraph = {
    nodes,
    edges: new Map<string, EnrichedEdge>(),
    center: { lat: 49.14, lng: -0.50 },
    radiusKm: 4,
  };

  addEdge(graph, "start-perimeter-a", "start", "perimeter-a", {
    highway: "residential",
    surface: "asphalt",
    score: 0.82,
    lengthKm: 2.5,
  });
  addEdge(graph, "perimeter-a-perimeter-b", "perimeter-a", "perimeter-b", {
    highway: "residential",
    surface: "asphalt",
    score: 0.82,
    lengthKm: 2.5,
  });
  addEdge(graph, "perimeter-b-perimeter-c", "perimeter-b", "perimeter-c", {
    highway: "residential",
    surface: "asphalt",
    score: 0.82,
    lengthKm: 2.5,
  });
  addEdge(graph, "perimeter-c-start", "perimeter-c", "start", {
    highway: "residential",
    surface: "asphalt",
    score: 0.82,
    lengthKm: 2.5,
  });

  addEdge(graph, "start-wood-gate", "start", "wood-gate", {
    highway: "residential",
    surface: "asphalt",
    score: 0.38,
    lengthKm: 2.2,
  });
  addEdge(graph, "wood-gate-wood-a", "wood-gate", "wood-a", {
    highway: "path",
    surface: "dirt",
    score: 0.68,
    lengthKm: 0.6,
  });
  addEdge(graph, "wood-a-wood-b", "wood-a", "wood-b", {
    highway: "path",
    surface: "ground",
    score: 0.68,
    lengthKm: 0.6,
  });
  addEdge(graph, "wood-b-wood-c", "wood-b", "wood-c", {
    highway: "track",
    surface: "earth",
    score: 0.68,
    lengthKm: 0.6,
  });
  addEdge(graph, "wood-c-wood-exit", "wood-c", "wood-exit", {
    highway: "path",
    surface: "dirt",
    score: 0.68,
    lengthKm: 0.6,
  });
  addEdge(graph, "wood-exit-start", "wood-exit", "start", {
    highway: "residential",
    surface: "asphalt",
    score: 0.38,
    lengthKm: 5.2,
  });

  return graph;
}

function makeUnknownSurfaceScenicCorridorVsRoadLoopGraph(): EnrichedGraph {
  const nodes = new Map<string, GraphNode>([
    ["start", makeNode("start", 49.14, -0.50)],
    ["road-a", makeNode("road-a", 49.145, -0.505)],
    ["road-b", makeNode("road-b", 49.150, -0.500)],
    ["road-c", makeNode("road-c", 49.145, -0.495)],
    ["scenic-a", makeNode("scenic-a", 49.143, -0.499)],
    ["scenic-b", makeNode("scenic-b", 49.146, -0.497)],
    ["scenic-c", makeNode("scenic-c", 49.148, -0.494)],
    ["scenic-d", makeNode("scenic-d", 49.144, -0.492)],
  ]);
  const graph: EnrichedGraph = {
    nodes,
    edges: new Map<string, EnrichedEdge>(),
    center: { lat: 49.14, lng: -0.50 },
    radiusKm: 3,
  };

  addEdge(graph, "start-road-a", "start", "road-a", {
    highway: "residential",
    surface: "asphalt",
    score: 0.84,
    lengthKm: 1.5,
  });
  addEdge(graph, "road-a-road-b", "road-a", "road-b", {
    highway: "residential",
    surface: "asphalt",
    score: 0.84,
    lengthKm: 1.5,
  });
  addEdge(graph, "road-b-road-c", "road-b", "road-c", {
    highway: "residential",
    surface: "asphalt",
    score: 0.84,
    lengthKm: 1.5,
  });
  addEdge(graph, "road-c-start", "road-c", "start", {
    highway: "residential",
    surface: "asphalt",
    score: 0.84,
    lengthKm: 1.5,
  });

  addEdge(graph, "start-scenic-a", "start", "scenic-a", {
    highway: "path",
    scenic: true,
    score: 0.62,
    lengthKm: 1.5,
  });
  addEdge(graph, "scenic-a-scenic-b", "scenic-a", "scenic-b", {
    highway: "path",
    scenic: true,
    score: 0.62,
    lengthKm: 1.5,
  });
  addEdge(graph, "scenic-b-scenic-c", "scenic-b", "scenic-c", {
    highway: "track",
    scenic: true,
    score: 0.62,
    lengthKm: 1.5,
  });
  addEdge(graph, "scenic-c-scenic-d", "scenic-c", "scenic-d", {
    highway: "path",
    scenic: true,
    score: 0.62,
    lengthKm: 0.8,
  });
  addEdge(graph, "scenic-d-start", "scenic-d", "start", {
    highway: "track",
    scenic: true,
    score: 0.62,
    lengthKm: 0.7,
  });

  return graph;
}

function makeMappedWoodRoadVsOpenRoadGraph(): EnrichedGraph {
  const nodes = new Map<string, GraphNode>([
    ["start", makeNode("start", 49.14, -0.50)],
    ["open-a", makeNode("open-a", 49.145, -0.505)],
    ["open-b", makeNode("open-b", 49.150, -0.500)],
    ["open-c", makeNode("open-c", 49.145, -0.495)],
    ["forest-gate", makeNode("forest-gate", 49.143, -0.500)],
    ["forest-a", makeNode("forest-a", 49.146, -0.499)],
    ["forest-b", makeNode("forest-b", 49.148, -0.496)],
    ["forest-c", makeNode("forest-c", 49.145, -0.493)],
    ["forest-exit", makeNode("forest-exit", 49.142, -0.496)],
  ]);
  const graph: EnrichedGraph = {
    nodes,
    edges: new Map<string, EnrichedEdge>(),
    center: { lat: 49.14, lng: -0.50 },
    radiusKm: 4,
  };

  addEdge(graph, "start-open-a", "start", "open-a", {
    highway: "residential",
    surface: "asphalt",
    score: 0.82,
    lengthKm: 2.5,
  });
  addEdge(graph, "open-a-open-b", "open-a", "open-b", {
    highway: "residential",
    surface: "asphalt",
    score: 0.82,
    lengthKm: 2.5,
  });
  addEdge(graph, "open-b-open-c", "open-b", "open-c", {
    highway: "residential",
    surface: "asphalt",
    score: 0.82,
    lengthKm: 2.5,
  });
  addEdge(graph, "open-c-start", "open-c", "start", {
    highway: "residential",
    surface: "asphalt",
    score: 0.82,
    lengthKm: 2.5,
  });

  addEdge(graph, "start-forest-gate", "start", "forest-gate", {
    highway: "residential",
    surface: "asphalt",
    score: 0.38,
    lengthKm: 2.2,
  });
  addEdge(graph, "forest-gate-forest-a", "forest-gate", "forest-a", {
    highway: "residential",
    surface: "asphalt",
    scenic: true,
    score: 0.62,
    lengthKm: 0.6,
  });
  addEdge(graph, "forest-a-forest-b", "forest-a", "forest-b", {
    highway: "unclassified",
    surface: "asphalt",
    scenic: true,
    score: 0.62,
    lengthKm: 0.6,
  });
  addEdge(graph, "forest-b-forest-c", "forest-b", "forest-c", {
    highway: "residential",
    surface: "asphalt",
    scenic: true,
    score: 0.62,
    lengthKm: 0.6,
  });
  addEdge(graph, "forest-c-forest-exit", "forest-c", "forest-exit", {
    highway: "unclassified",
    surface: "asphalt",
    scenic: true,
    score: 0.62,
    lengthKm: 0.6,
  });
  addEdge(graph, "forest-exit-start", "forest-exit", "start", {
    highway: "residential",
    surface: "asphalt",
    score: 0.38,
    lengthKm: 5.2,
  });

  return graph;
}

describe("solve natural corridor preference", () => {
  it("ranks a continuous natural corridor above a higher raw-score isolated trail fragment", async () => {
    const graph = makeCorridorVsFragmentLoopGraph();

    const paths = await solve(graph, "start", 4, 0, new Map());

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].edgeIds).toEqual([
      "start-wood-a",
      "wood-a-wood-b",
      "wood-b-wood-c",
      "wood-c-start",
    ]);
  });

  it("uses early access roads to aim at a large natural massif instead of grabbing a local trail fragment", async () => {
    const graph = makeDistantMassifVsLocalFragmentGraph();

    const paths = await solve(graph, "start", 6, 0, new Map());

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].edgeIds).toEqual([
      "start-access-road",
      "access-road-massif-a",
      "massif-a-massif-b",
      "massif-b-massif-c",
      "massif-c-massif-d",
      "massif-d-start",
    ]);
  });

  it("enters a real wood instead of drawing a clean road loop around it", async () => {
    const graph = makePerimeterVsWoodEntryGraph();

    const paths = await solve(graph, "start", 10, 0, new Map());

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].edgeIds).toEqual([
      "start-wood-gate",
      "wood-gate-wood-a",
      "wood-a-wood-b",
      "wood-b-wood-c",
      "wood-c-wood-exit",
      "wood-exit-start",
    ]);
  });

  it("keeps scenic path corridors without surface tags ahead of cleaner road loops", async () => {
    const graph = makeUnknownSurfaceScenicCorridorVsRoadLoopGraph();

    const paths = await solve(graph, "start", 6, 0, new Map());

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].edgeIds).toEqual([
      "start-scenic-a",
      "scenic-a-scenic-b",
      "scenic-b-scenic-c",
      "scenic-c-scenic-d",
      "scenic-d-start",
    ]);
  });

  it("treats roads through mapped woods as natural corridors when no dirt surface is tagged", async () => {
    const graph = makeMappedWoodRoadVsOpenRoadGraph();

    const paths = await solve(graph, "start", 10, 0, new Map());

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].edgeIds).toEqual([
      "start-forest-gate",
      "forest-gate-forest-a",
      "forest-a-forest-b",
      "forest-b-forest-c",
      "forest-c-forest-exit",
      "forest-exit-start",
    ]);
  });
});
