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

export interface RouteV3ExportValidationInput {
  polyline: readonly RouteV3PolylinePoint[];
  metricDistanceKm?: number | null;
  loop?: boolean;
  /**
   * V3 currently exports graph-node polylines, not full OSM way geometries. A segment above
   * 200 m is a product-risk jump for a runner app unless future evidence carries intermediate
   * way geometry; this gate deliberately blocks Brunoy-like straight-line teleports.
   */
  maxSegmentKm?: number;
  /** Loop starts/ends should be close enough that GPX importers do not draw a final cross-town leg. */
  maxClosureKm?: number;
  /** Allows small graph-edge-vs-haversine differences without accepting a different route. */
  distanceToleranceRatio?: number;
  distanceToleranceKm?: number;
}

export interface RouteV3ExportValidation {
  valid: boolean;
  reasons: string[];
  pointCount: number;
  distanceKm: number;
  metricDistanceKm: number | null;
  distanceDeltaKm: number | null;
  distanceToleranceKm: number | null;
  maxSegmentKm: number;
  closureKm: number | null;
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

export function validateRouteV3ExportConsistency(input: RouteV3ExportValidationInput): RouteV3ExportValidation {
  const maxAllowedSegmentKm = input.maxSegmentKm ?? 0.2;
  const maxAllowedClosureKm = input.maxClosureKm ?? 0.2;
  const distanceToleranceRatio = input.distanceToleranceRatio ?? 0.08;
  const baseDistanceToleranceKm = input.distanceToleranceKm ?? 0.25;
  const distanceKm = calculatePolylineDistanceKm(input.polyline);
  const metricDistanceKm = Number.isFinite(input.metricDistanceKm ?? Number.NaN) ? input.metricDistanceKm ?? null : null;
  const segments = segmentDistancesKm(input.polyline);
  const maxSegmentKm = segments.length > 0 ? Math.max(...segments) : 0;
  const closureKm = input.loop === true && input.polyline.length >= 2
    ? haversineKm(
      input.polyline[0].lat,
      input.polyline[0].lng,
      input.polyline[input.polyline.length - 1].lat,
      input.polyline[input.polyline.length - 1].lng,
    )
    : null;
  const distanceToleranceKm = metricDistanceKm !== null
    ? Math.max(baseDistanceToleranceKm, metricDistanceKm * distanceToleranceRatio)
    : null;
  const distanceDeltaKm = metricDistanceKm !== null ? Math.abs(distanceKm - metricDistanceKm) : null;
  const reasons: string[] = [];

  if (input.polyline.length < 2) reasons.push('point count below export minimum');
  input.polyline.forEach((point, index) => {
    if (!Number.isFinite(point.lat) || !Number.isFinite(point.lng)) {
      reasons.push(`invalid coordinate at index ${index}`);
    }
  });
  if (maxSegmentKm > maxAllowedSegmentKm) {
    reasons.push(`max segment jump ${round(maxSegmentKm)}km exceeds ${maxAllowedSegmentKm}km`);
  }
  if (closureKm !== null && closureKm > maxAllowedClosureKm) {
    reasons.push(`loop closure ${round(closureKm)}km exceeds ${maxAllowedClosureKm}km`);
  }
  if (distanceDeltaKm !== null && distanceToleranceKm !== null && distanceDeltaKm > distanceToleranceKm) {
    reasons.push(`distance mismatch ${round(distanceKm)}km vs metric ${round(metricDistanceKm ?? 0)}km exceeds ${round(distanceToleranceKm)}km tolerance`);
  }

  return {
    valid: reasons.length === 0,
    reasons,
    pointCount: input.polyline.length,
    distanceKm,
    metricDistanceKm,
    distanceDeltaKm,
    distanceToleranceKm,
    maxSegmentKm,
    closureKm,
  };
}

function segmentDistancesKm(polyline: readonly RouteV3PolylinePoint[]): number[] {
  const distances: number[] = [];
  for (let index = 1; index < polyline.length; index += 1) {
    const previous = polyline[index - 1];
    const current = polyline[index];
    distances.push(haversineKm(previous.lat, previous.lng, current.lat, current.lng));
  }
  return distances;
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

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
