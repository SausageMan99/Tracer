import { describe, expect, it } from "vitest";
import { selectStartNodeTopologyAware } from "@/lib/engine";
import type { EnrichedGraph, GraphNode } from "@/lib/types";

function node(id: string, lat: number, lng: number, degree: number): GraphNode {
  return {
    id,
    lat,
    lng,
    edges: Array.from({ length: degree }, (_, index) => `${id}-edge-${index}`),
  };
}

function graph(nodes: GraphNode[]): EnrichedGraph {
  return {
    nodes: new Map(nodes.map((entry) => [entry.id, entry])),
    edges: new Map(),
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
});
