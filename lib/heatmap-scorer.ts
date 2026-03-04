/**
 * Strava heatmap popularity scorer.
 *
 * Samples points along a route, fetches the corresponding heatmap tile
 * from the local Go proxy (port 8080), reads pixel brightness using the
 * OffscreenCanvas API, and returns a popularity score 0–1.
 *
 * The proxy handles Strava CloudFront authentication (cookies) and
 * re-exposes tiles at `http://localhost:8080/identified/globalheat/…`.
 *
 * This module runs server-side (inside the Next.js API route) and uses
 * the `createImageBitmap` + `OffscreenCanvas` APIs available in Node 18+.
 */

/** Strava heatmap tiles are 512×512 pixels at @2x resolution. */
const TILE_SIZE = 512;

/**
 * Per-point fetch timeout in milliseconds. Kept short because a slow proxy
 * should not block the main pipeline — popularity scoring is optional.
 */
const FETCH_TIMEOUT_MS = 2000;

/**
 * Half-width of the pixel sampling block around each route point.
 * A 7×7 block (radius 3) averages out anti-aliasing and GPS imprecision.
 */
const SAMPLE_BLOCK_RADIUS = 3;

// ── GPS → tile XYZ conversion ────────────────────────────────────────────────

/** Slippy map tile coordinates at a given zoom level. */
interface TileCoord {
  /** Tile column (0-indexed from west) */
  x: number;
  /** Tile row (0-indexed from north) */
  y: number;
  /** Zoom level */
  z: number;
}

/**
 * Converts WGS-84 coordinates to slippy map tile indices using the
 * standard Web Mercator (EPSG:3857) projection.
 *
 * @param lat - Latitude in decimal degrees
 * @param lon - Longitude in decimal degrees
 * @param zoom - Mapbox/OSM zoom level (typically 12 for popularity scoring)
 * @returns Tile `{x, y, z}` containing the given coordinate
 *
 * @example
 * coordsToTile(48.8566, 2.3522, 12)
 * // → { x: 2075, y: 1409, z: 12 }  (Paris tile at zoom 12)
 */
function coordsToTile(lat: number, lon: number, zoom: number): TileCoord {
  const n = Math.pow(2, zoom);
  const x = Math.floor(((lon + 180) / 360) * n);
  const latRad = (lat * Math.PI) / 180;
  const y = Math.floor(
    ((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n
  );
  return { x, y, z: zoom };
}

// ── Fetch with timeout ──────────────────────────────────────────────────────

/**
 * Wraps `fetch` with an `AbortController` timeout.
 *
 * @param url - URL to fetch
 * @param timeoutMs - Abort after this many milliseconds
 * @returns The `Response` object
 * @throws {DOMException} `AbortError` when the timeout fires
 */
async function fetchWithTimeout(url: string, timeoutMs: number): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, { signal: controller.signal });
    return res;
  } finally {
    clearTimeout(timer);
  }
}

// ── Score a single point ────────────────────────────────────────────────────

/**
 * Fetches the Strava heatmap tile for a coordinate and reads the pixel
 * brightness at that location to produce a popularity score.
 *
 * The "hot" colormap maps activity density as:
 * black (low) → red → orange → yellow → white (extreme).
 *
 * Pixel score formula: `(R×0.5 + G×0.3 + B×0.1) / (255×0.9)`.
 * Transparent pixels (alpha < 10) indicate zero recorded activity → 0.1.
 * Proxy unavailability or canvas errors return 0.5 (neutral, no penalty).
 *
 * @param lat - Latitude of the point to score
 * @param lon - Longitude of the point to score
 * @param sport - Activity filter for the heatmap layer
 * @param zoom - Tile zoom level (default 12 — good trade-off between
 *   tile coverage per request and spatial precision for scoring)
 * @returns Popularity score in [0, 1]
 */
