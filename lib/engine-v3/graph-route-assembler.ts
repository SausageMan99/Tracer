import type { EnrichedEdge, EnrichedGraph, GraphNode } from '../types';
import type {
  AssembledRouteV3,
  CorridorMissionV3,
  RouteEdgeV3,
  RouteIntentV3,
  RouteSurfaceV3,
  TerrainComponentKindV3,
} from './types';

const PAVED_SURFACES = new Set(['asphalt', 'concrete', 'paved', 'paving_stones', 'sett', 'cobblestone', 'compacted']);
const NATURAL_SURFACES = new Set(['dirt', 'earth', 'grass', 'ground', 'gravel', 'mud', 'sand', 'soil', 'unpaved', 'woodchips']);
const ROAD_LIKE_HIGHWAYS = new Set(['secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);
const PATH_LIKE_HIGHWAYS = new Set(['path', 'track', 'footway', 'bridleway', 'pedestrian']);

interface TraversalEdge {
  edge: EnrichedEdge;
  from: string;
  to: string;
  kind: TerrainComponentKindV3;
  surface: RouteSurfaceV3;
}

interface AssemblyCounters {
  pavedKm: number;
  nonPavedKm: number;
  naturalDwellKm: number;
  repeatEdgeKm: number;
  visitedComponents: TerrainComponentKindV3[];
}

export function assembleGraphRouteV3(intent: RouteIntentV3, mission: CorridorMissionV3, graph: EnrichedGraph): AssembledRouteV3 {
  if (!mission.anchor || intent.strategy === 'unroutable') return emptyGraphRoute(intent, mission, 'no usable anchor for graph assembly');

  const startNodeId = closestNodeId(graph, intent.request?.start ?? graph.center);
  if (!startNodeId) return emptyGraphRoute(intent, mission, 'graph contains no nodes for assembly');

  const adjacency = buildAdjacency(graph);
  const traversal = walkGraph(startNodeId, intent, adjacency);
  if (traversal.length === 0) return emptyGraphRoute(intent, mission, 'graph assembly could not traverse routeable edges');

  const nodeIds = nodesFromTraversal(startNodeId, traversal);
  const edges = traversal.map(toRouteEdge);
  const counters = computeCounters(edges, intent.constraints.targetComponents);
  const distanceProducedKm = round(edges.reduce((sum, edge) => sum + edge.lengthKm, 0));
  const geometry = toGeometry(graph, nodeIds);
  const warnings = [...mission.warnings];
  if (distanceProducedKm < intent.constraints.targetDistanceKm * 0.7) warnings.push('graph assembly produced insufficient route distance');

  return {
    engine: 'v3-clean-room',
    strategy: intent.strategy,
    mission: cloneMission(mission),
    segments: [],
    edges,
    nodeIds,
    geometry,
    surfaces: {
      pavedKm: round(counters.pavedKm),
      nonPavedKm: round(counters.nonPavedKm),
      naturalDwellKm: round(counters.naturalDwellKm),
    },
    metrics: {
      targetDistanceKm: intent.constraints.targetDistanceKm,
      distanceProducedKm,
      trailRatio: ratio(counters.nonPavedKm, distanceProducedKm),
      naturalWayRatio: ratio(counters.nonPavedKm, distanceProducedKm),
      pavedRatio: ratio(counters.pavedKm, distanceProducedKm),
      pavedKm: round(counters.pavedKm),
      nonPavedKm: round(counters.nonPavedKm),
      naturalDwellKm: round(counters.naturalDwellKm),
      repeatEdgeKm: round(counters.repeatEdgeKm),
      visitedComponents: counters.visitedComponents,
      repeatRatio: ratio(counters.repeatEdgeKm, distanceProducedKm),
      overlapRatio: ratio(counters.repeatEdgeKm, distanceProducedKm),
    },
    warnings,
  };
}

function walkGraph(startNodeId: string, intent: RouteIntentV3, adjacency: Map<string, TraversalEdge[]>): TraversalEdge[] {
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const used = new Set<string>();
  const traversed: TraversalEdge[] = [];
  let current = startNodeId;
  let distanceKm = 0;

  for (let step = 0; step < 256; step += 1) {
    const candidates = (adjacency.get(current) ?? []).filter((candidate) => !used.has(candidate.edge.id));
    if (candidates.length === 0) break;
    if (distanceKm >= targetDistanceKm * 0.9 && !hasUsefulClosingCandidate(candidates, startNodeId, distanceKm, targetDistanceKm)) break;

    const next = chooseNextEdge(candidates, intent, startNodeId, distanceKm, targetDistanceKm);
    traversed.push(next);
    used.add(next.edge.id);
    distanceKm += Math.max(0, next.edge.lengthKm);
    current = next.to;

    if (current === startNodeId && distanceKm >= targetDistanceKm * 0.7) break;
    if (distanceKm >= targetDistanceKm * 1.15) break;
    if (distanceKm >= targetDistanceKm * 0.98 && !hasClosingCandidate(adjacency.get(current) ?? [], startNodeId, used)) break;
  }

  return traversed;
}

function chooseNextEdge(
  candidates: TraversalEdge[],
  intent: RouteIntentV3,
  startNodeId: string,
  distanceKm: number,
  targetDistanceKm: number,
): TraversalEdge {
  return [...candidates].sort((a, b) => {
    const aClosing = a.to === startNodeId && distanceKm + a.edge.lengthKm >= targetDistanceKm * 0.65 ? 1 : 0;
    const bClosing = b.to === startNodeId && distanceKm + b.edge.lengthKm >= targetDistanceKm * 0.65 ? 1 : 0;
    if (aClosing !== bClosing) return bClosing - aClosing;

    const aTarget = intent.constraints.targetComponents.includes(a.kind) ? 1 : 0;
    const bTarget = intent.constraints.targetComponents.includes(b.kind) ? 1 : 0;
    if (aTarget !== bTarget) return bTarget - aTarget;

    const aNatural = a.surface === 'natural' ? 1 : 0;
    const bNatural = b.surface === 'natural' ? 1 : 0;
    if (aNatural !== bNatural) return bNatural - aNatural;

    const aOvershoot = Math.max(0, distanceKm + a.edge.lengthKm - targetDistanceKm);
    const bOvershoot = Math.max(0, distanceKm + b.edge.lengthKm - targetDistanceKm);
    if (aOvershoot !== bOvershoot) return aOvershoot - bOvershoot;

    return (b.edge.score ?? 0) - (a.edge.score ?? 0) || b.edge.lengthKm - a.edge.lengthKm;
  })[0]!;
}

function hasUsefulClosingCandidate(candidates: TraversalEdge[], startNodeId: string, distanceKm: number, targetDistanceKm: number): boolean {
  return candidates.some((candidate) => candidate.to === startNodeId && distanceKm + candidate.edge.lengthKm <= targetDistanceKm * 1.2);
}

function hasClosingCandidate(candidates: TraversalEdge[], startNodeId: string, used: Set<string>): boolean {
  return candidates.some((candidate) => candidate.to === startNodeId && !used.has(candidate.edge.id));
}

function buildAdjacency(graph: EnrichedGraph): Map<string, TraversalEdge[]> {
  const adjacency = new Map<string, TraversalEdge[]>();
  for (const edge of Array.from(graph.edges.values())) {
    const surface = classifySurface(edge);
    const kind = classifyComponentKind(edge, surface);
    pushAdjacency(adjacency, edge.from, { edge, from: edge.from, to: edge.to, kind, surface });
    pushAdjacency(adjacency, edge.to, { edge, from: edge.to, to: edge.from, kind, surface });
  }
  return adjacency;
}

function pushAdjacency(adjacency: Map<string, TraversalEdge[]>, nodeId: string, edge: TraversalEdge): void {
  const edges = adjacency.get(nodeId) ?? [];
  edges.push(edge);
  adjacency.set(nodeId, edges);
}

function nodesFromTraversal(startNodeId: string, traversal: TraversalEdge[]): string[] {
  return traversal.reduce<string[]>((nodeIds, edge) => [...nodeIds, edge.to], [startNodeId]);
}

function toRouteEdge(edge: TraversalEdge): RouteEdgeV3 {
  return {
    id: edge.edge.id,
    from: edge.from,
    to: edge.to,
    lengthKm: round(Math.max(0, edge.edge.lengthKm)),
    surface: edge.surface,
    componentKind: edge.kind,
    highway: edge.edge.highway,
    osmWayId: edge.edge.osmWayId,
  };
}

function computeCounters(edges: RouteEdgeV3[], targetComponents: TerrainComponentKindV3[]): AssemblyCounters {
  const visitedComponents: TerrainComponentKindV3[] = [];
  const traversalsByEdge = new Map<string, number>();
  let pavedKm = 0;
  let nonPavedKm = 0;
  let naturalDwellKm = 0;
  let repeatEdgeKm = 0;

  for (const edge of edges) {
    if (!visitedComponents.includes(edge.componentKind)) visitedComponents.push(edge.componentKind);
    const previousTraversals = traversalsByEdge.get(edge.id) ?? 0;
    if (previousTraversals > 0) repeatEdgeKm += edge.lengthKm;
    traversalsByEdge.set(edge.id, previousTraversals + 1);

    if (edge.surface === 'paved') pavedKm += edge.lengthKm;
    else if (edge.surface === 'natural') nonPavedKm += edge.lengthKm;
    else {
      pavedKm += edge.lengthKm * 0.5;
      nonPavedKm += edge.lengthKm * 0.5;
    }

    if (targetComponents.includes(edge.componentKind) && edge.surface !== 'paved') naturalDwellKm += edge.surface === 'mixed' ? edge.lengthKm * 0.5 : edge.lengthKm;
  }

  return { pavedKm, nonPavedKm, naturalDwellKm, repeatEdgeKm, visitedComponents };
}

function toGeometry(graph: EnrichedGraph, nodeIds: string[]): AssembledRouteV3['geometry'] {
  return {
    type: 'LineString',
    coordinates: nodeIds
      .map((nodeId) => graph.nodes.get(nodeId))
      .filter((node): node is GraphNode => Boolean(node))
      .map((node) => [node.lng, node.lat]),
  };
}

function closestNodeId(graph: EnrichedGraph, coordinate: { lat: number; lng: number }): string | null {
  let best: { id: string; distanceSq: number } | null = null;
  for (const node of Array.from(graph.nodes.values())) {
    const distanceSq = (node.lat - coordinate.lat) ** 2 + (node.lng - coordinate.lng) ** 2;
    if (!best || distanceSq < best.distanceSq) best = { id: node.id, distanceSq };
  }
  return best?.id ?? null;
}

function classifySurface(edge: EnrichedEdge): RouteSurfaceV3 {
  const surface = edge.surface?.toLowerCase();
  if (surface && PAVED_SURFACES.has(surface)) return 'paved';
  if (surface && NATURAL_SURFACES.has(surface)) return 'natural';
  return 'mixed';
}

function classifyComponentKind(edge: EnrichedEdge, surface: RouteSurfaceV3): TerrainComponentKindV3 {
  const landcover = edge.terrainContext?.landcoverClass;
  const highway = edge.highway.toLowerCase();

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

function emptyGraphRoute(intent: RouteIntentV3, mission: CorridorMissionV3, warning: string): AssembledRouteV3 {
  return {
    engine: 'v3-clean-room',
    strategy: intent.strategy,
    mission: cloneMission(mission),
    segments: [],
    edges: [],
    nodeIds: [],
    geometry: { type: 'LineString', coordinates: [] },
    surfaces: { pavedKm: 0, nonPavedKm: 0, naturalDwellKm: 0 },
    metrics: {
      targetDistanceKm: intent.constraints.targetDistanceKm,
      distanceProducedKm: 0,
      trailRatio: 0,
      naturalWayRatio: 0,
      pavedRatio: 1,
      pavedKm: 0,
      nonPavedKm: 0,
      naturalDwellKm: 0,
      repeatEdgeKm: 0,
      visitedComponents: [],
      repeatRatio: 0,
      overlapRatio: 0,
    },
    warnings: [...mission.warnings, warning],
  };
}

function cloneMission(mission: CorridorMissionV3): CorridorMissionV3 {
  return {
    ...mission,
    targetComponents: [...mission.targetComponents],
    anchor: mission.anchor ? { ...mission.anchor } : null,
    warnings: [...mission.warnings],
  };
}

function ratio(value: number, total: number): number {
  if (total <= 0) return 0;
  return round(value / total);
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
