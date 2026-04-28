// ── Route dispatch thresholds ─────────────────────────────────────────────────
// Routes exceeding either threshold are sent to the server (FULL_CONFIG).
// Routes below both thresholds run in the browser Web Worker (LIGHT_CONFIG).

export const HEAVY_DISTANCE_KM = 25;
export const HEAVY_ELEVATION_M = 600;

/**
 * Returns true when a route request should be handled server-side.
 * Threshold: distance > 25 km OR elevation > 600 m D+.
 */
export function isHeavyRoute(distanceKm: number, elevationM: number): boolean {
  return distanceKm > HEAVY_DISTANCE_KM || elevationM > HEAVY_ELEVATION_M;
}
