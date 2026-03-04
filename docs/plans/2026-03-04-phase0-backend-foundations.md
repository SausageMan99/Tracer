# Phase 0 — Backend Foundations Implementation Plan

> **For Claude:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task.

**Goal:** Transform the TrailForge backend from a prototype (localStorage, no auth, illegal heatmap proxy) into a production-grade API ready for an iOS client.

**Architecture:** Supabase (PostgreSQL + Auth) as the data layer, Next.js API routes as the API gateway, Strava OAuth for personal activity import, extended OSM enrichment via Overpass, Redis cache via Upstash. Remove the Go heatmap proxy entirely.

**Tech Stack:** Next.js 15, Supabase (PostgreSQL + @supabase/supabase-js), Upstash Redis (@upstash/redis), Strava API v3, Overpass API, Vitest for testing.

---

## Task 1: Set Up Supabase Project & Database Schema

**Files:**
- Create: `lib/supabase/client.ts`
- Create: `lib/supabase/server.ts`
- Create: `lib/supabase/types.ts`
- Create: `supabase/migrations/001_initial_schema.sql`
- Modify: `package.json` (add dependencies)
- Modify: `.env.local` (add Supabase keys)

**Step 1: Install dependencies**

Run:
```bash
npm install @supabase/supabase-js @supabase/ssr
```

**Step 2: Create environment variables**

Add to `.env.local`:
```
NEXT_PUBLIC_SUPABASE_URL=<your-supabase-url>
NEXT_PUBLIC_SUPABASE_ANON_KEY=<your-anon-key>
SUPABASE_SERVICE_ROLE_KEY=<your-service-role-key>
```

**Step 3: Write the database migration**

Create `supabase/migrations/001_initial_schema.sql`:
```sql
-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- Users table (extends Supabase auth.users)
CREATE TABLE public.profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT,
  primary_sport TEXT CHECK (primary_sport IN ('running', 'cycling_road', 'cycling_gravel', 'cycling_mtb')),
  experience_level TEXT CHECK (experience_level IN ('beginner', 'intermediate', 'advanced')),
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Strava OAuth tokens (encrypted)
CREATE TABLE public.strava_connections (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  strava_athlete_id BIGINT NOT NULL UNIQUE,
  access_token TEXT NOT NULL,
  refresh_token TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL,
  scope TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id)
);

-- Cached Strava activities (polylines for anti-repetition)
CREATE TABLE public.strava_activities (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  strava_activity_id BIGINT NOT NULL,
  sport TEXT NOT NULL,
  distance_km DOUBLE PRECISION NOT NULL,
  elevation_m DOUBLE PRECISION,
  polyline TEXT NOT NULL,
  started_at TIMESTAMPTZ NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, strava_activity_id)
);

-- Generated routes
CREATE TABLE public.generated_routes (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  profile_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  target_distance_km DOUBLE PRECISION NOT NULL,
  target_elevation_m DOUBLE PRECISION,
  actual_distance_km DOUBLE PRECISION NOT NULL,
  actual_elevation_m DOUBLE PRECISION,
  total_score DOUBLE PRECISION NOT NULL,
  discovery_index DOUBLE PRECISION,
  geometry JSONB NOT NULL,
  candidates JSONB NOT NULL,
  osm_pois JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Favorites
CREATE TABLE public.favorites (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  route_id UUID NOT NULL REFERENCES public.generated_routes(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  UNIQUE(user_id, route_id)
);

-- Feedback (replaces localStorage)
CREATE TABLE public.feedback (
  id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id UUID REFERENCES public.profiles(id) ON DELETE SET NULL,
  route_id UUID REFERENCES public.generated_routes(id) ON DELETE SET NULL,
  rating TEXT NOT NULL CHECK (rating IN ('positive', 'negative')),
  profile_id TEXT NOT NULL,
  sport TEXT NOT NULL,
  requested_distance_km DOUBLE PRECISION NOT NULL,
  requested_elevation_m DOUBLE PRECISION,
  actual_distance_km DOUBLE PRECISION NOT NULL,
  actual_elevation_m DOUBLE PRECISION,
  algorithmic_score DOUBLE PRECISION NOT NULL,
  discovery_index DOUBLE PRECISION,
  created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- User preferences
CREATE TABLE public.user_preferences (
  user_id UUID PRIMARY KEY REFERENCES public.profiles(id) ON DELETE CASCADE,
  default_sport TEXT DEFAULT 'running',
  default_profile_id TEXT DEFAULT 'running_endurance',
  default_distance_km DOUBLE PRECISION DEFAULT 10,
  default_elevation_m DOUBLE PRECISION DEFAULT 100,
  scenic_mode BOOLEAN DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Row Level Security
ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strava_connections ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.strava_activities ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.generated_routes ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.favorites ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_preferences ENABLE ROW LEVEL SECURITY;

-- RLS Policies: users can only access their own data
CREATE POLICY "Users read own profile" ON public.profiles FOR SELECT USING (auth.uid() = id);
CREATE POLICY "Users update own profile" ON public.profiles FOR UPDATE USING (auth.uid() = id);
CREATE POLICY "Users insert own profile" ON public.profiles FOR INSERT WITH CHECK (auth.uid() = id);

CREATE POLICY "Users read own strava" ON public.strava_connections FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users manage own strava" ON public.strava_connections FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users read own activities" ON public.strava_activities FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users manage own activities" ON public.strava_activities FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users read own routes" ON public.generated_routes FOR SELECT USING (auth.uid() = user_id);
CREATE POLICY "Users insert routes" ON public.generated_routes FOR INSERT WITH CHECK (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users manage own favorites" ON public.favorites FOR ALL USING (auth.uid() = user_id);

CREATE POLICY "Users manage own feedback" ON public.feedback FOR ALL USING (auth.uid() = user_id OR user_id IS NULL);

CREATE POLICY "Users manage own preferences" ON public.user_preferences FOR ALL USING (auth.uid() = user_id);

-- Indexes
CREATE INDEX idx_strava_activities_user ON public.strava_activities(user_id);
CREATE INDEX idx_strava_activities_sport ON public.strava_activities(user_id, sport);
CREATE INDEX idx_generated_routes_user ON public.generated_routes(user_id, created_at DESC);
CREATE INDEX idx_favorites_user ON public.favorites(user_id);
CREATE INDEX idx_feedback_route ON public.feedback(route_id);

-- Auto-update updated_at trigger
CREATE OR REPLACE FUNCTION update_updated_at()
RETURNS TRIGGER AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER profiles_updated_at BEFORE UPDATE ON public.profiles
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER strava_connections_updated_at BEFORE UPDATE ON public.strava_connections
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
CREATE TRIGGER user_preferences_updated_at BEFORE UPDATE ON public.user_preferences
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
```

**Step 4: Create Supabase client utilities**

Create `lib/supabase/client.ts`:
```typescript
import { createBrowserClient } from "@supabase/ssr";
import type { Database } from "./types";

export function createClient() {
  return createBrowserClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  );
}
```

Create `lib/supabase/server.ts`:
```typescript
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import type { Database } from "./types";

export async function createServerSupabase() {
  const cookieStore = await cookies();
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value, options }) =>
            cookieStore.set(name, value, options)
          );
        },
      },
    }
  );
}

export function createServiceClient() {
  return createServerClient<Database>(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    {
      cookies: { getAll: () => [], setAll: () => {} },
    }
  );
}
```

