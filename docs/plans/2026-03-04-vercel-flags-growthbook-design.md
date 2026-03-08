# Vercel Flags + GrowthBook Integration Design

**Date:** 2026-03-04
**Status:** Approved

## Goal

Integrate Vercel Flags SDK with GrowthBook as the feature flag provider to support A/B testing, progressive rollouts, and kill switches across both server and client components.

## Architecture

Three layers:

1. **`@flags-sdk/growthbook`** — Official Vercel adapter connecting the Flags SDK to GrowthBook
2. **Flag declarations** (`flags.ts`) — Each flag declared with `flag()` from `flags/next` + GrowthBook adapter
3. **Flags Discovery endpoint** (`/api/flags/route.ts`) — Exposes flags to Vercel Toolbar for dev overrides

## Decision: Vercel Flags SDK v4 + Adapter (not raw GrowthBook SDK)

**Why:**
- Precomputed flags via middleware — no client-side flash
- Works in RSC + Client Components with a single system
- Vercel Toolbar integration for dev overrides
- Provider-agnostic — changing providers only requires swapping the adapter

## Files to Create

| File | Purpose |
|------|---------|
| `lib/feature-flags/growthbook-adapter.ts` | GrowthBook adapter configuration |
| `lib/feature-flags/flags.ts` | Flag declarations |
| `middleware.ts` | Precompute flags per request |
| `app/api/flags/route.ts` | Discovery endpoint for Vercel Toolbar |
| `components/providers/FlagsProvider.tsx` | Client-side flag access provider |

## Example Flag: `new-landing-hero`

Boolean flag to A/B test an alternative hero section on the landing page. Evaluated server-side in `app/page.tsx`.

## Environment Variables

```
GROWTHBOOK_API_HOST=https://cdn.growthbook.io
GROWTHBOOK_CLIENT_KEY=sdk-xxx
FLAGS_SECRET=xxx
```

## Resolution Flow

```
Request → Middleware (precompute flags via GrowthBook adapter)
  → Encode in encrypted cookie
  → Server Component reads via flag()
  → Client Component reads via FlagsProvider
```

## Example Flag Usage

### Server Component
```tsx
import { newLandingHeroFlag } from "@/lib/feature-flags/flags";

export default async function Page() {
  const showNewHero = await newLandingHeroFlag();
  return showNewHero ? <NewHero /> : <CurrentHero />;
}
```

### Client Component
```tsx
"use client";
import { useFlag } from "flags/react";
import { newLandingHeroFlag } from "@/lib/feature-flags/flags";

function MyComponent() {
  const showNewHero = useFlag(newLandingHeroFlag);
  // ...
}
```
