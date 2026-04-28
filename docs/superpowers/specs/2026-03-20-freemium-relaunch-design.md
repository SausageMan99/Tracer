# TrailForge Freemium Relaunch — Design Spec

## Overview

Transform TrailForge from a free anonymous tool into a production-ready freemium product with near-zero hosting costs for free users. The V2 routing engine moves client-side (Web Worker), Vercel becomes a thin proxy + auth + payments layer, and the product gets a design refresh with a mobile-first "Handcrafted Trail" identity.

**Goals:**
- Per-route compute cost near zero for free users (client-side engine)
- Feature-gated freemium model with Stripe subscriptions
- Organic, mobile-first design that feels human — not AI-generated
- Quality launch: ship engine + monetization + design together

## 1. System Architecture

```
┌─────────────────────────────────────────────────────┐
│                    BROWSER                           │
│                                                      │
│  ┌──────────┐   ┌──────────────┐   ┌──────────────┐ │
│  │ React UI │──▶│ Web Worker   │──▶│ IndexedDB    │ │
│  │ (Zustand) │  │ (V2 Engine)  │   │ (Graph Cache)│ │
│  └──────────┘   └──────────────┘   └──────────────┘ │
│       │              │                               │
│       │         ┌────┴────┐                          │
│       │         │ Tier    │                           │
│       │         │ Config  │                           │
│       │         │ free/pro│                           │
│       │         └─────────┘                           │
└───────┼──────────────┼──────────────────────────────┘
        │              │
   Auth/Pay      Overpass + Elevation
        │              │
┌───────┴──────────────┴──────────────────────────────┐
│              VERCEL (Thin API Layer)                  │
│                                                      │
│  /api/auth/*        → NextAuth (magic link + OAuth)  │
│  /api/payments/*    → Stripe webhooks + checkout     │
│  /api/proxy/osm     → Overpass proxy + edge cache    │
│  /api/proxy/elevation    → Open-Meteo proxy + edge cache  │
│  /api/refine-route  → Full engine (paid users only)  │
│  /api/feedback      → unchanged                      │
│  /api/waitlist      → unchanged                      │
└──────────────────────────────────────────────────────┘
```

**Key shifts:**
- V2 engine runs in a Web Worker in the browser
- Vercel becomes a thin proxy + auth + payments layer
- Graph and elevation data cached in IndexedDB (client-side, 7-day TTL)
- `/api/refine-route` reserved for paid users only (full beam search)
- Overpass/Open-Meteo proxied through edge-cached endpoints

**What stays on the server:**
- Auth (magic link emails, OAuth callbacks)
- Stripe webhooks and subscription management
- Data proxying with edge caching (Overpass, Open-Meteo)
- Premium route refinement (full engine, gated by auth)
- Feedback + waitlist (unchanged)

## 2. Engine Tier Configuration

Same TypeScript codebase runs in both browser and server, parameterized by tier.

| Parameter | Free Tier (Browser) | Pro Tier (Server) |
|-----------|-------------------|-------------------|
| Beam configs | 2 (0°, 180°) | 5 (0°, 72°, 144°, 216°, 288°) |
| Beam width | 20 | 40-80 |
| Max iterations | 800 | 2000 |
| Softmax K (early) | 2 | 3 |
| Softmax K (late) | 1 | 2 |
| Scenic scoring | Basic (nature only) | Full (nature + quietness + lit + safety) |
| Elevation precision | Open-Meteo 30m | Open-Meteo 30m (more candidates for best match) |
| Multi-candidate output | Best 1 route | Best 3 + alternatives |
| Deduplication | Simple distance check | Jaccard edge similarity |
| A* loop closure | Yes | Yes |
| GPX export | No | Yes |
| Estimated time | 1-3s | 5-10s |

**Conversion hook:** After a free route is generated, the UI shows:
> "3 more scenic routes found. Unlock with Pro."

**Engine isolation changes:**
1. **Extract shared utilities from `route-generator-legacy.ts`** into `lib/engine/utils.ts` (browser-safe, no `process.env`):
   - Pure functions: `haversineKm`, `computeAscent`, `scoreRoute`, `computeLoopScore`
   - Constants: `PAVED_SURFACES`, `UNPAVED_SURFACES`, `QUIET_HIGHWAY_TYPES`, `BUSY_HIGHWAY_TYPES`, `TRAIL_HIGHWAY_TYPES`
   - All engine modules (`graph-builder`, `edge-scorer`, `orienteering-solver`, `pathfinder`, `route-post-processor`, `index`) re-import from `lib/engine/utils.ts` instead of legacy
