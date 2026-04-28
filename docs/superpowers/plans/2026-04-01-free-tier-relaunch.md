# Free Tier Relaunch Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remove all subscription/payment infrastructure and add smart client-vs-server dispatch so every user gets exceptional route quality for free.

**Architecture:** A new `isHeavyRoute()` predicate decides execution path — heavy routes (>25 km or >600 m D+) go to the server with `FULL_CONFIG` (5 seeds, 2000 iterations, 6 candidates), light routes run in the browser Web Worker with `LIGHT_CONFIG` (2 seeds, 800 iterations, 2 candidates, jaccard dedup). All Stripe/auth/gating code is deleted entirely.

**Tech Stack:** Next.js 14, TypeScript, Zustand, Vitest, Web Worker API

---

## File Map

| Action | Path | Responsibility |
|---|---|---|
| Create | `lib/engine/solver-config.ts` | LIGHT_CONFIG, FULL_CONFIG, SolverConfig, TierConfig interfaces |
| Create | `lib/engine/dispatch-config.ts` | HEAVY_DISTANCE_KM, HEAVY_ELEVATION_M, isHeavyRoute() |
| Create | `tests/solver-config.test.ts` | Unit tests for solver-config exports |
| Create | `tests/dispatch-config.test.ts` | Unit tests for isHeavyRoute() |
| Modify | `lib/engine/worker-types.ts` | Import TierConfig from solver-config |
| Modify | `lib/engine/worker-client.ts` | Import TierConfig from solver-config |
| Modify | `lib/engine/worker.ts` | Dynamic import from solver-config |
| Modify | `lib/engine/orienteering-solver.ts` | Import FULL_CONFIG/TierConfig from solver-config |
| Modify | `lib/engine/index.ts` | Import FULL_CONFIG from solver-config |
| Modify | `lib/store.ts` | Remove userTier, add dispatch logic, rename action |
| Modify | `components/sidebar/SessionForm.tsx` | Rename generateRouteClientSide → generateRoute |
| Modify | `components/sidebar/RouteResult.tsx` | Remove tier gating, ProBadge, UpgradePrompt |
| Modify | `components/landing/PricingSection.tsx` | Replace Pro card with "Free forever" content |
| Modify | `lib/db/index.ts` | Remove getUserTier, setUserTier |
| Delete | `lib/engine/tier-config.ts` | Replaced by solver-config.ts |
| Delete | `lib/stripe.ts` | Stripe removed |
| Delete | `app/api/payments/checkout/route.ts` | Stripe removed |
| Delete | `app/api/payments/webhook/route.ts` | Stripe removed |
| Delete | `app/api/payments/portal/route.ts` | Stripe removed |
| Delete | `app/api/refine-route/route.ts` | Pro-only endpoint removed |
| Delete | `components/ui/ProBadge.tsx` | No longer needed |
| Delete | `components/ui/UpgradePrompt.tsx` | No longer needed |
| Delete | `tests/tier-config.test.ts` | Replaced by solver-config.test.ts |

---

## Task 1: Create solver-config.ts (replaces tier-config.ts)

