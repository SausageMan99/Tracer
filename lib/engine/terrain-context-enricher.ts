import type { Coordinate, EnrichedEdge, TerrainContextFeature, TerrainContextFeatureCollection, TerrainContextSignals } from '../types';
import { hasExplicitPavedSurface } from './terrain-context';

const NO_TERRAIN_CONTEXT: TerrainContextSignals = {
  source: 'none',
  naturalContextScore: 0,
  artificializationScore: 0,
  confidence: 'low',
  warnings: [],
};

function midpoint(edge: EnrichedEdge): Coordinate | null {
  const from = edge.fromCoordinate;
  const to = edge.toCoordinate;
  if (from == null || to == null) return null;
  return {
    lat: (from.lat + to.lat) / 2,
    lng: (from.lng + to.lng) / 2,
  };
}

function pointInRing(point: Coordinate, ring: [number, number][]): boolean {
  let inside = false;
  const x = point.lng;
  const y = point.lat;

  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }

  return inside;
}

function pointInPolygon(point: Coordinate, polygon: [number, number][][]): boolean {
  const [outer, ...holes] = polygon;
  if (outer == null || !pointInRing(point, outer)) return false;
  return !holes.some((hole) => pointInRing(point, hole));
}

function matchingFeature(point: Coordinate | null, fixtureGeoJson?: TerrainContextFeatureCollection): TerrainContextFeature | null {
  if (point == null || fixtureGeoJson == null) return null;
  return fixtureGeoJson.features.find((feature) => pointInPolygon(point, feature.geometry.coordinates)) ?? null;
}

function contextFromFeature(edge: EnrichedEdge, feature: TerrainContextFeature | null): TerrainContextSignals {
  if (feature == null) return { ...NO_TERRAIN_CONTEXT };

  const naturalContextScore = feature.properties.naturalContextScore ?? 0;
  const warnings = [...(feature.properties.warnings ?? [])];
  if (hasExplicitPavedSurface(edge) && naturalContextScore >= 0.7 && !warnings.includes('EXPLICIT_PAVED_IN_NATURAL_CONTEXT')) {
    warnings.push('EXPLICIT_PAVED_IN_NATURAL_CONTEXT');
  }

  return {
    source: 'ign_poc_fixture',
    landcoverClass: feature.properties.landcoverClass ?? 'unknown',
    naturalContextScore,
    artificializationScore: feature.properties.artificializationScore ?? 0,
    forestProximityM: feature.properties.forestProximityM,
    parkProximityM: feature.properties.parkProximityM,
    waterProximityM: feature.properties.waterProximityM,
    slopeMeanPct: feature.properties.slopeMeanPct,
    slopeMaxPct: feature.properties.slopeMaxPct,
    ignPathProximityM: feature.properties.ignPathProximityM,
    confidence: feature.properties.confidence ?? 'low',
    warnings,
  };
}

export function enrichEdgesWithTerrainContext(
  edges: EnrichedEdge[],
  options: { fixtureGeoJson?: TerrainContextFeatureCollection } = {},
): EnrichedEdge[] {
  return edges.map((edge) => {
    const feature = matchingFeature(midpoint(edge), options.fixtureGeoJson);
    return {
      ...edge,
      terrainContext: contextFromFeature(edge, feature),
    };
  });
}
