import { beforeEach, describe, expect, it, vi } from "vitest";
import type { EnrichedGraph, RouteCandidate, SolverPath } from "@/lib/types";

const mocks = vi.hoisted(() => ({
  geocodeAddress: vi.fn(),
  haversineKm: vi.fn(),
  buildGraph: vi.fn(),
  deriveWeights: vi.fn(),
  scoreEdges: vi.fn(),
  solve: vi.fn(),
  postProcess: vi.fn(),
  auditTerrainData: vi.fn(),
  planRouteIntent: vi.fn(),
  isBetaStableCandidate: vi.fn(),
  rejectionSubCodeForCandidate: vi.fn(),
  buildRejectedCandidatesDiagnostics: vi.fn(),
  distanceAcceptanceForCandidate: vi.fn(),
}));

vi.mock("@/lib/route-generator-legacy", () => ({
  geocodeAddress: mocks.geocodeAddress,
  haversineKm: mocks.haversineKm,
}));

vi.mock("@/lib/engine/graph-builder", () => ({
  buildGraph: mocks.buildGraph,
}));

vi.mock("@/lib/engine/edge-scorer", () => ({
  deriveWeights: mocks.deriveWeights,
  scoreEdges: mocks.scoreEdges,
}));

vi.mock("@/lib/engine/orienteering-solver", () => ({
  solve: mocks.solve,
}));

vi.mock("@/lib/engine/route-post-processor", () => ({
  postProcess: mocks.postProcess,
}));

vi.mock("@/lib/engine/terrain-audit", () => ({
  auditTerrainData: mocks.auditTerrainData,
}));

vi.mock("@/lib/engine/terrain-planner", () => ({
  planRouteIntent: mocks.planRouteIntent,
}));

vi.mock("@/lib/engine/route-gate-selector", () => ({
  isBetaStableCandidate: mocks.isBetaStableCandidate,
  rejectionSubCodeForCandidate: mocks.rejectionSubCodeForCandidate,
  buildRejectedCandidatesDiagnostics: mocks.buildRejectedCandidatesDiagnostics,
  distanceAcceptanceForCandidate: mocks.distanceAcceptanceForCandidate,
}));

function tinyGraph(): EnrichedGraph {
  const graph = {
    nodes: new Map(),
    edges: new Map(),
  } as unknown as EnrichedGraph;
  graph.nodes.set("start", { id: "start", lat: 48.4, lng: 2.7, edges: ["edge-1"] });
  graph.edges.set("edge-1", {
    id: "edge-1",
    from: "start",
    to: "start",
    score: 1,
    lengthKm: 1,
    highway: "path",
    osmWayId: 1,
  });
  return graph;
}

function strictTrailIntent() {
  return {
    type: "forest_loop",
    strategy: "forest_loop",
    targetDistanceKm: 15,
    targetElevationM: 300,
    targetComponents: [],
    distancePolicy: { mode: "strict" },
    maxPavedRatio: 0.22,
    maxBusyRoadRatio: 0.08,
    maxRepeatEdgeRatio: 0.06,
    maxGeometryOverlapRatio: 0.18,
    cleanReturnMode: "fallback_allowed",
    timeBudgetMs: 4500,
    beamBudget: { beamWidth: 20, maxIterations: 300, shortlistSize: 12 },
    relaxationOrder: [],
    userWarningsIfRelaxed: [],
    terrainComponents: [],
  };
}

describe("generateRouteV2 failure stage timings", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();

    mocks.geocodeAddress.mockResolvedValue({ lat: 48.402, lng: 2.699 });
    mocks.haversineKm.mockReturnValue(0.01);
    mocks.buildGraph.mockResolvedValue({ graph: tinyGraph(), scenicWayIds: new Set(["woods-way"]) });
    mocks.deriveWeights.mockReturnValue({});
    mocks.scoreEdges.mockResolvedValue({ nodeElevation: new Map([["start", 80]]) });
    mocks.solve.mockReturnValue([{
      nodeIds: ["start"],
      edgeIds: ["edge-1"],
      totalScore: 1,
      distanceKm: 15,
    }] satisfies SolverPath[]);
    mocks.postProcess.mockResolvedValue([
      {
        distanceKm: 15,
        ascendM: 280,
        quality: { warnings: [] } as unknown as RouteCandidate["quality"],
      },
    ] as unknown as RouteCandidate[]);
    mocks.auditTerrainData.mockReturnValue({});
    mocks.planRouteIntent.mockReturnValue(strictTrailIntent());
    mocks.isBetaStableCandidate.mockReturnValue(false);
    mocks.rejectionSubCodeForCandidate.mockReturnValue("TRAIL_PROMISE_UNMET");
    mocks.buildRejectedCandidatesDiagnostics.mockReturnValue({
      subCode: "TRAIL_PROMISE_UNMET",
      candidateCount: 1,
      selectedCandidateIndex: 0,
      topCandidateIndex: 0,
      rejectionReasonsHistogram: { trail_promise_unmet: 1 },
      topCandidates: [],
    });
    mocks.distanceAcceptanceForCandidate.mockReturnValue("exact");
  });

  it("attaches stage timings to beta-stability rejected-candidates errors", async () => {
    const { generateRouteV2 } = await import("@/lib/engine");
    const now = vi.fn()
      .mockReturnValueOnce(0)
      .mockReturnValueOnce(10)
      .mockReturnValueOnce(20)
      .mockReturnValueOnce(35)
      .mockReturnValueOnce(50)
      .mockReturnValueOnce(70)
      .mockReturnValueOnce(90)
      .mockReturnValueOnce(120)
      .mockReturnValueOnce(150)
      .mockReturnValueOnce(190)
      .mockReturnValueOnce(240)
      .mockReturnValueOnce(300)
      .mockReturnValueOnce(370)
      .mockReturnValueOnce(450)
      .mockReturnValueOnce(540)
      .mockReturnValueOnce(640)
      .mockReturnValueOnce(750)
      .mockReturnValueOnce(870)
      .mockReturnValue(1_000);

    await expect(generateRouteV2({
      address: "Château de Fontainebleau, Fontainebleau",
      profileId: "running_trail",
      targetDistanceKm: 15,
      targetElevationM: 300,
      scenicMode: true,
    }, {
      includeGenerationDiagnostics: true,
      now,
    })).rejects.toMatchObject({
      code: "ROUTE_CANDIDATES_REJECTED",
      subCode: "TRAIL_PROMISE_UNMET",
      stageTimings: {
        totalMs: expect.any(Number),
        stages: expect.arrayContaining([
          expect.objectContaining({ stage: "solver.solve", ok: true }),
          expect.objectContaining({ stage: "postProcess.candidates", ok: true }),
          expect.objectContaining({ stage: "guards.betaStability", ok: false, errorCode: "ROUTE_CANDIDATES_REJECTED" }),
          expect.objectContaining({ stage: "total", ok: false, errorCode: "ROUTE_CANDIDATES_REJECTED" }),
        ]),
      },
    });
  });
});
