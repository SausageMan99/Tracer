import { describe, expect, it } from "vitest";
import type { EnrichedEdge, EnrichedGraph, GraphNode } from "@/lib/types";
import { resolveSolverDeadline, solve, type SolverEmptyDiagnostics } from "@/lib/engine/orienteering-solver";
import { assessRouteQuality } from "@/lib/engine/route-quality";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import type { RouteIntent } from "@/lib/engine/terrain-planner";

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
    scenic: partial.scenic,
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

function makeCompetingTargetComponentsGraph(): EnrichedGraph {
  const nodes = new Map<string, GraphNode>([
    ["start", makeNode("start", 49.14, -0.50)],
    ["local-a", makeNode("local-a", 49.141, -0.501)],
    ["local-b", makeNode("local-b", 49.142, -0.500)],
    ["local-c", makeNode("local-c", 49.141, -0.499)],
    ["target-a", makeNode("target-a", 49.145, -0.500)],
    ["target-b", makeNode("target-b", 49.146, -0.496)],
    ["target-c", makeNode("target-c", 49.143, -0.494)],
  ]);
  const graph: EnrichedGraph = {
    nodes,
    edges: new Map<string, EnrichedEdge>(),
    center: { lat: 49.14, lng: -0.50 },
    radiusKm: 3,
  };

  addEdge(graph, "start-local-a", "start", "local-a", { highway: "path", surface: "dirt", score: 0.7, lengthKm: 1 });
  addEdge(graph, "local-a-local-b", "local-a", "local-b", { highway: "path", surface: "dirt", score: 0.7, lengthKm: 1 });
  addEdge(graph, "local-b-local-c", "local-b", "local-c", { highway: "track", surface: "ground", score: 0.7, lengthKm: 1 });
  addEdge(graph, "local-c-start", "local-c", "start", { highway: "path", surface: "dirt", score: 0.7, lengthKm: 1 });

  addEdge(graph, "start-target-a", "start", "target-a", { highway: "path", surface: "dirt", score: 0.46, lengthKm: 1 });
  addEdge(graph, "target-a-target-b", "target-a", "target-b", { highway: "path", surface: "earth", score: 0.46, lengthKm: 1 });
  addEdge(graph, "target-b-target-c", "target-b", "target-c", { highway: "track", surface: "ground", score: 0.46, lengthKm: 1 });
  addEdge(graph, "target-c-start", "target-c", "start", { highway: "path", surface: "dirt", score: 0.46, lengthKm: 1 });

  return graph;
}

function makeTargetEntryAnchorMissGraph(): EnrichedGraph {
  const nodes = new Map<string, GraphNode>([
    ["start", makeNode("start", 49.14, -0.50)],
    ["local-a", makeNode("local-a", 49.141, -0.500)],
    ["local-b", makeNode("local-b", 49.140, -0.499)],
    ["local-c", makeNode("local-c", 49.139, -0.500)],
    ["local-d", makeNode("local-d", 49.140, -0.501)],
    ["access-a", makeNode("access-a", 49.145, -0.506)],
    ["target-entry", makeNode("target-entry", 49.150, -0.512)],
    ["target-a", makeNode("target-a", 49.151, -0.506)],
    ["target-b", makeNode("target-b", 49.148, -0.502)],
    ["target-exit", makeNode("target-exit", 49.144, -0.504)],
  ]);
  const graph: EnrichedGraph = {
    nodes,
    edges: new Map<string, EnrichedEdge>(),
    center: { lat: 49.14, lng: -0.50 },
    radiusKm: 4,
  };

  addEdge(graph, "start-local-a", "start", "local-a", { highway: "path", surface: "dirt", score: 0.95, lengthKm: 0.7 });
  addEdge(graph, "start-local-b", "start", "local-b", { highway: "path", surface: "dirt", score: 0.94, lengthKm: 0.7 });
  addEdge(graph, "start-local-c", "start", "local-c", { highway: "path", surface: "dirt", score: 0.93, lengthKm: 0.7 });
  addEdge(graph, "start-local-d", "start", "local-d", { highway: "path", surface: "dirt", score: 0.92, lengthKm: 0.7 });

  addEdge(graph, "start-access-a", "start", "access-a", { highway: "residential", surface: "asphalt", score: 0.05, lengthKm: 0.8 });
  addEdge(graph, "access-a-target-entry", "access-a", "target-entry", { highway: "track", surface: "ground", score: 0.18, lengthKm: 0.8 });
  addEdge(graph, "target-entry-target-a", "target-entry", "target-a", { highway: "path", surface: "dirt", score: 0.62, lengthKm: 1.1 });
  addEdge(graph, "target-a-target-b", "target-a", "target-b", { highway: "path", surface: "earth", score: 0.62, lengthKm: 1.1 });
  addEdge(graph, "target-b-target-exit", "target-b", "target-exit", { highway: "track", surface: "ground", score: 0.62, lengthKm: 1.1 });
  addEdge(graph, "target-exit-start", "target-exit", "start", { highway: "residential", surface: "asphalt", score: 0.28, lengthKm: 1.0 });

  return graph;
}

