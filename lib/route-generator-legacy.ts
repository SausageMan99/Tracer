import type {
  Coordinate,
  GeneratedRoute,
  GraphHopperResponse,
  MapboxFeature,
  OpenMeteoElevationResponse,
  OverpassResponse,
  RouteCandidate,
  RoutePoint,
  RouteRequest,
  SessionProfile,
} from "./types";
import { PROFILES_BY_ID } from "./session-profiles";

const GRAPHHOPPER_API_KEY = process.env.GRAPHHOPPER_API_KEY ?? "";
const ORS_API_KEY = process.env.ORS_API_KEY ?? "";
const ORS_BASE_URL = "https://api.openrouteservice.org/v2/directions";

/** Number of parallel round-trip seeds to generate per request. */
const N_CANDIDATES = 6;

/**
 * Maximum number of GPS points per candidate route after subsampling.
 * Limits Open-Meteo batch size and front-end rendering cost.
 * 200 points is sufficient for accurate D+ computation and SVG display.
 */
const MAX_ROUTE_POINTS = 200;

/**
 * Open-Meteo Elevation API hard limit: maximum coordinates per request.
 * Points are batched in chunks of this size when a route exceeds it.
 */
const ELEVATION_BATCH_SIZE = 100;

/** TTL for the Overpass cache: 1 hour, matching typical OSM update cycles. */
const CACHE_TTL_MS = 60 * 60 * 1000; // 1 hour

// ─── Internal pipeline type ───────────────────────────────────────────────────

/**
 * Intermediate representation of a route candidate after geometry and
 * elevation have been fetched, but before scoring. Keeps raw coordinates
 * separate from subsampled points to preserve display quality.
 */
interface EnrichedCandidate {
  /** Subsampled points with elevation data (max MAX_ROUTE_POINTS entries) */
  points: RoutePoint[];
  /** Full original coordinate list in [lng, lat] order — used for map display */
  rawCoords: [number, number][];
  /** Positive elevation gain in metres, computed from `points` elevations */
  ascendM: number;
  /** Negative elevation loss in metres */
  descendM: number;
  /** Total distance in km */
  distanceKm: number;
  /** Estimated duration in seconds */
  durationSeconds: number;
}

// ─── ORS request / response types (internal) ─────────────────────────────────

/** POST body for the OpenRouteService GeoJSON directions endpoint. */
interface OrsRequestBody {
  /** Waypoints in [lng, lat] order */
  coordinates: [number, number][];
  /** Whether to include elevation in the response geometry */
  elevation?: boolean;
  options?: {
    /** Round-trip routing options (ORS extension) */
    round_trip?: { length: number; points: number; seed: number };
  };
}

/** GeoJSON feature collection response from ORS directions. */
interface OrsGeoJsonResponse {
  type?: string;
  features?: Array<{
    geometry?: {
      type: string;
      /** Coordinates in [lon, lat, elevation?] order */
      coordinates: number[][];
    };
    properties?: {
      summary: { distance: number; duration: number };
    };
  }>;
  error?: { code: number; message: string };
}

// ─── Overpass cache ───────────────────────────────────────────────────────────

/** A time-bounded cache entry for Overpass API responses. */
interface CacheEntry {
  data: OverpassResponse;
  /** Unix timestamp in ms after which this entry is stale */
  expiresAt: number;
}

/**
 * In-memory Overpass cache keyed by bounding box string.
 * Survives between requests within the same Node.js process lifetime.
 * A single Overpass query covers all candidates from the same generation
 * request (their bboxes overlap significantly).
 *
 * TODO: Expired entries are never evicted — the Map will grow across the
 * process lifetime. Add periodic pruning (e.g. a setInterval that deletes
 * entries where `entry.expiresAt < Date.now()`) for long-running deployments.
 */
const overpassCache = new Map<string, CacheEntry>();

// ─── Haversine ───────────────────────────────────────────────────────────────

/**
 * Computes the great-circle distance between two WGS-84 coordinates.
 *
 * @param a - First coordinate
 * @param b - Second coordinate
 * @returns Distance in kilometres
 *
 * @example
 * haversineKm({ lat: 48.8566, lng: 2.3522 }, { lat: 48.8600, lng: 2.3600 })
 * // → ~0.73 km
 */
export function haversineKm(a: Coordinate, b: Coordinate): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const sin2 =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((a.lat * Math.PI) / 180) *
      Math.cos((b.lat * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(sin2));
}

// ─── Geocoding ───────────────────────────────────────────────────────────────