**Files:**
- Create: `lib/engine/solver-config.ts`
- Create: `tests/solver-config.test.ts`
- Delete: `tests/tier-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/solver-config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { LIGHT_CONFIG, FULL_CONFIG } from "../lib/engine/solver-config";

describe("LIGHT_CONFIG", () => {
  it("has 2 solver configs", () => {
    expect(LIGHT_CONFIG.solverConfigs).toHaveLength(2);
  });
  it("seeds are 0° and 180°", () => {
    expect(LIGHT_CONFIG.solverConfigs[0].seedBearing).toBe(0);
    expect(LIGHT_CONFIG.solverConfigs[1].seedBearing).toBe(180);
  });
  it("maxIterations is 800", () => {
    expect(LIGHT_CONFIG.maxIterations).toBe(800);
  });
  it("maxCandidates is 2", () => {
    expect(LIGHT_CONFIG.maxCandidates).toBe(2);
  });
  it("deduplicationMode is jaccard", () => {
    expect(LIGHT_CONFIG.deduplicationMode).toBe("jaccard");
  });
  it("enableFullScenic is true", () => {
    expect(LIGHT_CONFIG.enableFullScenic).toBe(true);
  });
});

describe("FULL_CONFIG", () => {
  it("has 5 solver configs", () => {
    expect(FULL_CONFIG.solverConfigs).toHaveLength(5);
  });
  it("maxIterations is 2000", () => {
    expect(FULL_CONFIG.maxIterations).toBe(2000);
  });
  it("maxCandidates is 6", () => {
    expect(FULL_CONFIG.maxCandidates).toBe(6);
  });
  it("deduplicationMode is jaccard", () => {
    expect(FULL_CONFIG.deduplicationMode).toBe("jaccard");
  });
  it("enableFullScenic is true", () => {
    expect(FULL_CONFIG.enableFullScenic).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dubosqclement/Tracer && npx vitest run tests/solver-config.test.ts
```
Expected: FAIL with "Cannot find module '../lib/engine/solver-config'"

- [ ] **Step 3: Create solver-config.ts**

Create `lib/engine/solver-config.ts`:
```ts
// ── Solver configurations — no subscription tiers, just complexity levels ──────

export interface SolverConfig {
  readonly beamWidth: number;
  readonly temperature: number;
  readonly seedBearing: number;
}

export interface TierConfig {
  readonly solverConfigs: readonly SolverConfig[];
  readonly maxIterations: number;
  readonly earlyK: number;
  readonly lateK: number;
  readonly enableFullScenic: boolean;
  readonly maxCandidates: number;
  readonly deduplicationMode: "distance" | "jaccard";
}

/**
 * Light config — runs in the browser Web Worker.
 * Used for routes ≤ 25 km and ≤ 600 m D+.
 */
export const LIGHT_CONFIG: TierConfig = {
  solverConfigs: [
    { beamWidth: 30, temperature: 0.25, seedBearing: 0 },
    { beamWidth: 30, temperature: 0.25, seedBearing: 180 },
  ],
  maxIterations: 800,
  earlyK: 2,
  lateK: 1,
  enableFullScenic: true,
  maxCandidates: 2,
  deduplicationMode: "jaccard",
};

/**
 * Full config — runs server-side.
 * Used for heavy routes (> 25 km or > 600 m D+).
 */
export const FULL_CONFIG: TierConfig = {
  solverConfigs: [
    { beamWidth: 60, temperature: 0.2,  seedBearing: 0 },
    { beamWidth: 40, temperature: 0.3,  seedBearing: 72 },
    { beamWidth: 80, temperature: 0.15, seedBearing: 144 },
    { beamWidth: 50, temperature: 0.25, seedBearing: 216 },
    { beamWidth: 70, temperature: 0.2,  seedBearing: 288 },
  ],
  maxIterations: 2000,
  earlyK: 3,
  lateK: 2,
  enableFullScenic: true,
  maxCandidates: 6,
  deduplicationMode: "jaccard",
};
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/dubosqclement/Tracer && npx vitest run tests/solver-config.test.ts
```
Expected: PASS (13 tests)

- [ ] **Step 5: Update all imports across the engine**

In `lib/engine/worker-types.ts`, replace:
```ts
import type { TierConfig } from "./tier-config";
```
with:
```ts
import type { TierConfig } from "./solver-config";
```

In `lib/engine/worker-client.ts`, replace:
```ts
import type { TierConfig } from "./tier-config";
```
with:
```ts
import type { TierConfig } from "./solver-config";
```

In `lib/engine/worker.ts` line 63, replace:
```ts
tierConfig: import("./tier-config").TierConfig;
```
with:
```ts
tierConfig: import("./solver-config").TierConfig;
```

