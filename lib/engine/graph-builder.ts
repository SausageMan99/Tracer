import type {
  Coordinate,
  EnrichedEdge,
  EnrichedGraph,
  GraphNode,
} from "../types";
import { haversineKm } from "../route-generator-legacy";
import { RouteGenerationError } from "../errors";
import * as fs from "fs";
import * as path from "path";

const CACHE_DIR = path.join(process.cwd(), ".cache", "graphs");
const CACHE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const HIGHWAY_FILTER = [
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "track",
  "path",
  "cycleway",
  "bridleway",
  "footway",
  "pedestrian",
  "living_street",
].join("|");

interface OverpassGraphElement {
  type: "node" | "way";
  id: number;
  lat?: number;
  lon?: number;
  nodes?: number[];
  tags?: Record<string, string>;
}

interface CachedGraph {
  nodes: [string, GraphNode][];
  edges: [string, EnrichedEdge][];
  center: Coordinate;
  radiusKm: number;
  scenicWayIds: string[];
  cachedAt: number;
}

interface GraphBuildOptions {
  targetDistanceKm?: number;
  sport?: string;
}

function computeRadius(options: GraphBuildOptions = {}): number {
  const targetDistanceKm = options.targetDistanceKm ?? 5;

  if (options.sport === "cycling_road") {
    return Math.max(2.5, Math.min(9, Number((targetDistanceKm / 8).toFixed(1))));
  }

  if (options.sport === "cycling_mtb" || options.sport === "cycling_gravel") {
    return Math.max(2, Math.min(6, Number((targetDistanceKm / 7).toFixed(1))));
  }

  // Dense city running loops need enough radius to hit 8–12 km without issuing
  // 4–6 km Paris-centre Overpass queries. 10 km maps to 1.6 km; 5 km stays 1.2.
  return Math.max(1.2, Math.min(2.2, Number((targetDistanceKm / 6.25).toFixed(1))));
}

function getCacheKey(center: Coordinate, radiusKm: number): string {
  return `${center.lat.toFixed(3)}_${center.lng.toFixed(3)}_${radiusKm.toFixed(1)}.json`;
}

function tryLoadCache(cacheKey: string): CachedGraph | null {
  const filePath = path.join(CACHE_DIR, cacheKey);
  try {
    if (!fs.existsSync(filePath)) return null;
    const raw = fs.readFileSync(filePath, "utf-8");
    const cached: CachedGraph = JSON.parse(raw);
    if (Date.now() - cached.cachedAt > CACHE_TTL_MS) {
      fs.unlinkSync(filePath);
      return null;
    }
    return cached;
  } catch {
    return null;
  }
}

function saveCache(cacheKey: string, data: CachedGraph): void {
  try {
    fs.mkdirSync(CACHE_DIR, { recursive: true });
    fs.writeFileSync(
      path.join(CACHE_DIR, cacheKey),
      JSON.stringify(data),
      "utf-8"
    );
  } catch {
    // Cache write failure is non-critical
  }
}

