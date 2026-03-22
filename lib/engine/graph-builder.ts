import type {
  Coordinate,
  EnrichedEdge,
  EnrichedGraph,
  GraphNode,
} from "../types";
import { haversineKm } from "./utils";
import { RouteGenerationError } from "../errors";
import type { CacheAdapter, CachedGraph } from "./adapters/cache-adapter";
import { buildCacheKey } from "./adapters/cache-adapter";
import type { DataFetcher } from "./adapters/data-fetcher";

const HIGHWAY_FILTER = [
  "secondary",
  "tertiary",
  "unclassified",
  "residential",
  "service",
  "track",
  "path",
  "cycleway",
  "bridleway",
  "footway",
  "pedestrian",
  "living_street",
].join("|");

function computeRadius(targetDistanceKm: number): number {
  return Math.max(2, Math.min(25, targetDistanceKm * 0.4));
}

export async function buildGraph(
  center: Coordinate,
  targetDistanceKm: number,
  cache: CacheAdapter,
  fetcher: DataFetcher
): Promise<{ graph: EnrichedGraph; scenicWayIds: Set<string> }> {
  const radiusKm = computeRadius(targetDistanceKm);
  if (targetDistanceKm > radiusKm * 3) {
    console.warn(
      `[graph-builder] Target distance ${targetDistanceKm}km may exceed graph coverage (radius=${radiusKm}km)`
    );
  }
  const cacheKey = buildCacheKey(center.lat, center.lng, radiusKm);

  const cached = await cache.load(cacheKey);
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

  let data: Awaited<ReturnType<DataFetcher["fetchOverpassData"]>>;
  try {
    data = await fetcher.fetchOverpassData(center, radiusKm);
  } catch {
    throw new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "OVERPASS_TIMEOUT" });
  }

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
      tags.leisure === "nature_reserve" ||
      tags.tourism === "viewpoint" ||
      tags.waterway === "river" ||
      tags.waterway === "stream" ||
      tags.boundary === "national_park"
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
    // Validate the highway tag matches our filter
    if (!HIGHWAY_FILTER.split("|").includes(highway)) continue;

    const surface = el.tags.surface;
    const lit = el.tags.lit;
    const access = el.tags.access;
    const wayId = el.id;

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
  const cacheData: CachedGraph = {
    nodes: Array.from(nodes.entries()),
    edges: Array.from(edges.entries()),
    center,
    radiusKm,
    scenicWayIds: Array.from(scenicWayIds),
    cachedAt: Date.now(),
  };
  await cache.save(cacheKey, cacheData);

  return { graph, scenicWayIds };
}
