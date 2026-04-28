# TrailForge

> Intelligent route generator for runners and cyclists -- built on real OSM topology, real terrain, real roads.

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org)
[![Mapbox GL JS](https://img.shields.io/badge/Mapbox_GL-3.9-000?logo=mapbox)](https://docs.mapbox.com/mapbox-gl-js/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

TrailForge generates tailored running and cycling routes from a start address, a target distance, and a target elevation gain. The primary V2 engine builds an OSM graph on the fly and runs a beam-search solver to produce optimized loop routes scored on surface quality, elevation, nature proximity, and quietness. When V2 cannot handle a request (waypoints, A-to-B routes, or engine failure), a legacy engine backed by GraphHopper and OpenRouteService takes over transparently. Every route ships with a GPX export ready for your GPS device.

---

## Features

- **14 session profiles** across 4 sports (running, road cycling, gravel, MTB), each with its own scoring weights and routing preferences
- **V2 beam-search engine** (primary) -- OSM graph with 5 directional configs, elevation-aware budget pruning, A* loop closure
- **Legacy engine** (fallback) -- GraphHopper (running) / OpenRouteService (cycling), used for waypoints and A-to-B
- **Scenic mode** -- boosts nature proximity and quietness weights
- **Safety scoring** -- uses OSM `lit` and `access` tags, blended into the quietness dimension
- **Round-trip and A-to-B routing** with optional via-waypoints
- **Slope gradient visualization** on the map (green to red for 0% to 10%+)
- **Interactive elevation profile** with hover crosshair synchronized to the map marker
- **Up to 6 route variants** per search, selectable in the sidebar
- **GPX 1.1 export** compatible with Garmin, Wahoo, Suunto, and Komoot
- **Feedback dataset** (thumbs up / thumbs down on every route) stored locally for future training
- **Rate limiting** -- 20 requests per minute per IP
- **Waitlist system** with invite codes
- **Landing page V2** with modular sections and GSAP animations
- **Mobile-responsive** sidebar (slide-over drawer on small screens)

---

## Architecture

```
                              Browser (Next.js + Zustand + Mapbox GL JS)
  ┌──────────────────────────────────────────────────────────────────────────────┐
  │                                                                              │
  │  ┌──────────────────┐                ┌─────────────────────────────────────┐ │
  │  │    Sidebar UI     │                │          Mapbox GL JS              │ │
  │  │  SessionForm      │◄── Zustand ──►│  slope gradient, direction arrows  │ │
  │  │  RouteResult      │    store      │  ElevationProfile (SVG)            │ │
  │  │  AddressInput     │                │                                    │ │
  │  └────────┬──────────┘                └─────────────────────────────────────┘ │
  │           │                                                                   │
  └───────────┼───────────────────────────────────────────────────────────────────┘
              │ POST /api/generate-route
              ▼
  ┌───────────────────────────────────────────────────────────────────────────────┐
  │                        Next.js API Route (rate-limited)                       │
  │                                                                               │
  │   Geocode address (Mapbox v5)                                                │
  │        │                                                                      │
  │        ├──── V2 Engine (PRIMARY) ──────────────────────────────┐              │
  │        │     graph-builder (Overpass) ──► edge-scorer ──►      │              │
  │        │     orienteering-solver (beam search, 5 configs) ──►  │              │
  │        │     route-post-processor (elevation, ranking)         │              │
  │        │                                                       │              │
  │        ├──── Legacy Engine (FALLBACK) ─────────────────────┐   │              │
  │        │     GraphHopper (running) / ORS (cycling) ──►     │   │              │
  │        │     Open-Meteo (elevation) ──► Overpass (terrain)  │   │              │
  │        │     ──► scoring ──► ranking                        │   │              │
  │        │                                                    │   │              │
  │        ▼                                                    │   │              │
  │   Return best route + candidates                            │   │              │
  └─────────────────────────────────────────────────────────────┘───┘──────────────┘
```

**When does each engine run?**

| Scenario | Engine |
|----------|--------|
| Round-trip loop (no waypoints) | V2 (primary) |
| V2 fails at runtime | Legacy (automatic fallback) |
| A-to-B route (`endAddress` set) | Legacy |
| Via-waypoints provided | Legacy |

**V2 scoring dimensions** (4 weights, no popularity/heatmap):

| Dimension | Source |
|-----------|--------|
| Surface quality | OSM `highway` / `surface` tags |
| Elevation match | Open-Meteo elevation API |
| Nature proximity | OSM landuse / natural tags |
| Quietness | OSM road class + `lit` / `access` safety tags |

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | >= 22 | JavaScript runtime |
| npm | >= 10 | Package manager |
| Git | any | Source control |

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/your-org/trailforge.git
cd trailforge
npm install
```

### 2. Configure environment

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | **Yes** | Mapbox public token (starts with `pk.`) -- used for map display **and** geocoding |
| `GRAPHHOPPER_API_KEY` | No | GraphHopper Directions API key (legacy engine only) |
| `ORS_API_KEY` | No | OpenRouteService API key (legacy engine only) |

Open-Meteo and Overpass are used without authentication.

If you only need the V2 engine (round-trip loops), the Mapbox token is the only required key. GraphHopper and ORS keys are needed only for legacy fallback, A-to-B, and waypoint routing.

### 3. Start the development server

```bash
npm run dev
# App available at http://localhost:3000
```

### 4. Run tests

```bash
npm test          # Watch mode
npm run test:run  # Single run
```

---

## Project Structure

```
trailforge/
├── app/
│   ├── api/
│   │   ├── generate-route/route.ts   # V2-first, legacy-fallback handler
│   │   ├── feedback/route.ts         # POST feedback endpoint
│   │   └── waitlist/route.ts         # POST waitlist signup
│   ├── [code]/page.tsx               # Waitlist invite page
│   ├── layout.tsx                    # Root layout
│   └── page.tsx                      # Landing page (LandingPageV2)
│
├── components/
│   ├── landing/                      # Landing page V2 sections (GSAP)
│   ├── map/
│   │   ├── ClientMapWrapper.tsx      # Dynamic import (skip SSR for Mapbox)
│   │   └── MapView.tsx               # Mapbox GL JS map and layers
│   ├── sidebar/
│   │   ├── AddressInput.tsx          # Mapbox Geocoding v5 autocomplete
│   │   ├── ElevationProfile.tsx      # Interactive SVG elevation chart
│   │   ├── FeedbackButtons.tsx       # Thumbs up / down feedback
│   │   ├── RouteResult.tsx           # Post-generation panel (stats, GPX)
│   │   ├── SessionForm.tsx           # Route generation form
│   │   └── SidebarContainer.tsx      # Sidebar shell (drawer on mobile)
│   ├── providers/                    # React context providers
│   └── ui/                           # Shared UI primitives
│
├── lib/
│   ├── engine/                       # V2 OSM-graph routing engine
│   │   ├── index.ts                  # generateRouteV2() entry point
│   │   ├── graph-builder.ts          # Overpass OSM graph construction
│   │   ├── edge-scorer.ts            # 4-weight edge scoring
│   │   ├── orienteering-solver.ts    # Beam-search (5 configs, directional seeding)
│   │   ├── pathfinder.ts             # A* return path for loop closure
│   │   └── route-post-processor.ts   # Elevation enrichment and ranking
│   ├── services/
│   │   ├── waitlist.ts               # Waitlist file storage
│   │   ├── feedback-store.ts         # localStorage feedback persistence
│   │   └── rate-limiter.ts           # IP-based rate limiting (20/min)
│   ├── utils/
│   │   ├── format.ts                 # formatDuration and helpers
│   │   ├── animations.ts             # GSAP animation helpers
│   │   └── gsap-setup.ts             # GSAP plugin registration
│   ├── feature-flags/                # GrowthBook integration
│   ├── route-generator-legacy.ts     # Legacy GraphHopper/ORS engine
│   ├── session-profiles.ts           # 14 session profiles with weights
│   ├── store.ts                      # Zustand store (flat, single store)
│   ├── types.ts                      # Shared TypeScript types
│   ├── errors.ts                     # RouteGenerationError typed class
│   ├── gpx-export.ts                 # GPX 1.1 generation and download
│   └── trail-waypoints.ts            # Domain utility
│
├── hooks/                            # React hooks
├── docs/                             # Extended documentation
└── tests/                            # Vitest tests
```

---

## API Reference

### `POST /api/generate-route`

Generates one or more route candidates from a start address. Rate-limited to 20 requests per minute per IP.

**Request body** (`application/json`):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `address` | `string` | Yes | Start address (geocoded via Mapbox Geocoding v5) |
| `profileId` | `string` | Yes | One of the 14 profile IDs (e.g. `"running_endurance"`) |
| `targetDistanceKm` | `number` | Yes | Target route distance in km (validated against profile range) |
| `targetElevationM` | `number` | Yes | Target elevation gain in metres (validated against profile range) |
| `scenicMode` | `boolean` | No | Boost nature and quietness weights |
| `waypoints` | `[number, number][]` | No | Via-waypoints `[lng, lat]` (forces legacy engine) |
| `endAddress` | `string` | No | End address for A-to-B routing (forces legacy engine) |

**Success response** (`200`):

```json
{
  "success": true,
  "route": {
    "best": { "distanceKm": 12.3, "ascendM": 420 },
    "candidates": [],
    "profile": { "id": "running_endurance", "name": "Endurance" }
  }
}
```

**Error responses**:

| Status | `errorCode` | Cause |
|--------|-------------|-------|
| `400` | `UNKNOWN` | Missing or invalid body fields, unknown `profileId`, out-of-range distance/elevation |
| `422` | `NO_ROAD_NETWORK` | No routable roads near the start address. Sub-codes: `OVERPASS_TIMEOUT`, `EMPTY_GRAPH`, `SOLVER_EMPTY` |
| `422` | `IMPOSSIBLE_ELEVATION` | Requested D+ exceeds terrain maximum (includes `maxElevationEstimate`) |
| `422` | `GEOCODING_FAILED` | Mapbox could not resolve the address |
| `429` | `UNKNOWN` | Rate limit exceeded |
| `500` | `UNKNOWN` | Unexpected server-side error |

### `POST /api/feedback`

Records user feedback on a generated route. Rate-limited to 10 per IP per hour.

### `POST /api/waitlist`

Registers an email address for the waitlist.

---

## Session Profiles

### Running (5 profiles)

| ID | Name | Distance | D+ |
|----|------|----------|----|
| `running_endurance` | Endurance | 5--30 km | 50--500 m |
| `running_seuil` | Seuil Lactique | 6--20 km | 0--200 m |
| `running_intervals` | Intervals 30/30 | 5--12 km | 0--100 m |
| `running_sortie_longue` | Sortie Longue | 20--50 km | 100--1000 m |
| `running_recuperation` | Recuperation | 3--10 km | 0--80 m |

### Road Cycling (5 profiles)

| ID | Name | Distance | D+ |
|----|------|----------|----|
| `cycling_road_endurance` | Endurance | 30--150 km | 200--2000 m |
| `cycling_road_seuil` | Seuil | 25--100 km | 100--1000 m |
| `cycling_road_intervals` | Intervals | 20--80 km | 0--400 m |
| `cycling_road_gran_fondo` | Gran Fondo | 80--250 km | 1000--5000 m |
| `cycling_road_recuperation` | Recuperation | 15--60 km | 0--300 m |

### Gravel (2 profiles)

| ID | Name | Distance | D+ |
|----|------|----------|----|
| `cycling_gravel_endurance` | Endurance Gravel | 40--180 km | 300--3000 m |
| `cycling_gravel_gran_fondo` | Gran Fondo Gravel | 100--300 km | 1500--6000 m |

### MTB (2 profiles)

| ID | Name | Distance | D+ |
|----|------|----------|----|
| `cycling_mtb_endurance` | Endurance VTT | 15--80 km | 300--2500 m |
| `cycling_mtb_intervals` | Intervals VTT | 10--40 km | 200--1500 m |

---

## Tech Stack

| Layer | Technology |
|-------|------------|
| Framework | Next.js 15 (App Router) |
| Language | TypeScript 5 (strict) |
| State | Zustand 5 |
| Map | Mapbox GL JS 3.9 |
| Geocoding | Mapbox Geocoding v5 |
| Animations | GSAP 3 + Lenis (smooth scroll) |
| 3D | Three.js / React Three Fiber (landing page) |
| Testing | Vitest + Testing Library |
| Feature flags | GrowthBook (Flags SDK) |
| Analytics | Vercel Analytics + Speed Insights |
| Styling | Tailwind CSS 3 |

---

## Contributing

1. **Fork** the repository and create a feature branch: `git checkout -b feat/my-feature`
2. **Follow the code standards** documented in [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)
3. **Add JSDoc** (English, Google standard) to any new exported symbols
4. **Write tests** and verify they pass: `npm run test:run`
5. **Open a pull request** with a clear description of the change and why it was made

For architecture questions or large changes, open an issue first to align on the approach.

---

## License

MIT (c) 2024 TrailForge contributors. See [LICENSE](LICENSE).
