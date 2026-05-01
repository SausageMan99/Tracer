import { describe, expect, it } from "vitest";
import { computeRouteGeometryMetrics } from "@/lib/engine/route-geometry-metrics";
import type { Coordinate } from "@/lib/types";

const squareLoop: Coordinate[] = [
  { lat: 49.0000, lng: -0.5000 },
  { lat: 49.0000, lng: -0.4900 },
  { lat: 49.0090, lng: -0.4900 },
  { lat: 49.0090, lng: -0.5000 },
  { lat: 49.0000, lng: -0.5000 },
];

describe("route geometry metrics", () => {
  it("computes loop area and compactness for a clean square loop", () => {
    const metrics = computeRouteGeometryMetrics(squareLoop, 4);

    expect(metrics.loopAreaKm2).toBeGreaterThan(0.6);
    expect(metrics.loopCompactness).toBeGreaterThan(0.15);
    expect(metrics.selfIntersectionCount).toBe(0);
    expect(metrics.geometryOverlapRatio).toBe(0);
  });

  it("detects self intersections on figure-eight geometry", () => {
    const figureEight: Coordinate[] = [
      { lat: 49.000, lng: -0.500 },
      { lat: 49.010, lng: -0.490 },
      { lat: 49.000, lng: -0.490 },
      { lat: 49.010, lng: -0.500 },
      { lat: 49.000, lng: -0.500 },
    ];

    const metrics = computeRouteGeometryMetrics(figureEight, 5);

    expect(metrics.selfIntersectionCount).toBeGreaterThan(0);
  });

  it("detects out-and-back similarity on mirrored paths", () => {
    const outAndBack: Coordinate[] = [
      { lat: 49.000, lng: -0.500 },
      { lat: 49.002, lng: -0.498 },
      { lat: 49.004, lng: -0.496 },
      { lat: 49.006, lng: -0.494 },
      { lat: 49.004, lng: -0.496 },
      { lat: 49.002, lng: -0.498 },
      { lat: 49.000, lng: -0.500 },
    ];

    const metrics = computeRouteGeometryMetrics(outAndBack, 3);

    expect(metrics.outAndBackSimilarityRatio).toBeGreaterThan(0.4);
    expect(metrics.geometryOverlapRatio).toBeGreaterThan(0);
  });
});
