import type { RouteCandidate, RoutePoint } from "./types";

export const EMPTY_COLLECTION: GeoJSON.FeatureCollection = {
  type: "FeatureCollection",
  features: [],
};

export interface RouteLineFeatureMetadata {
  id?: string;
  name?: string;
  distanceKm?: number;
  [key: string]: string | number | boolean | null | undefined;
}

export function buildRouteLineFeature(
  polyline: readonly RoutePoint[],
  metadata: RouteLineFeatureMetadata = {},
): GeoJSON.Feature<GeoJSON.LineString> {
  return {
    type: "Feature",
    geometry: {
      type: "LineString",
      coordinates: polyline.map((point) => [point.lng, point.lat]),
    },
    properties: {
      ...metadata,
      pointCount: polyline.length,
    },
  };
}

// ── Haversine (meters) ────────────────────────────────────────────────────────

function haversineM(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6_371_000;
  const φ1 = (lat1 * Math.PI) / 180;
  const φ2 = (lat2 * Math.PI) / 180;
  const dφ = ((lat2 - lat1) * Math.PI) / 180;
  const dλ = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dφ / 2) ** 2 +
    Math.cos(φ1) * Math.cos(φ2) * Math.sin(dλ / 2) ** 2;
  return R * 2 * Math.asin(Math.sqrt(a));
}

function buildSmoothedSlopes(candidate: RouteCandidate): number[] {
  const pts = candidate.points;
  if (pts.length < 2) return [];

  const rawSlopes: number[] = pts.slice(0, -1).map((a, i) => {
    const b = pts[i + 1];
    const distM = haversineM(a.lat, a.lng, b.lat, b.lng);
    const elevDiff = (b.elevation ?? 0) - (a.elevation ?? 0);
    return distM > 0.5 ? (elevDiff / distM) * 100 : 0;
  });

  return rawSlopes.map((_, i) => {
    const lo = Math.max(0, i - 1);
    const hi = Math.min(rawSlopes.length - 1, i + 1);
    const slice = rawSlopes.slice(lo, hi + 1);
    return slice.reduce((s, v) => s + v, 0) / slice.length;
  });
}

function slopeForGeometrySegment(slopes: number[], segmentIndex: number, segmentCount: number): number {
  if (slopes.length === 0) return 0;
  if (slopes.length === 1 || segmentCount <= 1) return slopes[0];

  const t = segmentIndex / Math.max(segmentCount - 1, 1);
  const slopeIndex = Math.max(0, Math.min(slopes.length - 1, Math.round(t * (slopes.length - 1))));
  return slopes[slopeIndex];
}

// ── Build slope-coloured segment FeatureCollection ───────────────────────────

export function buildSegmentCollection(candidate: RouteCandidate): GeoJSON.FeatureCollection {
  const coordinates = candidate.geometry.coordinates;
  if (coordinates.length < 2) return EMPTY_COLLECTION;

  const slopes = buildSmoothedSlopes(candidate);
  const segmentCount = coordinates.length - 1;

  const features: GeoJSON.Feature[] = coordinates.slice(0, -1).map((a, i) => {
    const b = coordinates[i + 1];
    const slope = slopeForGeometrySegment(slopes, i, segmentCount);

    return {
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [a, b],
      },
      properties: { slope: Math.max(-20, Math.min(20, slope)) },
    };
  });

  return { type: "FeatureCollection", features };
}

export function buildLineSegmentCollection(
  coordinates: readonly number[][],
  slope = 0,
): GeoJSON.FeatureCollection {
  if (coordinates.length < 2) return EMPTY_COLLECTION;

  return {
    type: "FeatureCollection",
    features: coordinates.slice(0, -1).map((a, i) => ({
      type: "Feature",
      geometry: {
        type: "LineString",
        coordinates: [a, coordinates[i + 1]],
      },
      properties: { slope },
    })),
  };
}
