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
