// ---- Core domain types ----

/**
 * Supported sports. Each value maps to a distinct routing strategy:
 * - `"running"` → GraphHopper `foot` profile
 * - `"cycling_road"` → OpenRouteService `cycling-road`
 * - `"cycling_gravel"` → OpenRouteService `cycling-regular`
 * - `"cycling_mtb"` → OpenRouteService `cycling-mountain`
 */
export type Sport =
  | "running"
  | "cycling_road"
  | "cycling_gravel"
  | "cycling_mtb";

/**
 * Physiological session archetypes used to drive the scoring algorithm.
 * Each type implies different target distances, elevation budgets, and
 * terrain surface preferences.
 */
export type SessionType =
  | "endurance"
  | "seuil_lactique"
  | "intervals_30_30"
  | "sortie_longue"
  | "recuperation"
  | "seuil"
  | "intervals"
  | "gran_fondo";

// ---- Session Profile ----

/**
 * Scoring weight vector for a session profile. All values are in [0, 1]
 * and must sum to 1.0. They control how the multi-criteria score is
 * computed in `scoreRoute()`.
 */
export interface ScoringWeights {
  /** 0–1: importance of matching the target D+ */
  elevationMatch: number;
  /** 0–1: importance of matching the target distance */
  distanceMatch: number;
  /** 0–1: importance of surface type alignment with the sport */
  surfaceQuality: number;
  /** 0–1: importance of the route returning near the start (loop quality) */
  loopQuality: number;
}

/**
 * Allowed distance range for a session profile, in kilometres.
 * The UI sliders are bounded by `min`/`max`; `default` is pre-selected.
 */
export interface DistanceRange {
  /** Minimum distance in km (slider lower bound) */
  min: number;
  /** Default distance in km (pre-selected on profile change) */
  default: number;
  /** Maximum distance in km (slider upper bound) */
  max: number;
}

/**
 * Allowed elevation range for a session profile, in metres of D+.
 * The UI sliders are bounded by `min`/`max`; `default` is pre-selected.
 */
export interface ElevationRange {
  /** Minimum D+ in metres */
  min: number;
  /** Default D+ in metres (pre-selected on profile change) */
  default: number;
  /** Maximum D+ in metres */
  max: number;
}

/**
 * A fully-specified training profile that drives route generation.
 * Each profile encodes what a particular session type *needs* from
 * the terrain, encoded as scoring weights and range constraints.
 *
 * @example
 * // A road-cycling threshold session: prioritises distance accuracy
 * // and smooth paved surfaces, allows moderate elevation.
 * const profile: SessionProfile = PROFILES_BY_ID.get("cycling_road_seuil")!;
 */
export interface SessionProfile {
  /** Unique string identifier, e.g. `"running_endurance"` */
  id: string;
  /** Human-readable display name shown in the UI */
  name: string;
  /** Sport category; determines which routing engine is used */
  sport: Sport;
  /** Physiological session type */
  sessionType: SessionType;
  /** Allowed distance range for this profile, in km */
  distanceRange: DistanceRange;
  /** Allowed D+ range for this profile, in metres */
  elevationRange: ElevationRange;
  /** Short French description shown below the session chip */
  description: string;
  /** Scoring weight vector — must sum to 1.0 */
  weights: ScoringWeights;
  /**
   * GraphHopper vehicle identifier: `"foot"` for running, `"bike"` for cycling.
   * Used as fallback when `orsProfile` is absent or ORS key is not set.
   */
  graphhopperProfile: string;
  /**
   * OpenRouteService profile slug: `"cycling-road"` | `"cycling-regular"` | `"cycling-mountain"`.
   * When set and `ORS_API_KEY` is present, ORS is used instead of GraphHopper.
   * Enables sport-specific routing (road vs gravel vs trail preference).
   */
  orsProfile?: string;
}

// ---- Route Generation ----

/**
 * Input contract for the `generateRoute()` function.
 * Mirrors the HTTP POST body of `/api/generate-route`.
 */
export interface RouteRequest {
  /** Free-text starting address, geocoded via Nominatim */
  address: string;
  /** Profile ID, must exist in `PROFILES_BY_ID` */
  profileId: string;
  /** Target total distance in km */
  targetDistanceKm: number;
  /** Target positive elevation gain in metres */
  targetElevationM: number;
  /** Optional intermediate waypoints (geocoded in order) */
  waypoints?: string[];
  /** Optional end address; when absent the route loops back to start */
  endAddress?: string;
}

/**
 * A WGS-84 latitude/longitude pair.
 *
 * @example
 * const paris: Coordinate = { lat: 48.8566, lng: 2.3522 };
 */
export interface Coordinate {
  /** WGS-84 latitude in decimal degrees */
  lat: number;
  /** WGS-84 longitude in decimal degrees */
  lng: number;
}

/**
 * A route point that extends `Coordinate` with optional elevation.
 * Elevation is `undefined` before Open-Meteo enrichment and populated
 * after the batch fetch in `fetchElevations()`.
 */
