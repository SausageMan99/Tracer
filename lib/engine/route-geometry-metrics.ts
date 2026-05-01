import type { Coordinate } from "../types";
import { haversineKm } from "../route-generator-legacy";

export interface RouteGeometryMetrics {
  directStartEndKm: number;
  maxDistanceFromStartKm: number;
  meanDistanceFromStartKm: number;
  boundingBoxAreaKm2: number;
  loopAreaKm2: number;
  loopCompactness: number;
  geometryOverlapRatio: number;
  outAndBackSimilarityRatio: number;
  selfIntersectionCount: number;
  sharpTurnCount: number;
  sharpTurnDensityPerKm: number;
  headingReversalRatio: number;
  startStemKm: number;
  endStemKm: number;
}

interface ProjectedPoint {
  x: number;
  y: number;
}

function roundMetric(value: number): number {
  return Number(value.toFixed(5));
}

function projectCoordinates(coords: Coordinate[]): ProjectedPoint[] {
  if (coords.length === 0) return [];
  const lat0 = coords.reduce((sum, coord) => sum + coord.lat, 0) / coords.length;
  const lng0 = coords.reduce((sum, coord) => sum + coord.lng, 0) / coords.length;
  const kmPerDegLat = 110.574;
  const kmPerDegLng = 111.32 * Math.cos((lat0 * Math.PI) / 180);

  return coords.map((coord) => ({
    x: (coord.lng - lng0) * kmPerDegLng,
    y: (coord.lat - lat0) * kmPerDegLat,
  }));
}

function polygonArea(points: ProjectedPoint[]): number {
  if (points.length < 3) return 0;
  let area = 0;
  for (let index = 0; index < points.length; index += 1) {
    const current = points[index];
    const next = points[(index + 1) % points.length];
    area += current.x * next.y - next.x * current.y;
  }
  return Math.abs(area) / 2;
}

function segmentLengthKm(a: Coordinate, b: Coordinate): number {
  return haversineKm(a, b);
}

function orientation(a: ProjectedPoint, b: ProjectedPoint, c: ProjectedPoint): number {
  return (b.y - a.y) * (c.x - b.x) - (b.x - a.x) * (c.y - b.y);
}

function segmentsIntersect(a: ProjectedPoint, b: ProjectedPoint, c: ProjectedPoint, d: ProjectedPoint): boolean {
  const o1 = orientation(a, b, c);
  const o2 = orientation(a, b, d);
  const o3 = orientation(c, d, a);
  const o4 = orientation(c, d, b);
  return o1 * o2 < 0 && o3 * o4 < 0;
}

function computeSelfIntersections(points: ProjectedPoint[]): number {
  let count = 0;
  for (let i = 0; i < points.length - 1; i += 1) {
    for (let j = i + 2; j < points.length - 1; j += 1) {
      if (i === 0 && j === points.length - 2) continue;
      if (segmentsIntersect(points[i], points[i + 1], points[j], points[j + 1])) count += 1;
    }
  }
  return count;
}

function bearing(a: Coordinate, b: Coordinate): number {
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const y = Math.sin(dLng) * Math.cos(lat2);
  const x = Math.cos(lat1) * Math.sin(lat2) - Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLng);
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
}

function angleDelta(a: number, b: number): number {
  const diff = Math.abs(a - b) % 360;
  return diff > 180 ? 360 - diff : diff;
}

function computeTurnStats(coords: Coordinate[], distanceKm: number): {
  sharpTurnCount: number;
  sharpTurnDensityPerKm: number;
  headingReversalRatio: number;
} {
  if (coords.length < 3 || distanceKm <= 0) {
    return { sharpTurnCount: 0, sharpTurnDensityPerKm: 0, headingReversalRatio: 0 };
  }
  let sharpTurnCount = 0;
  let reversalCount = 0;
  let comparisons = 0;
  for (let index = 1; index < coords.length - 1; index += 1) {
    const previous = bearing(coords[index - 1], coords[index]);
    const next = bearing(coords[index], coords[index + 1]);
    const delta = angleDelta(previous, next);
    comparisons += 1;
    if (delta > 145) sharpTurnCount += 1;
    if (delta > 150) reversalCount += 1;
  }
  return {
    sharpTurnCount,
    sharpTurnDensityPerKm: sharpTurnCount / distanceKm,
    headingReversalRatio: comparisons > 0 ? reversalCount / comparisons : 0,
  };
}

function segmentBucket(a: Coordinate, b: Coordinate): string {
  const lat = (a.lat + b.lat) / 2;
  const lng = (a.lng + b.lng) / 2;
  const keyA = `${Math.round(lat * 5000)}:${Math.round(lng * 5000)}`;
  const keyB = bearing(a, b) >= 180 ? "r" : "f";
  return `${keyA}:${keyB}`;
}

