import { beforeEach, describe, expect, it, vi } from "vitest";
import { buildGraph } from "@/lib/engine/graph-builder";
import * as fs from "fs";
import * as path from "path";

function overpassResponse() {
  return new Response(JSON.stringify({
    elements: [
      { type: "node", id: 1, lat: 48.8701, lon: 2.3246 },
      { type: "node", id: 2, lat: 48.8710, lon: 2.3260 },
      {
        type: "way",
        id: 10,
        nodes: [1, 2],
        tags: {
          highway: "footway",
          natural: "wood",
          surface: "paved",
        },
      },
    ],
  }), { status: 200 });
}

describe("buildGraph Overpass query", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(path.join(process.cwd(), ".cache", "graphs"), { recursive: true, force: true });
  });

  it("keeps dense city requests focused on highway ways instead of expensive scenic nwr scans", async () => {
    const fetchMock = vi.fn().mockResolvedValue(overpassResponse());
    vi.stubGlobal("fetch", fetchMock);

    const { graph, scenicWayIds } = await buildGraph(
      { lat: 48.8701, lng: 2.3246 }
    );

    const body = String(fetchMock.mock.calls[0][1]?.body ?? "");
    const decodedBody = decodeURIComponent(body);

    expect(decodedBody).toContain('way["highway"');
    expect(decodedBody).toContain("around:1200");
    expect(decodedBody).not.toContain("service");
    expect(decodedBody).not.toContain('nwr["natural"');
    expect(decodedBody).not.toContain('nwr["landuse"');
    expect(decodedBody).not.toContain('nwr["leisure"');
    expect(graph.nodes.size).toBe(2);
    expect(graph.edges.size).toBe(2);
    expect(scenicWayIds.has("10")).toBe(true);
  });
});

describe("buildGraph scenic detection enrichment", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    fs.rmSync(path.join(process.cwd(), ".cache", "graphs"), { recursive: true, force: true });
  });

  it("detects park, forest, hiking route, and protected area tags as scenic", async () => {
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(
        JSON.stringify({
          elements: [
            { type: "node", id: 1, lat: 48.8701, lon: 2.3246 },
            { type: "node", id: 2, lat: 48.8710, lon: 2.3260 },
            {
              type: "way",
              id: 20,
              nodes: [1, 2],
              tags: { highway: "path", leisure: "park", surface: "dirt" },
            },
            {
              type: "way",
              id: 21,
              nodes: [1, 2],
              tags: { highway: "track", landuse: "forest", surface: "gravel" },
            },
            {
              type: "way",
              id: 22,
              nodes: [1, 2],
              tags: { highway: "footway", route: "hiking", surface: "ground" },
            },
            {
              type: "way",
              id: 23,
              nodes: [1, 2],
              tags: { highway: "path", boundary: "protected_area", surface: "dirt" },
            },
            {
              type: "way",
              id: 24,
              nodes: [1, 2],
              tags: { highway: "path", natural: "wood", surface: "dirt" },
            },
          ],
        }),
        { status: 200 }
      )
    );
    vi.stubGlobal("fetch", fetchMock);

    const { scenicWayIds } = await buildGraph({ lat: 48.8701, lng: 2.3246 });

    expect(scenicWayIds.has("20")).toBe(true);
    expect(scenicWayIds.has("21")).toBe(true);
    expect(scenicWayIds.has("22")).toBe(true);
    expect(scenicWayIds.has("23")).toBe(true);
    expect(scenicWayIds.has("24")).toBe(true);
  });
});
