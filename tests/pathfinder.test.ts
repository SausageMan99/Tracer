import { describe, expect, it } from "vitest";
import { findShortestPath } from "@/lib/engine/pathfinder";
import type { EnrichedEdge, EnrichedGraph, GraphNode } from "@/lib/types";

function makeNode(id: string): GraphNode {
  return { id, lat: 49, lng: -0.5, edges: [] };
}

function addEdge(
  graph: EnrichedGraph,
  id: string,
  from: string,
  to: string,
  lengthKm: number,
  osmWayId: number
): void {
  const edge: EnrichedEdge = {
    id,
    from,
    to,
    lengthKm,
    highway: "path",
    osmWayId,
    score: 0.8,
  };
  graph.edges.set(id, edge);
  graph.nodes.get(from)!.edges.push(id);
}

describe("findShortestPath overlap controls", () => {
  it("avoids forbidden undirected edges when closing a loop", () => {
    const graph: EnrichedGraph = {
      nodes: new Map([
        ["start", makeNode("start")],
        ["a", makeNode("a")],
        ["b", makeNode("b")],
        ["c", makeNode("c")],
      ]),
      edges: new Map(),
      center: { lat: 49, lng: -0.5 },
      radiusKm: 2,
    };

    addEdge(graph, "a-start-short", "a", "start", 1, 10);
    addEdge(graph, "a-b", "a", "b", 1.2, 20);
    addEdge(graph, "b-c", "b", "c", 1.2, 30);
    addEdge(graph, "c-start", "c", "start", 1.2, 40);

    const unrestricted = findShortestPath(graph, "a", "start");
    expect(unrestricted?.edgeIds).toEqual(["a-start-short"]);

    const clean = findShortestPath(graph, "a", "start", {
      forbiddenUndirectedEdgeKeys: new Set(["a-start-10"]),
    });

    expect(clean?.edgeIds).toEqual(["a-b", "b-c", "c-start"]);
  });
});