function makeTransitionWoodsEarlyClosureGraph(): EnrichedGraph {
  const nodes = new Map<string, GraphNode>([
    ["start", makeNode("start", 49.14, -0.50)],
    ["access", makeNode("access", 49.141, -0.500)],
    ["target-entry", makeNode("target-entry", 49.142, -0.500)],
    ["target-a", makeNode("target-a", 49.143, -0.500)],
    ["target-b", makeNode("target-b", 49.144, -0.500)],
    ["near-exit", makeNode("near-exit", 49.1405, -0.500)],
    ["extension", makeNode("extension", 49.1403, -0.500)],
  ]);
  const graph: EnrichedGraph = {
    nodes,
    edges: new Map<string, EnrichedEdge>(),
    center: { lat: 49.14, lng: -0.50 },
    radiusKm: 3,
  };

  addEdge(graph, "start-access", "start", "access", { highway: "residential", surface: "asphalt", score: 0.35, lengthKm: 1.4 });
  addEdge(graph, "access-target-entry", "access", "target-entry", { highway: "track", surface: "ground", score: 0.6, lengthKm: 0.7 });
  addEdge(graph, "target-entry-target-a", "target-entry", "target-a", { highway: "path", surface: "dirt", score: 0.7, lengthKm: 1.4 });
  addEdge(graph, "target-a-target-b", "target-a", "target-b", { highway: "path", surface: "earth", score: 0.7, lengthKm: 1.4 });
  addEdge(graph, "target-b-near-exit", "target-b", "near-exit", { highway: "track", surface: "ground", score: 0.7, lengthKm: 2.0 });
  addEdge(graph, "near-exit-start", "near-exit", "start", { highway: "residential", surface: "asphalt", score: 0.3, lengthKm: 0.05 });
  addEdge(graph, "near-exit-extension", "near-exit", "extension", { highway: "path", surface: "dirt", score: 0.7, lengthKm: 0.6 });
  addEdge(graph, "extension-start", "extension", "start", { highway: "residential", surface: "asphalt", score: 0.3, lengthKm: 0.3 });

  return graph;
}