2. **Extract `fs`/`path`** from `graph-builder.ts` into a cache adapter interface (`FilesystemCache` for server, `IndexedDBCache` for browser)
3. **Extract data fetching** into a data fetcher interface:
   - `fetchElevations` → `DataFetcher.getElevations()` (`DirectFetcher` for server, `ProxyFetcher` for browser hitting `/api/proxy/elevation`)
   - `geocodeAddress` → stays in **main thread** (not in worker) since it needs `NEXT_PUBLIC_MAPBOX_TOKEN`. Main thread geocodes, then passes coordinates to worker.
   - Overpass fetch → `DataFetcher.getGraph()` (`DirectFetcher` for server, `ProxyFetcher` for browser hitting `/api/proxy/osm`)
4. Solver, pathfinder, edge-scorer, post-processor are pure computation — port as-is
5. **Parameterize solver** via a `TierConfig` interface passed to `solve()`:
   ```typescript
   interface TierConfig {
     solverConfigs: SolverConfig[]  // 2 for free, 5 for pro
     maxIterations: number          // 800 for free, 2000 for pro
     earlyK: number                 // 2 for free, 3 for pro
     lateK: number                  // 1 for free, 2 for pro
     enableFullScenic: boolean      // false for free, true for pro
     maxCandidates: number          // 1 for free, 6 for pro
     deduplicationMode: 'distance' | 'jaccard'
   }
   // Note: earlyK/lateK replace the per-config `expansionFactor` field.
   // The solver uses earlyK when progress < 60%, lateK when >= 60%.
   // Individual SolverConfig entries no longer carry expansionFactor.
   ```
6. **Free tier scoring**: When `enableFullScenic` is false, `deriveWeights()` sets `quietnessWeight = 0` and skips the `lit` bonus in `scoreEdges()`. Surface, elevation, and nature weights remain active.

## 3. Feature Gating & Monetization

### Free tier (no account needed)
- Unlimited basic route generation (client-side, zero compute cost)
- 4 sport types (running, road, gravel, MTB)
- All 14 session profiles
- Distance + elevation sliders
- Map view with route display
- Basic elevation profile chart

### Pro tier (~8-10 EUR/month or ~80 EUR/year)
- Server-refined scenic routes (full beam search, 3+ candidates)
- Multi-candidate selection (swap between alternatives)
- GPX export
- Scenic mode toggle (nature + quietness boost)
- Route history (save & revisit past routes)
- Advanced elevation matching (best-of-5 configs)
- Priority support

### Stripe implementation
- Stripe Checkout for subscription flow
- Stripe Customer Portal for self-service (cancel, upgrade, billing)
- Webhook handler for `checkout.session.completed`, `customer.subscription.updated/deleted`
- User tier stored in Vercel Postgres
- Feature gating at both UI level and API level (server routes check auth before processing)

### Pricing psychology
- Annual plan at ~30% discount
- Launch price (founding member rate) to convert existing waitlist
- Free trial of Pro (7 days) on signup

## 4. Auth System

### Stack: NextAuth.js v5 (Auth.js)

**Providers (ordered by priority):**
1. **Magic link (Email)** — primary. Zero friction, email relationship owned.
2. **Google OAuth** — secondary. One-click for users who prefer it.
3. **Strava OAuth** — future addition. Ship without it, add based on demand.

### Session flow
```
User clicks "Upgrade" or "Export GPX"
  → Modal: "Sign in to continue"
  → Email input + "Sign in with Google" button
  → Magic link email sent (or Google OAuth redirect)
  → Callback → JWT session created
  → Tier checked (free by default)
  → Stripe Checkout if upgrading to Pro
  → Session persists via HTTP-only cookie
```

### Key decisions
- **Lazy auth** — no sign-in needed for free tier. Auth triggered only on paid feature or route save.
- **No password** — magic link + OAuth only.
- **Database adapter** — Vercel Postgres (free tier: 256MB).
- **JWT session strategy** — `session: { strategy: "jwt" }` in NextAuth config. No `sessions` table needed. Session data stored in HTTP-only cookie.
- **Middleware protection** — `/api/refine-route` and `/api/routes/*` check session + Pro tier.

## 5. Design Refresh — Handcrafted Trail

### Visual identity
- **Palette**: Warm naturals — parchment (`#f2ece3`), dark earth (`#3d3529`), trail moss (`#7a6e5d`), forest accent (`#5a7247`)
- **Typography**: Monospace for body/UI (JetBrains Mono), serif for headlines. Field notes aesthetic.
- **Texture**: Subtle paper grain. No glassmorphism, no gradients.
- **Shapes**: Rounded, slightly imperfect. Pill buttons, hand-drawn-style dividers.
- **Photography**: Real trail photos (owned or Unsplash outdoor), never stock illustrations.
- **Animations**: Almost none. Only meaningful transitions (route drawing on map, subtle fade-ins). Remove GSAP, Lenis, Three.js from landing page.

