import { describe, expect, it } from "vitest";
import type { EnrichedEdge, EnrichedGraph, GraphNode } from "@/lib/types";
import { buildTerrainInventoryV3 } from "@/lib/engine-v3/assemblers/terrain-inventory";
import { generateRouteV3FromGraph } from "@/lib/engine-v3/route-generator";

function node(id: string, index: number): GraphNode {
  return { id, lat: 48.4 + index * 0.001, lng: 2.7 + index * 0.001, edges: [] };
}

function edge(
  id: string,
  from: string,
  to: string,
  lengthKm: number,
  surface: string,
  highway = "path",
  landcoverClass: "forest" | "urban" | null = "forest",
): EnrichedEdge {
  return {
    id,
    from,
    to,
    lengthKm,
    surface,
    highway,
    scenic: landcoverClass === "forest",
    osmWayId: Math.abs([...id].reduce((sum, char) => sum + char.charCodeAt(0), 0)),
    score: surface === "asphalt" ? 0.2 : 0.9,
    terrainContext: landcoverClass
      ? {
          source: "ign_poc_fixture",
          landcoverClass,
          naturalContextScore: landcoverClass === "forest" ? 0.9 : 0.1,
          artificializationScore: landcoverClass === "urban" ? 0.9 : 0.1,
          confidence: "high",
          warnings: [],
        }
      : undefined,
  };
}

function graph(edges: EnrichedEdge[]): EnrichedGraph {
  const nodeIds = Array.from(new Set(edges.flatMap((candidate) => [candidate.from, candidate.to])));
  const nodes = new Map<string, GraphNode>(nodeIds.map((id, index) => [id, node(id, index)]));
  for (const candidate of edges) {
    nodes.get(candidate.from)?.edges.push(candidate.id);
    nodes.get(candidate.to)?.edges.push(candidate.id);
  }
  return {
    nodes,
    edges: new Map(edges.map((candidate) => [candidate.id, candidate])),
    center: { lat: 48.4, lng: 2.7 },
    radiusKm: 3,
  };
}