function computeOverlapRatio(coords: Coordinate[], totalKm: number): number {
  if (coords.length < 3 || totalKm <= 0) return 0;
  const seen = new Set<string>();
  let overlapKm = 0;
  for (let index = 0; index < coords.length - 1; index += 1) {
    const bucket = segmentBucket(coords[index], coords[index + 1]);
    const reverseBucket = bucket.endsWith(":f") ? bucket.replace(/:f$/, ":r") : bucket.replace(/:r$/, ":f");
    const length = segmentLengthKm(coords[index], coords[index + 1]);
    if (seen.has(bucket) || seen.has(reverseBucket)) overlapKm += length;
    seen.add(bucket);
  }
  return overlapKm / totalKm;
}

function computeOutAndBackSimilarity(coords: Coordinate[]): number {
  if (coords.length < 6) return 0;
  const half = Math.floor(coords.length / 2);
  const samples = Math.min(12, half);
  let close = 0;
  for (let index = 0; index < samples; index += 1) {
    const left = coords[Math.floor((index / Math.max(samples - 1, 1)) * (half - 1))];
    const right = coords[coords.length - 1 - Math.floor((index / Math.max(samples - 1, 1)) * (coords.length - half - 1))];
    if (haversineKm(left, right) < 0.06) close += 1;
  }
  return close / samples;
}

function computeStemKm(coords: Coordinate[], fromStart: boolean): number {
  if (coords.length < 6) return 0;
  let stemKm = 0;
  const maxPairs = Math.min(12, Math.floor(coords.length / 2));
  for (let index = 0; index < maxPairs; index += 1) {
    const a = fromStart ? coords[index] : coords[coords.length - 1 - index];
    const b = fromStart ? coords[coords.length - 1 - index] : coords[index];
    if (haversineKm(a, b) > 0.05) break;
    const nextIndex = fromStart ? index + 1 : coords.length - 2 - index;
    const currentIndex = fromStart ? index : coords.length - 1 - index;
    if (coords[nextIndex]) stemKm += haversineKm(coords[currentIndex], coords[nextIndex]);
  }
  return stemKm;
}

export function computeRouteGeometryMetrics(coords: Coordinate[], distanceKm: number): RouteGeometryMetrics {
  if (coords.length === 0 || distanceKm <= 0) {
    return {
      directStartEndKm: 0,
      maxDistanceFromStartKm: 0,
      meanDistanceFromStartKm: 0,
      boundingBoxAreaKm2: 0,
      loopAreaKm2: 0,
      loopCompactness: 0,
      geometryOverlapRatio: 0,
      outAndBackSimilarityRatio: 0,
      selfIntersectionCount: 0,
      sharpTurnCount: 0,
      sharpTurnDensityPerKm: 0,
      headingReversalRatio: 0,
      startStemKm: 0,
      endStemKm: 0,
    };
  }

  const projected = projectCoordinates(coords);
  const xs = projected.map((point) => point.x);
  const ys = projected.map((point) => point.y);
  const boundingBoxAreaKm2 = (Math.max(...xs) - Math.min(...xs)) * (Math.max(...ys) - Math.min(...ys));
  const loopAreaKm2 = polygonArea(projected);
  const directStartEndKm = haversineKm(coords[0], coords[coords.length - 1]);
  const distancesFromStart = coords.map((coord) => haversineKm(coords[0], coord));
  const maxDistanceFromStartKm = Math.max(...distancesFromStart);
  const meanDistanceFromStartKm = distancesFromStart.reduce((sum, value) => sum + value, 0) / distancesFromStart.length;
  const turnStats = computeTurnStats(coords, distanceKm);

  return {
    directStartEndKm: roundMetric(directStartEndKm),
    maxDistanceFromStartKm: roundMetric(maxDistanceFromStartKm),
    meanDistanceFromStartKm: roundMetric(meanDistanceFromStartKm),
    boundingBoxAreaKm2: roundMetric(Math.max(0, boundingBoxAreaKm2)),
    loopAreaKm2: roundMetric(loopAreaKm2),
    loopCompactness: roundMetric(Math.max(0, Math.min(1, (4 * Math.PI * loopAreaKm2) / Math.max(distanceKm * distanceKm, 0.001)))),
    geometryOverlapRatio: roundMetric(Math.max(0, Math.min(1, computeOverlapRatio(coords, distanceKm)))),
    outAndBackSimilarityRatio: roundMetric(Math.max(0, Math.min(1, computeOutAndBackSimilarity(coords)))),
    selfIntersectionCount: computeSelfIntersections(projected),
    sharpTurnCount: turnStats.sharpTurnCount,
    sharpTurnDensityPerKm: roundMetric(turnStats.sharpTurnDensityPerKm),
    headingReversalRatio: roundMetric(turnStats.headingReversalRatio),
    startStemKm: roundMetric(computeStemKm(coords, true)),
    endStemKm: roundMetric(computeStemKm(coords, false)),
  };
}
