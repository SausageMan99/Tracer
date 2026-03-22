import type { Coordinate } from "../../types";
import type { DataFetcher, OverpassResponse } from "./data-fetcher";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const ELEVATION_BATCH_SIZE = 100;

/**
 * Primary endpoint first; fallback endpoint tried immediately when the
 * primary returns a transient error (429 / 503 / timeout).
 */
const OVERPASS_ENDPOINTS = [
  "https://overpass-api.de/api/interpreter",
  "https://overpass.kumi.systems/api/interpreter",
] as const;

const MAX_ATTEMPTS = 3;

// ---------------------------------------------------------------------------
// DirectFetcher
// ---------------------------------------------------------------------------

/**
 * Concrete implementation of `DataFetcher` that calls external APIs directly.
 *
 * Suitable for Node.js server-side usage (Next.js API routes, Edge Functions
 * that allow external outbound requests). For browser / CSP-restricted
 * environments, use `ProxyFetcher` instead.
 *
 * Overpass behaviour:
 * - Tries both endpoints per attempt (primary → fallback).
 * - Up to 3 attempts with 1 s / 2 s back-off between them.
 * - Timeout: 30 s on first attempt, 20 s on subsequent ones.
 *
 * Elevation behaviour:
 * - Sequential batches of 100 coordinates to Open-Meteo.
 * - Falls back to `0` per coordinate on any error (graceful degradation).
 */
export class DirectFetcher implements DataFetcher {
  // -------------------------------------------------------------------------
  // fetchOverpassData
  // -------------------------------------------------------------------------

  async fetchOverpassData(
    center: Coordinate,
    radiusKm: number
  ): Promise<OverpassResponse> {
    const query = buildOverpassQuery(center, radiusKm);
    let lastError: Error = new Error("Overpass fetch failed");

    for (let attempt = 0; attempt < MAX_ATTEMPTS; attempt++) {
      const timeoutMs = attempt === 0 ? 30_000 : 20_000;

      for (const endpoint of OVERPASS_ENDPOINTS) {
        try {
          const controller = new AbortController();
          const timer = setTimeout(() => controller.abort(), timeoutMs);

          const resp = await fetch(endpoint, {
            method: "POST",
            body: `data=${encodeURIComponent(query)}`,
            headers: { "Content-Type": "application/x-www-form-urlencoded" },
            signal: controller.signal,
          });

          clearTimeout(timer);

          if (resp.ok) {
            return (await resp.json()) as OverpassResponse;
          }

          // Transient errors — try next endpoint / attempt
          if (resp.status === 429 || resp.status === 503) {
            lastError = new Error(`Overpass ${resp.status} from ${endpoint}`);
            continue;
          }

          // Non-transient HTTP error — record and try fallback endpoint
          lastError = new Error(`Overpass HTTP ${resp.status} from ${endpoint}`);
        } catch (err) {
          lastError = err instanceof Error ? err : new Error(String(err));
        }
      }

      // Back-off before next attempt (skip sleep after the last attempt)
      if (attempt < MAX_ATTEMPTS - 1) {
        await new Promise<void>((resolve) =>
          setTimeout(resolve, (attempt + 1) * 1_000)
        );
      }
    }

    throw lastError;
  }

  // -------------------------------------------------------------------------
  // fetchElevations
  // -------------------------------------------------------------------------

  async fetchElevations(coords: Coordinate[]): Promise<number[]> {
    if (coords.length === 0) return [];

    const results: number[] = [];

    for (let i = 0; i < coords.length; i += ELEVATION_BATCH_SIZE) {
      const batch = coords.slice(i, i + ELEVATION_BATCH_SIZE);
      const batchResult = await fetchElevationBatch(batch);
      results.push(...batchResult);
    }

    return results;
  }
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Fetches elevation for a single batch (≤ 100 coordinates).
 * Returns zeros for the entire batch on any error.
 */
async function fetchElevationBatch(batch: Coordinate[]): Promise<number[]> {
  try {
    const lats = batch.map((c) => c.lat.toFixed(6)).join(",");
    const lngs = batch.map((c) => c.lng.toFixed(6)).join(",");

    const resp = await fetch(
      `https://api.open-meteo.com/v1/elevation?latitude=${lats}&longitude=${lngs}`,
      { signal: AbortSignal.timeout(10_000) }
    );

    if (!resp.ok) {
      throw new Error(`Elevation API returned HTTP ${resp.status}`);
    }

    const data = (await resp.json()) as { elevation?: number[] };

    if (!data.elevation || !Array.isArray(data.elevation) || data.elevation.length === 0) {
      throw new Error("Empty elevation response from Open-Meteo");
    }

    return data.elevation;
  } catch {
    // Graceful degradation: callers treat 0 as "unknown elevation"
    return batch.map(() => 0);
  }
}

/**
 * Builds the Overpass QL query that fetches all highway ways and scenic
 * features within a circular bounding area.
 *
 * The query mirrors the logic previously embedded in `graph-builder.ts` so
 * that callers receive the same data regardless of which fetcher is used.
 */
function buildOverpassQuery(center: Coordinate, radiusKm: number): string {
  const radiusM = Math.round(radiusKm * 1_000);
  const { lat, lng } = center;

  return `[out:json][timeout:25];(
  way(around:${radiusM},${lat},${lng})["highway"~"^(secondary|tertiary|unclassified|residential|service|living_street|pedestrian|track|path|cycleway|bridleway|footway|secondary_link|tertiary_link)$"];
  way(around:${radiusM},${lat},${lng})["natural"~"^(water|wood|forest)$"];
  way(around:${radiusM},${lat},${lng})["landuse"~"^(forest|wood)$"];
  way(around:${radiusM},${lat},${lng})["leisure"="nature_reserve"];
  node(around:${radiusM},${lat},${lng})["tourism"="viewpoint"];
  way(around:${radiusM},${lat},${lng})["waterway"~"^(river|stream)$"];
  way(around:${radiusM},${lat},${lng})["boundary"="national_park"];
);out body;>;out skel qt;`;
}