function makePerimeterVsWoodEntryGraph(): EnrichedGraph {
  const nodes = new Map<string, GraphNode>([
    ["start", makeNode("start", 49.14, -0.50)],
    ["perimeter-a", makeNode("perimeter-a", 49.145, -0.505)],
    ["perimeter-b", makeNode("perimeter-b", 49.150, -0.500)],
    ["perimeter-c", makeNode("perimeter-c", 49.145, -0.495)],
    ["wood-gate", makeNode("wood-gate", 49.143, -0.500)],
    ["wood-a", makeNode("wood-a", 49.146, -0.499)],
    ["wood-b", makeNode("wood-b", 49.148, -0.496)],
    ["wood-c", makeNode("wood-c", 49.145, -0.493)],
    ["wood-exit", makeNode("wood-exit", 49.142, -0.496)],
  ]);
  const graph: EnrichedGraph = {
    nodes,
    edges: new Map<string, EnrichedEdge>(),
    center: { lat: 49.14, lng: -0.50 },
    radiusKm: 4,
  };

  addEdge(graph, "start-perimeter-a", "start", "perimeter-a", {
    highway: "residential",
    surface: "asphalt",
    score: 0.82,
    lengthKm: 2.5,
  });
  addEdge(graph, "perimeter-a-perimeter-b", "perimeter-a", "perimeter-b", {
    highway: "residential",
    surface: "asphalt",
    score: 0.82,
    lengthKm: 2.5,
  });
  addEdge(graph, "perimeter-b-perimeter-c", "perimeter-b", "perimeter-c", {
    highway: "residential",
    surface: "asphalt",
    score: 0.82,
    lengthKm: 2.5,
  });
  addEdge(graph, "perimeter-c-start", "perimeter-c", "start", {
    highway: "residential",
    surface: "asphalt",
    score: 0.82,
    lengthKm: 2.5,
  });

  addEdge(graph, "start-wood-gate", "start", "wood-gate", {
    highway: "residential",
    surface: "asphalt",
    score: 0.38,
    lengthKm: 2.2,
  });
  addEdge(graph, "wood-gate-wood-a", "wood-gate", "wood-a", {
    highway: "path",
    surface: "dirt",
    score: 0.68,
    lengthKm: 0.6,
  });
  addEdge(graph, "wood-a-wood-b", "wood-a", "wood-b", {
    highway: "path",
    surface: "ground",
    score: 0.68,
    lengthKm: 0.6,
  });
  addEdge(graph, "wood-b-wood-c", "wood-b", "wood-c", {
    highway: "track",
    surface: "earth",
    score: 0.68,
    lengthKm: 0.6,
  });
  addEdge(graph, "wood-c-wood-exit", "wood-c", "wood-exit", {
    highway: "path",
    surface: "dirt",
    score: 0.68,
    lengthKm: 0.6,
  });
  addEdge(graph, "wood-exit-start", "wood-exit", "start", {
    highway: "residential",
    surface: "asphalt",
    score: 0.38,
    lengthKm: 5.2,
  });

  return graph;
}

function makeUnknownSurfaceScenicCorridorVsRoadLoopGraph(): EnrichedGraph {
  const nodes = new Map<string, GraphNode>([
    ["start", makeNode("start", 49.14, -0.50)],
    ["road-a", makeNode("road-a", 49.145, -0.505)],
    ["road-b", makeNode("road-b", 49.150, -0.500)],
    ["road-c", makeNode("road-c", 49.145, -0.495)],
    ["scenic-a", makeNode("scenic-a", 49.143, -0.499)],
    ["scenic-b", makeNode("scenic-b", 49.146, -0.497)],
    ["scenic-c", makeNode("scenic-c", 49.148, -0.494)],
    ["scenic-d", makeNode("scenic-d", 49.144, -0.492)],
  ]);
  const graph: EnrichedGraph = {
    nodes,
    edges: new Map<string, EnrichedEdge>(),
    center: { lat: 49.14, lng: -0.50 },
    radiusKm: 3,
  };

  addEdge(graph, "start-road-a", "start", "road-a", {
    highway: "residential",
    surface: "asphalt",
    score: 0.84,
    lengthKm: 1.5,
  });
  addEdge(graph, "road-a-road-b", "road-a", "road-b", {
    highway: "residential",
    surface: "asphalt",
    score: 0.84,
    lengthKm: 1.5,
  });
  addEdge(graph, "road-b-road-c", "road-b", "road-c", {
    highway: "residential",
    surface: "asphalt",
    score: 0.84,
    lengthKm: 1.5,
  });
  addEdge(graph, "road-c-start", "road-c", "start", {
    highway: "residential",
    surface: "asphalt",
    score: 0.84,
    lengthKm: 1.5,
  });

  addEdge(graph, "start-scenic-a", "start", "scenic-a", {
    highway: "path",
    scenic: true,
    score: 0.62,
    lengthKm: 1.5,
  });
  addEdge(graph, "scenic-a-scenic-b", "scenic-a", "scenic-b", {
    highway: "path",
    scenic: true,
    score: 0.62,
    lengthKm: 1.5,
  });
  addEdge(graph, "scenic-b-scenic-c", "scenic-b", "scenic-c", {
    highway: "track",
    scenic: true,
    score: 0.62,
    lengthKm: 1.5,
  });
  addEdge(graph, "scenic-c-scenic-d", "scenic-c", "scenic-d", {
    highway: "path",
    scenic: true,
    score: 0.62,
    lengthKm: 0.8,
  });
  addEdge(graph, "scenic-d-start", "scenic-d", "start", {
    highway: "track",
    scenic: true,
    score: 0.62,
    lengthKm: 0.7,
  });

  return graph;
}

