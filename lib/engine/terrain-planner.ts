import type { EnrichedEdge, EnrichedGraph, SessionProfile } from '../types';
import type { TerrainAuditReport } from './terrain-audit';

export type RouteStrategy =
  | 'natural_massif_loop'
  | 'trail_sparse_compromise'
  | 'urban_nature_loop'
  | 'corridor_out_and_loop_back'
  | 'fail_or_relax';

export type SurfaceClass = 'paved' | 'unpaved' | 'unknown' | 'mixed';

export interface TerrainComponent {
  id: string;
  kind: 'forest' | 'park' | 'river_corridor' | 'trail_cluster' | 'scenic_paved' | 'unknown_natural';
  center: { lat: number; lng: number };
  totalKm: number;
  nonPavedKm: number;
  pavedKm: number;
  unknownSurfaceKm: number;
  entryNodeIds: string[];
  exitNodeIds: string[];
  nodeIds: string[];
  confidence: 'low' | 'medium' | 'high';
}

export interface RouteIntent {
  strategy: RouteStrategy;
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
const BUSY_HIGHWAYS = new Set(['secondary', 'primary', 'trunk']);

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

function componentKind(edges: EnrichedEdge[]): TerrainComponent['kind'] {
  const scenicKm = edges.filter((edge) => edge.scenic === true).reduce((sum, edge) => sum + edge.lengthKm, 0);
  const pavedKm = edges.filter(isPaved).reduce((sum, edge) => sum + edge.lengthKm, 0);
  const pathKm = edges.filter(isPathLike).reduce((sum, edge) => sum + edge.lengthKm, 0);
  const totalKm = edges.reduce((sum, edge) => sum + edge.lengthKm, 0);

  if (totalKm > 0 && pavedKm / totalKm >= 0.65 && scenicKm / totalKm >= 0.45) return 'scenic_paved';
  if (totalKm > 0 && scenicKm / totalKm >= 0.5 && pathKm / totalKm >= 0.45) return 'forest';
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
  const entryNodeIds = nodeIds.filter((nodeId) => {
    const node = graph.nodes.get(nodeId);
    return (node?.edges ?? []).some((edgeId) => {
      const edge = graph.edges.get(edgeId);
      return edge ? !nodeSet.has(edge.from) || !nodeSet.has(edge.to) : false;
    });
  });

  return {
    id,
    kind: componentKind(componentEdges),
    center: {
      lat: coords.length > 0 ? coords.reduce((sum, node) => sum + node.lat, 0) / coords.length : graph.center.lat,
      lng: coords.length > 0 ? coords.reduce((sum, node) => sum + node.lng, 0) / coords.length : graph.center.lng,
    },
    totalKm: Number(totalKm.toFixed(3)),
    nonPavedKm: Number(nonPavedKm.toFixed(3)),
    pavedKm: Number(pavedKm.toFixed(3)),
    unknownSurfaceKm: Number(unknownSurfaceKm.toFixed(3)),
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

function selectStrategy(audit: TerrainAuditReport, components: TerrainComponent[], targetDistanceKm: number): RouteStrategy {
  const largest = components[0];
  const hasLargeNaturalComponent = Boolean(
    largest &&
      largest.totalKm >= Math.max(1.8, targetDistanceKm * 0.18) &&
      largest.nonPavedKm >= Math.max(1.2, targetDistanceKm * 0.12),
  );

  if ((audit.trailPotential === 'high' || audit.trailPotential === 'medium') && hasLargeNaturalComponent) {
    return 'natural_massif_loop';
  }

  if (audit.trailPotential !== 'low' && audit.metrics.fragmentationScore >= 0.45) {
    return 'trail_sparse_compromise';
  }

  if (audit.trailPotential === 'medium' && largest) {
    return 'corridor_out_and_loop_back';
  }

  if (audit.metrics.totalEdges === 0) return 'fail_or_relax';
  return 'urban_nature_loop';
}

function buildWarnings(strategy: RouteStrategy): string[] {
  if (strategy === 'trail_sparse_compromise') {
    return ['Terrain naturel fragmenté : TrailForge peut devoir relier des sections par route.'];
  }
  if (strategy === 'urban_nature_loop') {
    return ['Potentiel trail faible : route plutôt nature urbaine que vraie sortie trail.'];
  }
  if (strategy === 'fail_or_relax') {
    return ['Données terrain insuffisantes : génération à refuser ou à relaxer explicitement.'];
  }
  return [];
}

function cleanReturnMode(strategy: RouteStrategy, audit: TerrainAuditReport): RouteIntent['cleanReturnMode'] {
  if (strategy === 'natural_massif_loop' && audit.metrics.fragmentationScore < 0.25) return 'prefer';
  if (strategy === 'trail_sparse_compromise' || strategy === 'fail_or_relax') return 'fallback_allowed';
  return 'prefer';
}

function beamBudget(strategy: RouteStrategy, graph: EnrichedGraph): RouteIntent['beamBudget'] {
  const denseGraph = graph.edges.size > 1800;
  if (denseGraph) return { beamWidth: 28, maxIterations: 650, shortlistSize: 16 };
  if (strategy === 'natural_massif_loop') return { beamWidth: 44, maxIterations: 900, shortlistSize: 24 };
  if (strategy === 'trail_sparse_compromise') return { beamWidth: 36, maxIterations: 760, shortlistSize: 20 };
  return { beamWidth: 30, maxIterations: 650, shortlistSize: 14 };
}

export function planRouteIntent(input: PlanRouteIntentInput): RouteIntent {
  const components = extractTerrainComponents(input.graph, input.terrainAudit);
  const strategy = selectStrategy(input.terrainAudit, components, input.targetDistanceKm);
  const mainComponent = components[0];
  const trailLikeRequest = input.profile.sessionType === 'trail' || input.scenicMode === true;
  const targetComponents = strategy === 'natural_massif_loop' && mainComponent ? [mainComponent.id] : [];
  const dwellRatio = strategy === 'natural_massif_loop' ? 0.35 : strategy === 'trail_sparse_compromise' ? 0.18 : 0.08;
  const pavedCap = strategy === 'natural_massif_loop'
    ? 0.45
    : strategy === 'trail_sparse_compromise'
      ? 0.62
      : 0.78;

  return {
    strategy,
    targetDistanceKm: input.targetDistanceKm,
    targetElevationM: input.targetElevationM,
    targetComponents,
    minNaturalZoneDwellKm: Number((input.targetDistanceKm * dwellRatio).toFixed(2)),
    minNonPavedTrailStreakKm: trailLikeRequest ? Number(Math.min(3, Math.max(0.8, input.targetDistanceKm * 0.18)).toFixed(2)) : undefined,
    maxPavedRatio: pavedCap,
    maxBusyRoadRatio: BUSY_HIGHWAYS.size > 0 ? 0.08 : 0.1,
    maxRepeatEdgeRatio: strategy === 'natural_massif_loop' ? 0.08 : 0.12,
    maxGeometryOverlapRatio: strategy === 'natural_massif_loop' ? 0.12 : 0.18,
    minLoopAreaKm2: Number(Math.max(0.05, input.targetDistanceKm * 0.015).toFixed(3)),
    cleanReturnMode: cleanReturnMode(strategy, input.terrainAudit),
    timeBudgetMs: graphTimeBudget(input.graph, strategy),
    beamBudget: beamBudget(strategy, input.graph),
    relaxationOrder: strategy === 'natural_massif_loop'
      ? ['elevation', 'distance', 'clean_return', 'natural_dwell', 'paved_ratio']
      : ['elevation', 'distance', 'natural_dwell', 'clean_return', 'paved_ratio'],
    userWarningsIfRelaxed: buildWarnings(strategy),
    terrainComponents: components,
  };
}

function graphTimeBudget(graph: EnrichedGraph, strategy: RouteStrategy): number {
  if (graph.edges.size > 1800) return 4500;
  if (strategy === 'natural_massif_loop') return 6500;
  if (strategy === 'trail_sparse_compromise') return 5500;
  return 4000;
}