In `lib/engine/orienteering-solver.ts` line 4, replace:
```ts
import { type TierConfig, type SolverConfig, PRO_TIER } from "./tier-config";
```
with:
```ts
import { type TierConfig, type SolverConfig, FULL_CONFIG } from "./solver-config";
```

In `lib/engine/orienteering-solver.ts` line 609, replace:
```ts
  tierConfig: TierConfig = PRO_TIER
```
with:
```ts
  tierConfig: TierConfig = FULL_CONFIG
```

In `lib/engine/index.ts` lines 14-15, replace:
```ts
import type { TierConfig } from "./tier-config";
import { PRO_TIER } from "./tier-config";
```
with:
```ts
import type { TierConfig } from "./solver-config";
import { FULL_CONFIG } from "./solver-config";
```

In `lib/engine/index.ts` line 26, replace:
```ts
  tierConfig: TierConfig = PRO_TIER,
```
with:
```ts
  tierConfig: TierConfig = FULL_CONFIG,
```

In `lib/store.ts` line 15, replace:
```ts
import { FREE_TIER } from "./engine/tier-config";
```
with:
```ts
import { LIGHT_CONFIG } from "./engine/solver-config";
```

Also in `lib/store.ts` line 174, replace:
```ts
          tierConfig: FREE_TIER,
```
with:
```ts
          tierConfig: LIGHT_CONFIG,
```

- [ ] **Step 6: Delete tier-config.ts and old test**

```bash
rm /Users/dubosqclement/Tracer/lib/engine/tier-config.ts
rm /Users/dubosqclement/Tracer/tests/tier-config.test.ts
```

- [ ] **Step 7: Run full test suite to verify no broken imports**

```bash
cd /Users/dubosqclement/Tracer && npx vitest run
```
Expected: all existing tests pass, no "Cannot find module" errors

- [ ] **Step 8: Commit**

```bash
cd /Users/dubosqclement/Tracer && git add -A && git commit -m "refactor: rename tier-config to solver-config, replace FREE/PRO_TIER with LIGHT/FULL_CONFIG"
```

---

## Task 2: Add dispatch-config.ts

**Files:**
- Create: `lib/engine/dispatch-config.ts`
- Create: `tests/dispatch-config.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/dispatch-config.test.ts`:
```ts
import { describe, it, expect } from "vitest";
import { isHeavyRoute, HEAVY_DISTANCE_KM, HEAVY_ELEVATION_M } from "../lib/engine/dispatch-config";

describe("isHeavyRoute", () => {
  it("returns false for light distance and elevation", () => {
    expect(isHeavyRoute(10, 300)).toBe(false);
  });
  it("returns true when distance exceeds threshold", () => {
    expect(isHeavyRoute(HEAVY_DISTANCE_KM + 0.1, 0)).toBe(true);
  });
  it("returns true when elevation exceeds threshold", () => {
    expect(isHeavyRoute(10, HEAVY_ELEVATION_M + 1)).toBe(true);
  });
  it("returns true when both exceed thresholds", () => {
    expect(isHeavyRoute(30, 800)).toBe(true);
  });
  it("returns false at exactly the distance boundary", () => {
    expect(isHeavyRoute(HEAVY_DISTANCE_KM, 0)).toBe(false);
  });
  it("returns false at exactly the elevation boundary", () => {
    expect(isHeavyRoute(0, HEAVY_ELEVATION_M)).toBe(false);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

```bash
cd /Users/dubosqclement/Tracer && npx vitest run tests/dispatch-config.test.ts
```
Expected: FAIL with "Cannot find module '../lib/engine/dispatch-config'"

- [ ] **Step 3: Create dispatch-config.ts**

Create `lib/engine/dispatch-config.ts`:
```ts
// ── Route dispatch thresholds ─────────────────────────────────────────────────
// Routes exceeding either threshold are sent to the server (FULL_CONFIG).
// Routes below both thresholds run in the browser Web Worker (LIGHT_CONFIG).

export const HEAVY_DISTANCE_KM = 25;
export const HEAVY_ELEVATION_M = 600;

