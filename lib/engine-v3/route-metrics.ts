import { classifyEdgeSemanticsV3 } from './edge-semantics';
import type { RouteEdgeV3, RouteGeometryV3, RouteMetricsV3, TerrainComponentKindV3 } from './types';

const BUSY_ROAD_HIGHWAYS = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary']);

export interface ComputeRouteMetricsV3Input {
  targetDistanceKm: number;
  edges: RouteEdgeV3[];
  geometry: RouteGeometryV3;
  targetComponents: TerrainComponentKindV3[];
}

export function computeRouteMetricsV3(input: ComputeRouteMetricsV3Input): RouteMetricsV3 {
  const totalKm = round(input.edges.reduce((sum, edge) => sum + edgeLength(edge), 0));
  if (totalKm <= 0) return createEmptyRouteMetricsV3(input.targetDistanceKm, input.geometry);

  const targetComponents = new Set(input.targetComponents);
  const visitedComponents: TerrainComponentKindV3[] = [];
  const traversalsByUndirectedPair = new Map<string, number>();

  let pavedKm = 0;
  let nonPavedKm = 0;
  let trailKm = 0;
  let explicitNaturalKm = 0;
  let explicitPavedKm = 0;
  let roadLikeUnknownKm = 0;
  let pathTrackUnknownKm = 0;
  let candidateNaturalKm = 0;
  let trailCandidateKm = 0;
  let unverifiedTrailCandidateKm = 0;
  let naturalDwellKm = 0;
  let repeatEdgeKm = 0;
  let targetRepeatKm = 0;
  let connectorRepeatKm = 0;
  let busyRoadKm = 0;
  let longestTrailSegmentKm = 0;
  let currentTrailSegmentKm = 0;

  for (const edge of input.edges) {
    const lengthKm = edgeLength(edge);
    if (!visitedComponents.includes(edge.componentKind)) visitedComponents.push(edge.componentKind);

    const pairKey = undirectedPairKey(edge);
    const previousTraversals = traversalsByUndirectedPair.get(pairKey) ?? 0;
    if (previousTraversals > 0) {
      repeatEdgeKm += lengthKm;
      if (targetComponents.has(edge.componentKind)) {
        targetRepeatKm += lengthKm;
      } else {
        connectorRepeatKm += lengthKm;
      }
    }
    traversalsByUndirectedPair.set(pairKey, previousTraversals + 1);

    const semantics = classifyEdgeSemanticsV3(edge);
    pavedKm += lengthKm * semantics.pavedEquivalentWeight;
    nonPavedKm += lengthKm * (1 - semantics.pavedEquivalentWeight);
    candidateNaturalKm += lengthKm * semantics.candidateNaturalWeight;
    if (semantics.isTrailCandidate) trailCandidateKm += lengthKm;
    if (semantics.isUnverifiedTrailCandidate) unverifiedTrailCandidateKm += lengthKm;
    if (semantics.surfaceEvidence === 'explicit_natural') explicitNaturalKm += lengthKm;
    if (semantics.surfaceEvidence === 'explicit_paved') explicitPavedKm += lengthKm;
    if (semantics.surfaceEvidence === 'road_like_unknown') roadLikeUnknownKm += lengthKm;
    if (semantics.surfaceEvidence === 'path_track_unknown') pathTrackUnknownKm += lengthKm;

    if (semantics.isStrictTrailLike) {
      trailKm += lengthKm;
      currentTrailSegmentKm += lengthKm;
      longestTrailSegmentKm = Math.max(longestTrailSegmentKm, currentTrailSegmentKm);
    } else {
      currentTrailSegmentKm = 0;
    }

    if (targetComponents.has(edge.componentKind) && semantics.routeSurface !== 'paved') {
      naturalDwellKm += lengthKm * semantics.candidateNaturalWeight;
    }

    if (isBusyRoadEdge(edge)) busyRoadKm += lengthKm;
  }

  const loopClosureKm = computeLoopClosureKm(input.geometry);

  return {
    targetDistanceKm: input.targetDistanceKm,
    distanceProducedKm: totalKm,
    strictTrailKm: round(trailKm),
    explicitNaturalKm: round(explicitNaturalKm),
    explicitPavedKm: round(explicitPavedKm),
    roadLikeUnknownKm: round(roadLikeUnknownKm),
    pathTrackUnknownKm: round(pathTrackUnknownKm),
    candidateNaturalKm: round(candidateNaturalKm),
    trailCandidateKm: round(trailCandidateKm),
    unverifiedTrailCandidateKm: round(unverifiedTrailCandidateKm),
    trailRatio: ratio(trailKm, totalKm),
    naturalWayRatio: ratio(nonPavedKm, totalKm),
    pavedRatio: ratio(pavedKm, totalKm),
    pavedKm: round(pavedKm),
    nonPavedKm: round(nonPavedKm),
    naturalDwellKm: round(naturalDwellKm),
    repeatEdgeKm: round(repeatEdgeKm),
    targetRepeatKm: round(targetRepeatKm),
    connectorRepeatKm: round(connectorRepeatKm),
    visitedComponents,
    repeatRatio: ratio(targetRepeatKm, totalKm),
    overlapRatio: ratio(targetRepeatKm, totalKm),
    busyRoadRatio: ratio(busyRoadKm, totalKm),
    loopClosureKm,
    longestTrailSegmentKm: round(longestTrailSegmentKm),
  };
}

