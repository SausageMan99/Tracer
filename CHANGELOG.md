# Changelog

All notable changes to TrailForge are documented here.

Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Version numbering follows [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

---

## [Unreleased]

### Changed
- Reorganized `lib/` into `lib/utils/` (format, animations, gsap-setup) and `lib/services/` (waitlist, feedback-store, rate-limiter)
- Extracted shared `formatDuration()` utility from MapView and RouteResult into `lib/utils/format.ts`

### Removed
- Deleted legacy `LandingPage.tsx` (V1) — replaced by `LandingPageV2`

---

## [0.5.0] — 2026-03-09

### Added
- **Rate limiting** on all API endpoints via `createRateLimiter` (20 req/min/IP on generate-route, 10/hr on feedback, 5/hr on waitlist)
- **Typed error system** — `RouteGenerationError` class with machine-readable `code` and `subCode` (replaces string-encoded errors)
- **Error sub-codes** for V2 engine: `OVERPASS_TIMEOUT`, `EMPTY_GRAPH`, `SOLVER_EMPTY` with French user messages
- **Input validation** — numeric bounds checked against profile `distanceRange` and `elevationRange`

### Changed
- API error responses now include structured `errorCode` and optional `subCode` fields
- `429 Too Many Requests` response for rate-limited clients

---

## [0.4.0] — 2026-03-04

### Added
- **V2 routing engine** — OSM-graph-based beam-search solver (`lib/engine/`) as the primary route generation method
  - Graph builder: Overpass OSM query with disk cache (7-day TTL)
  - Edge scorer: 4 weight dimensions (surface, elevation, nature, quietness)
  - Beam-search solver: 5 configs with directional seeding (0°, 72°, 144°, 216°, 288°)
  - A* pathfinder for deterministic loop closure
  - Post-processor: subsampling, elevation, candidate ranking, geometric deduplication
- **Mapbox Geocoding v5** migration — replaces Nominatim for both frontend autocomplete and server-side geocoding
- **Landing page V2** — modular section-based architecture (HeroSection, ManifestoSection, HowItWorksSection, StackingFeatureCards) with GSAP animations
- **Waitlist system** — email signup with invite codes, file-based storage
- **Mobile UX** — sidebar as slide-over drawer on mobile, FAB "Configurer" button, auto-close on generate
- **Curated presets** — `distancePresets` and `elevationPresets` per session profile
- **Safety scoring** — `scoreSafety()` using `lit` and `access` OSM tags, blended into quietness weight
- **Scenic mode refinement** — `scenicMode` flag threaded to `deriveWeights()`, boosts nature + quietness
- **Feedback API** — `POST /api/feedback` endpoint writing to `.data/feedbacks.json`
- **Feature flags** — GrowthBook integration via `lib/feature-flags/`
- **16 session profiles** (was 14) — added recuperation profiles and refined session types (seuil_lactique, intervals_30_30, sortie_longue, gran_fondo)

### Changed
- API route now uses V2-first strategy with automatic legacy fallback on error
- Legacy engine used for waypoint/A→B routes (V2 is loop-only)
- Scoring weights renormalized to 4 dimensions (surface, elevation, nature, quietness) — popularity removed

### Fixed
- **D+=0m elevation bug** — fixed cumulative elevation tracking in beam-search solver
- **Zigzag routes** — anti-backtracking (hard-reject U-turns, soft-penalize near-reversals) and geometric deduplication (Jaccard > 0.6)

### Removed
- **Strava heatmap integration** — removed for legal compliance (tile proxy, Go proxy, heatmap-scorer, popularity score)
- **Nominatim geocoding** — replaced by Mapbox Geocoding v5

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

[Unreleased]: https://github.com/your-org/trailforge/compare/v0.5.0...HEAD
[0.5.0]: https://github.com/your-org/trailforge/compare/v0.4.0...v0.5.0
[0.4.0]: https://github.com/your-org/trailforge/compare/v0.3.0...v0.4.0
[0.3.0]: https://github.com/your-org/trailforge/compare/v0.2.0...v0.3.0
[0.2.0]: https://github.com/your-org/trailforge/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/your-org/trailforge/releases/tag/v0.1.0