export interface RoutePoint extends Coordinate {
  /** Elevation above sea level in metres (ASL). Undefined before enrichment. */
  elevation?: number;
}

/**
 * A fully evaluated route candidate produced by the generation pipeline.
 * Scores range from 0 to 1; `totalScore` is the weighted sum used for ranking.
 */
export interface RouteCandidate {
  /** Subsampled route points with elevation (max 200 points) */
  points: RoutePoint[];
  /** Actual route distance in km */
  distanceKm: number;
  /** Estimated duration in seconds (from routing engine) */
  durationSeconds: number;
  /** Positive elevation gain in metres, computed from Open-Meteo data */
  ascendM: number;
  /** Negative elevation loss in metres */
  descendM: number;
  /** Terrain quality score 0–1, sport-specific (from Overpass data) */
  surfaceScore: number;
  /** Loop closure score 0–1: 1.0 = perfect loop, 0 = point-to-point ≥2 km gap */
  loopScore: number;
  /** Weighted multi-criteria score 0–1 (higher = better match) */
  totalScore: number;
  /** Full road-following geometry for map display (more points than `points`) */
  geometry: {
    type: "LineString";
    /** Coordinates in [lng, lat] order (GeoJSON convention) */
    coordinates: [number, number][];
  };
}

/**
 * Statistics produced by the SmartRoute post-processing pipeline.
 * Present on `GeneratedRoute` when SmartRoute was applied server-side.
 */
export interface SmartRouteStats {
  /** Number of route points before simplification */
  originalPoints: number;
  /** Number of route points after Douglas-Peucker simplification */
  optimizedPoints: number;
  /** Number of points successfully snapped to road network by OSRM */
  snappedPoints: number;
  /** Percentage reduction in point count (0–100) */
  pointReductionPct: number;
  /** Surface breakdown ratios (values sum to 1.0) */
  surfaceRatio: {
    /** Fraction of route on asphalt/paved surfaces */
    asphalt: number;
    /** Fraction of route on gravel/unpaved surfaces */
    gravel: number;
    /** Fraction of route on dirt/trail surfaces */
    trail: number;
    /** Fraction with unknown surface */
    unknown: number;
  };
  /** OSRM match confidence 0–1 (higher = better road alignment) */
  snapConfidence: number;
  /** Optimized route distance in km */
  distanceKm: number;
  /** Optimized positive elevation gain in metres */
  elevationM: number;
}

/**
 * The complete output of the route generation pipeline.
 * `best` is always `candidates[0]` (highest-scoring candidate);
 * `candidates` are sorted descending by `totalScore`.
 */
export interface GeneratedRoute {
  /** Highest-scoring route candidate — displayed first on the map */
  best: RouteCandidate;
  /** All candidates sorted descending by score (best first) */
  candidates: RouteCandidate[];
  /** Geocoded start coordinate (from Nominatim) */
  startCoordinate: Coordinate;
  /** Session profile used to generate this route */
  profile: SessionProfile;
  /**
   * SmartRoute post-processing statistics.
   * Present only when SmartRoute was successfully applied server-side.
   */
  smartRouteStats?: SmartRouteStats;
}

// ---- API contract ----

/**
 * HTTP POST body for `POST /api/generate-route`.
 * Identical to `RouteRequest` but exposed as the API boundary type
 * to allow independent evolution.
 */
export interface GenerateRouteRequest {
  /** Free-text starting address */
  address: string;
  /** Must match an ID in `SESSION_PROFILES` */
  profileId: string;
  /** Target distance in km */
  targetDistanceKm: number;
  /** Target D+ in metres */
  targetElevationM: number;
  /** Optional via waypoints */
  waypoints?: string[];
  /** Optional end address (absent = loop) */
  endAddress?: string;
}

/**
 * Successful response from `POST /api/generate-route`.
 * HTTP status 200.
 */
export interface GenerateRouteResponse {
  success: true;
  /** The generated route with candidates and scoring metadata */
  route: GeneratedRoute;
}

/**
 * Error response from `POST /api/generate-route`.
 * HTTP status 400 (validation) or 422 (generation failure).
 *
 * Error codes:
 * - `NO_ROAD_NETWORK` → GraphHopper/ORS found no routable path
 * - `IMPOSSIBLE_ELEVATION` → requested D+ exceeds terrain maximum
 * - `GEOCODING_FAILED` → Nominatim could not resolve the address
 * - `UNKNOWN` → unexpected server error
 */
export interface GenerateRouteError {
  success: false;
  /** Human-readable French error message for display */
  error: string;
  /** Machine-readable error code for client-side handling */
  errorCode:
    | "NO_ROAD_NETWORK"
    | "IMPOSSIBLE_ELEVATION"
    | "GEOCODING_FAILED"
    | "UNKNOWN";
  /**
   * Only present when `errorCode === "IMPOSSIBLE_ELEVATION"`.
   * The maximum achievable D+ estimated from candidate routes, in metres.
   */
  maxElevationEstimate?: number;
}

// ---- Store ----