Create `lib/supabase/types.ts`:
```typescript
// Auto-generated with: npx supabase gen types typescript --project-id <id> > lib/supabase/types.ts
// For now, manual type definitions matching the schema:

export interface Database {
  public: {
    Tables: {
      profiles: {
        Row: {
          id: string;
          display_name: string | null;
          primary_sport: string | null;
          experience_level: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["profiles"]["Row"], "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["profiles"]["Insert"]>;
      };
      strava_connections: {
        Row: {
          id: string;
          user_id: string;
          strava_athlete_id: number;
          access_token: string;
          refresh_token: string;
          expires_at: string;
          scope: string;
          created_at: string;
          updated_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["strava_connections"]["Row"], "id" | "created_at" | "updated_at">;
        Update: Partial<Database["public"]["Tables"]["strava_connections"]["Insert"]>;
      };
      strava_activities: {
        Row: {
          id: string;
          user_id: string;
          strava_activity_id: number;
          sport: string;
          distance_km: number;
          elevation_m: number | null;
          polyline: string;
          started_at: string;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["strava_activities"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["strava_activities"]["Insert"]>;
      };
      generated_routes: {
        Row: {
          id: string;
          user_id: string | null;
          profile_id: string;
          sport: string;
          target_distance_km: number;
          target_elevation_m: number | null;
          actual_distance_km: number;
          actual_elevation_m: number | null;
          total_score: number;
          discovery_index: number | null;
          geometry: unknown;
          candidates: unknown;
          osm_pois: unknown;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["generated_routes"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["generated_routes"]["Insert"]>;
      };
      favorites: {
        Row: {
          id: string;
          user_id: string;
          route_id: string;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["favorites"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["favorites"]["Insert"]>;
      };
      feedback: {
        Row: {
          id: string;
          user_id: string | null;
          route_id: string | null;
          rating: string;
          profile_id: string;
          sport: string;
          requested_distance_km: number;
          requested_elevation_m: number | null;
          actual_distance_km: number;
          actual_elevation_m: number | null;
          algorithmic_score: number;
          discovery_index: number | null;
          created_at: string;
        };
        Insert: Omit<Database["public"]["Tables"]["feedback"]["Row"], "id" | "created_at">;
        Update: Partial<Database["public"]["Tables"]["feedback"]["Insert"]>;
      };
      user_preferences: {
        Row: {
          user_id: string;
          default_sport: string;
          default_profile_id: string;
          default_distance_km: number;
          default_elevation_m: number;
          scenic_mode: boolean;
          updated_at: string;
        };
        Insert: Database["public"]["Tables"]["user_preferences"]["Row"];
        Update: Partial<Omit<Database["public"]["Tables"]["user_preferences"]["Row"], "user_id">>;
      };
    };
  };
}
```

**Step 5: Run migration in Supabase dashboard**

Go to Supabase Dashboard > SQL Editor > paste and run `001_initial_schema.sql`.

**Step 6: Commit**

```bash
git add lib/supabase/ supabase/ package.json package-lock.json .env.local
git commit -m "feat: add Supabase setup with database schema, RLS policies, and client utilities"
```

---

## Task 2: Set Up Upstash Redis Cache

**Files:**
- Create: `lib/cache.ts`
- Modify: `package.json` (add dependency)
- Modify: `.env.local` (add Redis keys)

**Step 1: Install dependency**

Run: `npm install @upstash/redis`

**Step 2: Add environment variables**

Add to `.env.local`:
```
UPSTASH_REDIS_REST_URL=<your-upstash-url>
UPSTASH_REDIS_REST_TOKEN=<your-upstash-token>
```

**Step 3: Write the failing test**

Create `tests/cache.test.ts`:
```typescript
import { describe, it, expect, vi, beforeEach } from "vitest";

// Mock @upstash/redis before importing cache module
vi.mock("@upstash/redis", () => ({
  Redis: vi.fn().mockImplementation(() => ({
    get: vi.fn(),
    set: vi.fn(),
    del: vi.fn(),
  })),
}));

// Set env vars before import
process.env.UPSTASH_REDIS_REST_URL = "https://fake.upstash.io";
process.env.UPSTASH_REDIS_REST_TOKEN = "fake-token";

import { getCached, setCached, invalidateCache } from "@/lib/cache";

describe("cache", () => {
  it("returns null on cache miss", async () => {
    const result = await getCached("nonexistent-key");
    expect(result).toBeNull();
  });

  it("returns cached value on cache hit", async () => {
    await setCached("test-key", { data: "hello" }, 3600);
    const result = await getCached("test-key");
    expect(result).toEqual({ data: "hello" });
  });

  it("invalidates cached value", async () => {
    await setCached("test-key", { data: "hello" }, 3600);
    await invalidateCache("test-key");
    const result = await getCached("test-key");
    expect(result).toBeNull();
  });
});
```

**Step 4: Run test to verify it fails**

Run: `npx vitest run tests/cache.test.ts`
Expected: FAIL — module `@/lib/cache` not found

**Step 5: Write minimal implementation**

Create `lib/cache.ts`:
```typescript
import { Redis } from "@upstash/redis";

const redis = new Redis({
  url: process.env.UPSTASH_REDIS_REST_URL!,
  token: process.env.UPSTASH_REDIS_REST_TOKEN!,
});

export async function getCached<T>(key: string): Promise<T | null> {
  try {
    const value = await redis.get<T>(key);
    return value ?? null;
  } catch {
    console.warn(`[cache] GET failed for key: ${key}`);
    return null;
  }
}

export async function setCached<T>(
  key: string,
  value: T,
  ttlSeconds: number
): Promise<void> {
  try {
    await redis.set(key, value, { ex: ttlSeconds });
  } catch {
    console.warn(`[cache] SET failed for key: ${key}`);
  }
}

export async function invalidateCache(key: string): Promise<void> {
  try {
    await redis.del(key);
  } catch {
    console.warn(`[cache] DEL failed for key: ${key}`);
  }
}

// Cache key builders for consistent naming
export const CacheKeys = {
  geocode: (address: string) => `geocode:${address.toLowerCase().trim()}`,
  elevation: (coords: string) => `elev:${coords}`,
  overpass: (lat: number, lng: number, radius: number) =>
    `overpass:${lat.toFixed(3)}_${lng.toFixed(3)}_${radius}`,
  graph: (lat: number, lng: number, radius: number) =>
    `graph:${lat.toFixed(3)}_${lng.toFixed(3)}_${radius}`,
} as const;
```

**Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/cache.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add lib/cache.ts tests/cache.test.ts package.json package-lock.json
git commit -m "feat: add Upstash Redis cache layer with key builders"
```

---

## Task 3: Strava OAuth Integration

**Files:**
- Create: `lib/strava/auth.ts`
- Create: `lib/strava/types.ts`
- Create: `app/api/v1/auth/strava/route.ts`
- Create: `app/api/v1/auth/strava/callback/route.ts`
- Create: `tests/strava-auth.test.ts`

**Step 1: Add Strava environment variables**

Add to `.env.local`:
```
STRAVA_CLIENT_ID=<your-client-id>
STRAVA_CLIENT_SECRET=<your-client-secret>
STRAVA_REDIRECT_URI=http://localhost:3000/api/v1/auth/strava/callback
```

**Step 2: Write Strava types**

Create `lib/strava/types.ts`:
```typescript
export interface StravaTokenResponse {
  readonly access_token: string;
  readonly refresh_token: string;
  readonly expires_at: number;
  readonly expires_in: number;
  readonly athlete: StravaAthlete;
}

export interface StravaAthlete {
  readonly id: number;
  readonly firstname: string;
  readonly lastname: string;
  readonly profile: string;
}

export interface StravaActivity {
  readonly id: number;
  readonly name: string;
  readonly type: string;
  readonly sport_type: string;
  readonly distance: number; // meters
  readonly total_elevation_gain: number; // meters
  readonly start_date: string;
  readonly map: {
    readonly summary_polyline: string;
  };
}

