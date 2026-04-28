# Free Tier Relaunch — Design Spec

**Date:** 2026-04-01
**Status:** Approved
**Branch:** `feat/freemium-relaunch`

## Goal

Remove all subscription and payment infrastructure. Make the app fully free with no feature gates. Optimize route computation between the browser Web Worker (light routes) and the server (heavy routes) to maintain exceptional path quality for all users.

---

## Section 1 — What gets removed

The entire subscription layer is deleted, not disabled:

| What | Files |
|---|---|
| Stripe SDK + plan config | `lib/stripe.ts` |
| Payment API routes | `app/api/payments/checkout/route.ts`, `webhook/route.ts`, `portal/route.ts` |
| Pro-only server endpoint | `app/api/refine-route/route.ts` |
| UI components | `components/ui/ProBadge.tsx`, `components/ui/UpgradePrompt.tsx` |
| Auth requirement | Removed from `app/api/generate-route/route.ts` |
| DB tier functions | `getUserTier`, `setUserTier` removed from `lib/db/index.ts` |
| Store tier state | `userTier: "free" | "pro"` field removed from `lib/store.ts` |
| UI gating in RouteResult | GPX gate, conversion banner, `isFree` checks removed from `components/sidebar/RouteResult.tsx` |
| Landing pricing section | `components/landing/PricingSection.tsx` replaced with "Free forever" section |

The `stripe` npm package is removed from `package.json`.

---

## Section 2 — Routing dispatch architecture

A `dispatchRoute()` function is added to `lib/engine/worker-client.ts`. It decides where the route runs based on the request parameters:

```
distance > 25 km  OR  elevation > 600 m D+
        │
       YES → POST /api/generate-route  (server, FULL_CONFIG, FilesystemCache)
        │
        NO → Web Worker (browser, LIGHT_CONFIG, IndexedDB)
```

**Thresholds** are exported constants in a new file `lib/engine/dispatch-config.ts`:
```ts
export const HEAVY_DISTANCE_KM = 25;
export const HEAVY_ELEVATION_M = 600;
```

Both paths return the same `RouteResult` shape. The store's `generateRoute` action calls `dispatchRoute()` — the rest of the app is unaware of which path was taken.

The server endpoint `/api/generate-route` requires no authentication.

---

## Section 3 — Solver config split

`lib/engine/tier-config.ts` is renamed to `lib/engine/solver-config.ts`. The `FREE_TIER` and `PRO_TIER` names are removed. Two new named exports replace them:

### `LIGHT_CONFIG` — browser Web Worker (routes ≤ 25 km and ≤ 600 m D+)

| Parameter | Value |
|---|---|
| solverConfigs | 2 seeds: 0°, 180° — beamWidth 30, temperature 0.25 |
| maxIterations | 800 |
| earlyK | 2 |
| lateK | 1 |
| maxCandidates | 2 |
| deduplicationMode | `"jaccard"` |
| enableFullScenic | `true` |

Jaccard deduplication and full scenic mode are kept enabled to preserve route quality even on light routes.

### `FULL_CONFIG` — server (heavy routes)

Identical to the current `PRO_TIER`:

| Parameter | Value |
|---|---|
| solverConfigs | 5 seeds: 0°, 72°, 144°, 216°, 288° — beamWidths 40–80 |
| maxIterations | 2000 |
| earlyK | 3 |
| lateK | 2 |
| maxCandidates | 6 |
| deduplicationMode | `"jaccard"` |
| enableFullScenic | `true` |

All callers of `FREE_TIER` / `PRO_TIER` are updated to use `LIGHT_CONFIG` / `FULL_CONFIG`.

---

## Section 4 — UI changes

### `components/sidebar/RouteResult.tsx`
- Remove `userTier` from store destructuring
- Remove `isFree` derived state
- Remove `showUpgradePrompt` state and `<UpgradePrompt>` render
- `handleDownloadGPX` calls `downloadGPX()` directly — no gate
- Remove Pro conversion banner ("3 parcours plus scéniques trouvés. Débloquer avec Pro.")
- Remove `<ProBadge>` from GPX button
- Remove imports of `ProBadge` and `UpgradePrompt`

### `components/landing/PricingSection.tsx`
- Replace pricing cards and Stripe buttons with a single "Gratuit, pour toujours" section
- Keep visual style consistent with the rest of the landing page

### `components/sidebar/SessionForm.tsx` / `SidebarContainer.tsx`
- Remove any auth-gating or tier-check UI if present

No other visual changes — the app looks and works identically, all features unlocked.

---

## Out of scope

- Auth system (`lib/auth.ts`, NextAuth routes) — kept as-is for now, even if no endpoint requires it
- Database `users.tier` column — left in schema, just not written to or read from application code
- `subscriptions` table — left in schema, just unused
- Feature flags (`lib/feature-flags/`) — untouched