### Copy voice
- First person, honest, direct: "I got tired of bad routes. So I built something better."
- French as primary language (French athlete audience)
- No buzzwords ("AI-powered", "revolutionary"). Just say what it does.
- Short sentences.

### Landing page structure (simplified)
1. **Hero** — One sentence + CTA. Real trail photo background. No video, no 3D canvas.
2. **The problem** — 2-3 pain points in first person. "I kept getting routes on busy roads."
3. **How it works** — 3 steps, minimal. Real generated route screenshot.
4. **The difference** — What makes scenic routing special. Side-by-side map comparison (generic vs TrailForge).
5. **Pricing** — Free vs Pro, clear and honest.
6. **Footer** — Minimal. "Built by a trail runner, for trail runners."

### What gets removed
- GSAP + Lenis smooth scroll
- Three.js terrain canvas
- Custom cursor
- Stacking feature cards animation
- Metrics counter section
- Manifesto section (replaced with shorter personal copy)
- `lib/animations.ts`, `lib/gsap-setup.ts`
- Bundle savings: ~600KB+ gzipped

### Mobile-first design

**Principles:**
- Design for 375px first, scale up
- Touch targets minimum 44px
- No hover-dependent interactions
- Primary actions in thumb zone (bottom of screen)

**App interface — Bottom sheet pattern:**
- Default: full-screen map with draggable bottom sheet (replaces sidebar drawer)
- Three snap points:
  - **Peek (10%)**: Route summary stats (distance, D+, score)
  - **Half (50%)**: Session form inputs (sport, distance, elevation, address)
  - **Full (90%)**: Route details, candidates, elevation profile, GPX export
- Generate button: large, fixed at bottom of half-sheet
- Route candidates: horizontal swipe in bottom sheet
- Elevation profile: sparkline in peek, full chart in full mode

**Desktop adaptation:**
- Bottom sheet becomes side panel (360px, left-anchored)
- Same component, different layout breakpoint

**Mobile optimizations:**
- Mapbox GL: disable pitch/rotation on mobile
- Lazy-load elevation profile on sheet expand
- Route generation feedback: pulsing circle on map at start point
- GPX export: native share sheet (`navigator.share()`)

## 6. Web Worker Communication Protocol

### Worker lifecycle
- Created once on app mount, reused for all route generations
- Lazy-loaded: worker bundle fetched on first route generation, not on page load
- Worker runs the solver pipeline (graph build → score edges → solve → post-process)
- Geocoding happens in **main thread** before dispatching to worker

### Message types (main thread ↔ worker)

```typescript
// Main thread → Worker
type WorkerRequest =
  | { type: 'generate'; id: string; params: {
      center: Coordinate       // already geocoded
      targetDistanceKm: number
      targetElevationM: number
      profileId: string
      tierConfig: TierConfig
    }}
  | { type: 'cancel'; id: string }

// Worker → Main thread
type WorkerResponse =
  | { type: 'progress'; id: string; stage: 'graph' | 'elevation' | 'scoring' | 'solving' | 'postprocess'; percent: number }
  | { type: 'result'; id: string; routes: RouteCandidate[] }
  | { type: 'error'; id: string; code: string; message: string }
```

### Progress reporting
The engine has 5 stages. The worker posts progress after each:
1. `graph` (0-30%) — Fetch/cache OSM data via proxy
2. `elevation` (30-45%) — Fetch/cache elevation data via proxy
3. `scoring` (45-50%) — Score all edges
4. `solving` (50-90%) — Beam search (post progress every 200 iterations)
5. `postprocess` (90-100%) — Build route candidates

### Cancellation
When user starts a new route while previous is computing, main thread sends `{ type: 'cancel', id }`. Worker checks a cancellation flag between solver iterations and aborts early.

### Serialization
- `RouteCandidate` is a plain object (no Maps, no class instances) — serializes via `structuredClone` natively
- The solver's internal `BeamState` linked list (parent pointers) stays inside the worker — only the final `RouteCandidate[]` crosses the boundary
- `EnrichedGraph` uses `Map<string, ...>` internally but is constructed inside the worker from proxy JSON responses (plain arrays/objects)

### Error propagation
`RouteGenerationError` instances are serialized as `{ code, subCode, message }` plain objects. Main thread reconstructs typed errors for UI display.

## 7. Proxy Endpoints — Detail

