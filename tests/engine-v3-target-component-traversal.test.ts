import { describe, expect, it } from "vitest";
import type { EnrichedEdge, EnrichedGraph, GraphNode } from "@/lib/types";
import { solveComponentLoopV3 } from "@/lib/engine-v3/assemblers/component-loop-solver";
import { contractNaturalGraphV3 } from "@/lib/engine-v3/assemblers/natural-graph-contraction";
import { buildOrderedCycleExpansionV3 } from "@/lib/engine-v3/assemblers/ordered-cycle-expansion";
import { planMultiCycleDwellV3 } from "@/lib/engine-v3/assemblers/multi-cycle-dwell-planner";
import { extractRankedNaturalCyclesV3 } from "@/lib/engine-v3/assemblers/ranked-natural-cycle-extractor";
import { buildTargetComponentTraversal } from "@/lib/engine-v3/assemblers/target-component-traversal";
import { selectTrailSpinesV3 } from "@/lib/engine-v3/assemblers/trail-spine-selector";
import { computeRouteMetricsV3 } from "@/lib/engine-v3/route-metrics";
import type { RouteEdgeV3, RouteSurfaceV3 } from "@/lib/engine-v3/types";

function node(id: string, index: number): GraphNode {
  return { id, lat: 49 + index * 0.001, lng: -0.6 - index * 0.001, edges: [] };
}

function edge(
  id: string,
  from: string,
  to: string,
  lengthKm: number,
  surface: string,
  highway: string,
  landcoverClass: "forest" | "urban" | null = surface === "asphalt"
    ? "urban"
    : "forest",
): EnrichedEdge {
  return {
    id,
    from,
    to,
    lengthKm,
    surface,
    highway,
    scenic: landcoverClass === "forest",
    osmWayId: Math.abs(
      [...id].reduce((sum, char) => sum + char.charCodeAt(0), 0),
    ),
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
  const nodeIds = Array.from(
    new Set(edges.flatMap((candidate) => [candidate.from, candidate.to])),
  );
  const nodes = new Map<string, GraphNode>(
    nodeIds.map((id, index) => [id, node(id, index)]),
  );
  for (const candidate of edges) {
    nodes.get(candidate.from)?.edges.push(candidate.id);
    nodes.get(candidate.to)?.edges.push(candidate.id);
  }
  return {
    nodes,
    edges: new Map(edges.map((candidate) => [candidate.id, candidate])),
    center: { lat: 49, lng: -0.6 },
    radiusKm: 2,
  };
}

function finalSurface(edge: EnrichedEdge): RouteSurfaceV3 {
  const surface = edge.surface?.toLowerCase() ?? "";
  if (
    [
      "asphalt",
      "concrete",
      "paved",
      "paving_stones",
      "sett",
      "cobblestone",
      "compacted",
    ].includes(surface)
  )
    return "paved";
  if (
    [
      "dirt",
      "earth",
      "grass",
      "ground",
      "gravel",
      "mud",
      "sand",
      "soil",
      "unpaved",
      "woodchips",
    ].includes(surface)
  )
    return "natural";
  return "mixed";
}

function finalMetricsFromResult(
  fixture: EnrichedGraph,
  edgeIds: string[],
  targetDistanceKm: number,
) {
  const routeEdges: RouteEdgeV3[] = edgeIds.map((edgeId) => {
    const candidate = fixture.edges.get(edgeId);
    if (!candidate) throw new Error(`missing edge ${edgeId}`);
    const surface = finalSurface(candidate);
    return {
      id: candidate.id,
      from: candidate.from,
      to: candidate.to,
      lengthKm: candidate.lengthKm,
      surface,
      componentKind:
        surface === "paved" && candidate.scenic
          ? "scenic_paved"
          : "field_paths",
      highway: candidate.highway,
      osmWayId: candidate.osmWayId,
    };
  });
  return computeRouteMetricsV3({
    targetDistanceKm,
    edges: routeEdges,
    geometry: { type: "LineString", coordinates: [] },
    targetComponents: ["field_paths"],
  });
}

describe("selectTrailSpinesV3", () => {
  it("selects a continuous strict trail corridor over disconnected short fragments", () => {
    const fixture = graph([
      edge("frag-a1", "fa", "fb", 0.45, "ground", "path", null),
      edge("frag-b1", "fc", "fd", 0.45, "ground", "path", null),
      edge("spine-1", "a", "b", 0.75, "ground", "path", null),
      edge("spine-2", "b", "c", 0.75, "earth", "track", null),
      edge("spine-3", "c", "d", 0.75, "ground", "path", null),
    ]);

    const result = selectTrailSpinesV3({
      graph: fixture,
      startNodeId: "a",
      targetComponentIds: ["field_paths"],
      minDistanceKm: 0.4,
    });

    expect(result.selected?.edgeIds).toEqual(["spine-1", "spine-2", "spine-3"]);
    expect(result.selected?.distanceKm).toBeCloseTo(2.25, 3);
    expect(result.selected?.longestStrictTrailSegmentKm).toBeCloseTo(2.25, 3);
    expect(result.diagnostics.topCandidates[0]?.edgeIds).toEqual([
      "spine-1",
      "spine-2",
      "spine-3",
    ]);
  });

  it("keeps scenic paved forest roads out of strict trail spine evidence", () => {
    const fixture = graph([
      edge("scenic-asphalt-1", "s", "p1", 1.2, "asphalt", "service", "forest"),
      edge("scenic-asphalt-2", "p1", "p2", 1.2, "asphalt", "service", "forest"),
      edge("strict-1", "s", "a", 0.8, "ground", "path", null),
      edge("strict-2", "a", "b", 0.8, "ground", "track", null),
    ]);

    const result = selectTrailSpinesV3({
      graph: fixture,
      startNodeId: "s",
      targetComponentIds: ["field_paths", "forest"],
      minDistanceKm: 0.5,
    });

    expect(result.selected?.edgeIds).toEqual(["strict-1", "strict-2"]);
    expect(result.selected?.pavedKm).toBe(0);
    expect(result.selected?.strictTrailKm).toBeCloseTo(1.6, 3);
    expect(result.selected?.explanation).toContain("strict trail spine");
  });

  it("allows paved access as connector risk while selecting the natural spine", () => {
    const fixture = graph([
      edge("access-paved", "s", "a", 0.7, "asphalt", "residential", "urban"),
      edge("spine-1", "a", "b", 1, "ground", "path", null),
      edge("spine-2", "b", "c", 1, "ground", "track", null),
      edge("closure-paved", "c", "s", 0.6, "asphalt", "residential", "urban"),
    ]);

    const result = selectTrailSpinesV3({
      graph: fixture,
      startNodeId: "s",
      targetComponentIds: ["field_paths"],
      minDistanceKm: 0.8,
    });

    expect(result.selected?.edgeIds).toEqual(["spine-1", "spine-2"]);
    expect(result.selected?.accessCostKm).toBeCloseTo(0.7, 3);
    expect(result.selected?.estimatedClosureCostKm).toBeCloseTo(0.6, 3);
    expect(result.selected?.connectorPavedRisk).toBeGreaterThan(0.9);
  });

  it("treats path/track unknown as adjusted natural-way confidence, not strict trail", () => {
    const fixture = graph([
      edge("unknown-path-1", "s", "a", 0.8, "", "path", "forest"),
      edge("unknown-path-2", "a", "b", 0.8, "", "track", "forest"),
      edge("unknown-path-3", "b", "c", 0.8, "", "path", "forest"),
    ]);

    const result = selectTrailSpinesV3({
      graph: fixture,
      startNodeId: "s",
      targetComponentIds: ["forest", "field_paths", "urban_green"],
      minDistanceKm: 0.5,
    });

    expect(result.selected?.strictTrailKm).toBe(0);
    expect(result.selected?.naturalWayKm).toBeGreaterThan(1.9);
    expect(result.selected?.mixedUnknownKm).toBeCloseTo(2.4, 3);
    expect(result.selected?.explanation).toContain("unverified");
  });
});

describe("extractRankedNaturalCyclesV3", () => {
  it("chooses a useful long natural cycle over an accessible micro-cycle", () => {
    const fixture = graph([
      edge("micro-1", "a", "b", 0.3, "ground", "path", null),
      edge("micro-2", "b", "c", 0.3, "ground", "path", null),
      edge("micro-3", "c", "a", 0.3, "ground", "path", null),
      edge("long-1", "a", "d", 1.4, "ground", "path", null),
      edge("long-2", "d", "e", 1.4, "ground", "track", null),
      edge("long-3", "e", "f", 1.4, "ground", "path", null),
      edge("long-4", "f", "a", 1.4, "ground", "track", null),
    ]);

    const result = extractRankedNaturalCyclesV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      minUsefulCycleKm: 1.5,
      targetDistanceKm: 8,
    });

    expect(result.cycles[0]?.id).toBe("ranked-cycle-1");
    expect(result.cycles[0]?.lengthKm).toBeGreaterThan(5);
    expect(result.cycles[0]?.originalEdgeIds).toEqual([
      "long-1",
      "long-2",
      "long-3",
      "long-4",
    ]);
    expect(result.diagnostics.rejectedMicroCycles).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.selectedCycleId).toBe("ranked-cycle-1");
  });

  it("builds a simple ordered cycle from a spanning-tree back edge", () => {
    const fixture = graph([
      edge("tree-1", "a", "b", 1, "ground", "path", null),
      edge("tree-2", "b", "c", 1, "ground", "track", null),
      edge("tree-3", "c", "d", 1, "ground", "path", null),
      edge("back-edge", "d", "a", 1, "ground", "track", null),
      edge("branch", "c", "x", 0.2, "ground", "path", null),
    ]);

    const result = extractRankedNaturalCyclesV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      minUsefulCycleKm: 2,
    });

    expect(result.cycles).toHaveLength(1);
    expect(result.cycles[0]?.originalNodeIds).toEqual([
      "a",
      "b",
      "c",
      "d",
      "a",
    ]);
    expect(result.cycles[0]?.originalEdgeIds).toEqual([
      "tree-1",
      "tree-2",
      "tree-3",
      "back-edge",
    ]);
    expect(result.diagnostics.basisMethod).toBe("spanning_tree_back_edges");
  });

  it("extracts multiple useful grid cycles and jaccard-deduplicates spaghetti equivalents", () => {
    const fixture = graph([
      edge("ab", "a", "b", 0.9, "ground", "path", null),
      edge("bc", "b", "c", 0.9, "ground", "path", null),
      edge("cd", "c", "d", 0.9, "ground", "path", null),
      edge("da", "d", "a", 0.9, "ground", "path", null),
      edge("be", "b", "e", 0.9, "ground", "path", null),
      edge("ef", "e", "f", 0.9, "ground", "path", null),
      edge("fc", "f", "c", 0.9, "ground", "path", null),
      edge("ac-diagonal", "a", "c", 0.1, "ground", "path", null),
    ]);

    const result = extractRankedNaturalCyclesV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      minUsefulCycleKm: 1.5,
      targetDistanceKm: 6,
    });

    expect(result.cycles.length).toBeGreaterThanOrEqual(2);
    expect(result.cycles.every((candidate) => candidate.lengthKm >= 1.5)).toBe(
      true,
    );
    expect(
      result.cycles.every(
        (candidate) =>
          new Set(candidate.originalEdgeIds).size ===
          candidate.originalEdgeIds.length,
      ),
    ).toBe(true);
    expect(result.diagnostics.jaccardDedupCount).toBeGreaterThan(0);
  });

  it("does not invent cycles in branch-only trees and reports no_useful_cycle", () => {
    const result = extractRankedNaturalCyclesV3({
      graph: graph([
        edge("trunk-1", "a", "b", 1, "ground", "path", null),
        edge("trunk-2", "b", "c", 1, "ground", "track", null),
        edge("branch-1", "b", "leaf1", 1, "ground", "path", null),
        edge("branch-2", "c", "leaf2", 1, "ground", "path", null),
      ]),
      targetComponentIds: ["field_paths"],
      minUsefulCycleKm: 1.5,
    });

    expect(result.cycles).toHaveLength(0);
    expect(result.diagnostics.pruningReason).toBe("no_useful_cycle");
    expect(result.diagnostics.selectedCycleId).toBeNull();
  });

  it("keeps paved forest/service edges counted as paved and penalized inside mixed cycles", () => {
    const result = extractRankedNaturalCyclesV3({
      graph: graph([
        edge("natural-1", "a", "b", 1, "ground", "path", null),
        edge(
          "paved-forest-service",
          "b",
          "c",
          0.8,
          "asphalt",
          "service",
          "forest",
        ),
        edge("natural-2", "c", "d", 1, "ground", "track", null),
        edge("natural-3", "d", "a", 1, "ground", "path", null),
      ]),
      targetComponentIds: ["field_paths", "forest"],
      minUsefulCycleKm: 2,
      includePavedWithinNaturalContext: true,
    });

    expect(result.cycles[0]?.pavedKm).toBeCloseTo(0.8, 3);
    expect(result.cycles[0]?.naturalKm).toBeCloseTo(3, 3);
    expect(result.cycles[0]?.naturalKm).toBeLessThan(
      result.cycles[0]?.lengthKm ?? 0,
    );
  });

  it("bounds large synthetic graphs without candidate explosion", () => {
    const edges = Array.from({ length: 180 }, (_, index) =>
      edge(
        `ring-${index}`,
        `n${index}`,
        `n${(index + 1) % 180}`,
        0.05,
        "ground",
        index % 2 === 0 ? "path" : "track",
        null,
      ),
    );

    const result = extractRankedNaturalCyclesV3({
      graph: graph(edges),
      targetComponentIds: ["field_paths"],
      minUsefulCycleKm: 2,
      maxBackEdges: 24,
      maxCandidates: 8,
    });

    expect(result.cycles.length).toBeLessThanOrEqual(8);
    expect(result.diagnostics.runtimeMs).toBeLessThan(1000);
    expect(result.diagnostics.pruningReason).toMatch(
      /pruned|max_candidate|bounded|none|no_useful_cycle/,
    );
  });
});

