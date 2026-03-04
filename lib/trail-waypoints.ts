/**
 * Waymarked Trails integration for fetching official hiking/cycling
 * route waypoints within a bounding box.
 *
 * Data is used as optional via-points when generating routes in
 * SCENIC mode to bias GraphHopper toward marked trail networks.
 *
 * Non-blocking: all errors return an empty array so callers never fail.
 */

export interface TrailWaypoint {
  /** Human-readable trail name */
  name: string;
  /** Network classification (lwn | rwn | nwn | lcn | rcn | ncn) */
  network: string;
  /** Approximate distance from route start in km, when available */
  distance?: number;
  /** GeoJSON geometry of the trail segment, when available */
  geometry?: {
    type: string;
    coordinates: [number, number][];
  };
}

interface WaymarkedTrailsResult {
  id: number;
  name?: string;
  network?: string;
  group?: string;
}

interface WaymarkedTrailsResponse {
  results?: WaymarkedTrailsResult[];
}

const WAYMARKED_BASE: Record<"hiking" | "cycling" | "mtb", string> = {
  hiking:  "https://hiking.waymarkedtrails.org/api/v1/list/search",
  cycling: "https://cycling.waymarkedtrails.org/api/v1/list/search",
  mtb:     "https://mtb.waymarkedtrails.org/api/v1/list/search",
};

/**
 * Fetch official trail waypoints from Waymarked Trails within a
 * bounding box. Returns an empty array on network error or timeout.
 *
 * @param bbox     - Geographic bounding box
 * @param type     - Trail type to query
 * @returns        Array of trail waypoints (may be empty)
 */
export async function fetchOfficialTrailsInBbox(
  bbox: { minLat: number; maxLat: number; minLon: number; maxLon: number },
  type: "hiking" | "cycling" | "mtb"
): Promise<TrailWaypoint[]> {
  const base = WAYMARKED_BASE[type];
  const params = new URLSearchParams({
    lang: "fr",
    bbox: `${bbox.minLon},${bbox.minLat},${bbox.maxLon},${bbox.maxLat}`,
    limit: "20",
  });

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 5000);

  try {
    const res = await fetch(`${base}?${params.toString()}`, {
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });

    if (!res.ok) return [];

    const data: WaymarkedTrailsResponse = await res.json();
    const results = data.results ?? [];

    return results.map((r) => ({
      name:    r.name ?? `Trail #${r.id}`,
      network: r.network ?? r.group ?? "unknown",
    }));
  } catch {
    // Network error, timeout, or JSON parse failure — non-blocking
    return [];
  } finally {
    clearTimeout(timeout);
  }
}
