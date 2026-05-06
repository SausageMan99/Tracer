/**
 * Typed error class for route generation failures.
 *
 * Replaces string-encoded error codes (e.g. `"NO_ROAD_NETWORK:EMPTY_GRAPH"`)
 * with a structured, type-safe error that carries both the machine-readable
 * code and an optional sub-code.
 */

export type RouteErrorCode =
  | "NO_ROAD_NETWORK"
  | "ROUTE_CANDIDATES_REJECTED"
  | "IMPOSSIBLE_ELEVATION"
  | "GEOCODING_FAILED"
  | "UNKNOWN";

export type RouteErrorSubCode =
  | "OVERPASS_TIMEOUT"
  | "EMPTY_GRAPH"
  | "SOLVER_EMPTY"
  | "TRAIL_PROMISE_UNMET";

export class RouteGenerationError extends Error {
  readonly code: RouteErrorCode;
  readonly subCode?: RouteErrorSubCode;
  /** Present only for IMPOSSIBLE_ELEVATION — max achievable D+ */
  readonly maxElevationEstimate?: number;

  constructor(
    code: RouteErrorCode,
    opts?: {
      subCode?: RouteErrorSubCode;
      maxElevationEstimate?: number;
      message?: string;
    }
  ) {
    const msg = opts?.message ?? `${code}${opts?.subCode ? `:${opts.subCode}` : ""}`;
    super(msg);
    this.name = "RouteGenerationError";
    this.code = code;
    this.subCode = opts?.subCode;
    this.maxElevationEstimate = opts?.maxElevationEstimate;
  }
}