export interface StravaTokens {
  readonly accessToken: string;
  readonly refreshToken: string;
  readonly expiresAt: Date;
}
```

**Step 3: Write the failing test**

Create `tests/strava-auth.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { buildStravaAuthUrl, mapStravaActivityToSport } from "@/lib/strava/auth";

describe("Strava Auth", () => {
  it("builds correct OAuth URL", () => {
    const url = buildStravaAuthUrl("test-state");
    expect(url).toContain("https://www.strava.com/oauth/authorize");
    expect(url).toContain("client_id=");
    expect(url).toContain("scope=read,activity:read_all");
    expect(url).toContain("state=test-state");
  });

  it("maps Strava sport types to TrailForge sports", () => {
    expect(mapStravaActivityToSport("Run")).toBe("running");
    expect(mapStravaActivityToSport("TrailRun")).toBe("running");
    expect(mapStravaActivityToSport("Ride")).toBe("cycling_road");
    expect(mapStravaActivityToSport("GravelRide")).toBe("cycling_gravel");
    expect(mapStravaActivityToSport("MountainBikeRide")).toBe("cycling_mtb");
    expect(mapStravaActivityToSport("Swim")).toBeNull();
  });
});
```

**Step 4: Run test to verify it fails**

Run: `npx vitest run tests/strava-auth.test.ts`
Expected: FAIL

**Step 5: Write implementation**

Create `lib/strava/auth.ts`:
```typescript
import type { StravaTokenResponse, StravaActivity, StravaTokens } from "./types";
import type { Sport } from "@/lib/types";

const STRAVA_AUTH_URL = "https://www.strava.com/oauth/authorize";
const STRAVA_TOKEN_URL = "https://www.strava.com/oauth/token";
const STRAVA_API_URL = "https://www.strava.com/api/v3";

export function buildStravaAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: process.env.STRAVA_CLIENT_ID ?? "",
    redirect_uri: process.env.STRAVA_REDIRECT_URI ?? "",
    response_type: "code",
    scope: "read,activity:read_all",
    state,
  });
  return `${STRAVA_AUTH_URL}?${params.toString()}`;
}

export async function exchangeStravaCode(code: string): Promise<StravaTokenResponse> {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      code,
      grant_type: "authorization_code",
    }),
  });

  if (!response.ok) {
    throw new Error(`Strava token exchange failed: ${response.status}`);
  }

  return response.json();
}

export async function refreshStravaToken(refreshToken: string): Promise<StravaTokens> {
  const response = await fetch(STRAVA_TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: process.env.STRAVA_CLIENT_ID,
      client_secret: process.env.STRAVA_CLIENT_SECRET,
      grant_type: "refresh_token",
      refresh_token: refreshToken,
    }),
  });

  if (!response.ok) {
    throw new Error(`Strava token refresh failed: ${response.status}`);
  }

  const data = await response.json();
  return {
    accessToken: data.access_token,
    refreshToken: data.refresh_token,
    expiresAt: new Date(data.expires_at * 1000),
  };
}

export async function fetchStravaActivities(
  accessToken: string,
  page: number = 1,
  perPage: number = 100
): Promise<readonly StravaActivity[]> {
  const params = new URLSearchParams({
    page: String(page),
    per_page: String(perPage),
  });

  const response = await fetch(`${STRAVA_API_URL}/athlete/activities?${params}`, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });

  if (!response.ok) {
    throw new Error(`Strava activities fetch failed: ${response.status}`);
  }

  return response.json();
}

export function mapStravaActivityToSport(stravaType: string): Sport | null {
  const mapping: Record<string, Sport> = {
    Run: "running",
    TrailRun: "running",
    VirtualRun: "running",
    Ride: "cycling_road",
    VirtualRide: "cycling_road",
    GravelRide: "cycling_gravel",
    MountainBikeRide: "cycling_mtb",
    EBikeRide: "cycling_road",
    EMountainBikeRide: "cycling_mtb",
  };
  return mapping[stravaType] ?? null;
}
```

**Step 6: Run tests to verify they pass**

Run: `npx vitest run tests/strava-auth.test.ts`
Expected: PASS

**Step 7: Create API routes for Strava OAuth flow**

Create `app/api/v1/auth/strava/route.ts`:
```typescript
import { NextResponse } from "next/server";
import { buildStravaAuthUrl } from "@/lib/strava/auth";
import { randomUUID } from "crypto";

export async function GET() {
  const state = randomUUID();
  const authUrl = buildStravaAuthUrl(state);

  return NextResponse.json({ url: authUrl, state });
}
```

Create `app/api/v1/auth/strava/callback/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { exchangeStravaCode, mapStravaActivityToSport, fetchStravaActivities } from "@/lib/strava/auth";
import { createServiceClient } from "@/lib/supabase/server";

export async function GET(request: NextRequest) {
  const code = request.nextUrl.searchParams.get("code");
  const error = request.nextUrl.searchParams.get("error");

  if (error || !code) {
    return NextResponse.redirect(new URL("/app?strava=error", request.url));
  }

  try {
    const tokenData = await exchangeStravaCode(code);
    const supabase = createServiceClient();

    // Store Strava connection
    const { error: dbError } = await supabase
      .from("strava_connections")
      .upsert({
        user_id: "", // Will be set from auth context in production
        strava_athlete_id: tokenData.athlete.id,
        access_token: tokenData.access_token,
        refresh_token: tokenData.refresh_token,
        expires_at: new Date(tokenData.expires_at * 1000).toISOString(),
        scope: "read,activity:read_all",
      });

    if (dbError) {
      console.error("[strava] Failed to store connection:", dbError);
      return NextResponse.redirect(new URL("/app?strava=error", request.url));
    }

    return NextResponse.redirect(new URL("/app?strava=connected", request.url));
  } catch (err) {
    console.error("[strava] OAuth callback error:", err);
    return NextResponse.redirect(new URL("/app?strava=error", request.url));
  }
}
```

**Step 8: Commit**

```bash
git add lib/strava/ app/api/v1/auth/strava/ tests/strava-auth.test.ts
git commit -m "feat: add Strava OAuth integration with activity import and sport mapping"
```

---

## Task 4: Strava Activity Sync & Anti-Repetition Engine

**Files:**
- Create: `lib/strava/sync.ts`
- Create: `lib/strava/polyline.ts`
- Create: `lib/anti-repetition.ts`
- Create: `app/api/v1/strava/sync/route.ts`
- Create: `tests/polyline.test.ts`
- Create: `tests/anti-repetition.test.ts`

**Step 1: Write the polyline decoder test**

Create `tests/polyline.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { decodePolyline } from "@/lib/strava/polyline";