function makeMappedWoodRoadVsOpenRoadGraph(): EnrichedGraph {
  const nodes = new Map<string, GraphNode>([
    ["start", makeNode("start", 49.14, -0.50)],
    ["open-a", makeNode("open-a", 49.145, -0.505)],
    ["open-b", makeNode("open-b", 49.150, -0.500)],
    ["open-c", makeNode("open-c", 49.145, -0.495)],
    ["forest-gate", makeNode("forest-gate", 49.143, -0.500)],
    ["forest-a", makeNode("forest-a", 49.146, -0.499)],
    ["forest-b", makeNode("forest-b", 49.148, -0.496)],
    ["forest-c", makeNode("forest-c", 49.145, -0.493)],
    ["forest-exit", makeNode("forest-exit", 49.142, -0.496)],
  ]);
  const graph: EnrichedGraph = {
    nodes,
    edges: new Map<string, EnrichedEdge>(),
    center: { lat: 49.14, lng: -0.50 },
    radiusKm: 4,
  };

  addEdge(graph, "start-open-a", "start", "open-a", {
    highway: "residential",
    surface: "asphalt",
    score: 0.82,
    lengthKm: 2.5,
  });
  addEdge(graph, "open-a-open-b", "open-a", "open-b", {
    highway: "residential",
    surface: "asphalt",
    score: 0.82,
    lengthKm: 2.5,
  });
  addEdge(graph, "open-b-open-c", "open-b", "open-c", {
    highway: "residential",
    surface: "asphalt",
    score: 0.82,
    lengthKm: 2.5,
  });
  addEdge(graph, "open-c-start", "open-c", "start", {
    highway: "residential",
    surface: "asphalt",
    score: 0.82,
    lengthKm: 2.5,
  });

  addEdge(graph, "start-forest-gate", "start", "forest-gate", {
    highway: "residential",
    surface: "asphalt",
    score: 0.38,
    lengthKm: 2.2,
  });
  addEdge(graph, "forest-gate-forest-a", "forest-gate", "forest-a", {
    highway: "residential",
    scenic: true,
    score: 0.62,
    lengthKm: 0.6,
  });
  addEdge(graph, "forest-a-forest-b", "forest-a", "forest-b", {
    highway: "unclassified",
    scenic: true,
    score: 0.62,
    lengthKm: 0.6,
  });
  addEdge(graph, "forest-b-forest-c", "forest-b", "forest-c", {
    highway: "residential",
    scenic: true,
    score: 0.62,
    lengthKm: 0.6,
  });
  addEdge(graph, "forest-c-forest-exit", "forest-c", "forest-exit", {
    highway: "unclassified",
    scenic: true,
    score: 0.62,
    lengthKm: 0.6,
  });
  addEdge(graph, "forest-exit-start", "forest-exit", "start", {
    highway: "residential",
    surface: "asphalt",
    score: 0.38,
    lengthKm: 5.2,
  });

  return graph;
}

