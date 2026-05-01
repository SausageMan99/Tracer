import type { EnrichedEdge, EnrichedGraph, SessionProfile } from '../types';
import type { TerrainAuditReport } from './terrain-audit';

export type RouteIntentType =
  | 'forest_loop'
  | 'park_loop'
  | 'urban_nature_loop'
  | 'transition_to_woods'
  | 'low_trail_potential';

export type RouteStrategy = RouteIntentType;

export type SurfaceClass = 'paved' | 'unpaved' | 'unknown' | 'mixed';

export interface TerrainComponent {
  id: string;
  kind: 'forest' | 'park' | 'river_corridor' | 'trail_cluster' | 'scenic_paved' | 'unknown_natural';
  center: { lat: number; lng: number };
  totalKm: number;
  nonPavedKm: number;
  pavedKm: number;
  unknownSurfaceKm: number;
  distanceFromStartKm: number;
  entryNodeIds: string[];
  exitNodeIds: string[];
  nodeIds: string[];
  confidence: 'low' | 'medium' | 'high';
}

export interface RouteIntent {
  type: RouteIntentType;
  strategy: RouteIntentType;
  targetDistanceKm: number;
  targetElevationM: number;
  targetComponents: string[];
  minNaturalZoneDwellKm?: number;
  minNonPavedTrailStreakKm?: number;
  maxPavedRatio?: number;
  maxBusyRoadRatio: number;
  maxRepeatEdgeRatio: number;
  maxGeometryOverlapRatio: number;
  minLoopAreaKm2?: number;
  cleanReturnMode: 'strict' | 'prefer' | 'fallback_allowed';
  timeBudgetMs: number;
  beamBudget: {
    beamWidth: number;
    maxIterations: number;
    shortlistSize: number;
  };
  relaxationOrder: Array<'elevation' | 'distance' | 'paved_ratio' | 'natural_dwell' | 'clean_return'>;
  userWarningsIfRelaxed: string[];
  terrainComponents: TerrainComponent[];
}

export interface RouteIntentMatch {
  score: number;
  matched: boolean;
  failures: string[];
  relaxationsUsed: string[];
}

export interface PlanRouteIntentInput {
  graph: EnrichedGraph;
  terrainAudit: TerrainAuditReport;
  profile: SessionProfile;
  targetDistanceKm: number;
  targetElevationM: number;
  scenicMode?: boolean;
}

const PATH_LIKE_HIGHWAYS = new Set(['path', 'track', 'footway', 'bridleway']);
const UNPAVED_SURFACES = new Set(['ground', 'dirt', 'earth', 'grass', 'unpaved', 'gravel', 'fine_gravel', 'sand', 'compacted']);
const PAVED_SURFACES = new Set(['asphalt', 'concrete', 'paved', 'sett', 'paving_stones']);
function isPathLike(edge: EnrichedEdge): boolean {
  return PATH_LIKE_HIGHWAYS.has(edge.highway);
}

function isUnpaved(edge: EnrichedEdge): boolean {
  return UNPAVED_SURFACES.has(edge.surface ?? '');
}

function isPaved(edge: EnrichedEdge): boolean {
  return PAVED_SURFACES.has(edge.surface ?? '');
}

function isNaturalCandidate(edge: EnrichedEdge): boolean {
  return edge.scenic === true || isPathLike(edge) || isUnpaved(edge);
}

function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const earthRadiusKm = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const lat1 = (a.lat * Math.PI) / 180;
  const lat2 = (b.lat * Math.PI) / 180;
  const sinLat = Math.sin(dLat / 2);
  const sinLng = Math.sin(dLng / 2);
  const h = sinLat * sinLat + Math.cos(lat1) * Math.cos(lat2) * sinLng * sinLng;
  return 2 * earthRadiusKm * Math.asin(Math.min(1, Math.sqrt(h)));
}

function componentKind(edges: EnrichedEdge[], totalKm: number): TerrainComponent['kind'] {
  const scenicKm = edges.filter((edge) => edge.scenic === true).reduce((sum, edge) => sum + edge.lengthKm, 0);
  const pavedKm = edges.filter(isPaved).reduce((sum, edge) => sum + edge.lengthKm, 0);
  const pathKm = edges.filter(isPathLike).reduce((sum, edge) => sum + edge.lengthKm, 0);
  const unpavedKm = edges.filter(isUnpaved).reduce((sum, edge) => sum + edge.lengthKm, 0);

  if (totalKm > 0 && pavedKm / totalKm >= 0.65 && scenicKm / totalKm >= 0.45) return 'scenic_paved';
  if (totalKm >= 1.5 && totalKm > 0 && scenicKm / totalKm >= 0.45 && (pathKm + unpavedKm) / totalKm >= 0.45) return 'forest';
  if (totalKm < 1.5 && scenicKm / Math.max(totalKm, 0.1) >= 0.35) return 'park';
  if (pathKm > 0) return 'trail_cluster';
  return 'unknown_natural';
}

