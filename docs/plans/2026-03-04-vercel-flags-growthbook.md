# Vercel Flags + GrowthBook Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Integrate Vercel Flags SDK v4 with GrowthBook adapter for feature flags (A/B testing, rollouts, kill switches) across server and client components.

**Architecture:** Flags are declared in a central `flags.ts` file using `flag()` from `flags/next` with the GrowthBook adapter. A middleware precomputes flag values per request into an encrypted cookie. Server components call flag functions directly; client components receive values via props from a server wrapper.

**Tech Stack:** `flags` (Vercel Flags SDK v4), `@flags-sdk/growthbook`, Next.js 15 App Router, TypeScript

**Note:** `app/page.tsx` (landing page) is currently a `"use client"` component. To use server-evaluated flags, we split it: a server component wrapper evaluates the flag and passes the value as a prop to the client component.

---

### Task 1: Install Dependencies

**Files:**
- Modify: `package.json`

**Step 1: Install Vercel Flags SDK and GrowthBook adapter**

Run:
```bash
npm install flags @flags-sdk/growthbook
```

**Step 2: Verify installation**

Run: `npm ls flags @flags-sdk/growthbook`
Expected: Both packages listed without errors

**Step 3: Commit**

```bash
git add package.json package-lock.json
git commit -m "chore: install flags SDK and GrowthBook adapter"
```

---

### Task 2: Configure GrowthBook Adapter

**Files:**
- Create: `lib/feature-flags/growthbook-adapter.ts`

**Step 1: Create the adapter configuration file**

```typescript
import { createGrowthBookAdapter } from "@flags-sdk/growthbook";

export const growthBookAdapter = createGrowthBookAdapter({
  apiHost: process.env.GROWTHBOOK_API_HOST!,
  clientKey: process.env.GROWTHBOOK_CLIENT_KEY!,
});
```

**Step 2: Add environment variables to `.env.local`**

Add to `.env.local`:
```
GROWTHBOOK_API_HOST=https://cdn.growthbook.io
GROWTHBOOK_CLIENT_KEY=sdk-xxx
FLAGS_SECRET=your-secret-at-least-32-chars-long
```

`FLAGS_SECRET` is required by the Flags SDK to encrypt/decrypt flag values in cookies. Generate one with `openssl rand -hex 32`.

**Step 3: Commit**

```bash
git add lib/feature-flags/growthbook-adapter.ts
git commit -m "feat: configure GrowthBook adapter for Flags SDK"
```

---

### Task 3: Declare Feature Flags

**Files:**
- Create: `lib/feature-flags/flags.ts`

**Step 1: Create the flags declaration file with the example flag**

```typescript
import { flag } from "flags/next";
import { growthBookAdapter } from "./growthbook-adapter";

export const newLandingHeroFlag = flag<boolean>({
  key: "new-landing-hero",
  defaultValue: false,
  description: "A/B test: show alternative hero section on landing page",
  options: [
    { value: true, label: "New Hero" },
    { value: false, label: "Current Hero" },
  ],
  adapter: growthBookAdapter.feature<boolean>(),
});
```

**Step 2: Commit**

```bash
git add lib/feature-flags/flags.ts
git commit -m "feat: declare new-landing-hero feature flag"
```

---

### Task 4: Create Flags Discovery Endpoint

**Files:**
- Create: `app/api/flags/route.ts`

**Step 1: Create the API route**

```typescript
import { type ApiData, verifyAccess, version } from "flags";
import { getProviderData } from "flags/next";
import { NextResponse, type NextRequest } from "next/server";
import * as flags from "@/lib/feature-flags/flags";

export async function GET(request: NextRequest) {
  const access = await verifyAccess(request.headers.get("Authorization"));
  if (!access) return NextResponse.json(null, { status: 401 });

  const providerData = await getProviderData(flags);

  return NextResponse.json<ApiData>(providerData, {
    headers: { "x-flags-sdk-version": version },
  });
}
```

**Step 2: Commit**

```bash
git add app/api/flags/route.ts
git commit -m "feat: add flags discovery endpoint for Vercel Toolbar"
```

---

### Task 5: Add Middleware for Flag Precomputation

**Files:**
- Create: `middleware.ts`

**Step 1: Create the middleware**

```typescript
import { precompute } from "flags/next";
import { NextResponse, type NextRequest } from "next/server";
import { newLandingHeroFlag } from "@/lib/feature-flags/flags";

const landingFlags = [newLandingHeroFlag] as const;

export async function middleware(request: NextRequest) {
  const code = await precompute(landingFlags);

  // Rewrite to a precomputed path under /[code]
  const nextUrl = request.nextUrl.clone();
  nextUrl.pathname = `/${code}${nextUrl.pathname === "/" ? "" : nextUrl.pathname}`;

  return NextResponse.rewrite(nextUrl);
}

export const config = {
  matcher: ["/"],
};
```

**Step 2: Commit**

```bash
git add middleware.ts
git commit -m "feat: add middleware for flag precomputation"
```

---

### Task 6: Restructure Landing Page for Server-Side Flag Evaluation

The landing page (`app/page.tsx`) is currently `"use client"`. We need a server component wrapper to evaluate the flag and pass the result as a prop.

