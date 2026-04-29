import { describe, expect, it } from "vitest";
import { postProcess } from "@/lib/engine/route-post-processor";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import type { EnrichedEdge, EnrichedGraph, GraphNode, SolverPath } from "@/lib/types";

function makeChainGraph(edgeCount: number): EnrichedGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, EnrichedEdge>();

  for (let i = 0; i <= edgeCount; i++) {
    nodes.set(String(i), { id: String(i), lat: 48.8, lng: 2.3 + i * 0.001, edges: [] });
  }

  for (let i = 0; i < edgeCount; i++) {
    const id = `${i}-${i + 1}`;
    edges.set(id, {
      id,
      from: String(i),
      to: String(i + 1),
      lengthKm: 1,
      highway: "footway",
      osmWayId: i + 1,
      score: 0.8,
    });
    nodes.get(String(i))!.edges.push(id);
  }

  return { nodes, edges, center: { lat: 48.8, lng: 2.3 }, radiusKm: 2 };
}

function makePath(distanceKm: number, offset: number): SolverPath {
  const edgeCount = Math.round(distanceKm);
  return {
    nodeIds: Array.from({ length: edgeCount + 1 }, (_, i) => String(offset + i)),
    edgeIds: Array.from({ length: edgeCount }, (_, i) => `${offset + i}-${offset + i + 1}`),
    distanceKm,
    totalScore: 100 - offset,
  };
}

const profile = PROFILES_BY_ID.get("running_endurance")!;

describe("postProcess candidate ranking", () => {
  it("does not discard a target-distance path just because six shorter paths have higher raw solver scores", async () => {
    const graph = makeChainGraph(80);
    const nodeElevation = new Map(Array.from(graph.nodes.keys()).map((id) => [id, 100]));
    const shortHighScorePaths = Array.from({ length: 6 }, (_, i) => makePath(8, i));
    const targetDistancePath = makePath(10, 20);

    const candidates = await postProcess(
      [...shortHighScorePaths, targetDistancePath],
      graph,
      { lat: 48.8, lng: 2.3 },
      profile,
      10,
      0,
      nodeElevation
    );

    expect(candidates.some((candidate) => candidate.distanceKm === 10)).toBe(true);
  });

  it("prefers low-ascent recovery routes when distance and surface are comparable", async () => {
    const graph = makeChainGraph(80);
    const recoveryProfile = PROFILES_BY_ID.get("running_recuperation")!;
    const nodeElevation = new Map<string, number>();

    for (const id of graph.nodes.keys()) {
      const numericId = Number(id);
      nodeElevation.set(id, numericId < 20 ? 100 + numericId * 40 : 100);
    }

    const highAscentPath = makePath(5, 0);
    const lowAscentPath = makePath(5, 30);

    const candidates = await postProcess(
      [highAscentPath, lowAscentPath],
      graph,
      { lat: 48.8, lng: 2.3 },
      recoveryProfile,
      5,
      20,
      nodeElevation
    );

    expect(candidates[0].ascendM).toBeLessThanOrEqual(60);
  });

  it("passes scenic OSM ways into quality scoring for park and canal routes", async () => {
    const graph = makeChainGraph(1);
    const edge = graph.edges.get("0-1")!;
    graph.edges.set("0-1", { ...edge, highway: "residential", osmWayId: 42 });
    const nodeElevation = new Map(Array.from(graph.nodes.keys()).map((id) => [id, 100]));

    const candidates = await postProcess(
      [makePath(1, 0)],
      graph,
      { lat: 48.8, lng: 2.3 },
      profile,
      1,
      0,
      nodeElevation,
      new Set(["42"])
    );

    expect(candidates[0].quality?.trailRatio).toBe(1);
  });
});