function confidenceForComponent(edges: EnrichedEdge[], audit: TerrainAuditReport): TerrainComponent['confidence'] {
  const total = edges.length;
  if (total === 0) return 'low';
  const known = edges.filter((edge) => Boolean(edge.surface)).length / total;
  const scenic = edges.filter((edge) => edge.scenic === true).length / total;

  if (audit.confidence === 'high' && (known >= 0.5 || scenic >= 0.5)) return 'high';
  if (audit.confidence !== 'low' || scenic >= 0.35 || known >= 0.35) return 'medium';
  return 'low';
}

function buildComponent(
  id: string,
  componentEdges: EnrichedEdge[],
  graph: EnrichedGraph,
  audit: TerrainAuditReport,
): TerrainComponent {
  const nodeIds = Array.from(new Set(componentEdges.flatMap((edge) => [edge.from, edge.to]))).sort();
  const coords = nodeIds
    .map((nodeId) => graph.nodes.get(nodeId))
    .filter((node): node is NonNullable<typeof node> => Boolean(node));
  const totalKm = componentEdges.reduce((sum, edge) => sum + edge.lengthKm, 0);
  const pavedKm = componentEdges.filter(isPaved).reduce((sum, edge) => sum + edge.lengthKm, 0);
  const nonPavedKm = componentEdges.filter((edge) => !isPaved(edge)).reduce((sum, edge) => sum + edge.lengthKm, 0);
  const unknownSurfaceKm = componentEdges.filter((edge) => !edge.surface).reduce((sum, edge) => sum + edge.lengthKm, 0);
  const nodeSet = new Set(nodeIds);
  const center = {
    lat: coords.length > 0 ? coords.reduce((sum, node) => sum + node.lat, 0) / coords.length : graph.center.lat,
    lng: coords.length > 0 ? coords.reduce((sum, node) => sum + node.lng, 0) / coords.length : graph.center.lng,
  };
  const entryNodeIds = nodeIds.filter((nodeId) => {
    const node = graph.nodes.get(nodeId);
    return (node?.edges ?? []).some((edgeId) => {
      const edge = graph.edges.get(edgeId);
      return edge ? !nodeSet.has(edge.from) || !nodeSet.has(edge.to) : false;
    });
  });

  return {
    id,
    kind: componentKind(componentEdges, totalKm),
    center,
    totalKm: Number(totalKm.toFixed(3)),
    nonPavedKm: Number(nonPavedKm.toFixed(3)),
    pavedKm: Number(pavedKm.toFixed(3)),
    unknownSurfaceKm: Number(unknownSurfaceKm.toFixed(3)),
    distanceFromStartKm: Number(haversineKm(graph.center, center).toFixed(3)),
    entryNodeIds,
    exitNodeIds: entryNodeIds,
    nodeIds,
    confidence: confidenceForComponent(componentEdges, audit),
  };
}

export function extractTerrainComponents(graph: EnrichedGraph, audit: TerrainAuditReport): TerrainComponent[] {
  const naturalEdges = Array.from(graph.edges.values()).filter(isNaturalCandidate);
  const adjacency = new Map<string, EnrichedEdge[]>();

  for (const edge of naturalEdges) {
    adjacency.set(edge.from, [...(adjacency.get(edge.from) ?? []), edge]);
    adjacency.set(edge.to, [...(adjacency.get(edge.to) ?? []), edge]);
  }

  const visitedNodes = new Set<string>();
  const components: TerrainComponent[] = [];

  for (const nodeId of Array.from(adjacency.keys()).sort()) {
    if (visitedNodes.has(nodeId)) continue;

    const stack = [nodeId];
    const componentEdges = new Map<string, EnrichedEdge>();
    visitedNodes.add(nodeId);

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;

      for (const edge of adjacency.get(current) ?? []) {
        componentEdges.set(edge.id, edge);
        const next = edge.from === current ? edge.to : edge.from;
        if (!visitedNodes.has(next)) {
          visitedNodes.add(next);
          stack.push(next);
        }
      }
    }

    const edges = Array.from(componentEdges.values());
    const totalKm = edges.reduce((sum, edge) => sum + edge.lengthKm, 0);
    if (totalKm < 0.25) continue;
    components.push(buildComponent(`tc-${components.length + 1}`, edges, graph, audit));
  }

  return components.sort((a, b) => b.totalKm - a.totalKm);
}

function selectIntentType(audit: TerrainAuditReport, components: TerrainComponent[], targetDistanceKm: number): RouteIntentType {
  if (audit.metrics.totalEdges === 0) return 'low_trail_potential';

  const largest = components[0];
  const hasForestCandidate = Boolean(
    largest &&
      largest.totalKm >= Math.max(1.8, targetDistanceKm * 0.18) &&
      largest.nonPavedKm >= Math.max(1.2, targetDistanceKm * 0.12),
  );

  if (hasForestCandidate && largest) {
    return largest.distanceFromStartKm > 0.45 ? 'transition_to_woods' : 'forest_loop';
  }

  const hasSmallPark = components.some((component) =>
    component.kind === 'park' ||
    (component.totalKm >= 0.45 && component.totalKm < 1.8 && component.distanceFromStartKm <= 0.6 && component.pavedKm / Math.max(component.totalKm, 0.1) < 0.85),
  );
  if (hasSmallPark) return 'park_loop';

  if (audit.trailPotential !== 'low' || audit.metrics.scenicEdgeRatio >= 0.18 || components.length > 0) {
    return 'urban_nature_loop';
  }

  return 'low_trail_potential';
}

