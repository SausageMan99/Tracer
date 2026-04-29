import { beforeEach, describe, expect, it, vi } from "vitest";
import * as fs from "fs";
import * as path from "path";
import { scoreEdges } from "@/lib/engine/edge-scorer";
import { buildGraph } from "@/lib/engine/graph-builder";
import type { EnrichedEdge, EnrichedGraph, GraphNode, SessionProfile } from "@/lib/types";

function makeLinearGraph(nodeCount: number): EnrichedGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, EnrichedEdge>();

  for (let i = 0; i < nodeCount; i++) {
    const id = String(i);
    nodes.set(id, { id, lat: 48.87 + i * 0.00001, lng: 2.32, edges: [] });
  }

  for (let i = 0; i < nodeCount - 1; i++) {
    const id = `${i}-${i + 1}-1`;
    edges.set(id, {
      id,
      from: String(i),
      to: String(i + 1),
      lengthKm: 0.01,
      highway: "footway",
      osmWayId: 1,
      score: 0,
    });
    nodes.get(String(i))!.edges.push(id);
  }

  return { nodes, edges, center: { lat: 48.87, lng: 2.32 }, radiusKm: 2 };
}

const runningProfile = {
  sport: "running",
  sessionType: "endurance",
} as SessionProfile;

describe("engine reliability regressions", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(path.join(process.cwd(), ".cache", "graphs"), { recursive: true, force: true });
  });

  it("keeps an elevation estimate for every graph node after dense graph sampling", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ elevation: Array.from({ length: 100 }, (_, i) => 100 + i) }), { status: 200 })
    ));
    vi.stubGlobal("fetch", fetchMock);

    const { nodeElevation } = await scoreEdges(
      makeLinearGraph(2_000),
      { surface: 0.3, elevation: 0.1, nature: 0.2, quietness: 0.4 },
      runningProfile,
      new Set()
    );

    expect(nodeElevation.size).toBe(2_000);
    expect(nodeElevation.get("1001")).toBeGreaterThan(0);
  });

  it("interpolates sampled elevations instead of creating artificial cliffs on dense graphs", async () => {
    const fetchMock = vi.fn().mockImplementation(() => Promise.resolve(
      new Response(JSON.stringify({ elevation: Array.from({ length: 100 }, (_, i) => i * 100) }), { status: 200 })
    ));
    vi.stubGlobal("fetch", fetchMock);

    const { nodeElevation } = await scoreEdges(
      makeLinearGraph(100_001),
      { surface: 0.3, elevation: 0.1, nature: 0.2, quietness: 0.4 },
      runningProfile,
      new Set()
    );

    const adjacentDiff = Math.abs((nodeElevation.get("1") ?? 0) - (nodeElevation.get("0") ?? 0));
    expect(adjacentDiff).toBeLessThanOrEqual(2);
  });

  it("expands the Overpass graph radius for 10 km running loops without using a huge city query", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({
        elements: [
          { type: "node", id: 1, lat: 48.87, lon: 2.32 },
          { type: "node", id: 2, lat: 48.871, lon: 2.321 },
          { type: "way", id: 10, nodes: [1, 2], tags: { highway: "footway" } },
        ],
      }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    await buildGraph({ lat: 48.87, lng: 2.32 }, { targetDistanceKm: 10, sport: "running" });

    const decodedBody = decodeURIComponent(String(fetchMock.mock.calls[0][1]?.body ?? ""));
    expect(decodedBody).toContain("around:1600");
    expect(decodedBody).not.toContain("around:4000");
  });
});
