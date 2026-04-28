import type { Coordinate, EnrichedEdge, GraphNode } from "../../types";

export interface CachedGraph {
  readonly nodes: readonly [string, GraphNode][];
  readonly edges: readonly [string, EnrichedEdge][];
  readonly center: Coordinate;
  readonly radiusKm: number;
  readonly scenicWayIds: readonly string[];
  readonly cachedAt: number;
}

export interface CacheAdapter {
  load(key: string): Promise<CachedGraph | null>;
  save(key: string, data: CachedGraph): Promise<void>;
}

export function buildCacheKey(lat: number, lng: number, radiusKm: number): string {
  return `${lat.toFixed(2)}_${lng.toFixed(2)}_${radiusKm.toFixed(1)}`;
}
