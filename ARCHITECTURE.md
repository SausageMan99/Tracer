# Architecture

Technical deep-dive into TrailForge -- how the system is built, why key decisions were made, and where to look when something goes wrong.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Directory Structure](#directory-structure)
3. [Frontend Architecture](#frontend-architecture)
4. [V2 Engine Pipeline](#v2-engine-pipeline)
5. [Legacy Engine](#legacy-engine)
6. [API Routes](#api-routes)
7. [Session Profiles](#session-profiles)
8. [Scoring Systems](#scoring-systems)
9. [Error Handling](#error-handling)
10. [GPX Export](#gpx-export)
11. [Feedback System](#feedback-system)
12. [Feature Flags & Landing Page](#feature-flags--landing-page)
13. [External APIs](#external-apis)
14. [Performance Considerations](#performance-considerations)

---

## System Overview

TrailForge is a single-page Next.js 15 application (App Router) that generates loop routes for runners and cyclists. The browser displays a full-screen Mapbox GL JS map alongside a sidebar UI. All route computation happens server-side inside Next.js API Routes.

The system uses a **dual engine** strategy: a V2 engine (primary, OSM graph + beam-search) with a legacy engine (fallback, GraphHopper/ORS). There is **no database** -- UI state lives in Zustand, feedback is persisted to localStorage (client) and a JSON file (server).

```
Browser
  +-- Next.js 15 (App Router, SSR disabled for map)
        |-- Sidebar (React, Zustand state)
        |     |-- SessionForm          user inputs (sport, profile, sliders)
        |     |-- RouteResult          post-generation results + candidate selector
        |     |-- ElevationProfile     SVG elevation chart with hover sync
        |     |-- AddressInput         Mapbox Geocoding v5 autocomplete
        |     +-- FeedbackButtons      thumbs up/down rating
        +-- Map (Mapbox GL JS, client-only)
              |-- GeoJSON layers (slope gradient, direction arrows)
              +-- Symbol layers (start/end markers, hover dot)

API Routes (server-side, Node.js)
  |-- POST /api/generate-route    route generation (V2 + legacy fallback)
  |-- POST /api/feedback          feedback persistence
  |-- POST /api/waitlist          email waitlist collection
  +-- GET  /api/flags             feature flag evaluation

External Services
  |-- Mapbox GL JS + Geocoding v5   (map display + address geocoding)
  |-- Overpass OSM                  (OSM graph data for V2, terrain tags for legacy)
  |-- Open-Meteo Elevation          (elevation enrichment)
  |-- GraphHopper                   (running round-trip routing, legacy)
  +-- OpenRouteService              (cycling routing, legacy)
```

### Key Design Decisions

- **V2-first with legacy fallback**: V2 handles loop routes. Legacy handles waypoint/A-to-B routes and serves as fallback when V2 fails.
- **No database**: The app is stateless by design. Route results live in Zustand for the session. Feedback data is stored in localStorage and optionally persisted to `.data/feedbacks.json`.
- **Server-side computation**: All routing, geocoding (for generation), and scoring run inside API Routes. The browser only handles UI, map rendering, and address autocomplete.
- **French UI**: All user-facing error messages and profile labels are in French.

---

## Directory Structure

```
app/
  api/
    generate-route/route.ts     main route generation endpoint
    feedback/route.ts           feedback persistence endpoint
    waitlist/route.ts           waitlist signup endpoint
    flags/route.ts              feature flag endpoint
  layout.tsx                    root layout
  page.tsx                      app page
  globals.css                   global styles (Tailwind + CSS variables)

components/
  app/AppNav.tsx                navigation bar
  map/
    ClientMapWrapper.tsx        dynamic import wrapper (ssr: false)
    MapView.tsx                 Mapbox GL JS map with 5 source/layer pairs
  sidebar/
    SidebarContainer.tsx        sidebar shell (desktop + mobile drawer)
    SessionForm.tsx             sport/profile/distance/elevation form
    RouteResult.tsx             route display, candidate selector, GPX export
    ElevationProfile.tsx        SVG elevation chart with hover sync
    AddressInput.tsx            Mapbox Geocoding v5 autocomplete
    FeedbackButtons.tsx         thumbs up/down feedback
  landing/                      landing page V2 components
  ui/                           shared UI primitives (cursor, buttons, tickers)

lib/
  engine/                       V2 routing engine
    index.ts                    orchestrator (generateRouteV2)
    graph-builder.ts            Overpass query + graph construction + file cache
    edge-scorer.ts              4-dimension edge scoring (surface, elevation, nature, quietness)
    orienteering-solver.ts      beam-search with 5 directional configs
    pathfinder.ts               A* shortest path + ReturnDistanceCache
    route-post-processor.ts     subsampling, elevation, candidate ranking
  route-generator-legacy.ts     legacy engine (GraphHopper + ORS)
  store.ts                      Zustand state management
  types.ts                      all TypeScript interfaces and type aliases
  errors.ts                     RouteGenerationError class
  session-profiles.ts           16 session profiles across 4 sports
  gpx-export.ts                 GPX 1.1 generation and download
  trail-waypoints.ts            waypoint utilities
  services/
    feedback-store.ts           localStorage feedback persistence
    rate-limiter.ts             in-memory rate limiter with auto-eviction
    waitlist.ts                 waitlist service
  utils/
    animations.ts               animation utilities
    format.ts                   number/string formatting
    gsap-setup.ts               GSAP initialization
  feature-flags/
    flags.ts                    feature flag definitions (GrowthBook adapter)
    growthbook-adapter.ts       GrowthBook adapter

middleware.ts                   feature flag routing middleware
```

---

## Frontend Architecture

### State Management -- Zustand (`lib/store.ts`)

All UI state lives in a single flat Zustand store. The store is intentionally denormalized -- no selectors, no slices, no middleware -- because the app is simple enough that a flat structure is easier to reason about.

Key state fields:

| Field | Type | Description |
|-------|------|-------------|
| `status` | `AppStatus` | `idle` / `loading` / `success` / `error` |
| `currentRoute` | `GeneratedRoute \| null` | Full route result from the API |
| `candidateIndex` | `number` | Which candidate variant is displayed |
| `hoveredRouteProgress` | `number \| null` | 0--1 position on route from ElevationProfile hover |
| `scenicMode` | `boolean` | Performance (false) vs Scenic (true) |
| `address` | `string` | Departure address text |
| `selectedProfileId` | `string` | Active session profile ID |
| `targetDistanceKm` | `number` | Target distance slider value |
| `targetElevationM` | `number` | Target elevation slider value |
| `mapCenter` | `Coordinate` | Map camera center (drives Mapbox flyTo) |
| `mapZoom` | `number` | Map zoom level |
| `sidebarOpen` | `boolean` | Mobile drawer open/closed |
| `ignLayerVisible` | `boolean` | IGN France SCAN 25 raster overlay toggle |

All store actions (`setAddress`, `setLoading`, `setSuccess`, etc.) are defined inline in the `create()` call. Components call store methods directly -- there is no action dispatch pattern.

Default state initializes with Paris as the map center (`48.8566, 2.3522`) and the first session profile (running endurance) pre-selected.

### Map Layer Architecture (`components/map/MapView.tsx`)

`MapView.tsx` manages 5 Mapbox GL source/layer pairs:

| Source ID | Layer Type | Purpose |
|-----------|-----------|---------|
| `route-slope` | `line` (gradient) | Colorized slope segments with data-driven color expression |
| `route-arrows` | `symbol` | Direction arrows along the route |
| `route-hover-point` | `circle` | Dot at ElevationProfile hover position |
| `route-start-marker` | `circle` | Green start marker |
| `route-end-marker` | `circle` | Red end marker |

**Route animation**: Uses `requestAnimationFrame` with an ease-out cubic curve over 1400ms. The GeoJSON line is progressively trimmed from 0% to 100% using `turf.lineSliceAlong`, so the route appears to draw itself on the map. Animation is cancelled immediately on component unmount.

**Slope coloring**: A Mapbox data-driven style expression interpolates colors based on a `slope` property on each line segment, ranging from green (downhill, -8%) through grey (flat) to red (steep uphill, 14%).

### SSR Strategy (`components/map/ClientMapWrapper.tsx`)

Mapbox GL JS calls `window`, `document`, and WebGL APIs on import. The solution is a dynamic import with SSR disabled:

```typescript
const MapView = dynamic(() => import("./MapView"), { ssr: false });
```

The map hydrates client-side only. The sidebar renders server-side normally. No flash of unstyled content occurs because the sidebar does not depend on the map being ready.

### Sidebar (`components/sidebar/`)

`SidebarContainer.tsx` mounts both `SessionForm` and `RouteResult` simultaneously in the DOM. Visibility is toggled with CSS. This avoids remounting expensive components and preserves form scroll position when the user clicks "Modifier" to return.

On mobile, the sidebar renders as a slide-over drawer controlled by the `sidebarOpen` store field. A floating action button ("Configurer") opens the drawer. The drawer auto-closes after route generation.

### AddressInput (`components/sidebar/AddressInput.tsx`)

Backed by **Mapbox Geocoding v5 API** (not Nominatim). Features:
- 380ms debounce before sending geocoding requests
- Up to 5 suggestions displayed in an ARIA-compliant listbox dropdown
- Keyboard navigation (ArrowUp/Down, Enter, Escape)
- Two visual variants: dark (sidebar) and light (compact)
- Spinning indicator during geocoding request

---

## V2 Engine Pipeline (`lib/engine/`)

The V2 engine is the primary route generation system for loop routes. It builds a local OSM graph around the start point, scores edges by terrain quality, runs a beam-search solver to find high-quality loops, then post-processes candidates for ranking and display.

The orchestrator is `lib/engine/index.ts` (`generateRouteV2()`):

```
1. Resolve profile (PROFILES_BY_ID lookup)
2. Geocode start address (Mapbox Geocoding v5, server-side)
3. Build local OSM graph (graph-builder.ts)
4. Find closest graph node to start coordinate
5. Derive session weights + score all edges (edge-scorer.ts)
6. Run beam-search solver (orienteering-solver.ts)
7. Post-process into ranked RouteCandidate[] (route-post-processor.ts)
8. Impossible D+ detection (reject if best.ascendM < 30% of target)
```

### Step 1 -- Graph Building (`graph-builder.ts`)

Queries the Overpass API for all highway ways within a radius of the start point. The radius is `max(2, min(25, targetDistanceKm * 0.4))` km.

**Highway filter**: secondary, tertiary, unclassified, residential, service, track, path, cycleway, bridleway, footway, pedestrian, living_street.

**Scenic way detection**: Also queries `natural` (water, wood, forest, grassland, heath), `landuse` (forest, wood), and `leisure` (nature_reserve) tags. Ways matching these tags are tracked in a `scenicWayIds` set for nature scoring.

**Graph model** (`EnrichedGraph`):
- `nodes`: Map of `GraphNode` (id, lat, lng, edge list)
- `edges`: Map of `EnrichedEdge` (id, from, to, lengthKm, highway, surface, lit, access, osmWayId, score)
- Bidirectional: each OSM way segment produces two directed edges (forward + reverse)

**File-based cache** (`.cache/graphs/`):
- Cache key: `{lat.toFixed(3)}_{lng.toFixed(3)}_{radiusKm.toFixed(1)}.json`
- TTL: 7 days
- Serializes Maps as arrays of entries for JSON persistence
- Non-critical: cache write failures are silently ignored

**Overpass resilience**: Retries once on HTTP 429/503 or timeout (30s AbortSignal), with a 2-second delay between attempts. Throws `RouteGenerationError("NO_ROAD_NETWORK", { subCode: "OVERPASS_TIMEOUT" })` on exhausted retries.

### Step 2 -- Edge Scoring (`edge-scorer.ts`)

Scores every edge in the graph along 4 dimensions, each normalized to [0, 1]:

**`deriveWeights(profile, scenicMode)`** computes a `SessionWeights` vector with 4 components (surface, elevation, nature, quietness). Base weights vary by sport, then adjusted by session type, then modified by scenic mode, then normalized to sum = 1.

| Dimension | Scoring Function | Logic |
|-----------|-----------------|-------|
| **Surface** | `scoreSurface(surface, sport)` | MTB prefers unpaved (1.0) over paved (0.3); road/running prefers paved (1.0) over unpaved (0.3); gravel likes both |
| **Quietness** | `scoreQuietness(highway) * 0.7 + scoreSafety(lit, access) * 0.3` | Trail highways = 1.0, quiet residential = 0.8, busy roads = 0.1; safety blended in via lit/access tags |
| **Nature** | `scoreNature(osmWayId, scenicWayIds)` | 1.0 if the way's OSM ID is in the scenic set, 0.3 otherwise |
| **Elevation** | Gradient-based | Flat-preferring sessions penalize steep grades; climb-preferring sessions reward 3--8% gradients; endurance sessions peak at 3--5% |

**Elevation lookup**: Fetches elevations for all graph nodes from Open-Meteo in one batch call. Falls back to 0 for all nodes if the API fails.

**Private/restricted edges**: Edges with `access=private` or `access=no` are scored at 0 (effectively excluded from routing).

Final edge score = weighted sum: `surface * w.surface + elevation * w.elevation + nature * w.nature + quietness * w.quietness`

### Step 3 -- Beam-Search Solver (`orienteering-solver.ts`)

Runs 5 solver configurations in parallel (synchronous `map`, not async), each seeded with a different initial bearing for route diversity:

| Config | Beam Width | Temperature | Seed Bearing | Expansion K |
|--------|-----------|------------|--------------|-------------|
| 1 | 60 | 0.20 | 0 deg | 3 |
| 2 | 40 | 0.30 | 72 deg | 3 |
| 3 | 80 | 0.15 | 144 deg | 3 |
| 4 | 50 | 0.25 | 216 deg | 3 |
| 5 | 70 | 0.20 | 288 deg | 3 |

**Key parameters**:
- `MAX_ITERATIONS = 2000` (iteration cap per config)
- `DISTANCE_TOLERANCE = 0.15` (15% over/under target distance accepted)
- `CLOSE_ENOUGH_KM = 0.2` (natural loop closure threshold)
- `MAX_EDGE_REVISITS = 1` (dead-end escape allows 1 revisit)
- `REVISIT_PENALTY = 0.15` (score multiplier for revisited edges)
- `ROAD_DISTANCE_FACTOR = 1.4` (straight-line to road-distance conversion)

**Multi-child expansion**: Each beam state expands to K child edges per iteration. K=3 for the first 60% of distance progress, K=2 after (reduces branching late in the route).

**Edge selection**: Softmax sampling over adjusted edge scores. Temperature controls randomness (lower = more greedy, higher = more exploratory).

**Anti-backtracking**:
1. Hard-reject: immediate U-turns (edge.to === state.lastFrom) score 0.01
2. Smooth penalty: cosine-based penalty comparing incoming and candidate bearings. 0 deg from reverse (U-turn) = 0.0, 90 deg = 0.5, 180 deg (straight ahead) = 1.0

**Distance budget guard**: After computing edge distance, estimates road-distance return to start. If remaining budget cannot accommodate the return, the edge is rejected (score 0.01). After 50% progress, uses A* cached distances instead of straight-line estimates.

**Directional seeding**: In the first 15% of progress, edges aligned with the seed bearing get a cosine bias boost. This creates 5 spatially diverse route exploration directions.

**Outward/return bias**: Before 50% progress, edges moving away from start get a +0.15 score bonus. After 50%, a closing factor biases toward edges that reduce distance to start.

**Elevation-aware selection**: After 60% progress, if cumulative ascent is under budget, uphill edges get a 1.3x boost; if over budget by >20%, uphill edges get a 0.5x penalty.

**Loop closure**:
- At 65%+ progress: A* return path computation begins. If the combined distance (current + A* return) fits within [minDist, maxDist], the loop is closed via the cached A* path.
- At 85%+ progress: forced closure for all reachable states (allows up to 10% distance overshoot).
- Natural closure: if the route naturally returns within 0.2 km of start and distance >= minDist, the path is accepted.

**Diverse beam selection**: Uses farthest-point sampling after sorting by score-per-km (with optional elevation budget factor). This ensures the beam contains spatially diverse states rather than clustered paths.

**Geometric deduplication**: After collecting all valid paths from all 5 configs, paths are sorted by score descending, then deduplicated using Jaccard similarity on edge sets (threshold > 0.6 = duplicate).

### Step 4 -- A* Pathfinder (`pathfinder.ts`)

Implements A* shortest-path search on the `EnrichedGraph` using haversine distance as the admissible heuristic. Uses a custom binary min-heap for the priority queue.

**`ReturnDistanceCache`**: Many beam states share the same current node. The cache stores both the distance and the full path result, keyed by node ID, to avoid redundant A* computations. This is critical for performance during the loop-closure phase (65%+).

### Step 5 -- Post-Processing (`route-post-processor.ts`)

Takes the top 6 solver paths and converts them to `RouteCandidate` objects:

1. **Coordinate reconstruction**: Maps node IDs back to lat/lng coordinates from the graph
2. **Subsampling**: Reduces to max 200 points (constant step interpolation)
3. **Elevation**: Uses pre-fetched `nodeElevation` map (from edge-scorer), falls back to Open-Meteo API
4. **Metrics**: Computes D+/D- via `computeAscent()`, duration via sport-specific pace estimates
5. **Duration estimation**: Running = 5.5 min/km + 10 min/100m D+; Road cycling = 2.0 min/km + 6 min/100m D+; Gravel = 2.5 min/km; MTB = 3.5 min/km
6. **Scoring**: Computes `totalScore` via legacy `scoreRoute()` (weighted sum of elevationMatch, distanceMatch, surfaceQuality, loopQuality)
7. **Ranking**: Sorts candidates by `totalScore` descending

---

## Legacy Engine (`lib/route-generator-legacy.ts`)

The legacy engine handles two scenarios:
1. **Fallback** when V2 fails for loop routes
2. **Primary** for waypoint/A-to-B routes (V2 is loops-only)

### Running (GraphHopper)

`fetchCandidateRoutes()` requests 6 round-trip routes in parallel from GraphHopper, using seed values 0--5. Seeds rotate the heading of the initial segment.

Parameters:
- `algorithm: "round_trip"`
- `round_trip.distance`: target distance in metres
- `round_trip.seed`: 0--5
- Profile: `foot` or `hike` depending on the session profile

GraphHopper's free tier does not include elevation in round-trip responses. `fetchElevations()` calls the Open-Meteo Elevation API in batches of 100 points to enrich the route.

### Cycling (OpenRouteService)

`fetchCandidateRoutesORS()` sends 3 parallel requests with slightly varied distance targets to produce diverse candidates.

| Sport | ORS Profile |
|-------|-------------|
| `cycling_road` | `cycling-road` |
| `cycling_gravel` | `cycling-regular` |
| `cycling_mtb` | `cycling-mountain` |

ORS returns elevation data natively in the response, so Open-Meteo enrichment is skipped for cycling routes.

### Shared Utilities

The legacy module exports several utilities used by both engines:

- `haversineKm()` -- great-circle distance between two coordinates
- `fetchElevations()` -- Open-Meteo Elevation API (batched, 100 per request)
- `computeAscent()` -- D+/D- from elevation array (ignores noise < 0.5m)
- `scoreRoute()` -- weighted multi-criteria candidate scoring
- `computeLoopScore()` -- loop closure quality (1.0 at < 0.3km gap, linear decay to 0 at 5km)
- `PAVED_SURFACES`, `UNPAVED_SURFACES`, `QUIET_HIGHWAY_TYPES`, `BUSY_HIGHWAY_TYPES`, `TRAIL_HIGHWAY_TYPES` -- OSM tag classification sets

---

## API Routes

### POST /api/generate-route (`app/api/generate-route/route.ts`)

Main entry point for route generation.

**Rate limiting**: 20 requests/minute/IP via `createRateLimiter`.

**Request validation**:
1. Parse JSON body
2. Validate required fields: `address` (non-empty string), `profileId`, `targetDistanceKm` (number), `targetElevationM` (number)
3. Validate `profileId` exists in `PROFILES_BY_ID`
4. Validate distance and elevation are within the profile's allowed ranges

**Routing strategy**:
- If waypoints or endAddress are present: legacy engine directly
- Otherwise: V2 first, falls back to legacy on any error (with `console.warn` log)

**Response format**:
- Success (200): `{ success: true, route: GeneratedRoute }`
- Validation error (400): `{ success: false, error: "...", errorCode: "UNKNOWN" }`
- Generation failure (422): `{ success: false, error: "...", errorCode: "NO_ROAD_NETWORK" | "IMPOSSIBLE_ELEVATION" | "GEOCODING_FAILED" }`
- Rate limited (429): `{ success: false, error: "...", errorCode: "UNKNOWN" }`
- Server error (500): `{ success: false, error: "...", errorCode: "UNKNOWN" }`

French error messages are mapped from sub-codes:
- `OVERPASS_TIMEOUT` -> "Serveur cartographique indisponible. Reessayez dans 30s."
- `EMPTY_GRAPH` -> "Aucune route trouvee. Essayez un point de depart plus urbain ou une distance plus courte."
- `SOLVER_EMPTY` -> "Impossible de construire un parcours en boucle. Essayez une distance differente."

### POST /api/feedback (`app/api/feedback/route.ts`)

Persists user feedback to `.data/feedbacks.json`.

**Rate limiting**: 10 requests/hour/IP.

**Validation**: Checks required fields (id, rating, sessionType, sport, requestedDistanceKm, actualDistanceKm, actualElevationM, algorithmicScore).

**Storage**: Async file I/O -- reads existing feedbacks, appends new entry (with server timestamp and IP), writes back.

**Admin export**: GET with `Authorization: Bearer <ADMIN_SECRET>` returns all feedbacks as JSON. Secret validated against `process.env.ADMIN_SECRET`.

### POST /api/waitlist (`app/api/waitlist/route.ts`)

Collects email addresses for the waitlist.

**Rate limiting**: 5 requests/hour/IP.

**Validation**: Email format, sport (running/cycling/both/undefined), source (landing/post-generation).

---

## Session Profiles (`lib/session-profiles.ts`)

16 profiles across 4 sports, each encoding the physiological constraints of a training session:

| Sport | Profiles |
|-------|----------|
| **Running** (5) | Endurance, Seuil Lactique, Intervals 30/30, Sortie Longue, Recuperation |
| **Road Cycling** (5) | Endurance, Seuil, Intervals, Gran Fondo, Recuperation |
| **Gravel** (2) | Endurance Gravel, Gran Fondo Gravel |
| **MTB** (2) | Endurance VTT, Intervals VTT |

Each profile specifies:

| Field | Description |
|-------|-------------|
| `id` | Unique identifier (e.g. `"running_endurance"`) |
| `name` | French display name |
| `sport` | `running` / `cycling_road` / `cycling_gravel` / `cycling_mtb` |
| `sessionType` | `endurance` / `seuil_lactique` / `intervals_30_30` / `sortie_longue` / `recuperation` / `seuil` / `intervals` / `gran_fondo` |
| `distanceRange` | `{ min, default, max }` in km -- bounds the UI slider |
| `elevationRange` | `{ min, default, max }` in metres -- bounds the UI slider |
| `distancePresets` | Curated chip values below the distance slider |
| `elevationPresets` | Curated chip values below the elevation slider |
| `description` | French description shown below the session chip |
| `weights` | `ScoringWeights` for legacy candidate ranking |
| `graphhopperProfile` | `"foot"` (running) or `"bike"` (cycling) |
| `orsProfile` | ORS profile slug (cycling only): `"cycling-road"` / `"cycling-regular"` / `"cycling-mountain"` |

Derived lookups are computed automatically:
- `PROFILES_BY_ID`: `Map<string, SessionProfile>` for O(1) lookup
- `PROFILES_BY_SPORT`: `Record<Sport, SessionProfile[]>` for UI grouping
- `SPORT_LABELS`: French display labels per sport

Adding a new profile requires only adding an entry to the `SESSION_PROFILES` array -- no other file needs to change.

---

## Scoring Systems

TrailForge uses **two separate scoring systems** for different stages of the pipeline.

### V2 Edge Scoring (per-edge, during beam search)

4 normalized dimensions, combined via `SessionWeights`:

```
edgeScore = w.surface * surfaceScore
          + w.elevation * elevationScore
          + w.nature * natureScore
          + w.quietness * quietnessScore
```

Weights are derived dynamically via `deriveWeights(profile, scenicMode)`. Base weights vary by sport, then adjusted by session type intensity, then modified by scenic mode (boosts nature +0.15 and quietness +0.05, reduces surface and elevation by 0.10 each), then normalized to sum = 1.

This scoring drives path selection during the beam search. Higher-scoring edges are more likely to be chosen via softmax sampling.

### Legacy Candidate Ranking (per-candidate, post-generation)

4 weighted components from `ScoringWeights`, used to rank completed route candidates:

```
totalScore = w.elevationMatch * elevMatch
           + w.distanceMatch * distMatch
           + w.surfaceQuality * surfScore
           + w.loopQuality * loopScore
```

**elevationMatch** and **distanceMatch** use a Gaussian decay:
```
match = exp(-0.5 * ((actual - target) / (0.2 * target))^2)
```
A 20% deviation scores ~0.6; a 40% deviation scores ~0.1.

**surfaceScore**: For V2, this is the average edge score across the path. For legacy, it comes from Overpass terrain analysis.

**loopScore**: `max(0, 1 - endToStartKm / 5.0)`. Perfect loop (< 0.3km gap) = 1.0, linear decay to 0 at 5km.

Both V2 and legacy candidates are ranked using the legacy scoring system for final candidate ordering.

---

## Error Handling (`lib/errors.ts`)

The `RouteGenerationError` class provides structured, type-safe errors:

```typescript
class RouteGenerationError extends Error {
  readonly code: RouteErrorCode;       // NO_ROAD_NETWORK | IMPOSSIBLE_ELEVATION | GEOCODING_FAILED | UNKNOWN
  readonly subCode?: RouteErrorSubCode; // OVERPASS_TIMEOUT | EMPTY_GRAPH | SOLVER_EMPTY
  readonly maxElevationEstimate?: number; // only for IMPOSSIBLE_ELEVATION
}
```

The V2 engine throws `RouteGenerationError` instances directly. The legacy engine throws string-encoded errors (e.g. `"NO_ROAD_NETWORK:EMPTY_GRAPH"`). The API route handler maps both to consistent HTTP responses via `mapRouteError()` and `mapLegacyError()`.

Error flow:
1. V2 engine throws `RouteGenerationError` with code + subCode
2. If V2 fails, legacy engine runs and may throw string errors
3. API route catches both, maps to HTTP status + French error message
4. Client displays the `error` field in the UI

---

## GPX Export (`lib/gpx-export.ts`)

Generates a GPX 1.1 XML file from the current route's best candidate.

### Compatibility

| Requirement | Rationale |
|-------------|-----------|
| `<time>` on every `<trkpt>` | Garmin and Wahoo require timestamps |
| Valid `xsi:schemaLocation` | Suunto validates against the official GPX 1.1 XSD |
| XML entity escaping in route name | Address strings may contain `<`, `>`, `&`, `'`, `"` |
| `<type>` tag on `<trk>` | Sport categorization for device import |

### Synthetic Timestamps

The route has no real timestamps (it is a generated future route). Synthetic timestamps are generated starting from the export moment, spaced uniformly based on `durationSeconds`:

```
msPerPoint = durationSeconds * 1000 / (coordinates.length - 1)
time[i] = exportMoment + i * msPerPoint
```

### Download

`downloadGPX()` creates a temporary `<a>` element with an object URL, programmatically clicks it, then revokes the URL. Filename format: `tracer-{profileId}-{timestamp}.gpx`.

---

## Feedback System

### Client-Side (`lib/services/feedback-store.ts`)

Stores user thumbs-up/thumbs-down ratings in `localStorage` under the key `"trailforge-feedbacks"`.

Each `RouteFeedback` entry captures:
- Rating (`"positive"` / `"negative"`)
- Session context (sport, sessionType, mode)
- Request parameters (requestedDistanceKm, requestedElevationM)
- Actual metrics (actualDistanceKm, actualElevationM, algorithmicScore)
- Error metrics (distanceErrorPct, elevationErrorPct)

On save, the entry is also sent to `POST /api/feedback` (fire-and-forget -- errors are silently ignored).

The `exportFeedbacksAsJSON()` function downloads the full local dataset as a JSON file for offline ML training.

### Server-Side (`app/api/feedback/route.ts`)

Appends each feedback entry to `.data/feedbacks.json` with server timestamp and IP. Rate limited at 10 requests/hour/IP.

Admin export via GET requires `ADMIN_SECRET` authentication.

### Intended ML Use

The feature vector is designed for a future XGBoost or LightGBM pairwise ranking model. The model would predict which route variant a user prefers, replacing or supplementing the hand-crafted scoring weights.

---

## Feature Flags & Landing Page

### Feature Flags (`lib/feature-flags/`)

Feature flags are powered by a GrowthBook adapter integrated with the `flags` package for Next.js.

Currently defined flag:
- `new-landing-hero` (boolean): A/B test for the landing page hero section

### Middleware (`middleware.ts`)

The root middleware precomputes feature flags and rewrites the `/` path to include the flag code, enabling server-side flag evaluation for the landing page.

### Landing Page (`components/landing/`)

A comprehensive landing page (V2) with multiple sections:
- `HeroSection` -- main hero with A/B test variant
- `HowItWorksSection` -- step-by-step explanation
- `FeatureShowcase` -- feature highlight cards
- `MetricsSection` -- animated number tickers
- `ManifestoSection` -- brand manifesto
- `WaitlistSection` -- email signup form
- `FinalCTASection` -- closing call to action
- `FooterSection` -- footer
- `TerrainCanvas` -- WebGL terrain visualization
- `LoadingSequence` -- animated loading transition

---

## External APIs

| Service | Auth | Used For | Called From |
|---------|------|----------|------------|
| **Mapbox GL JS** | Public token (`NEXT_PUBLIC_MAPBOX_TOKEN`) | Map display | Browser (MapView.tsx) |
| **Mapbox Geocoding v5** | Public token | Address autocomplete (AddressInput) | Browser |
| **Mapbox Geocoding v5** | Public token | Start point geocoding for route generation | Server (route-generator-legacy.ts) |
| **Overpass OSM** | None | OSM graph data (V2 engine), terrain tags (legacy) | Server |
| **Open-Meteo Elevation** | None | Elevation enrichment (batches of 100) | Server |
| **GraphHopper Directions** | API key (`GRAPHHOPPER_API_KEY`) | Running round-trip routing (legacy) | Server |
| **OpenRouteService** | API key (`ORS_API_KEY`) | Cycling routing + elevation (legacy) | Server |

All external API calls are server-side except Mapbox GL JS (map rendering) and Mapbox Geocoding (address autocomplete in AddressInput).

---

## Performance Considerations

### V2 Graph Cache

The Overpass-derived graph is cached to disk in `.cache/graphs/` with a 7-day TTL. The cache key rounds coordinates to 3 decimal places (~111m precision), which means nearby start points reuse the same cached graph. This eliminates the Overpass query for repeat routes in the same area.

### Parallel Candidate Generation

- **V2**: 5 beam-search configurations run synchronously but produce candidates in parallel (same event loop tick)
- **Legacy**: GraphHopper seeds (6) and ORS variants (3) are fetched via `Promise.all`

### A* Return Distance Cache

The `ReturnDistanceCache` in the solver avoids redundant A* computations. Since many beam states reach the same graph node, the cache stores distance + full path per node ID. This is critical during the loop-closure phase (65%+ progress) where every beam state triggers an A* lookup.

### Route Subsampling

Routes are subsampled before inclusion in the API response:
- V2 post-processor: max 200 points per candidate
- Full geometry coordinates are still included in `geometry.coordinates` for map display
- This keeps the JSON payload manageable without visual degradation at typical zoom levels

### Rate Limiting

In-memory rate limiter with automatic cache eviction (`lib/services/rate-limiter.ts`):
- Route generation: 20 req/min/IP
- Feedback: 10 req/hour/IP
- Waitlist: 5 req/hour/IP

The limiter uses an immutable entry pattern (`RateLimitEntry` with `readonly` fields) and periodic eviction of expired entries via `setInterval` with `.unref()` to avoid blocking process exit.

### Map Animation

The route draw animation uses a single `requestAnimationFrame` loop with `turf.lineSliceAlong`. No `setTimeout` fallback is needed. Animation is cancelled immediately on unmount to prevent memory leaks.
