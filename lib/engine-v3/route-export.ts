import { generateGPXFromPolyline } from "../gpx-export";
import { buildRouteLineFeature } from "../map-route-geojson";
import type { RoutePoint, Sport } from "../types";

export type RouteV3PolylinePoint = RoutePoint;

export interface RouteV3ExportInput {
  id: string;
  name: string;
  sport: Sport | string;
  polyline: readonly RouteV3PolylinePoint[];
  durationSeconds?: number;
}

export interface RouteV3ExportBundle {
  id: string;
  name: string;
  sport: Sport | string;
  distanceKm: number;
  pointCount: number;
  geojson: GeoJSON.Feature<GeoJSON.LineString>;
  gpx: string;
}

export function buildRouteV3ExportBundle(input: RouteV3ExportInput): RouteV3ExportBundle {
  assertUsablePolyline(input.polyline);

  const distanceKm = calculatePolylineDistanceKm(input.polyline);
  const pointCount = input.polyline.length;
  const geojson = buildRouteLineFeature(input.polyline, {
    id: input.id,
    name: input.name,
    sport: input.sport,
    distanceKm,
  });
  const gpx = generateGPXFromPolyline(input.polyline, {
    name: input.name,
    sport: input.sport,
    distanceKm,
    durationSeconds: input.durationSeconds,
  });

  return {
    id: input.id,
    name: input.name,
    sport: input.sport,
    distanceKm,
    pointCount,
    geojson,
    gpx,
  };
}

export function calculatePolylineDistanceKm(polyline: readonly RouteV3PolylinePoint[]): number {
  let distanceKm = 0;

  for (let index = 1; index < polyline.length; index += 1) {
    const previous = polyline[index - 1];
    const current = polyline[index];
    distanceKm += haversineKm(previous.lat, previous.lng, current.lat, current.lng);
  }

  return distanceKm;
}

function assertUsablePolyline(polyline: readonly RouteV3PolylinePoint[]): void {
  if (polyline.length < 2) {
    throw new Error("A V3 route export needs at least two polyline points.");
  }

  polyline.forEach((point, index) => {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
      throw new Error(`Invalid V3 polyline coordinate at index ${index}.`);
    }
  });
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const earthRadiusKm = 6_371;
  const phi1 = degreesToRadians(lat1);
  const phi2 = degreesToRadians(lat2);
  const deltaPhi = degreesToRadians(lat2 - lat1);
  const deltaLambda = degreesToRadians(lng2 - lng1);
  const a =
    Math.sin(deltaPhi / 2) ** 2 +
    Math.cos(phi1) * Math.cos(phi2) * Math.sin(deltaLambda / 2) ** 2;

  return earthRadiusKm * 2 * Math.asin(Math.sqrt(a));
}

function degreesToRadians(degrees: number): number {
  return (degrees * Math.PI) / 180;
}