function buildWarnings(type: RouteIntentType): string[] {
  if (type === 'transition_to_woods') {
    return ['Massif naturel détecté hors du départ : accepter une section d’accès puis rester dans les bois.'];
  }
  if (type === 'park_loop') {
    return ['Petit parc urbain : boucle courte ou compromis probable, éviter le clean return strict.'];
  }
  if (type === 'urban_nature_loop') {
    return ['Terrain mixte : route plutôt nature urbaine que vrai trail continu.'];
  }
  if (type === 'low_trail_potential') {
    return ['Potentiel trail faible : refuser ou relaxer explicitement la promesse terrain.'];
  }
  return [];
}

function cleanReturnMode(type: RouteIntentType): RouteIntent['cleanReturnMode'] {
  if (type === 'forest_loop') return 'prefer';
  if (type === 'transition_to_woods') return 'prefer';
  if (type === 'park_loop' || type === 'low_trail_potential') return 'fallback_allowed';
  return 'prefer';
}

function beamBudget(type: RouteIntentType, graph: EnrichedGraph): RouteIntent['beamBudget'] {
  const denseGraph = graph.edges.size > 1800;
  if (denseGraph) return { beamWidth: 28, maxIterations: 650, shortlistSize: 16 };
  if (type === 'forest_loop' || type === 'transition_to_woods') return { beamWidth: 44, maxIterations: 900, shortlistSize: 24 };
  if (type === 'urban_nature_loop') return { beamWidth: 34, maxIterations: 720, shortlistSize: 18 };
  return { beamWidth: 30, maxIterations: 650, shortlistSize: 14 };
}

function graphTimeBudget(graph: EnrichedGraph, type: RouteIntentType): number {
  if (graph.edges.size > 1800) return 4500;
  if (type === 'forest_loop' || type === 'transition_to_woods') return 6500;
  if (type === 'urban_nature_loop') return 5000;
  return 4000;
}

export function planRouteIntent(input: PlanRouteIntentInput): RouteIntent {
  const components = extractTerrainComponents(input.graph, input.terrainAudit);
  const type = selectIntentType(input.terrainAudit, components, input.targetDistanceKm);
  const mainComponent = components[0];
  const trailLikeRequest = input.profile.sessionType === 'trail' || input.scenicMode === true;
  const targetComponents = (type === 'forest_loop' || type === 'transition_to_woods') && mainComponent ? [mainComponent.id] : [];
  const dwellRatio = type === 'forest_loop' || type === 'transition_to_woods'
    ? 0.35
    : type === 'park_loop'
      ? 0.12
      : type === 'urban_nature_loop'
        ? 0.16
        : 0.05;
  const pavedCap = type === 'forest_loop' || type === 'transition_to_woods'
    ? 0.45
    : type === 'park_loop'
      ? 0.68
      : type === 'urban_nature_loop'
        ? 0.72
        : 0.85;

  return {
    type,
    strategy: type,
    targetDistanceKm: input.targetDistanceKm,
    targetElevationM: input.targetElevationM,
    targetComponents,
    minNaturalZoneDwellKm: Number((input.targetDistanceKm * dwellRatio).toFixed(2)),
    minNonPavedTrailStreakKm: trailLikeRequest ? Number(Math.min(3, Math.max(0.8, input.targetDistanceKm * 0.18)).toFixed(2)) : undefined,
    maxPavedRatio: pavedCap,
    maxBusyRoadRatio: 0.08,
    maxRepeatEdgeRatio: type === 'forest_loop' || type === 'transition_to_woods' ? 0.08 : 0.12,
    maxGeometryOverlapRatio: type === 'forest_loop' || type === 'transition_to_woods' ? 0.12 : 0.18,
    minLoopAreaKm2: Number(Math.max(0.05, input.targetDistanceKm * 0.015).toFixed(3)),
    cleanReturnMode: cleanReturnMode(type),
    timeBudgetMs: graphTimeBudget(input.graph, type),
    beamBudget: beamBudget(type, input.graph),
    relaxationOrder: type === 'forest_loop' || type === 'transition_to_woods'
      ? ['elevation', 'distance', 'clean_return', 'natural_dwell', 'paved_ratio']
      : ['elevation', 'distance', 'natural_dwell', 'clean_return', 'paved_ratio'],
    userWarningsIfRelaxed: buildWarnings(type),
    terrainComponents: components,
  };
}
