import { describe, expect, it } from "vitest";
import {
  buildRouteV3ExportBundle,
  calculatePolylineDistanceKm,
  validateRouteV3ExportConsistency,
  type RouteV3PolylinePoint,
} from "@/lib/engine-v3/route-export";
import type { RouteEdgeV3 } from "@/lib/engine-v3/types";

const usefulRoutePolyline: RouteV3PolylinePoint[] = [
  { lat: 49.1771, lng: -0.6021, elevation: 42 },
  { lat: 49.1782, lng: -0.6044, elevation: 47 },
  { lat: 49.1801, lng: -0.6079, elevation: 55 },
  { lat: 49.1826, lng: -0.6102, elevation: 61 },
  { lat: 49.184, lng: -0.6063, elevation: 50 },
];

function extractGpxCoordinates(gpx: string): [number, number][] {
  return Array.from(gpx.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)">/g)).map((match) => [
    Number(match[2]),
    Number(match[1]),
  ]);
}

describe("buildRouteV3ExportBundle", () => {
  it("exports GeoJSON and GPX from the exact same V3 polyline source", () => {
    const bundle = buildRouteV3ExportBundle({
      id: "v3-tourville-useful-route",
      name: "Tourville V3 utile",
      sport: "running",
      polyline: usefulRoutePolyline,
    });

    const geojsonCoordinates = bundle.geojson.geometry.coordinates;
    const gpxCoordinates = extractGpxCoordinates(bundle.gpx);
    const expectedCoordinates = usefulRoutePolyline.map((point) => [point.lng, point.lat]);

    expect(bundle.distanceKm).toBeCloseTo(calculatePolylineDistanceKm(usefulRoutePolyline), 6);
    expect(bundle.geojson.properties?.distanceKm).toBeCloseTo(bundle.distanceKm, 6);
    expect(calculatePolylineDistanceKm(gpxCoordinates.map(([lng, lat]) => ({ lat, lng })))).toBeCloseTo(
      bundle.distanceKm,
      6,
    );
    expect(bundle.pointCount).toBe(usefulRoutePolyline.length);
    expect(bundle.geojson.properties?.pointCount).toBe(bundle.pointCount);
    expect(geojsonCoordinates).toHaveLength(usefulRoutePolyline.length);
    expect(gpxCoordinates).toHaveLength(usefulRoutePolyline.length);

    expect(geojsonCoordinates[0]).toEqual(expectedCoordinates[0]);
    expect(gpxCoordinates[0]).toEqual(expectedCoordinates[0]);
    expect(geojsonCoordinates.at(-1)).toEqual(expectedCoordinates.at(-1));
    expect(gpxCoordinates.at(-1)).toEqual(expectedCoordinates.at(-1));
    expect(geojsonCoordinates).toEqual(expectedCoordinates);
    expect(gpxCoordinates).toEqual(expectedCoordinates);
  });

  it("rejects a discontinuous V3 polyline before GPX is exposed", () => {
    const discontinuousPolyline: RouteV3PolylinePoint[] = [
      { lat: 48.6901, lng: 2.4921 },
      { lat: 48.6902, lng: 2.4924 },
      { lat: 48.7082, lng: 2.5288 },
      { lat: 48.6901, lng: 2.4921 },
    ];

    const validation = validateRouteV3ExportConsistency({
      polyline: discontinuousPolyline,
      metricDistanceKm: 8.11,
      loop: true,
    });

    expect(validation.valid).toBe(false);
    expect(validation.maxSegmentKm).toBeGreaterThan(0.2);
    expect(validation.reasons).toEqual(expect.arrayContaining([
      expect.stringContaining("max segment jump"),
      expect.stringContaining("distance mismatch"),
    ]));
  });

  it("allows a true long dirt track segment only when route-edge evidence matches the segment", () => {
    const polyline: RouteV3PolylinePoint[] = [
      { lat: 48.4048174, lng: 2.6679871 },
      { lat: 48.4005233, lng: 2.6673907 },
    ];
    const matchingEdge = edgeFixture({
      id: "1508627493-12901975860-808733631",
      lengthKm: 0.4795076331293016,
      highway: "track",
      surface: "natural",
      osmSurface: "dirt",
      osmWayId: 808733631,
    });

    const validation = validateRouteV3ExportConsistency({
      polyline,
      metricDistanceKm: 0.4795076331293016,
      loop: false,
      routeEdges: [matchingEdge],
    });

    expect(validation.valid).toBe(true);
    expect(validation.maxSegmentKm).toBeGreaterThan(0.2);
    expect(validation.reasons).toEqual([]);
    expect(validation.longSegmentAllowedByEdgeEvidence).toEqual([
      expect.objectContaining({
        segmentIndex: 0,
        edgeId: "1508627493-12901975860-808733631",
        osmWayId: 808733631,
        highway: "track",
        surface: "dirt",
        segmentMatchesRouteEdge: true,
      }),
    ]);
  });

  it("keeps a long chord blocked when no route-edge evidence proves it", () => {
    const validation = validateRouteV3ExportConsistency({
      polyline: longSegmentPolyline(),
      metricDistanceKm: 0.48,
      loop: false,
    });

    expect(validation.valid).toBe(false);
    expect(validation.reasons).toEqual(expect.arrayContaining([expect.stringContaining("max segment jump")]));
    expect(validation.longSegmentAllowedByEdgeEvidence).toEqual([]);
  });

  it("keeps a long segment blocked when route-edge length evidence mismatches the segment", () => {
    const validation = validateRouteV3ExportConsistency({
      polyline: longSegmentPolyline(),
      metricDistanceKm: 0.48,
      loop: false,
      routeEdges: [edgeFixture({ lengthKm: 0.12, highway: "track", surface: "natural", osmSurface: "dirt" })],
    });

    expect(validation.valid).toBe(false);
    expect(validation.reasons).toEqual(expect.arrayContaining([expect.stringContaining("max segment jump")]));
    expect(validation.longSegmentAllowedByEdgeEvidence).toEqual([]);
  });

  it("keeps a long segment blocked when matching edge evidence is present but in the wrong order", () => {
    const polyline: RouteV3PolylinePoint[] = [
      { lat: 48.4048174, lng: 2.6679871 },
      { lat: 48.4049, lng: 2.6681 },
      { lat: 48.4005233, lng: 2.6673907 },
    ];
    const validation = validateRouteV3ExportConsistency({
      polyline,
      metricDistanceKm: 0.49,
      loop: false,
      routeEdges: [
        edgeFixture({ id: "long-but-wrong-index", lengthKm: 0.48, highway: "track", surface: "natural", osmSurface: "dirt", osmWayId: 2 }),
        edgeFixture({ id: "short-at-long-segment-index", lengthKm: 0.01, highway: "track", surface: "natural", osmSurface: "dirt", osmWayId: 1 }),
      ],
    });

    expect(validation.valid).toBe(false);
    expect(validation.reasons).toEqual(expect.arrayContaining([expect.stringContaining("max segment jump")]));
    expect(validation.longSegmentAllowedByEdgeEvidence).toEqual([]);
  });

  it("keeps the Brunoy-style cross-town chord blocked even when total metric distance is coherent", () => {
    const brunoyChord: RouteV3PolylinePoint[] = [
      { lat: 48.6901, lng: 2.4921 },
      { lat: 48.6902, lng: 2.4924 },
      { lat: 48.7082, lng: 2.5288 },
      { lat: 48.6901, lng: 2.4921 },
    ];

    const validation = validateRouteV3ExportConsistency({
      polyline: brunoyChord,
      metricDistanceKm: calculatePolylineDistanceKm(brunoyChord),
      loop: true,
      routeEdges: [
        edgeFixture({ id: "local-1", lengthKm: 0.03, highway: "path", surface: "natural", osmSurface: "gravel" }),
        edgeFixture({ id: "suspicious-chord", lengthKm: 4.0, highway: "track" }),
        edgeFixture({ id: "local-2", lengthKm: 0.03, highway: "path", surface: "natural", osmSurface: "gravel" }),
      ],
    });

    expect(validation.valid).toBe(false);
    expect(validation.maxSegmentKm).toBeGreaterThan(0.2);
    expect(validation.reasons).toEqual(expect.arrayContaining([expect.stringContaining("max segment jump")]));
  });
});

function longSegmentPolyline(): RouteV3PolylinePoint[] {
  return [
    { lat: 48.4048174, lng: 2.6679871 },
    { lat: 48.4005233, lng: 2.6673907 },
  ];
}

function edgeFixture(overrides: Partial<RouteEdgeV3>): RouteEdgeV3 {
  return {
    id: overrides.id ?? "edge-1",
    from: overrides.from ?? "from-node",
    to: overrides.to ?? "to-node",
    lengthKm: overrides.lengthKm ?? 0.48,
    surface: overrides.surface ?? "natural",
    componentKind: overrides.componentKind ?? "field_paths",
    highway: overrides.highway ?? "track",
    osmWayId: overrides.osmWayId ?? 123,
    osmSurface: overrides.osmSurface,
  };
}
