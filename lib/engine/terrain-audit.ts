import type { EnrichedEdge } from '../types';

export type TerrainAuditConfidence = 'low' | 'medium' | 'high';
export type TrailPotential = 'low' | 'medium' | 'high';

export interface TerrainAuditMetrics {
  totalEdges: number;
  pathLikeEdgeRatio: number;
  naturalSurfaceRatio: number;
  unknownSurfaceRatio: number;
  scenicEdgeRatio: number;
  asphaltRatio: number;
  naturalAreaSignal: number;
  fragmentationScore: number;
}

export interface TerrainAuditReport {
  confidence: TerrainAuditConfidence;
  trailPotential: TrailPotential;
  metrics: TerrainAuditMetrics;
  warnings: string[];
  recommendations: string[];
}

const PATH_LIKE_HIGHWAYS = new Set(['path', 'track', 'footway', 'bridleway']);
const NATURAL_SURFACES = new Set([
  'ground',
  'dirt',
  'earth',
  'grass',
  'unpaved',
  'gravel',
  'fine_gravel',
  'sand',
  'compacted',
]);
const ASPHALT_SURFACES = new Set(['asphalt']);

function ratio(count: number, total: number): number {
  if (total === 0) return 0;
  return count / total;
}

export function createEmptyTerrainAuditReport(): TerrainAuditReport {
  return {
    confidence: 'low',
    trailPotential: 'low',
    metrics: {
      totalEdges: 0,
      pathLikeEdgeRatio: 0,
      naturalSurfaceRatio: 0,
      unknownSurfaceRatio: 1,
      scenicEdgeRatio: 0,
      asphaltRatio: 0,
      naturalAreaSignal: 0,
      fragmentationScore: 1,
    },
    warnings: ['Aucune donnée routable analysée.'],
    recommendations: ['Élargir la zone de recherche ou vérifier la couverture OSM locale.'],
  };
}

function isNaturalLikeEdge(edge: EnrichedEdge): boolean {
  return (
    edge.scenic === true ||
    PATH_LIKE_HIGHWAYS.has(edge.highway) ||
    NATURAL_SURFACES.has(edge.surface ?? '')
  );
}

function calculateFragmentationScore(edges: EnrichedEdge[]): number {
  const naturalEdges = edges.filter(isNaturalLikeEdge);
  if (naturalEdges.length === 0) return 1;

  const adjacency = new Map<string, Set<string>>();

  for (const edge of naturalEdges) {
    if (!adjacency.has(edge.from)) adjacency.set(edge.from, new Set());
    if (!adjacency.has(edge.to)) adjacency.set(edge.to, new Set());
    adjacency.get(edge.from)?.add(edge.to);
    adjacency.get(edge.to)?.add(edge.from);
  }

  const visited = new Set<string>();
  let largestComponentNodes = 0;

  for (const node of Array.from(adjacency.keys())) {
    if (visited.has(node)) continue;

    const stack = [node];
    let componentNodes = 0;
    visited.add(node);

    while (stack.length > 0) {
      const current = stack.pop();
      if (!current) continue;
      componentNodes += 1;

      for (const next of Array.from(adjacency.get(current) ?? [])) {
        if (!visited.has(next)) {
          visited.add(next);
          stack.push(next);
        }
      }
    }

    largestComponentNodes = Math.max(largestComponentNodes, componentNodes);
  }

  if (adjacency.size === 0) return 1;
  return 1 - largestComponentNodes / adjacency.size;
}

function classifyTrailPotential(metrics: TerrainAuditMetrics): TrailPotential {
  if (metrics.asphaltRatio >= 0.65 && metrics.scenicEdgeRatio < 0.2) return 'low';
  if (metrics.pathLikeEdgeRatio >= 0.6 && metrics.naturalAreaSignal >= 0.35) return 'high';
  if (metrics.pathLikeEdgeRatio >= 0.4 || metrics.naturalAreaSignal >= 0.25) return 'medium';
  return 'low';
}

function classifyConfidence(
  metrics: TerrainAuditMetrics,
  trailPotential: TrailPotential,
): TerrainAuditConfidence {
  if (metrics.totalEdges < 3) return 'low';
  if (metrics.unknownSurfaceRatio >= 0.5 && trailPotential !== 'low') return 'medium';
  if (metrics.unknownSurfaceRatio >= 0.7) return 'low';
  if (trailPotential === 'high') return 'high';
  return 'medium';
}

function buildTerrainWarnings(metrics: TerrainAuditMetrics): string[] {
  const warnings: string[] = [];

  if (metrics.asphaltRatio >= 0.65 && metrics.scenicEdgeRatio < 0.2) {
    warnings.push('Zone très routière pour une boucle trail.');
  }

  if (metrics.unknownSurfaceRatio >= 0.5 && metrics.pathLikeEdgeRatio >= 0.4) {
    warnings.push('Beaucoup de chemins existent mais les surfaces OSM sont peu renseignées.');
  }

  if (metrics.fragmentationScore >= 0.65) {
    warnings.push('Les chemins naturels semblent fragmentés autour du départ.');
  }

  return warnings;
}

export function auditTerrainData(edges: EnrichedEdge[]): TerrainAuditReport {
  if (edges.length === 0) return createEmptyTerrainAuditReport();

  const totalEdges = edges.length;
  const pathLike = edges.filter((edge) => PATH_LIKE_HIGHWAYS.has(edge.highway)).length;
  const naturalSurfaces = edges.filter((edge) => NATURAL_SURFACES.has(edge.surface ?? '')).length;
  const unknownSurfaces = edges.filter((edge) => !edge.surface).length;
  const asphaltSurfaces = edges.filter((edge) => ASPHALT_SURFACES.has(edge.surface ?? '')).length;
  const scenicEdges = edges.filter((edge) => edge.scenic === true).length;
  const metrics: TerrainAuditMetrics = {
    totalEdges,
    pathLikeEdgeRatio: ratio(pathLike, totalEdges),
    naturalSurfaceRatio: ratio(naturalSurfaces, totalEdges),
    unknownSurfaceRatio: ratio(unknownSurfaces, totalEdges),
    scenicEdgeRatio: ratio(scenicEdges, totalEdges),
    asphaltRatio: ratio(asphaltSurfaces, totalEdges),
    naturalAreaSignal: ratio(scenicEdges + naturalSurfaces, totalEdges),
    fragmentationScore: calculateFragmentationScore(edges),
  };
  const trailPotential = classifyTrailPotential(metrics);

  return {
    confidence: classifyConfidence(metrics, trailPotential),
    trailPotential,
    metrics,
    warnings: buildTerrainWarnings(metrics),
    recommendations: [],
  };
}