describe("contractNaturalGraphV3", () => {
  it("contracts degree-2 natural chains while preserving length, surfaces, highways, and original edge ids", () => {
    const result = contractNaturalGraphV3({
      graph: graph([
        edge("access-paved", "s", "a", 0.4, "asphalt", "residential", "urban"),
        edge("chain-1", "a", "b", 0.7, "ground", "path", null),
        edge("chain-2", "b", "c", 0.8, "gravel", "track", null),
        edge("chain-3", "c", "d", 0.9, "ground", "path", null),
        edge("branch", "c", "x", 0.3, "ground", "path", null),
        edge("scenic-paved", "d", "e", 0.5, "asphalt", "service", "forest"),
      ]),
      targetComponentIds: ["field_paths"],
    });

    expect(result.diagnostics.originalNaturalEdgeCount).toBe(4);
    expect(result.diagnostics.contractedNodeCount).toBeGreaterThanOrEqual(4);
    expect(result.diagnostics.contractedCorridorCount).toBeGreaterThanOrEqual(
      3,
    );
    const main = result.corridors.find(
      (corridor) => corridor.originalEdgeIds.join(",") === "chain-1,chain-2",
    );
    expect(main).toBeDefined();
    expect(main?.lengthKm).toBeCloseTo(1.5, 3);
    expect(main?.surfaceSummary).toEqual(["natural"]);
    expect(main?.highways.sort()).toEqual(["path", "track"]);
    expect(
      result.corridors.some((corridor) =>
        corridor.originalEdgeIds.includes("scenic-paved"),
      ),
    ).toBe(false);
  });

  it("detects useful natural cycles and expands them back to original edge ids", () => {
    const result = contractNaturalGraphV3({
      graph: graph([
        edge("cycle-1", "a", "b", 1, "ground", "path", null),
        edge("cycle-2", "b", "c", 1, "ground", "track", null),
        edge("cycle-3", "c", "d", 1, "ground", "path", null),
        edge("cycle-4", "d", "a", 1, "ground", "track", null),
        edge("gateway", "s", "a", 0.25, "asphalt", "residential", "urban"),
      ]),
      targetComponentIds: ["field_paths"],
      startNodeId: "s",
      minUsefulCycleKm: 2,
    });

    expect(result.diagnostics.cycleCandidateCount).toBeGreaterThanOrEqual(1);
    expect(result.cycleCandidates[0]?.originalEdgeIds).toEqual([
      "cycle-1",
      "cycle-2",
      "cycle-3",
      "cycle-4",
    ]);
    expect(result.cycleCandidates[0]?.lengthKm).toBeCloseTo(4, 3);
    expect(result.diagnostics.expansionValidity.valid).toBe(true);
    expect(result.diagnostics.selectedCycleOrLandmarkPlan?.type).toBe("cycle");
  });

  it("keeps grid cycles useful without returning every micro-cycle duplicate", () => {
    const result = contractNaturalGraphV3({
      graph: graph([
        edge("ab", "a", "b", 0.8, "ground", "path", null),
        edge("bc", "b", "c", 0.8, "ground", "path", null),
        edge("cd", "c", "d", 0.8, "ground", "path", null),
        edge("da", "d", "a", 0.8, "ground", "path", null),
        edge("be", "b", "e", 0.8, "ground", "path", null),
        edge("ef", "e", "f", 0.8, "ground", "path", null),
        edge("fc", "f", "c", 0.8, "ground", "path", null),
        edge("ac-diagonal", "a", "c", 0.1, "ground", "path", null),
      ]),
      targetComponentIds: ["field_paths"],
      minUsefulCycleKm: 2,
    });

    expect(result.diagnostics.cycleCandidateCount).toBeGreaterThanOrEqual(1);
    expect(
      result.cycleCandidates.every((candidate) => candidate.lengthKm >= 2),
    ).toBe(true);
    expect(result.diagnostics.jaccardDedupCount).toBeGreaterThan(0);
  });

  it("reports branch-only natural trees without pretending to find a clean loop", () => {
    const result = contractNaturalGraphV3({
      graph: graph([
        edge("spine-1", "a", "b", 0.5, "ground", "path", null),
        edge("spine-2", "b", "c", 0.5, "ground", "path", null),
        edge("tooth-1", "b", "leaf1", 0.6, "ground", "path", null),
        edge("tooth-2", "c", "leaf2", 0.6, "ground", "path", null),
      ]),
      targetComponentIds: ["field_paths"],
    });

    expect(result.diagnostics.cycleCandidateCount).toBe(0);
    expect(result.diagnostics.selectedCycleOrLandmarkPlan?.type).toBe("none");
    expect(result.diagnostics.expansionValidity.valid).toBe(true);
  });

  it("marks expansion invalid when a corridor references a missing original edge id", () => {
    const result = contractNaturalGraphV3({
      graph: graph([
        edge("cycle-1", "a", "b", 1, "ground", "path", null),
        edge("cycle-2", "b", "c", 1, "ground", "path", null),
        edge("cycle-3", "c", "a", 1, "ground", "path", null),
      ]),
      targetComponentIds: ["field_paths"],
      debugInjectMissingOriginalEdgeId: true,
    });

    expect(result.diagnostics.expansionValidity.valid).toBe(false);
    expect(
      result.diagnostics.expansionValidity.missingOriginalEdgeIds,
    ).toContain("debug-missing-edge");
  });
});