/**
 * Returns true when a route request should be handled server-side.
 * Threshold: distance > 25 km OR elevation > 600 m D+.
 */
export function isHeavyRoute(distanceKm: number, elevationM: number): boolean {
  return distanceKm > HEAVY_DISTANCE_KM || elevationM > HEAVY_ELEVATION_M;
}
```

- [ ] **Step 4: Run test to verify it passes**

```bash
cd /Users/dubosqclement/Tracer && npx vitest run tests/dispatch-config.test.ts
```
Expected: PASS (6 tests)

- [ ] **Step 5: Commit**

```bash
cd /Users/dubosqclement/Tracer && git add lib/engine/dispatch-config.ts tests/dispatch-config.test.ts && git commit -m "feat: add route dispatch config with isHeavyRoute() predicate"
```

---

## Task 3: Update store — smart dispatch, remove userTier

**Files:**
- Modify: `lib/store.ts`
- Modify: `components/sidebar/SessionForm.tsx`

- [ ] **Step 1: Update lib/store.ts**

Open `lib/store.ts`. Make the following changes:

**a) Add import for dispatch-config at the top (after existing imports):**
```ts
import { isHeavyRoute } from "./engine/dispatch-config";
```

**b) Remove the `userTier` field from the `AppStore` interface (lines 86-87):**
```ts
  /** Current user subscription tier — drives TierConfig selection */
  userTier: "free" | "pro";
```
Delete both lines.

**c) Rename `generateRouteClientSide` to `generateRoute` in the interface (line 92):**
```ts
  generateRouteClientSide: (center: Coordinate) => Promise<void>;
```
Replace with:
```ts
  generateRoute: (center: Coordinate) => Promise<void>;
```

**d) Remove `userTier: "free"` from the initial store state (line 122):**
```ts
  userTier: "free",
```
Delete this line.

**e) Replace the entire `generateRouteClientSide` implementation (lines 164-199) with:**
```ts
  generateRoute: async (center: Coordinate) => {
    const state = get();
    set({ status: "loading", generationProgress: null, errorMessage: null });

    try {
      let generatedRoute: GeneratedRoute;

      if (isHeavyRoute(state.targetDistanceKm, state.targetElevationM)) {
        // Heavy route — server-side with FULL_CONFIG
        const res = await fetch("/api/generate-route", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            address: state.address,
            profileId: state.selectedProfileId,
            targetDistanceKm: state.targetDistanceKm,
            targetElevationM: state.targetElevationM,
            scenicMode: state.scenicMode || undefined,
          }),
        });
        const data = await res.json() as { success: boolean; route?: GeneratedRoute; error?: string };
        if (!data.success || !data.route) {
          throw new Error(data.error ?? "Erreur lors de la génération du parcours.");
        }
        generatedRoute = data.route;
      } else {
        // Light route — client-side Web Worker with LIGHT_CONFIG
        const routes = await getWorkerClient().generate(
          {
            center,
            targetDistanceKm: state.targetDistanceKm,
            targetElevationM: state.targetElevationM,
            profileId: state.selectedProfileId,
            tierConfig: LIGHT_CONFIG,
            scenicMode: state.scenicMode,
          },
          (stage, percent) => set({ generationProgress: { stage, percent } })
        );
        if (routes.length === 0) throw new Error("Aucun parcours trouvé.");
        const profile = PROFILES_BY_ID.get(state.selectedProfileId)!;
        generatedRoute = { best: routes[0], candidates: routes, startCoordinate: center, profile };
      }

      set({
        status: "success",
        currentRoute: generatedRoute,
        candidateIndex: 0,
        generationProgress: null,
      });
    } catch (e) {
      set({
        status: "error",
        errorMessage: e instanceof Error ? e.message : "La génération du parcours a échoué.",
        generationProgress: null,
      });
    }
  },
```

- [ ] **Step 2: Update SessionForm.tsx**

Open `components/sidebar/SessionForm.tsx`. There are 3 references to `generateRouteClientSide` — all on lines near 149, 227, 236. Replace all three occurrences:

```ts
generateRouteClientSide,
```
→
```ts
generateRoute,
```

```ts
    await generateRouteClientSide(center);
