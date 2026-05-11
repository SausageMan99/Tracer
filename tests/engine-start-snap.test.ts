import { describe, expect, it } from "vitest";
import { selectStartNodeTopologyAware } from "@/lib/engine";
import type { EnrichedEdge, EnrichedGraph, GraphNode } from "@/lib/types";

function node(id: string, lat: number, lng: number, degree: number): GraphNode {
  return {
    id,
    lat,
    lng,
    edges: Array.from({ length: degree }, (_, index) => `${id}-edge-${index}`),
  };
}

function edge(id: string, from: string, to: string, score: number): EnrichedEdge {
  return {
    id,
    from,
    to,
    lengthKm: 0.01,
    highway: "path",
    osmWayId: Number(id.replace(/\D/g, "")) || 1,
    score,
  };
}

function graph(nodes: GraphNode[], edges: EnrichedEdge[] = []): EnrichedGraph {
  return {
    nodes: new Map(nodes.map((entry) => [entry.id, entry])),
    edges: new Map(edges.map((entry) => [entry.id, entry])),
    center: { lat: 48.812, lng: 2.239 },
    radiusKm: 1.2,
  };
}

describe("topology-aware start snap", () => {
  it("prefers a nearby junction over the absolute closest spur", () => {
    const result = selectStartNodeTopologyAware(
      graph([
        node("closest-spur", 48.81203, 2.239, 2),
        node("nearby-junction", 48.81213, 2.239, 3),
        node("far-junction", 48.813, 2.239, 4),
      ]),
      { lat: 48.812, lng: 2.239 }
    );

    expect(result.closestNodeId).toBe("nearby-junction");
    expect(result.closestDist).toBeGreaterThan(0.01);
    expect(result.closestDist).toBeLessThan(0.02);
  });

  it("falls back to the absolute closest node when no nearby junction exists", () => {
    const result = selectStartNodeTopologyAware(
      graph([
        node("closest-spur", 48.81203, 2.239, 2),
        node("distant-junction", 48.813, 2.239, 3),
      ]),
      { lat: 48.812, lng: 2.239 }
    );

    expect(result.closestNodeId).toBe("closest-spur");
  });

  it("prefers a nearby junction with scored outgoing edges over a closer dead scored node", () => {
    const result = selectStartNodeTopologyAware(
      graph([
        { ...node("closest-dead-junction", 48.81203, 2.239, 3), edges: ["dead-1", "dead-2", "dead-3"] },
        { ...node("nearby-usable-junction", 48.81213, 2.239, 3), edges: ["usable-1", "usable-2", "usable-3"] },
      ], [
        edge("dead-1", "closest-dead-junction", "x", 0),
        edge("dead-2", "closest-dead-junction", "x", 0),
        edge("dead-3", "closest-dead-junction", "x", 0),
        edge("usable-1", "nearby-usable-junction", "y", 0.4),
        edge("usable-2", "nearby-usable-junction", "y", 0.5),
        edge("usable-3", "nearby-usable-junction", "y", 0.6),
      ]),
      { lat: 48.812, lng: 2.239 }
    );

    expect(result.closestNodeId).toBe("nearby-usable-junction");
  });
});