async function getPointPopularity(
  lat: number,
  lon: number,
  sport: "all" | "running" | "ride" = "all",
  zoom = 12
): Promise<number> {
  const { x, y, z } = coordsToTile(lat, lon, zoom);
  // TODO: Make the proxy base URL configurable via an env var (e.g. STRAVA_PROXY_URL)
  // so it works in Docker / CI without code changes.
  const proxyBase = process.env.STRAVA_PROXY_URL ?? "http://localhost:8080";
  const url = `${proxyBase}/identified/globalheat/${sport}/hot/${z}/${x}/${y}@2x.png?v=19`;

  let response: Response;
  try {
    response = await fetchWithTimeout(url, FETCH_TIMEOUT_MS);
    if (!response.ok) return 0.5;
  } catch {
    return 0.5; // neutral fallback
  }

  try {
    const blob = await response.blob();
    const bitmap = await createImageBitmap(blob);

    const canvas = new OffscreenCanvas(bitmap.width, bitmap.height);
    const ctx = canvas.getContext("2d");
    if (!ctx) return 0.5;

    ctx.drawImage(bitmap, 0, 0);

    // Compute pixel position of the point within the tile
    const n = Math.pow(2, z);
    const latRad = (lat * Math.PI) / 180;
    const pixelX = Math.floor(
      (((lon + 180) / 360) * n - x) * TILE_SIZE
    );
    const pixelY = Math.floor(
      (((1 - Math.log(Math.tan(latRad) + 1 / Math.cos(latRad)) / Math.PI) / 2) * n - y) *
        TILE_SIZE
    );

    // Read 7×7 block centered on the point
    const r = SAMPLE_BLOCK_RADIUS;
    const startX = Math.max(0, pixelX - r);
    const startY = Math.max(0, pixelY - r);
    const endX = Math.min(bitmap.width - 1, pixelX + r);
    const endY = Math.min(bitmap.height - 1, pixelY + r);

    const blockW = endX - startX + 1;
    const blockH = endY - startY + 1;
    if (blockW <= 0 || blockH <= 0) return 0.1;

    const imageData = ctx.getImageData(startX, startY, blockW, blockH);
    const data = imageData.data;

    let totalScore = 0;
    let validPixels = 0;

    for (let i = 0; i < data.length; i += 4) {
      const alpha = data[i + 3];
      if (alpha < 10) continue; // transparent → no activity

      const rVal = data[i];
      const gVal = data[i + 1];
      const bVal = data[i + 2];

      // "hot" colormap: black→red→orange→yellow→white
      const pixelScore = (rVal * 0.5 + gVal * 0.3 + bVal * 0.1) / (255 * 0.9);
      totalScore += Math.min(1, Math.max(0, pixelScore));
      validPixels++;
    }

    if (validPixels === 0) return 0.1; // fully transparent = no activity
    return Math.min(1, Math.max(0, totalScore / validPixels));
  } catch {
    return 0.5;
  }
}

// ── Score an entire route ───────────────────────────────────────────────────

/**
 * Computes a popularity score for an entire route by sampling a fixed number
 * of evenly-spaced points and averaging their individual scores.
 *
 * With `sampleCount = 8` (default), the total proxy requests per route is 8
 * concurrent fetches — acceptable latency with statistically meaningful coverage.
 *
 * @param coordinates - Full route geometry in [lng, lat] order (GeoJSON convention)
 * @param sport - Strava activity type filter
 * @param sampleCount - Number of evenly-spaced points to sample (default 8)
 * @returns
 *   - `meanScore` — average popularity score across sampled points (0–1)
 *   - `popularSegmentRatio` — fraction of sampled points with score > 0.55
 *
 * @example
 * const { meanScore } = await scoreRoutePopularity(route.geometry.coordinates, "running");
 * // meanScore → 0.72 on a well-used running route in a city park
 */
export async function scoreRoutePopularity(
  coordinates: [number, number][], // [lng, lat][]
  sport: "all" | "running" | "ride" = "all",
  sampleCount = 8
): Promise<{ meanScore: number; popularSegmentRatio: number }> {
  if (coordinates.length === 0) {
    return { meanScore: 0.5, popularSegmentRatio: 0 };
  }

  // Select evenly-spaced sample points
  // Guard: sampleCount=1 would cause division by zero below; clamp to at least 2
  const effectiveSampleCount = Math.max(2, sampleCount);
  const step = Math.max(1, Math.floor((coordinates.length - 1) / (effectiveSampleCount - 1)));
  const sampleIndices: number[] = [];
  for (let i = 0; i < coordinates.length && sampleIndices.length < effectiveSampleCount; i += step) {
    sampleIndices.push(i);
  }
  // Always include the last point
  if (sampleIndices[sampleIndices.length - 1] !== coordinates.length - 1) {
    sampleIndices.push(coordinates.length - 1);
  }

  const scores = await Promise.all(
    sampleIndices.map((idx) => {
      const [lng, lat] = coordinates[idx];
      return getPointPopularity(lat, lng, sport);
    })
  );

  const meanScore = scores.reduce((sum, s) => sum + s, 0) / scores.length;
  const popularCount = scores.filter((s) => s > 0.55).length;
  const popularSegmentRatio = popularCount / scores.length;

  return { meanScore, popularSegmentRatio };
}
