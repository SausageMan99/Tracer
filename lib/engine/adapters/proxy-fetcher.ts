import type { Coordinate } from "../../types";
import type { DataFetcher, OverpassResponse } from "./data-fetcher";

export class ProxyFetcher implements DataFetcher {
  async fetchOverpassData(
    center: Coordinate,
    radiusKm: number
  ): Promise<OverpassResponse> {
    const resp = await fetch(
      `/api/proxy/osm?lat=${center.lat}&lng=${center.lng}&radius=${radiusKm}`,
      { signal: AbortSignal.timeout(35000) }
    );
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({ error: "Proxy error" }));
      throw new Error((err as { error?: string }).error ?? `Proxy ${resp.status}`);
    }
    return resp.json() as Promise<OverpassResponse>;
  }

  async fetchElevations(coords: Coordinate[]): Promise<number[]> {
    if (coords.length === 0) return [];
    const resp = await fetch("/api/proxy/elevation", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ coordinates: coords }),
      signal: AbortSignal.timeout(15000),
    });
    if (!resp.ok) return coords.map(() => 0);
    const data = (await resp.json()) as { elevations?: number[] };
    return data.elevations ?? coords.map(() => 0);
  }
}
