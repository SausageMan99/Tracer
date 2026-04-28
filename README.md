# TrailForge

> Route generator for runners and cyclists — built on real topology, real terrain, real roads.

[![Next.js](https://img.shields.io/badge/Next.js-15-black?logo=next.js)](https://nextjs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-5-blue?logo=typescript)](https://www.typescriptlang.org)
[![Mapbox GL JS](https://img.shields.io/badge/Mapbox_GL-3.9-000?logo=mapbox)](https://docs.mapbox.com/mapbox-gl-js/)
[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)

TrailForge generates tailored running and cycling routes from a start address, a target distance, and a target elevation gain. It combines the GraphHopper and OpenRouteService routing engines with OpenStreetMap terrain data and Open-Meteo elevation profiles — then scores each candidate route on surface quality, elevation match, nature proximity, and quietness, returning the best match with a GPX export ready for your GPS device.

---

## Features

- **14 session profiles** across 4 sports (running, road cycling, gravel, MTB), each with its own scoring weights and routing preferences
- **Dual mode** — Performance (blue) favors road quality; Scenic (green) boosts nature proximity and quietness
- **Round-trip and A→B routing** with optional via-waypoints
- **Slope gradient visualization** on the map (green → yellow → orange → red for 0 → 10 %+)
- **Interactive elevation profile** with hover crosshair synchronized to the map marker
- **Up to 6 route variants** per search, selectable in the sidebar
- **GPX 1.1 export** compatible with Garmin, Wahoo, Suunto, and Komoot
- **Feedback dataset** (👍 / 👎 on every route) stored locally for future ML training

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                         Browser (Next.js)                        │
│                                                                  │
│  ┌─────────────────┐          ┌──────────────────────────────┐  │
│  │   Sidebar UI    │          │       Mapbox GL JS           │  │
│  │  SessionForm    │◄─Zustand─►   (slope, arrows)            │  │
│  │  RouteResult    │  store   │   ElevationProfile (SVG)     │  │
│  └────────┬────────┘          └──────────────────────────────┘  │
│           │ POST /api/generate-route                             │
└───────────┼─────────────────────────────────────────────────────┘
            │
┌───────────▼─────────────────────────────────────────────────────┐
│                    Next.js API Routes                            │
│                                                                  │
│  /api/generate-route                                            │
│  (route-generator.ts)                                           │
└──────┬──────────┬──────────────────────────────────────────────┘
       │          │
       ▼          ▼
  GraphHopper  OpenRouteService
  (running)    (cycling)
       │          │
       ▼          ▼
  Open-Meteo    Overpass OSM
  (elevation)   (terrain tags)
```

**Data flow summary:**
1. User submits a form → `POST /api/generate-route`
2. Address is geocoded via Nominatim
3. 6 round-trip candidates are fetched from GraphHopper (running) or ORS (cycling)
4. Elevation is enriched via Open-Meteo (running) or taken from ORS response (cycling)
5. Terrain quality is scored via Overpass (highway/surface tags), cached 1 h
6. Candidates are ranked; the best is displayed with the full slope map, profile chart, and GPX export

---

## Prerequisites

| Tool | Version | Purpose |
|------|---------|---------|
| Node.js | ≥ 22 | JavaScript runtime |
| npm | ≥ 10 | Package manager |
| Git | any | Source control |

API keys required (free tiers available):

| Service | Variable | Where to get it |
|---------|----------|-----------------|
| Mapbox GL JS | `NEXT_PUBLIC_MAPBOX_TOKEN` | [account.mapbox.com](https://account.mapbox.com) |
| GraphHopper | `GRAPHHOPPER_API_KEY` | [graphhopper.com/dashboard](https://graphhopper.com/dashboard) |
| OpenRouteService | `ORS_API_KEY` | [openrouteservice.org/dev/#/login](https://openrouteservice.org/dev/#/login) |

---

## Quick Start

### 1. Clone and install

```bash
git clone https://github.com/your-org/trailforge.git
cd trailforge
npm install
```

### 2. Configure environment

Copy the example file and fill in your API keys:

```bash
cp .env.example .env.local
```

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Yes | Mapbox GL JS public token (starts with `pk.`) |
| `GRAPHHOPPER_API_KEY` | Yes | GraphHopper Directions API key, used by the legacy fallback engine |
| `ORS_API_KEY` | Recommended | OpenRouteService API key for cycling profiles and legacy fallback |
| `ADMIN_SECRET` | Optional | Bearer token for admin feedback export via `GET /api/feedback` |
| `GROWTHBOOK_API_HOST` | Optional | GrowthBook API host, defaults to `https://cdn.growthbook.io` in `.env.example` |
| `GROWTHBOOK_CLIENT_KEY` | Optional | GrowthBook SDK client key for precomputed flag routes |
| `FLAGS_SECRET` | Optional | Secret required by the Flags SDK when precomputing `/[code]` permutations |

Open-Meteo and Overpass are used without authentication. If GrowthBook variables are empty, the app still builds; feature-flag permutation pages are simply skipped locally.

### 3. Start the development server

```bash
npm run dev
# App available at http://localhost:3000
```

---

## Project Structure

```
trailforge/
├── app/
│   ├── api/
│   │   └── generate-route/route.ts   # POST handler — validates body, calls generateRoute()
│   ├── layout.tsx                    # Root layout (Syne font, viewport meta)
│   └── page.tsx                      # Single-page app shell (sidebar + map)
│
├── components/
│   ├── map/
│   │   ├── ClientMapWrapper.tsx      # Dynamic import wrapper to skip SSR for Mapbox
│   │   └── MapView.tsx               # Mapbox GL JS map, all layers, route animation
│   └── sidebar/
│       ├── AddressInput.tsx          # Nominatim autocomplete with ARIA listbox
│       ├── ElevationProfile.tsx      # Interactive SVG elevation chart
│       ├── FeedbackButtons.tsx       # 👍 / 👎 feedback recorder
│       ├── RouteResult.tsx           # Post-generation panel (stats, variants, GPX)
│       ├── SessionForm.tsx           # Route generation form (sport, profile, targets)
│       └── SidebarContainer.tsx      # Mounts form + result simultaneously, toggles visibility
│
├── lib/
│   ├── feedback-store.ts             # localStorage read/write for RouteFeedback[]
│   ├── gpx-export.ts                 # GPX 1.1 generation and browser download
│   ├── route-generator.ts            # Core pipeline — geocode → fetch → elevate → score → rank
│   ├── session-profiles.ts           # 14 session profiles with weights and routing params
│   ├── store.ts                      # Zustand AppStore — single flat store for all UI state
│   └── types.ts                      # Shared TypeScript types for the entire codebase
│
├── public/                           # Static assets
├── .env.example                      # Environment variable template
├── next.config.ts                    # Next.js config (headers, image domains)
├── tailwind.config.ts                # Tailwind CSS config
└── tsconfig.json                     # TypeScript config (strict, path aliases)
```

---

## API Reference

### `POST /api/generate-route`

Generates one or more route candidates from a start address.

**Request body** (`application/json`):

| Field | Type | Required | Description |
|-------|------|----------|-------------|
| `address` | `string` | Yes | Start address (geocoded via Nominatim) |
| `profileId` | `string` | Yes | One of the 14 profile IDs (e.g. `"running_long_hills"`) |
| `targetDistanceKm` | `number` | Yes | Target route distance in km |
| `targetElevationM` | `number` | Yes | Target elevation gain in metres (D+) |
| `waypoints` | `[number, number][]` | No | Additional via-waypoints `[lng, lat]` |
| `endAddress` | `string` | No | Different end address for A→B routing |

**Success response** (`200`):

```json
{
  "success": true,
  "route": {
    "best": { "distanceKm": 12.3, "ascendM": 420, ... },
    "candidates": [...],
    "profile": { "id": "running_long_hills", "name": "Long trail" }
  }
}
```

**Error responses**:

| Status | `errorCode` | Cause |
|--------|-------------|-------|
| `400` | `UNKNOWN` | Missing or invalid body fields, unknown `profileId` |
| `422` | `NO_ROAD_NETWORK` | No routable roads near the start address |
| `422` | `IMPOSSIBLE_ELEVATION` | Requested D+ exceeds terrain maximum |
| `422` | `GEOCODING_FAILED` | Nominatim could not resolve the address |
| `500` | `UNKNOWN` | Unexpected server-side error |

---

## Session Profiles

| ID | Name | Sport | Type |
|----|------|-------|------|
| `running_easy` | Sortie facile | Running | Endurance |
| `running_long` | Longue distance | Running | Endurance |
| `running_intervals` | Fractionné | Running | Speed |
| `running_trail` | Trail | Running | Trail |
| `running_long_hills` | Long avec côtes | Running | Hills |
| `cycling_road_endurance` | Endurance route | Road cycling | Endurance |
| `cycling_road_intervals` | Fractionné route | Road cycling | Speed |
| `cycling_road_climb` | Grimpée | Road cycling | Hills |
| `cycling_gravel_explore` | Gravel exploration | Gravel | Exploration |
| `cycling_gravel_long` | Gravel longue | Gravel | Endurance |
| `cycling_mtb_trail` | VTT trail | MTB | Trail |
| `cycling_mtb_enduro` | VTT enduro | MTB | Hills |
| `cycling_mtb_xc` | VTT XC | MTB | Speed |
| `cycling_mtb_dh` | VTT DH | MTB | Descent |

---

## Contributing

1. **Fork** the repository and create a feature branch: `git checkout -b feat/my-feature`
2. **Follow the code standards** documented in [DEVELOPER_GUIDE.md](DEVELOPER_GUIDE.md)
3. **Add JSDoc** (English, Google standard) to any new exported symbols
4. **Test manually** — start the dev server and verify the feature end-to-end
5. **Open a pull request** with a clear description of the change and why it was made

For architecture questions or large changes, open an issue first to align on the approach.

---

## License

MIT © 2024 TrailForge contributors. See [LICENSE](LICENSE).
