import { describe, expect, it } from "vitest";
import type { EnrichedEdge, EnrichedGraph, GraphNode } from "@/lib/types";
import { buildTerrainInventoryV3 } from "@/lib/engine-v3/assemblers/terrain-inventory";
import {
  buildForestLoopRouteContractV3,
  precheckForestLoopRouteContractV3,
} from "@/lib/engine-v3/contracts/route-contract";
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
    radiusKm: 4,
  };
}

function inventoryFor(fixture: EnrichedGraph) {
  return buildTerrainInventoryV3({
    graph: fixture,
    startNodeId: "s",
    targetComponentIds: ["forest"],
  });
}

describe("forest_loop RouteContract precheck", () => {
  it("marks a large close two-core forest component as generated plausible", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.3, "asphalt", "service", "urban"),
      edge("loop-1", "a", "b", 2.4, "ground"),
      edge("loop-2", "b", "c", 2.4, "earth"),
      edge("loop-3", "c", "d", 2.4, "dirt"),
      edge("loop-4", "d", "a", 2.4, "ground"),
    ]);

    const precheck = precheckForestLoopRouteContractV3({
      contract: buildForestLoopRouteContractV3({ requestedDistanceKm: 12, targetComponentIds: ["forest"] }),
      inventory: inventoryFor(fixture),
    });

    expect(precheck.status).toBe("generated_plausible");
    expect(precheck.violations).toEqual([]);
    expect(precheck.contract).toMatchObject({
      requestedDistanceKm: 12,
      generatedDistanceRangeKm: { min: 10.8, max: 13.2 },
      adjustedDistanceRangeKm: { min: 9, max: 15 },
      maxPavedRatio: 0.2,
      minNaturalWayRatio: 0.65,
      minNaturalDwellKm: 6.6,
      minTargetComponentDwellKm: 5.4,
      maxRepeatEdgeKm: 1.44,
      closurePolicy: { required: true, mode: "clean_loop" },
      accessTransitionBudget: { maxPavedKm: 1.44 },
    });
  });

  it("marks a smaller but loopable forest component as adjusted plausible with typed dwell violations", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.8, "asphalt", "service", "urban"),
      edge("loop-1", "a", "b", 1.5, "ground"),
      edge("loop-2", "b", "c", 1.5, "earth"),
      edge("loop-3", "c", "a", 1.5, "dirt"),
    ]);

    const precheck = precheckForestLoopRouteContractV3({
      contract: buildForestLoopRouteContractV3({ requestedDistanceKm: 12, targetComponentIds: ["forest"] }),
      inventory: inventoryFor(fixture),
    });

    expect(precheck.status).toBe("adjusted_plausible");
    expect(precheck.violations.map((violation) => violation.kind)).toEqual(["natural_dwell", "target_dwell"]);
    expect(precheck.reasons).toContain("loopable natural capacity is below generated forest_loop dwell contract but enough for adjusted route evidence");
  });

  it("refuses a natural tree with no loopable component instead of pretending trail capacity", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "service", "urban"),
      edge("trunk", "a", "b", 1.2, "ground"),
      edge("branch-1", "b", "c", 1.1, "earth"),
      edge("branch-2", "b", "d", 0.9, "dirt"),
    ]);

    const precheck = precheckForestLoopRouteContractV3({
      contract: buildForestLoopRouteContractV3({ requestedDistanceKm: 12, targetComponentIds: ["forest"] }),
      inventory: inventoryFor(fixture),
    });

    expect(precheck.status).toBe("refused_likely");
    expect(precheck.violations.map((violation) => violation.kind)).toContain("no_loopable_component");
    expect(precheck.violations.map((violation) => violation.kind)).toContain("closure");
  });

  it("persists route contract diagnostics next to terrain inventory for graph generation", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "service", "urban"),
      edge("loop-1", "a", "b", 1.5, "ground"),
      edge("loop-2", "b", "c", 1.5, "earth"),
      edge("loop-3", "c", "a", 1.5, "dirt"),
    ]);

    const previousInventory = process.env.TRAILFORGE_V3_TERRAIN_INVENTORY;
    const previousContract = process.env.TRAILFORGE_V3_ROUTE_CONTRACT;
    process.env.TRAILFORGE_V3_TERRAIN_INVENTORY = "1";
    process.env.TRAILFORGE_V3_ROUTE_CONTRACT = "1";
    const generated = generateRouteV3FromGraph(
      { start: { lat: 48.4, lng: 2.7 }, targetDistanceKm: 12, mode: "trail" },
      fixture,
    );
    if (previousInventory === undefined) delete process.env.TRAILFORGE_V3_TERRAIN_INVENTORY;
    else process.env.TRAILFORGE_V3_TERRAIN_INVENTORY = previousInventory;
    if (previousContract === undefined) delete process.env.TRAILFORGE_V3_ROUTE_CONTRACT;
    else process.env.TRAILFORGE_V3_ROUTE_CONTRACT = previousContract;

    expect(generated.diagnostics.terrainInventory?.scope).toBe("forest_loop_observation_only");
    expect(generated.diagnostics.routeContractPrecheck).toMatchObject({
      status: "adjusted_plausible",
      contract: { strategy: "forest_loop", requestedDistanceKm: 12 },
    });
  });
});