/**
 * Application lifecycle status.
 * - `"idle"` → no route generated yet (form visible)
 * - `"loading"` → API call in progress
 * - `"success"` → route displayed
 * - `"error"` → generation failed, error message available
 */
export type AppStatus = "idle" | "loading" | "success" | "error";

/**
 * Serialisable slice of the Zustand store state.
 * All UI state is derived from this shape; actions are defined in `AppStore`.
 */
export interface AppState {
  /** Current application lifecycle status */
  status: AppStatus;
  /** Human-readable error message; non-null only when `status === "error"` */
  errorMessage: string | null;
  /** The most recently generated route; null when status is not "success" */
  currentRoute: GeneratedRoute | null;
  /**
   * Index into `currentRoute.candidates` that the user has selected.
   * Selecting a candidate also updates `currentRoute.best`.
   */
  candidateIndex: number;
  /** Current map centre coordinate (drives Mapbox camera) */
  mapCenter: Coordinate;
  /** Current map zoom level */
  mapZoom: number;
  /** ID of the selected `SessionProfile` */
  selectedProfileId: string;
  /** Target distance in km (bound to the slider) */
  targetDistanceKm: number;
  /** Target D+ in metres (bound to the slider) */
  targetElevationM: number;
  /** Current address string (bound to the AddressInput) */
  address: string;
}

// ---- GraphHopper API (internal) ----

/**
 * A single path object from the GraphHopper Route API response.
 * Only the fields used by the pipeline are typed here.
 * Note: `ascend`/`descend` come from SRTM — they are overridden by
 * the Open-Meteo elevation fetch for higher accuracy.
 */
export interface GraphHopperPath {
  /** Total distance in metres */
  distance: number;
  /** Total duration in milliseconds */
  time: number;
  /** Positive elevation gain in metres (SRTM-derived, overridden later) */
  ascend: number;
  /** Negative elevation loss in metres (SRTM-derived) */
  descend: number;
  /** GeoJSON LineString of the route */
  points: {
    type: "LineString";
    /** Coordinates in [lng, lat] order */
    coordinates: [number, number][];
  };
  /** Always `false` in our requests (we request decoded points) */
  points_encoded: boolean;
}

/**
 * Top-level response from the GraphHopper Route API.
 * `paths` contains results; `message` is set on error.
 */
export interface GraphHopperResponse {
  /** Array of computed paths (usually 1, unless alternatives are requested) */
  paths: GraphHopperPath[];
  /** API metadata including copyright notices */
  info?: { copyrights: string[] };
  /** Error description when the request fails */
  message?: string;
}

// ---- Open-Meteo Elevation API (internal) ----

/**
 * Response from the Open-Meteo Elevation API.
 * `elevation[i]` corresponds to the i-th lat/lng pair in the request.
 */
export interface OpenMeteoElevationResponse {
  /** Elevation in metres ASL, one value per input coordinate */
  elevation: number[];
  /** Echo of the input latitudes (informational) */
  latitude?: number[];
  /** Echo of the input longitudes (informational) */
  longitude?: number[];
}

// ---- Overpass API (internal) ----

/**
 * A single OSM element returned by the Overpass API.
 * Tags are key-value pairs from the OSM data model.
 */
export interface OverpassElement {
  /** OSM element type */
  type: "way" | "node" | "relation";
  /** OSM element numeric ID */
  id: number;
  /** OSM tags — may include `highway`, `surface`, `route`, `natural`, etc. */
  tags?: Record<string, string>;
}

/**
 * Response from the Overpass API interpreter.
 * Used to fetch highway types, surface tags, and natural features
 * within the bounding box of a candidate route.
 */
export interface OverpassResponse {
  elements: OverpassElement[];
}

// ---- Nominatim (internal) ----

/**
 * A single geocoding result from the Nominatim API.
 * Only the fields needed for coordinate extraction are typed.
 */
export interface NominatimResult {
  /** WGS-84 latitude as a string (Nominatim convention) */
  lat: string;
  /** WGS-84 longitude as a string (Nominatim convention) */
  lon: string;
  /** Full human-readable address */
  display_name: string;
}

// ---- Route Generation Engine V2 ----

export interface GraphNode {
  id: string;
  lat: number;
  lng: number;
  edges: string[];
}

export interface EnrichedEdge {
  id: string;
  from: string;
  to: string;
  lengthKm: number;
  highway: string;
  surface?: string;
  osmWayId: number;
  score: number;
}

export interface EnrichedGraph {
  nodes: Map<string, GraphNode>;
  edges: Map<string, EnrichedEdge>;
  center: Coordinate;
  radiusKm: number;
}

export interface SessionWeights {
  surface: number;
  elevation: number;
  nature: number;
  quietness: number;
}

export interface SolverPath {
  nodeIds: string[];
  edgeIds: string[];
  totalScore: number;
  distanceKm: number;
}

export interface SolverOptions {
  beamWidth: number;
  temperature: number;
  maxIterations: number;
  targetDistanceKm: number;
  distanceTolerance: number;
}
