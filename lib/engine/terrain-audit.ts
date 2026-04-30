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

export function auditTerrainData(edges: EnrichedEdge[]): TerrainAuditReport {
  if (edges.length === 0) return createEmptyTerrainAuditReport();

  const totalEdges = edges.length;
  const pathLike = edges.filter((edge) => PATH_LIKE_HIGHWAYS.has(edge.highway)).length;
  const naturalSurfaces = edges.filter((edge) => NATURAL_SURFACES.has(edge.surface ?? '')).length;
  const unknownSurfaces = edges.filter((edge) => !edge.surface).length;
  const asphaltSurfaces = edges.filter((edge) => ASPHALT_SURFACES.has(edge.surface ?? '')).length;
  const scenicEdges = edges.filter((edge) => edge.scenic === true).length;

  return {
    confidence: 'medium',
    trailPotential: 'medium',
    metrics: {
      totalEdges,
      pathLikeEdgeRatio: ratio(pathLike, totalEdges),
      naturalSurfaceRatio: ratio(naturalSurfaces, totalEdges),
      unknownSurfaceRatio: ratio(unknownSurfaces, totalEdges),
      scenicEdgeRatio: ratio(scenicEdges, totalEdges),
      asphaltRatio: ratio(asphaltSurfaces, totalEdges),
      naturalAreaSignal: ratio(scenicEdges + naturalSurfaces, totalEdges),
      fragmentationScore: 0,
    },
    warnings: [],
    recommendations: [],
  };
}