describe("planMultiCycleDwellV3", () => {
  it("returns a diagnostic timeout instead of exhausting unbounded cycle assembly work", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("c1-1", "a", "b", 1, "ground", "path"),
      edge("c1-2", "b", "c", 1, "ground", "track"),
      edge("c1-3", "c", "d", 1, "ground", "path"),
      edge("c1-4", "d", "a", 1, "ground", "track"),
      edge("bridge", "d", "e", 0.4, "ground", "path"),
      edge("c2-1", "e", "f", 1, "ground", "path"),
      edge("c2-2", "f", "g", 1, "ground", "track"),
      edge("c2-3", "g", "h", 1, "ground", "path"),
      edge("c2-4", "h", "e", 1, "ground", "track"),
      edge("closure", "d", "s", 0.2, "ground", "path"),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        {
          id: "ranked-cycle-1",
          originalEdgeIds: ["c1-1", "c1-2", "c1-3", "c1-4"],
          originalNodeIds: ["a", "b", "c", "d", "a"],
          lengthKm: 4,
          naturalKm: 4,
          pavedKm: 0,
        },
        {
          id: "ranked-cycle-2",
          originalEdgeIds: ["c2-1", "c2-2", "c2-3", "c2-4"],
          originalNodeIds: ["e", "f", "g", "h", "e"],
          lengthKm: 4,
          naturalKm: 4,
          pavedKm: 0,
        },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths", "forest"],
      targetDistanceKm: 10,
      minDistanceKm: 6,
      maxDistanceKm: 11.5,
      requestedNaturalDwellKm: 3.5,
      maxCycles: 2,
      maxAssemblyIterations: 1,
    });

    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.reason).toBe("assembly_timeout");
    expect(result.diagnostics.failedPhase).toBe("timeoutPhase");
    expect(result.diagnostics.assemblyTimeout).toMatchObject({
      stage: expect.any(String),
      reason: "iteration_budget_exceeded",
      maxIterations: 1,
    });
    expect(result.diagnostics.assemblyTimeout?.candidateCount).toBeGreaterThanOrEqual(0);
  });

  it("documents that mixed unknown trail edges are the source of planner-vs-final pavedRatio mismatch", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("c1-1", "a", "b", 1, "unknown", "path"),
      edge("c1-2", "b", "c", 1, "unknown", "track"),
      edge("c1-3", "c", "d", 1, "unknown", "path"),
      edge("c1-4", "d", "a", 1, "unknown", "track"),
      edge("bridge", "d", "e", 0.4, "unknown", "path"),
      edge("c2-1", "e", "f", 1, "unknown", "path"),
      edge("c2-2", "f", "g", 1, "unknown", "track"),
      edge("c2-3", "g", "h", 1, "unknown", "path"),
      edge("c2-4", "h", "e", 1, "unknown", "track"),
      edge("closure-e", "e", "s", 0.2, "asphalt", "residential", "urban"),
      edge("closure", "d", "s", 0.2, "asphalt", "residential", "urban"),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        {
          id: "ranked-cycle-1",
          originalEdgeIds: ["c1-1", "c1-2", "c1-3", "c1-4"],
          originalNodeIds: ["a", "b", "c", "d", "a"],
          lengthKm: 4,
          naturalKm: 4,
          pavedKm: 0,
        },
        {
          id: "ranked-cycle-2",
          originalEdgeIds: ["c2-1", "c2-2", "c2-3", "c2-4"],
          originalNodeIds: ["e", "f", "g", "h", "e"],
          lengthKm: 4,
          naturalKm: 4,
          pavedKm: 0,
        },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths", "forest"],
      targetDistanceKm: 10,
      minDistanceKm: 6,
      maxDistanceKm: 11.5,
      requestedNaturalDwellKm: 3.5,
      maxCycles: 2,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    const finalMetrics = finalMetricsFromResult(fixture, result.edgeIds, 10);
    const selectedCandidate =
      result.diagnostics.multiCycleDwellCandidates.selectedCandidate;
    expect(selectedCandidate).toBeTruthy();
    expect(selectedCandidate?.candidateId).toBe(
      result.diagnostics.multiCycleDwellCandidates.selectedCandidateId,
    );
    expect(
      result.diagnostics.multiCycleDwellCandidates.topCandidates[0]
        ?.finalPavedRatioEstimate,
    ).toEqual(expect.any(Number));
    expect(
      result.diagnostics.multiCycleDwellCandidates.topCandidates[0]
        ?.candidateId,
    ).toBe(selectedCandidate?.candidateId);
    expect(selectedCandidate?.explicitPavedKm).toBe(result.metrics.pavedKm);
    expect(selectedCandidate?.mixedUnknownKm).toBeGreaterThan(7);
    expect(selectedCandidate?.finalPavedEquivalentKm).toBeGreaterThan(
      selectedCandidate?.explicitPavedKm ?? 0,
    );
    expect(selectedCandidate?.finalPavedRatioEstimate).toBeGreaterThan(
      selectedCandidate?.pavedRatio ?? 0,
    );
    expect(selectedCandidate?.finalPavedRatioEstimate).toBeCloseTo(
      finalMetrics.pavedRatio,
      3,
    );
    expect(selectedCandidate?.strictNaturalKm).toBe(0);
    expect(selectedCandidate?.naturalWayEquivalentKm).toBeGreaterThan(
      selectedCandidate?.strictNaturalKm ?? 0,
    );
    expect(selectedCandidate?.estimatedLongestStrictTrailSegmentKm).toBe(0);
    expect(result.metrics.pavedKm / result.metrics.distanceKm).toBeLessThan(
      finalMetrics.pavedRatio,
    );
    expect(result.metrics.pavedKm).toBeLessThan(finalMetrics.pavedKm);
    expect(selectedCandidate?.finalPavedEquivalentKm).toBe(
      finalMetrics.pavedKm,
    );
    expect(
      result.diagnostics.multiCycleDwellCandidates
        .selectedCandidatePavedComparison,
    ).toEqual({
      candidateId: selectedCandidate?.candidateId,
      explicitPavedRatio: selectedCandidate?.explicitPavedRatio,
      finalPavedRatioEstimate: selectedCandidate?.finalPavedRatioEstimate,
      finalPavedEquivalentKm: selectedCandidate?.finalPavedEquivalentKm,
      mixedUnknownKm: selectedCandidate?.mixedUnknownKm,
      roadLikeUnknownKm: selectedCandidate?.roadLikeUnknownKm,
      pathTrackUnknownKm: selectedCandidate?.pathTrackUnknownKm,
      trailCandidateKm: selectedCandidate?.trailCandidateKm,
      unverifiedTrailCandidateKm: selectedCandidate?.unverifiedTrailCandidateKm,
      candidateNaturalKm: selectedCandidate?.candidateNaturalKm,
      strictNaturalKm: selectedCandidate?.strictNaturalKm,
      naturalWayEquivalentKm: selectedCandidate?.naturalWayEquivalentKm,
    });
    expect(finalMetrics.naturalDwellKm).toBeLessThanOrEqual(
      result.metrics.chainNaturalKm,
    );
  });

  it("applies a credible selected TrailSpine as hard anchor instead of silently selecting a route that ignores it", () => {
    const fixture = graph([
      edge("access-spine", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("spine-1", "a", "b", 1.5, "ground", "path", null),
      edge("spine-2", "b", "c", 1.5, "ground", "track", null),
      edge("closure-spine", "c", "s", 0.2, "asphalt", "residential", "urban"),
      edge("access-ignore", "s", "x", 0.1, "asphalt", "residential", "urban"),
      edge("ignore-1", "x", "y", 1.3, "ground", "path", null),
      edge("ignore-2", "y", "z", 1.3, "ground", "track", null),
      edge("ignore-3", "z", "x", 1.3, "ground", "path", null),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        {
          id: "ignore-cycle",
          originalEdgeIds: ["ignore-1", "ignore-2", "ignore-3"],
          originalNodeIds: ["x", "y", "z", "x"],
          lengthKm: 3.9,
          naturalKm: 3.9,
          pavedKm: 0,
        },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 4,
      minDistanceKm: 3,
      maxDistanceKm: 5,
      requestedNaturalDwellKm: 2,
      trailSpines: [
        {
          spineId: "selected-spine",
          componentId: "spine-component",
          componentKind: "field_paths",
          edgeIds: ["spine-1", "spine-2"],
          distanceKm: 3,
          strictTrailKm: 3,
          naturalWayKm: 3,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 3,
          trailConfidence: 0.95,
          accessCostKm: 0.2,
          estimatedClosureCostKm: 0.2,
          connectorPavedRisk: 0.2,
          repeatRisk: 0,
          expansionPotentialKm: 3,
          explanation: "test selected spine",
        },
      ],
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.edgeIds).toEqual(
      expect.arrayContaining(["spine-1", "spine-2"]),
    );
    expect(result.edgeIds).not.toEqual(
      expect.arrayContaining(["ignore-1", "ignore-2", "ignore-3"]),
    );
    expect(result.diagnostics.trailSpineAnchor.hardAnchorCredible).toBe(true);
    expect(result.diagnostics.trailSpineAnchor.selectedSpineAnchorApplied).toBe(
      true,
    );
    expect(
      result.diagnostics.trailSpineAnchor.spineCoverageRatio,
    ).toBeGreaterThanOrEqual(0.65);
    expect(
      result.diagnostics.multiCycleDwellCandidates.topRejected.some(
        (candidate) => candidate.rejectedReason === "missed_selected_spine",
      ),
    ).toBe(true);
  });

  it("builds a connector-to-spine recovery lane before choosing a route that ignores the selected spine", () => {
    const fixture = graph([
      edge("access-spine", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("spine-1", "a", "b", 1.2, "ground", "path", null),
      edge("spine-2", "b", "c", 1.2, "ground", "track", null),
      edge("recovery", "c", "d", 0.3, "ground", "path", null),
      edge("cycle-1", "d", "e", 0.8, "ground", "path", null),
      edge("cycle-2", "e", "f", 0.8, "ground", "track", null),
      edge("cycle-3", "f", "d", 0.8, "ground", "path", null),
      edge("closure", "d", "s", 0.4, "asphalt", "residential", "urban"),
      edge("access-ignore", "s", "x", 0.1, "asphalt", "residential", "urban"),
      edge("ignore-1", "x", "y", 1.3, "ground", "path", null),
      edge("ignore-2", "y", "z", 1.3, "ground", "track", null),
      edge("ignore-3", "z", "x", 1.3, "ground", "path", null),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        {
          id: "ignore-cycle",
          originalEdgeIds: ["ignore-1", "ignore-2", "ignore-3"],
          originalNodeIds: ["x", "y", "z", "x"],
          lengthKm: 3.9,
          naturalKm: 3.9,
          pavedKm: 0,
        },
        {
          id: "recovery-cycle",
          originalEdgeIds: ["cycle-1", "cycle-2", "cycle-3"],
          originalNodeIds: ["d", "e", "f", "d"],
          lengthKm: 2.4,
          naturalKm: 2.4,
          pavedKm: 0,
        },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 6,
      minDistanceKm: 4,
      maxDistanceKm: 7,
      requestedNaturalDwellKm: 3,
      trailSpines: [
        {
          spineId: "selected-spine",
          componentId: "spine-component",
          componentKind: "field_paths",
          edgeIds: ["spine-1", "spine-2"],
          distanceKm: 2.4,
          strictTrailKm: 2.4,
          naturalWayKm: 2.4,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 2.4,
          trailConfidence: 0.95,
          accessCostKm: 0.2,
          estimatedClosureCostKm: 0.4,
          connectorPavedRisk: 0.2,
          repeatRisk: 0,
          expansionPotentialKm: 3,
          explanation: "test selected spine with recovery",
        },
      ],
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.edgeIds).toEqual(
      expect.arrayContaining([
        "spine-1",
        "spine-2",
        "recovery",
        "cycle-1",
        "cycle-2",
      ]),
    );
    expect(result.edgeIds).not.toEqual(
      expect.arrayContaining(["ignore-1", "ignore-2", "ignore-3"]),
    );
    expect(result.diagnostics.trailSpineAnchor.spineSeedCandidateBuilt).toBe(
      true,
    );
    expect(
      result.diagnostics.trailSpineAnchor.spineSeedFailureStage,
    ).toBeNull();
    expect(result.diagnostics.trailSpineAnchor.selectedSpineAnchorApplied).toBe(
      true,
    );
    expect(result.diagnostics.trailSpineAnchor.recoveryCostKm).toBeGreaterThan(
      0,
    );
  });

  it("cuts a selected TrailSpine recovery lane at the distance-aware exit before an overlong second lap", () => {
    const recoveryCycleEdges = Array.from({ length: 20 }, (_, index) => {
      const from = `r${index}`;
      const to = index === 19 ? "r0" : `r${index + 1}`;
      return edge(
        `recovery-${index}`,
        from,
        to,
        0.5,
        "ground",
        index % 2 === 0 ? "path" : "track",
        null,
      );
    });
    const fixture = graph([
      edge("access-spine", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("spine-1", "a", "b", 1.2, "ground", "path", null),
      edge("spine-2", "b", "c", 1.2, "ground", "track", null),
      edge("recovery-connector", "c", "r0", 0.3, "ground", "path", null),
      ...recoveryCycleEdges,
      edge(
        "distance-aware-exit",
        "r8",
        "s",
        0.4,
        "asphalt",
        "residential",
        "urban",
      ),
      edge("overlong-exit", "r19", "s", 0.4, "asphalt", "residential", "urban"),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        {
          id: "long-recovery-cycle",
          originalEdgeIds: recoveryCycleEdges.map((candidate) => candidate.id),
          originalNodeIds: [
            ...Array.from({ length: 20 }, (_, index) => `r${index}`),
            "r0",
          ],
          lengthKm: 10,
          naturalKm: 10,
          pavedKm: 0,
        },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 8,
      minDistanceKm: 5.6,
      maxDistanceKm: 9.2,
      requestedNaturalDwellKm: 5.4,
      trailSpines: [
        {
          spineId: "selected-spine",
          componentId: "spine-component",
          componentKind: "field_paths",
          edgeIds: ["spine-1", "spine-2"],
          distanceKm: 2.4,
          strictTrailKm: 2.4,
          naturalWayKm: 2.4,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 2.4,
          trailConfidence: 0.95,
          accessCostKm: 0.2,
          estimatedClosureCostKm: 0.4,
          connectorPavedRisk: 0.2,
          repeatRisk: 0,
          expansionPotentialKm: 10,
          explanation: "test selected spine with distance-aware recovery exit",
        },
      ],
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.metrics.distanceKm).toBeGreaterThanOrEqual(5.6);
    expect(result.metrics.distanceKm).toBeLessThanOrEqual(9.2);
    expect(result.edgeIds).toContain("distance-aware-exit");
    expect(result.edgeIds).not.toContain("overlong-exit");
    expect(
      result.diagnostics.trailSpineAnchor.spineCoverageRatio,
    ).toBeGreaterThanOrEqual(0.65);
    expect(
      result.diagnostics.multiCycleDwellCandidates.overlongCount,
    ).toBeGreaterThan(0);
  });

  it("allows a distance-aware TrailSpine recovery exit to reuse the access connector without repeating target trail", () => {
    const fixture = graph([
      edge("access-spine", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("spine-1", "a", "b", 1.2, "ground", "path", null),
      edge("spine-2", "b", "c", 1.2, "ground", "track", null),
      edge(
        "paved-recovery-connector",
        "c",
        "d",
        0.3,
        "asphalt",
        "service",
        "urban",
      ),
      edge("cycle-1", "d", "e", 1, "ground", "path", null),
      edge("cycle-2", "e", "f", 1, "ground", "track", null),
      edge("cycle-3", "f", "d", 1, "ground", "path", null),
      edge(
        "connector-return",
        "c",
        "s",
        0.4,
        "asphalt",
        "residential",
        "urban",
      ),
      edge("ignore-1", "x", "y", 1.5, "ground", "path", null),
      edge("ignore-2", "y", "z", 1.5, "ground", "track", null),
      edge("ignore-3", "z", "x", 1.5, "ground", "path", null),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        {
          id: "recovery-cycle",
          originalEdgeIds: ["cycle-1", "cycle-2", "cycle-3"],
          originalNodeIds: ["d", "e", "f", "d"],
          lengthKm: 3,
          naturalKm: 3,
          pavedKm: 0,
        },
        {
          id: "ignore-cycle",
          originalEdgeIds: ["ignore-1", "ignore-2", "ignore-3"],
          originalNodeIds: ["x", "y", "z", "x"],
          lengthKm: 4.5,
          naturalKm: 4.5,
          pavedKm: 0,
        },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 6,
      minDistanceKm: 4.2,
      maxDistanceKm: 6.9,
      requestedNaturalDwellKm: 4.5,
      trailSpines: [
        {
          spineId: "selected-spine",
          componentId: "spine-component",
          componentKind: "field_paths",
          edgeIds: ["spine-1", "spine-2"],
          distanceKm: 2.4,
          strictTrailKm: 2.4,
          naturalWayKm: 2.4,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 2.4,
          trailConfidence: 0.95,
          accessCostKm: 0.2,
          estimatedClosureCostKm: 0.5,
          connectorPavedRisk: 0.2,
          repeatRisk: 0,
          expansionPotentialKm: 3,
          explanation: "test selected spine recovery with connector return",
        },
      ],
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.edgeIds).toEqual(
      expect.arrayContaining([
        "spine-1",
        "spine-2",
        "paved-recovery-connector",
        "cycle-1",
      ]),
    );
    expect(
      result.edgeIds.filter((edgeId) => edgeId === "paved-recovery-connector"),
    ).toHaveLength(2);
    expect(result.metrics.chainTargetRepeatKm).toBe(0);
    expect(result.metrics.chainConnectorRepeatKm).toBeCloseTo(0.3, 3);
    expect(result.metrics.distanceKm).toBeGreaterThanOrEqual(4.2);
    expect(result.metrics.distanceKm).toBeLessThanOrEqual(6.9);
  });

  it("avoids a marginal target-pair repeat when an equivalent recovery connector exists", () => {
    const fixture = graph([
      edge("access-spine", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("spine-1", "a", "b", 1.1, "ground", "path", null),
      edge("spine-2", "b", "c", 1.1, "ground", "track", null),
      edge("repeat-bc-alt", "c", "b", 0.48, "ground", "path", null),
      edge("repeat-shortcut", "b", "d", 0.08, "ground", "path", null),
      edge("clean-recovery-1", "c", "x", 0.35, "ground", "path", null),
      edge("clean-recovery-2", "x", "d", 0.35, "ground", "path", null),
      edge("cycle-1", "d", "e", 1, "ground", "path", null),
      edge("cycle-2", "e", "f", 1, "ground", "track", null),
      edge("cycle-3", "f", "d", 1, "ground", "path", null),
      edge("closure", "d", "s", 0.4, "asphalt", "residential", "urban"),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        {
          id: "recovery-cycle",
          originalEdgeIds: ["cycle-1", "cycle-2", "cycle-3"],
          originalNodeIds: ["d", "e", "f", "d"],
          lengthKm: 3,
          naturalKm: 3,
          pavedKm: 0,
        },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 6.5,
      minDistanceKm: 4.5,
      maxDistanceKm: 7.5,
      requestedNaturalDwellKm: 4,
      trailSpines: [
        {
          spineId: "selected-spine",
          componentId: "spine-component",
          componentKind: "field_paths",
          edgeIds: ["spine-1", "spine-2"],
          distanceKm: 2.2,
          strictTrailKm: 2.2,
          naturalWayKm: 2.2,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 2.2,
          trailConfidence: 0.95,
          accessCostKm: 0.2,
          estimatedClosureCostKm: 0.4,
          connectorPavedRisk: 0.1,
          repeatRisk: 0,
          expansionPotentialKm: 3,
          explanation:
            "test selected spine with repeat-free recovery alternative",
        },
      ],
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.edgeIds).toEqual(
      expect.arrayContaining([
        "clean-recovery-1",
        "clean-recovery-2",
        "cycle-1",
      ]),
    );
    expect(result.edgeIds).not.toContain("repeat-bc-alt");
    expect(result.metrics.chainTargetRepeatKm).toBe(0);
    expect(
      result.diagnostics.multiCycleDwellCandidates.selectedCandidate
        ?.rejectedReason,
    ).toBeNull();
  });

  it("keeps a less-repeat recovery refused when the only alternative breaks the paved-equivalent gate", () => {
    const fixture = graph([
      edge("access-spine", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("spine-1", "a", "b", 1.1, "ground", "path", null),
      edge("spine-2", "b", "c", 1.1, "ground", "track", null),
      edge("repeat-bc-alt", "c", "b", 0.48, "ground", "path", null),
      edge("repeat-shortcut", "b", "d", 0.08, "ground", "path", null),
      edge("paved-recovery-1", "c", "x", 1.6, "asphalt", "service", "urban"),
      edge("paved-recovery-2", "x", "d", 1.6, "asphalt", "service", "urban"),
      edge("cycle-1", "d", "e", 1, "ground", "path", null),
      edge("cycle-2", "e", "f", 1, "ground", "track", null),
      edge("cycle-3", "f", "d", 1, "ground", "path", null),
      edge("closure", "d", "s", 0.4, "asphalt", "residential", "urban"),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        {
          id: "recovery-cycle",
          originalEdgeIds: ["cycle-1", "cycle-2", "cycle-3"],
          originalNodeIds: ["d", "e", "f", "d"],
          lengthKm: 3,
          naturalKm: 3,
          pavedKm: 0,
        },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 8,
      minDistanceKm: 5.6,
      maxDistanceKm: 9.2,
      requestedNaturalDwellKm: 4,
      trailSpines: [
        {
          spineId: "selected-spine",
          componentId: "spine-component",
          componentKind: "field_paths",
          edgeIds: ["spine-1", "spine-2"],
          distanceKm: 2.2,
          strictTrailKm: 2.2,
          naturalWayKm: 2.2,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 2.2,
          trailConfidence: 0.95,
          accessCostKm: 0.2,
          estimatedClosureCostKm: 0.4,
          connectorPavedRisk: 0.1,
          repeatRisk: 0,
          expansionPotentialKm: 3,
          explanation:
            "test selected spine with paved-only repeat-free recovery",
        },
      ],
    });

    expect(result.status).toBe("failure");
    expect(
      result.diagnostics.multiCycleDwellCandidates.selectedCandidateId,
    ).toBeNull();
    expect(
      result.diagnostics.multiCycleDwellCandidates.topRejected.some(
        (candidate) => candidate.rejectedReason === "excessive_paved",
      ),
    ).toBe(true);
    expect(
      result.diagnostics.multiCycleDwellCandidates.topRejected.some(
        (candidate) =>
          "repeatedTargetSegments" in candidate &&
          candidate.repeatedTargetSegments.some(
            (segment) =>
              segment.segment === "recovery" &&
              segment.repeatedPairKeys.length > 0,
          ),
      ),
    ).toBe(true);
    expect([
      "spine_candidate_excessive_paved",
      "spine_candidate_excessive_repeat",
    ]).toContain(
      result.diagnostics.trailSpineAnchor.selectedSpineAnchorRejectedReason,
    );
  });

  it("keeps a credible selected TrailSpine refused with precise seed diagnostics when recovery cannot make distance", () => {
    const fixture = graph([
      edge("access-spine", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("spine-1", "a", "b", 1.2, "ground", "path", null),
      edge("spine-2", "b", "c", 1.2, "ground", "track", null),
      edge("closure", "c", "s", 0.2, "asphalt", "residential", "urban"),
      edge("ignore-1", "x", "y", 1.3, "ground", "path", null),
      edge("ignore-2", "y", "z", 1.3, "ground", "track", null),
      edge("ignore-3", "z", "x", 1.3, "ground", "path", null),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        {
          id: "ignore-cycle",
          originalEdgeIds: ["ignore-1", "ignore-2", "ignore-3"],
          originalNodeIds: ["x", "y", "z", "x"],
          lengthKm: 3.9,
          naturalKm: 3.9,
          pavedKm: 0,
        },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 8,
      minDistanceKm: 6,
      maxDistanceKm: 9,
      requestedNaturalDwellKm: 3,
      trailSpines: [
        {
          spineId: "selected-spine",
          componentId: "spine-component",
          componentKind: "field_paths",
          edgeIds: ["spine-1", "spine-2"],
          distanceKm: 2.4,
          strictTrailKm: 2.4,
          naturalWayKm: 2.4,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 2.4,
          trailConfidence: 0.95,
          accessCostKm: 0.2,
          estimatedClosureCostKm: 0.2,
          connectorPavedRisk: 0.2,
          repeatRisk: 0,
          expansionPotentialKm: 1,
          explanation: "test selected spine without recovery",
        },
      ],
    });

    expect(result.status).toBe("failure");
    expect(result.diagnostics.trailSpineAnchor.spineSeedCandidateBuilt).toBe(
      true,
    );
    expect(result.diagnostics.trailSpineAnchor.spineSeedFailureStage).toBe(
      "distance_gate",
    );
    expect(
      result.diagnostics.trailSpineAnchor.selectedSpineAnchorRejectedReason,
    ).toBe("spine_candidate_under_min");
    expect(
      result.diagnostics.trailSpineAnchor.spineCoverageRatio,
    ).toBeGreaterThanOrEqual(0.65);
  });

  it("rejects a hard TrailSpine anchor when access and closure paved risk is too high", () => {
    const fixture = graph([
      edge("access-ignore", "s", "x", 0.1, "asphalt", "residential", "urban"),
      edge("ignore-1", "x", "y", 1.3, "ground", "path", null),
      edge("ignore-2", "y", "z", 1.3, "ground", "track", null),
      edge("ignore-3", "z", "x", 1.3, "ground", "path", null),
      edge("spine-1", "a", "b", 1.5, "ground", "path", null),
      edge("spine-2", "b", "c", 1.5, "ground", "track", null),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        {
          id: "ignore-cycle",
          originalEdgeIds: ["ignore-1", "ignore-2", "ignore-3"],
          originalNodeIds: ["x", "y", "z", "x"],
          lengthKm: 3.9,
          naturalKm: 3.9,
          pavedKm: 0,
        },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 4,
      minDistanceKm: 3,
      maxDistanceKm: 5,
      requestedNaturalDwellKm: 2,
      trailSpines: [
        {
          spineId: "selected-spine",
          componentId: "spine-component",
          componentKind: "field_paths",
          edgeIds: ["spine-1", "spine-2"],
          distanceKm: 3,
          strictTrailKm: 3,
          naturalWayKm: 3,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 3,
          trailConfidence: 0.95,
          accessCostKm: 2.5,
          estimatedClosureCostKm: 2.5,
          connectorPavedRisk: 0.95,
          repeatRisk: 0,
          expansionPotentialKm: 3,
          explanation: "test high-risk selected spine",
        },
      ],
    });

    expect(result.diagnostics.trailSpineAnchor.hardAnchorCredible).toBe(false);
    expect(
      result.diagnostics.trailSpineAnchor.selectedSpineAnchorRejectedReason,
    ).toBe("access_too_expensive");
    expect(result.diagnostics.trailSpineAnchor.selectedSpineAnchorApplied).toBe(
      false,
    );
  });

  it("does not hard-anchor a selected spine dominated by road-like unknown evidence", () => {
    const fixture = graph([
      edge("unknown-path-1", "a", "b", 1.2, "", "path", "forest"),
      edge("unknown-path-2", "b", "c", 1.2, "", "track", "forest"),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "a",
      contraction,
      targetComponentIds: ["field_paths", "forest"],
      targetDistanceKm: 8,
      requestedNaturalDwellKm: 4,
      trailSpines: [
        {
          spineId: "unknown-selected-spine",
          componentId: "spine-component",
          componentKind: "field_paths",
          edgeIds: ["unknown-path-1", "unknown-path-2"],
          distanceKm: 2.4,
          strictTrailKm: 0.2,
          naturalWayKm: 2.4,
          mixedUnknownKm: 2.2,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 0.2,
          trailConfidence: 0.6,
          accessCostKm: 0,
          estimatedClosureCostKm: 0,
          connectorPavedRisk: 0,
          repeatRisk: 0,
          expansionPotentialKm: 2.4,
          explanation: "mostly unverified unknown path/track",
        },
      ],
    });

    expect(result.diagnostics.trailSpineAnchor.hardAnchorCredible).toBe(false);
    expect(
      result.diagnostics.trailSpineAnchor.selectedSpineAnchorRejectedReason,
    ).toBe("insufficient_strict_trail");
  });

  it("chooses a slightly longer non-paved closure over a short paved closure when distance remains in envelope", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("c1-1", "a", "b", 1, "ground", "path", null),
      edge("c1-2", "b", "c", 1, "ground", "track", null),
      edge("c1-3", "c", "d", 1, "ground", "path", null),
      edge("c1-4", "d", "a", 1, "ground", "track", null),
      edge("bridge", "d", "e", 0.4, "ground", "path", null),
      edge("c2-1", "e", "f", 1, "ground", "path", null),
      edge("c2-2", "f", "g", 1, "ground", "track", null),
      edge("c2-3", "g", "h", 1, "ground", "path", null),
      edge("c2-4", "h", "e", 1, "ground", "track", null),
      edge(
        "short-paved-closure",
        "e",
        "s",
        0.2,
        "asphalt",
        "residential",
        "urban",
      ),
      edge("natural-closure-1", "e", "x", 0.45, "ground", "path", null),
      edge("natural-closure-2", "x", "s", 0.45, "ground", "path", null),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      startNodeId: "s",
      minUsefulCycleKm: 2,
    });

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 10,
      minDistanceKm: 7,
      maxDistanceKm: 11.5,
      requestedNaturalDwellKm: 5,
      maxCycles: 2,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.edgeIds).toContain("natural-closure-1");
    expect(result.edgeIds).toContain("natural-closure-2");
    expect(result.edgeIds).not.toContain("short-paved-closure");
    expect(result.metrics.closurePavedKm).toBe(0);
  });

  it("chains two natural cycles through a non-paved corridor before closure", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.25, "asphalt", "residential", "urban"),
      edge("c1-1", "a", "b", 1, "ground", "path", null),
      edge("c1-2", "b", "c", 1, "ground", "track", null),
      edge("c1-3", "c", "d", 1, "ground", "path", null),
      edge("c1-4", "d", "a", 1, "ground", "track", null),
      edge("natural-corridor", "d", "e", 0.8, "ground", "path", null),
      edge("c2-1", "e", "f", 1, "ground", "path", null),
      edge("c2-2", "f", "g", 1, "ground", "track", null),
      edge("c2-3", "g", "h", 1, "ground", "path", null),
      edge("c2-4", "h", "e", 1, "ground", "track", null),
      edge("closure", "e", "s", 0.3, "asphalt", "residential", "urban"),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      startNodeId: "s",
      minUsefulCycleKm: 2,
    });

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 10,
      requestedNaturalDwellKm: 7,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.cycleIds.length).toBeGreaterThanOrEqual(2);
    expect(result.edgeIds).toContain("natural-corridor");
    expect(result.metrics.chainNaturalKm).toBeGreaterThan(7);
    expect(result.metrics.connectorPavedKm).toBe(0);
    expect(result.diagnostics.failedPhase).toBeNull();
  });

  it("does not close after the first insufficient cycle when a second useful cycle is reachable", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("early-closure", "a", "s", 0.2, "asphalt", "residential", "urban"),
      edge("c1-1", "a", "b", 0.8, "ground", "path", null),
      edge("c1-2", "b", "c", 0.8, "ground", "track", null),
      edge("c1-3", "c", "a", 0.8, "ground", "path", null),
      edge("natural-corridor", "c", "d", 0.6, "ground", "path", null),
      edge("c2-1", "d", "e", 1, "ground", "path", null),
      edge("c2-2", "e", "f", 1, "ground", "track", null),
      edge("c2-3", "f", "d", 1, "ground", "path", null),
      edge("closure", "d", "s", 0.25, "asphalt", "residential", "urban"),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      startNodeId: "s",
      minUsefulCycleKm: 2,
    });

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 8,
      requestedNaturalDwellKm: 5,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.edgeIds).toContain("c2-1");
    expect(result.edgeIds).not.toEqual(["access", "early-closure"]);
    expect(result.metrics.chainNaturalKm).toBeGreaterThan(5);
  });

  it("keeps a long paved connector honest and refuses the second cycle when it would dominate the route", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("c1-1", "a", "b", 1, "ground", "path", null),
      edge("c1-2", "b", "c", 1, "ground", "track", null),
      edge("c1-3", "c", "a", 1, "ground", "path", null),
      edge(
        "long-paved-connector",
        "c",
        "d",
        3.2,
        "asphalt",
        "service",
        "forest",
      ),
      edge("c2-1", "d", "e", 1, "ground", "path", null),
      edge("c2-2", "e", "f", 1, "ground", "track", null),
      edge("c2-3", "f", "d", 1, "ground", "path", null),
      edge("closure", "a", "s", 0.2, "asphalt", "residential", "urban"),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths", "forest"],
      startNodeId: "s",
      minUsefulCycleKm: 2,
    });

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths", "forest"],
      targetDistanceKm: 8,
      requestedNaturalDwellKm: 5,
    });

    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.reason).toBe("no_chainable_cycle");
    expect(result.diagnostics.connectorPavedKm).toBeGreaterThan(3);
    expect(result.diagnostics.failedPhase).toBe("dwellPhase");
  });

  it("deduplicates highly overlapping cycles instead of building a dense mower chain", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("ab", "a", "b", 1, "ground", "path", null),
      edge("bc", "b", "c", 1, "ground", "path", null),
      edge("cd", "c", "d", 1, "ground", "path", null),
      edge("da", "d", "a", 1, "ground", "path", null),
      edge("ac-diagonal", "a", "c", 0.05, "ground", "path", null),
      edge("closure", "a", "s", 0.2, "asphalt", "residential", "urban"),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      startNodeId: "s",
      minUsefulCycleKm: 1.5,
    });

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 8,
      requestedNaturalDwellKm: 6,
    });

    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.reason).toBe("no_chainable_cycle");
    expect(result.diagnostics.overlapRejectedCount).toBeGreaterThan(0);
    expect(result.diagnostics.chainCount).toBeLessThanOrEqual(1);
  });

  it("reports no_chainable_cycle on branch-only trees without inventing cycles", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("trunk-1", "a", "b", 1, "ground", "path", null),
      edge("branch-1", "b", "leaf1", 1, "ground", "path", null),
      edge("branch-2", "b", "leaf2", 1, "ground", "track", null),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      startNodeId: "s",
      minUsefulCycleKm: 1.5,
    });

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 7,
      requestedNaturalDwellKm: 5,
    });

    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.reason).toBe("no_chainable_cycle");
    expect(result.diagnostics.chainCount).toBe(0);
    expect(result.diagnostics.failedPhase).toBe("dwellPhase");
  });

  it("measures repeat on original edges without double-counting a clean chained route", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.25, "asphalt", "residential", "urban"),
      edge("c1-1", "a", "b", 1, "ground", "path", null),
      edge("c1-2", "b", "c", 1, "ground", "track", null),
      edge("c1-3", "c", "a", 1, "ground", "path", null),
      edge("natural-corridor", "c", "d", 0.8, "ground", "path", null),
      edge("c2-1", "d", "e", 1, "ground", "path", null),
      edge("c2-2", "e", "f", 1, "ground", "track", null),
      edge("c2-3", "f", "d", 1, "ground", "path", null),
      edge("closure", "d", "s", 0.25, "asphalt", "residential", "urban"),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      startNodeId: "s",
      minUsefulCycleKm: 2,
    });

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 8,
      requestedNaturalDwellKm: 5,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.metrics.chainRepeatKm).toBe(0);
    expect(result.metrics.chainTargetRepeatKm).toBe(0);
    expect(new Set(result.edgeIds).size).toBe(result.edgeIds.length);
  });

  it("selects an in-envelope multi-cycle candidate over a more natural overlong chain", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("c1-1", "a", "b", 1, "ground", "path", null),
      edge("c1-2", "b", "c", 1, "ground", "track", null),
      edge("c1-3", "c", "d", 1, "ground", "path", null),
      edge("c1-4", "d", "a", 1, "ground", "track", null),
      edge("bridge-12", "d", "e", 0.3, "ground", "path", null),
      edge("c2-1", "e", "f", 1, "ground", "path", null),
      edge("c2-2", "f", "g", 1, "ground", "track", null),
      edge("c2-3", "g", "h", 1, "ground", "path", null),
      edge("c2-4", "h", "e", 1, "ground", "track", null),
      edge("bridge-23", "h", "i", 0.3, "ground", "path", null),
      edge("c3-1", "i", "j", 1, "ground", "path", null),
      edge("c3-2", "j", "k", 1, "ground", "track", null),
      edge("c3-3", "k", "l", 1, "ground", "path", null),
      edge("c3-4", "l", "i", 1, "ground", "track", null),
      edge(
        "closure-in-envelope",
        "h",
        "s",
        0.2,
        "asphalt",
        "residential",
        "urban",
      ),
      edge(
        "closure-overlong",
        "l",
        "s",
        0.2,
        "asphalt",
        "residential",
        "urban",
      ),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      startNodeId: "s",
      minUsefulCycleKm: 2,
    });

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 10,
      minDistanceKm: 6.5,
      maxDistanceKm: 8.5,
      requestedNaturalDwellKm: 5,
      maxCycles: 3,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.metrics.distanceKm).toBeLessThanOrEqual(8.5);
    expect(
      result.diagnostics.multiCycleDwellCandidates.inEnvelopeCount,
    ).toBeGreaterThan(0);
    expect(
      result.diagnostics.multiCycleDwellCandidates.selectedCandidateId,
    ).toBeTruthy();
  });

  it("extends cycle-chain selection into the 12km distance envelope instead of stopping at the clean 10km chain", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("c1-1", "a", "b", 1, "ground", "path", null),
      edge("c1-2", "b", "c", 1, "ground", "track", null),
      edge("c1-3", "c", "d", 1, "ground", "path", null),
      edge("c1-4", "d", "a", 1, "ground", "track", null),
      edge("bridge-12", "d", "e", 0.3, "ground", "path", null),
      edge("c2-1", "e", "f", 1, "ground", "path", null),
      edge("c2-2", "f", "g", 1, "ground", "track", null),
      edge("c2-3", "g", "h", 1, "ground", "path", null),
      edge("c2-4", "h", "e", 1, "ground", "track", null),
      edge("bridge-23", "h", "i", 0.3, "ground", "path", null),
      edge("c3-1", "i", "j", 1, "ground", "path", null),
      edge("c3-2", "j", "k", 1, "ground", "track", null),
      edge("c3-3", "k", "l", 1, "ground", "path", null),
      edge("c3-4", "l", "i", 1, "ground", "track", null),
      edge("bridge-34", "l", "m", 0.3, "ground", "path", null),
      edge("c4-1", "m", "n", 1, "ground", "path", null),
      edge("c4-2", "n", "o", 1, "ground", "track", null),
      edge("c4-3", "o", "p", 1, "ground", "path", null),
      edge("c4-4", "p", "m", 1, "ground", "track", null),
      edge("closure-short", "h", "s", 0.2, "asphalt", "residential", "urban"),
      edge("closure-medium", "l", "s", 0.2, "asphalt", "residential", "urban"),
      edge("closure-in-envelope", "p", "s", 0.2, "asphalt", "residential", "urban"),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      startNodeId: "s",
      minUsefulCycleKm: 2,
    });

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 12,
      minDistanceKm: 11.2,
      maxDistanceKm: 13.5,
      requestedNaturalDwellKm: 7.5,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.metrics.distanceKm).toBeGreaterThanOrEqual(11.2);
    expect(result.metrics.distanceKm).toBeLessThanOrEqual(13.5);
    expect(result.metrics.chainTargetRepeatKm).toBe(0);
    expect(result.diagnostics.multiCycleDwellCandidates.underMinCount).toBeGreaterThan(0);
    expect(result.diagnostics.multiCycleDwellCandidates.inEnvelopeCount).toBeGreaterThan(0);
    expect(result.diagnostics.maxCycles).toBeGreaterThanOrEqual(4);
    expect(result.diagnostics.multiCycleDwellCandidates.selectedCandidate?.distanceKm).toBeGreaterThan(10.5);
  });

  it("prefers a less exact but natural in-envelope candidate over a paved distance match", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("n1", "a", "b", 1, "ground", "path", null),
      edge("n2", "b", "c", 1, "ground", "track", null),
      edge("n3", "c", "d", 1, "ground", "path", null),
      edge("n4", "d", "a", 1, "ground", "track", null),
      edge("natural-bridge", "d", "e", 0.4, "ground", "path", null),
      edge("n5", "e", "f", 1, "ground", "path", null),
      edge("n6", "f", "g", 1, "ground", "track", null),
      edge("n7", "g", "h", 1, "ground", "path", null),
      edge("n8", "h", "e", 1, "ground", "track", null),
      edge("natural-closure", "h", "s", 1.4, "asphalt", "residential", "urban"),
      edge("p1", "a", "p", 1, "ground", "path", null),
      edge("p2", "p", "q", 1, "ground", "track", null),
      edge("p3", "q", "r", 1, "ground", "path", null),
      edge("p4", "r", "a", 1, "ground", "track", null),
      edge("paved-bridge", "r", "u", 1.6, "asphalt", "service", "forest"),
      edge("p5", "u", "v", 1, "ground", "path", null),
      edge("p6", "v", "w", 1, "ground", "track", null),
      edge("p7", "w", "x", 1, "ground", "path", null),
      edge("p8", "x", "u", 1, "ground", "track", null),
      edge("paved-closure", "x", "s", 0.1, "asphalt", "residential", "urban"),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths", "forest"],
      startNodeId: "s",
      minUsefulCycleKm: 2,
    });

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths", "forest"],
      targetDistanceKm: 10,
      minDistanceKm: 7,
      maxDistanceKm: 11.5,
      requestedNaturalDwellKm: 5,
      maxCycles: 2,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.edgeIds).not.toContain("paved-bridge");
    expect(result.metrics.connectorPavedKm).toBe(0);
  });

  it("keeps overlong candidates diagnostic-only and never promotes them as product route", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("c1-1", "a", "b", 1.2, "ground", "path", null),
      edge("c1-2", "b", "c", 1.2, "ground", "track", null),
      edge("c1-3", "c", "d", 1.2, "ground", "path", null),
      edge("c1-4", "d", "a", 1.2, "ground", "track", null),
      edge("bridge", "d", "e", 0.5, "ground", "path", null),
      edge("c2-1", "e", "f", 1.2, "ground", "path", null),
      edge("c2-2", "f", "g", 1.2, "ground", "track", null),
      edge("c2-3", "g", "h", 1.2, "ground", "path", null),
      edge("c2-4", "h", "e", 1.2, "ground", "track", null),
      edge("closure", "e", "s", 0.2, "asphalt", "residential", "urban"),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      startNodeId: "s",
      minUsefulCycleKm: 2,
    });

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 7,
      minDistanceKm: 4.9,
      maxDistanceKm: 5,
      requestedNaturalDwellKm: 5,
      maxCycles: 2,
    });

    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.metrics.distanceKm).toBeGreaterThan(5);
    expect(
      result.diagnostics.multiCycleDwellCandidates.overlongCount,
    ).toBeGreaterThan(0);
    expect(
      result.diagnostics.multiCycleDwellCandidates.selectedCandidateId,
    ).toBeNull();
    expect(
      result.diagnostics.multiCycleDwellCandidates.topRejected.some(
        (candidate) => candidate.rejectedReason === "overlong",
      ),
    ).toBe(true);
  });

  it("classifies under-min returned candidates without reporting them as generated success", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.1, "asphalt", "residential", "urban"),
      edge("c1-1", "a", "b", 0.8, "ground", "path", null),
      edge("c1-2", "b", "c", 0.8, "ground", "track", null),
      edge("c1-3", "c", "a", 0.8, "ground", "path", null),
      edge("bridge", "c", "d", 0.2, "ground", "path", null),
      edge("c2-1", "d", "e", 0.8, "ground", "path", null),
      edge("c2-2", "e", "f", 0.8, "ground", "track", null),
      edge("c2-3", "f", "d", 0.8, "ground", "path", null),
      edge("closure", "d", "s", 0.1, "asphalt", "residential", "urban"),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      startNodeId: "s",
      minUsefulCycleKm: 1.5,
    });

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 10,
      minDistanceKm: 7,
      maxDistanceKm: 11.5,
      requestedNaturalDwellKm: 3,
      maxCycles: 2,
    });

    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.metrics.distanceKm).toBeLessThan(7);
    expect(
      result.diagnostics.multiCycleDwellCandidates.underMinCount,
    ).toBeGreaterThan(0);
    expect(
      result.diagnostics.multiCycleDwellCandidates.topRejected.some(
        (candidate) => candidate.rejectedReason === "under_min",
      ),
    ).toBe(true);
  });

  it("keeps several selected TrailSpine recovery alternatives in diagnostics and prefers lower paved recovery when viable", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("spine-1", "a", "b", 0.9, "ground", "path", null),
      edge("spine-2", "b", "c", 0.9, "ground", "track", null),
      edge(
        "spine-closure-check",
        "c",
        "s",
        0.35,
        "asphalt",
        "residential",
        "urban",
      ),
      edge(
        "direct-paved-recovery",
        "c",
        "d",
        0.45,
        "asphalt",
        "service",
        "forest",
      ),
      edge("beam-natural-recovery-1", "c", "x", 0.35, "ground", "path", null),
      edge("beam-natural-recovery-2", "x", "d", 0.35, "ground", "path", null),
      edge("cycle-1", "d", "e", 1.1, "ground", "path", null),
      edge("cycle-2", "e", "f", 1.1, "ground", "track", null),
      edge("cycle-3", "f", "g", 1.1, "ground", "path", null),
      edge("cycle-4", "g", "d", 1.1, "ground", "track", null),
      edge("closure", "g", "s", 0.3, "asphalt", "residential", "urban"),
    ]);
    const trailSpines = {
      spineId: "trail-spine-test",
      componentId: "field_paths-test",
      componentKind: "field_paths" as const,
      edgeIds: ["spine-1", "spine-2"],
      nodeIds: ["a", "b", "c"],
      distanceKm: 1.8,
      strictTrailKm: 1.8,
      naturalWayKm: 1.8,
      mixedUnknownKm: 0,
      pavedKm: 0,
      longestStrictTrailSegmentKm: 1.8,
      trailConfidence: 1,
      accessCostKm: 0.2,
      estimatedClosureCostKm: 0.35,
      connectorPavedRisk: 0.2,
      repeatRisk: 0,
      expansionPotentialKm: 6,
      explanation: "test spine",
    };
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      startNodeId: "s",
      minUsefulCycleKm: 2,
    });

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 7,
      minDistanceKm: 5,
      maxDistanceKm: 8,
      requestedNaturalDwellKm: 4,
      maxCycles: 2,
      beamWidth: 6,
      trailSpines: trailSpines ? [trailSpines] : [],
    });

    const diagnostics = result.diagnostics.multiCycleDwellCandidates;
    expect(diagnostics.recoveryAlternativeCount).toBeGreaterThan(1);
    expect(diagnostics.repeatAvoidanceAttemptCount).toBeGreaterThan(0);
    expect(diagnostics.pavedAvoidanceAttemptCount).toBeGreaterThan(0);
    expect(diagnostics.bestAlternativeDelta).toMatchObject({
      candidateId: expect.any(String),
    });
    expect(
      diagnostics.topRejected
        .concat(diagnostics.topCandidates)
        .some(
          (candidate) =>
            "spineCoverageRatio" in candidate &&
            candidate.spineCoverageRatio >= 0.65,
        ),
    ).toBe(true);
  });

  it("tries cycle rotation exits and closure alternatives before final candidate selection", () => {
    const fixture = graph([
      edge("access-spine", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("spine-1", "a", "b", 1.1, "ground", "path", null),
      edge("spine-2", "b", "c", 1.1, "ground", "track", null),
      edge("recovery", "c", "d", 0.2, "ground", "path", null),
      edge("cycle-1", "d", "e", 1, "ground", "path", null),
      edge("cycle-2", "e", "f", 1, "ground", "track", null),
      edge("cycle-3", "f", "g", 1, "ground", "path", null),
      edge("cycle-4", "g", "d", 1, "ground", "track", null),
      edge("paved-closure", "d", "s", 2.8, "asphalt", "service", "urban"),
      edge("clean-closure", "f", "s", 0.4, "ground", "path", null),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        {
          id: "rotatable-cycle",
          originalEdgeIds: ["cycle-1", "cycle-2", "cycle-3", "cycle-4"],
          originalNodeIds: ["d", "e", "f", "g", "d"],
          lengthKm: 4,
          naturalKm: 4,
          pavedKm: 0,
        },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 7,
      minDistanceKm: 4.9,
      maxDistanceKm: 8,
      requestedNaturalDwellKm: 4,
      maxCycles: 2,
      beamWidth: 6,
      trailSpines: [
        {
          spineId: "trail-spine-rotation",
          componentId: "field_paths-test",
          componentKind: "field_paths",
          edgeIds: ["spine-1", "spine-2"],
          nodeIds: ["a", "b", "c"],
          distanceKm: 2.2,
          strictTrailKm: 2.2,
          naturalWayKm: 2.2,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 2.2,
          trailConfidence: 1,
          accessCostKm: 0.2,
          estimatedClosureCostKm: 0.4,
          connectorPavedRisk: 0.1,
          repeatRisk: 0,
          expansionPotentialKm: 4,
          explanation: "test cycle rotation and closure alternatives",
        },
      ],
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.edgeIds).toContain("clean-closure");
    expect(result.edgeIds).not.toContain("paved-closure");
    expect(
      result.diagnostics.multiCycleDwellCandidates.cycleRotationAttemptCount,
    ).toBeGreaterThan(1);
    expect(
      result.diagnostics.multiCycleDwellCandidates.closureAlternativeCount,
    ).toBeGreaterThan(1);
    expect(
      result.diagnostics.multiCycleDwellCandidates.selectedCandidate?.source,
    ).toBe("cycle-rotation-closure");
  });

  it("keeps closure alternatives diagnostic-only when reduced repeat would break paved gates", () => {
    const fixture = graph([
      edge("access-spine", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("spine-1", "a", "b", 1.1, "ground", "path", null),
      edge("spine-2", "b", "c", 1.1, "ground", "track", null),
      edge("recovery", "c", "d", 0.2, "ground", "path", null),
      edge("cycle-1", "d", "e", 1, "ground", "path", null),
      edge("cycle-2", "e", "f", 1, "ground", "track", null),
      edge("cycle-3", "f", "g", 1, "ground", "path", null),
      edge("cycle-4", "g", "d", 1, "ground", "track", null),
      edge("paved-closure-a", "f", "p", 2.2, "asphalt", "service", "urban"),
      edge("paved-closure-b", "p", "s", 2.2, "asphalt", "service", "urban"),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        {
          id: "rotatable-cycle",
          originalEdgeIds: ["cycle-1", "cycle-2", "cycle-3", "cycle-4"],
          originalNodeIds: ["d", "e", "f", "g", "d"],
          lengthKm: 4,
          naturalKm: 4,
          pavedKm: 0,
        },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 10,
      minDistanceKm: 7,
      maxDistanceKm: 11.5,
      requestedNaturalDwellKm: 4,
      maxCycles: 2,
      beamWidth: 6,
      trailSpines: [
        {
          spineId: "trail-spine-paved-closure",
          componentId: "field_paths-test",
          componentKind: "field_paths",
          edgeIds: ["spine-1", "spine-2"],
          nodeIds: ["a", "b", "c"],
          distanceKm: 2.2,
          strictTrailKm: 2.2,
          naturalWayKm: 2.2,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 2.2,
          trailConfidence: 1,
          accessCostKm: 0.2,
          estimatedClosureCostKm: 0.4,
          connectorPavedRisk: 0.1,
          repeatRisk: 0,
          expansionPotentialKm: 4,
          explanation: "test paved closure refusal",
        },
      ],
    });

    expect(result.status).toBe("failure");
    expect(
      result.diagnostics.multiCycleDwellCandidates.selectedCandidateId,
    ).toBeNull();
    expect(
      result.diagnostics.multiCycleDwellCandidates.closureAlternativeCount,
    ).toBeGreaterThan(0);
    expect(
      result.diagnostics.multiCycleDwellCandidates.topRejected.some(
        (candidate) => candidate.rejectedReason === "excessive_paved",
      ),
    ).toBe(true);
  });

  it("exposes recovery repeat root cause when selected TrailSpine recovery repeats target pairs", () => {
    const fixture = graph([
      edge("access-spine", "s", "a", 0.1, "asphalt", "residential", "urban"),
      edge("spine-1", "a", "b", 1, "ground", "path", null),
      edge("spine-2", "b", "c", 1, "ground", "track", null),
      edge("spine-3", "c", "d", 1, "ground", "path", null),
      edge("recovery-repeat", "d", "c", 0.25, "ground", "path", null),
      edge("cycle-1", "c", "e", 1, "ground", "path", null),
      edge("cycle-2", "e", "c", 1, "ground", "track", null),
      edge("closure", "e", "s", 0.2, "asphalt", "residential", "urban"),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        {
          id: "cycle-after-repeat",
          originalEdgeIds: ["cycle-1", "cycle-2"],
          originalNodeIds: ["c", "e", "c"],
          lengthKm: 2,
          naturalKm: 2,
          pavedKm: 0,
        },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 4.5,
      minDistanceKm: 3,
      maxDistanceKm: 5.5,
      requestedNaturalDwellKm: 3,
      maxCycles: 2,
      beamWidth: 6,
      trailSpines: [
        {
          spineId: "trail-spine-repeat-root",
          componentId: "field_paths-test",
          componentKind: "field_paths",
          edgeIds: ["spine-1", "spine-2", "spine-3"],
          nodeIds: ["a", "b", "c", "d"],
          distanceKm: 3,
          strictTrailKm: 3,
          naturalWayKm: 3,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 3,
          trailConfidence: 1,
          accessCostKm: 0.1,
          estimatedClosureCostKm: 0.2,
          connectorPavedRisk: 0.1,
          repeatRisk: 0,
          expansionPotentialKm: 5,
          explanation: "test recovery repeat root cause",
        },
      ],
    });

    const anchor = result.diagnostics.trailSpineAnchor;
    expect(anchor.targetRepeatFreeRecoveryAttemptCount).toBeGreaterThan(0);
    expect(anchor.recoveryRepeatRootCause).toBe(
      "selected_spine_to_cycle_recovery",
    );
    expect(anchor.repeatedRecoveryPairKeys).toContain("c::d");
    expect(
      anchor.targetRepeatFreeRecoveryRejectedReasons.map(
        (entry) => entry.reason,
      ),
    ).toContain("candidate_excessive_repeat");
  });

  it("exposes sub-spine endpoint adjustment when a credible shorter TrailSpine avoids recovery repeat", () => {
    const fixture = graph([
      edge("access-spine", "s", "a", 0.1, "asphalt", "residential", "urban"),
      edge("spine-1", "a", "b", 1, "ground", "path", null),
      edge("spine-2", "b", "c", 1, "ground", "track", null),
      edge("spine-3", "c", "d", 1, "ground", "path", null),
      edge("recovery-repeat", "d", "c", 0.25, "ground", "path", null),
      edge("clean-subspine-closure", "c", "s", 0.2, "ground", "path", null),
      edge("cycle-1", "c", "e", 0.4, "ground", "path", null),
      edge("cycle-2", "e", "c", 0.4, "ground", "track", null),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        {
          id: "small-cycle",
          originalEdgeIds: ["cycle-1", "cycle-2"],
          originalNodeIds: ["c", "e", "c"],
          lengthKm: 0.8,
          naturalKm: 0.8,
          pavedKm: 0,
        },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 3,
      minDistanceKm: 2,
      maxDistanceKm: 3.5,
      requestedNaturalDwellKm: 2,
      maxCycles: 2,
      beamWidth: 6,
      trailSpines: [
        {
          spineId: "trail-spine-sub-endpoint",
          componentId: "field_paths-test",
          componentKind: "field_paths",
          edgeIds: ["spine-1", "spine-2", "spine-3"],
          nodeIds: ["a", "b", "c", "d"],
          distanceKm: 3,
          strictTrailKm: 3,
          naturalWayKm: 3,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 3,
          trailConfidence: 1,
          accessCostKm: 0.1,
          estimatedClosureCostKm: 0.2,
          connectorPavedRisk: 0.1,
          repeatRisk: 0,
          expansionPotentialKm: 5,
          explanation: "test sub-spine endpoint adjustment",
        },
      ],
    });

    expect(result.status).toBe("success");
    const anchor = result.diagnostics.trailSpineAnchor;
    expect(anchor.selectedSpineEndpointAdjusted).toBe(true);
    expect(anchor.selectedSpineAdjustedReason).toBe(
      "sub_spine_endpoint_avoids_recovery_repeat_or_distance_risk",
    );
    expect(anchor.subSpineCoverageRatio).toBeGreaterThanOrEqual(0.65);
    expect(anchor.subSpineCoverageRatio).toBeLessThan(1);
    expect(anchor.subSpineReason).toBe(
      "credible_sub_spine_preserved_strict_trail_moment",
    );
  });

  it("keeps road_like_unknown out of strict TrailSpine credit even when a connector exists", () => {
    const fixture = graph([
      edge("unknown-road-1", "s", "a", 0.8, "", "residential", null),
      edge("unknown-road-2", "a", "b", 0.8, "", "service", null),
      edge("unknown-road-3", "b", "c", 0.8, "", "unclassified", null),
      edge("real-cycle-1", "c", "d", 1, "ground", "path", null),
      edge("real-cycle-2", "d", "c", 1, "ground", "track", null),
    ]);

    const selected = selectTrailSpinesV3({
      graph: fixture,
      startNodeId: "s",
      targetComponentIds: ["field_paths"],
      minDistanceKm: 0.5,
    }).selected;
    expect(selected?.edgeIds ?? []).not.toContain("unknown-road-1");
    expect(selected?.strictTrailKm ?? 0).toBeGreaterThan(0);
    expect(selected?.mixedUnknownKm ?? 0).toBe(0);
  });

  it("selects an alternative credible TrailSpine when original endpoint forces target repeat recovery", () => {
    const fixture = graph([
      edge("access-original", "s", "a", 0.1, "asphalt", "residential", "urban"),
      edge("orig-1", "a", "b", 1, "ground", "path", null),
      edge("orig-2", "b", "c", 1, "ground", "track", null),
      edge("orig-3", "c", "d", 1, "ground", "path", null),
      edge("orig-repeat", "d", "c", 0.2, "ground", "path", null),
      edge("access-alt", "s", "u", 0.1, "asphalt", "residential", "urban"),
      edge("alt-1", "u", "v", 1, "ground", "path", null),
      edge("alt-2", "v", "w", 1, "ground", "track", null),
      edge("alt-clean-recovery", "w", "x", 0.2, "ground", "path", null),
      edge("cycle-1", "x", "y", 0.9, "ground", "path", null),
      edge("cycle-2", "y", "z", 0.9, "ground", "track", null),
      edge("cycle-3", "z", "x", 0.9, "ground", "path", null),
      edge("closure", "x", "s", 0.2, "asphalt", "residential", "urban"),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        {
          id: "cycle",
          originalEdgeIds: ["cycle-1", "cycle-2", "cycle-3"],
          originalNodeIds: ["x", "y", "z", "x"],
          lengthKm: 2.7,
          naturalKm: 2.7,
          pavedKm: 0,
        },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 5.3,
      minDistanceKm: 3.7,
      maxDistanceKm: 6.2,
      requestedNaturalDwellKm: 3,
      maxCycles: 2,
      beamWidth: 6,
      trailSpines: [
        {
          spineId: "original-repeat-spine",
          componentId: "field_paths-test",
          componentKind: "field_paths",
          edgeIds: ["orig-1", "orig-2", "orig-3"],
          nodeIds: ["a", "b", "c", "d"],
          distanceKm: 3,
          strictTrailKm: 3,
          naturalWayKm: 3,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 3,
          trailConfidence: 1,
          accessCostKm: 0.1,
          estimatedClosureCostKm: 0.2,
          connectorPavedRisk: 0.1,
          repeatRisk: 0,
          expansionPotentialKm: 5,
          explanation: "original endpoint repeats target to reach cycle",
        },
        {
          spineId: "alternative-clean-spine",
          componentId: "field_paths-test",
          componentKind: "field_paths",
          edgeIds: ["alt-1", "alt-2"],
          nodeIds: ["u", "v", "w"],
          distanceKm: 2,
          strictTrailKm: 2,
          naturalWayKm: 2,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 2,
          trailConfidence: 1,
          accessCostKm: 0.1,
          estimatedClosureCostKm: 0.2,
          connectorPavedRisk: 0.1,
          repeatRisk: 0,
          expansionPotentialKm: 5,
          explanation: "alternative endpoint reaches cycle cleanly",
        },
      ],
    });

    expect(result.status).toBe("success");
    expect(result.edgeIds).toEqual(
      expect.arrayContaining([
        "alt-1",
        "alt-2",
        "alt-clean-recovery",
        "cycle-1",
      ]),
    );
    expect(result.edgeIds).not.toEqual(
      expect.arrayContaining(["orig-1", "orig-2", "orig-3"]),
    );
    const anchor = result.diagnostics.trailSpineAnchor;
    expect(anchor.originalSelectedSpineId).toBe("original-repeat-spine");
    expect(anchor.selectedSpineId).toBe("alternative-clean-spine");
    expect(anchor.alternativeSpineCount).toBe(1);
    expect(anchor.consideredSpineIds).toEqual([
      "original-repeat-spine",
      "alternative-clean-spine",
    ]);
    expect(anchor.alternativeSpineReason).toContain(
      "alternative_spine_selected_for_cycle_compatible_endpoint",
    );
    expect(anchor.recoveryRepeatKm).toBe(0);
    expect(anchor.endpointCycleCompatibilityScore).toBeGreaterThan(0);
    expect(
      result.diagnostics.multiCycleDwellCandidates.selectedCandidate?.source,
    ).toBe("alternative-trail-spine-recovery");
  });

  it("rejects a low-strict-trail alternative even when its endpoint has less repeat", () => {
    const fixture = graph([
      edge("access-original", "s", "a", 0.1, "asphalt", "residential", "urban"),
      edge("orig-1", "a", "b", 1, "ground", "path", null),
      edge("orig-2", "b", "c", 1, "ground", "track", null),
      edge("orig-3", "c", "d", 1, "ground", "path", null),
      edge("orig-repeat", "d", "c", 0.2, "ground", "path", null),
      edge("weak-unknown-1", "u", "v", 1, "", "path", "forest"),
      edge("weak-clean-recovery", "v", "x", 0.2, "ground", "path", null),
      edge("cycle-1", "x", "y", 1, "ground", "path", null),
      edge("cycle-2", "y", "x", 1, "ground", "track", null),
      edge("closure", "x", "s", 0.2, "asphalt", "residential", "urban"),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        {
          id: "cycle",
          originalEdgeIds: ["cycle-1", "cycle-2"],
          originalNodeIds: ["x", "y", "x"],
          lengthKm: 2,
          naturalKm: 2,
          pavedKm: 0,
        },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths", "forest"],
      targetDistanceKm: 5,
      minDistanceKm: 3,
      maxDistanceKm: 6,
      requestedNaturalDwellKm: 2,
      trailSpines: [
        {
          spineId: "original-repeat-spine",
          componentId: "field_paths-test",
          componentKind: "field_paths",
          edgeIds: ["orig-1", "orig-2", "orig-3"],
          nodeIds: ["a", "b", "c", "d"],
          distanceKm: 3,
          strictTrailKm: 3,
          naturalWayKm: 3,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 3,
          trailConfidence: 1,
          accessCostKm: 0.1,
          estimatedClosureCostKm: 0.2,
          connectorPavedRisk: 0.1,
          repeatRisk: 0,
          expansionPotentialKm: 5,
          explanation: "original",
        },
        {
          spineId: "weak-unknown-spine",
          componentId: "forest-test",
          componentKind: "forest",
          edgeIds: ["weak-unknown-1"],
          nodeIds: ["u", "v"],
          distanceKm: 1,
          strictTrailKm: 0,
          naturalWayKm: 1,
          mixedUnknownKm: 1,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 0,
          trailConfidence: 0.6,
          accessCostKm: 0.1,
          estimatedClosureCostKm: 0.2,
          connectorPavedRisk: 0.1,
          repeatRisk: 0,
          expansionPotentialKm: 2,
          explanation: "weak unknown",
        },
      ],
    });

    const anchor = result.diagnostics.trailSpineAnchor;
    expect(anchor.selectedSpineId).toBe("original-repeat-spine");
    expect(
      anchor.alternativeSpines.find(
        (candidate) => candidate.spineId === "weak-unknown-spine",
      )?.rejectedReasons,
    ).toEqual(
      expect.arrayContaining([
        "insufficient_spine_distance",
        "insufficient_strict_trail",
        "insufficient_strict_continuity",
      ]),
    );
  });

  it("rejects a lower-repeat alternative when its recovery is paved-heavy", () => {
    const fixture = graph([
      edge("access-original", "s", "a", 0.1, "asphalt", "residential", "urban"),
      edge("orig-1", "a", "b", 1, "ground", "path", null),
      edge("orig-2", "b", "c", 1, "ground", "track", null),
      edge("orig-3", "c", "d", 1, "ground", "path", null),
      edge("orig-repeat", "d", "c", 0.2, "ground", "path", null),
      edge("access-alt-paved", "s", "u", 0.1, "asphalt", "residential", "urban"),
      edge("alt-1", "u", "v", 1.2, "ground", "path", null),
      edge("alt-2", "v", "w", 1.2, "ground", "track", null),
      edge("paved-alt-recovery", "w", "x", 2.4, "asphalt", "service", "forest"),
      edge("cycle-1", "x", "y", 1, "ground", "path", null),
      edge("cycle-2", "y", "x", 1, "ground", "track", null),
      edge("closure", "x", "s", 0.2, "asphalt", "residential", "urban"),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [
        {
          id: "cycle",
          originalEdgeIds: ["cycle-1", "cycle-2"],
          originalNodeIds: ["x", "y", "x"],
          lengthKm: 2,
          naturalKm: 2,
          pavedKm: 0,
        },
      ],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;
    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths", "forest"],
      targetDistanceKm: 6,
      minDistanceKm: 4,
      maxDistanceKm: 7,
      requestedNaturalDwellKm: 3,
      trailSpines: [
        {
          spineId: "original-repeat-spine",
          componentId: "field_paths-test",
          componentKind: "field_paths",
          edgeIds: ["orig-1", "orig-2", "orig-3"],
          nodeIds: ["a", "b", "c", "d"],
          distanceKm: 3,
          strictTrailKm: 3,
          naturalWayKm: 3,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 3,
          trailConfidence: 1,
          accessCostKm: 0.1,
          estimatedClosureCostKm: 0.2,
          connectorPavedRisk: 0.1,
          repeatRisk: 0,
          expansionPotentialKm: 5,
          explanation: "original",
        },
        {
          spineId: "paved-recovery-alt",
          componentId: "field_paths-test",
          componentKind: "field_paths",
          edgeIds: ["alt-1", "alt-2"],
          nodeIds: ["u", "v", "w"],
          distanceKm: 2.4,
          strictTrailKm: 2.4,
          naturalWayKm: 2.4,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 2.4,
          trailConfidence: 1,
          accessCostKm: 0.1,
          estimatedClosureCostKm: 0.2,
          connectorPavedRisk: 0.1,
          repeatRisk: 0,
          expansionPotentialKm: 4,
          explanation: "paved recovery alt",
        },
      ],
    });

    const alt = result.diagnostics.trailSpineAnchor.alternativeSpines.find(
      (candidate) => candidate.spineId === "paved-recovery-alt",
    );
    expect(result.diagnostics.trailSpineAnchor.selectedSpineId).toBe(
      "original-repeat-spine",
    );
    expect(alt?.rejectedReasons).toContain("recovery_paved_risk");
    expect(alt?.recoveryPavedKm).toBeGreaterThan(0.8);
  });

  it("refuses with considered TrailSpine diagnostics when no alternative has a cycle-compatible endpoint", () => {
    const fixture = graph([
      edge("access-original", "s", "a", 0.1, "asphalt", "residential", "urban"),
      edge("orig-1", "a", "b", 1, "ground", "path", null),
      edge("orig-2", "b", "c", 1, "ground", "track", null),
      edge("alt-1", "u", "v", 1, "ground", "path", null),
      edge("alt-2", "v", "w", 1, "ground", "track", null),
    ]);
    const contraction = {
      corridors: [],
      cycleCandidates: [],
      diagnostics: { jaccardDedupCount: 0 },
    } as unknown as ReturnType<typeof contractNaturalGraphV3>;
    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 6,
      requestedNaturalDwellKm: 3,
      trailSpines: [
        {
          spineId: "original-no-cycle",
          componentId: "field_paths-test",
          componentKind: "field_paths",
          edgeIds: ["orig-1", "orig-2"],
          nodeIds: ["a", "b", "c"],
          distanceKm: 2,
          strictTrailKm: 2,
          naturalWayKm: 2,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 2,
          trailConfidence: 1,
          accessCostKm: 0.1,
          estimatedClosureCostKm: 0.2,
          connectorPavedRisk: 0.1,
          repeatRisk: 0,
          expansionPotentialKm: 2,
          explanation: "no cycle original",
        },
        {
          spineId: "alternative-no-cycle",
          componentId: "field_paths-test",
          componentKind: "field_paths",
          edgeIds: ["alt-1", "alt-2"],
          nodeIds: ["u", "v", "w"],
          distanceKm: 2,
          strictTrailKm: 2,
          naturalWayKm: 2,
          mixedUnknownKm: 0,
          pavedKm: 0,
          longestStrictTrailSegmentKm: 2,
          trailConfidence: 1,
          accessCostKm: 0.1,
          estimatedClosureCostKm: 0.2,
          connectorPavedRisk: 0.1,
          repeatRisk: 0,
          expansionPotentialKm: 2,
          explanation: "no cycle alt",
        },
      ],
    });

    expect(result.status).toBe("failure");
    const anchor = result.diagnostics.trailSpineAnchor;
    expect(anchor.consideredSpineIds).toEqual([
      "original-no-cycle",
      "alternative-no-cycle",
    ]);
    expect(anchor.alternativeSpineCount).toBe(1);
    expect(
      anchor.alternativeSpines.every((candidate) =>
        candidate.recoveryRejectedReasons.some(
          (entry) => entry.reason === "no_path",
        ),
      ),
    ).toBe(true);
  });

  it("exposes rejected reasons for overlong, under-min, paved, repeat, and dominated candidates", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("good-1", "a", "b", 1, "ground", "path", null),
      edge("good-2", "b", "c", 1, "ground", "track", null),
      edge("good-3", "c", "d", 1, "ground", "path", null),
      edge("good-4", "d", "a", 1, "ground", "track", null),
      edge("good-bridge", "d", "e", 0.3, "ground", "path", null),
      edge("good-5", "e", "f", 1, "ground", "path", null),
      edge("good-6", "f", "g", 1, "ground", "track", null),
      edge("good-7", "g", "h", 1, "ground", "path", null),
      edge("good-8", "h", "e", 1, "ground", "track", null),
      edge("good-closure", "h", "s", 0.2, "asphalt", "residential", "urban"),
      edge("under-1", "a", "u1", 0.6, "ground", "path", null),
      edge("under-2", "u1", "u2", 0.6, "ground", "track", null),
      edge("under-3", "u2", "a", 0.6, "ground", "path", null),
      edge("paved-link", "d", "p1", 2.5, "asphalt", "service", "forest"),
      edge("paved-1", "p1", "p2", 1, "ground", "path", null),
      edge("paved-2", "p2", "p3", 1, "ground", "track", null),
      edge("paved-3", "p3", "p1", 1, "ground", "path", null),
      edge("over-link", "h", "o1", 0.3, "ground", "path", null),
      edge("over-1", "o1", "o2", 1.5, "ground", "path", null),
      edge("over-2", "o2", "o3", 1.5, "ground", "track", null),
      edge("over-3", "o3", "o4", 1.5, "ground", "path", null),
      edge("over-4", "o4", "o1", 1.5, "ground", "track", null),
      edge("over-closure", "o4", "s", 0.2, "asphalt", "residential", "urban"),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths", "forest"],
      startNodeId: "s",
      minUsefulCycleKm: 1.5,
    });

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths", "forest"],
      targetDistanceKm: 10,
      minDistanceKm: 7,
      maxDistanceKm: 11.5,
      requestedNaturalDwellKm: 4,
      maxCycles: 3,
      beamWidth: 12,
    });

    expect(result.diagnostics.multiCycleDwellCandidates.count).toBeGreaterThan(
      1,
    );
    const reasons =
      result.diagnostics.multiCycleDwellCandidates.topRejected.map(
        (candidate) => candidate.rejectedReason,
      );
    expect(reasons).toContain("under_min");
    expect(reasons).toContain("excessive_paved");
    expect(reasons).toContain("dominated");
    expect(reasons).toContain("excessive_repeat");
    const rejectedSummary =
      result.diagnostics.multiCycleDwellCandidates.topRejected.find(
        (candidate) => "finalPavedRatioEstimate" in candidate,
      );
    expect(rejectedSummary).toMatchObject({
      explicitPavedKm: expect.any(Number),
      mixedUnknownKm: expect.any(Number),
      finalPavedEquivalentKm: expect.any(Number),
      finalPavedRatioEstimate: expect.any(Number),
      strictNaturalKm: expect.any(Number),
      naturalWayEquivalentKm: expect.any(Number),
      estimatedLongestStrictTrailSegmentKm: expect.any(Number),
    });
  });

  it("bounds dense multi-cycle pruning and preserves paved accounting in access connectors and closure", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.4, "asphalt", "residential", "urban"),
      edge("c1-1", "a", "b", 1, "ground", "path", null),
      edge("c1-2", "b", "c", 1, "ground", "track", null),
      edge("c1-3", "c", "d", 1, "ground", "path", null),
      edge("c1-4", "d", "a", 1, "ground", "track", null),
      edge("c2-1", "d", "e", 0.2, "ground", "path", null),
      edge("c2-2", "e", "f", 1, "ground", "path", null),
      edge("c2-3", "f", "g", 1, "ground", "track", null),
      edge("c2-4", "g", "h", 1, "ground", "path", null),
      edge("c2-5", "h", "e", 1, "ground", "track", null),
      edge("c3-1", "h", "i", 0.2, "ground", "path", null),
      edge("c3-2", "i", "j", 1, "ground", "path", null),
      edge("c3-3", "j", "k", 1, "ground", "track", null),
      edge("c3-4", "k", "l", 1, "ground", "path", null),
      edge("c3-5", "l", "i", 1, "ground", "track", null),
      edge("dense-ac", "a", "c", 0.1, "ground", "path", null),
      edge("dense-bd", "b", "d", 0.1, "ground", "path", null),
      edge("dense-eg", "e", "g", 0.1, "ground", "path", null),
      edge("dense-fh", "f", "h", 0.1, "ground", "path", null),
      edge("paved-closure", "h", "s", 0.6, "asphalt", "residential", "urban"),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      startNodeId: "s",
      minUsefulCycleKm: 1.5,
    });

    const result = planMultiCycleDwellV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 10,
      minDistanceKm: 7,
      maxDistanceKm: 11.5,
      requestedNaturalDwellKm: 5,
      maxCycles: 3,
      beamWidth: 4,
    });

    expect(result.diagnostics.beamWidth).toBe(4);
    expect(result.diagnostics.prunedCandidateCount).toBeGreaterThan(0);
    expect(
      result.diagnostics.multiCycleDwellCandidates.count,
    ).toBeLessThanOrEqual(24);
    if (result.status === "success") {
      expect(result.metrics.accessKm).toBeCloseTo(0.4, 3);
      expect(result.metrics.closurePavedKm).toBeGreaterThan(0);
      expect(result.metrics.pavedKm).toBeGreaterThanOrEqual(
        result.metrics.accessKm + result.metrics.closurePavedKm - 0.001,
      );
    }
  });
});

