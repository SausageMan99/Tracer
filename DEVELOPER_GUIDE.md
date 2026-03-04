# Developer Guide

Everything you need to go from zero to a running local dev environment, understand the codebase conventions, and extend TrailForge with new profiles, sports, or scoring behaviour.

---

## Table of Contents

1. [Local Setup (from scratch)](#local-setup-from-scratch)
2. [Environment Variables](#environment-variables)
3. [Running the Strava Proxy](#running-the-strava-proxy)
4. [Code Standards](#code-standards)
5. [Tutorials](#tutorials)
   - [Add a new session profile](#add-a-new-session-profile)
   - [Add a new sport](#add-a-new-sport)
   - [Modify the scoring algorithm](#modify-the-scoring-algorithm)
   - [Add a new map layer](#add-a-new-map-layer)
6. [Debugging Guide](#debugging-guide)
7. [Architecture Quick-Reference](#architecture-quick-reference)

---

## Local Setup (from scratch)

### macOS

```bash
# 1. Install Node.js 22 via nvm
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.7/install.sh | bash
source ~/.zshrc   # or ~/.bashrc
nvm install 22
nvm use 22

# 2. Install Go 1.22
brew install go   # or download from https://go.dev/dl/

# 3. Clone the repo
git clone https://github.com/your-org/trailforge.git
cd trailforge

# 4. Install JavaScript dependencies
npm install

# 5. Configure environment (see section below)
cp .env.example .env.local
# Fill in NEXT_PUBLIC_MAPBOX_TOKEN, GRAPHHOPPER_API_KEY, ORS_API_KEY

# 6. Start the Strava proxy (optional, needed for Scenic mode)
go run ./cmd/proxy &

# 7. Start the dev server
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Linux (Ubuntu/Debian)

```bash
# Node.js 22
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash -
sudo apt-get install -y nodejs

# Go 1.22
wget https://go.dev/dl/go1.22.0.linux-amd64.tar.gz
sudo tar -C /usr/local -xzf go1.22.0.linux-amd64.tar.gz
echo 'export PATH=$PATH:/usr/local/go/bin' >> ~/.bashrc
source ~/.bashrc

# Then follow steps 3–7 from macOS above
```

---

## Environment Variables

All variables are loaded from `.env.local` (gitignored). Never commit `.env.local`.

| Variable | Required | Example | Description |
|----------|----------|---------|-------------|
| `NEXT_PUBLIC_MAPBOX_TOKEN` | Yes | `pk.eyJ1…` | Public Mapbox token — safe to expose to the browser. Must start with `pk.`. |
| `GRAPHHOPPER_API_KEY` | Yes | `abc123…` | GraphHopper Directions API key. Used only server-side. |
| `ORS_API_KEY` | Yes | `5b3ce…` | OpenRouteService API key. Used only server-side. |

> **Security note:** `NEXT_PUBLIC_*` variables are embedded in the client bundle. Do not prefix server-side secrets with `NEXT_PUBLIC_`.

### Getting free API keys

- **Mapbox:** Create an account at [account.mapbox.com](https://account.mapbox.com). The default public token works for development. For production, create a token scoped to your domain.
- **GraphHopper:** Register at [graphhopper.com/dashboard](https://graphhopper.com/dashboard). The free tier allows 500 route requests/day, which is sufficient for development.
- **OpenRouteService:** Register at [openrouteservice.org/dev](https://openrouteservice.org/dev/#/login). The free tier allows 2 000 requests/day.

---

## Running the Strava Proxy

The Go proxy handles Strava CloudFront cookie authentication. It is only needed if you want to test Scenic mode with real Strava heatmap tiles.

### Starting the proxy

```bash
go run ./cmd/proxy
# Listening on http://localhost:8080
```

### Renewing Strava cookies

CloudFront cookies expire roughly every 3–4 weeks. When heatmap tiles start returning 403:

1. Log in to [strava.com](https://www.strava.com) in your browser
2. Open DevTools → Network tab → filter for `heatmap`
3. Click on any heatmap tile request and copy all `Cookie:` headers
4. Update the cookie values in `cmd/proxy/main.go` (look for `CloudFront-*` cookies)
5. Restart the proxy

Detailed instructions and cookie format are documented in [docs/integrations/strava-heatmap.md](docs/integrations/strava-heatmap.md).

### If the proxy is not running

The app works without the proxy. Scenic mode still functions — heatmap tiles will fail silently (returning 502), and the popularity score for all routes will fall back to the neutral value `0.5`, meaning routes are not boosted by popularity.

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
 * @throws {Error} When the thrown message is `"SOME_CODE"` and what causes it.
 *
 * @example
 * const result = myFunction("example");
 * // result === 42
 */
export function myFunction(foo: string): number { ... }
```

Rules:
- Write JSDoc in **English** (code is English; French is for the user-facing UI only)
- Document the **"why"**, not the "what" — the code shows the what; the comment explains the reason
- Always document `@throws` if the function can throw
- Include `@example` for any function with non-obvious usage

### React components

- Use the `"use client"` directive only when the component uses browser APIs (`useState`, `useEffect`, `useRef`, Mapbox, etc.). Server components are the default in the App Router.
- Do not use `React.FC` — use named function declarations with explicit prop interfaces.
- Prop interfaces are defined immediately above the component and are always named `<ComponentName>Props`.

### Styling

- Tailwind CSS utility classes only. No `.css` files, no CSS-in-JS.
- Inline `style={{}}` props are acceptable for dynamic values that Tailwind cannot express (e.g. `backgroundColor: accent`).
- Color variables: use the design system values defined in `tailwind.config.ts`. The sidebar uses `#0F172A` (bg), `#1E293B` (card), `#F8FAFC` (text), `#64748B` (muted), `#0EA5E9` (blue accent).

### File organisation

- One React component per file, named identically to the file (`MapView.tsx` exports `MapView`).
- Library files in `lib/` are plain TypeScript modules (no React). They can be imported from both API routes and components.
- No barrel files (`index.ts`). Import directly from the source file.

---

## Tutorials

### Add a new session profile

A session profile defines the sport, display name, scoring weights, and routing parameters for a specific workout type. Adding a profile takes ~10 lines.

**File to edit:** `lib/session-profiles.ts`

1. Add a new object to the `SESSION_PROFILES` array:

```typescript
{
  id: "running_fartlek",
  name: "Fartlek",
  sport: "running",
  sessionType: "speed",
  targetDistanceKm: 8,
  targetElevationM: 100,
  weights: {
    elevation: 0.15,   // Elevation is not the focus
    distance: 0.40,    // Distance accuracy matters more
    surface: 0.25,     // Good surface for speed work
    loop: 0.20,        // Prefer loops
  },
  graphhopperProfile: "foot",
},
```

2. That's it. `PROFILES_BY_ID` and `PROFILES_BY_SPORT` are derived automatically. The new profile will appear in the `SessionForm` dropdown under the "Running" group.

**Scoring weight guidelines:**
- Weights should sum to ≈ 1.0 (they don't need to be exact — the algorithm normalises)
- `elevation` weight: high for hills/climb sessions, low for speed/endurance
- `distance` weight: high when hitting the exact target matters (intervals), low for exploration
- `surface` weight: high for trail/gravel (terrain quality matters), low for road (all roads are similar)
- `loop` weight: keep at 0.20 unless there is a specific reason to prefer out-and-back

---

### Add a new sport

Adding a sport requires changes in four places:

**1. `lib/types.ts` — extend the `Sport` type:**

```typescript
export type Sport = "running" | "cycling_road" | "cycling_gravel" | "cycling_mtb" | "hiking";
```

**2. `lib/session-profiles.ts` — add profiles for the new sport and update `SPORT_LABELS`:**

```typescript
export const SPORT_LABELS: Record<Sport, string> = {
  // existing entries...
  hiking: "Randonnée",
};
```

**3. `lib/route-generator.ts` — add routing logic for the new sport:**

For a sport that uses GraphHopper, add the profile mapping in `fetchCandidateRoutes()`:

```typescript
const ghProfile = profile.graphhopperProfile ?? "foot";
// GraphHopper supports: foot, hike, bike, mtb, racingbike, car, etc.
```

For a sport that uses ORS, add the profile mapping in `fetchCandidateRoutesORS()`:

```typescript
const orsProfile: Record<string, string> = {
  cycling_road: "cycling-road",
  cycling_gravel: "cycling-regular",
  cycling_mtb: "cycling-mountain",
  hiking: "foot-hiking",   // ← add here
};
```

**4. `components/sidebar/SessionForm.tsx` — no changes needed** if you used a `Sport` value already listed in `PROFILES_BY_SPORT`. The form groups profiles by sport dynamically.

---

### Modify the scoring algorithm

The scoring function is `scoreRoute()` in `lib/route-generator.ts` (around line 320).

**To change the Gaussian decay width** (how forgiving the score is for distance/elevation misses):

```typescript
// Current: ±20% of target gives ~0.61, ±40% gives ~0.14
const sigma = 0.20 * target;

// To make it more forgiving (±30% gives ~0.61):
const sigma = 0.30 * target;
```

**To add a new scoring component** (e.g. route freshness based on how recently this area was visited):

1. Add the new score to the `RouteCandidate` type in `lib/types.ts`:
   ```typescript
   freshnessScore: number;
   ```

2. Compute it in `scoreRoute()` and include it in the weighted sum:
   ```typescript
   const freshnessScore = computeFreshness(candidate.points, recentRoutes);
   const totalScore = (
     weights.elevation * elevationMatch +
     weights.distance  * distanceMatch +
     weights.surface   * surfaceQuality +
     weights.loop      * loopQuality +
     weights.freshness * freshnessScore
   );
   ```

3. Add `freshness` to `ScoringWeights` in `lib/types.ts` and update each profile's weights in `lib/session-profiles.ts`.

**To change the Strava popularity weight:**

The popularity boost is hardcoded at `0.25` in `scoreRoute()`. Search for `HEATMAP_WEIGHT` or `0.25 *` in `lib/route-generator.ts` and change the constant.

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

**Important:** always guard `getLayer`/`getSource` calls with null checks — layer removal order matters in Mapbox (remove layers before sources).

---

## Debugging Guide

| Symptom | Where to look | Likely cause |
|---------|---------------|--------------|
| "Aucun réseau routier détecté" | `lib/route-generator.ts:fetchCandidateRoutes` | GraphHopper cannot snap start coord to a road; try a more central address |
| "Adresse introuvable" | `lib/route-generator.ts:geocodeAddress` | Nominatim returned 0 results; check spelling or try a more specific address |
| "Le D+ demandé n'est pas atteignable" | `lib/route-generator.ts` elevation check | The terrain around the start point is too flat for the requested D+ |
| Map tiles are blank | `app/api/heatmap-tile/route.ts` | Go proxy not running or Strava cookies expired |
| Heatmap tiles return 502 | `app/api/heatmap-tile/route.ts` → port 8080 | Go proxy not started; run `go run ./cmd/proxy` |
| Route candidates all score < 30% | `lib/route-generator.ts:scoreRoute` | Scoring weights may be mismatched for the area (check surface coverage) |
| GPX file rejected by Garmin | `lib/gpx-export.ts` | Missing `<ele>` or `<time>` on track points |
| TypeScript error `Property X does not exist` | `lib/types.ts` | New field not added to the shared types |
| Overpass query times out | `lib/route-generator.ts:fetchSurfaceData` | Route bounding box too large; route is likely > 50 km |
| Nominatim autocomplete not showing | `components/sidebar/AddressInput.tsx` | Query is < 3 characters, or Nominatim rate-limited (max 1 req/s) |

### Useful console debugging

Add these temporarily to `lib/route-generator.ts` to inspect the pipeline:

```typescript
// After geocoding
console.log("[debug] geocoded:", coords);

// After candidate fetch
console.log("[debug] candidates:", candidates.map(c => ({
  distKm: c.distanceKm.toFixed(1),
  ascendM: c.ascendM,
  score: c.totalScore.toFixed(3),
})));

// After Overpass
console.log("[debug] surface data elements:", surfaceData.elements.length);
```

Remove all debug `console.log` calls before committing.

### Checking API responses

In development, the GraphHopper and ORS API responses can be inspected by temporarily logging them in `route-generator.ts`:

```typescript
// In fetchCandidateRoutes()
const data: GraphHopperResponse = await res.json();
console.log("[GH] paths[0]:", JSON.stringify(data.paths[0], null, 2));
```

ORS responses follow the GeoJSON `FeatureCollection` format — each feature's geometry coordinates include `[lng, lat, elevation]`.

---

## Architecture Quick-Reference

| Question | Answer |
|----------|--------|
| Where is state stored? | `lib/store.ts` — single flat Zustand store |
| Where does route computation happen? | `lib/route-generator.ts` — server-side only |
| How does Mapbox connect to the route? | `MapView.tsx` reads from Zustand; `setCurrentRoute` triggers a `useEffect` |
| Where are scoring weights defined? | `lib/session-profiles.ts` — per profile |
| How are new profiles picked up by the UI? | Automatically — `SessionForm` iterates `PROFILES_BY_SPORT` |
| What is the CORS proxy for? | `app/api/heatmap-tile` proxies Strava tiles to avoid browser CORS blocking on `:8080` |
| Where does GPX export happen? | Client-side in `lib/gpx-export.ts` — no server round-trip needed |
| Why is Mapbox not SSR'd? | It uses browser-only APIs; disabled via `dynamic(…, { ssr: false })` in `ClientMapWrapper` |
| How are Strava cookies managed? | In the Go proxy (`cmd/proxy/`); renewed manually every 3–4 weeks |
| Where is feedback stored? | Browser `localStorage` via `lib/feedback-store.ts` |
