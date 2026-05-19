import type { EnrichedEdge } from '../types';
import type { RouteEdgeV3, RouteSurfaceV3, TerrainComponentKindV3 } from './types';

export type EdgeSurfaceEvidenceV3 =
  | 'explicit_paved'
  | 'explicit_natural'
  | 'path_track_unknown'
  | 'road_like_unknown'
  | 'contextual_natural_unknown'
  | 'unknown';

export interface EdgeSemanticsV3 {
  surfaceEvidence: EdgeSurfaceEvidenceV3;
  routeSurface: RouteSurfaceV3;
  /** Truth/product paved-equivalent weight. Unknown path/track remains mixed here. */
  pavedEquivalentWeight: number;
  /** Search/candidate weight. Lets credible unknown paths be explored without calling them strict trail. */
  candidateNaturalWeight: number;
  trailConfidence: number;
  isTrailCandidate: boolean;
  isUnverifiedTrailCandidate: boolean;
  isStrictTrailLike: boolean;
  isConnectorLike: boolean;
  componentKind: TerrainComponentKindV3;
  explanation: string;
}

type SemanticEdgeInput = Pick<EnrichedEdge, 'highway' | 'surface' | 'scenic' | 'terrainContext'> & Partial<Pick<RouteEdgeV3, 'componentKind'>>;

