# Developer Guide

Everything you need to go from zero to a running local dev environment, understand the codebase conventions, and extend TrailForge with new profiles, sports, or scoring behaviour.

---

## Table of Contents

1. [Local Setup (from scratch)](#local-setup-from-scratch)
2. [Environment Variables](#environment-variables)
3. [Code Standards](#code-standards)
4. [Tutorials](#tutorials)
   - [Add a new session profile](#add-a-new-session-profile)
   - [Add a new sport](#add-a-new-sport)
   - [Modify the scoring algorithm](#modify-the-scoring-algorithm)
   - [Add a new map layer](#add-a-new-map-layer)
5. [Debugging Guide](#debugging-guide)
6. [Architecture Quick-Reference](#architecture-quick-reference)

---

## Local Setup (from scratch)

**Prerequisites:** Node.js >= 22, npm >= 10, Git. No other runtimes required.

### macOS

```bash
# 1. Install Node.js 22 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.zshrc   # or ~/.bashrc
nvm install 22
nvm use 22

# 2. Clone the repo
git clone https://github.com/your-org/trailforge.git
cd trailforge

# 3. Install dependencies
npm install

# 4. Configure environment (see section below)
cp .env.example .env.local
# Fill in NEXT_PUBLIC_MAPBOX_TOKEN (required)
# Optionally: GRAPHHOPPER_API_KEY, ORS_API_KEY (for legacy engine)

# 5. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Linux (Ubuntu/Debian)

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Then follow steps 2-5 from macOS above
```

### Useful npm scripts

| Script | Description |
|--------|-------------|
| `npm run dev` | Start Next.js dev server with hot reload |
| `npm run build` | Production build |
| `npm run start` | Serve the production build |
| `npm run lint` | Run ESLint |
| `npm run test` | Run Vitest in watch mode |
| `npm run test:run` | Run Vitest once (CI) |

---

## Environment Variables

All variables are loaded from `.env.local` (gitignored). Never commit `.env.local`.

| Variable | Required | Description |
|----------|----------|-------------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Yes | Mapbox GL JS + Geocoding v5 public token. Must start with `pk.`. |
| `GRAPHHOPPER_API_KEY` | No | GraphHopper Directions API key. Used only server-side by the legacy engine (fallback for running). |
| `ORS_API_KEY` | No | OpenRouteService API key. Used only server-side by the legacy engine (fallback for cycling). |

No other variables are required. The V2 engine uses Open-Meteo (elevation) and Overpass (OSM data), both of which are unauthenticated public APIs.

> **Security note:** `NEXT_PUBLIC_*` variables are embedded in the client bundle. Do not prefix server-side secrets with `NEXT_PUBLIC_`.

### Getting free API keys

- **Mapbox:** Create an account at [account.mapbox.com](https://account.mapbox.com). The default public token works for development. For production, create a token scoped to your domain.
- **GraphHopper (optional):** Register at [graphhopper.com/dashboard](https://graphhopper.com/dashboard). The free tier allows 500 route requests/day.
- **OpenRouteService (optional):** Register at [openrouteservice.org/dev](https://openrouteservice.org/dev/#/login). The free tier allows 2 000 requests/day.

---

## Code Standards

### TypeScript

- **Strict mode** is enabled (`tsconfig.json`). No `any`, no `@ts-ignore` without a comment explaining why.
- **Prefer explicit return types** on all exported functions. Inferred return types are fine for local helpers.
- **Path aliases:** `@/` maps to the project root. Use `@/lib/types` not `../../lib/types`.

### JSDoc

All exported symbols must have JSDoc. Follow the Google/TypeScript JSDoc standard:

```typescript
/**
 * Brief one-line summary ending with a period.
 *
 * Longer explanation of the "why" when the intent isn't obvious from the name.
 * Describe edge cases and failure modes here.
 *
 * @param foo - Description of the parameter, including valid values.
 * @returns Description of what is returned, including the null/undefined case.
 * @throws {RouteGenerationError} When the thrown code is `"NO_ROAD_NETWORK"`.
 *
 * @example
 * const result = myFunction("example");
 * // result === 42
 */
export function myFunction(foo: string): number { ... }
```

Rules:
- Write JSDoc in **English** (code is English; French is for the user-facing UI only)
- Document the **"why"**, not the "what" -- the code shows the what; the comment explains the reason
- Always document `@throws` if the function can throw
- Include `@example` for any function with non-obvious usage

### React components

- Use the `"use client"` directive only when the component uses browser APIs (`useState`, `useEffect`, `useRef`, Mapbox, etc.). Server components are the default in the App Router.
- Do not use `React.FC` -- use named function declarations with explicit prop interfaces.
- Prop interfaces are defined immediately above the component and are always named `<ComponentName>Props`.

### Styling

- Tailwind CSS utility classes only. No `.css` files, no CSS-in-JS.
- Inline `style={{}}` props are acceptable for dynamic values that Tailwind cannot express (e.g. `backgroundColor: accent`).
- Color variables: use the design system values defined in `tailwind.config.ts`. Key palette values: `--accent-lime: #7CB342`, `--accent-sage: #81C784`, `--bg-deep: #0A0D0C`.

### File organisation

- One React component per file, named identically to the file (`MapView.tsx` exports `MapView`).
- Library files in `lib/` are plain TypeScript modules (no React). They can be imported from both API routes and components.
- No barrel files (`index.ts`) except for `lib/engine/index.ts` which is the V2 entry point. Import directly from the source file everywhere else.

---

## Tutorials

### Add a new session profile

A session profile defines the sport, display name, scoring weights, distance/elevation ranges, and curated presets for a specific workout type. There are currently 16 profiles across 4 sports. Adding a profile takes ~15 lines.

**File to edit:** `lib/session-profiles.ts`

1. Add a new object to the `SESSION_PROFILES` array:

```typescript
{
  id: "running_fartlek",
  name: "Fartlek",
  sport: "running",
  sessionType: "speed",
  distanceRange: { min: 5, default: 8, max: 15 },
  elevationRange: { min: 0, default: 50, max: 150 },
  distancePresets: [5, 8, 10, 12],
  elevationPresets: [0, 50, 100, 150],
  description: "Fartlek: accélérations libres sur terrain varié.",
  graphhopperProfile: "foot",
  weights: {
    elevationMatch: 0.15,
    distanceMatch: 0.40,
    surfaceQuality: 0.25,
    loopQuality: 0.20,
  },
},
```

2. That's it. `PROFILES_BY_ID` and `PROFILES_BY_SPORT` are derived automatically. The new profile will appear in the `SessionForm` dropdown under the corresponding sport group.

**Profile structure reference:**
- `distanceRange` / `elevationRange` -- min/default/max values that bound the UI sliders
- `distancePresets` / `elevationPresets` -- curated chip values shown below each slider
- `weights` -- must sum to 1.0; controls how the legacy scoring algorithm ranks candidates

**Scoring weight guidelines:**
- `elevationMatch`: high for hills/climb sessions, low for speed/endurance
- `distanceMatch`: high when hitting the exact target matters (intervals), low for exploration
- `surfaceQuality`: high for trail/gravel (terrain quality matters), low for road
- `loopQuality`: keep at 0.15-0.20 unless there is a specific reason to prefer out-and-back

---

### Add a new sport

Adding a sport requires changes in up to four places, depending on whether you need V2 engine support.

**1. `lib/types.ts` -- extend the `Sport` type:**

```typescript
export type Sport =
  | "running"
  | "cycling_road"
  | "cycling_gravel"
  | "cycling_mtb"
  | "hiking";           // <-- add here
```

**2. `lib/session-profiles.ts` -- add profiles for the new sport and update `SPORT_LABELS`:**

```typescript
export const SPORT_LABELS: Record<Sport, string> = {
  // existing entries...
  hiking: "Randonnee",
};
```

Then add one or more `SessionProfile` entries with `sport: "hiking"` to the `SESSION_PROFILES` array.

**3. `lib/route-generator-legacy.ts` -- add legacy routing logic for the new sport:**

For a sport that uses GraphHopper, the existing `graphhopperProfile` field on the profile handles it. For ORS, add the profile mapping:

```typescript
const orsProfile: Record<string, string> = {
  cycling_road: "cycling-road",
  cycling_gravel: "cycling-regular",
  cycling_mtb: "cycling-mountain",
  hiking: "foot-hiking",   // <-- add here
};
```

**4. (V2 engine) `lib/engine/edge-scorer.ts` -- add sport-specific weights in `deriveWeights()`:**

```typescript
} else if (sport === "hiking") {
  w = { surface: 0.15, elevation: 0.25, nature: 0.40, quietness: 0.20 };
}
```

**No UI changes needed** -- `SessionForm` groups profiles by sport dynamically using `PROFILES_BY_SPORT`.

---

### Modify the scoring algorithm

TrailForge has two scoring systems, both active:

#### V2 edge scoring (primary engine)

**Files:** `lib/engine/edge-scorer.ts`

The V2 engine scores individual OSM edges using 4 weighted dimensions: **surface**, **elevation**, **nature**, **quietness**. The `deriveWeights()` function computes sport- and session-type-specific weights, normalized to sum to 1.0.

To add a new scoring dimension:

1. Add the new weight to `SessionWeights` in `lib/types.ts`
2. Implement a scorer function in `edge-scorer.ts` (e.g. `scoreLighting()`)
3. Include it in the `scoreEdges()` weighted sum
4. Update `deriveWeights()` to assign values for each sport/session combination
5. Ensure all weights still normalize to 1.0

The `scenicMode` flag boosts nature and quietness weights while reducing surface and elevation weights.

#### Legacy candidate scoring (fallback engine)

**File:** `lib/route-generator-legacy.ts`

The legacy engine uses `scoreRoute()` which computes a weighted sum of elevation match, distance match, surface quality, and loop quality. Weights come from the profile's `ScoringWeights`.

**To change the Gaussian decay width** (how forgiving the score is for distance/elevation misses):

```typescript
// Current: +/-20% of target gives ~0.61, +/-40% gives ~0.14
const sigma = 0.20 * target;

// To make it more forgiving (+/-30% gives ~0.61):
const sigma = 0.30 * target;
```

---

### Add a new map layer

All Mapbox GL layers are managed in `MapView.tsx` in the `useEffect` that runs after the map is loaded.

**Pattern for a new GeoJSON line layer:**

```typescript
// 1. Add the source
map.addSource("my-source", {
  type: "geojson",
  data: { type: "FeatureCollection", features: [] },
});

// 2. Add the layer
map.addLayer({
  id: "my-layer",
  type: "line",
  source: "my-source",
  paint: {
    "line-color": "#FF0000",
    "line-width": 3,
  },
});

// 3. Update data when the route changes (in the route update useEffect)
const source = map.getSource("my-source") as mapboxgl.GeoJSONSource;
if (source) {
  source.setData(myGeoJSON);
}

// 4. Clean up on unmount (in the cleanup function of the load useEffect)
if (map.getLayer("my-layer")) map.removeLayer("my-layer");
if (map.getSource("my-source")) map.removeSource("my-source");
```

**Important:** always guard `getLayer`/`getSource` calls with null checks -- layer removal order matters in Mapbox (remove layers before sources).

---

## Debugging Guide

### Error reference

| Symptom | Where to look | Likely cause |
|---------|---------------|--------------|
| "Aucun reseau routier detecte" (`EMPTY_GRAPH`) | `lib/engine/graph-builder.ts` | Overpass returned no ways near the start point. Try a more central/urban address. |
| "Serveur cartographique indisponible" (`OVERPASS_TIMEOUT`) | `lib/engine/graph-builder.ts` | Overpass server overloaded. Retry in 30 seconds. |
| "Impossible de construire un parcours en boucle" (`SOLVER_EMPTY`) | `lib/engine/orienteering-solver.ts` | Beam search couldn't find a valid loop. Try a different distance. |
| "Adresse introuvable" (`GEOCODING_FAILED`) | `geocodeAddress()` | Mapbox Geocoding v5 returned 0 results. Check spelling or try a more specific address. |
| "Le D+ demande n'est pas atteignable" (`IMPOSSIBLE_ELEVATION`) | `lib/engine/index.ts` | Terrain around the start point is too flat for the requested D+. |
| "Trop de requetes" (HTTP 429) | Rate limiter | 20 requests/min/IP exceeded. Wait and retry. |
| Route candidates all score < 30% | `lib/engine/edge-scorer.ts` or `lib/route-generator-legacy.ts` | Scoring weights may be mismatched for the area; check surface data coverage. |
| GPX file rejected by Garmin | `lib/gpx-export.ts` | Missing `<ele>` or `<time>` on track points. |
| Mapbox geocoding not showing results | `components/sidebar/AddressInput.tsx` | Query < 3 characters, or `NEXT_PUBLIC_MAPBOX_TOKEN` is invalid/missing. |
| V2 engine fails, falls back to legacy | `app/api/generate-route/route.ts` | Check server console for the V2 error. The API handler catches V2 failures and retries with legacy. |
| TypeScript error `Property X does not exist` | `lib/types.ts` | New field not added to the shared types. |

### Typed errors

All route generation failures use the `RouteGenerationError` class defined in `lib/errors.ts`. Errors have a machine-readable `code` (`RouteErrorCode`) and an optional `subCode` (`RouteErrorSubCode`) for finer granularity:

| Code | Sub-codes | Description |
|------|-----------|-------------|
| `NO_ROAD_NETWORK` | `OVERPASS_TIMEOUT`, `EMPTY_GRAPH`, `SOLVER_EMPTY` | No routable graph could be built or solved |
| `IMPOSSIBLE_ELEVATION` | -- | Requested D+ exceeds what the terrain can provide |
| `GEOCODING_FAILED` | -- | Address could not be resolved by Mapbox |
| `UNKNOWN` | -- | Unexpected server error |

### Useful console debugging

Add these temporarily to `lib/engine/index.ts` to inspect the V2 pipeline:

```typescript
// After graph build
console.log("[v2] graph nodes:", graph.nodes.size, "edges:", graph.edges.size);

// After solver
console.log("[v2] paths found:", paths.length, paths.map(p => ({
  distKm: p.distanceKm.toFixed(1),
  score: p.totalScore.toFixed(3),
})));
```

For the legacy engine, add to `lib/route-generator-legacy.ts`:

```typescript
// After candidate fetch
console.log("[legacy] candidates:", candidates.map(c => ({
  distKm: c.distanceKm.toFixed(1),
  ascendM: c.ascendM,
  score: c.totalScore.toFixed(3),
})));
```

Remove all debug `console.log` calls before committing.

---

## Architecture Quick-Reference

### Routing pipeline

The V2 engine is the primary route generator. The legacy engine serves as a fallback when V2 fails.

**V2 pipeline** (`lib/engine/`):

```
graph-builder.ts    Build OSM graph from Overpass data
      |
edge-scorer.ts      Score edges (surface, elevation, nature, quietness)
      |
orienteering-solver.ts   Beam-search solver with multi-child expansion
      |
pathfinder.ts       A* pathfinder for deterministic loop closure
      |
route-post-processor.ts  Geometry dedup, elevation enrichment, formatting
```

**Legacy pipeline** (`lib/route-generator-legacy.ts`):
- Uses GraphHopper (running) or OpenRouteService (cycling) for candidate route generation
- Scores candidates with `scoreRoute()` using profile-specific `ScoringWeights`

### Quick answers

| Question | Answer |
|----------|--------|
| Where is state stored? | `lib/store.ts` -- single flat Zustand store |
| Where does V2 route computation happen? | `lib/engine/` -- server-side |
| Where does legacy route computation happen? | `lib/route-generator-legacy.ts` -- server-side |
| Where is the API handler? | `app/api/generate-route/route.ts` -- V2-first, legacy-fallback |
| How does the map connect to the route? | `MapView.tsx` reads from Zustand store; `setCurrentRoute` triggers a `useEffect` |
| Where are session profiles defined? | `lib/session-profiles.ts` -- 16 profiles across 4 sports |
| Where is geocoding handled? | Mapbox Geocoding v5 in `components/sidebar/AddressInput.tsx` (autocomplete) and server-side `geocodeAddress()` |
| Where is rate limiting configured? | `lib/services/rate-limiter.ts` -- 20 req/min/IP on route generation |
| Where does GPX export happen? | Client-side in `lib/gpx-export.ts` -- no server round-trip needed |
| Where is feedback stored? | Browser `localStorage` (`lib/services/feedback-store.ts`) + server (`.data/feedbacks.json` via `POST /api/feedback`, 10/IP/hour) |
| Where are error types defined? | `lib/errors.ts` -- `RouteGenerationError` with typed codes and sub-codes |
| Why is Mapbox not SSR'd? | It uses browser-only APIs; disabled via `dynamic(..., { ssr: false })` in `ClientMapWrapper` |
| What external APIs are used? | Mapbox (map tiles + geocoding), Open-Meteo (elevation), Overpass (OSM data), GraphHopper/ORS (legacy routing) |