describe("buildOrderedCycleExpansionV3", () => {
  it("expands a simple accessible contracted cycle into a continuous original edge chain", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.25, "asphalt", "residential", "urban"),
      edge("cycle-1", "a", "b", 1, "ground", "path", null),
      edge("cycle-2", "b", "c", 1, "ground", "track", null),
      edge("cycle-3", "c", "d", 1, "ground", "path", null),
      edge("cycle-4", "d", "a", 1, "ground", "track", null),
      edge("closure", "a", "s", 0.25, "asphalt", "residential", "urban"),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      startNodeId: "s",
      minUsefulCycleKm: 2,
    });

    const result = buildOrderedCycleExpansionV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 6,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.core.originalEdgeIds).toEqual([
      "cycle-1",
      "cycle-2",
      "cycle-3",
      "cycle-4",
    ]);
    expect(result.edgeIds).toEqual([
      "access",
      "cycle-1",
      "cycle-2",
      "cycle-3",
      "cycle-4",
      "closure",
    ]);
    expect(result.validation.continuous).toBe(true);
    expect(result.metrics.naturalCycleKm).toBeCloseTo(4, 3);
  });

  it("preserves degree-2 corridor order, length, surface accounting, and original edge ids", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("corridor-1", "a", "b", 0.6, "ground", "path", null),
      edge("corridor-2", "b", "c", 0.7, "gravel", "track", null),
      edge("corridor-3", "c", "d", 0.8, "ground", "path", null),
      edge("corridor-4", "d", "a", 0.9, "ground", "track", null),
      edge("closure", "a", "s", 0.2, "asphalt", "residential", "urban"),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      startNodeId: "s",
      minUsefulCycleKm: 2,
    });

    const result = buildOrderedCycleExpansionV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 5,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.core.originalEdgeIds).toEqual([
      "corridor-1",
      "corridor-2",
      "corridor-3",
      "corridor-4",
    ]);
    expect(result.core.lengthKm).toBeCloseTo(3, 3);
    expect(result.metrics.naturalCycleKm).toBeCloseTo(3, 3);
    expect(result.metrics.pavedKm).toBeCloseTo(0.4, 3);
  });

  it("refuses ambiguous discontinuous cycle expansion with a phase-level reason", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("cycle-1", "a", "b", 1, "ground", "path", null),
      edge("cycle-2", "b", "c", 1, "ground", "path", null),
      edge("island-1", "x", "y", 1, "ground", "path", null),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      startNodeId: "s",
      minUsefulCycleKm: 0.5,
    });
    const patched = {
      ...contraction,
      cycleCandidates: [
        {
          id: "debug-discontinuous",
          originalNodeIds: ["a", "b", "c", "x", "y"],
          originalEdgeIds: ["cycle-1", "cycle-2", "island-1"],
          lengthKm: 3,
          corridorIds: [],
          qualityScore: 3,
        },
      ],
    };

    const result = buildOrderedCycleExpansionV3({
      graph: fixture,
      startNodeId: "s",
      contraction: patched,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 5,
    });

    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.reason).toBe("invalid_cycle_expansion");
    expect(result.validation.continuous).toBe(false);
  });

  it("prefers a natural cycle continuation over an early short paved closure when distance remains acceptable", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.25, "asphalt", "residential", "urban"),
      edge(
        "early-paved-closure",
        "a",
        "s",
        0.3,
        "asphalt",
        "residential",
        "urban",
      ),
      edge("cycle-1", "a", "b", 1.1, "ground", "path", null),
      edge("cycle-2", "b", "c", 1.1, "ground", "track", null),
      edge("cycle-3", "c", "d", 1.1, "ground", "path", null),
      edge("cycle-4", "d", "a", 1.1, "ground", "track", null),
      edge("closure", "a", "s", 0.25, "asphalt", "residential", "urban"),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths"],
      startNodeId: "s",
      minUsefulCycleKm: 2,
    });

    const result = buildOrderedCycleExpansionV3({
      graph: fixture,
      startNodeId: "s",
      contraction,
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 6,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.edgeIds).toContain("cycle-4");
    expect(result.edgeIds).not.toEqual(["access", "early-paved-closure"]);
    expect(result.metrics.naturalCycleKm).toBeGreaterThan(4);
  });

  it("keeps paved surfaces inside the selected corridor counted as paved", () => {
    const fixture = graph([
      edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
      edge("cycle-1", "a", "b", 1, "ground", "path", null),
      edge("paved-in-woods", "b", "c", 0.5, "asphalt", "service", "forest"),
      edge("cycle-2", "c", "d", 1, "ground", "track", null),
      edge("cycle-3", "d", "a", 1, "ground", "path", null),
      edge("closure", "a", "s", 0.2, "asphalt", "residential", "urban"),
    ]);
    const contraction = contractNaturalGraphV3({
      graph: fixture,
      targetComponentIds: ["field_paths", "forest"],
      startNodeId: "s",
      minUsefulCycleKm: 2,
    });
    const patched = {
      ...contraction,
      cycleCandidates: [
        {
          id: "mixed-surface-cycle",
          originalNodeIds: ["a", "b", "c", "d"],
          originalEdgeIds: ["cycle-1", "paved-in-woods", "cycle-2", "cycle-3"],
          lengthKm: 3.5,
          corridorIds: [],
          qualityScore: 3.5,
        },
      ],
    };

    const result = buildOrderedCycleExpansionV3({
      graph: fixture,
      startNodeId: "s",
      contraction: patched,
      targetComponentIds: ["field_paths", "forest"],
      targetDistanceKm: 5,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.core.originalEdgeIds).toEqual([
      "cycle-1",
      "paved-in-woods",
      "cycle-2",
      "cycle-3",
    ]);
    expect(result.metrics.naturalCycleKm).toBeCloseTo(3, 3);
    expect(result.metrics.pavedKm).toBeCloseTo(0.9, 3);
  });
});