export const PAVED_SURFACES_V3 = new Set(['asphalt', 'concrete', 'paved', 'paving_stones', 'sett', 'cobblestone', 'compacted']);
export const NATURAL_SURFACES_V3 = new Set(['natural', 'dirt', 'earth', 'grass', 'ground', 'gravel', 'mud', 'sand', 'soil', 'unpaved', 'woodchips']);
export const ROAD_LIKE_HIGHWAYS_V3 = new Set(['motorway', 'trunk', 'primary', 'secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);
export const PATH_LIKE_HIGHWAYS_V3 = new Set(['path', 'track', 'footway', 'bridleway', 'pedestrian', 'steps']);
export const STRICT_TRAIL_HIGHWAYS_V3 = PATH_LIKE_HIGHWAYS_V3;

export function classifyEdgeSemanticsV3(edge: SemanticEdgeInput): EdgeSemanticsV3 {
  const surface = edge.surface?.toLowerCase().trim();
  const highway = (edge.highway ?? '').toLowerCase().trim();
  const landcover = edge.terrainContext?.landcoverClass;
  const componentKind = edge.componentKind;
  const hasNaturalContext = landcover === 'forest'
    || landcover === 'park'
    || componentKind === 'forest'
    || componentKind === 'park'
    || componentKind === 'field_paths'
    || componentKind === 'urban_green'
    || edge.scenic === true;
  const explicitPaved = Boolean(surface && PAVED_SURFACES_V3.has(surface));
  const explicitNatural = Boolean(surface && NATURAL_SURFACES_V3.has(surface));
  const pathLike = PATH_LIKE_HIGHWAYS_V3.has(highway);
  const roadLike = ROAD_LIKE_HIGHWAYS_V3.has(highway);

  if (explicitPaved) {
    return buildSemantics({
      surfaceEvidence: 'explicit_paved',
      routeSurface: 'paved',
      pavedEquivalentWeight: 1,
      candidateNaturalWeight: 0,
      trailConfidence: hasNaturalContext && pathLike ? 0.15 : 0.05,
      isTrailCandidate: false,
      isUnverifiedTrailCandidate: false,
      isStrictTrailLike: false,
      isConnectorLike: true,
      componentKind: componentKindFor(edge, 'paved', roadLike, hasNaturalContext),
      explanation: `${surface} is explicit paved evidence; forest/scenic context can only make it a connector, never trail`,
    });
  }

  if (explicitNatural) {
    return buildSemantics({
      surfaceEvidence: 'explicit_natural',
      routeSurface: 'natural',
      pavedEquivalentWeight: 0,
      candidateNaturalWeight: 1,
      trailConfidence: pathLike ? 1 : hasNaturalContext ? 0.8 : 0.65,
      isTrailCandidate: true,
      isUnverifiedTrailCandidate: false,
      isStrictTrailLike: pathLike,
      isConnectorLike: false,
      componentKind: componentKindFor(edge, 'natural', roadLike, hasNaturalContext),
      explanation: `${surface} is explicit natural/non-paved surface evidence`,
    });
  }

  if (roadLike) {
    return buildSemantics({
      surfaceEvidence: 'road_like_unknown',
      routeSurface: 'mixed',
      pavedEquivalentWeight: 1,
      candidateNaturalWeight: hasNaturalContext ? 0.1 : 0.02,
      trailConfidence: hasNaturalContext ? 0.2 : 0.05,
      isTrailCandidate: false,
      isUnverifiedTrailCandidate: false,
      isStrictTrailLike: false,
      isConnectorLike: true,
      componentKind: edge.scenic ? 'scenic_paved' : 'residential',
      explanation: 'road-like highway with unknown surface is paved-equivalent unless explicit non-paved evidence exists',
    });
  }

  if (pathLike) {
    return buildSemantics({
      surfaceEvidence: 'path_track_unknown',
      routeSurface: 'mixed',
      pavedEquivalentWeight: 0.5,
      candidateNaturalWeight: hasNaturalContext ? 0.85 : 0.35,
      trailConfidence: hasNaturalContext ? 0.75 : 0.35,
      isTrailCandidate: hasNaturalContext,
      isUnverifiedTrailCandidate: hasNaturalContext,
      isStrictTrailLike: false,
      isConnectorLike: !hasNaturalContext,
      componentKind: componentKindFor(edge, 'mixed', roadLike, hasNaturalContext),
      explanation: 'path/track-like highway lacks explicit surface; treat as mixed, not strict trail',
    });
  }

  if (hasNaturalContext) {
    return buildSemantics({
      surfaceEvidence: 'contextual_natural_unknown',
      routeSurface: 'mixed',
      pavedEquivalentWeight: 0.5,
      candidateNaturalWeight: 0.55,
      trailConfidence: 0.45,
      isTrailCandidate: true,
      isUnverifiedTrailCandidate: true,
      isStrictTrailLike: false,
      isConnectorLike: false,
      componentKind: componentKindFor(edge, 'mixed', roadLike, hasNaturalContext),
      explanation: 'forest/park/scenic context raises confidence but does not replace missing surface evidence',
    });
  }

  return buildSemantics({
    surfaceEvidence: 'unknown',
    routeSurface: 'mixed',
    pavedEquivalentWeight: 0.5,
    candidateNaturalWeight: 0.1,
    trailConfidence: 0.1,
    isTrailCandidate: false,
    isUnverifiedTrailCandidate: false,
    isStrictTrailLike: false,
    isConnectorLike: true,
    componentKind: edge.componentKind ?? 'field_paths',
    explanation: 'unknown surface/highway evidence remains mixed',
  });
}

function componentKindFor(
  edge: SemanticEdgeInput,
  routeSurface: RouteSurfaceV3,
  roadLike: boolean,
  hasNaturalContext: boolean,
): TerrainComponentKindV3 {
  const landcover = edge.terrainContext?.landcoverClass;
  if (routeSurface === 'paved' && edge.scenic && roadLike) return 'scenic_paved';
  if (landcover === 'forest') return 'forest';
  if (landcover === 'park') return 'park';
  if (landcover === 'water_corridor') return 'river_corridor';
  if (landcover === 'urban') return edge.scenic ? 'urban_green' : 'residential';
  if (routeSurface === 'paved' && edge.scenic) return 'scenic_paved';
  if (routeSurface === 'natural' && hasNaturalContext) return 'forest';
  if (routeSurface === 'natural') return 'field_paths';
  if (edge.scenic) return 'urban_green';
  if (roadLike) return 'residential';
  return edge.componentKind ?? 'field_paths';
}

function buildSemantics(semantics: EdgeSemanticsV3): EdgeSemanticsV3 {
  return {
    ...semantics,
    pavedEquivalentWeight: clamp01(semantics.pavedEquivalentWeight),
    candidateNaturalWeight: clamp01(semantics.candidateNaturalWeight),
    trailConfidence: clamp01(semantics.trailConfidence),
  };
}

export function candidateNaturalEquivalentKmV3(edge: SemanticEdgeInput & { lengthKm?: number }): number {
  return Math.max(0, edge.lengthKm ?? 0) * classifyEdgeSemanticsV3(edge).candidateNaturalWeight;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}
