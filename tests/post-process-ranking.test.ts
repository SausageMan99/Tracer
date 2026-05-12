import { describe, expect, it } from "vitest";
import { postProcess } from "@/lib/engine/route-post-processor";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import type { RouteIntent } from "@/lib/engine/terrain-planner";
import type { Coordinate, EnrichedEdge, EnrichedGraph, GraphNode, SolverPath } from "@/lib/types";

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

function addPathFromCoordinates(
  graph: EnrichedGraph,
  prefix: string,
  coordinates: Coordinate[],
  osmWayIdBase: number,
  edgeLengthKm: number
): SolverPath {
  const nodeIds = coordinates.map((_, index) => `${prefix}-${index}`);
  const edgeIds: string[] = [];

  coordinates.forEach((coordinate, index) => {
    graph.nodes.set(`${prefix}-${index}`, {
      id: `${prefix}-${index}`,
      lat: coordinate.lat,
      lng: coordinate.lng,
      edges: index < coordinates.length - 1 ? [`${prefix}-${index}-${index + 1}`] : [],
    });
  });

  for (let index = 0; index < coordinates.length - 1; index += 1) {
    const id = `${prefix}-${index}-${index + 1}`;
    edgeIds.push(id);
    graph.edges.set(id, {
      id,
      from: `${prefix}-${index}`,
      to: `${prefix}-${index + 1}`,
      lengthKm: edgeLengthKm,
      highway: "path",
      surface: "ground",
      osmWayId: osmWayIdBase + index,
      score: 0.8,
    });
  }

  return {
    nodeIds,
    edgeIds,
    distanceKm: edgeIds.length * edgeLengthKm,
    totalScore: 100,
  };
}

function transitionToWoodsIntent(overrides: Partial<RouteIntent> = {}): RouteIntent {
  return {
    type: "transition_to_woods",
    strategy: "transition_to_woods",
    targetDistanceKm: 15,
    targetElevationM: 0,
    targetComponents: [],
    distancePolicy: { mode: "strict" },
    maxPavedRatio: 0.42,
    maxBusyRoadRatio: 0.08,
    maxRepeatEdgeRatio: 0.04,
    maxGeometryOverlapRatio: 0.12,
    cleanReturnMode: "prefer",
    timeBudgetMs: 4500,
    beamBudget: { beamWidth: 20, maxIterations: 300, shortlistSize: 12 },
    relaxationOrder: [],
    userWarningsIfRelaxed: [],
    terrainComponents: [],
    ...overrides,
  };
}

const profile = PROFILES_BY_ID.get("running_endurance")!;