describe("buildTargetComponentTraversal", () => {
  it("finds a long clean target loop in a linear-plus-cycle natural component", () => {
    const result = buildTargetComponentTraversal({
      graph: graph([
        edge("access", "s", "a", 0.4, "asphalt", "residential", "urban"),
        edge("linear-entry", "a", "b", 0.2, "ground", "path", null),
        edge("cycle-1", "b", "c", 1.2, "ground", "path", null),
        edge("cycle-2", "c", "d", 1.2, "ground", "track", null),
        edge("cycle-3", "d", "e", 1.2, "ground", "path", null),
        edge("cycle-4", "e", "b", 1.2, "ground", "track", null),
        edge("closure", "b", "s", 0.4, "asphalt", "residential", "urban"),
      ]),
      startNodeId: "s",
      entryNodeId: "a",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 6,
      minDistanceRatio: 0.7,
      maxDistanceRatio: 1.25,
      usedEdgeKeys: new Set(["access"]),
      forbidTargetRepeat: true,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.distanceKm).toBeGreaterThanOrEqual(4.2);
    expect(result.repeatedTargetKm).toBe(0);
    expect(result.edgeIds).toEqual([
      "linear-entry",
      "cycle-1",
      "cycle-2",
      "cycle-3",
      "cycle-4",
      "closure",
    ]);
    expect(result.closure.connectorRepeatKm).toBe(0);
  });

  it("refuses branchy target teeth whose raw capacity requires target repeat to exploit", () => {
    const teeth = Array.from({ length: 8 }, (_, index) =>
      edge(
        `tooth-${index + 1}`,
        `spine${index}`,
        `leaf${index + 1}`,
        0.55,
        "ground",
        "path",
        null,
      ),
    );
    const spine = Array.from({ length: 8 }, (_, index) =>
      edge(
        `spine-${index + 1}`,
        `spine${index}`,
        `spine${index + 1}`,
        0.18,
        "ground",
        "track",
        null,
      ),
    );

    const result = buildTargetComponentTraversal({
      graph: graph([
        edge("access", "s", "spine0", 0.3, "asphalt", "residential", "urban"),
        ...spine,
        ...teeth,
        edge("closure", "spine8", "s", 0.3, "asphalt", "residential", "urban"),
      ]),
      startNodeId: "s",
      entryNodeId: "spine0",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 7,
      minDistanceRatio: 0.7,
      maxDistanceRatio: 1.25,
      usedEdgeKeys: new Set(["access"]),
      forbidTargetRepeat: true,
    });

    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.diagnostics.reachableTargetKm).toBeGreaterThan(5);
    expect(result.diagnostics.exploitableTargetKm).toBeLessThan(1);
    expect(result.diagnostics.blocker).toBe("branch_repeat_limited");
    expect(result.diagnostics.bestPartialDistanceKm).toBeGreaterThan(0);
  });

  it("splits repeated access connector from non-repeated target traversal", () => {
    const result = buildTargetComponentTraversal({
      graph: graph([
        edge("access", "s", "a", 0.5, "asphalt", "residential", "urban"),
        edge("cycle-1", "a", "b", 1.2, "ground", "path", null),
        edge("cycle-2", "b", "c", 1.2, "ground", "track", null),
        edge("cycle-3", "c", "a", 1.2, "ground", "path", null),
      ]),
      startNodeId: "s",
      entryNodeId: "a",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 4.5,
      minDistanceRatio: 0.7,
      maxDistanceRatio: 1.25,
      usedEdgeKeys: new Set(["access"]),
      forbidTargetRepeat: true,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.repeatedTargetKm).toBe(0);
    expect(result.closure.connectorRepeatKm).toBeGreaterThan(0);
    expect(result.closure.targetRepeatKm).toBe(0);
    expect(result.edgeIds.at(-1)).toBe("access");
  });

  it("refuses impossible target capacity without emitting a product-valid route", () => {
    const result = buildTargetComponentTraversal({
      graph: graph([
        edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
        edge("tiny-1", "a", "b", 0.3, "ground", "path", null),
        edge("tiny-2", "b", "c", 0.3, "ground", "track", null),
        edge("tiny-3", "c", "a", 0.3, "ground", "path", null),
        edge("closure", "a", "s", 0.2, "asphalt", "residential", "urban"),
      ]),
      startNodeId: "s",
      entryNodeId: "a",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 8,
      minDistanceRatio: 0.7,
      maxDistanceRatio: 1.25,
      usedEdgeKeys: new Set(["access"]),
      forbidTargetRepeat: true,
    });

    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.diagnostics.reachableTargetKm).toBeCloseTo(0.9, 3);
    expect(result.diagnostics.exploitableTargetKm).toBeCloseTo(0.9, 3);
    expect(result.diagnostics.bestPartialDistanceKm).toBeCloseTo(1.1, 3);
    expect(result.diagnostics.unusedTargetKm).toBe(0);
  });

  it("does not report bridge-separated core capacity as cleanly exploitable from the selected entry", () => {
    const result = buildTargetComponentTraversal({
      graph: graph([
        edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
        edge("near-cycle-1", "a", "b", 0.8, "ground", "path", null),
        edge("near-cycle-2", "b", "c", 0.8, "ground", "track", null),
        edge("near-cycle-3", "c", "a", 0.8, "ground", "path", null),
        edge("single-bridge", "c", "d", 0.2, "ground", "path", null),
        edge("far-cycle-1", "d", "e", 1.4, "ground", "path", null),
        edge("far-cycle-2", "e", "f", 1.4, "ground", "track", null),
        edge("far-cycle-3", "f", "d", 1.4, "ground", "path", null),
        edge("closure", "a", "s", 0.2, "asphalt", "residential", "urban"),
      ]),
      startNodeId: "s",
      entryNodeId: "a",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 7,
      minDistanceRatio: 0.7,
      maxDistanceRatio: 1.25,
      usedEdgeKeys: new Set(["access"]),
      forbidTargetRepeat: true,
    });

    expect(result.status).toBe("failure");
    expect(result.diagnostics.reachableTargetKm).toBeCloseTo(6.8, 3);
    expect(result.diagnostics.exploitableTargetKm).toBeCloseTo(2.4, 3);
    expect(result.diagnostics.targetDistanceKm).toBeCloseTo(2.4, 3);
    expect(result.diagnostics.blocker).toBe("branch_repeat_limited");
  });

  it("reaches the deep cyclic core of a large component without inflating target repeats", () => {
    const result = buildTargetComponentTraversal({
      graph: graph([
        edge("access", "s", "entry", 0.35, "asphalt", "residential", "urban"),
        edge("local-trap-1", "entry", "trap1", 0.45, "ground", "path", null),
        edge("local-trap-2", "entry", "trap2", 0.45, "ground", "track", null),
        edge("local-trap-3", "entry", "trap3", 0.45, "ground", "path", null),
        edge("bridge-1", "entry", "bridge1", 0.35, "ground", "path", null),
        edge("bridge-2", "bridge1", "core-a", 0.35, "ground", "track", null),
        edge("core-1", "core-a", "core-b", 0.8, "ground", "path", null),
        edge("core-2", "core-b", "core-c", 0.8, "ground", "track", null),
        edge("core-3", "core-c", "core-d", 0.8, "ground", "path", null),
        edge("core-4", "core-d", "core-a", 0.8, "ground", "track", null),
        edge("branch-deep-1", "core-d", "branch-1", 0.7, "ground", "path", null),
        edge("branch-deep-2", "branch-1", "branch-2", 0.7, "ground", "track", null),
        edge("branch-deep-3", "branch-2", "core-d", 0.7, "ground", "path", null),
        edge("closure", "core-a", "s", 0.35, "asphalt", "residential", "urban"),
      ]),
      startNodeId: "s",
      entryNodeId: "entry",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 6,
      minDistanceRatio: 0.7,
      maxDistanceRatio: 1.25,
      usedEdgeKeys: new Set(["access"]),
      forbidTargetRepeat: true,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.edgeIds).toEqual([
      "bridge-1",
      "bridge-2",
      "core-1",
      "core-2",
      "core-3",
      "branch-deep-1",
      "branch-deep-2",
      "branch-deep-3",
      "core-4",
      "closure",
    ]);
    expect(result.targetKm).toBeGreaterThan(5.5);
    expect(result.repeatedTargetKm).toBe(0);
    expect(result.closure.targetRepeatKm).toBe(0);
    expect(result.diagnostics).toMatchObject({
      enteredTargetComponent: true,
      failureStage: null,
      targetComponentDwellKm: result.targetKm,
      targetRepeatKm: 0,
      connectorRepeatKm: 0,
    });
    expect(result.diagnostics.exploitedOpportunityRatio).toBeGreaterThan(0.75);
    expect(result.diagnostics.bestPartialDistanceKm).toBeGreaterThan(6);
  });
});

describe("solveComponentLoopV3", () => {
  it("builds a component-first loop when a large natural component is reachable through a short paved connector", () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge("access", "s", "a", 0.35, "asphalt", "residential", "urban"),
        edge("loop-1", "a", "b", 1.1, "ground", "path", null),
        edge("loop-2", "b", "c", 1.1, "ground", "track", null),
        edge("loop-3", "c", "d", 1.1, "ground", "path", null),
        edge("loop-4", "d", "a", 1.1, "ground", "track", null),
        edge("closure", "a", "s", 0.35, "asphalt", "residential", "urban"),
      ]),
      startNodeId: "s",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 6,
      requestedNaturalDwellKm: 3.2,
    });

    expect(result.status).toBe("success");
    expect(result.diagnostics.selectedComponentId).toBe("target-component-1");
    expect(result.diagnostics.accessCandidates.count).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.dwellCandidates.count).toBeGreaterThanOrEqual(1);
    expect(result.diagnostics.closureCandidates.count).toBeGreaterThanOrEqual(
      1,
    );
    expect(
      result.diagnostics.naturalGraphContraction.originalNaturalEdgeCount,
    ).toBe(4);
    expect(
      result.diagnostics.naturalGraphContraction.cycleCandidateCount,
    ).toBeGreaterThanOrEqual(1);
    expect(
      result.diagnostics.naturalGraphContraction.expansionValidity.valid,
    ).toBe(true);
    if (result.status !== "success") return;
    expect(result.edgeIds).toEqual([
      "access",
      "loop-1",
      "loop-2",
      "loop-3",
      "loop-4",
      "closure",
    ]);
    expect(result.metrics.accessPavedKm).toBeCloseTo(0.35, 3);
    expect(result.metrics.naturalDwellKm).toBeCloseTo(4.4, 3);
  });

  it("refuses a massive branch-only natural component with a phase-level reason", () => {
    const branchTeeth = Array.from({ length: 12 }, (_, index) =>
      edge(
        `dead-end-tooth-${index + 1}`,
        "entry",
        `leaf-${index + 1}`,
        0.55,
        "ground",
        "path",
        null,
      ),
    );
    const result = solveComponentLoopV3({
      graph: graph([
        edge("access", "s", "entry", 0.2, "asphalt", "residential", "urban"),
        ...branchTeeth,
      ]),
      startNodeId: "s",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 7,
      requestedNaturalDwellKm: 4.5,
    });

    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.reason).toBe("no_dwell");
    expect(["dwellPhase", "closurePhase"]).toContain(
      result.diagnostics.failedPhase,
    );
    expect(result.diagnostics.componentReachableTargetKm).toBeGreaterThan(6);
    expect(["branch_repeat_limited", "no_clean_closure"]).toContain(
      result.diagnostics.topComponentLoopCandidates[0]?.reason,
    );
  });

  it("extends dwell through a deep natural branch before recovering to a clean returned loop", () => {
    const deepBranch = Array.from({ length: 8 }, (_, index) =>
      edge(
        `deep-branch-${index + 1}`,
        `deep${index}`,
        `deep${index + 1}`,
        0.55,
        "ground",
        index % 2 === 0 ? "path" : "track",
        null,
      ),
    );
    const result = solveComponentLoopV3({
      graph: graph([
        edge("access", "s", "entry", 0.45, "asphalt", "residential", "urban"),
        edge("local-trap-1", "entry", "trap1", 0.8, "ground", "path", null),
        edge("local-trap-2", "trap1", "trap2", 0.8, "ground", "track", null),
        edge(
          "local-trap-return",
          "trap2",
          "entry",
          0.8,
          "ground",
          "path",
          null,
        ),
        edge("deep-gateway", "entry", "deep0", 0.35, "ground", "path", null),
        ...deepBranch,
        edge(
          "deep-clean-return",
          "deep8",
          "entry",
          1.9,
          "ground",
          "track",
          null,
        ),
        edge("closure", "entry", "s", 0.45, "asphalt", "residential", "urban"),
      ]),
      startNodeId: "s",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 9,
      requestedNaturalDwellKm: 4.8,
    });

    expect(result.status).toBe("success");
    expect(result.metrics.naturalDwellKm).toBeGreaterThan(6);
    expect(result.metrics.targetRepeatKm).toBe(0);
    expect(result.edgeIds).toContain("deep-clean-return");
  });

  it("selects the best recoverable partial loop over a larger component that is shorter after dwell", () => {
    const hugeButShort = Array.from({ length: 70 }, (_, index) =>
      edge(
        `huge-short-${index + 1}`,
        "huge-entry",
        `huge-leaf-${index + 1}`,
        0.3,
        "ground",
        "path",
        null,
      ),
    );
    const recoverableLoop = [
      edge(
        "recoverable-1",
        "recoverable-entry",
        "r1",
        1.4,
        "ground",
        "path",
        null,
      ),
      edge("recoverable-2", "r1", "r2", 1.4, "ground", "track", null),
      edge("recoverable-3", "r2", "r3", 1.4, "ground", "path", null),
      edge(
        "recoverable-return",
        "r3",
        "recoverable-entry",
        1.4,
        "ground",
        "track",
        null,
      ),
    ];
    const result = solveComponentLoopV3({
      graph: graph([
        edge(
          "short-access",
          "s",
          "huge-entry",
          0.25,
          "asphalt",
          "residential",
          "urban",
        ),
        ...hugeButShort,
        edge(
          "recoverable-access",
          "s",
          "recoverable-entry",
          0.9,
          "asphalt",
          "residential",
          "urban",
        ),
        ...recoverableLoop,
        edge(
          "recoverable-closure",
          "recoverable-entry",
          "s",
          0.9,
          "asphalt",
          "residential",
          "urban",
        ),
      ]),
      startNodeId: "s",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 12,
      requestedNaturalDwellKm: 5.4,
    });

    expect(result.diagnostics.selectedComponentId).toBe("target-component-2");
    expect(result.edgeIds).toContain("recoverable-return");
    expect(result.metrics.distanceKm).toBeGreaterThan(7);
    expect(result.metrics.naturalDwellKm).toBeGreaterThan(5);
  });

  it("exposes ordered cycle core as a component-loop lane when it satisfies dwell and distance gates", () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge("access", "s", "a", 0.3, "asphalt", "residential", "urban"),
        edge("z-cycle-entry", "a", "b", 1.25, "ground", "path", null),
        edge("m-cycle-mid", "b", "c", 1.25, "ground", "track", null),
        edge("a-cycle-mid", "c", "d", 1.25, "ground", "path", null),
        edge("q-cycle-return", "d", "a", 1.25, "ground", "track", null),
        edge("closure", "a", "s", 0.3, "asphalt", "residential", "urban"),
      ]),
      startNodeId: "s",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 7,
      requestedNaturalDwellKm: 4.8,
    });

    expect(result.status).toBe("success");
    expect(
      result.diagnostics.orderedCycleExpansion?.selectedCycleId,
    ).toBeTruthy();
    expect(
      result.diagnostics.topComponentLoopCandidates.some(
        (candidate) => candidate.componentId === "ordered-cycle-core",
      ),
    ).toBe(true);
    expect(
      result.diagnostics.orderedCycleExpansion?.metrics.naturalCycleKm,
    ).toBeCloseTo(5, 3);
  });

  it("keeps asphalt access and closure counted as paved while the internal dwell stays natural", () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge(
          "asphalt-access",
          "s",
          "a",
          0.6,
          "asphalt",
          "residential",
          "urban",
        ),
        edge("natural-1", "a", "b", 1.1, "ground", "path", null),
        edge("natural-2", "b", "c", 1.1, "ground", "track", null),
        edge("natural-3", "c", "d", 1.1, "gravel", "path", null),
        edge("natural-return", "d", "a", 1.1, "ground", "track", null),
        edge(
          "asphalt-closure",
          "a",
          "s",
          0.6,
          "asphalt",
          "residential",
          "urban",
        ),
      ]),
      startNodeId: "s",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 6,
      requestedNaturalDwellKm: 3.2,
    });

    expect(result.status).toBe("success");
    expect(result.metrics.accessPavedKm).toBeCloseTo(0.6, 3);
    expect(result.metrics.closurePavedKm).toBeCloseTo(0.6, 3);
    expect(result.metrics.pavedKm).toBeCloseTo(1.2, 3);
    expect(result.metrics.naturalDwellKm).toBeCloseTo(4.4, 3);
  });

  it("refuses a returned under-distance candidate when closure repeats a target pair through a different edge id", () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
        edge("target-ab-first", "a", "b", 1.2, "ground", "path", null),
        edge("target-bc", "b", "c", 1.2, "ground", "track", null),
        edge("target-ca", "c", "a", 1.2, "ground", "path", null),
        edge(
          "target-ab-repeat-different-osm-edge",
          "b",
          "a",
          1.2,
          "ground",
          "track",
          null,
        ),
      ]),
      startNodeId: "s",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 7,
      requestedNaturalDwellKm: 2.4,
      allowConnectorRepeatClosure: true,
    });

    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.reason).toBe("no_clean_closure");
    expect(result.metrics.targetRepeatKm).toBe(0);
    expect(result.edgeIds).not.toContain("target-ab-repeat-different-osm-edge");
    expect(result.diagnostics.failedPhase).toBe("closurePhase");
  });

  it("downgrades dwell success when closure would require massive target repeat", () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge("access", "s", "a", 0.25, "asphalt", "residential", "urban"),
        edge("cycle-1", "a", "b", 1.2, "ground", "path", null),
        edge("cycle-2", "b", "c", 1.2, "ground", "track", null),
        edge("cycle-3", "c", "a", 1.2, "ground", "path", null),
      ]),
      startNodeId: "s",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 6,
      requestedNaturalDwellKm: 2.4,
      allowConnectorRepeatClosure: false,
    });

    expect(result.status).toBe("failure");
    if (result.status !== "failure") return;
    expect(result.reason).toBe("no_clean_closure");
    expect(result.diagnostics.failedPhase).toBe("closurePhase");
    expect(
      result.diagnostics.dwellCandidates.top[0]?.naturalDwellKm,
    ).toBeGreaterThanOrEqual(2.4);
  });

  it("keeps required paved access counted as paved when natural dwell is majority", () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge("access", "s", "a", 0.8, "asphalt", "residential", "urban"),
        edge("loop-1", "a", "b", 1.2, "ground", "path", null),
        edge("loop-2", "b", "c", 1.2, "ground", "track", null),
        edge("loop-3", "c", "d", 1.2, "ground", "path", null),
        edge("loop-4", "d", "a", 1.2, "ground", "track", null),
        edge("closure", "a", "s", 0.8, "asphalt", "residential", "urban"),
      ]),
      startNodeId: "s",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 7,
      requestedNaturalDwellKm: 4,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.metrics.accessPavedKm).toBeCloseTo(0.8, 3);
    expect(result.metrics.closurePavedKm).toBeCloseTo(0.8, 3);
    expect(result.metrics.pavedKm).toBeCloseTo(1.6, 3);
    expect(result.metrics.naturalDwellKm).toBeCloseTo(4.8, 3);
    expect(result.metrics.pavedKm).toBeLessThan(result.metrics.naturalDwellKm);
  });

  it("keeps component-loop dwell aligned with route-countable target dwell instead of counting non-target natural closure", () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge("access", "s", "a", 0.2, "asphalt", "residential", "urban"),
        edge("target-1", "a", "b", 1.2, "ground", "path", null),
        edge("target-2", "b", "c", 1.2, "ground", "track", null),
        edge("target-3", "c", "a", 1.2, "ground", "path", null),
        edge(
          "non-target-natural-closure-1",
          "a",
          "x",
          0.7,
          "ground",
          "path",
          "urban",
        ),
        edge(
          "non-target-natural-closure-2",
          "x",
          "s",
          0.3,
          "ground",
          "path",
          "urban",
        ),
      ]),
      startNodeId: "s",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 6,
      requestedNaturalDwellKm: 3.2,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.metrics.naturalDwellKm).toBeCloseTo(3.6, 3);
    expect(result.edgeIds).toContain("non-target-natural-closure-1");
  });

  it("adds available target recovery before closure instead of closing early through residential pavement", () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge("access", "s", "a", 0.25, "asphalt", "residential", "urban"),
        edge("target-1", "a", "b", 1.1, "ground", "path", null),
        edge("target-2", "b", "c", 1.1, "ground", "track", null),
        edge("target-3", "c", "d", 1.1, "ground", "path", null),
        edge("target-recovery", "d", "e", 1.1, "ground", "track", null),
        edge(
          "paved-early-closure",
          "d",
          "s",
          0.35,
          "asphalt",
          "residential",
          "urban",
        ),
        edge("natural-return", "e", "a", 1.1, "ground", "path", null),
        edge("access-back", "a", "s", 0.25, "asphalt", "residential", "urban"),
      ]),
      startNodeId: "s",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 7,
      requestedNaturalDwellKm: 3.6,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.edgeIds).toContain("target-recovery");
    expect(result.edgeIds).toContain("natural-return");
    expect(result.edgeIds).not.toContain("paved-early-closure");
    expect(result.metrics.naturalDwellKm).toBeGreaterThan(5);
    expect(result.metrics.closurePavedKm).toBeCloseTo(0.25, 3);
  });

  it("keeps paved-only closure honest instead of reclassifying it as trail dwell", () => {
    const result = solveComponentLoopV3({
      graph: graph([
        edge("access", "s", "a", 0.4, "asphalt", "residential", "urban"),
        edge("target-1", "a", "b", 1.2, "ground", "path", null),
        edge("target-2", "b", "c", 1.2, "ground", "track", null),
        edge("target-3", "c", "d", 1.2, "ground", "path", null),
        edge(
          "paved-only-closure",
          "d",
          "s",
          0.4,
          "asphalt",
          "residential",
          "urban",
        ),
      ]),
      startNodeId: "s",
      targetComponentIds: ["field_paths"],
      targetDistanceKm: 6,
      requestedNaturalDwellKm: 3.2,
    });

    expect(result.status).toBe("success");
    if (result.status !== "success") return;
    expect(result.metrics.closurePavedKm).toBeCloseTo(0.4, 3);
    expect(result.metrics.pavedKm).toBeCloseTo(0.8, 3);
    expect(result.metrics.naturalDwellKm).toBeCloseTo(3.6, 3);
  });

  // T3 RED tests lock — stratégie `clean_corridor_walk` absente au HEAD, gardée en `it.todo` jusqu'à T4+.
  // Aucun fichier moteur touché. Aucun scoring modifié.
  it.todo('builds a credible clean natural corridor when no internal loop exists');
  it.todo('prefers a continuous natural core over an attractive isolated spur');
});