export async function buildGraph(
  center: Coordinate,
  options: GraphBuildOptions = {}
): Promise<{ graph: EnrichedGraph; scenicWayIds: Set<string> }> {
  const radiusKm = computeRadius(options);
  const radiusM = Math.round(radiusKm * 1000);
  const cacheKey = getCacheKey(center, radiusKm);

  const cached = tryLoadCache(cacheKey);
  if (cached) {
    return {
      graph: {
        nodes: new Map(cached.nodes),
        edges: new Map(cached.edges),
        center: cached.center,
        radiusKm: cached.radiusKm,
      },
      scenicWayIds: new Set(cached.scenicWayIds),
    };
  }

  // Fetch only routable highway ways and their nodes.
  // Dense city scenic nwr scans around 5–8 km can push public Overpass mirrors
  // into 504/timeouts. Scenic scoring is derived from tags on highway ways plus
  // trail/path/surface heuristics in edge-scorer.
  const query = `[out:json][timeout:30];(
way["highway"~"^(${HIGHWAY_FILTER})$"]["access"!~"^(private|no)$"]["foot"!="no"](around:${radiusM},${center.lat},${center.lng});
(._;>;);
);out body qt;`;

  const overpassFetch = async (attempt: number): Promise<Response> => {
    try {
      const res = await fetch("https://overpass-api.de/api/interpreter", {
        method: "POST",
        body: `data=${encodeURIComponent(query)}`,
        headers: {
          "Content-Type": "application/x-www-form-urlencoded",
          "User-Agent": "TrailForge/0.1 contact:clement.dubosq@wanadoo.fr",
        },
        signal: AbortSignal.timeout(30_000),
      });
      if (res.status === 429 || res.status === 503) {
        if (attempt < 1) {
          await new Promise((r) => setTimeout(r, 2000));
          return overpassFetch(attempt + 1);
        }
        throw new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "OVERPASS_TIMEOUT" });
      }
      if (!res.ok) {
        throw new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "OVERPASS_TIMEOUT" });
      }
      return res;
    } catch (err) {
      if (err instanceof Error && err.name === "TimeoutError") {
        if (attempt < 1) {
          await new Promise((r) => setTimeout(r, 2000));
          return overpassFetch(attempt + 1);
        }
        throw new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "OVERPASS_TIMEOUT" });
      }
      throw err;
    }
  };

  const res = await overpassFetch(0);

  const data: { elements: OverpassGraphElement[] } = await res.json();

  // Step 1: Collect nodes
  const nodeCoords = new Map<number, { lat: number; lon: number }>();
  for (const el of data.elements) {
    if (el.type === "node" && el.lat != null && el.lon != null) {
      nodeCoords.set(el.id, { lat: el.lat, lon: el.lon });
    }
  }

  // Step 2: Identify scenic ways
  const scenicWayIds = new Set<string>();
  for (const el of data.elements) {
    if (el.type !== "way") continue;
    const tags = el.tags ?? {};
    if (
      tags.natural ||
      tags.landuse === "forest" ||
      tags.landuse === "wood" ||
      tags.leisure === "nature_reserve"
    ) {
      scenicWayIds.add(String(el.id));
    }
  }

  // Step 3: Build graph from highway ways
  const nodes = new Map<string, GraphNode>();
  const edges = new Map<string, EnrichedEdge>();

  for (const el of data.elements) {
    if (el.type !== "way" || !el.nodes?.length || !el.tags?.highway) continue;

    const highway = el.tags.highway;
    const surface = el.tags.surface;
    const lit = el.tags.lit;
    const access = el.tags.access;
    const foot = el.tags.foot;
    const bicycle = el.tags.bicycle;
    const oneway = el.tags.oneway;
    const onewayBicycle = el.tags["oneway:bicycle"];
    const wayId = el.id;
    const isOnewayForward = oneway === "yes" || oneway === "1" || oneway === "true";
    const isOnewayReverse = oneway === "-1";
    const bicycleExemptFromOneway = bicycle === "designated" || bicycle === "yes" || onewayBicycle === "no";

    for (let i = 0; i < el.nodes.length - 1; i++) {
      const fromOsm = el.nodes[i];
      const toOsm = el.nodes[i + 1];
      const fromCoord = nodeCoords.get(fromOsm);
      const toCoord = nodeCoords.get(toOsm);
      if (!fromCoord || !toCoord) continue;

      const fromId = String(fromOsm);
      const toId = String(toOsm);

      // Ensure nodes exist
      if (!nodes.has(fromId)) {
        nodes.set(fromId, {
          id: fromId,
          lat: fromCoord.lat,
          lng: fromCoord.lon,
          edges: [],
        });
      }
      if (!nodes.has(toId)) {
        nodes.set(toId, {
          id: toId,
          lat: toCoord.lat,
          lng: toCoord.lon,
          edges: [],
        });
      }

      const lengthKm = haversineKm(
        { lat: fromCoord.lat, lng: fromCoord.lon },
        { lat: toCoord.lat, lng: toCoord.lon }
      );

      // Bidirectional edges
      const fwdId = `${fromId}-${toId}-${wayId}`;
      const revId = `${toId}-${fromId}-${wayId}`;

      if (!edges.has(fwdId)) {
        const edge: EnrichedEdge = {
          id: fwdId,
          from: fromId,
          to: toId,
          lengthKm,
          highway,
          surface,
          lit,
          access,
          foot,
          bicycle,
          oneway,
          onewayViolation: isOnewayReverse && !bicycleExemptFromOneway,
          osmWayId: wayId,
          score: 0,
        };
        edges.set(fwdId, edge);
        nodes.get(fromId)!.edges.push(fwdId);
      }

      if (!edges.has(revId)) {
        const edge: EnrichedEdge = {
          id: revId,
          from: toId,
          to: fromId,
          lengthKm,
          highway,
          surface,
          lit,
          access,
          foot,
          bicycle,
          oneway,
          onewayViolation: isOnewayForward && !bicycleExemptFromOneway,
          osmWayId: wayId,
          score: 0,
        };
        edges.set(revId, edge);
        nodes.get(toId)!.edges.push(revId);
      }
    }
  }

  const graph: EnrichedGraph = { nodes, edges, center, radiusKm };

  // Cache as serialized arrays
  saveCache(cacheKey, {
    nodes: Array.from(nodes.entries()),
    edges: Array.from(edges.entries()),
    center,
    radiusKm,
    scenicWayIds: Array.from(scenicWayIds),
    cachedAt: Date.now(),
  });

  return { graph, scenicWayIds };
}
