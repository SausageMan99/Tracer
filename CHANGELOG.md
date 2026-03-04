# Changelog

All notable changes to TrailForge are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Version numbering follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Added
- Waypoint support: users can add optional via-points to guide the route through specific areas
- A→B routing: end address field in `SessionForm` for point-to-point routes
- Feedback dataset export button (visible when ≥ 1 feedback recorded)

### Changed
- Elevation profile hover now syncs a dot to the map in real time (via `hoveredRouteProgress` in the Zustand store)

---

## [0.3.0] — 2024-11-15

### Added
- **Strava heatmap overlay** in Scenic mode — raster tile layer from the Strava global activity heatmap, routed through a local Go proxy to handle CloudFront cookie authentication
- **Go proxy** (`cmd/proxy/`) for Strava tile authentication; `GET /api/heatmap-tile` Next.js route added as CORS bridge
- **Popularity scoring** (`lib/heatmap-scorer.ts`) — `scoreRoutePopularity()` samples tiles at zoom 12 using OffscreenCanvas, computing brightness via the "hot" colormap formula
- **Scenic / Performance mode toggle** in the sidebar header; accent colour switches from blue to green
- **Feedback system** — 👍 / 👎 buttons on every route result, persisted to `localStorage` as `RouteFeedback[]` feature vectors (designed for future ML training)
- `FeedbackButtons` and `FeedbackButtons.tsx` components
- `lib/feedback-store.ts` — `saveFeedback`, `loadFeedbacks`, `exportFeedbacksAsJSON`
- Slope legend in `RouteResult` (five colour swatches matching the map gradient)
- Candidate variant selector in `RouteResult` (horizontal scroll, up to 6 variants)

### Changed
- `totalScore` now accepts an optional `popularityScore` component when Scenic mode is active (weight: 0.25)
- `AppStore` extended with `scenicMode` boolean and `setScenicMode` action
- `MapView` updated to add/remove Strava raster layer when `scenicMode` changes

### Fixed
- GPX files rejected by Garmin Edge — `<time>` element was missing from `<trkpt>`; synthetic timestamps now generated from estimated duration
- Route draw animation no longer plays when switching between candidates (only on first display)

---

## [0.2.0] — 2024-10-01

### Added
- **OpenRouteService cycling routing** (`fetchCandidateRoutesORS`) — 3 cycling profiles: road (`cycling-road`), gravel (`cycling-regular`), MTB (`cycling-mountain`)
- **14 session profiles** across 4 sports, replacing the previous 4 profiles (`lib/session-profiles.ts` rewrite)
- **Dual routing engine architecture** — `generateRoute()` now selects GraphHopper (running) or ORS (cycling) based on the sport
- **Slope gradient visualization** on the map — segments coloured green → yellow → orange → red by gradient percentage
- **Direction arrows** on the route every 200 m (Mapbox symbol layer)
- **Interactive elevation profile** (`ElevationProfile.tsx`) — SVG chart with hover crosshair, elevation bubble, and Zustand sync
- **Score bars** in `RouteResult` (terrain, loop, global) using `ScoreBar` sub-component
- `lib/heatmap-scorer.ts` scaffold (populated in v0.3.0)
- `PROFILES_BY_SPORT` and `SPORT_LABELS` exports in `lib/session-profiles.ts`
- `SidebarContainer.tsx` — mounts both `SessionForm` and `RouteResult` simultaneously for smooth transitions

### Changed
- Sidebar redesigned with dark colour scheme (`#0F172A` background, `#1E293B` cards)
- `AddressInput` now supports a `dark` prop for the sidebar colour scheme
- Route result now shows 4 stat cards (distance, D+/D−, duration, score) instead of a text summary
- `AppStore` extended with `candidateIndex`, `setCandidateIndex`, `hoveredRouteProgress`, `setHoveredRouteProgress`

### Removed
- Light-mode sidebar (replaced by dark-only design)
- Basic list-style route result view

---

## [0.1.0] — 2024-08-20

### Added
- Initial MVP — Next.js 15 App Router scaffold with TypeScript strict mode
- **Running route generation** via GraphHopper round-trip API (6 parallel seeds)
- **Elevation enrichment** via Open-Meteo Elevation API (batched in chunks of 100)
- **Terrain scoring** via Overpass OSM API (highway/surface tags, in-process 1 h cache)
- **Loop scoring** based on start-to-end distance gap
- `scoreRoute()` — weighted sum of elevation match, distance match, surface quality, loop quality
- `generateRoute()` — full 8-step pipeline (geocode → fetch → elevate → surface → score → rank)
- `geocodeAddress()` — Nominatim OpenStreetMap geocoding
- `AddressInput.tsx` — debounced Nominatim autocomplete with ARIA listbox (keyboard navigable)
- `SessionForm.tsx` — form with sport/profile selector, distance slider, elevation input
- `RouteResult.tsx` — basic results panel with GPX export button
- `MapView.tsx` — Mapbox GL JS map with route GeoJSON line and start/end markers
- `ClientMapWrapper.tsx` — SSR-disabled dynamic import for Mapbox
- `lib/gpx-export.ts` — GPX 1.1 generator with `<ele>` and synthetic `<time>` tags
- `lib/types.ts` — shared TypeScript types for the entire codebase
- `lib/store.ts` — Zustand flat store for all UI state
- `GET /api/generate-route` → `POST /api/generate-route` API route
- `.env.example` with `NEXT_PUBLIC_MAPBOX_TOKEN`, `GRAPHHOPPER_API_KEY`

[Unreleased]: https://github.com/your-org/trailforge/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/your-org/trailforge/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/your-org/trailforge/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/your-org/trailforge/releases/tag/v0.1.0
