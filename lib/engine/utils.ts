/**
 * Pure utility functions and constants shared across the V2 routing engine.
 *
 * This module is intentionally free of side effects (no API calls, no file I/O,
 * no Node.js-specific APIs) so it can run in a Web Worker or any browser context.
 *
 * Side-effectful utilities (geocoding, elevation fetch, Overpass queries) remain
 * in `lib/route-generator-legacy.ts`.
 */

import type { Coordinate, RouteCandidate, RoutePoint, SessionProfile } from "../types";

// ─── Surface / highway constant sets ─────────────────────────────────────────

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

// ─── Haversine ────────────────────────────────────────────────────────────────

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
