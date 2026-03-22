import type { Coordinate } from "../../types";

// Re-export canonical types from lib/types.ts — no need to redefine them here.
export type { OverpassResponse, OverpassElement } from "../../types";

/**
 * Abstraction over external data sources used by the V2 routing engine.
 *
 * Two implementations are planned:
 * - `DirectFetcher` — calls Overpass and Open-Meteo directly (server-side / Node.js).
 * - `ProxyFetcher` — calls our own proxy endpoints (browser / Edge Runtime safe).
 *
 * This interface is the only contract that graph-builder and edge-scorer
 * need to depend on, allowing them to be used in both environments without
 * modification.
 */
export interface DataFetcher {
  /**
   * Fetches the raw Overpass API response for a circular area centred on
   * `center` with radius `radiusKm`.
   *
   * @param center   - WGS-84 latitude/longitude of the search centre.
   * @param radiusKm - Search radius in kilometres.
   * @returns        Parsed Overpass JSON response with `elements` array.
   * @throws         An `Error` when all retry attempts are exhausted.
   */
  fetchOverpassData(
    center: Coordinate,
    radiusKm: number
  ): Promise<import("../../types").OverpassResponse>;

  /**
   * Fetches elevation values for an array of coordinates.
   *
   * Implementations must batch requests to respect API limits and must return
   * `0` for any coordinate whose elevation cannot be determined (graceful
   * degradation — callers expect a same-length result array).
   *
   * @param coords - Ordered list of WGS-84 coordinates.
   * @returns      Elevation in metres ASL, one value per input coordinate,
   *               in the same order. Never throws.
   */
  fetchElevations(coords: Coordinate[]): Promise<number[]>;
}