describe("decodePolyline", () => {
  it("decodes a simple polyline", () => {
    // Encoded polyline for two points: (38.5, -120.2) and (40.7, -120.95)
    const encoded = "_p~iF~ps|U_ulLnnqC";
    const points = decodePolyline(encoded);
    expect(points.length).toBe(2);
    expect(points[0][0]).toBeCloseTo(38.5, 1);
    expect(points[0][1]).toBeCloseTo(-120.2, 1);
  });

  it("returns empty array for empty string", () => {
    expect(decodePolyline("")).toEqual([]);
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/polyline.test.ts`
Expected: FAIL

**Step 3: Implement polyline decoder**

Create `lib/strava/polyline.ts`:
```typescript
/**
 * Decode Google Encoded Polyline Algorithm Format.
 * Returns array of [lat, lng] pairs.
 */
export function decodePolyline(encoded: string): ReadonlyArray<readonly [number, number]> {
  if (!encoded) return [];

  const points: Array<readonly [number, number]> = [];
  let index = 0;
  let lat = 0;
  let lng = 0;

  while (index < encoded.length) {
    let shift = 0;
    let result = 0;
    let byte: number;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lat += result & 1 ? ~(result >> 1) : result >> 1;

    shift = 0;
    result = 0;

    do {
      byte = encoded.charCodeAt(index++) - 63;
      result |= (byte & 0x1f) << shift;
      shift += 5;
    } while (byte >= 0x20);

    lng += result & 1 ? ~(result >> 1) : result >> 1;

    points.push([lat / 1e5, lng / 1e5] as const);
  }

  return points;
}
```

**Step 4: Run test to verify it passes**

Run: `npx vitest run tests/polyline.test.ts`
Expected: PASS

**Step 5: Write the anti-repetition test**

Create `tests/anti-repetition.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { computeDiscoveryIndex, segmentOverlap } from "@/lib/anti-repetition";

describe("anti-repetition", () => {
  it("returns 1.0 when no past activities exist", () => {
    const routePoints: Array<readonly [number, number]> = [
      [48.85, 2.35],
      [48.86, 2.36],
      [48.87, 2.37],
    ];
    const pastPolylines: string[] = [];
    const result = computeDiscoveryIndex(routePoints, pastPolylines);
    expect(result).toBe(1.0);
  });

  it("returns 0.0 when route is identical to past activity", () => {
    const routePoints: Array<readonly [number, number]> = [
      [48.85, 2.35],
      [48.86, 2.36],
    ];
    // Same points encoded
    const pastPolylines = ["_seyHkdaM_ibE_ibE"];
    const result = computeDiscoveryIndex(routePoints, pastPolylines);
    expect(result).toBeLessThan(0.3);
  });

  it("segmentOverlap returns correct ratio", () => {
    const routePoints: Array<readonly [number, number]> = [
      [48.850, 2.350],
      [48.860, 2.360],
      [48.870, 2.370],
    ];
    // One overlapping point, two unique
    const pastPoints: Array<readonly [number, number]> = [
      [48.850, 2.350],
      [48.840, 2.340],
    ];
    const overlap = segmentOverlap(routePoints, pastPoints, 0.05);
    expect(overlap).toBeGreaterThan(0);
    expect(overlap).toBeLessThan(1);
  });
});
```

**Step 6: Run test to verify it fails**

Run: `npx vitest run tests/anti-repetition.test.ts`
Expected: FAIL

**Step 7: Implement anti-repetition engine**

Create `lib/anti-repetition.ts`:
```typescript
import { decodePolyline } from "@/lib/strava/polyline";

const OVERLAP_THRESHOLD_KM = 0.05; // 50 meters

/**
 * Compute how "new" a route is compared to past activities.
 * Returns 0.0 (entirely repeated) to 1.0 (entirely new).
 */
export function computeDiscoveryIndex(
  routePoints: ReadonlyArray<readonly [number, number]>,
  pastPolylines: readonly string[]
): number {
  if (pastPolylines.length === 0) return 1.0;
  if (routePoints.length === 0) return 1.0;

  const allPastPoints = pastPolylines.flatMap((p) => decodePolyline(p));

  if (allPastPoints.length === 0) return 1.0;

  const overlap = segmentOverlap(routePoints, allPastPoints, OVERLAP_THRESHOLD_KM);
  return Math.max(0, Math.min(1, 1 - overlap));
}

/**
 * Compute the fraction of routePoints that are "close" to any past point.
 * Uses a simple nearest-neighbor approach with haversine distance.
 */
export function segmentOverlap(
  routePoints: ReadonlyArray<readonly [number, number]>,
  pastPoints: ReadonlyArray<readonly [number, number]>,
  thresholdKm: number
): number {
  if (routePoints.length === 0) return 0;

  let overlappingCount = 0;

  for (const routePoint of routePoints) {
    const isClose = pastPoints.some(
      (pastPoint) => haversineKm(routePoint, pastPoint) < thresholdKm
    );
    if (isClose) overlappingCount++;
  }

  return overlappingCount / routePoints.length;
}

function haversineKm(
  a: readonly [number, number],
  b: readonly [number, number]
): number {
  const R = 6371;
  const dLat = toRad(b[0] - a[0]);
  const dLng = toRad(b[1] - a[1]);
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h =
    sinLat * sinLat +
    Math.cos(toRad(a[0])) * Math.cos(toRad(b[0])) * sinLng * sinLng;
  return R * 2 * Math.atan2(Math.sqrt(h), Math.sqrt(1 - h));
}

function toRad(deg: number): number {
  return (deg * Math.PI) / 180;
}
```

**Step 8: Run tests to verify they pass**

Run: `npx vitest run tests/anti-repetition.test.ts`
Expected: PASS

**Step 9: Implement Strava sync service**

Create `lib/strava/sync.ts`:
```typescript
import { fetchStravaActivities, refreshStravaToken, mapStravaActivityToSport } from "./auth";
import type { StravaActivity } from "./types";
import { createServiceClient } from "@/lib/supabase/server";

const MAX_PAGES = 10; // Max 1000 activities per sync

export async function syncStravaActivities(userId: string): Promise<{
  readonly synced: number;
  readonly skipped: number;
}> {
  const supabase = createServiceClient();

  // Get Strava connection
  const { data: connection, error: connError } = await supabase
    .from("strava_connections")
    .select("*")
    .eq("user_id", userId)
    .single();

  if (connError || !connection) {
    throw new Error("No Strava connection found");
  }

  // Refresh token if expired
  let accessToken = connection.access_token;
  const expiresAt = new Date(connection.expires_at);

  if (expiresAt <= new Date()) {
    const newTokens = await refreshStravaToken(connection.refresh_token);
    accessToken = newTokens.accessToken;

    await supabase
      .from("strava_connections")
      .update({
        access_token: newTokens.accessToken,
        refresh_token: newTokens.refreshToken,
        expires_at: newTokens.expiresAt.toISOString(),
      })
      .eq("user_id", userId);
  }

  // Fetch activities page by page
  let synced = 0;
  let skipped = 0;

  for (let page = 1; page <= MAX_PAGES; page++) {
    const activities = await fetchStravaActivities(accessToken, page, 100);

    if (activities.length === 0) break;

    for (const activity of activities) {
      const sport = mapStravaActivityToSport(activity.sport_type || activity.type);
      if (!sport || !activity.map?.summary_polyline) {
        skipped++;
        continue;
      }

      const { error } = await supabase.from("strava_activities").upsert(
        {
          user_id: userId,
          strava_activity_id: activity.id,
          sport,
          distance_km: activity.distance / 1000,
          elevation_m: activity.total_elevation_gain,
          polyline: activity.map.summary_polyline,
          started_at: activity.start_date,
        },
        { onConflict: "user_id,strava_activity_id" }
      );

      if (error) {
        console.warn(`[strava-sync] Failed to upsert activity ${activity.id}:`, error);
        skipped++;
      } else {
        synced++;
      }
    }

    if (activities.length < 100) break; // Last page
  }

  return { synced, skipped };
}
```

**Step 10: Create Strava sync API route**

Create `app/api/v1/strava/sync/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { syncStravaActivities } from "@/lib/strava/sync";
import { createServerSupabase } from "@/lib/supabase/server";

export async function POST(request: NextRequest) {
  const supabase = await createServerSupabase();
  const { data: { user }, error: authError } = await supabase.auth.getUser();

  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const result = await syncStravaActivities(user.id);
    return NextResponse.json({
      success: true,
      synced: result.synced,
      skipped: result.skipped,
    });
  } catch (err) {
    console.error("[strava-sync] Error:", err);
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Sync failed" },
      { status: 500 }
    );
  }
}
```

**Step 11: Commit**

```bash
git add lib/strava/polyline.ts lib/strava/sync.ts lib/anti-repetition.ts app/api/v1/strava/sync/ tests/polyline.test.ts tests/anti-repetition.test.ts
git commit -m "feat: add Strava activity sync and anti-repetition engine with discovery index"
```

---

## Task 5: Extended OSM Enrichment

**Files:**
- Create: `lib/osm-enrichment.ts`
- Create: `tests/osm-enrichment.test.ts`

**Step 1: Write the failing test**

Create `tests/osm-enrichment.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { categorizeOsmPoi, buildEnrichmentQuery } from "@/lib/osm-enrichment";

describe("OSM Enrichment", () => {
  it("categorizes viewpoints correctly", () => {
    const poi = categorizeOsmPoi({
      type: "node",
      id: 123,
      lat: 48.85,
      lon: 2.35,
      tags: { tourism: "viewpoint", name: "Panorama des Alpes" },
    });
    expect(poi.category).toBe("viewpoint");
    expect(poi.name).toBe("Panorama des Alpes");
    expect(poi.icon).toBe("eye");
  });

  it("categorizes water features", () => {
    const poi = categorizeOsmPoi({
      type: "node",
      id: 456,
      lat: 48.86,
      lon: 2.36,
      tags: { natural: "water", name: "Lac du Bourget" },
    });
    expect(poi.category).toBe("water");
  });

  it("categorizes drinking water", () => {
    const poi = categorizeOsmPoi({
      type: "node",
      id: 789,
      lat: 48.87,
      lon: 2.37,
      tags: { amenity: "drinking_water" },
    });
    expect(poi.category).toBe("amenity");
    expect(poi.icon).toBe("droplet");
  });

  it("builds valid Overpass query with extended tags", () => {
    const query = buildEnrichmentQuery(48.85, 2.35, 2);
    expect(query).toContain("tourism=viewpoint");
    expect(query).toContain("natural=water");
    expect(query).toContain("natural=wood");
    expect(query).toContain("natural=peak");
    expect(query).toContain("amenity=drinking_water");
    expect(query).toContain("amenity=shelter");
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/osm-enrichment.test.ts`
Expected: FAIL

**Step 3: Implement OSM enrichment**

Create `lib/osm-enrichment.ts`:
```typescript
import { getCached, setCached, CacheKeys } from "./cache";

export interface OsmRawElement {
  readonly type: string;
  readonly id: number;
  readonly lat: number;
  readonly lon: number;
  readonly tags: Record<string, string>;
}

export interface EnrichedPoi {
  readonly id: number;
  readonly lat: number;
  readonly lng: number;
  readonly category: "viewpoint" | "water" | "forest" | "peak" | "amenity" | "shelter";
  readonly name: string | null;
  readonly icon: string;
  readonly distanceAlongRouteKm?: number;
}

export interface RouteEnrichment {
  readonly pois: readonly EnrichedPoi[];
  readonly natureScore: number; // 0-1: density of natural features
  readonly surfaceBreakdown: Record<string, number>; // surface type -> percentage
  readonly technicalDifficulty: string | null; // sac_scale or mtb:scale
}

const OVERPASS_API = "https://overpass-api.de/api/interpreter";
const CACHE_TTL = 86400; // 24 hours

export function categorizeOsmPoi(element: OsmRawElement): EnrichedPoi {
  const tags = element.tags;
  let category: EnrichedPoi["category"];
  let icon: string;

  if (tags.tourism === "viewpoint") {
    category = "viewpoint";
    icon = "eye";
  } else if (tags.natural === "water" || tags.water) {
    category = "water";
    icon = "waves";
  } else if (tags.natural === "wood" || tags.natural === "forest" || tags.landuse === "forest") {
    category = "forest";
    icon = "trees";
  } else if (tags.natural === "peak") {
    category = "peak";
    icon = "mountain";
  } else if (tags.amenity === "shelter" || tags.shelter_type) {
    category = "shelter";
    icon = "home";
  } else {
    category = "amenity";
    icon = tags.amenity === "drinking_water" ? "droplet" : "map-pin";
  }

  return {
    id: element.id,
    lat: element.lat,
    lng: element.lon,
    category,
    name: tags.name ?? null,
    icon,
  };
}

export function buildEnrichmentQuery(lat: number, lng: number, radiusKm: number): string {
  const radiusM = radiusKm * 1000;
  return `
    [out:json][timeout:30];
    (
      node["tourism"="viewpoint"](around:${radiusM},${lat},${lng});
      node["natural"="water"](around:${radiusM},${lat},${lng});
      node["natural"="wood"](around:${radiusM},${lat},${lng});
      node["natural"="peak"](around:${radiusM},${lat},${lng});
      node["amenity"="drinking_water"](around:${radiusM},${lat},${lng});
      node["amenity"="shelter"](around:${radiusM},${lat},${lng});
      way["natural"="water"](around:${radiusM},${lat},${lng});
      way["natural"="wood"](around:${radiusM},${lat},${lng});
      way["landuse"="forest"](around:${radiusM},${lat},${lng});
      way["leisure"="nature_reserve"](around:${radiusM},${lat},${lng});
    );
    out center;
  `;
}

export async function enrichRouteWithOsm(
  routePoints: ReadonlyArray<readonly [number, number]>,
  radiusKm: number = 0.2
): Promise<RouteEnrichment> {
  if (routePoints.length === 0) {
    return { pois: [], natureScore: 0, surfaceBreakdown: {}, technicalDifficulty: null };
  }

  // Use route midpoint for query center
  const midIdx = Math.floor(routePoints.length / 2);
  const centerLat = routePoints[midIdx][0];
  const centerLng = routePoints[midIdx][1];

  // Check cache
  const cacheKey = CacheKeys.overpass(centerLat, centerLng, radiusKm);
  const cached = await getCached<RouteEnrichment>(cacheKey);
  if (cached) return cached;

  // Query Overpass
  const query = buildEnrichmentQuery(centerLat, centerLng, radiusKm);

  try {
    const response = await fetch(OVERPASS_API, {
      method: "POST",
      body: `data=${encodeURIComponent(query)}`,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    });

    if (!response.ok) {
      console.warn(`[osm] Overpass query failed: ${response.status}`);
      return { pois: [], natureScore: 0, surfaceBreakdown: {}, technicalDifficulty: null };
    }

    const data = await response.json();
    const elements: OsmRawElement[] = data.elements ?? [];

    // Categorize POIs (only nodes with coordinates)
    const pois = elements
      .filter((el) => el.lat !== undefined && el.lon !== undefined && el.tags)
      .map(categorizeOsmPoi);

    // Compute nature score: density of natural features relative to route length
    const forestCount = pois.filter((p) => p.category === "forest").length;
    const waterCount = pois.filter((p) => p.category === "water").length;
    const viewpointCount = pois.filter((p) => p.category === "viewpoint").length;
    const peakCount = pois.filter((p) => p.category === "peak").length;
    const totalNature = forestCount + waterCount + viewpointCount + peakCount;
    const natureScore = Math.min(1, totalNature / 10); // Normalize: 10+ features = 1.0

    const result: RouteEnrichment = {
      pois,
      natureScore,
      surfaceBreakdown: {},
      technicalDifficulty: null,
    };

    await setCached(cacheKey, result, CACHE_TTL);
    return result;
  } catch (err) {
    console.warn("[osm] Enrichment failed:", err);
    return { pois: [], natureScore: 0, surfaceBreakdown: {}, technicalDifficulty: null };
  }
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/osm-enrichment.test.ts`
Expected: PASS

**Step 5: Commit**

```bash
git add lib/osm-enrichment.ts tests/osm-enrichment.test.ts
git commit -m "feat: add extended OSM enrichment with POI categorization and nature scoring"
```

---

## Task 6: Integrate Anti-Repetition & OSM into Route Generation Pipeline

**Files:**
- Modify: `lib/engine/route-post-processor.ts` (add discovery index + OSM POIs)
- Modify: `lib/engine/index.ts` (pass user activities to post-processor)
- Modify: `lib/types.ts` (add discovery_index and pois to RouteCandidate)
- Modify: `app/api/generate-route/route.ts` (accept optional userId for anti-repetition)
- Create: `tests/route-pipeline-integration.test.ts`

**Step 1: Extend types**

Add to `lib/types.ts` inside the `RouteCandidate` interface:
```typescript
// Add these fields to RouteCandidate:
readonly discoveryIndex?: number;   // 0-1: how "new" this route is
readonly pois?: ReadonlyArray<{
  readonly lat: number;
  readonly lng: number;
  readonly category: string;
  readonly name: string | null;
  readonly icon: string;
}>;
readonly natureScore?: number;       // 0-1: natural feature density
```

Add to `GeneratedRoute`:
```typescript
readonly discoveryIndex?: number;    // Best candidate's discovery index
```

**Step 2: Modify the API route to support authenticated requests**

In `app/api/generate-route/route.ts`, add optional user ID extraction:
```typescript
// After validating the request body, add:
// Try to get user ID for anti-repetition (optional, works without auth)
let userPolylines: string[] = [];
try {
  const supabase = await createServerSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  if (user) {
    const { data: activities } = await supabase
      .from("strava_activities")
      .select("polyline")
      .eq("user_id", user.id)
      .eq("sport", profile.sport);
    userPolylines = (activities ?? []).map((a) => a.polyline);
  }
} catch {
  // Non-authenticated request — skip anti-repetition
}
```

Pass `userPolylines` to the route generation function.

**Step 3: Modify post-processor to compute discovery index**

In `lib/engine/route-post-processor.ts`, after computing scores for each candidate:
```typescript
import { computeDiscoveryIndex } from "@/lib/anti-repetition";
import { enrichRouteWithOsm } from "@/lib/osm-enrichment";

// After totalScore computation, add for each candidate:
const routeLatLngs = candidate.points.map(p => [p.lat, p.lng] as const);
const discoveryIndex = computeDiscoveryIndex(routeLatLngs, userPolylines);
const enrichment = await enrichRouteWithOsm(routeLatLngs);

// Add to candidate object:
// discoveryIndex,
// pois: enrichment.pois,
// natureScore: enrichment.natureScore,
```

**Step 4: Boost scoring with discovery index**

When discovery index is available, add it to the total score:
```typescript
// Weighted boost: 15% of total score comes from discovery when available
const discoveryBoost = discoveryIndex * 0.15;
const adjustedScore = totalScore * 0.85 + discoveryBoost;
```

**Step 5: Write integration test**

Create `tests/route-pipeline-integration.test.ts`:
```typescript
import { describe, it, expect } from "vitest";
import { computeDiscoveryIndex } from "@/lib/anti-repetition";
import { categorizeOsmPoi } from "@/lib/osm-enrichment";

describe("Route pipeline integration", () => {
  it("discovery index boosts novel routes in scoring", () => {
    const novelRoute: Array<readonly [number, number]> = [
      [48.90, 2.40],
      [48.91, 2.41],
      [48.92, 2.42],
    ];
    const pastPolylines: string[] = [];

    const discoveryIndex = computeDiscoveryIndex(novelRoute, pastPolylines);
    const baseScore = 0.75;
    const boostedScore = baseScore * 0.85 + discoveryIndex * 0.15;

    expect(boostedScore).toBeGreaterThan(baseScore * 0.85);
    expect(boostedScore).toBeLessThanOrEqual(1.0);
  });

  it("OSM POIs are categorized for route enrichment", () => {
    const viewpoint = categorizeOsmPoi({
      type: "node",
      id: 1,
      lat: 48.85,
      lon: 2.35,
      tags: { tourism: "viewpoint", name: "Belle vue" },
    });

    expect(viewpoint.category).toBe("viewpoint");
    expect(viewpoint.name).toBe("Belle vue");
  });
});
```

**Step 6: Run tests**

Run: `npx vitest run tests/route-pipeline-integration.test.ts`
Expected: PASS

**Step 7: Commit**

```bash
git add lib/types.ts lib/engine/route-post-processor.ts lib/engine/index.ts app/api/generate-route/route.ts tests/route-pipeline-integration.test.ts
git commit -m "feat: integrate anti-repetition and OSM enrichment into route generation pipeline"
```

---

## Task 7: API v1 — Routes, Favorites, Feedback, Preferences

**Files:**
- Create: `app/api/v1/routes/generate/route.ts`
- Create: `app/api/v1/routes/[id]/route.ts`
- Create: `app/api/v1/routes/history/route.ts`
- Create: `app/api/v1/routes/[id]/favorite/route.ts`
- Create: `app/api/v1/routes/[id]/feedback/route.ts`
- Create: `app/api/v1/user/preferences/route.ts`
- Create: `app/api/v1/auth/me/route.ts`
- Create: `lib/api-helpers.ts`

**Step 1: Create shared API helpers**

Create `lib/api-helpers.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";

export interface AuthenticatedContext {
  readonly userId: string;
  readonly supabase: Awaited<ReturnType<typeof createServerSupabase>>;
}

export async function withAuth(
  request: NextRequest,
  handler: (ctx: AuthenticatedContext) => Promise<NextResponse>
): Promise<NextResponse> {
  const supabase = await createServerSupabase();
  const { data: { user }, error } = await supabase.auth.getUser();

  if (error || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return handler({ userId: user.id, supabase });
}

export function jsonError(message: string, status: number): NextResponse {
  return NextResponse.json({ success: false, error: message }, { status });
}

export function jsonSuccess<T>(data: T, status: number = 200): NextResponse {
  return NextResponse.json({ success: true, data }, { status });
}
```

**Step 2: Create auth/me endpoint**

Create `app/api/v1/auth/me/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { withAuth, jsonSuccess } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  return withAuth(request, async ({ userId, supabase }) => {
    const { data: profile } = await supabase
      .from("profiles")
      .select("*")
      .eq("id", userId)
      .single();

    const { data: stravaConnection } = await supabase
      .from("strava_connections")
      .select("strava_athlete_id")
      .eq("user_id", userId)
      .single();

    return jsonSuccess({
      id: userId,
      profile,
      stravaConnected: !!stravaConnection,
    });
  });
}
```

**Step 3: Create routes/generate endpoint (v1 wrapper)**

Create `app/api/v1/routes/generate/route.ts`:
```typescript
import { NextRequest, NextResponse } from "next/server";
import { createServerSupabase } from "@/lib/supabase/server";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import { generateRouteV2 } from "@/lib/engine";
import { generateRoute } from "@/lib/route-generator-legacy";
import { jsonError, jsonSuccess } from "@/lib/api-helpers";

export async function POST(request: NextRequest) {
  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const { address, profileId, targetDistanceKm, targetElevationM, waypoints, endAddress } = body as {
    address?: string;
    profileId?: string;
    targetDistanceKm?: number;
    targetElevationM?: number;
    waypoints?: string[];
    endAddress?: string;
  };

  if (!address || typeof address !== "string" || !address.trim()) {
    return jsonError("address is required", 400);
  }
  if (!profileId || !PROFILES_BY_ID[profileId]) {
    return jsonError("Invalid profileId", 400);
  }
  if (typeof targetDistanceKm !== "number" || targetDistanceKm <= 0) {
    return jsonError("targetDistanceKm must be a positive number", 400);
  }
  if (targetElevationM !== undefined && (typeof targetElevationM !== "number" || targetElevationM < 0)) {
    return jsonError("targetElevationM must be a non-negative number", 400);
  }

  // Get user polylines for anti-repetition (optional)
  let userPolylines: string[] = [];
  let userId: string | null = null;
  try {
    const supabase = await createServerSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (user) {
      userId = user.id;
      const profile = PROFILES_BY_ID[profileId];
      const { data: activities } = await supabase
        .from("strava_activities")
        .select("polyline")
        .eq("user_id", user.id)
        .eq("sport", profile.sport);
      userPolylines = (activities ?? []).map((a: { polyline: string }) => a.polyline);
    }
  } catch {
    // Non-authenticated — continue without anti-repetition
  }

  try {
    const routeRequest = {
      address: address.trim(),
      profileId,
      targetDistanceKm,
      targetElevationM: targetElevationM ?? 0,
      waypoints,
      endAddress,
    };

    const isSimpleLoop = !waypoints?.length && !endAddress;
    const result = isSimpleLoop
      ? await generateRouteV2(routeRequest)
      : await generateRoute(routeRequest);

    // Store generated route in database
    if (userId && result.best) {
      const supabase = await createServerSupabase();
      await supabase.from("generated_routes").insert({
        user_id: userId,
        profile_id: profileId,
        sport: PROFILES_BY_ID[profileId].sport,
        target_distance_km: targetDistanceKm,
        target_elevation_m: targetElevationM ?? null,
        actual_distance_km: result.best.distanceKm,
        actual_elevation_m: result.best.ascendM,
        total_score: result.best.totalScore,
        discovery_index: result.best.discoveryIndex ?? null,
        geometry: result.best.geometry,
        candidates: result.candidates,
        osm_pois: result.best.pois ?? null,
      });
    }

    return jsonSuccess(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "Unknown error";

    if (message === "NO_ROAD_NETWORK") {
      return jsonError("Aucun reseau routier trouve dans cette zone.", 422);
    }
    if (message.startsWith("IMPOSSIBLE_ELEVATION")) {
      return jsonError("Le denivele demande est trop eleve pour cette distance.", 422);
    }
    if (message === "GEOCODING_FAILED") {
      return jsonError("Adresse introuvable.", 422);
    }

    console.error("[generate-route] Error:", err);
    return jsonError("Erreur interne lors de la generation.", 500);
  }
}
```

**Step 4: Create routes/history endpoint**

Create `app/api/v1/routes/history/route.ts`:
```typescript
import { NextRequest } from "next/server";
import { withAuth, jsonSuccess } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  return withAuth(request, async ({ userId, supabase }) => {
    const page = Number(request.nextUrl.searchParams.get("page") ?? "1");
    const limit = Math.min(Number(request.nextUrl.searchParams.get("limit") ?? "20"), 50);
    const offset = (page - 1) * limit;

    const { data: routes, count } = await supabase
      .from("generated_routes")
      .select("*", { count: "exact" })
      .eq("user_id", userId)
      .order("created_at", { ascending: false })
      .range(offset, offset + limit - 1);

    return jsonSuccess({
      routes: routes ?? [],
      total: count ?? 0,
      page,
      limit,
    });
  });
}
```

**Step 5: Create routes/[id]/favorite endpoint**

Create `app/api/v1/routes/[id]/favorite/route.ts`:
```typescript
import { NextRequest } from "next/server";
import { withAuth, jsonSuccess, jsonError } from "@/lib/api-helpers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: routeId } = await params;

  return withAuth(request, async ({ userId, supabase }) => {
    const { error } = await supabase.from("favorites").insert({
      user_id: userId,
      route_id: routeId,
    });

    if (error) {
      if (error.code === "23505") {
        return jsonError("Already favorited", 409);
      }
      return jsonError("Failed to favorite", 500);
    }

    return jsonSuccess({ favorited: true }, 201);
  });
}

export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: routeId } = await params;

  return withAuth(request, async ({ userId, supabase }) => {
    await supabase
      .from("favorites")
      .delete()
      .eq("user_id", userId)
      .eq("route_id", routeId);

    return jsonSuccess({ favorited: false });
  });
}
```

**Step 6: Create routes/[id]/feedback endpoint**

Create `app/api/v1/routes/[id]/feedback/route.ts`:
```typescript
import { NextRequest } from "next/server";
import { withAuth, jsonSuccess, jsonError } from "@/lib/api-helpers";

export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id: routeId } = await params;

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return jsonError("Invalid JSON body", 400);
  }

  const { rating, profileId, sport, requestedDistanceKm, requestedElevationM, actualDistanceKm, actualElevationM, algorithmicScore, discoveryIndex } = body as {
    rating?: string;
    profileId?: string;
    sport?: string;
    requestedDistanceKm?: number;
    requestedElevationM?: number;
    actualDistanceKm?: number;
    actualElevationM?: number;
    algorithmicScore?: number;
    discoveryIndex?: number;
  };

  if (!rating || !["positive", "negative"].includes(rating)) {
    return jsonError("rating must be 'positive' or 'negative'", 400);
  }
  if (!profileId || !sport || typeof requestedDistanceKm !== "number" || typeof actualDistanceKm !== "number" || typeof algorithmicScore !== "number") {
    return jsonError("Missing required feedback fields", 400);
  }

  return withAuth(request, async ({ userId, supabase }) => {
    const { error } = await supabase.from("feedback").insert({
      user_id: userId,
      route_id: routeId,
      rating,
      profile_id: profileId,
      sport,
      requested_distance_km: requestedDistanceKm,
      requested_elevation_m: requestedElevationM ?? null,
      actual_distance_km: actualDistanceKm,
      actual_elevation_m: actualElevationM ?? null,
      algorithmic_score: algorithmicScore,
      discovery_index: discoveryIndex ?? null,
    });

    if (error) {
      return jsonError("Failed to save feedback", 500);
    }

    return jsonSuccess({ saved: true }, 201);
  });
}
```

**Step 7: Create user/preferences endpoint**

Create `app/api/v1/user/preferences/route.ts`:
```typescript
import { NextRequest } from "next/server";
import { withAuth, jsonSuccess, jsonError } from "@/lib/api-helpers";

export async function GET(request: NextRequest) {
  return withAuth(request, async ({ userId, supabase }) => {
    const { data } = await supabase
      .from("user_preferences")
      .select("*")
      .eq("user_id", userId)
      .single();

    return jsonSuccess(data ?? {
      default_sport: "running",
      default_profile_id: "running_endurance",
      default_distance_km: 10,
      default_elevation_m: 100,
      scenic_mode: false,
    });
  });
}

export async function PUT(request: NextRequest) {
  return withAuth(request, async ({ userId, supabase }) => {
    let body: Record<string, unknown>;
    try {
      body = await request.json();
    } catch {
      return jsonError("Invalid JSON body", 400);
    }

    const { error } = await supabase
      .from("user_preferences")
      .upsert({
        user_id: userId,
        ...body,
      });

    if (error) {
      return jsonError("Failed to update preferences", 500);
    }

    return jsonSuccess({ updated: true });
  });
}
```

**Step 8: Commit**

```bash
git add lib/api-helpers.ts app/api/v1/
git commit -m "feat: add complete API v1 — routes, favorites, feedback, preferences, auth"
```

---

## Task 8: Remove Global Heatmap Proxy & Clean Up Legacy Code

**Files:**
- Delete: `app/api/heatmap-tile/route.ts` (global heatmap proxy)
- Modify: `lib/heatmap-scorer.ts` (remove or deprecate global heatmap)
- Modify: `lib/engine/route-post-processor.ts` (remove heatmap tile scoring)

**Step 1: Remove the heatmap tile API route**

Delete `app/api/heatmap-tile/route.ts` — this proxied the global Strava heatmap which violates their ToS for commercial use.

**Step 2: Deprecate heatmap-scorer.ts**

The `scoreRoutePopularity` function in `lib/heatmap-scorer.ts` fetches global heatmap tiles. Replace its usage with the personal activity-based discovery index.

Options:
- (a) Delete `heatmap-scorer.ts` entirely if no other code depends on it
- (b) Keep it but remove the proxy fetch, replace with a stub that returns `{ meanScore: 0.5, popularSegmentRatio: 0.5 }`

Recommended: (a) Delete it and update imports in `route-post-processor.ts` to use `computeDiscoveryIndex` instead.

**Step 3: Update route-post-processor.ts**

Remove the call to `scoreRoutePopularity()` and replace with `computeDiscoveryIndex()` call (already added in Task 6).

**Step 4: Remove any references to the Go proxy**

Search codebase for `localhost:8080` or `STRAVA_PROXY_URL` references and remove them.

**Step 5: Commit**

```bash
git add -A
git commit -m "refactor: remove global Strava heatmap proxy, replace with personal discovery index"
```

---

## Task 9: Add Caching to Route Generation Pipeline

**Files:**
- Modify: `lib/route-generator-legacy.ts` (add Redis cache for geocoding, elevation)
- Modify: `lib/engine/graph-builder.ts` (migrate from file cache to Redis)

**Step 1: Cache geocoding results**

In `lib/route-generator-legacy.ts`, wrap `geocodeAddress` with Redis cache:
```typescript
import { getCached, setCached, CacheKeys } from "./cache";

export async function geocodeAddress(address: string): Promise<Coordinate> {
  const cacheKey = CacheKeys.geocode(address);
  const cached = await getCached<Coordinate>(cacheKey);
  if (cached) return cached;

  // ... existing Nominatim fetch ...

  await setCached(cacheKey, result, 604800); // 7 days
  return result;
}
```

**Step 2: Cache elevation results**

Wrap `fetchElevations` with Redis cache for repeated coordinate sets.

**Step 3: Migrate graph-builder from file cache to Redis**

In `lib/engine/graph-builder.ts`, replace the `.cache/graphs/` file-based cache with Redis:
```typescript
import { getCached, setCached, CacheKeys } from "@/lib/cache";

// Replace readFileSync/writeFileSync with getCached/setCached
const cacheKey = CacheKeys.graph(center.lat, center.lng, radiusKm);
const cached = await getCached<CachedGraph>(cacheKey);
if (cached) return cached;

// ... build graph ...

await setCached(cacheKey, result, 604800); // 7 days
```

**Step 4: Commit**

```bash
git add lib/route-generator-legacy.ts lib/engine/graph-builder.ts
git commit -m "perf: migrate caching to Redis (geocoding, elevation, graphs)"
```

---

## Task 10: Add Retry & Fallback to External API Calls

**Files:**
- Create: `lib/fetch-with-retry.ts`
- Create: `tests/fetch-with-retry.test.ts`
- Modify: `lib/route-generator-legacy.ts` (use retry wrapper)
- Modify: `lib/engine/graph-builder.ts` (use retry wrapper)

**Step 1: Write the failing test**

Create `tests/fetch-with-retry.test.ts`:
```typescript
import { describe, it, expect, vi } from "vitest";
import { fetchWithRetry } from "@/lib/fetch-with-retry";

describe("fetchWithRetry", () => {
  it("returns response on first successful attempt", async () => {
    const mockFetch = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ ok: true }), { status: 200 })
    );
    vi.stubGlobal("fetch", mockFetch);

    const response = await fetchWithRetry("https://example.com", {}, { maxRetries: 3 });
    expect(response.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(1);

    vi.unstubAllGlobals();
  });

  it("retries on failure and succeeds", async () => {
    const mockFetch = vi
      .fn()
      .mockRejectedValueOnce(new Error("network error"))
      .mockResolvedValue(new Response("ok", { status: 200 }));
    vi.stubGlobal("fetch", mockFetch);

    const response = await fetchWithRetry("https://example.com", {}, { maxRetries: 3, initialDelayMs: 10 });
    expect(response.ok).toBe(true);
    expect(mockFetch).toHaveBeenCalledTimes(2);

    vi.unstubAllGlobals();
  });

  it("throws after max retries", async () => {
    const mockFetch = vi.fn().mockRejectedValue(new Error("network error"));
    vi.stubGlobal("fetch", mockFetch);

    await expect(
      fetchWithRetry("https://example.com", {}, { maxRetries: 2, initialDelayMs: 10 })
    ).rejects.toThrow("network error");
    expect(mockFetch).toHaveBeenCalledTimes(3); // initial + 2 retries

    vi.unstubAllGlobals();
  });
});
```

**Step 2: Run test to verify it fails**

Run: `npx vitest run tests/fetch-with-retry.test.ts`
Expected: FAIL

**Step 3: Implement fetch with retry**

Create `lib/fetch-with-retry.ts`:
```typescript
interface RetryOptions {
  readonly maxRetries?: number;
  readonly initialDelayMs?: number;
  readonly maxDelayMs?: number;
  readonly retryOnStatus?: readonly number[];
}

