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
});