function makeCleanReturnOverBudgetGraph(): EnrichedGraph {
  const nodes = new Map<string, GraphNode>([
    ["start", makeNode("start", 49.14, -0.500)],
    ["turnaround", makeNode("turnaround", 49.142, -0.500)],
    ["late-a", makeNode("late-a", 49.144, -0.497)],
    ["late-b", makeNode("late-b", 49.141, -0.494)],
    ["late-c", makeNode("late-c", 49.139, -0.497)],
  ]);
  const graph: EnrichedGraph = {
    nodes,
    edges: new Map<string, EnrichedEdge>(),
    center: { lat: 49.14, lng: -0.50 },
    radiusKm: 2,
  };

  addEdge(graph, "start-turnaround-outbound", "start", "turnaround", {
    highway: "path",
    surface: "dirt",
    score: 0.9,
    lengthKm: 2.7,
    osmWayId: 101,
  });
  addEdge(graph, "turnaround-start-short-overlap", "turnaround", "start", {
    highway: "path",
    surface: "dirt",
    score: 0.95,
    lengthKm: 1.0,
    osmWayId: 101,
  });

  // At the first closure opportunity this clean return is over budget, but if
  // the solver keeps exploring one more natural segment it can close cleanly.
  addEdge(graph, "turnaround-late-a", "turnaround", "late-a", {
    highway: "path",
    surface: "dirt",
    score: 0.58,
    lengthKm: 0.8,
    osmWayId: 201,
  });
  addEdge(graph, "late-a-late-b", "late-a", "late-b", {
    highway: "path",
    surface: "dirt",
    score: 0.58,
    lengthKm: 0.8,
    osmWayId: 202,
  });
  addEdge(graph, "late-b-late-c", "late-b", "late-c", {
    highway: "path",
    surface: "dirt",
    score: 0.58,
    lengthKm: 0.6,
    osmWayId: 203,
  });
  addEdge(graph, "late-c-start", "late-c", "start", {
    highway: "path",
    surface: "dirt",
    score: 0.58,
    lengthKm: 0.5,
    osmWayId: 204,
  });

  return graph;
}

function makeCleanReturnClosureGraph(): EnrichedGraph {
  const nodes = new Map<string, GraphNode>([
    ["start", makeNode("start", 49.14, -0.500)],
    ["turnaround", makeNode("turnaround", 49.142, -0.500)],
    ["alt-a", makeNode("alt-a", 49.142, -0.497)],
    ["alt-b", makeNode("alt-b", 49.140, -0.497)],
  ]);
  const graph: EnrichedGraph = {
    nodes,
    edges: new Map<string, EnrichedEdge>(),
    center: { lat: 49.14, lng: -0.50 },
    radiusKm: 2,
  };

  // Outbound edge and classical A* closure represent the same physical OSM way.
  // The unconstrained shortest return is therefore an overlap/backtrack.
  addEdge(graph, "start-turnaround-outbound", "start", "turnaround", {
    highway: "path",
    surface: "dirt",
    score: 0.9,
    lengthKm: 2.1,
    osmWayId: 101,
  });
  addEdge(graph, "turnaround-start-short-overlap", "turnaround", "start", {
    highway: "path",
    surface: "dirt",
    score: 0.9,
    lengthKm: 1.0,
    osmWayId: 101,
  });

  // Longer but clean return that stays within the target tolerance.
  addEdge(graph, "turnaround-alt-a", "turnaround", "alt-a", {
    highway: "path",
    surface: "dirt",
    score: 0.65,
    lengthKm: 0.5,
    osmWayId: 201,
  });
  addEdge(graph, "alt-a-alt-b", "alt-a", "alt-b", {
    highway: "path",
    surface: "dirt",
    score: 0.65,
    lengthKm: 0.5,
    osmWayId: 202,
  });
  addEdge(graph, "alt-b-start", "alt-b", "start", {
    highway: "path",
    surface: "dirt",
    score: 0.65,
    lengthKm: 0.4,
    osmWayId: 203,
  });

  return graph;
}