/**
 * Converts a free-text address to WGS-84 coordinates using Mapbox Geocoding v5.
 *
 * @param address - Any address string (city, street, POI name, etc.)
 * @returns The first geocoding result as a `Coordinate`
 * @throws {Error} With message `"GEOCODING_FAILED"` when Mapbox returns
 *   no results or responds with a non-OK HTTP status
 */
export async function geocodeAddress(address: string): Promise<Coordinate> {
  const token = process.env.NEXT_PUBLIC_MAPBOX_TOKEN ?? process.env.MAPBOX_TOKEN ?? "";
  const encoded = encodeURIComponent(address);
  const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${encoded}.json?access_token=${token}&limit=1&language=fr`;

  const res = await fetch(url, {
    signal: AbortSignal.timeout(10_000),
  });

  if (!res.ok) throw new Error("GEOCODING_FAILED");

  const data: { features: MapboxFeature[] } = await res.json();
  if (!data.features?.length) throw new Error("GEOCODING_FAILED");

  const [lng, lat] = data.features[0].center;
  return { lat, lng };
}

// ─── GraphHopper (running) ────────────────────────────────────────────────────

/**
 * Fetches N_CANDIDATES route variants from the GraphHopper API.
 *
 * In round-trip mode (no waypoints), launches N_CANDIDATES parallel requests
 * with different `round_trip.seed` values (0 to N_CANDIDATES-1). Each seed
 * produces a topologically distinct route departing from the same start point.
 *
 * In point-to-point mode (waypoints or end address provided), issues a single
 * request through all specified points and returns it as a one-element array.
 *
 * @param start - Start/end coordinate for round-trip, or origin for P2P
 * @param profile - Session profile (determines `vehicle` parameter)
 * @param targetDistanceM - Desired route length in metres (round-trip only)
 * @param waypointCoords - Optional intermediate waypoints
 * @param endCoord - Optional explicit end point (triggers P2P mode)
 * @returns Array of `{ path, seed }` objects; empty seeds have value 0 in P2P mode
 * @throws {Error} With message `"NO_ROAD_NETWORK"` when all requests fail
 *   or return empty paths
 */
async function fetchCandidateRoutes(
  start: Coordinate,
  profile: SessionProfile,
  targetDistanceM: number,
  waypointCoords?: Coordinate[],
  endCoord?: Coordinate
): Promise<
  Array<{
    path: NonNullable<GraphHopperResponse["paths"]>[number];
    seed: number;
  }>
> {
  const hasWaypoints = (waypointCoords?.length ?? 0) > 0 || endCoord != null;

  if (hasWaypoints) {
    // ── Point-to-point mode ────────────────────────────────────────────────
    const allPoints: Coordinate[] = [
      start,
      ...(waypointCoords ?? []),
      endCoord ?? start,
    ];
    const url = new URL("https://graphhopper.com/api/1/route");
    for (const pt of allPoints) {
      url.searchParams.append("point", `${pt.lat},${pt.lng}`);
    }
    url.searchParams.set("vehicle", profile.graphhopperProfile);
    url.searchParams.set("locale", "fr");
    url.searchParams.set("calc_points", "true");
    url.searchParams.set("points_encoded", "false");
    url.searchParams.set("key", GRAPHHOPPER_API_KEY);

    try {
      const res = await fetch(url.toString());
      const data: GraphHopperResponse = await res.json();
      if (!data.paths?.length || !data.paths[0].points?.coordinates?.length) {
        throw new Error("NO_ROAD_NETWORK");
      }
      return [{ path: data.paths[0], seed: 0 }];
    } catch (err) {
      if (err instanceof Error && err.message === "NO_ROAD_NETWORK") throw err;
      throw new Error("NO_ROAD_NETWORK");
    }
  }

  // ── Round-trip mode: 6 parallel seeds ────────────────────────────────────
  const seeds = Array.from({ length: N_CANDIDATES }, (_, i) => i);

  const results = await Promise.all(
    seeds.map(async (seed) => {
      const url = new URL("https://graphhopper.com/api/1/route");
      url.searchParams.set("point", `${start.lat},${start.lng}`);
      url.searchParams.set("vehicle", profile.graphhopperProfile);
      url.searchParams.set("locale", "fr");
      url.searchParams.set("calc_points", "true");
      url.searchParams.set("points_encoded", "false");
      url.searchParams.set("algorithm", "round_trip");
      url.searchParams.set("round_trip.distance", String(targetDistanceM));
      url.searchParams.set("round_trip.seed", String(seed));
      url.searchParams.set("key", GRAPHHOPPER_API_KEY);

      try {
        const res = await fetch(url.toString());
        const data: GraphHopperResponse = await res.json();
        if (!data.paths?.length) return null;
        const path = data.paths[0];
        if (!path.points?.coordinates?.length) return null;
        return { path, seed };
      } catch {
        return null;
      }
    })
  );

  const valid = results.filter(
    (r): r is { path: NonNullable<GraphHopperResponse["paths"]>[number]; seed: number } =>
      r !== null
  );

  if (valid.length === 0) throw new Error("NO_ROAD_NETWORK");
  return valid;
}

// ─── OpenRouteService (cycling) ───────────────────────────────────────────────

/**
 * Downsamples a 3D coordinate array to at most `max` points using uniform
 * index stepping. Preserves first and last points.
 *
 * @param coords - Input coordinates in [lon, lat, elev?] format
 * @param max - Maximum output count
 * @returns Subsampled array with at most `max` entries
 */
function subsamplePoints3d(coords: number[][], max: number): number[][] {
  if (coords.length <= max) return coords;
  const step = (coords.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => coords[Math.round(i * step)]);
}

/**
 * Issues a single route request to the OpenRouteService GeoJSON endpoint
 * and parses the response into an `EnrichedCandidate`.
 *
 * ORS returns elevation in the geometry coordinates when `elevation: true`,
 * so no separate Open-Meteo fetch is needed for cycling routes.
 *
 * @param orsProfile - ORS profile slug (e.g. `"cycling-road"`)
 * @param body - Request body (coordinates + optional round_trip options)
 * @returns An `EnrichedCandidate` or `null` if the request fails
 */
async function fetchORSSingleRoute(
  orsProfile: string,
  body: OrsRequestBody
): Promise<EnrichedCandidate | null> {
  try {
    const res = await fetch(`${ORS_BASE_URL}/${orsProfile}/geojson`, {
      method: "POST",
      headers: {
        Authorization: ORS_API_KEY,
        "Content-Type": "application/json",
        Accept: "application/json, application/geo+json",
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) return null;

    const data: OrsGeoJsonResponse = await res.json();
    if (!data.features?.length) return null;

    const feature = data.features[0];
    if (!feature.geometry?.coordinates?.length) return null;
    if (!feature.properties?.summary) return null;

    // coordinates = [lon, lat, elev?][]
    const fullCoords = feature.geometry.coordinates;
    const sampled = subsamplePoints3d(fullCoords, MAX_ROUTE_POINTS);

    const points: RoutePoint[] = sampled.map((c) => ({
      lat: c[1],
      lng: c[0],
      elevation: typeof c[2] === "number" ? c[2] : undefined,
    }));

    // Full coordinates for geometry display (smooth road following)
    const rawCoords: [number, number][] = fullCoords.map((c) => [c[0], c[1]]);

    const elevations = points.map((p) => p.elevation ?? 0);
    const { ascendM, descendM } = computeAscent(elevations);

    return {
      points,
      rawCoords,
      ascendM,
      descendM,
      distanceKm: feature.properties.summary.distance / 1000,
      durationSeconds: feature.properties.summary.duration,
    };
  } catch {
    return null;
  }
}

/**
 * Fetches N_CANDIDATES cycling route variants from OpenRouteService.
 *
 * Mirrors the GraphHopper strategy: round-trip with 6 parallel seeds, or
 * point-to-point when waypoints/end address are provided.
 *
 * @param start - Origin coordinate
 * @param orsProfile - ORS profile slug
 * @param targetDistanceM - Desired round-trip length in metres
 * @param waypointCoords - Optional intermediate waypoints
 * @param endCoord - Optional explicit end coordinate
 * @returns Array of `EnrichedCandidate` (may be fewer than N_CANDIDATES if some fail)
 * @throws {Error} With message `"NO_ROAD_NETWORK"` if all requests fail
 */
async function fetchCandidateRoutesORS(
  start: Coordinate,
  orsProfile: string,
  targetDistanceM: number,
  waypointCoords?: Coordinate[],
  endCoord?: Coordinate
): Promise<EnrichedCandidate[]> {
  const hasWaypoints = (waypointCoords?.length ?? 0) > 0 || endCoord != null;

  if (hasWaypoints) {
    // ── Point-to-point via ORS ─────────────────────────────────────────────
    const coordinates: [number, number][] = [
      [start.lng, start.lat],
      ...(waypointCoords ?? []).map((c): [number, number] => [c.lng, c.lat]),
      endCoord ? [endCoord.lng, endCoord.lat] : [start.lng, start.lat],
    ];
    const candidate = await fetchORSSingleRoute(orsProfile, {
      coordinates,
      elevation: true,
    });
    if (!candidate) throw new Error("NO_ROAD_NETWORK");
    return [candidate];
  }

  // ── Round-trip: 6 seeds in parallel ───────────────────────────────────────
  const results = await Promise.all(
    Array.from({ length: N_CANDIDATES }, (_, seed) =>
      fetchORSSingleRoute(orsProfile, {
        coordinates: [[start.lng, start.lat]],
        elevation: true,
        options: {
          round_trip: { length: targetDistanceM, points: 3, seed },
        },
      })
    )
  );

  const valid = results.filter((r): r is EnrichedCandidate => r !== null);
  if (valid.length === 0) throw new Error("NO_ROAD_NETWORK");
  return valid;
}

// ─── Elevation (Open-Meteo) — for GraphHopper routes ─────────────────────────

/**
 * Downsamples a 2D coordinate array to at most `max` points.
 * Used before the Open-Meteo elevation fetch to stay within the API's
 * batch size limit of 100 coordinates.
 *
 * @param coords - Input coordinates in [lng, lat] order
 * @param max - Maximum output count (should be ≤ MAX_ROUTE_POINTS)
 * @returns Subsampled array preserving first and last points
 */
function subsamplePoints(
  coords: [number, number][],
  max: number
): [number, number][] {
  if (coords.length <= max) return coords;
  const step = (coords.length - 1) / (max - 1);
  return Array.from({ length: max }, (_, i) => coords[Math.round(i * step)]);
}

/**
 * Fetches elevation for a list of coordinates from the Open-Meteo Elevation API.
 *
 * Automatically batches requests when the input exceeds ELEVATION_BATCH_SIZE (100).
 * All batches are fetched in parallel via `Promise.all`. On error, returns 0
 * for affected coordinates (graceful degradation — D+ will be underestimated).
 *
 * @param coords - Coordinate list (lat/lng objects)
 * @returns Elevation in metres ASL, one value per input coordinate
 *
 * @example
 * const elevs = await fetchElevations([{ lat: 45.8, lng: 6.9 }]);
 * // elevs → [1832]  (Chamonix area)
 */
export async function fetchElevations(coords: Coordinate[]): Promise<number[]> {
  if (coords.length === 0) return [];

  const batches: Coordinate[][] = [];
  for (let i = 0; i < coords.length; i += ELEVATION_BATCH_SIZE) {
    batches.push(coords.slice(i, i + ELEVATION_BATCH_SIZE));
  }

  const results = await Promise.all(
    batches.map(async (batch) => {
      const url = new URL("https://api.open-meteo.com/v1/elevation");
      url.searchParams.set("latitude", batch.map((c) => c.lat).join(","));
      url.searchParams.set("longitude", batch.map((c) => c.lng).join(","));

      try {
        const res = await fetch(url.toString());
        const data: OpenMeteoElevationResponse = await res.json();
        return data.elevation ?? [];
      } catch {
        return batch.map(() => 0);
      }
    })
  );

  return results.flat();
}

// ─── D+ / D- computation ─────────────────────────────────────────────────────

/**
 * Computes total positive and negative elevation gain from an elevation profile.
 *
 * No smoothing threshold is applied — every inter-point difference contributes.
 * For accurate results, the input should already be subsampled to ≤200 points
 * so that GPS noise doesn't inflate D+ significantly.
 *
 * @param elevations - Elevation values in metres ASL, in route order
 * @returns `{ ascendM, descendM }` both in metres (positive values)
 *
 * @example
 * computeAscent([100, 150, 120, 200])
 * // → { ascendM: 130, descendM: 30 }
 */
export function computeAscent(elevations: number[]): {
  ascendM: number;
  descendM: number;
} {
  let ascendM = 0;
  let descendM = 0;
  for (let i = 1; i < elevations.length; i++) {
    const diff = elevations[i] - elevations[i - 1];
    if (diff > 0) ascendM += diff;
    else descendM += Math.abs(diff);
  }
  return { ascendM, descendM };
}

// ─── Terrain quality scoring (Overpass) ──────────────────────────────────────

/** [south, west, north, east] bounding box in decimal degrees. */
type BBox = [number, number, number, number];

/**
 * Produces a stable cache key from a bounding box, rounded to 3 decimal
 * places (~100m precision) to maximise cache hits for nearby routes.
 *
 * @param bbox - Bounding box to stringify
 * @returns Comma-separated string, e.g. `"48.832,2.290,48.876,2.412"`
 */
function getCacheKey(bbox: BBox): string {
  return bbox.map((n) => n.toFixed(3)).join(",");
}

/**
 * Computes the axis-aligned bounding box of a list of coordinates.
 *
 * @param coords - Route points to encompass
 * @returns `[south, west, north, east]` bounding box
 */
function routeBBox(coords: Coordinate[]): BBox {
  const lats = coords.map((c) => c.lat);
  const lngs = coords.map((c) => c.lng);
  return [
    Math.min(...lats),
    Math.min(...lngs),
    Math.max(...lats),
    Math.max(...lngs),
  ];
}

/**
 * Estimates the area of a bounding box in km², used to normalise scenic
 * element counts.
 *
 * A minimum of 0.5 km² is enforced to avoid division by near-zero for
 * very short routes (e.g. a 500m recovery jog).
 *
 * @param bbox - Bounding box in decimal degrees
 * @returns Area in km² (minimum 0.5)
 */
function bboxAreaKm2(bbox: BBox): number {
  const w = haversineKm({ lat: bbox[0], lng: bbox[1] }, { lat: bbox[0], lng: bbox[3] });
  const h = haversineKm({ lat: bbox[0], lng: bbox[1] }, { lat: bbox[2], lng: bbox[1] });
  return Math.max(w * h, 0.5); // minimum 0.5 km² to avoid division by near-zero
}

/**
 * Queries the Overpass API for highway, surface, and natural features within
 * a bounding box. Results are cached for CACHE_TTL_MS (1 hour).
 *
 * The query fetches:
 * - All highway ways (for surface and type analysis)
 * - Bicycle route relations (for official route bonus)
 * - Natural and forest landuse elements (for scenic density)
 * - Nature reserves (for scenic density)
 *
 * Returns an empty `{ elements: [] }` on network failure so scoring
 * degrades gracefully to 0.5 (neutral).
 *
 * @param bbox - Query bounding box [south, west, north, east]
 * @returns Overpass response with OSM elements
 */
async function fetchSurfaceData(bbox: BBox): Promise<OverpassResponse> {
  const key = getCacheKey(bbox);
  const cached = overpassCache.get(key);
  if (cached && cached.expiresAt > Date.now()) return cached.data;

  // ── Enhanced query: highway types + cycling routes + natural/scenic features ─
  const query = `[out:json][timeout:15];(
way["highway"](${bbox.join(",")});
relation["route"="bicycle"](${bbox.join(",")});
nwr["natural"~"^(water|wood|forest|grassland|heath|scrub|wetland)$"](${bbox.join(",")});
nwr["landuse"~"^(forest|wood)$"](${bbox.join(",")});
nwr["leisure"="nature_reserve"](${bbox.join(",")});
);out tags;`;

  try {
    const res = await fetch("https://overpass-api.de/api/interpreter", {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });
    const data: OverpassResponse = await res.json();
    overpassCache.set(key, { data, expiresAt: Date.now() + CACHE_TTL_MS });
    return data;
  } catch {
    return { elements: [] };
  }
}

// ─── Road type sets ───────────────────────────────────────────────────────────

/** OSM surface tag values considered fully paved. */
export const PAVED_SURFACES = new Set([
  "asphalt", "concrete", "paving_stones", "sett", "cobblestone", "paved",
]);

/** OSM surface tag values considered unpaved or soft ground. */
export const UNPAVED_SURFACES = new Set([
  "gravel", "dirt", "grass", "ground", "unpaved", "compacted", "fine_gravel", "sand",
]);

/** OSM highway types preferred for trail/off-road sports. */
export const TRAIL_HIGHWAY_TYPES = new Set([
  "track", "path", "cycleway", "bridleway", "footway",
]);

/**
 * OSM highway types that are quiet secondary roads — reward for all non-MTB sports.
 * These avoid both major arterials (dangerous) and remote tracks (unreliable surface).
 */
export const QUIET_HIGHWAY_TYPES = new Set([
  "secondary", "tertiary", "unclassified", "residential", "service",
  "secondary_link", "tertiary_link",
]);

/** OSM highway types that are actively penalised for all sports (high traffic). */
export const BUSY_HIGHWAY_TYPES = new Set([
  "motorway", "trunk", "primary", "motorway_link", "trunk_link", "primary_link",
]);

/**
 * Computes a sport-specific terrain quality score from Overpass data.
 *
 * The score combines four sub-metrics:
 * 1. **Surface ratio** — paved vs unpaved preference varies by sport
 * 2. **Highway type ratios** — trail density, quiet road ratio, busy road penalty
 * 3. **Scenic density** — natural/forest/reserve elements per km²
 * 4. **Official cycling route bonus** — 1.0 if a `route=bicycle` relation is present
 *
 * Final weights per sport:
 * | Sport          | trail | roadQuality | scenic | surface | cycleRoute |
 * |----------------|-------|-------------|--------|---------|------------|
 * | cycling_mtb    | 0.40  | —           | 0.25   | 0.10    | 0.05       |
 * | cycling_gravel | 0.30  | 0.25        | 0.25   | 0.10    | 0.10       |
 * | cycling_road   | —     | 0.50        | 0.15   | 0.25    | 0.10       |
 * | running        | 0.30  | —           | 0.25   | 0.35    | 0.10       |
 *
 * Returns 0.5 (neutral) when no elements are available.
 *
 * @param overpassData - Elements fetched from the Overpass API
 * @param profile - Session profile (determines sport-specific weights)
 * @param bbox - Bounding box used for area normalisation
 * @returns Terrain score in [0, 1]
 */
export function computeTerrainScore(
  overpassData: OverpassResponse,
  profile: SessionProfile,
  bbox: BBox
): number {
  const { elements } = overpassData;
  if (elements.length === 0) return 0.5;

  const { sport } = profile;

  // ── Surface ratio ─────────────────────────────────────────────────────────
  let pavedCount = 0;
  let unpavedCount = 0;
  for (const el of elements) {
    const surface = el.tags?.surface ?? "";
    if (PAVED_SURFACES.has(surface)) pavedCount++;
    else if (UNPAVED_SURFACES.has(surface)) unpavedCount++;
  }
  const surfaceTotal = pavedCount + unpavedCount;
  let surfaceScore = 0.5;
  if (surfaceTotal > 0) {
    const pavedRatio = pavedCount / surfaceTotal;
    if (sport === "cycling_mtb") {
      surfaceScore = 1 - pavedRatio * 0.4;
    } else if (sport === "cycling_gravel") {
      // Peaks at pavedRatio = 0.5 (ideal mix of paved and unpaved)
      surfaceScore = 0.6 + 0.4 * (1 - Math.abs(pavedRatio - 0.5) * 2);
    } else {
      surfaceScore = pavedRatio; // road/running prefer paved
    }
  }

  // ── Highway type ratios ───────────────────────────────────────────────────
  const highways = elements.filter(
    (el) => el.type === "way" && el.tags?.highway
  );
  const highwayTotal = highways.length;

  let trailRatio = 0;
  let quietRatio = 0;
  let busyRatio = 0;
  if (highwayTotal > 0) {
    const trailCount = highways.filter((el) =>
      TRAIL_HIGHWAY_TYPES.has(el.tags?.highway ?? "")
    ).length;
    const quietCount = highways.filter((el) =>
      QUIET_HIGHWAY_TYPES.has(el.tags?.highway ?? "")
    ).length;
    const busyCount = highways.filter((el) =>
      BUSY_HIGHWAY_TYPES.has(el.tags?.highway ?? "")
    ).length;

    trailRatio = trailCount / highwayTotal;
    quietRatio = quietCount / highwayTotal;
    busyRatio = busyCount / highwayTotal;
  }

  // Road quality: reward quiet roads (secondary/tertiary), penalize busy roads
  const roadQualityScore = Math.max(
    0,
    Math.min(1, quietRatio * 0.7 + (1 - busyRatio) * 0.3)
  );

  // ── Scenic density ─────────────────────────────────────────────────────────
  const scenicElements = elements.filter(
    (el) =>
      el.tags?.natural != null ||
      el.tags?.landuse === "forest" ||
      el.tags?.landuse === "wood" ||
      el.tags?.leisure === "nature_reserve"
  );
  const areaKm2 = bboxAreaKm2(bbox);
  // 3+ natural elements per km² → full scenic score
  const scenicScore = Math.min(1.0, scenicElements.length / (areaKm2 * 3));

  // ── Official cycling route bonus ───────────────────────────────────────────
  const cycleRouteBonus = elements.some(
    (el) => el.type === "relation" && el.tags?.route === "bicycle"
  )
    ? 1.0
    : 0.0;

  // ── Sport-specific weighted combination ───────────────────────────────────
  switch (sport) {
    case "cycling_mtb":
      // Heavily prefer off-road trails and natural scenery
      return (
        0.40 * trailRatio +
        0.25 * scenicScore +
        0.20 * Math.max(0, 1 - busyRatio * 2) + // strongly penalize busy roads
        0.10 * surfaceScore +
        0.05 * cycleRouteBonus
      );

    case "cycling_gravel":
      // Mix of trails and quiet roads, with scenic bonus
      return (
        0.30 * trailRatio +
        0.25 * roadQualityScore +
        0.25 * scenicScore +
        0.10 * surfaceScore +
        0.10 * cycleRouteBonus
      );

    case "cycling_road":
      // Quiet secondary/tertiary roads, smooth surface, avoid main axes
      return (
        0.50 * roadQualityScore +
        0.25 * surfaceScore +
        0.15 * scenicScore +
        0.10 * cycleRouteBonus
      );

    default:
      // Running: balance between surface, trails, and scenery
      return (
        0.35 * surfaceScore +
        0.30 * trailRatio +
        0.25 * scenicScore +
        0.10 * cycleRouteBonus
      );
  }
}

// ─── Loop score ───────────────────────────────────────────────────────────────

/**
 * Computes how well a route closes back to its start point.
 *
 * Score formula: `max(0, 1 - distanceKm / 2.0)` where `distanceKm` is the
 * haversine distance between the last route point and `start`.
 *
 * A gap of 0 km → score 1.0 (perfect loop).
 * A gap of 2 km or more → score 0.0.
 *
 * @param points - Route points (only the last one is used)
 * @param start - Start coordinate to measure closure against
 * @returns Loop quality score in [0, 1]
 */
export function computeLoopScore(points: RoutePoint[], start: Coordinate): number {
  if (points.length === 0) return 0;
  const end = points[points.length - 1];
  const distKm = haversineKm(start, end);
  return Math.max(0, 1 - distKm / 2.0);
}

// ─── Scoring ─────────────────────────────────────────────────────────────────

/**
 * Computes the weighted multi-criteria score for a route candidate.
 *
 * Formula:
 * ```
 * score = w.elevationMatch × elevMatch
 *       + w.distanceMatch  × distMatch
 *       + w.surfaceQuality × surfaceScore
 *       + w.loopQuality    × loopScore
 * ```
 *
 * Where:
 * - `elevMatch = max(0, 1 - |ascendM − targetElevationM| / max(targetElevationM, 1))`
 * - `distMatch = max(0, 1 - |distanceKm − targetDistanceKm| / max(targetDistanceKm, 1))`
 *
 * Both error terms are normalised to the target value, so a 20% error
 * always produces a 0.8 component score regardless of absolute magnitude.
 *
 * @param candidate - Partial candidate with the four scored fields
 * @param profile - Session profile providing scoring weights
 * @param targetDistanceKm - Desired distance in km
 * @param targetElevationM - Desired D+ in metres
 * @returns Weighted score in [0, 1] (higher = better)
 *
 * @example
 * scoreRoute(
 *   { ascendM: 160, distanceKm: 13.5, surfaceScore: 0.7, loopScore: 0.9 },
 *   PROFILES_BY_ID.get("running_endurance")!,
 *   14, 150
 * )
 * // → ~0.81
 */
export function scoreRoute(
  candidate: Pick<RouteCandidate, "ascendM" | "distanceKm" | "surfaceScore" | "loopScore">,
  profile: SessionProfile,
  targetDistanceKm: number,
  targetElevationM: number
): number {
  const { weights } = profile;

  const elevDiff = Math.abs(candidate.ascendM - targetElevationM);
  const elevMatch = Math.max(0, 1 - elevDiff / Math.max(targetElevationM, 1));

  const distDiff = Math.abs(candidate.distanceKm - targetDistanceKm);
  const distMatch = Math.max(0, 1 - distDiff / Math.max(targetDistanceKm, 1));

  return (
    weights.elevationMatch * elevMatch +
    weights.distanceMatch * distMatch +
    weights.surfaceQuality * candidate.surfaceScore +
    weights.loopQuality * candidate.loopScore
  );
}

// ─── Main entry point ─────────────────────────────────────────────────────────

/**
 * Full route generation pipeline.
 *
 * Pipeline steps:
 * 1. Resolve profile from `request.profileId`
 * 2. Geocode start address (and optional waypoints/end) in parallel
 * 3. Fetch N_CANDIDATES route variants via GraphHopper or ORS
 * 4. Enrich with Open-Meteo elevation (GraphHopper path only)
 * 5. Query Overpass for terrain data (single bbox query, cached 1h)
 * 6. Score each candidate with `scoreRoute()`
 * 7. Sort descending by `totalScore`
 * 8. Fetch Strava heatmap popularity for top 4 candidates (optional)
 * 9. Re-sort after popularity boost (scenic profiles only)
 * 10. Validate that the best candidate is not impossibly flat
 *
 * @param request - Generation parameters from the API route handler
 * @returns The generated route with all candidates sorted by score
 * @throws {Error} `"UNKNOWN_PROFILE"` — profileId not in SESSION_PROFILES
 * @throws {Error} `"GEOCODING_FAILED"` — address not resolvable by Nominatim
 * @throws {Error} `"NO_ROAD_NETWORK"` — routing engine found no valid path
 * @throws {Error} `"IMPOSSIBLE_ELEVATION:N"` — best candidate has < 30% of target D+
 *   (N = maximum D+ found across all candidates, in metres)
 *
 * @example
 * const route = await generateRoute({
 *   address: "Parc des Buttes-Chaumont, Paris",
 *   profileId: "running_endurance",
 *   targetDistanceKm: 14,
 *   targetElevationM: 150,
 * });
 * route.best.totalScore // → 0.78–0.92 depending on terrain
 */
export async function generateRoute(
  request: RouteRequest
): Promise<GeneratedRoute> {
  const profile = PROFILES_BY_ID.get(request.profileId);
  if (!profile) throw new Error("UNKNOWN_PROFILE");

  // Step 1: Geocode start + optional waypoints + optional end (in parallel)
  const startCoordinate = await geocodeAddress(request.address);

  const [waypointCoords, endCoord] = await Promise.all([
    request.waypoints?.length
      ? Promise.all(
          request.waypoints
            .filter((w) => w.trim())
            .map((w) => geocodeAddress(w))
        )
      : Promise.resolve(undefined),
    request.endAddress?.trim()
      ? geocodeAddress(request.endAddress)
      : Promise.resolve(undefined),
  ]);

  // Step 2 + 3: Fetch candidates with elevation
  const targetDistanceM = request.targetDistanceKm * 1000;
  let enrichedCandidates: EnrichedCandidate[];

  if (profile.orsProfile && ORS_API_KEY) {
    // ── ORS path: sport-specific cycling profiles, elevation included ────────
    enrichedCandidates = await fetchCandidateRoutesORS(
      startCoordinate,
      profile.orsProfile,
      targetDistanceM,
      waypointCoords ?? undefined,
      endCoord ?? undefined
    );
  } else {
    // ── GraphHopper path: running routes, or cycling fallback if ORS key absent
    // Falls back to GraphHopper "bike" using profile.graphhopperProfile
    const rawCandidates = await fetchCandidateRoutes(
      startCoordinate,
      profile,
      targetDistanceM,
      waypointCoords ?? undefined,
      endCoord ?? undefined
    );

    enrichedCandidates = await Promise.all(
      rawCandidates.map(async ({ path }) => {
        const fullCoords = path.points.coordinates as [number, number][]; // [lng, lat][]
        const sampled = subsamplePoints(fullCoords, MAX_ROUTE_POINTS);
        const coordObjects: Coordinate[] = sampled.map(([lng, lat]) => ({ lat, lng }));
        const elevations = await fetchElevations(coordObjects);

        const points: RoutePoint[] = coordObjects.map((c, i) => ({
          ...c,
          elevation: elevations[i] ?? undefined,
        }));

        const { ascendM, descendM } = computeAscent(
          elevations.filter((e): e is number => e != null)
        );

        return {
          points,
          rawCoords: fullCoords,
          ascendM,
          descendM,
          distanceKm: path.distance / 1000,
          durationSeconds: path.time / 1000,
        };
      })
    );
  }

  // Step 4: Terrain scoring via enhanced Overpass query (single query for all candidates)
  const allCoords = enrichedCandidates.flatMap((c) =>
    c.points.map(({ lat, lng }) => ({ lat, lng }))
  );
  const bbox = routeBBox(allCoords);
  const overpassData = await fetchSurfaceData(bbox);
  const terrainScore = computeTerrainScore(overpassData, profile, bbox);

  // Step 5: Build RouteCandidate objects and score each one
  const candidates: RouteCandidate[] = enrichedCandidates.map((ec) => {
    const loopScore = computeLoopScore(ec.points, startCoordinate);

    const partialCandidate = {
      ascendM: ec.ascendM,
      distanceKm: ec.distanceKm,
      surfaceScore: terrainScore,
      loopScore,
    };

    const totalScore = scoreRoute(
      partialCandidate,
      profile,
      request.targetDistanceKm,
      request.targetElevationM
    );

    return {
      points: ec.points,
      distanceKm: ec.distanceKm,
      durationSeconds: ec.durationSeconds,
      ascendM: ec.ascendM,
      descendM: ec.descendM,
      surfaceScore: terrainScore,
      loopScore,
      totalScore,
      geometry: {
        type: "LineString" as const,
        coordinates: ec.rawCoords,
      },
    };
  });

  // Step 6: Sort by score (best first)
  candidates.sort((a, b) => b.totalScore - a.totalScore);

  const best = candidates[0];

  // Step 7: Impossible D+ detection
  if (
    request.targetElevationM > 200 &&
    best.ascendM < request.targetElevationM * 0.3
  ) {
    const maxEstimate = Math.round(Math.max(...candidates.map((c) => c.ascendM)));
    throw new Error(`IMPOSSIBLE_ELEVATION:${maxEstimate}`);
  }

  return {
    best,
    candidates,
    startCoordinate,
    profile,
  };
}
