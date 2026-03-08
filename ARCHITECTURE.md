# Architecture

Technical deep-dive into TrailForge — how the system is built, why key decisions were made, and where to look when something goes wrong.

---

## Table of Contents

1. [System Overview](#system-overview)
2. [Frontend Architecture](#frontend-architecture)
3. [Backend Architecture](#backend-architecture)
4. [Route Generation Pipeline](#route-generation-pipeline)
5. [Session Profiles](#session-profiles)
6. [Scoring Algorithm](#scoring-algorithm)
7. [GPX Export](#gpx-export)
8. [Feedback ML System](#feedback-ml-system)
9. [External APIs](#external-apis)
10. [Performance Considerations](#performance-considerations)

---

## System Overview

TrailForge is a single-page Next.js application. The browser displays a full-screen Mapbox GL JS map alongside a sidebar UI. All routing computation happens server-side inside Next.js API Routes, which in turn call external geocoding, routing, and elevation services.

```
Browser
  └── Next.js (App Router, SSR disabled for map)
        ├── Sidebar (React, Zustand state)
        │     ├── SessionForm       — user inputs
        │     ├── RouteResult       — post-generation results
        │     ├── ElevationProfile  — SVG chart
        │     └── AddressInput      — Nominatim autocomplete
        └── Map (Mapbox GL JS, client-only)
              ├── GeoJSON layers (slope gradient, arrows)
              └── Symbol layers (start/end markers, hover dot)

API Routes (server-side, Node.js)
  └── POST /api/generate-route  → lib/route-generator.ts

External Services
  ├── GraphHopper API    (running round-trip routing)
  ├── OpenRouteService   (cycling routing with built-in elevation)
  ├── Open-Meteo         (elevation enrichment for GraphHopper results)
  ├── Overpass OSM       (terrain/surface tag queries)
  └── Nominatim OSM      (address geocoding, called from the browser)
```

The system has **no database**. Route results live in React/Zustand state for the duration of the session. Feedback data is persisted in browser `localStorage`.

---

## Frontend Architecture

### State Management — Zustand

All UI state lives in a single flat Zustand store (`lib/store.ts`). The store is intentionally denormalised — no selectors, no slices, no middleware — because the app is simple enough that a flat structure is easier to reason about than a Redux-style hierarchy.

Key state fields:

| Field | Type | Description |
|-------|------|-------------|
| `status` | `AppStatus` | `idle` → `loading` → `success` / `error` |
| `currentRoute` | `GeneratedRoute \| null` | Full route result from the API |
| `candidateIndex` | `number` | Which variant is currently displayed |
| `hoveredRouteProgress` | `number \| null` | 0–1 position on route from ElevationProfile hover |
| `scenicMode` | `boolean` | Performance (false) vs Scenic (true) |
| `address`, `endAddress`, `waypoints` | strings / arrays | Form field values |

All store actions (`setStatus`, `setCurrentRoute`, `clearRoute`, etc.) are defined inline in the `create()` call. There is no action dispatch — components call store methods directly.

### Map Layer Architecture

`MapView.tsx` manages 5 Mapbox GL source/layer pairs:

| Source ID | Layer type | Purpose |
|-----------|-----------|---------|
| `route-slope` | `line` (gradient) | Colourised slope segments |
| `route-arrows` | `symbol` | Direction arrows every 200 m |
| `route-hover-point` | `circle` | Dot at ElevationProfile hover position |
| `route-start-marker` | `circle` | Green start marker |
| `route-end-marker` | `circle` | Red end marker |

Route animation uses `requestAnimationFrame` with an ease-out cubic curve over 1400 ms. The GeoJSON line is progressively trimmed from 0 % to 100 % of its total length using `turf.lineSliceAlong` so the route appears to draw itself on the map.

### Server-Side Rendering Strategy

Mapbox GL JS calls `window`, `document`, and WebGL APIs on import — it crashes in Node. The solution is a dynamic import in `ClientMapWrapper.tsx`:

```typescript
const MapView = dynamic(() => import("./MapView"), { ssr: false });
```

This means the map is hydrated client-side only. The sidebar renders server-side normally. There is no flash of unstyled content because the sidebar does not depend on the map being ready.

### Sidebar Transition

`SidebarContainer.tsx` mounts both `SessionForm` and `RouteResult` in the DOM simultaneously. Visibility is toggled with CSS (`display: none` / `display: block`). This avoids remounting expensive components and preserves form scroll position when the user clicks "Modifier" to go back.

---

## Backend Architecture

### API Route: POST /api/generate-route

```
Request → validate body fields
       → validate profileId against PROFILES_BY_ID
       → call generateRoute()
            → geocodeAddress()
            → fetchCandidateRoutes() / fetchCandidateRoutesORS()
            → fetchElevations() (running only)
            → fetchSurfaceData() (Overpass, 1 h cache)
            → scoreRoute() × N candidates
            → sort by totalScore, return best + all candidates
       → serialize and return GeneratedRoute
```

The handler (`app/api/generate-route/route.ts`) is thin — it validates the request, delegates to `generateRoute()`, and maps thrown errors to HTTP status codes:

| Thrown message | HTTP status | errorCode |
|----------------|-------------|-----------|
| `"NO_ROAD_NETWORK"` | 422 | `NO_ROAD_NETWORK` |
| `"IMPOSSIBLE_ELEVATION:<n>"` | 422 | `IMPOSSIBLE_ELEVATION` |
| `"GEOCODING_FAILED"` | 422 | `GEOCODING_FAILED` |
| anything else | 500 | `UNKNOWN` |

---

## Route Generation Pipeline

The full pipeline is implemented in `lib/route-generator.ts`. It runs server-side for every `POST /api/generate-route` request.

### Step 1 — Geocoding

`geocodeAddress(address)` calls the Nominatim OpenStreetMap API and returns the first result's `[lon, lat]`. Returns `null` on HTTP error or empty result list, which causes the caller to throw `"GEOCODING_FAILED"`.

### Step 2 — Candidate Fetch

**Running (`GraphHopper`):**

`fetchCandidateRoutes()` requests 6 round-trip routes in parallel from GraphHopper, using different `seed` values (0–5). Seeds rotate the heading of the initial segment. The `point_hint` parameter is omitted to maximise GraphHopper's freedom in matching the start coordinate to a road network node.

Each request includes:
- `algorithm: "round_trip"`
- `round_trip.distance`: target distance in metres
- `round_trip.seed`: 0–5
- Profile: `foot` or `hike` depending on the session profile

If all 6 requests fail or return empty paths, `"NO_ROAD_NETWORK"` is thrown.

**Cycling (`OpenRouteService`):**

`fetchCandidateRoutesORS()` sends 3 parallel requests with slightly varied distance targets (±3 %) to produce diverse candidates. ORS profiles map to:

| Sport | ORS profile |
|-------|-------------|
| `cycling_road` | `cycling-road` |
| `cycling_gravel` | `cycling-regular` |
| `cycling_mtb` | `cycling-mountain` |

ORS returns elevation data natively inside the GeoJSON response (`way_points` z-coordinate), so Open-Meteo enrichment is skipped for cycling routes.

### Step 3 — Elevation Enrichment (running only)

GraphHopper's round-trip algorithm does not return elevation data in its free tier response. `fetchElevations()` calls the Open-Meteo Elevation API in batches of 100 points (API limit) and merges the results back onto each `RoutePoint`.

```typescript
// Batched fetch — 100 coords per request
for (let i = 0; i < coords.length; i += ELEVATION_BATCH_SIZE) {
  const batch = coords.slice(i, i + ELEVATION_BATCH_SIZE);
  // POST https://api.open-meteo.com/v1/elevation
}
```

After elevation data is available, `computeAscent()` calculates D+ (positive elevation gain) and D− (descent) by summing only positive/negative consecutive differences, ignoring noise below 0.5 m.

### Step 4 — Elevation Feasibility Check

Before scoring, the generator checks whether the terrain around the start point can provide the requested elevation gain. It estimates the maximum achievable D+ as `maxElev - minElev` across all candidates. If the requested `targetElevationM` exceeds this estimate by more than 20 %, it throws `"IMPOSSIBLE_ELEVATION:<estimate>"`.

### Step 5 — Terrain Scoring (Overpass)

`fetchSurfaceData()` queries the Overpass OSM API for all ways within the route bounding box, expanding by 15 % on each side. Results are cached in-process for 1 hour per bounding box (rounded to 3 decimal places to improve cache hit rates).

The query fetches:
- `highway=*` tags (road type quality: path, footway, track, residential, primary, etc.)
- `surface=*` tags (asphalt, gravel, dirt, etc.)
- `route=running` and `route=bicycle` relations (official mapped routes)
- `natural=wood`, `natural=scrub` (green area proximity)
- `leisure=park` (park proximity)

`computeTerrainScore()` then walks each route segment and looks up whether its midpoint falls within a high-quality OSM element, producing a normalised score in [0, 1].

### Step 6 — Loop Scoring

`computeLoopScore()` measures how close the route end is to its start (in km). A perfect loop (< 0.3 km gap) scores 1.0. Linearly decays to 0 at a 5 km gap. This rewards routes that feel like coherent loops rather than out-and-back segments.

```
loopScore = max(0, 1 - (endToStartKm / 5.0))
```

### Step 7 — Route Scoring

`scoreRoute()` computes a weighted sum over four components:

| Component | Weight source | Description |
|-----------|--------------|-------------|
| `elevationMatch` | `profile.weights.elevation` | How close D+ is to the target |
| `distanceMatch` | `profile.weights.distance` | How close distance is to the target |
| `surfaceQuality` | `profile.weights.surface` | Terrain score from Overpass |
| `loopQuality` | `profile.weights.loop` | Loop closure quality |

The elevation and distance match components use a Gaussian-like decay:

```
elevationMatch = exp(-0.5 × ((actual - target) / sigma)²)
```

Where sigma is 20 % of the target value, so a 20 % deviation gives ~0.6, a 40 % deviation gives ~0.1.

### Step 8 — Ranking and Subsampling

Candidates are sorted by `totalScore` descending. The best candidate is returned as `best`; all candidates (up to 6) are returned in `candidates`. Each candidate is subsampled to at most 500 points for the GeoJSON payload to keep transfer size under ~50 KB.

---

## Session Profiles

Session profiles are defined in `lib/session-profiles.ts` as a plain array of `SessionProfile` objects. Adding a new profile requires only adding an entry to that array — no other file needs to change.

Each profile specifies:

| Field | Description |
|-------|-------------|
| `id` | Unique string identifier, used in API requests |
| `name` | French display name shown in the sidebar |
| `sport` | One of `running`, `cycling_road`, `cycling_gravel`, `cycling_mtb` |
| `sessionType` | One of `endurance`, `speed`, `hills`, `trail`, `exploration`, `descent` |
| `targetDistanceKm` | Suggested default distance |
| `targetElevationM` | Suggested default elevation |
| `weights` | `ScoringWeights` object (must sum to ≈ 1.0) |
| `graphhopperProfile` | `"foot"` or `"hike"` (running only) |
| `orsPreferences` | ORS-specific options (cycling only) |

The `PROFILES_BY_ID` Map and `PROFILES_BY_SPORT` Record are derived automatically from the array using `reduce()`.

---

## Scoring Algorithm

Full mathematical documentation is in [docs/algorithms/route-scoring.md](docs/algorithms/route-scoring.md).

### Summary

```
totalScore = w_elev × elevMatch + w_dist × distMatch + w_surf × surfaceScore + w_loop × loopScore

elevMatch  = exp(-0.5 × ((D+ - targetD+) / (0.2 × targetD+))²)
distMatch  = exp(-0.5 × ((dist - targetDist) / (0.2 × targetDist))²)
```

### Weights by profile type

| Session type | w_elev | w_dist | w_surf | w_loop |
|-------------|--------|--------|--------|--------|
| Endurance | 0.20 | 0.35 | 0.25 | 0.20 |
| Speed/Intervals | 0.15 | 0.40 | 0.25 | 0.20 |
| Hills | 0.40 | 0.25 | 0.15 | 0.20 |
| Trail | 0.25 | 0.25 | 0.30 | 0.20 |
| Exploration | 0.20 | 0.20 | 0.40 | 0.20 |
| Descent (MTB DH) | 0.35 | 0.20 | 0.25 | 0.20 |

---

## GPX Export

`lib/gpx-export.ts` generates a GPX 1.1 file from the current route's best candidate.

### Compatibility requirements

GPS devices have strict requirements that many GPX libraries miss:

| Requirement | Rationale |
|-------------|-----------|
| `<ele>` on every `<trkpt>` | Garmin Edge ignores tracks without elevation |
| `<time>` on every `<trkpt>` | Wahoo ELEMNT requires timestamps for power analysis import |
| `xsi:schemaLocation` | Suunto validates against the official GPX 1.1 schema |
| XML entity escaping in route name | Address strings may contain `<`, `>`, `&`, `'`, `"` |

### Synthetic timestamps

The route has no real timestamps (it is a generated future route). TrailForge generates synthetic timestamps starting from the export moment, spacing them evenly based on the estimated duration:

```typescript
const secondsPerPoint = best.durationSeconds / (points.length - 1);
const t = new Date(startTime + i * secondsPerPoint * 1000).toISOString();
```

This satisfies GPS device parsers without implying a real recorded track.

See [docs/gpx/compatibility.md](docs/gpx/compatibility.md) for the full device compatibility table.

---

## Feedback ML System

`lib/feedback-store.ts` implements a simple localStorage-backed feedback collector. Every 👍 / 👎 click saves a `RouteFeedback` object with enough context to train a ranking model.

### Data structure

```typescript
interface RouteFeedback {
  timestamp: string;           // ISO 8601
  rating: "up" | "down";
  // Route features (model inputs)
  distanceKm: number;
  ascendM: number;
  descendM: number;
  durationSeconds: number;
  surfaceScore: number;
  loopScore: number;
  totalScore: number;
  // Session context
  profileId: string;
  targetDistanceKm: number;
  targetElevationM: number;
  // Route geometry fingerprint
  startLat: number;
  startLng: number;
  endLat: number;
  endLng: number;
}
```

### Intended ML use

The feature vector is designed for a future XGBoost or LightGBM pairwise ranking model. For each session config, the model would predict which route variant a user will prefer, replacing or supplementing the current hand-crafted scoring weights.

Data is exported as JSON via the "Export feedbacks" button in the sidebar (visible only when ≥ 1 feedback exists). See [docs/data/feedback-schema.md](docs/data/feedback-schema.md) for the full schema documentation.

---

## External APIs

| Service | Auth | Rate limit | Used for |
|---------|------|-----------|---------|
| GraphHopper Directions | API key | 500 req/day (free) | Running round-trip routing |
| OpenRouteService | API key | 2 000 req/day (free) | Cycling routing + elevation |
| Open-Meteo Elevation | None | 10 000 req/day | Elevation enrichment |
| Overpass OSM | None | ~10 req/min politely | Terrain/surface tags |
| Nominatim OSM | None | 1 req/s | Address geocoding (browser) |

All external API calls are made server-side (in API Routes or `route-generator.ts`), except:
- Nominatim — called from the browser's `AddressInput` component

---

## Performance Considerations

### Parallel candidate fetch

GraphHopper seeds and ORS variant requests are always made in parallel (`Promise.all`). On a fast connection this means 6 route candidates are fetched in the time it takes to fetch one.

### Overpass cache

`fetchSurfaceData()` caches Overpass results in an in-process Map keyed by rounded bounding box. The cache TTL is 1 hour. This is intentionally a process-level cache (not Redis) because:
1. Terrain data changes at most a few times per day
2. The app is typically run as a single Next.js instance
3. The simplicity of an in-memory cache outweighs the consistency guarantees of a shared cache for this use case

### Map GeoJSON payload

Routes are subsampled to at most 500 points (`subsamplePoints`/`subsamplePoints3d`) before being included in the API response. A 20 km route at GraphHopper's default resolution has ~2 000 points; subsampling to 500 reduces the JSON payload from ~200 KB to ~50 KB without meaningful visual degradation at zoom levels 10–15.

### Map animation

The route draw animation uses a single `requestAnimationFrame` loop that slices the GeoJSON line using `turf.lineSliceAlong`. The animation is cancelled immediately if the component unmounts (e.g. user clicks "Modifier" during animation). No `setTimeout` fallback is needed because all modern browsers support `requestAnimationFrame`.
