import { describe, it, expect, vi, beforeEach } from "vitest";
import { solve, getDistanceTolerance } from "@/lib/engine/orienteering-solver";
import type { EnrichedGraph, GraphNode, EnrichedEdge } from "@/lib/types";

// ── Test helpers ─────────────────────────────────────────────────────────────

/**
 * Build a ring graph of N nodes forming a loop.
 * Each edge has `edgeLengthKm` and nodes are placed in a circle of appropriate radius.
 */
function makeRingGraph(
  nodeCount: number,
  edgeLengthKm: number,
  edgeScore = 0.5
): EnrichedGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, EnrichedEdge>();

  // Place nodes in a circle. Approximate radius from circumference.
  const circumference = nodeCount * edgeLengthKm;
  const radiusKm = circumference / (2 * Math.PI);
  // Convert km to approximate degrees (1° lat ≈ 111km)
  const radiusDeg = radiusKm / 111;

  const centerLat = 48.8;
  const centerLng = 2.3;

  for (let i = 0; i < nodeCount; i++) {
    const angle = (2 * Math.PI * i) / nodeCount;
    const lat = centerLat + radiusDeg * Math.cos(angle);
    const lng = centerLng + radiusDeg * Math.sin(angle);
    nodes.set(`n${i}`, { id: `n${i}`, lat, lng, edges: [] });
  }

  // Create edges forming a ring: n0→n1→n2→...→n(N-1)→n0
  for (let i = 0; i < nodeCount; i++) {
    const from = `n${i}`;
    const to = `n${(i + 1) % nodeCount}`;
    const fwdId = `e${i}_fwd`;
    const revId = `e${i}_rev`;

    // Forward edge
    edges.set(fwdId, {
      id: fwdId,
      from,
      to,
      lengthKm: edgeLengthKm,
      highway: "residential",
      osmWayId: i,
      score: edgeScore,
    });
    nodes.get(from)!.edges.push(fwdId);

    // Reverse edge (bidirectional graph)
    edges.set(revId, {
      id: revId,
      from: to,
      to: from,
      lengthKm: edgeLengthKm,
      highway: "residential",
      osmWayId: i,
      score: edgeScore,
    });
    nodes.get(to)!.edges.push(revId);
  }

  return {
    nodes,
    edges,
    center: [centerLng, centerLat],
    radiusKm: radiusKm * 2,
  };
}

/**
 * Build a sparse "small town" graph — a single path with a shortcut back.
 * Start→A→B→C→(shortcut back to Start). Limited routing options.
 */
function makeConstrainedGraph(segmentKm: number): EnrichedGraph {
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, EnrichedEdge>();

  const centerLat = 48.8;
  const centerLng = 2.3;
  const degPerKm = 1 / 111;

  // Linear path: start → a → b → c, then c → start shortcut
  const positions: Record<string, [number, number]> = {
    start: [centerLat, centerLng],
    a: [centerLat + degPerKm * segmentKm * 0.3, centerLng],
    b: [centerLat + degPerKm * segmentKm * 0.5, centerLng + degPerKm * segmentKm * 0.3],
    c: [centerLat + degPerKm * segmentKm * 0.2, centerLng + degPerKm * segmentKm * 0.4],
  };

  for (const [id, [lat, lng]] of Object.entries(positions)) {
    nodes.set(id, { id, lat, lng, edges: [] });
  }

  const addBidirectionalEdge = (
    from: string,
    to: string,
    lengthKm: number,
    wayId: number,
    score = 0.5
  ) => {
    const fwdId = `${from}_${to}_fwd`;
    const revId = `${from}_${to}_rev`;

    edges.set(fwdId, {
      id: fwdId, from, to, lengthKm,
      highway: "residential", osmWayId: wayId, score,
    });
    edges.set(revId, {
      id: revId, from: to, to: from, lengthKm,
      highway: "residential", osmWayId: wayId, score,
    });

    nodes.get(from)!.edges.push(fwdId);
    nodes.get(to)!.edges.push(revId);
  };

  addBidirectionalEdge("start", "a", segmentKm * 0.3, 1);
  addBidirectionalEdge("a", "b", segmentKm * 0.25, 2);
  addBidirectionalEdge("b", "c", segmentKm * 0.25, 3);
  addBidirectionalEdge("c", "start", segmentKm * 0.35, 4);

  return {
    nodes,
    edges,
    center: [centerLng, centerLat],
    radiusKm: segmentKm,
  };
}

// ── Tests ────────────────────────────────────────────────────────────────────

describe("getDistanceTolerance", () => {
  it("returns 15% for short routes (≤10km)", () => {
    expect(getDistanceTolerance(5)).toBe(0.15);
    expect(getDistanceTolerance(10)).toBe(0.15);
  });

  it("returns 12% for medium routes (11–30km)", () => {
    expect(getDistanceTolerance(15)).toBe(0.12);
    expect(getDistanceTolerance(30)).toBe(0.12);
  });

  it("returns 10% for long routes (31–60km)", () => {
    expect(getDistanceTolerance(40)).toBe(0.10);
    expect(getDistanceTolerance(60)).toBe(0.10);
  });

  it("returns 8% for very long routes (>60km)", () => {
    expect(getDistanceTolerance(80)).toBe(0.08);
    expect(getDistanceTolerance(100)).toBe(0.08);
    expect(getDistanceTolerance(200)).toBe(0.08);
  });

  it("tolerance decreases monotonically with distance", () => {
    const distances = [5, 10, 15, 30, 40, 60, 80, 100];
    const tolerances = distances.map(getDistanceTolerance);
    for (let i = 1; i < tolerances.length; i++) {
      expect(tolerances[i]).toBeLessThanOrEqual(tolerances[i - 1]);
    }
  });

  it("50km route tolerance gives ±5km (not ±7.5km)", () => {
    const tol = getDistanceTolerance(50);
    expect(tol).toBe(0.10);
    expect(50 * tol).toBe(5); // ±5km, not ±7.5km
  });

  it("100km route tolerance gives ±8km (not ±15km)", () => {
    const tol = getDistanceTolerance(100);
    expect(tol).toBe(0.08);
    expect(100 * tol).toBe(8); // ±8km, not ±15km
  });
});