```
→
```ts
    await generateRoute(center);
```

```ts
  }, [address, currentProfile, isLoading, setSidebarOpen, generateRouteClientSide]);
```
→
```ts
  }, [address, currentProfile, isLoading, setSidebarOpen, generateRoute]);
```

- [ ] **Step 3: Check for any remaining references to userTier or generateRouteClientSide**

```bash
cd /Users/dubosqclement/Tracer && grep -rn "userTier\|generateRouteClientSide" --include="*.ts" --include="*.tsx" . --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git
```
Expected: no output (zero matches)

- [ ] **Step 4: Run tests**

```bash
cd /Users/dubosqclement/Tracer && npx vitest run
```
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/dubosqclement/Tracer && git add lib/store.ts components/sidebar/SessionForm.tsx && git commit -m "feat: replace client-only generation with smart server/worker dispatch"
```

---

## Task 4: Delete payment infrastructure

**Files:**
- Delete: `app/api/payments/checkout/route.ts`
- Delete: `app/api/payments/webhook/route.ts`
- Delete: `app/api/payments/portal/route.ts`
- Delete: `app/api/refine-route/route.ts`
- Delete: `lib/stripe.ts`
- Modify: `package.json`

- [ ] **Step 1: Delete payment API routes and Stripe files**

```bash
rm -rf /Users/dubosqclement/Tracer/app/api/payments
rm -rf /Users/dubosqclement/Tracer/app/api/refine-route
rm /Users/dubosqclement/Tracer/lib/stripe.ts
```

- [ ] **Step 2: Remove stripe from package.json**

Open `package.json`. Find and delete the line:
```json
    "stripe": "...",
```
(exact version may vary — delete the entire line including trailing comma)

- [ ] **Step 3: Remove stripe from node_modules**

```bash
cd /Users/dubosqclement/Tracer && npm uninstall stripe
```
Expected: stripe removed from package.json and node_modules

- [ ] **Step 4: Verify no remaining stripe imports**

```bash
cd /Users/dubosqclement/Tracer && grep -rn "from.*stripe\|require.*stripe" --include="*.ts" --include="*.tsx" . --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git
```
Expected: no output

- [ ] **Step 5: Run tests**

```bash
cd /Users/dubosqclement/Tracer && npx vitest run
```
Expected: all tests pass

- [ ] **Step 6: Commit**

```bash
cd /Users/dubosqclement/Tracer && git add -A && git commit -m "chore: remove Stripe, payment routes, and refine-route endpoint"
```

---

## Task 5: Remove getUserTier / setUserTier from DB utils

**Files:**
- Modify: `lib/db/index.ts`

- [ ] **Step 1: Open lib/db/index.ts and remove tier functions**

Find and delete the `getUserTier` function:
```ts
export async function getUserTier(userId: string): Promise<"free" | "pro"> {
  // ...
  const result = await sql`SELECT tier FROM users WHERE id = ${userId}`;
  return (result.rows[0]?.tier as "free" | "pro") ?? "free";
}
```

Find and delete the `setUserTier` function:
```ts
export async function setUserTier(userId: string, tier: "free" | "pro"): Promise<void> {
  // ...
  await sql`UPDATE users SET tier = ${tier} WHERE id = ${userId}`;
}
```

- [ ] **Step 2: Verify no remaining references**

```bash
cd /Users/dubosqclement/Tracer && grep -rn "getUserTier\|setUserTier" --include="*.ts" --include="*.tsx" . --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git
```
Expected: no output

- [ ] **Step 3: Run tests**

```bash
cd /Users/dubosqclement/Tracer && npx vitest run
```
Expected: all tests pass

- [ ] **Step 4: Commit**

```bash
cd /Users/dubosqclement/Tracer && git add lib/db/index.ts && git commit -m "chore: remove getUserTier and setUserTier from DB utils"
```

