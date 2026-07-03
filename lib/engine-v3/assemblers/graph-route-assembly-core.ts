import type { EnrichedEdge, EnrichedGraph, GraphNode } from '../../types';
import { computeRouteMetricsV3, createEmptyRouteMetricsV3 } from '../route-metrics';
import type { AssembledRouteV3, CorridorMissionV3, RouteEdgeV3, RouteIntentV3, RouteSurfaceV3, TerrainComponentKindV3 } from '../types';

const PAVED_SURFACES = new Set(['asphalt', 'concrete', 'paved', 'paving_stones', 'sett', 'cobblestone', 'compacted']);
const NATURAL_SURFACES = new Set(['dirt', 'earth', 'grass', 'ground', 'gravel', 'mud', 'sand', 'soil', 'unpaved', 'woodchips']);
const ROAD_LIKE_HIGHWAYS = new Set(['secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);
const PATH_LIKE_HIGHWAYS = new Set(['path', 'track', 'footway', 'bridleway', 'pedestrian']);

export interface TraversalEdgeV3 {
  edge: EnrichedEdge;
  from: string;
  to: string;
  kind: TerrainComponentKindV3;
  surface: RouteSurfaceV3;
}

export interface GraphAssemblyOptionsV3 {
  mode: 'forest_loop' | 'transition_to_woods' | 'park_loop' | 'low_trail_potential' | 'generic';
  requireNaturalDwell?: boolean;
  warning?: string;
  lowTrailEscape?: {
    blacklist: Set<string>;
    branchStack: Array<{
      nodeId: string;
      chosenEdgeId: string;
      traversedLength: number;
      distanceKm: number;
      enteredTarget: boolean;
      usedEdgeIds: string[];
      current: string;
    }>;
    escapesUsed: number;
    maxEscapes: number;
  };
}

export function assembleGraphRouteWithStrategyV3(
  intent: RouteIntentV3,
  mission: CorridorMissionV3,
  graph: EnrichedGraph,
  options: GraphAssemblyOptionsV3,
): AssembledRouteV3 {
  if (!mission.anchor || intent.strategy === 'unroutable') return emptyGraphRoute(intent, mission, 'no usable anchor for graph assembly');

  const startNodeId = closestNodeId(graph, intent.request?.start ?? graph.center);
  if (!startNodeId) return emptyGraphRoute(intent, mission, 'graph contains no nodes for assembly');

  const adjacency = buildAdjacency(graph);
  const traversal = walkGraph(startNodeId, intent, adjacency, options);
  if (traversal.length === 0) return emptyGraphRoute(intent, mission, 'graph assembly could not traverse routeable edges');

  const nodeIds = nodesFromTraversal(startNodeId, traversal);
  const edges = traversal.map(toRouteEdge);
  const geometry = toGeometry(graph, nodeIds);
  const metrics = computeRouteMetricsV3({
    targetDistanceKm: intent.constraints.targetDistanceKm,
    edges,
    geometry,
    targetComponents: intent.constraints.targetComponents,
  });
  const distanceProducedKm = metrics.distanceProducedKm;
  const warnings = [...mission.warnings];
  if (options.warning) warnings.push(options.warning);
  if (distanceProducedKm < intent.constraints.targetDistanceKm * 0.7) warnings.push('graph assembly produced insufficient route distance');
  if (options.requireNaturalDwell && metrics.naturalDwellKm < mission.requestedNaturalDwellKm) {
    warnings.push('transition_to_woods did not meet requested woods dwell; route remains adjusted, not pure trail');
  }

  return {
    engine: 'v3-clean-room',
    strategy: intent.strategy,
    mission: cloneMission(mission),
    segments: [],
    edges,
    nodeIds,
    geometry,
    surfaces: {
      pavedKm: metrics.pavedKm,
      nonPavedKm: metrics.nonPavedKm,
      naturalDwellKm: metrics.naturalDwellKm,
    },
    metrics,
    warnings,
  };
}

function walkGraph(
  startNodeId: string,
  intent: RouteIntentV3,
  adjacency: Map<string, TraversalEdgeV3[]>,
  options: GraphAssemblyOptionsV3,
): TraversalEdgeV3[] {
  const targetDistanceKm = intent.constraints.targetDistanceKm;
  const used = new Set<string>();
  // Visited undirected edge keys, tracked only for low_trail_potential distance
  // completion. Key = sorted(from|to) + osmWayId (or edge.id if osmWayId missing).
  // Used by chooseNextEdge to prefer unvisited path-like / target-component
  // edges over already-visited local candidates.
  const visitedUndirected = new Set<string>();
  const traversed: TraversalEdgeV3[] = [];
  let current = startNodeId;
  let distanceKm = 0;
  let enteredTarget = false;
  const escape = options.lowTrailEscape;

  for (let step = 0; step < 256; step += 1) {
    const rawCandidates = (adjacency.get(current) ?? []).filter((candidate) => !used.has(candidate.edge.id));
    const candidates = filterCandidatesForStrategy(rawCandidates, options, enteredTarget);
    if (candidates.length === 0) {
      // Controlled dead-end escape: only for low_trail_potential, only on early
      // termination (distance < 30% of target), bounded by maxEscapes. Pops the
      // most recent branch point, blacklists the edge that led to the dead-end,
      // and rewinds the walk state to that branch point.
      if (
        escape &&
        options.mode === 'low_trail_potential' &&
        distanceKm < targetDistanceKm * 0.3 &&
        escape.escapesUsed < escape.maxEscapes &&
        escape.branchStack.length > 0
      ) {
        const branch = escape.branchStack.pop()!;
        escape.blacklist.add(branch.chosenEdgeId);
        // Restore the walk to the branch point. Slice the traversed array,
        // rebuild the used set from the snapshot (excluding the blacklisted
        // edge which is no longer in the set), restore distanceKm / current
        // / enteredTarget. The blacklisted edge is removed from the used set
        // so the blacklist is the single source of truth.
        traversed.length = branch.traversedLength;
        distanceKm = branch.distanceKm;
        current = branch.current;
        enteredTarget = branch.enteredTarget;
        used.clear();
        for (const eid of branch.usedEdgeIds) {
          if (eid !== branch.chosenEdgeId) used.add(eid);
        }
        escape.escapesUsed += 1;
        continue;
      }
      break;
    }
    if (distanceKm >= targetDistanceKm * 0.9 && !hasUsefulClosingCandidate(candidates, startNodeId, distanceKm, targetDistanceKm)) break;

    // Track branch point for low_trail_potential escape: only when there was a
    // real choice (more than one candidate after filtering).
    let branchPushed = false;
    if (escape && options.mode === 'low_trail_potential' && candidates.length > 1) {
      escape.branchStack.push({
        nodeId: current,
        chosenEdgeId: '', // filled after chooseNextEdge
        traversedLength: traversed.length,
        distanceKm,
        enteredTarget,
        usedEdgeIds: Array.from(used),
        current,
      });
      branchPushed = true;
    }

    const next = chooseNextEdge(candidates, intent, startNodeId, distanceKm, targetDistanceKm, options, enteredTarget, visitedUndirected);
    if (branchPushed && escape) {
      const top = escape.branchStack[escape.branchStack.length - 1]!;
      if (top.nodeId === current && top.traversedLength === traversed.length && top.chosenEdgeId === '') {
        top.chosenEdgeId = next.edge.id;
      }
    }

    traversed.push(next);
    used.add(next.edge.id);
    distanceKm += Math.max(0, next.edge.lengthKm);
    current = next.to;
    if (intent.constraints.targetComponents.includes(next.kind)) enteredTarget = true;
    // Track undirected visit for low_trail_potential distance completion.
    if (options.mode === 'low_trail_potential') {
      visitedUndirected.add(undirectedKeyFor(next));
    }

    if (current === startNodeId && distanceKm >= targetDistanceKm * 0.7) break;
    if (distanceKm >= targetDistanceKm * 1.15) break;
    if (distanceKm >= targetDistanceKm * 0.98 && !hasClosingCandidate(adjacency.get(current) ?? [], startNodeId, used)) break;
  }

  return traversed;
}

function filterCandidatesForStrategy(candidates: TraversalEdgeV3[], options: GraphAssemblyOptionsV3, enteredTarget: boolean): TraversalEdgeV3[] {
  if (options.mode === 'forest_loop') {
    const naturalTargets = candidates.filter((candidate) => candidate.surface === 'natural' && candidate.kind === 'forest');
    if (naturalTargets.length > 0) return naturalTargets;

    const natural = candidates.filter((candidate) => candidate.surface === 'natural');
    if (natural.length > 0) return natural;

    if (!enteredTarget) return candidates;
    const nonPaved = candidates.filter((candidate) => candidate.surface !== 'paved');
    return nonPaved.length > 0 ? nonPaved : candidates;
  }

  if (options.mode === 'low_trail_potential') {
    // Prefer path-like highways with natural or unset (mixed) surface.
    // Path-like = path / track / footway / bridleway / pedestrian (per PATH_LIKE_HIGHWAYS).
    // Unset is treated as probable natural because OSM rarely tags forest paths.
    // Blacklist (controlled dead-end escape) excludes edges the walk has failed on.
    const filtered = options.lowTrailEscape
      ? candidates.filter((candidate) => !options.lowTrailEscape!.blacklist.has(candidate.edge.id))
      : candidates;
    const pathLikeNaturalOrMixed = filtered.filter(
      (candidate) =>
        PATH_LIKE_HIGHWAYS.has(candidate.edge.highway) &&
        (candidate.surface === 'natural' || candidate.surface === 'mixed'),
    );
    if (pathLikeNaturalOrMixed.length > 0) return pathLikeNaturalOrMixed;

    // No natural/mixed path-like; relax to any path-like (e.g. path with paved).
    const pathLikeAny = filtered.filter((candidate) => PATH_LIKE_HIGHWAYS.has(candidate.edge.highway));
    if (pathLikeAny.length > 0) return pathLikeAny;

    // No path-like candidate at all; return all candidates (paved etc.) minus blacklist.
    return filtered;
  }

  return candidates;
}

function chooseNextEdge(
  candidates: TraversalEdgeV3[],
  intent: RouteIntentV3,
  startNodeId: string,
  distanceKm: number,
  targetDistanceKm: number,
  options: GraphAssemblyOptionsV3,
  enteredTarget: boolean,
  visitedUndirected: Set<string>,
): TraversalEdgeV3 {
  return [...candidates].sort((a, b) => {
    const aClosing = a.to === startNodeId && distanceKm + a.edge.lengthKm >= targetDistanceKm * 0.65 ? 1 : 0;
    const bClosing = b.to === startNodeId && distanceKm + b.edge.lengthKm >= targetDistanceKm * 0.65 ? 1 : 0;
    if (aClosing !== bClosing) return bClosing - aClosing;

    if (options.mode === 'transition_to_woods' && !enteredTarget) {
      const aTarget = intent.constraints.targetComponents.includes(a.kind) ? 1 : 0;
      const bTarget = intent.constraints.targetComponents.includes(b.kind) ? 1 : 0;
      if (aTarget !== bTarget) return bTarget - aTarget;

      const aConnector = a.surface === 'paved' && a.kind === 'residential' ? 1 : 0;
      const bConnector = b.surface === 'paved' && b.kind === 'residential' ? 1 : 0;
      if (aConnector !== bConnector) return bConnector - aConnector;

      return a.edge.lengthKm - b.edge.lengthKm || (b.edge.score ?? 0) - (a.edge.score ?? 0);
    }

    const aTarget = intent.constraints.targetComponents.includes(a.kind) ? 1 : 0;
    const bTarget = intent.constraints.targetComponents.includes(b.kind) ? 1 : 0;
    if (aTarget !== bTarget) return bTarget - aTarget;

    if (options.mode === 'park_loop') {
      const aPark = a.kind === 'park' ? 1 : 0;
      const bPark = b.kind === 'park' ? 1 : 0;
      if (aPark !== bPark) return bPark - aPark;
      return a.edge.lengthKm - b.edge.lengthKm || (b.edge.score ?? 0) - (a.edge.score ?? 0);
    }

    const aNatural = a.surface === 'natural' ? 1 : 0;
    const bNatural = b.surface === 'natural' ? 1 : 0;
    if (aNatural !== bNatural) return bNatural - aNatural;

    const aOvershoot = Math.max(0, distanceKm + a.edge.lengthKm - targetDistanceKm);
    const bOvershoot = Math.max(0, distanceKm + b.edge.lengthKm - targetDistanceKm);
    if (aOvershoot !== bOvershoot) return aOvershoot - bOvershoot;

    // low_trail_potential distance-completion: prefer unvisited path-like
    // edges, prefer natural/mixed/unset surface over paved. The visitedUndirected
    // set is only populated in low_trail_potential mode, so this branch
    // is a no-op for other modes (the Set is empty there).
    if (options.mode === 'low_trail_potential') {
      const aKey = undirectedKeyFor(a);
      const bKey = undirectedKeyFor(b);
      const aVisited = visitedUndirected.has(aKey) ? 1 : 0;
      const bVisited = visitedUndirected.has(bKey) ? 1 : 0;
      if (aVisited !== bVisited) return aVisited - bVisited; // prefer unvisited (0 wins)

      const aPathLike = PATH_LIKE_HIGHWAYS.has(a.edge.highway) ? 1 : 0;
      const bPathLike = PATH_LIKE_HIGHWAYS.has(b.edge.highway) ? 1 : 0;
      if (aPathLike !== bPathLike) return bPathLike - aPathLike; // prefer path-like

      // Surface preference: unset/mixed (probable natural) > natural > paved.
      const surfaceScore = (s: RouteSurfaceV3): number => {
        if (s === 'mixed' || s === undefined || s === null) return 2;
        if (s === 'natural') return 1;
        return 0; // paved
      };
      const aSurf = surfaceScore(a.surface);
      const bSurf = surfaceScore(b.surface);
      if (aSurf !== bSurf) return bSurf - aSurf;
    }

    return (b.edge.score ?? 0) - (a.edge.score ?? 0) || b.edge.lengthKm - a.edge.lengthKm;
  })[0]!;
}

// Stable undirected key for an edge: sorted from|to + osmWayId (or edge.id).
// Used by the low_trail_potential distance-completion phase to track which
// undirected edges have been walked.
function undirectedKeyFor(edge: TraversalEdgeV3): string {
  const [a, b] = [edge.from, edge.to].sort();
  const way = edge.edge.osmWayId ?? edge.edge.id;
  return `${a}|${b}|${way}`;
}

function hasUsefulClosingCandidate(candidates: TraversalEdgeV3[], startNodeId: string, distanceKm: number, targetDistanceKm: number): boolean {
  return candidates.some((candidate) => candidate.to === startNodeId && distanceKm + candidate.edge.lengthKm <= targetDistanceKm * 1.2);
}

function hasClosingCandidate(candidates: TraversalEdgeV3[], startNodeId: string, used: Set<string>): boolean {
  return candidates.some((candidate) => candidate.to === startNodeId && !used.has(candidate.edge.id));
}

function buildAdjacency(graph: EnrichedGraph): Map<string, TraversalEdgeV3[]> {
  const adjacency = new Map<string, TraversalEdgeV3[]>();
  for (const edge of Array.from(graph.edges.values())) {
    const surface = classifySurface(edge);
    const kind = classifyComponentKind(edge, surface);
    pushAdjacency(adjacency, edge.from, { edge, from: edge.from, to: edge.to, kind, surface });
    pushAdjacency(adjacency, edge.to, { edge, from: edge.to, to: edge.from, kind, surface });
  }
  return adjacency;
}

function pushAdjacency(adjacency: Map<string, TraversalEdgeV3[]>, nodeId: string, edge: TraversalEdgeV3): void {
  const edges = adjacency.get(nodeId) ?? [];
  edges.push(edge);
  adjacency.set(nodeId, edges);
}

function nodesFromTraversal(startNodeId: string, traversal: TraversalEdgeV3[]): string[] {
  return traversal.reduce<string[]>((nodeIds, edge) => [...nodeIds, edge.to], [startNodeId]);
}

function toRouteEdge(edge: TraversalEdgeV3): RouteEdgeV3 {
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
    metrics: createEmptyRouteMetricsV3(intent.constraints.targetDistanceKm),
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

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