export function createEmptyRouteMetricsV3(targetDistanceKm: number, geometry: RouteGeometryV3 = { type: 'LineString', coordinates: [] }): RouteMetricsV3 {
  return {
    targetDistanceKm,
    distanceProducedKm: 0,
    strictTrailKm: 0,
    explicitNaturalKm: 0,
    explicitPavedKm: 0,
    roadLikeUnknownKm: 0,
    pathTrackUnknownKm: 0,
    candidateNaturalKm: 0,
    trailCandidateKm: 0,
    unverifiedTrailCandidateKm: 0,
    trailRatio: 0,
    naturalWayRatio: 0,
    pavedRatio: 1,
    pavedKm: 0,
    nonPavedKm: 0,
    naturalDwellKm: 0,
    repeatEdgeKm: 0,
    targetRepeatKm: 0,
    connectorRepeatKm: 0,
    visitedComponents: [],
    repeatRatio: 0,
    overlapRatio: 0,
    busyRoadRatio: 0,
    loopClosureKm: computeLoopClosureKm(geometry),
    longestTrailSegmentKm: 0,
  };
}

function isBusyRoadEdge(edge: RouteEdgeV3): boolean {
  const highway = edge.highway.toLowerCase();
  return edge.surface === 'paved' && BUSY_ROAD_HIGHWAYS.has(highway);
}

function edgeLength(edge: RouteEdgeV3): number {
  return Math.max(0, edge.lengthKm);
}

function undirectedPairKey(edge: RouteEdgeV3): string {
  return edge.from < edge.to ? `${edge.from}::${edge.to}` : `${edge.to}::${edge.from}`;
}

function computeLoopClosureKm(geometry: RouteGeometryV3): number {
  const first = geometry.coordinates[0];
  const last = geometry.coordinates.at(-1);
  if (!first || !last) return 0;
  return round(haversineKm(first, last));
}

function haversineKm(a: number[], b: number[]): number {
  const [lng1, lat1] = a;
  const [lng2, lat2] = b;
  const earthRadiusKm = 6371.0088;
  const dLat = degreesToRadians(lat2 - lat1);
  const dLng = degreesToRadians(lng2 - lng1);
  const rLat1 = degreesToRadians(lat1);
  const rLat2 = degreesToRadians(lat2);
  const hav = Math.sin(dLat / 2) ** 2 + Math.cos(rLat1) * Math.cos(rLat2) * Math.sin(dLng / 2) ** 2;
  return 2 * earthRadiusKm * Math.asin(Math.sqrt(hav));
}

function degreesToRadians(value: number): number {
  return (value * Math.PI) / 180;
}

function ratio(value: number, total: number): number {
  if (total <= 0) return 0;
  return round(value / total);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