---

## Task 6: Remove UI gating — RouteResult, ProBadge, UpgradePrompt

**Files:**
- Delete: `components/ui/ProBadge.tsx`
- Delete: `components/ui/UpgradePrompt.tsx`
- Modify: `components/sidebar/RouteResult.tsx`

- [ ] **Step 1: Delete the Pro UI components**

```bash
rm /Users/dubosqclement/Tracer/components/ui/ProBadge.tsx
rm /Users/dubosqclement/Tracer/components/ui/UpgradePrompt.tsx
```

- [ ] **Step 2: Update RouteResult.tsx — remove all tier gating**

Open `components/sidebar/RouteResult.tsx`. Make these changes:

**a) Remove imports (lines 10-11):**
```ts
import { ProBadge } from "@/components/ui/ProBadge";
import { UpgradePrompt } from "@/components/ui/UpgradePrompt";
```
Delete both lines.

**b) Remove `userTier` from store destructuring (line 103):**
```ts
    userTier,
```
Delete this line.

**c) Remove `isFree` derived state (line 106):**
```ts
  const isFree = userTier === "free";
```
Delete this line.

**d) Remove `showUpgradePrompt` state (line 111):**
```ts
  const [showUpgradePrompt, setShowUpgradePrompt] = useState(false);
```
Delete this line.

**e) Replace `handleDownloadGPX` with the ungated version:**
```ts
  const handleDownloadGPX = useCallback(() => {
    if (!currentRoute) return;
    if (isFree) {
      setShowUpgradePrompt(true);
      return;
    }
    downloadGPX(currentRoute);
    // Show waitlist widget after first download
    if (!waitlistDismissed) {
      setShowWaitlistWidget(true);
    }
  }, [currentRoute, isFree, waitlistDismissed]);
```
Replace with:
```ts
  const handleDownloadGPX = useCallback(() => {
    if (!currentRoute) return;
    downloadGPX(currentRoute);
    if (!waitlistDismissed) {
      setShowWaitlistWidget(true);
    }
  }, [currentRoute, waitlistDismissed]);
```

**f) Remove the `<UpgradePrompt>` render block (lines 191-193):**
```tsx
      {showUpgradePrompt && (
        <UpgradePrompt onClose={() => setShowUpgradePrompt(false)} />
      )}
```
Delete these 3 lines.

**g) Remove the Pro conversion banner block (lines 284-330, the `{isFree && (...)}` block):**
```tsx
        {/* ── Pro conversion hook ──────────────────────────────────────────── */}
        {isFree && (
          <div
            style={{ ... }}
          >
            ...
          </div>
        )}
```
Delete the entire block (from the comment through the closing `)}`)

**h) Remove `<ProBadge />` from the GPX button (line 480):**
```tsx
            {isFree && <ProBadge />}
```
Delete this line.

- [ ] **Step 3: Run TypeScript check**

```bash
cd /Users/dubosqclement/Tracer && npx tsc --noEmit 2>&1 | head -30
```
Expected: no errors related to ProBadge, UpgradePrompt, userTier, isFree, showUpgradePrompt

- [ ] **Step 4: Run tests**

```bash
cd /Users/dubosqclement/Tracer && npx vitest run
```
Expected: all tests pass

- [ ] **Step 5: Commit**

```bash
cd /Users/dubosqclement/Tracer && git add -A && git commit -m "feat: remove Pro gating from RouteResult — GPX export free for all"
```

---

## Task 7: Replace PricingSection with "Free forever"

**Files:**
- Modify: `components/landing/PricingSection.tsx`

- [ ] **Step 1: Replace PricingSection content**

Open `components/landing/PricingSection.tsx`. Replace the entire file content with:

