import type { EnrichedEdge, EnrichedGraph } from '../../types';
import type { RouteSurfaceV3, TerrainComponentKindV3 } from '../types';
import { extractRankedNaturalCyclesV3 } from './ranked-natural-cycle-extractor';
import type { RankedNaturalCyclesDiagnosticsV3 } from './ranked-natural-cycle-extractor';

const PAVED_SURFACES = new Set(['asphalt', 'concrete', 'paved', 'paving_stones', 'sett', 'cobblestone', 'compacted']);
const NATURAL_SURFACES = new Set(['dirt', 'earth', 'grass', 'ground', 'gravel', 'mud', 'sand', 'soil', 'unpaved', 'woodchips']);
const ROAD_LIKE_HIGHWAYS = new Set(['secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);
const PATH_LIKE_HIGHWAYS = new Set(['path', 'track', 'footway', 'bridleway', 'pedestrian']);

interface DirectedNaturalEdgeV3 {
  edge: EnrichedEdge;
  from: string;
  to: string;
  kind: TerrainComponentKindV3;
  surface: RouteSurfaceV3;
}

export interface NaturalGraphContractionInputV3 {
  graph: EnrichedGraph;
  targetComponentIds: TerrainComponentKindV3[];
  startNodeId?: string;
  minUsefulCycleKm?: number;
  debugInjectMissingOriginalEdgeId?: boolean;
}

export interface NaturalContractedNodeV3 {
  id: string;
  originalNodeId: string;
  degree: number;
  gateway: boolean;
}

export interface NaturalContractedCorridorV3 {
  id: string;
  fromNodeId: string;
  toNodeId: string;
  originalNodeIds: string[];
  originalEdgeIds: string[];
  lengthKm: number;
  surfaceSummary: RouteSurfaceV3[];
  highways: string[];
  access: string[];
}

export interface NaturalCycleCandidateV3 {
  id: string;
  originalNodeIds: string[];
  originalEdgeIds: string[];
  lengthKm: number;
  corridorIds: string[];
  qualityScore: number;
}

export interface NaturalLandmarkV3 {
  nodeId: string;
  distanceFromStartKm: number | null;
  degree: number;
}

export interface NaturalGraphContractionDiagnosticsV3 {
  contractedNodeCount: number;
  contractedCorridorCount: number;
  originalNaturalEdgeCount: number;
  cycleCandidateCount: number;
  landmarkCount: number;
  gatewayCount: number;
  selectedCycleOrLandmarkPlan: {
    type: 'cycle' | 'landmark' | 'none';
    id: string | null;
    originalEdgeIds: string[];
    lengthKm: number;
  } | null;
  expansionValidity: {
    valid: boolean;
    missingOriginalEdgeIds: string[];
    disconnectedCorridorIds: string[];
  };
  jaccardDedupCount: number;
  rankedNaturalCycles: RankedNaturalCyclesDiagnosticsV3;
  runtimeByStage: {
    adjacencyMs: number;
    contractionMs: number;
    cycleMs: number;
    landmarkMs: number;
    validationMs: number;
    totalMs: number;
  };
}

export interface NaturalGraphContractionResultV3 {
  nodes: NaturalContractedNodeV3[];
  corridors: NaturalContractedCorridorV3[];
  cycleCandidates: NaturalCycleCandidateV3[];
  landmarks: NaturalLandmarkV3[];
  diagnostics: NaturalGraphContractionDiagnosticsV3;
}

export function contractNaturalGraphV3(input: NaturalGraphContractionInputV3): NaturalGraphContractionResultV3 {
  const startedAt = Date.now();
  const adjacencyStart = Date.now();
  const targetComponents = new Set(input.targetComponentIds);
  const naturalAdjacency = buildNaturalAdjacency(input.graph, targetComponents);
  const fullAdjacency = buildFullAdjacency(input.graph);
  const originalNaturalEdgeIds = uniqueEdgeIds(naturalAdjacency);
  const adjacencyMs = Date.now() - adjacencyStart;

  const contractionStart = Date.now();
  const gateways = gatewayNodeIds(naturalAdjacency, fullAdjacency);
  const nodeDegrees = new Map(Array.from(naturalAdjacency.entries()).map(([nodeId, edges]) => [nodeId, uniqueIncidentEdgeCount(edges)]));
  let junctionIds = Array.from(nodeDegrees.entries())
    .filter(([nodeId, degree]) => degree !== 2 || gateways.has(nodeId))
    .map(([nodeId]) => nodeId);
  if (junctionIds.length === 0 && naturalAdjacency.size > 0) {
    junctionIds = [Array.from(naturalAdjacency.keys()).sort()[0]];
  }
  const junctionSet = new Set(junctionIds);
  const nodes = junctionIds.sort().map((nodeId) => ({
    id: `contracted-node-${nodeId}`,
    originalNodeId: nodeId,
    degree: nodeDegrees.get(nodeId) ?? 0,
    gateway: gateways.has(nodeId),
  }));
  const corridors = buildCorridors(naturalAdjacency, junctionSet);
  const contractionMs = Date.now() - contractionStart;

  const cycleStart = Date.now();
  const rankedCycles = extractRankedNaturalCyclesV3({
    graph: input.graph,
    targetComponentIds: input.targetComponentIds,
    minUsefulCycleKm: input.minUsefulCycleKm ?? 1.5,
    targetDistanceKm: Math.max(input.minUsefulCycleKm ?? 1.5, 8),
    maxCandidates: 24,
    maxBackEdges: 12000,
  });
  const rawCycles = rankedCycles.cycles;
  const { cycles, dedupCount } = { cycles: rawCycles, dedupCount: rankedCycles.diagnostics.jaccardDedupCount };
  const cycleMs = Date.now() - cycleStart;

  const landmarkStart = Date.now();
  const landmarks = buildLandmarks(input.startNodeId, naturalAdjacency, nodeDegrees).slice(0, 8);
  const landmarkMs = Date.now() - landmarkStart;

  const validationStart = Date.now();
  if (input.debugInjectMissingOriginalEdgeId && corridors[0]) corridors[0].originalEdgeIds.push('debug-missing-edge');
  const expansionValidity = validateExpansion(input.graph, corridors, cycles);
  const validationMs = Date.now() - validationStart;

  const selectedCycle = cycles[0] ?? null;
  const selectedLandmark = !selectedCycle && input.startNodeId && landmarks.length >= 3 ? landmarks[2] : null;
  const selectedCycleOrLandmarkPlan = selectedCycle
    ? { type: 'cycle' as const, id: selectedCycle.id, originalEdgeIds: selectedCycle.originalEdgeIds, lengthKm: selectedCycle.lengthKm }
    : selectedLandmark
      ? { type: 'landmark' as const, id: selectedLandmark.nodeId, originalEdgeIds: [], lengthKm: selectedLandmark.distanceFromStartKm ?? 0 }
      : { type: 'none' as const, id: null, originalEdgeIds: [], lengthKm: 0 };

  return {
    nodes,
    corridors,
    cycleCandidates: cycles,
    landmarks,
    diagnostics: {
      contractedNodeCount: nodes.length,
      contractedCorridorCount: corridors.length,
      originalNaturalEdgeCount: originalNaturalEdgeIds.size,
      cycleCandidateCount: cycles.length,
      landmarkCount: landmarks.length,
      gatewayCount: gateways.size,
      selectedCycleOrLandmarkPlan,
      expansionValidity,
      jaccardDedupCount: dedupCount,
      rankedNaturalCycles: rankedCycles.diagnostics,
      runtimeByStage: {
        adjacencyMs,
        contractionMs,
        cycleMs,
        landmarkMs,
        validationMs,
        totalMs: Date.now() - startedAt,
      },
    },
  };
}

function buildNaturalAdjacency(graph: EnrichedGraph, targetComponents: Set<TerrainComponentKindV3>): Map<string, DirectedNaturalEdgeV3[]> {
  const adjacency = new Map<string, DirectedNaturalEdgeV3[]>();
  for (const nodeId of Array.from(graph.nodes.keys())) adjacency.set(nodeId, []);
  for (const edge of Array.from(graph.edges.values())) {
    const surface = routeSurface(edge);
    const kind = componentKind(edge);
    if (surface === 'paved' || !targetComponents.has(kind)) continue;
    adjacency.get(edge.from)?.push({ edge, from: edge.from, to: edge.to, kind, surface });
    adjacency.get(edge.to)?.push({ edge, from: edge.to, to: edge.from, kind, surface });
  }
  return new Map(Array.from(adjacency.entries()).filter(([, edges]) => edges.length > 0));
}

function buildFullAdjacency(graph: EnrichedGraph): Map<string, EnrichedEdge[]> {
  const adjacency = new Map<string, EnrichedEdge[]>();
  for (const nodeId of Array.from(graph.nodes.keys())) adjacency.set(nodeId, []);
  for (const edge of Array.from(graph.edges.values())) {
    adjacency.get(edge.from)?.push(edge);
    adjacency.get(edge.to)?.push(edge);
  }
  return adjacency;
}

function buildCorridors(
  adjacency: Map<string, DirectedNaturalEdgeV3[]>,
  junctionSet: Set<string>,
): NaturalContractedCorridorV3[] {
  const corridors: NaturalContractedCorridorV3[] = [];
  const visited = new Set<string>();
  const startNodes = Array.from(junctionSet).sort();
  for (const start of startNodes) {
    for (const firstEdge of adjacency.get(start) ?? []) {
      if (visited.has(firstEdge.edge.id)) continue;
      const directed = walkCorridor(start, firstEdge, adjacency, junctionSet, visited);
      if (directed.length === 0) continue;
      corridors.push(corridorFromDirectedEdges(`corridor-${corridors.length + 1}`, start, directed));
    }
  }
  for (const edges of Array.from(adjacency.values())) {
    for (const edge of edges) {
      if (visited.has(edge.edge.id)) continue;
      const directed = walkCorridor(edge.from, edge, adjacency, junctionSet, visited);
      if (directed.length > 0) corridors.push(corridorFromDirectedEdges(`corridor-${corridors.length + 1}`, edge.from, directed));
    }
  }
  return corridors;
}

function walkCorridor(
  start: string,
  firstEdge: DirectedNaturalEdgeV3,
  adjacency: Map<string, DirectedNaturalEdgeV3[]>,
  junctionSet: Set<string>,
  visited: Set<string>,
): DirectedNaturalEdgeV3[] {
  const directed: DirectedNaturalEdgeV3[] = [];
  let current = start;
  let nextEdge: DirectedNaturalEdgeV3 | undefined = firstEdge;
  while (nextEdge && !visited.has(nextEdge.edge.id)) {
    directed.push(nextEdge);
    visited.add(nextEdge.edge.id);
    current = nextEdge.to;
    if (junctionSet.has(current) && current !== start) break;
    nextEdge = (adjacency.get(current) ?? [])
      .filter((edge) => edge.edge.id !== nextEdge?.edge.id && !visited.has(edge.edge.id))
      .sort((a, b) => a.edge.id.localeCompare(b.edge.id))[0];
    if (current === start) break;
  }
  return directed;
}

function corridorFromDirectedEdges(id: string, start: string, edges: DirectedNaturalEdgeV3[]): NaturalContractedCorridorV3 {
  const originalNodeIds = [start, ...edges.map((edge) => edge.to)];
  return {
    id,
    fromNodeId: start,
    toNodeId: edges.at(-1)?.to ?? start,
    originalNodeIds,
    originalEdgeIds: edges.map((edge) => edge.edge.id),
    lengthKm: round(edges.reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0)),
    surfaceSummary: Array.from(new Set(edges.map((edge) => edge.surface))).sort(),
    highways: Array.from(new Set(edges.map((edge) => (edge.edge.highway ?? '').toLowerCase()).filter(Boolean))).sort(),
    access: Array.from(new Set(edges.flatMap((edge) => edge.edge.access ? [edge.edge.access] : []))).sort(),
  };
}

function buildLandmarks(
  startNodeId: string | undefined,
  adjacency: Map<string, DirectedNaturalEdgeV3[]>,
  nodeDegrees: Map<string, number>,
): NaturalLandmarkV3[] {
  if (!startNodeId) {
    return Array.from(adjacency.keys()).map((nodeId) => ({ nodeId, distanceFromStartKm: null, degree: nodeDegrees.get(nodeId) ?? 0 }))
      .sort((a, b) => b.degree - a.degree || a.nodeId.localeCompare(b.nodeId));
  }
  const distances = shortestDistances(startNodeId, adjacency);
  return Array.from(adjacency.keys())
    .map((nodeId) => ({ nodeId, distanceFromStartKm: distances.get(nodeId) ?? null, degree: nodeDegrees.get(nodeId) ?? 0 }))
    .filter((landmark) => landmark.distanceFromStartKm !== null)
    .sort((a, b) => (b.distanceFromStartKm ?? 0) - (a.distanceFromStartKm ?? 0) || b.degree - a.degree);
}

function shortestDistances(startNodeId: string, adjacency: Map<string, DirectedNaturalEdgeV3[]>): Map<string, number> {
  const distances = new Map<string, number>([[startNodeId, 0]]);
  const pending = [{ nodeId: startNodeId, distanceKm: 0 }];
  while (pending.length > 0) {
    const current = pending.sort((a, b) => a.distanceKm - b.distanceKm).shift();
    if (!current) break;
    if (current.distanceKm > (distances.get(current.nodeId) ?? Number.POSITIVE_INFINITY) + 0.000001) continue;
    for (const edge of adjacency.get(current.nodeId) ?? []) {
      const nextDistanceKm = current.distanceKm + Math.max(0, edge.edge.lengthKm);
      if (nextDistanceKm + 0.000001 >= (distances.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      distances.set(edge.to, nextDistanceKm);
      pending.push({ nodeId: edge.to, distanceKm: nextDistanceKm });
    }
  }
  return distances;
}

function validateExpansion(
  graph: EnrichedGraph,
  corridors: NaturalContractedCorridorV3[],
  cycles: NaturalCycleCandidateV3[],
): NaturalGraphContractionDiagnosticsV3['expansionValidity'] {
  const missing = new Set<string>();
  const disconnectedCorridorIds: string[] = [];
  for (const corridor of corridors) {
    let current = corridor.originalNodeIds[0];
    for (let index = 0; index < corridor.originalEdgeIds.length; index += 1) {
      const edge = graph.edges.get(corridor.originalEdgeIds[index]);
      if (!edge) {
        missing.add(corridor.originalEdgeIds[index]);
        continue;
      }
      const nextNode = corridor.originalNodeIds[index + 1];
      if (!current || !nextNode || !((edge.from === current && edge.to === nextNode) || (edge.to === current && edge.from === nextNode))) {
        disconnectedCorridorIds.push(corridor.id);
        break;
      }
      current = nextNode;
    }
  }
  for (const cycle of cycles) {
    for (const edgeId of cycle.originalEdgeIds) {
      if (!graph.edges.has(edgeId)) missing.add(edgeId);
    }
  }
  return {
    valid: missing.size === 0 && disconnectedCorridorIds.length === 0,
    missingOriginalEdgeIds: Array.from(missing).sort(),
    disconnectedCorridorIds: Array.from(new Set(disconnectedCorridorIds)).sort(),
  };
}

function gatewayNodeIds(
  naturalAdjacency: Map<string, DirectedNaturalEdgeV3[]>,
  fullAdjacency: Map<string, EnrichedEdge[]>,
): Set<string> {
  const gateways = new Set<string>();
  for (const nodeId of Array.from(naturalAdjacency.keys())) {
    const naturalEdgeIds = new Set((naturalAdjacency.get(nodeId) ?? []).map((edge) => edge.edge.id));
    if ((fullAdjacency.get(nodeId) ?? []).some((edge) => !naturalEdgeIds.has(edge.id))) gateways.add(nodeId);
  }
  return gateways;
}

function uniqueEdgeIds(adjacency: Map<string, DirectedNaturalEdgeV3[]>): Set<string> {
  return new Set(Array.from(adjacency.values()).flat().map((edge) => edge.edge.id));
}

function uniqueIncidentEdgeCount(edges: DirectedNaturalEdgeV3[]): number {
  return new Set(edges.map((edge) => edge.edge.id)).size;
}

function routeSurface(edge: EnrichedEdge): RouteSurfaceV3 {
  const surface = (edge.surface ?? '').toLowerCase();
  if (PAVED_SURFACES.has(surface)) return 'paved';
  if (NATURAL_SURFACES.has(surface)) return 'natural';
  if (edge.terrainContext?.landcoverClass === 'forest') return 'natural';
  if (ROAD_LIKE_HIGHWAYS.has((edge.highway ?? '').toLowerCase())) return 'paved';
  return 'mixed';
}

function componentKind(edge: EnrichedEdge): TerrainComponentKindV3 {
  const surface = routeSurface(edge);
  const highway = (edge.highway ?? '').toLowerCase();
  const landcover = edge.terrainContext?.landcoverClass;

  if (surface === 'paved' && edge.scenic && ROAD_LIKE_HIGHWAYS.has(highway)) return 'scenic_paved';
  if (landcover === 'forest') return 'forest';
  if (landcover === 'park') return 'park';
  if (landcover === 'water_corridor') return 'river_corridor';
  if (landcover === 'urban') return edge.scenic ? 'urban_green' : 'residential';
  if (surface === 'paved' && edge.scenic) return 'scenic_paved';
  if (surface === 'natural' && PATH_LIKE_HIGHWAYS.has(highway)) return edge.scenic ? 'forest' : 'field_paths';
  if (edge.scenic) return 'urban_green';
  if (ROAD_LIKE_HIGHWAYS.has(highway)) return 'residential';
  return 'field_paths';
}

function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}
