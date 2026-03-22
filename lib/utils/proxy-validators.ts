/**
 * Input validation helpers for proxy API routes.
 * Extracted to a separate file so they can be used by both route handlers
 * and unit tests without being exported from Next.js Route files
 * (Next.js 15 disallows arbitrary named exports from route modules).
 */

import type { Coordinate } from "../types";

export function validateParams(params: URLSearchParams): {
  lat: number;
  lng: number;
  radius: number;
} {
  const rawLat = params.get("lat");
  const rawLng = params.get("lng");
  const rawRadius = params.get("radius");
  if (rawLat === null || rawLng === null || rawRadius === null)
    throw new Error("Missing params");
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  const radius = Number(rawRadius);
  if (isNaN(lat) || isNaN(lng) || isNaN(radius))
    throw new Error("Missing params");
  if (radius > 25) throw new Error("Radius too large");
  if (radius < 0.5) throw new Error("Radius too small");
  return { lat, lng, radius };
}

export function validateBody(body: unknown): Coordinate[] {
  const { coordinates } = body as { coordinates: Coordinate[] };
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    throw new Error("coordinates array required");
  }
  if (coordinates.length > 500) {
    throw new Error("Max 500 coordinates per request");
  }
  return coordinates;
}