**Files:**
- Modify: `app/page.tsx` → rename to client component
- Create: `app/[code]/page.tsx` — server component with precomputed flags
- Create: `app/[code]/layout.tsx` — layout for the precomputed route

**Step 1: Move landing page to a reusable client component**

Rename `app/page.tsx` to `components/landing/LandingPage.tsx`. Add a `showNewHero` prop:

At the top, change the component signature:
```typescript
export default function LandingPage({ showNewHero = false }: { showNewHero?: boolean }) {
```

This is the only change to the landing page component itself. The `showNewHero` prop will be used in a later task to conditionally render the hero.

**Step 2: Create the precomputed route page**

Create `app/[code]/page.tsx`:

```typescript
import { getPrecomputed, generatePermutations } from "flags/next";
import { newLandingHeroFlag } from "@/lib/feature-flags/flags";
import LandingPage from "@/components/landing/LandingPage";

const landingFlags = [newLandingHeroFlag] as const;

export async function generateStaticParams() {
  const codes = await generatePermutations(landingFlags);
  return codes.map((code) => ({ code }));
}

export default async function PrecomputedLandingPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  const { code } = await params;
  const showNewHero = await getPrecomputed(newLandingHeroFlag, landingFlags, code);

  return <LandingPage showNewHero={showNewHero} />;
}
```

**Step 3: Create a simple pass-through layout**

Create `app/[code]/layout.tsx`:

```typescript
export default function CodeLayout({ children }: { children: React.ReactNode }) {
  return <>{children}</>;
}
```

**Step 4: Update `app/page.tsx` to be a simple redirect/fallback**

Replace `app/page.tsx` with a minimal fallback (middleware will rewrite `/` to `/[code]`):

```typescript
import LandingPage from "@/components/landing/LandingPage";

export default function FallbackPage() {
  return <LandingPage />;
}
```

This page only renders if middleware doesn't fire (e.g., direct access without middleware, development edge cases).

**Step 5: Verify the app builds**

Run: `npm run build`
Expected: Build succeeds without errors

**Step 6: Commit**

```bash
git add app/page.tsx app/[code]/ components/landing/LandingPage.tsx
git commit -m "feat: restructure landing page for precomputed flags"
```

---

### Task 7: Use the Flag in the Landing Page Hero

**Files:**
- Modify: `components/landing/LandingPage.tsx`

**Step 1: Add conditional rendering for the hero title**

Inside the hero section of `LandingPage`, use the `showNewHero` prop to render an alternative hero. Find the hero `<h1>` element and wrap it:

```typescript
{showNewHero ? (
  <h1
    ref={heroTitleRef}
    style={{
      fontFamily: "var(--font-playfair), serif",
      fontSize: "clamp(52px, 9vw, 96px)",
      fontStyle: "italic",
      fontWeight: 700,
      lineHeight: 1.05,
      marginTop: "24px",
      marginBottom: "28px",
      color: "var(--text-primary)",
    }}
  >
    <span className="hero-line">Ton terrain,</span>
    <span className="hero-line" style={{ color: "var(--accent-lime)" }}>
      ton parcours.
    </span>
  </h1>
) : (
  <h1
    ref={heroTitleRef}
    style={{
      fontFamily: "var(--font-playfair), serif",
      fontSize: "clamp(52px, 9vw, 96px)",
      fontStyle: "italic",
      fontWeight: 700,
      lineHeight: 1.05,
      marginTop: "24px",
      marginBottom: "28px",
      color: "var(--text-primary)",
    }}
  >
    <span className="hero-line">Forge ton</span>
    <span className="hero-line" style={{ color: "var(--accent-lime)" }}>
      parcours.
    </span>
  </h1>
)}
```

**Step 2: Verify the app runs**

Run: `npm run dev`
Visit `http://localhost:3000` — should see the current hero (flag defaults to `false`).

**Step 3: Commit**

```bash
git add components/landing/LandingPage.tsx
git commit -m "feat: use new-landing-hero flag for A/B test hero variant"
```

---

### Task 8: Verify Full Integration

**Step 1: Run build**

Run: `npm run build`
Expected: Build succeeds

**Step 2: Run dev server and test**

Run: `npm run dev`
- Visit `/` — middleware should rewrite, flag defaults to `false`, current hero shows
- Check browser cookies for encrypted flag values

**Step 3: Test Vercel Toolbar discovery (optional)**

If deployed on Vercel, the Toolbar should show the `new-landing-hero` flag with override options.

**Step 4: Final commit**

```bash
git add -A
git commit -m "feat: complete Vercel Flags + GrowthBook integration"
```

---

## Summary

| # | Task | Files |
|---|------|-------|
| 1 | Install dependencies | `package.json` |
| 2 | Configure GrowthBook adapter | `lib/feature-flags/growthbook-adapter.ts`, `.env.local` |
| 3 | Declare feature flags | `lib/feature-flags/flags.ts` |
| 4 | Flags discovery endpoint | `app/api/flags/route.ts` |
| 5 | Middleware for precomputation | `middleware.ts` |
| 6 | Restructure landing page | `app/page.tsx`, `app/[code]/page.tsx`, `components/landing/LandingPage.tsx` |
| 7 | Use flag in hero | `components/landing/LandingPage.tsx` |
| 8 | Verify full integration | — |