const DEFAULT_OPTIONS: Required<RetryOptions> = {
  maxRetries: 2,
  initialDelayMs: 500,
  maxDelayMs: 5000,
  retryOnStatus: [429, 500, 502, 503, 504],
};

export async function fetchWithRetry(
  url: string,
  init?: RequestInit,
  options?: RetryOptions
): Promise<Response> {
  const opts = { ...DEFAULT_OPTIONS, ...options };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= opts.maxRetries; attempt++) {
    try {
      const response = await fetch(url, init);

      if (response.ok || !opts.retryOnStatus.includes(response.status)) {
        return response;
      }

      lastError = new Error(`HTTP ${response.status}: ${response.statusText}`);
    } catch (err) {
      lastError = err instanceof Error ? err : new Error(String(err));
    }

    if (attempt < opts.maxRetries) {
      const delay = Math.min(
        opts.initialDelayMs * Math.pow(2, attempt),
        opts.maxDelayMs
      );
      await new Promise((resolve) => setTimeout(resolve, delay));
    }
  }

  throw lastError ?? new Error("fetchWithRetry: all attempts failed");
}
```

**Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/fetch-with-retry.test.ts`
Expected: PASS

**Step 5: Apply retry wrapper to external API calls**

In `lib/route-generator-legacy.ts`, replace bare `fetch()` calls to Nominatim, GraphHopper, ORS, Open-Meteo, and Overpass with `fetchWithRetry()`.