```tsx
"use client";

import Link from "next/link";

const FEATURES = [
  "Parcours illimités",
  "4 sports (trail, route, gravel, VTT)",
  "14 profils de session",
  "Carte interactive",
  "Export GPX",
  "Routes scéniques optimisées",
  "Moteur haute qualité (5 directions, 6 variantes)",
] as const;

export default function PricingSection() {
  return (
    <section
      style={{
        background: "#e8e0d4",
        padding: "80px 20px",
        borderTop: "1px solid #d4c9b8",
      }}
    >
      <div style={{ maxWidth: "560px", margin: "0 auto" }}>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "11px",
            letterSpacing: "0.2em",
            color: "#a39683",
            textTransform: "uppercase",
            marginBottom: "48px",
          }}
        >
          Tarifs
        </p>

        <div
          style={{
            background: "#f7f3ed",
            padding: "36px 32px",
            border: "1px solid #d4c9b8",
            display: "flex",
            flexDirection: "column",
            gap: "24px",
          }}
        >
          <div>
            <h3
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: "clamp(22px, 3vw, 30px)",
                fontStyle: "italic",
                color: "#3d3529",
                margin: "0 0 8px 0",
              }}
            >
              Gratuit
            </h3>
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "12px",
                color: "#a39683",
                margin: 0,
              }}
            >
              pour toujours — tout inclus
            </p>
          </div>

          <ul
            style={{
              listStyle: "none",
              padding: 0,
              margin: 0,
              display: "flex",
              flexDirection: "column",
              gap: "12px",
              flex: 1,
            }}
          >
            {FEATURES.map((feature) => (
              <li
                key={feature}
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "13px",
                  color: "#7a6e5d",
                  display: "flex",
                  alignItems: "center",
                  gap: "10px",
                  lineHeight: 1.4,
                }}
              >
                <span
                  style={{
                    color: "#5a7247",
                    fontWeight: 700,
                    fontSize: "16px",
                    lineHeight: 1,
                    flexShrink: 0,
                  }}
                  aria-hidden="true"
                >
                  ✓
                </span>
                {feature}
              </li>
            ))}
          </ul>

          <Link
            href="/app"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "0.05em",
              color: "#3d3529",
              textDecoration: "none",
              border: "1px solid #d4c9b8",
              padding: "14px 24px",
              display: "block",
              textAlign: "center",
              minHeight: "44px",
              lineHeight: 1,
            }}
          >
            Commencer gratuitement
          </Link>
        </div>
      </div>
    </section>
  );
}
```

- [ ] **Step 2: Run TypeScript check**

```bash
cd /Users/dubosqclement/Tracer && npx tsc --noEmit 2>&1 | head -20
```
Expected: no errors

- [ ] **Step 3: Commit**

```bash
cd /Users/dubosqclement/Tracer && git add components/landing/PricingSection.tsx && git commit -m "feat: replace pricing section with free-forever card"
```

---

## Task 8: Final verification

- [ ] **Step 1: Run full test suite**

```bash
cd /Users/dubosqclement/Tracer && npx vitest run
```
Expected: all tests pass

- [ ] **Step 2: TypeScript check**

```bash
cd /Users/dubosqclement/Tracer && npx tsc --noEmit 2>&1
```
Expected: no errors

- [ ] **Step 3: Verify no dead references remain**

```bash
cd /Users/dubosqclement/Tracer && grep -rn "stripe\|FREE_TIER\|PRO_TIER\|userTier\|getUserTier\|setUserTier\|UpgradePrompt\|ProBadge\|isFree\|refine-route\|tier-config" --include="*.ts" --include="*.tsx" . --exclude-dir=node_modules --exclude-dir=.next --exclude-dir=.git
```
Expected: no output (or only matches in comments/docs, not live code)

- [ ] **Step 4: Build check**

```bash
cd /Users/dubosqclement/Tracer && npm run build 2>&1 | tail -20
```
Expected: build succeeds without errors

- [ ] **Step 5: Final commit and push**

```bash
cd /Users/dubosqclement/Tracer && git log --oneline -10
```
Verify all tasks are committed cleanly, then push:
```bash
cd /Users/dubosqclement/Tracer && git push origin feat/freemium-relaunch
```
