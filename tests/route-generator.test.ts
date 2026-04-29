import { describe, it, expect } from "vitest";
import { scoreRoute, computeAscent, haversineKm } from "@/lib/route-generator-legacy";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import { generateGPX } from "@/lib/gpx-export";
import type { GeneratedRoute, RoutePoint } from "@/lib/types";

// ─── Helpers ─────────────────────────────────────────────────────────────────

function mockCandidate(opts: {
  ascendM: number;
  distanceKm: number;
  surfaceScore?: number;
  loopScore?: number;
}) {
  return {
    ascendM: opts.ascendM,
    distanceKm: opts.distanceKm,
    surfaceScore: opts.surfaceScore ?? 0.8,
    loopScore: opts.loopScore ?? 0.8,
  };
}

function mockPoints(count: number): RoutePoint[] {
  return Array.from({ length: count }, (_, i) => ({
    lat: 48.8566 + i * 0.001,
    lng: 2.3522 + i * 0.001,
    elevation: 80 + Math.sin(i * 0.3) * 20,
  }));
}

function mockGeneratedRoute(pointCount: number): GeneratedRoute {
  const profile = PROFILES_BY_ID.get("running_endurance")!;
  const points = mockPoints(pointCount);
  return {
    best: {
      points,
      distanceKm: 12.5,
      durationSeconds: 3600,
      ascendM: 180,
      descendM: 178,
      surfaceScore: 0.7,
      loopScore: 0.9,
      totalScore: 0.75,
      geometry: {
        type: "LineString",
        coordinates: points.map((p) => [p.lng, p.lat]),
      },
    },
    candidates: [],
    startCoordinate: { lat: 48.8566, lng: 2.3522 },
    profile,
  };
}

// ─── Test 1: Flat route scores better for intervals ───────────────────────────

describe("scoreRoute — intervals prefers flat terrain", () => {
  it("flat route scores higher than hilly for running_intervals", () => {
    const profile = PROFILES_BY_ID.get("running_intervals");
    expect(profile).toBeDefined();

    const flat = mockCandidate({ ascendM: 20, distanceKm: 8, surfaceScore: 0.85 });
    const hilly = mockCandidate({ ascendM: 300, distanceKm: 8, surfaceScore: 0.85 });

    const flatScore = scoreRoute(flat, profile!, 8, 30);
    const hillyScore = scoreRoute(hilly, profile!, 8, 30);

    expect(flatScore).toBeGreaterThan(hillyScore);
  });
});

// ─── Test 2: Hilly route scores better for gran fondo ────────────────────────

describe("scoreRoute — gran fondo prefers high D+", () => {
  it("hilly route scores higher when D+ target is high", () => {
    const profile = PROFILES_BY_ID.get("cycling_road_gran_fondo");
    expect(profile).toBeDefined();

    const flat = mockCandidate({ ascendM: 200, distanceKm: 130, surfaceScore: 1.0 });
    const hilly = mockCandidate({ ascendM: 2000, distanceKm: 130, surfaceScore: 1.0 });

    const flatScore = scoreRoute(flat, profile!, 130, 2000);
    const hillyScore = scoreRoute(hilly, profile!, 130, 2000);

    expect(hillyScore).toBeGreaterThan(flatScore);
  });
});

// ─── Test 3: GPX output is valid XML with correct trkpt count ────────────────

describe("generateGPX", () => {
  it("produces valid GPX XML with correct trkpt count", () => {
    const route = mockGeneratedRoute(50);
    const gpx = generateGPX(route);

    expect(gpx).toContain('<?xml version="1.0"');
    expect(gpx).toContain('xmlns="http://www.topografix.com/GPX/1/1"');
    expect(gpx).toContain("<trkseg>");
    expect(gpx).toContain("</trkseg>");

    const trkptMatches = gpx.match(/<trkpt /g);
    expect(trkptMatches).not.toBeNull();
    expect(trkptMatches!.length).toBe(50);

    expect(gpx).toContain("lat=");
    expect(gpx).toContain("lon=");
    expect(gpx).toContain("<ele>");
    expect(gpx).toContain("<time>");
  });

  it("produces a parseable XML document", () => {
    const route = mockGeneratedRoute(10);
    const gpx = generateGPX(route);

    // Validate it starts and ends with proper GPX tags
    expect(gpx.trim()).toMatch(/^<\?xml/);
    expect(gpx.trim()).toMatch(/<\/gpx>\s*$/);
  });

  it("brands the GPX as TrailForge and embeds route quality metadata", () => {
    const route = mockGeneratedRoute(10);
    route.best.quality = {
      distanceErrorPct: 0.02,
      elevationErrorPct: 0.08,
      loopGapKm: 0.12,
      busyRoadRatio: 0.03,
      trailRatio: 0.41,
      restrictedAccessRatio: 0,
      onewayViolationRatio: 0,
      repeatEdgeRatio: 0.01,
      intersectionDensityPerKm: 4,
      productionScore: 0.82,
      warnings: ["DISTANCE_OFF_TARGET"],
    };

    const gpx = generateGPX(route);

    expect(gpx).toContain('creator="TrailForge"');
    expect(gpx).toContain("<keywords>TrailForge,GPX,running</keywords>");
    expect(gpx).toContain("<trailforge:productionScore>0.82</trailforge:productionScore>");
    expect(gpx).toContain("<trailforge:naturalWayRatio>0.41</trailforge:naturalWayRatio>");
    expect(gpx).toContain("<trailforge:warning>DISTANCE_OFF_TARGET</trailforge:warning>");
  });
});

// ─── Test 4: Haversine distance formula ──────────────────────────────────────

describe("haversineKm", () => {
  it("correctly estimates Paris–Lyon distance (~392km)", () => {
    const paris = { lat: 48.8566, lng: 2.3522 };
    const lyon = { lat: 45.764, lng: 4.8357 };
    const dist = haversineKm(paris, lyon);
    expect(dist).toBeGreaterThan(380);
    expect(dist).toBeLessThan(410);
  });

  it("returns ~0 for the same point", () => {
    const pt = { lat: 48.8566, lng: 2.3522 };
    expect(haversineKm(pt, pt)).toBeCloseTo(0, 3);
  });
});

// ─── Test 5: computeAscent ───────────────────────────────────────────────────

describe("computeAscent", () => {
  it("correctly sums positive elevation differences", () => {
    const elevations = [100, 110, 105, 120, 115, 130];
    const { ascendM, descendM } = computeAscent(elevations);
    // Gains: 10, 15, 15 = 40m
    expect(ascendM).toBeCloseTo(40, 1);
    // Losses: 5, 5 = 10m
    expect(descendM).toBeCloseTo(10, 1);
  });

  it("returns 0 for a flat route", () => {
    const flat = [100, 100, 100, 100];
    const { ascendM, descendM } = computeAscent(flat);
    expect(ascendM).toBe(0);
    expect(descendM).toBe(0);
  });
});
