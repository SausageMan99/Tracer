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