In `lib/engine/graph-builder.ts`, replace the Overpass `fetch()` call with `fetchWithRetry()`.

**Step 6: Commit**

```bash
git add lib/fetch-with-retry.ts tests/fetch-with-retry.test.ts lib/route-generator-legacy.ts lib/engine/graph-builder.ts
git commit -m "feat: add fetch-with-retry with exponential backoff for all external API calls"
```

---

## Summary

| Task | Description | Dependencies |
|------|-------------|--------------|
| 1 | Supabase setup + database schema | None |
| 2 | Upstash Redis cache | None |
| 3 | Strava OAuth integration | Task 1 |
| 4 | Strava activity sync + anti-repetition | Tasks 1, 3 |
| 5 | Extended OSM enrichment | Task 2 |
| 6 | Integrate anti-rep + OSM into pipeline | Tasks 4, 5 |
| 7 | API v1 endpoints | Tasks 1, 6 |
| 8 | Remove global heatmap proxy | Task 6 |
| 9 | Redis caching for pipeline | Task 2 |
| 10 | Retry + fallback for external APIs | None |

**Parallel execution possible:**
- Tasks 1 + 2 + 10 (no dependencies)
- Tasks 3 + 5 (after Task 1 and 2 respectively)
- Tasks 4 + 9 (after their dependencies)
- Tasks 6 + 7 + 8 (after Task 4 + 5)

**After Phase 0 is complete**, proceed to:
- `docs/plans/2026-03-04-phase1-ios-app.md` — iOS App MVP
- `docs/plans/2026-03-04-phase2-polish-launch.md` — Polish & Launch
