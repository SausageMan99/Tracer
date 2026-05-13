import type { EnrichedEdge } from '../types';

const EXPLICIT_PAVED_SURFACES = new Set(['asphalt', 'concrete', 'paved', 'sett', 'paving_stones']);

export function normalizeSurface(surface: string | null | undefined): string {
  return (surface ?? '').trim().toLowerCase();
}

export function hasExplicitPavedSurface(edge: Pick<EnrichedEdge, 'surface'>): boolean {
  return EXPLICIT_PAVED_SURFACES.has(normalizeSurface(edge.surface));
}

export function isSurfaceRatioPaved(edge: Pick<EnrichedEdge, 'surface'>): boolean {
  return hasExplicitPavedSurface(edge);
}

export function hasHighNaturalTerrainContext(edge: Pick<EnrichedEdge, 'terrainContext'>): boolean {
  return (edge.terrainContext?.naturalContextScore ?? 0) >= 0.7;
}

export function hasExplicitPavedInNaturalContext(edge: Pick<EnrichedEdge, 'surface' | 'terrainContext'>): boolean {
  return hasExplicitPavedSurface(edge) && hasHighNaturalTerrainContext(edge);
}