### `/api/proxy/osm`

**Request**: `GET /api/proxy/osm?lat=48.73&lng=-0.09&radius=5.6`

**Behavior**:
- Constructs Overpass query (same as current `graph-builder.ts`)
- Checks Vercel KV for cached response (key: `osm:{lat.toFixed(2)}_{lng.toFixed(2)}_{radius.toFixed(1)}`)
- On miss: fetches from Overpass API, stores in KV (7-day TTL)
- **Streaming**: Response is streamed to client via `ReadableStream` to handle large payloads
- **Size limit**: If Overpass response exceeds 10MB, the proxy returns a `413` with error `GRAPH_TOO_LARGE` and suggests reducing target distance
- Sets `Cache-Control: public, max-age=86400` for CDN edge caching (1 day)

**Why stream**: Vercel serverless response limit is 4.5MB for buffered responses. Streaming bypasses this. For graphs > 10MB (25km+ radius in dense urban areas), we reject rather than risk truncation.

### `/api/proxy/elevation`

**Request**: `POST /api/proxy/elevation` with body `{ coordinates: [lat, lng][] }`

**Behavior**:
- Batches coordinates to Open-Meteo API (100 per batch)
- Checks Vercel KV for cached batches (key: `elev:{hash(coordinates)}`)
- On miss: fetches from Open-Meteo, stores in KV (30-day TTL)
- Returns elevation array matching input order
- Sets `Cache-Control: public, max-age=604800` (7 days)

### `/api/refine-route` — API Contract

**Request**: `POST /api/refine-route`
- **Auth**: Required (Pro tier only, checked via session)
- **Body**: Same as current `/api/generate-route` request schema (address, targetDistanceKm, targetElevationM, profileId, scenicMode)
- **Behavior**: Runs the full V2 engine server-side (5 beam configs, full scenic scoring, Jaccard dedup, 6 candidates)
- Does NOT receive a client-generated route — it generates from scratch with full quality
- **Response**: Same `RouteCandidate[]` schema as current endpoint

**Why generate from scratch**: The full engine explores different search directions (5 seed bearings vs 2). Refining a client route would miss the routes that only appear with wider exploration.

## 8. Data Layer & Infrastructure

### Database: Vercel Postgres

```sql
-- users
CREATE TABLE users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  email TEXT UNIQUE NOT NULL,
  name TEXT,
  tier TEXT NOT NULL DEFAULT 'free', -- 'free' | 'pro'
  created_at TIMESTAMPTZ DEFAULT now()
);

-- accounts (NextAuth managed — includes required OAuth fields)
CREATE TABLE accounts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  type TEXT NOT NULL,
  provider TEXT NOT NULL,
  provider_account_id TEXT NOT NULL,
  refresh_token TEXT,
  access_token TEXT,
  expires_at BIGINT,
  token_type TEXT,
  scope TEXT,
  id_token TEXT,
  session_state TEXT
);

-- verification_tokens (required for magic link)
CREATE TABLE verification_tokens (
  identifier TEXT NOT NULL,
  token TEXT UNIQUE NOT NULL,
  expires TIMESTAMPTZ NOT NULL,
  PRIMARY KEY (identifier, token)
);

-- subscriptions
CREATE TABLE subscriptions (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  stripe_customer_id TEXT UNIQUE,
  stripe_subscription_id TEXT UNIQUE,
  status TEXT NOT NULL DEFAULT 'active', -- 'active' | 'canceled' | 'past_due'
  current_period_end TIMESTAMPTZ,
  plan TEXT NOT NULL -- 'monthly' | 'annual'
);

-- route_history (Pro only)
CREATE TABLE route_history (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID REFERENCES users(id),
  route_data JSONB NOT NULL, -- points, stats, config
  name TEXT,
  created_at TIMESTAMPTZ DEFAULT now()
);
```

### API endpoints

| Endpoint | Auth | Purpose | Compute |
|----------|------|---------|---------|
| `POST /api/auth/*` | — | NextAuth handlers | Minimal |
| `POST /api/payments/checkout` | Required | Create Stripe checkout session | Minimal |
| `POST /api/payments/webhook` | Stripe sig | Handle subscription events | Minimal |
| `GET /api/payments/portal` | Required | Stripe customer portal URL | Minimal |
| `GET /api/proxy/osm` | — | Overpass proxy + edge cache | Proxy only |
| `POST /api/proxy/elevation` | — | Open-Meteo proxy + edge cache | Proxy only |
| `POST /api/refine-route` | Pro only | Full beam-search refinement | Heavy (paid) |
| `POST /api/routes/save` | Pro only | Save route to history | Minimal |
| `GET /api/routes/history` | Pro only | List saved routes | Minimal |
| `POST /api/feedback` | — | Route feedback | Minimal |
| `POST /api/waitlist` | — | Email collection | Minimal |