describe("postProcess candidate ranking", () => {
  it("builds display geometry from traversed edges instead of a simplified node path", async () => {
    const graph = makeChainGraph(3);
    const nodeElevation = new Map(Array.from(graph.nodes.keys()).map((id) => [id, 100]));
    const path: SolverPath = {
      nodeIds: ["0", "3"],
      edgeIds: ["0-1", "1-2", "2-3"],
      distanceKm: 3,
      totalScore: 10,
    };

    const candidates = await postProcess(
      [path],
      graph,
      { lat: 48.8, lng: 2.3 },
      profile,
      3,
      0,
      nodeElevation
    );

    expect(candidates[0].geometry.coordinates).toEqual(
      [0, 1, 2, 3].map((i) => [2.3 + i * 0.001, 48.8])
    );
  });

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

  it("downgrades trail loops with overlapping backtracking even when their raw score is higher", async () => {
    const graph = makeChainGraph(20);
    const trailProfile = PROFILES_BY_ID.get("running_trail")!;
    const nodeElevation = new Map(Array.from(graph.nodes.keys()).map((id) => [id, 100]));
    const cleanTrailPath: SolverPath = {
      nodeIds: Array.from({ length: 12 }, (_, i) => String(i)),
      edgeIds: Array.from({ length: 11 }, (_, i) => `${i}-${i + 1}`),
      distanceKm: 11,
      totalScore: 70,
    };
    const overlappingPath: SolverPath = {
      nodeIds: ["0", "1", "2", "3", "4", "5", "6", "7", "8", "9", "10", "1"],
      edgeIds: ["0-1", "1-2", "2-3", "3-4", "4-5", "5-6", "6-7", "7-8", "8-9", "9-10", "0-1"],
      distanceKm: 11,
      totalScore: 120,
    };

    const candidates = await postProcess(
      [overlappingPath, cleanTrailPath],
      graph,
      { lat: 48.8, lng: 2.3 },
      trailProfile,
      11,
      0,
      nodeElevation
    );

    expect(candidates[0].quality?.repeatEdgeRatio).toBeLessThan(0.08);
  });

  it("prefers an elevation-compliant trail candidate over a flat raw-score winner when benchmark D+ would fail", async () => {
    const graph = makeChainGraph(80);
    const trailProfile = PROFILES_BY_ID.get("running_trail")!;
    const nodeElevation = new Map<string, number>();

    for (const id of graph.nodes.keys()) {
      const numericId = Number(id);
      nodeElevation.set(id, numericId >= 20 && numericId <= 28 ? 100 + (numericId - 20) * 15 : 100);
    }

    const flatHighScorePath: SolverPath = {
      ...makePath(8, 0),
      totalScore: 100,
    };
    const elevationCompliantPath: SolverPath = {
      ...makePath(8, 20),
      totalScore: 85,
    };

    const candidates = await postProcess(
      [flatHighScorePath, elevationCompliantPath],
      graph,
      { lat: 48.8, lng: 2.3 },
      trailProfile,
      8,
      120,
      nodeElevation
    );

    expect(candidates[0].ascendM).toBeGreaterThanOrEqual(80);
    expect(candidates[0].quality?.elevationDiagnostics?.withinAbsoluteTolerance).toBe(true);
  });

  it("prefers a continuous non-paved trail over a higher raw-score scenic paved corridor for trail runs", async () => {
    const nodes = new Map<string, GraphNode>();
    const edges = new Map<string, EnrichedEdge>();

    for (const prefix of ["trail", "paved"]) {
      for (let i = 0; i <= 10; i++) {
        const id = `${prefix}-${i}`;
        nodes.set(id, {
          id,
          lat: 48.8,
          lng: 2.3 + i * 0.001,
          edges: i < 10 ? [`${prefix}-${i}-${i + 1}`] : [],
        });
      }
    }

    for (let i = 0; i < 10; i++) {
      edges.set(`trail-${i}-${i + 1}`, {
        id: `trail-${i}-${i + 1}`,
        from: `trail-${i}`,
        to: `trail-${i + 1}`,
        lengthKm: 1,
        highway: "path",
        surface: "ground",
        osmWayId: 1000 + i,
        score: 0.2,
      });

      edges.set(`paved-${i}-${i + 1}`, {
        id: `paved-${i}-${i + 1}`,
        from: `paved-${i}`,
        to: `paved-${i + 1}`,
        lengthKm: 1,
        highway: "footway",
        surface: "asphalt",
        scenic: true,
        osmWayId: 2000 + i,
        score: 4,
      });
    }

    const graph: EnrichedGraph = {
      nodes,
      edges,
      center: { lat: 48.8, lng: 2.3 },
      radiusKm: 2,
    };
    const trailProfile = PROFILES_BY_ID.get("running_trail")!;
    const nodeElevation = new Map(Array.from(nodes.keys()).map((id) => [id, 100]));

    const nonPavedTrailPath: SolverPath = {
      nodeIds: Array.from({ length: 11 }, (_, i) => `trail-${i}`),
      edgeIds: Array.from({ length: 10 }, (_, i) => `trail-${i}-${i + 1}`),
      distanceKm: 10,
      totalScore: 20,
    };
    const scenicPavedPath: SolverPath = {
      nodeIds: Array.from({ length: 11 }, (_, i) => `paved-${i}`),
      edgeIds: Array.from({ length: 10 }, (_, i) => `paved-${i}-${i + 1}`),
      distanceKm: 10,
      totalScore: 400,
    };

    const candidates = await postProcess(
      [scenicPavedPath, nonPavedTrailPath],
      graph,
      { lat: 48.8, lng: 2.3 },
      trailProfile,
      10,
      0,
      nodeElevation
    );

    expect(candidates[0].edgeDiagnostics?.map((edge) => edge.surface)).toEqual(
      Array(10).fill("ground")
    );
    expect(candidates[0].quality?.longestNonPavedTrailStreakKm).toBe(10);
    expect(candidates[0].quality?.pavedRatio).toBe(0);

    const scenicPavedCandidate = candidates.find((candidate) =>
      candidate.edgeDiagnostics?.every((edge) => edge.surface === "asphalt")
    );
    expect(scenicPavedCandidate?.quality?.scenicPavedRatio).toBe(1);
  });

  it("keeps a clean transition-to-woods trail candidate in the dense-graph shortlist ahead of higher-score self-intersecting paths", async () => {
    const graph: EnrichedGraph = {
      nodes: new Map(),
      edges: new Map(),
      center: { lat: 48.4, lng: 2.7 },
      radiusKm: 12,
    };
    const dirtyGeometry: Coordinate[] = [
      { lat: 48.400, lng: 2.700 },
      { lat: 48.420, lng: 2.720 },
      { lat: 48.400, lng: 2.720 },
      { lat: 48.420, lng: 2.700 },
      { lat: 48.410, lng: 2.695 },
      { lat: 48.410, lng: 2.725 },
    ];
    const cleanGeometry: Coordinate[] = [
      { lat: 48.400, lng: 2.700 },
      { lat: 48.405, lng: 2.705 },
      { lat: 48.410, lng: 2.710 },
      { lat: 48.415, lng: 2.715 },
      { lat: 48.420, lng: 2.720 },
      { lat: 48.425, lng: 2.725 },
    ];
    const dirtyPaths = Array.from({ length: 28 }, (_, index) => ({
      ...addPathFromCoordinates(graph, `dirty-${index}`, dirtyGeometry, 1000 + index * 10, 3),
      totalScore: 300 - index,
    }));
    const cleanPath = {
      ...addPathFromCoordinates(graph, "clean", cleanGeometry, 9000, 3),
      totalScore: 20,
    };

    // Force the transition-to-woods dense-graph cap to 28, matching the Fontainebleau artifact.
    while (graph.edges.size <= 1800) {
      const index = graph.edges.size;
      graph.edges.set(`filler-${index}`, {
        id: `filler-${index}`,
        from: "unused-a",
        to: "unused-b",
        lengthKm: 0.01,
        highway: "path",
        osmWayId: 50_000 + index,
        score: 0.1,
      });
    }

    const trailProfile = PROFILES_BY_ID.get("running_trail")!;
    const nodeElevation = new Map(Array.from(graph.nodes.keys()).map((id) => [id, 100]));

    const candidates = await postProcess(
      [...dirtyPaths, cleanPath],
      graph,
      { lat: 48.4, lng: 2.7 },
      trailProfile,
      15,
      0,
      nodeElevation,
      new Set(),
      transitionToWoodsIntent()
    );

    expect(candidates.some((candidate) =>
      candidate.edgeDiagnostics?.every((edge) => Number(edge.osmWayId) >= 9000)
    )).toBe(true);
  });
});