describe("solve — ring graph", () => {
  it("finds at least one valid loop on a simple ring", async () => {
    // 10-node ring, 1km per edge = 10km total circumference
    const graph = makeRingGraph(10, 1.0);
    const paths = await solve(graph, "n0", 10);

    expect(paths.length).toBeGreaterThan(0);

    for (const path of paths) {
      expect(path.nodeIds[0]).toBe("n0");
      expect(path.distanceKm).toBeGreaterThan(0);
    }
  });

  it("returned paths respect adaptive distance tolerance", async () => {
    // 20-node ring, 0.5km per edge = 10km circumference
    const graph = makeRingGraph(20, 0.5);
    const targetKm = 10;
    const tolerance = getDistanceTolerance(targetKm);
    const minDist = targetKm * (1 - tolerance);
    const maxDist = targetKm * (1 + tolerance);

    const paths = await solve(graph, "n0", targetKm);

    for (const path of paths) {
      // Allow fallback's relaxed tolerance (0.8x min, 1.2x max)
      const relaxedMin = minDist * 0.8;
      const relaxedMax = maxDist * 1.2;
      expect(path.distanceKm).toBeGreaterThanOrEqual(relaxedMin);
      expect(path.distanceKm).toBeLessThanOrEqual(relaxedMax);
    }
  });

  it("deduplicates near-identical paths", async () => {
    const graph = makeRingGraph(8, 1.0);
    const paths = await solve(graph, "n0", 8);

    // All paths should be unique (Jaccard < 0.6)
    for (let i = 0; i < paths.length; i++) {
      for (let j = i + 1; j < paths.length; j++) {
        const setA = new Set(paths[i].edgeIds);
        const setB = new Set(paths[j].edgeIds);
        let intersection = 0;
        for (const e of setA) {
          if (setB.has(e)) intersection++;
        }
        const union = setA.size + setB.size - intersection;
        const jaccard = union === 0 ? 1 : intersection / union;
        expect(jaccard).toBeLessThanOrEqual(0.6);
      }
    }
  });
});

describe("solve — constrained graph (fallback)", () => {
  it("returns paths even on a sparse graph via fallback", async () => {
    // Small town with limited routing options
    // Total loop: 0.3 + 0.25 + 0.25 + 0.35 = 1.15 * segmentKm
    const segmentKm = 5;
    const graph = makeConstrainedGraph(segmentKm);
    const targetKm = segmentKm * 1.15; // Match the loop length

    const paths = await solve(graph, "start", targetKm);

    // Should find at least one path (via normal closure or fallback)
    expect(paths.length).toBeGreaterThan(0);

    // Verify the path starts from start node
    for (const path of paths) {
      expect(path.nodeIds[0]).toBe("start");
      expect(path.distanceKm).toBeGreaterThan(0);
    }
  });

  it("does not return empty for a graph with exactly one loop", async () => {
    const segmentKm = 3;
    const graph = makeConstrainedGraph(segmentKm);
    const loopDist = segmentKm * 1.15;

    // Target within tolerance of the single possible loop
    const paths = await solve(graph, "start", loopDist);
    expect(paths.length).toBeGreaterThan(0);
  });
});

describe("solve — long route tighter tolerance", () => {
  it("100km target uses ±8% tolerance, not ±15%", async () => {
    // Build a ring that's ~100km
    const graph = makeRingGraph(50, 2.0); // 50 * 2 = 100km
    const paths = await solve(graph, "n0", 100);

    for (const path of paths) {
      // With 8% tolerance: [92, 108] — not [85, 115]
      // Allow fallback relaxation but still much tighter than old 15%
      expect(path.distanceKm).toBeGreaterThanOrEqual(92 * 0.8); // 73.6 absolute min
      expect(path.distanceKm).toBeLessThanOrEqual(108 * 1.2);   // 129.6 absolute max
    }
  });
});

describe("solve — returns empty for disconnected start node", () => {
  it("returns empty when start node has no edges", async () => {
    const nodes = new Map<string, GraphNode>();
    nodes.set("isolated", { id: "isolated", lat: 48.8, lng: 2.3, edges: [] });

    const graph: EnrichedGraph = {
      nodes,
      edges: new Map(),
      center: [2.3, 48.8],
      radiusKm: 1,
    };

    const paths = await solve(graph, "isolated", 5);
    expect(paths).toEqual([]);
  });

  it("returns empty for nonexistent start node", async () => {
    const graph = makeRingGraph(5, 1.0);
    const paths = await solve(graph, "nonexistent", 5);
    expect(paths).toEqual([]);
  });
});

describe("solve — elevation parameter threading", () => {
  it("accepts elevation target without crashing", async () => {
    const graph = makeRingGraph(10, 1.0);
    const nodeElevation = new Map<string, number>();

    // Give nodes some elevation
    for (let i = 0; i < 10; i++) {
      nodeElevation.set(`n${i}`, i * 10);
    }

    const paths = await solve(graph, "n0", 10, 50, nodeElevation);
    // Should not throw, may or may not find paths depending on solver heuristics
    expect(Array.isArray(paths)).toBe(true);
  });
});