### Cache hierarchy

```
Request → IndexedDB (browser, 7 days)
  miss → Vercel CDN edge cache
    miss → Vercel KV (server, 7-30 days)
      miss → External API (Overpass/Open-Meteo)
```

- OSM proxy: Vercel KV, 7-day TTL, keyed by `osm:{lat.toFixed(2)}_{lng.toFixed(2)}_{radius.toFixed(1)}`
- Elevation proxy: Vercel KV, 30-day TTL, keyed by coordinate batch hash
- Edge caching headers on proxy responses for CDN layer
- IndexedDB as first cache layer in browser (same key scheme as KV)
- IndexedDB storage management: LRU eviction when usage exceeds 50MB, tracked via metadata store
- Graph serialization: `Map` instances converted to plain arrays for storage, reconstructed on read

### Cost projection at scale

- Free users: proxy requests only (edge-cached, near-zero after warm-up)
- Pro users: 1 refine-route call per generation (~5-10s compute)
- 1000 free users × 5 routes/week = ~5000 proxy hits/week (mostly cached)
- 100 Pro users × 10 routes/week = ~1000 server compute calls/week
- Estimated Vercel cost: ~$20-30/mo at that scale
- Note: cache hit rates for OSM data depend on geographic locality. The `toFixed(2)` key (~1.1km granularity) means nearby users share cache entries. In a trail running app, geographic spread is expected — server KV cache serves as a warm-up layer, with the primary savings from client-side IndexedDB (per-user, always hits after first generation in an area).

### Timing expectations
- **Free tier, cache miss**: 5-12s (dominated by Overpass proxy round-trip)
- **Free tier, cache hit**: 1-3s (compute-only in browser)
- **Pro tier**: 8-15s (full server-side engine)
- The UI shows stage-by-stage progress via worker messages to keep the user informed during cold starts.

## 9. Migration Path

### Migration strategy
The existing `/api/generate-route` endpoint stays functional throughout development. It is only removed after the client-side engine + proxy endpoints are fully working and tested. No period where users lose route generation.

### What changes
- `lib/engine/*` — extract shared utils, add cache adapter + data fetcher interfaces, add `TierConfig` parameterization, remove `fs`/`path` imports
- `app/api/generate-route/` — kept during migration, eventually replaced by client-side engine + `/api/refine-route` (Pro only)
- New: `lib/engine/utils.ts` (pure functions extracted from `route-generator-legacy.ts`)
- New: `lib/engine/worker.ts` (Web Worker entry point)
- New: `lib/engine/adapters/` (cache adapters, data fetchers)
- New: `/api/proxy/osm`, `/api/proxy/elevation` endpoints
- New: `/api/auth/*`, `/api/payments/*` endpoints
- New: Vercel Postgres database setup
- Landing page: complete rewrite with Handcrafted Trail identity
- App UI: sidebar drawer → bottom sheet pattern
- Remove: `gsap`, `lenis`, `three`, `@react-three/fiber`, `@react-three/drei` dependencies
- Remove: `lib/animations.ts`, `lib/gsap-setup.ts`, custom cursor

### What stays
- Core engine logic (solver, pathfinder, edge-scorer, post-processor)
- Zustand store (extended with auth/tier state)
- Mapbox GL map component
- Feature flags (GrowthBook)
- Feedback + waitlist APIs
- Session profiles system

### Browser compatibility
Minimum targets: Chrome 80+, Safari 15+, Firefox 90+. All support Web Workers, IndexedDB, `structuredClone`, and `navigator.share()`.

## 10. New Dependencies

| Package | Purpose |
|---------|---------|
| `next-auth@5` | Auth (magic link + OAuth) |
| `@auth/pg-adapter` | NextAuth Postgres adapter |
| `stripe` | Stripe SDK (server) |
| `@stripe/stripe-js` | Stripe.js (client) |
| `@vercel/postgres` | Database client |
| `@vercel/kv` | KV store for proxy caching |
| `idb` | IndexedDB wrapper (typed, promise-based) |

### Removed dependencies
| Package | Reason |
|---------|--------|
| `gsap` | Animation library — removed for design refresh |
| `lenis` | Smooth scroll — removed |
| `three` | 3D rendering — removed |
| `@react-three/fiber` | React Three.js — removed |
| `@react-three/drei` | Three.js helpers — removed |
| `simplex-noise` | Used by Three.js terrain — removed |