describe("buildTerrainInventoryV3", () => {
  it("classifies a natural tree as reachable but not loopable capacity", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "service", "urban"),
      edge("trunk", "a", "b", 1.2, "ground"),
      edge("branch-1", "b", "c", 1.1, "earth"),
      edge("branch-2", "b", "d", 0.9, "dirt"),
    ]);

    const inventory = buildTerrainInventoryV3({
      graph: fixture,
      startNodeId: "s",
      targetComponentIds: ["forest"],
    });

    expect(inventory.reachableNonPavedKm).toBeCloseTo(3.2, 3);
    expect(inventory.components).toHaveLength(1);
    expect(inventory.components[0]).toMatchObject({
      twoCoreKm: 0,
      bridgeKm: 3.2,
      deadEndKm: 3.2,
      cycleRank: 0,
      bridgeCount: 3,
      articulationCount: 1,
      estimatedLoopableNaturalKm: 0,
      bestNaturalSkeletonKm: 0,
    });
  });

  it("measures two-core loopable capacity separately from bridge and dead-end natural km", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.4, "asphalt", "service", "urban"),
      edge("portal-bridge", "a", "b", 0.8, "ground"),
      edge("loop-1", "b", "c", 1.0, "ground"),
      edge("loop-2", "c", "d", 1.0, "earth"),
      edge("loop-3", "d", "b", 1.0, "dirt"),
      edge("dead-end", "c", "leaf", 0.7, "ground"),
    ]);

    const inventory = buildTerrainInventoryV3({
      graph: fixture,
      startNodeId: "s",
      targetComponentIds: ["forest"],
    });
    const component = inventory.components[0];

    expect(component.reachableNonPavedKm).toBeCloseTo(4.5, 3);
    expect(component.twoCoreKm).toBeCloseTo(3.0, 3);
    expect(component.bridgeKm).toBeCloseTo(1.5, 3);
    expect(component.deadEndKm).toBeCloseTo(1.5, 3);
    expect(component.cycleRank).toBe(1);
    expect(component.portalToCoreKm).toBeCloseTo(0.8, 3);
    expect(component.accessPavedKm).toBeCloseTo(0.4, 3);
    expect(component.estimatedClosureCostKm).toBeCloseTo(1.2, 3);
    expect(component.estimatedLoopableNaturalKm).toBeCloseTo(3.0, 3);
    expect(component.bestNaturalSkeletonKm).toBeCloseTo(3.0, 3);
  });

  it("ranks a farther portal to real two-core above a closer dead-end portal", () => {
    const fixture = graph([
      edge("bad-access", "s", "bad", 0.15, "asphalt", "service", "urban"),
      edge("bad-tree", "bad", "bad-leaf", 2.0, "ground"),
      edge("good-access", "s", "entry", 0.9, "asphalt", "service", "urban"),
      edge("good-portal", "entry", "a", 0.4, "ground"),
      edge("good-loop-1", "a", "b", 1.0, "ground"),
      edge("good-loop-2", "b", "c", 1.0, "earth"),
      edge("good-loop-3", "c", "a", 1.0, "dirt"),
    ]);

    const inventory = buildTerrainInventoryV3({
      graph: fixture,
      startNodeId: "s",
      targetComponentIds: ["forest"],
    });

    expect(inventory.components).toHaveLength(2);
    expect(inventory.components[0].componentId).toBe("terrain-component-2");
    expect(inventory.components[0].estimatedLoopableNaturalKm).toBeCloseTo(3.0, 3);
    expect(inventory.components[0].accessPavedKm).toBeCloseTo(0.9, 3);
    expect(inventory.components[1].componentId).toBe("terrain-component-1");
    expect(inventory.components[1].estimatedLoopableNaturalKm).toBe(0);
  });

  it("counts articulation and bridge structure in a lollipop component", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "service", "urban"),
      edge("stem", "a", "b", 0.6, "ground"),
      edge("cycle-1", "b", "c", 1.0, "ground"),
      edge("cycle-2", "c", "d", 1.0, "earth"),
      edge("cycle-3", "d", "b", 1.0, "dirt"),
      edge("tail", "d", "leaf", 0.5, "ground"),
    ]);

    const component = buildTerrainInventoryV3({
      graph: fixture,
      startNodeId: "s",
      targetComponentIds: ["forest"],
    }).components[0];

    expect(component.articulationCount).toBe(2);
    expect(component.bridgeCount).toBe(2);
    expect(component.bridgeKm).toBeCloseTo(1.1, 3);
    expect(component.twoCoreKm).toBeCloseTo(3.0, 3);
  });

  it("persists terrain inventory in graph-generation diagnostics without changing the route outcome", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "service", "urban"),
      edge("loop-1", "a", "b", 1.0, "ground"),
      edge("loop-2", "b", "c", 1.0, "earth"),
      edge("loop-3", "c", "a", 1.0, "dirt"),
    ]);

    const previous = process.env.TRAILFORGE_V3_TERRAIN_INVENTORY;
    process.env.TRAILFORGE_V3_TERRAIN_INVENTORY = "1";
    const generated = generateRouteV3FromGraph(
      { start: { lat: 48.4, lng: 2.7 }, targetDistanceKm: 5, mode: "trail" },
      fixture,
    );
    if (previous === undefined) delete process.env.TRAILFORGE_V3_TERRAIN_INVENTORY;
    else process.env.TRAILFORGE_V3_TERRAIN_INVENTORY = previous;

    expect(generated.diagnostics.terrainInventory).toMatchObject({
      scope: "forest_loop_observation_only",
      reachableNonPavedKm: 3,
      componentCount: 1,
    });
    expect(generated.diagnostics.terrainInventory?.components[0].twoCoreKm).toBeCloseTo(3, 3);
    expect(["generated", "adjusted", "refused"]).toContain(generated.outcome.type);
  });
});