describe("solve natural corridor preference", () => {
  it("honors an explicit runtime deadline instead of inflating routeIntent timeBudgetMs", () => {
    const nowMs = 1_000;
    const explicitDeadlineMs = 11_000;
    const routeIntent: RouteIntent = {
      type: "transition_to_woods",
      strategy: "transition_to_woods",
      targetDistanceKm: 15,
      targetElevationM: 220,
      targetComponents: [],
      distancePolicy: { mode: "strict" },
      maxPavedRatio: 0.42,
      maxBusyRoadRatio: 0.08,
      maxRepeatEdgeRatio: 0.04,
      maxGeometryOverlapRatio: 0.12,
      cleanReturnMode: "prefer",
      timeBudgetMs: 4_500,
      beamBudget: { beamWidth: 28, maxIterations: 650, shortlistSize: 16 },
      relaxationOrder: [],
      userWarningsIfRelaxed: [],
      terrainComponents: [],
    };

    expect(resolveSolverDeadline(routeIntent, { deadlineMs: explicitDeadlineMs }, nowMs)).toBe(explicitDeadlineMs);
    expect(resolveSolverDeadline(routeIntent, {}, nowMs)).toBeLessThanOrEqual(nowMs + 60_000);
  });

  it("records why the solver returns no paths instead of leaving solver-empty opaque", async () => {
    const nodes = new Map<string, GraphNode>([
      ["start", makeNode("start", 49.14, -0.50)],
      ["dead-end", makeNode("dead-end", 49.141, -0.50)],
    ]);
    const graph: EnrichedGraph = {
      nodes,
      edges: new Map<string, EnrichedEdge>(),
      center: { lat: 49.14, lng: -0.50 },
      radiusKm: 1,
    };
    addEdge(graph, "start-dead-end", "start", "dead-end", {
      highway: "path",
      surface: "dirt",
      score: 0.8,
      lengthKm: 0.5,
    });
    const emptyDiagnostics: SolverEmptyDiagnostics = {};

    const paths = await solve(graph, "start", 3, 0, new Map(), undefined, { emptyDiagnostics });

    expect(paths).toHaveLength(0);
    expect(emptyDiagnostics.configsTried).toBeGreaterThan(0);
    expect(emptyDiagnostics.statesVisited).toBeGreaterThan(0);
    expect(emptyDiagnostics.noExpandableEdges).toBeGreaterThan(0);
    expect(emptyDiagnostics.validPaths).toBe(0);
  });

  it("prefers a clean return over fallback overlap in fallback_allowed park loops when both fit", async () => {
    const graph = makeCleanReturnClosureGraph();
    const routeIntent: RouteIntent = {
      type: "park_loop",
      strategy: "park_loop",
      targetDistanceKm: 3.2,
      targetElevationM: 0,
      targetComponents: [],
      distancePolicy: { mode: "strict" },
      maxPavedRatio: 0.9,
      maxBusyRoadRatio: 0.2,
      maxRepeatEdgeRatio: 0.2,
      maxGeometryOverlapRatio: 0.2,
      cleanReturnMode: "fallback_allowed",
      timeBudgetMs: 30_000,
      beamBudget: { beamWidth: 24, maxIterations: 900, shortlistSize: 12 },
      relaxationOrder: [],
      userWarningsIfRelaxed: [],
      terrainComponents: [],
    };

    const paths = await solve(graph, "start", 3.2, 0, new Map(), routeIntent);

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].edgeIds).toEqual([
      "start-turnaround-outbound",
      "turnaround-alt-a",
      "alt-a-alt-b",
      "alt-b-start",
    ]);
    expect(paths[0].edgeIds).not.toContain("turnaround-start-short-overlap");

    const quality = assessRouteQuality({
      candidate: {
        points: [
          { lat: 49.14, lng: -0.5 },
          { lat: 49.14, lng: -0.5 },
        ],
        distanceKm: paths[0].distanceKm,
        durationSeconds: 1200,
        ascendM: 0,
        descendM: 0,
        surfaceScore: 0.8,
        loopScore: 1,
        totalScore: 0.8,
        geometry: { type: "LineString", coordinates: [] },
      },
      path: paths[0],
      graph,
      profile: PROFILES_BY_ID.get("running_trail")!,
      targetDistanceKm: 3.2,
      targetElevationM: 0,
    });

    expect(quality.repeatEdgeRatio).toBeLessThan(0.08);
    expect(quality.uTurnRatio).toBeLessThanOrEqual(0.015);
    expect(quality.warnings).not.toContain("TOO_MUCH_BACKTRACKING");
  });

  it("continues past an early dirty fallback when a later clean closure is possible", async () => {
    const graph = makeCleanReturnOverBudgetGraph();

    const paths = await solve(graph, "start", 4.8, 0, new Map());

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].edgeIds).toEqual([
      "start-turnaround-outbound",
      "turnaround-late-a",
      "late-a-late-b",
      "late-b-late-c",
      "late-c-start",
    ]);
    expect(paths[0].edgeIds).not.toContain("turnaround-start-short-overlap");

    const quality = assessRouteQuality({
      candidate: {
        points: [
          { lat: 49.14, lng: -0.5 },
          { lat: 49.14, lng: -0.5 },
        ],
        distanceKm: paths[0].distanceKm,
        durationSeconds: 1200,
        ascendM: 0,
        descendM: 0,
        surfaceScore: 0.8,
        loopScore: 1,
        totalScore: 0.8,
        geometry: { type: "LineString", coordinates: [] },
      },
      path: paths[0],
      graph,
      profile: PROFILES_BY_ID.get("running_trail")!,
      targetDistanceKm: 4.8,
      targetElevationM: 0,
    });

    expect(quality.repeatEdgeRatio).toBeLessThan(0.04);
    expect(quality.uTurnRatio).toBeLessThan(0.01);
    expect(quality.warnings).not.toContain("TOO_MUCH_BACKTRACKING");
  });

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


  it("keeps a target-component natural branch alive instead of force-closing below strict distance", async () => {
    const graph = makeTransitionWoodsEarlyClosureGraph();
    const routeIntent: RouteIntent = {
      type: "transition_to_woods",
      strategy: "transition_to_woods",
      targetDistanceKm: 8,
      targetElevationM: 0,
      targetComponents: ["tc-target"],
      distancePolicy: { mode: "strict" },
      minNaturalZoneDwellKm: 3,
      minNonPavedTrailStreakKm: 2,
      maxPavedRatio: 0.48,
      maxBusyRoadRatio: 0.08,
      maxRepeatEdgeRatio: 0.08,
      maxGeometryOverlapRatio: 0.18,
      cleanReturnMode: "prefer",
      timeBudgetMs: 30_000,
      beamBudget: { beamWidth: 4, maxIterations: 80, shortlistSize: 4 },
      relaxationOrder: [],
      userWarningsIfRelaxed: [],
      terrainComponents: [
        {
          id: "tc-target",
          kind: "forest",
          center: { lat: 49.143, lng: -0.5 },
          totalKm: 6,
          nonPavedKm: 5.2,
          pavedKm: 0,
          unknownSurfaceKm: 0,
          distanceFromStartKm: 1.8,
          entryNodeIds: ["target-entry"],
          exitNodeIds: ["near-exit", "extension"],
          nodeIds: ["target-entry", "target-a", "target-b", "near-exit", "extension"],
          confidence: "high",
        },
      ],
    };

    const paths = await solve(graph, "start", 8, 0, new Map(), routeIntent);

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].distanceKm).toBeGreaterThanOrEqual(7.2);
    expect(paths[0].edgeIds).toEqual([
      "start-access",
      "access-target-entry",
      "target-entry-target-a",
      "target-a-target-b",
      "target-b-near-exit",
      "near-exit-extension",
      "extension-start",
    ]);
  });

  it("seeds a transition-to-woods route from a reachable target entry when normal beam misses the anchor", async () => {
    const graph = makeTargetEntryAnchorMissGraph();
    const routeIntent: RouteIntent = {
      type: "transition_to_woods",
      strategy: "transition_to_woods",
      targetDistanceKm: 5.2,
      targetElevationM: 0,
      targetComponents: ["tc-target"],
      distancePolicy: { mode: "strict" },
      minNaturalZoneDwellKm: 2,
      minNonPavedTrailStreakKm: 2,
      maxPavedRatio: 0.45,
      maxBusyRoadRatio: 0.08,
      maxRepeatEdgeRatio: 0.08,
      maxGeometryOverlapRatio: 0.18,
      cleanReturnMode: "prefer",
      timeBudgetMs: 30_000,
      beamBudget: { beamWidth: 2, maxIterations: 80, shortlistSize: 4 },
      relaxationOrder: [],
      userWarningsIfRelaxed: [],
      terrainComponents: [
        {
          id: "tc-target",
          kind: "forest",
          center: { lat: 49.150, lng: -0.506 },
          totalKm: 5,
          nonPavedKm: 4,
          pavedKm: 0,
          unknownSurfaceKm: 0,
          distanceFromStartKm: 1.6,
          entryNodeIds: ["target-entry"],
          exitNodeIds: ["target-exit"],
          nodeIds: ["target-entry", "target-a", "target-b", "target-exit"],
          confidence: "high",
        },
      ],
    };
    const emptyDiagnostics: SolverEmptyDiagnostics = {};

    const paths = await solve(graph, "start", 5.2, 0, new Map(), routeIntent, { emptyDiagnostics });

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].edgeIds).toEqual([
      "start-access-a",
      "access-a-target-entry",
      "target-entry-target-a",
      "target-a-target-b",
      "target-b-target-exit",
      "target-exit-start",
    ]);
    expect(emptyDiagnostics.targetEntryStatesReached).toBeGreaterThan(0);
  });

  it("uses routeIntent.targetComponents to prefer the planned natural component", async () => {
    const graph = makeCompetingTargetComponentsGraph();
    const routeIntent: RouteIntent = {
      type: "transition_to_woods",
      strategy: "transition_to_woods",
      targetDistanceKm: 4,
      targetElevationM: 0,
      targetComponents: ["tc-target"],
      distancePolicy: { mode: "strict" },
      minNaturalZoneDwellKm: 2,
      minNonPavedTrailStreakKm: 2,
      maxPavedRatio: 0.45,
      maxBusyRoadRatio: 0.08,
      maxRepeatEdgeRatio: 0.04,
      maxGeometryOverlapRatio: 0.18,
      cleanReturnMode: "prefer",
      timeBudgetMs: 30_000,
      beamBudget: { beamWidth: 24, maxIterations: 900, shortlistSize: 12 },
      relaxationOrder: [],
      userWarningsIfRelaxed: [],
      terrainComponents: [
        {
          id: "tc-local",
          kind: "trail_cluster",
          center: { lat: 49.141, lng: -0.5 },
          totalKm: 4,
          nonPavedKm: 4,
          pavedKm: 0,
          unknownSurfaceKm: 0,
          distanceFromStartKm: 0.1,
          entryNodeIds: ["local-a"],
          exitNodeIds: ["local-c"],
          nodeIds: ["local-a", "local-b", "local-c"],
          confidence: "high",
        },
        {
          id: "tc-target",
          kind: "forest",
          center: { lat: 49.145, lng: -0.497 },
          totalKm: 4,
          nonPavedKm: 4,
          pavedKm: 0,
          unknownSurfaceKm: 0,
          distanceFromStartKm: 0.5,
          entryNodeIds: ["target-a"],
          exitNodeIds: ["target-c"],
          nodeIds: ["target-a", "target-b", "target-c"],
          confidence: "high",
        },
      ],
    };

    const paths = await solve(graph, "start", 4, 0, new Map(), routeIntent);

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].edgeIds).toEqual([
      "start-target-a",
      "target-a-target-b",
      "target-b-target-c",
      "target-c-start",
    ]);
  });

  it("enters a real wood instead of drawing a clean road loop around it", async () => {
    const graph = makePerimeterVsWoodEntryGraph();

    const paths = await solve(graph, "start", 10, 0, new Map());

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].edgeIds).toEqual([
      "start-wood-gate",
      "wood-gate-wood-a",
      "wood-a-wood-b",
      "wood-b-wood-c",
      "wood-c-wood-exit",
      "wood-exit-start",
    ]);
  });

  it("keeps scenic path corridors without surface tags ahead of cleaner road loops", async () => {
    const graph = makeUnknownSurfaceScenicCorridorVsRoadLoopGraph();

    const paths = await solve(graph, "start", 6, 0, new Map());

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].edgeIds).toEqual([
      "start-scenic-a",
      "scenic-a-scenic-b",
      "scenic-b-scenic-c",
      "scenic-c-scenic-d",
      "scenic-d-start",
    ]);
  });

  it("treats roads through mapped woods as natural corridors only when no paved surface is tagged", async () => {
    const graph = makeMappedWoodRoadVsOpenRoadGraph();

    const paths = await solve(graph, "start", 10, 0, new Map());

    expect(paths.length).toBeGreaterThan(0);
    expect(paths[0].edgeIds).toEqual([
      "start-forest-gate",
      "forest-gate-forest-a",
      "forest-a-forest-b",
      "forest-b-forest-c",
      "forest-c-forest-exit",
      "forest-exit-start",
    ]);
  });
});
