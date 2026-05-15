import { describe, expect, it } from "vitest";
import {
  buildRouteV3ExportBundle,
  calculatePolylineDistanceKm,
  type RouteV3PolylinePoint,
} from "@/lib/engine-v3/route-export";

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
});
