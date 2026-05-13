import type { EnrichedGraph, SolverPath } from "../types";
import type { RouteIntent } from "./terrain-planner";
import { haversineKm } from "../route-generator-legacy";
import { findShortestPath, ReturnDistanceCache } from "./pathfinder";

// ── Types ────────────────────────────────────────────────────────────────────

interface BeamState {
  nodeIds: string[];
  edgeIds: string[];
  edgeVisits: Map<string, number>;
  currentNodeId: string;
  lastFrom: string | null;
  distanceKm: number;
  totalScore: number;
  cumulativeAscentM: number;
  cumulativeDescentM: number;
  naturalDistanceKm: number;
  naturalStreakKm: number;
  longestNaturalStreakKm: number;
  naturalSegmentCount: number;
  wasOnNaturalCorridor: boolean;
  pavedDistanceKm: number;
  targetComponentNaturalDistanceKm: number;
  enteredTargetComponent: boolean;
}

interface SolverConfig {
  beamWidth: number;
  temperature: number;
  seedBearing: number;
  expansionFactor: number;
}

interface NaturalAnchor {
  center: { lat: number; lng: number };
  totalNaturalKm: number;
  nodeIds: Set<string>;
  entryNodeIds?: Set<string>;
  componentId?: string;
  isTarget?: boolean;
}

export interface SolverEmptyDiagnostics {
  configsTried?: number;
  iterations?: number;
  statesVisited?: number;
  edgesConsidered?: number;
  statesExpanded?: number;
  noExpandableEdges?: number;
  prunedDistanceBudget?: number;
  prunedReturnBudget?: number;
  returnPathMissing?: number;
  returnRepeatCap?: number;
  returnPavedCap?: number;
  deadlineReached?: boolean;
  targetEntryNodeCount?: number;
  targetEntryStatesReached?: number;
  targetEntryAccessPathsTried?: number;
  targetEntryAccessSeeds?: number;
  validPaths?: number;
}

export interface SolverRuntimeBudget {
  deadlineMs?: number;
  emptyDiagnostics?: SolverEmptyDiagnostics;
}

function incrementDiagnostic(
  diagnostics: SolverEmptyDiagnostics | undefined,
  key: keyof Omit<SolverEmptyDiagnostics, "deadlineReached">
): void {
  if (!diagnostics) return;
  const current = diagnostics[key];
  diagnostics[key] = (typeof current === "number" ? current : 0) + 1;
}

// ── Constants ────────────────────────────────────────────────────────────────

const SOLVER_CONFIGS: SolverConfig[] = [
  { beamWidth: 24, temperature: 0.2,  seedBearing: 0,   expansionFactor: 2 },
  { beamWidth: 24, temperature: 0.25, seedBearing: 120, expansionFactor: 2 },
  { beamWidth: 28, temperature: 0.2,  seedBearing: 240, expansionFactor: 2 },
];

const MAX_ITERATIONS = 900;
const DISTANCE_TOLERANCE = 0.15;
const CLOSE_ENOUGH_KM = 0.2;
const MAX_EDGE_REVISITS = 1;
const REVISIT_PENALTY = 0.15;
const ROAD_DISTANCE_FACTOR = 1.4;
const NATURAL_CORRIDOR_BASE_BONUS_PER_KM = 0.12;
const NATURAL_CORRIDOR_STREAK_BONUS_PER_KM = 0.08;
const NATURAL_CORRIDOR_STREAK_BONUS_CAP = 0.28;
const SHORT_NATURE_FRAGMENT_PENALTY_PER_KM = 0.08;
const MIN_CORRIDOR_STREAK_KM = 1.5;
const MIN_NATURAL_ANCHOR_KM = 1.8;
const NATURAL_ANCHOR_PULL_PROGRESS_LIMIT = 0.45;
const NATURAL_ANCHOR_PULL_BONUS = 0.45;
const NATURAL_ANCHOR_ENTRY_BONUS = 0.75;
const NATURAL_MASSIF_VISIT_BONUS_PER_KM = 0.18;
const LOW_NATURE_ROUTE_PENALTY_PER_KM = 2.0;

const NATURAL_HIGHWAY_TYPES = new Set(["path", "track", "footway", "bridleway"]);
const NATURAL_SURFACES = new Set(["dirt", "earth", "grass", "ground", "unpaved", "compacted", "fine_gravel", "gravel", "sand"]);
const PAVED_SURFACES = new Set(["asphalt", "concrete", "paving_stones", "sett", "cobblestone", "paved"]);

// ── Utility functions ────────────────────────────────────────────────────────

function undirectedEdgeKey(from: string, to: string, wayId: number): string {
  return from < to
    ? `${from}-${to}-${wayId}`
    : `${to}-${from}-${wayId}`;
}

function isNaturalCorridorEdge(edge: { highway: string; surface?: string; scenic?: boolean }): boolean {
  if (edge.surface != null && PAVED_SURFACES.has(edge.surface)) return false;
  return (
    edge.scenic === true ||
    NATURAL_HIGHWAY_TYPES.has(edge.highway) ||
    (edge.surface != null && NATURAL_SURFACES.has(edge.surface))
  );
}

function buildTargetComponentAnchors(routeIntent?: RouteIntent): NaturalAnchor[] {
  if (!routeIntent || routeIntent.targetComponents.length === 0) return [];

  const targetComponentIds = new Set(routeIntent.targetComponents);
  return routeIntent.terrainComponents
    .filter((component) => targetComponentIds.has(component.id))
    .filter((component) => component.nodeIds.length > 0)
    .map((component) => ({
      center: component.center,
      totalNaturalKm: Math.max(component.nonPavedKm, component.totalKm, 0.1),
      nodeIds: new Set(component.nodeIds),
      entryNodeIds: new Set(component.entryNodeIds),
      componentId: component.id,
      isTarget: true,
    }));
}

function mergeTargetAnchorsFirst(targetAnchors: NaturalAnchor[], discoveredAnchors: NaturalAnchor[]): NaturalAnchor[] {
  if (targetAnchors.length === 0) return discoveredAnchors;

  const overlapsTarget = (anchor: NaturalAnchor): boolean => {
    for (const target of targetAnchors) {
      let overlap = 0;
      for (const nodeId of Array.from(anchor.nodeIds)) {
        if (target.nodeIds.has(nodeId)) overlap += 1;
      }
      if (overlap / Math.max(1, Math.min(anchor.nodeIds.size, target.nodeIds.size)) >= 0.5) return true;
    }
    return false;
  };

  return [
    ...targetAnchors,
    ...discoveredAnchors.filter((anchor) => !overlapsTarget(anchor)),
  ].slice(0, 6);
}

function buildTargetNodeSet(routeIntent?: RouteIntent): Set<string> {
  if (!routeIntent || routeIntent.targetComponents.length === 0) return new Set();
  const targetComponentIds = new Set(routeIntent.targetComponents);
  const nodeIds = new Set<string>();
  for (const component of routeIntent.terrainComponents) {
    if (!targetComponentIds.has(component.id)) continue;
    for (const nodeId of component.nodeIds) nodeIds.add(nodeId);
  }
  return nodeIds;
}

function isTargetNaturalEdge(
  edge: { from: string; to: string; highway: string; surface?: string; scenic?: boolean },
  targetNodeIds: Set<string>
): boolean {
  return targetNodeIds.has(edge.from) && targetNodeIds.has(edge.to) && isNaturalCorridorEdge(edge);
}

function buildNaturalAnchors(graph: EnrichedGraph, targetDistanceKm: number): NaturalAnchor[] {
  const parent = new Map<string, string>();

  const find = (id: string): string => {
    if (!parent.has(id)) parent.set(id, id);
    const currentParent = parent.get(id)!;
    if (currentParent === id) return id;
    const root = find(currentParent);
    parent.set(id, root);
    return root;
  };

  const union = (a: string, b: string): void => {
    const rootA = find(a);
    const rootB = find(b);
    if (rootA !== rootB) parent.set(rootB, rootA);
  };

  const naturalEdges = Array.from(graph.edges.values()).filter(isNaturalCorridorEdge);
  for (const edge of naturalEdges) {
    union(edge.from, edge.to);
  }

  const components = new Map<string, {
    totalNaturalKm: number;
    weightedLat: number;
    weightedLng: number;
    nodeIds: Set<string>;
  }>();

  for (const edge of naturalEdges) {
    const from = graph.nodes.get(edge.from);
    const to = graph.nodes.get(edge.to);
    if (!from || !to) continue;

    const root = find(edge.from);
    const midpointLat = (from.lat + to.lat) / 2;
    const midpointLng = (from.lng + to.lng) / 2;
    const component = components.get(root) ?? {
      totalNaturalKm: 0,
      weightedLat: 0,
      weightedLng: 0,
      nodeIds: new Set<string>(),
    };

    component.totalNaturalKm += edge.lengthKm;
    component.weightedLat += midpointLat * edge.lengthKm;
    component.weightedLng += midpointLng * edge.lengthKm;
    component.nodeIds.add(edge.from);
    component.nodeIds.add(edge.to);
    components.set(root, component);
  }

  const minAnchorKm = Math.max(MIN_NATURAL_ANCHOR_KM, Math.min(2.4, targetDistanceKm * 0.18));

  return Array.from(components.values())
    .filter((component) => component.totalNaturalKm >= minAnchorKm)
    .map((component) => ({
      totalNaturalKm: component.totalNaturalKm,
      nodeIds: component.nodeIds,
      center: {
        lat: component.weightedLat / component.totalNaturalKm,
        lng: component.weightedLng / component.totalNaturalKm,
      },
    }))
    .sort((a, b) => b.totalNaturalKm - a.totalNaturalKm)
    .slice(0, 4);
}

function scoreNaturalAnchorPull(
  currentCoord: { lat: number; lng: number },
  toCoord: { lat: number; lng: number },
  state: BeamState,
  targetDistanceKm: number,
  anchors: NaturalAnchor[]
): number {
  const progress = state.distanceKm / targetDistanceKm;
  if (progress > NATURAL_ANCHOR_PULL_PROGRESS_LIMIT || anchors.length === 0) return 0;
  if (state.longestNaturalStreakKm >= MIN_CORRIDOR_STREAK_KM) return 0;

  let bestPull = 0;
  for (const anchor of anchors) {
    const currentDistance = haversineKm(currentCoord, anchor.center);
    const nextDistance = haversineKm(toCoord, anchor.center);
    if (nextDistance >= currentDistance) continue;

    const approachRatio = (currentDistance - nextDistance) / Math.max(currentDistance, 0.1);
    const anchorScale = Math.min(1, anchor.totalNaturalKm / Math.max(MIN_NATURAL_ANCHOR_KM, targetDistanceKm * 0.45));
    const targetMultiplier = anchor.isTarget ? 1.8 : 1;
    const pull = approachRatio * anchorScale * NATURAL_ANCHOR_PULL_BONUS * targetMultiplier;
    bestPull = Math.max(bestPull, pull);
  }

  return bestPull;
}

function scoreNaturalAnchorEntry(
  currentNodeId: string,
  toNodeId: string,
  state: BeamState,
  targetDistanceKm: number,
  anchors: NaturalAnchor[]
): number {
  const progress = state.distanceKm / targetDistanceKm;
  if (progress > NATURAL_ANCHOR_PULL_PROGRESS_LIMIT || anchors.length === 0) return 0;
  if (state.longestNaturalStreakKm >= MIN_CORRIDOR_STREAK_KM) return 0;

  for (const anchor of anchors) {
    const isEnteringByNodeSet = !anchor.nodeIds.has(currentNodeId) && anchor.nodeIds.has(toNodeId);
    const isEnteringByGate = anchor.entryNodeIds?.has(toNodeId) === true && !anchor.nodeIds.has(currentNodeId);
    if (isEnteringByNodeSet || isEnteringByGate) {
      const anchorScale = Math.min(1, anchor.totalNaturalKm / Math.max(MIN_NATURAL_ANCHOR_KM, targetDistanceKm * 0.25));
      const targetMultiplier = anchor.isTarget ? 1.7 : 1;
      return NATURAL_ANCHOR_ENTRY_BONUS * anchorScale * targetMultiplier;
    }
  }

  return 0;
}

function scoreLowNatureRoutePenalty(totalDistanceKm: number, naturalDistanceKm: number): number {
  if (totalDistanceKm <= 0) return 0;

  const naturalRatio = naturalDistanceKm / totalDistanceKm;
  const minimumExpectedNaturalRatio = totalDistanceKm >= 8 ? 0.2 : 0.12;

  return Math.max(0, minimumExpectedNaturalRatio - naturalRatio) * totalDistanceKm * LOW_NATURE_ROUTE_PENALTY_PER_KM;
}

function scoreNaturalCorridorStep(edge: { lengthKm: number; highway: string; surface?: string; scenic?: boolean }, state: BeamState): number {
  if (!isNaturalCorridorEdge(edge)) {
    if (state.wasOnNaturalCorridor && state.naturalStreakKm < MIN_CORRIDOR_STREAK_KM) {
      return -SHORT_NATURE_FRAGMENT_PENALTY_PER_KM * edge.lengthKm;
    }
    return 0;
  }

  const streakAfterEdge = state.wasOnNaturalCorridor
    ? state.naturalStreakKm + edge.lengthKm
    : edge.lengthKm;
  const streakBonus = Math.min(
    NATURAL_CORRIDOR_STREAK_BONUS_CAP,
    streakAfterEdge * NATURAL_CORRIDOR_STREAK_BONUS_PER_KM
  );

  return edge.lengthKm * (NATURAL_CORRIDOR_BASE_BONUS_PER_KM + streakBonus);
}

function advanceNaturalCorridorState(state: BeamState, edge: { lengthKm: number; highway: string; surface?: string; scenic?: boolean }) {
  const isNatural = isNaturalCorridorEdge(edge);
  const naturalStreakKm = isNatural
    ? (state.wasOnNaturalCorridor ? state.naturalStreakKm : 0) + edge.lengthKm
    : 0;

  return {
    naturalDistanceKm: state.naturalDistanceKm + (isNatural ? edge.lengthKm : 0),
    naturalStreakKm,
    longestNaturalStreakKm: Math.max(state.longestNaturalStreakKm, naturalStreakKm),
    naturalSegmentCount: state.naturalSegmentCount + (isNatural && !state.wasOnNaturalCorridor ? 1 : 0),
    wasOnNaturalCorridor: isNatural,
  };
}


function scoreIntentEdge(
  edge: { from: string; to: string; lengthKm: number; highway: string; surface?: string; scenic?: boolean },
  state: BeamState,
  targetDistanceKm: number,
  targetNodeIds: Set<string>,
  intent?: RouteIntent
): number {
  if (!intent) return 0;
  const progress = state.distanceKm / Math.max(targetDistanceKm, 0.1);
  const paved = edge.surface != null && PAVED_SURFACES.has(edge.surface);
  const nonPavedNatural = isNaturalCorridorEdge(edge);
  let score = 0;

  if (intent.type === "forest_loop" || intent.type === "transition_to_woods") {
    if (nonPavedNatural) score += 0.12;
    if (paved && edge.scenic === true) score -= 0.22;
    if (state.longestNaturalStreakKm < (intent.minNonPavedTrailStreakKm ?? MIN_CORRIDOR_STREAK_KM) && nonPavedNatural) {
      score += Math.min(0.22, edge.lengthKm * 0.16);
    }
    if (isTargetNaturalEdge(edge, targetNodeIds)) {
      const dwellTargetKm = Math.max(1, intent.minNaturalZoneDwellKm ?? MIN_CORRIDOR_STREAK_KM);
      const dwellProgress = Math.min(1, state.targetComponentNaturalDistanceKm / dwellTargetKm);
      score += Math.min(0.26, edge.lengthKm * 0.2) * (1.2 - dwellProgress * 0.4);
    } else if (state.enteredTargetComponent && state.targetComponentNaturalDistanceKm < (intent.minNonPavedTrailStreakKm ?? MIN_CORRIDOR_STREAK_KM)) {
      score -= 0.32;
    }
  } else if (intent.type === "park_loop") {
    if (progress > 0.55) score += 0.04;
    if (nonPavedNatural) score += 0.14;
    if (isTargetNaturalEdge(edge, targetNodeIds)) score += Math.min(0.42, edge.lengthKm * 0.55);
    if (!state.enteredTargetComponent && progress < 0.75 && paved) score -= 0.12;
    if (paved && edge.scenic === true) score -= 0.1;
  } else if (intent.type === "urban_nature_loop") {
    if (edge.scenic === true) score += paved ? -0.04 : 0.1;
    if (isTargetNaturalEdge(edge, targetNodeIds)) score += Math.min(0.34, edge.lengthKm * 0.45);
    if (!state.enteredTargetComponent && progress < 0.65 && paved) score -= 0.08;
    if (nonPavedNatural) score += state.longestNaturalStreakKm < (intent.minNonPavedTrailStreakKm ?? 0.8) ? 0.16 : 0.08;
  }

  const projectedPavedRatio = (state.pavedDistanceKm + (paved ? edge.lengthKm : 0)) / Math.max(state.distanceKm + edge.lengthKm, 0.1);
  if (intent.maxPavedRatio != null && projectedPavedRatio > intent.maxPavedRatio) {
    const overflow = projectedPavedRatio - intent.maxPavedRatio;
    const isWoodsIntent = intent.type === "forest_loop" || intent.type === "transition_to_woods";
    const pavedOverflowPenalty = paved ? (isWoodsIntent ? 0.34 : 0.18) : (isWoodsIntent ? 0.1 : 0.06);
    const earlyPavedPenalty = paved && progress < 0.75 ? (isWoodsIntent ? 0.2 : 0.12) : 0;
    score -= pavedOverflowPenalty + earlyPavedPenalty + Math.min(isWoodsIntent ? 0.85 : 0.55, overflow * (paved ? (isWoodsIntent ? 2.4 : 1.4) : (isWoodsIntent ? 1.2 : 0.8)));
  }

  return score;
}

function scorePathWithCorridorPreference(graph: EnrichedGraph, edgeIds: string[], targetNodeIds: Set<string> = new Set()): number {
  let rawScore = 0;
  let totalDistanceKm = 0;
  let naturalDistanceKm = 0;
  let currentNaturalStreakKm = 0;
  let longestNaturalStreakKm = 0;
  let naturalSegmentCount = 0;
  let targetNaturalDistanceKm = 0;
  let wasNatural = false;

  for (const edgeId of edgeIds) {
    const edge = graph.edges.get(edgeId);
    if (!edge) continue;
    rawScore += edge.score * edge.lengthKm;
    totalDistanceKm += edge.lengthKm;

    const isNatural = isNaturalCorridorEdge(edge);
    if (isNatural) {
      naturalDistanceKm += edge.lengthKm;
      if (targetNodeIds.has(edge.from) && targetNodeIds.has(edge.to)) {
        targetNaturalDistanceKm += edge.lengthKm;
      }
      currentNaturalStreakKm = wasNatural ? currentNaturalStreakKm + edge.lengthKm : edge.lengthKm;
      longestNaturalStreakKm = Math.max(longestNaturalStreakKm, currentNaturalStreakKm);
      if (!wasNatural) naturalSegmentCount++;
    } else {
      currentNaturalStreakKm = 0;
    }
    wasNatural = isNatural;
  }

  if (totalDistanceKm <= 0) return rawScore;

  const naturalRatio = naturalDistanceKm / totalDistanceKm;
  const longestCorridorRatio = longestNaturalStreakKm / totalDistanceKm;
  const fragmentationPenalty = Math.max(0, naturalSegmentCount - 1) * 0.08 * totalDistanceKm;
  const lowNaturePenalty = scoreLowNatureRoutePenalty(totalDistanceKm, naturalDistanceKm);
  const corridorBonus = totalDistanceKm * (naturalRatio * 0.15 + longestCorridorRatio * 0.25);
  const massifVisitBonus = longestNaturalStreakKm * NATURAL_MASSIF_VISIT_BONUS_PER_KM;
  const targetComponentBonus = targetNaturalDistanceKm * 0.7;

  return rawScore + corridorBonus + massifVisitBonus + targetComponentBonus - fragmentationPenalty - lowNaturePenalty;
}

function buildSolverPath(
  graph: EnrichedGraph,
  nodeIds: string[],
  edgeIds: string[],
  distanceKm: number,
  relaxationsUsed: string[] = [],
  targetNodeIds: Set<string> = new Set()
): SolverPath {
  return {
    nodeIds,
    edgeIds,
    totalScore: scorePathWithCorridorPreference(graph, edgeIds, targetNodeIds),
    distanceKm,
    relaxationsUsed,
  };
}

function pavedDistanceForEdges(graph: EnrichedGraph, edgeIds: string[]): number {
  return edgeIds.reduce((sum, edgeId) => {
    const edge = graph.edges.get(edgeId);
    return sum + (edge?.surface != null && PAVED_SURFACES.has(edge.surface) ? edge.lengthKm : 0);
  }, 0);
}

function edgeVisitsForPath(graph: EnrichedGraph, edgeIds: string[]): Map<string, number> {
  const visits = new Map<string, number>();
  for (const edgeId of edgeIds) {
    const edge = graph.edges.get(edgeId);
    if (!edge) continue;
    const key = undirectedEdgeKey(edge.from, edge.to, edge.osmWayId);
    visits.set(key, (visits.get(key) ?? 0) + 1);
  }
  return visits;
}

function buildAccessSeedState(
  graph: EnrichedGraph,
  accessPath: NonNullable<ReturnType<typeof findShortestPath>>,
  targetNodeIds: Set<string>
): BeamState | null {
  const currentNodeId = accessPath.nodeIds.at(-1);
  if (!currentNodeId) return null;

  let naturalDistanceKm = 0;
  let naturalStreakKm = 0;
  let longestNaturalStreakKm = 0;
  let naturalSegmentCount = 0;
  let wasOnNaturalCorridor = false;
  let targetComponentNaturalDistanceKm = 0;
  const cumulativeAscentM = 0;
  const cumulativeDescentM = 0;

  for (const edgeId of accessPath.edgeIds) {
    const edge = graph.edges.get(edgeId);
    if (!edge) continue;
    const corridorState = advanceNaturalCorridorState({
      nodeIds: [],
      edgeIds: [],
      edgeVisits: new Map(),
      currentNodeId: edge.from,
      lastFrom: null,
      distanceKm: 0,
      totalScore: 0,
      cumulativeAscentM,
      cumulativeDescentM,
      naturalDistanceKm,
      naturalStreakKm,
      longestNaturalStreakKm,
      naturalSegmentCount,
      wasOnNaturalCorridor,
      pavedDistanceKm: 0,
      targetComponentNaturalDistanceKm,
      enteredTargetComponent: targetComponentNaturalDistanceKm > 0,
    }, edge);
    naturalDistanceKm = corridorState.naturalDistanceKm;
    naturalStreakKm = corridorState.naturalStreakKm;
    longestNaturalStreakKm = corridorState.longestNaturalStreakKm;
    naturalSegmentCount = corridorState.naturalSegmentCount;
    wasOnNaturalCorridor = corridorState.wasOnNaturalCorridor;
    if (isTargetNaturalEdge(edge, targetNodeIds)) {
      targetComponentNaturalDistanceKm += edge.lengthKm;
    }
  }

  return {
    nodeIds: accessPath.nodeIds,
    edgeIds: accessPath.edgeIds,
    edgeVisits: edgeVisitsForPath(graph, accessPath.edgeIds),
    currentNodeId,
    lastFrom: accessPath.nodeIds.length >= 2 ? accessPath.nodeIds[accessPath.nodeIds.length - 2] : null,
    distanceKm: accessPath.distanceKm,
    totalScore: scorePathWithCorridorPreference(graph, accessPath.edgeIds, targetNodeIds),
    cumulativeAscentM,
    cumulativeDescentM,
    naturalDistanceKm,
    naturalStreakKm,
    longestNaturalStreakKm,
    naturalSegmentCount,
    wasOnNaturalCorridor,
    pavedDistanceKm: pavedDistanceForEdges(graph, accessPath.edgeIds),
    targetComponentNaturalDistanceKm,
    enteredTargetComponent: targetComponentNaturalDistanceKm > 0 || targetNodeIds.has(currentNodeId),
  };
}

function buildTargetEntryAccessSeedStates(args: {
  graph: EnrichedGraph;
  startNodeId: string;
  targetAnchors: NaturalAnchor[];
  targetNodeIds: Set<string>;
  routeIntent?: RouteIntent;
  targetDistanceKm: number;
  maxDist: number;
  beamWidth: number;
  diagnostics?: SolverEmptyDiagnostics;
}): BeamState[] {
  if (args.routeIntent?.type !== "transition_to_woods" || args.targetAnchors.length === 0) return [];

  const startNode = args.graph.nodes.get(args.startNodeId);
  const entryNodeIds = Array.from(new Set(args.targetAnchors.flatMap((anchor) => Array.from(anchor.entryNodeIds ?? []))))
    .filter((nodeId) => nodeId !== args.startNodeId && args.graph.nodes.has(nodeId))
    .sort((a, b) => {
      if (!startNode) return 0;
      const nodeA = args.graph.nodes.get(a)!;
      const nodeB = args.graph.nodes.get(b)!;
      return haversineKm(startNode, nodeA) - haversineKm(startNode, nodeB);
    })
    .slice(0, Math.max(12, Math.min(args.beamWidth * 2, 48)));
  const seedCandidates: Array<{ path: NonNullable<ReturnType<typeof findShortestPath>>; state: BeamState }> = [];
  const maxAccessDistanceKm = Math.min(args.maxDist * 0.55, Math.max(2.2, args.targetDistanceKm * 0.38));
  const maxAccessPavedRatio = args.routeIntent.maxPavedRatio != null ? args.routeIntent.maxPavedRatio + 0.02 : undefined;
  const maxSeeds = Math.max(1, Math.min(args.beamWidth, 24));

  for (const entryNodeId of entryNodeIds) {
    incrementDiagnostic(args.diagnostics, "targetEntryAccessPathsTried");
    const accessPath = findShortestPath(args.graph, args.startNodeId, entryNodeId);
    if (!accessPath || accessPath.edgeIds.length === 0) continue;
    if (accessPath.distanceKm > maxAccessDistanceKm) continue;
    const accessPavedDistanceKm = pavedDistanceForEdges(args.graph, accessPath.edgeIds);
    if (maxAccessPavedRatio != null && accessPavedDistanceKm / Math.max(args.maxDist, 0.1) > maxAccessPavedRatio) continue;
    const state = buildAccessSeedState(args.graph, accessPath, args.targetNodeIds);
    if (!state) continue;
    seedCandidates.push({ path: accessPath, state });
  }

  seedCandidates.sort((a, b) => {
    const aPaved = pavedDistanceForEdges(args.graph, a.path.edgeIds);
    const bPaved = pavedDistanceForEdges(args.graph, b.path.edgeIds);
    return (a.path.distanceKm + aPaved * 0.5) - (b.path.distanceKm + bPaved * 0.5);
  });

  const seeds = seedCandidates.slice(0, maxSeeds).map((candidate) => candidate.state);
  if (args.diagnostics && seeds.length > 0) {
    args.diagnostics.targetEntryAccessSeeds = Math.max(args.diagnostics.targetEntryAccessSeeds ?? 0, seeds.length);
  }
  return seeds;
}

function cleanReturnPath(
  graph: EnrichedGraph,
  fromNodeId: string,
  startNodeId: string,
  edgeVisits: Map<string, number>
) {
  const forbiddenUndirectedEdgeKeys = new Set(
    Array.from(edgeVisits.entries())
      .filter(([, visits]) => visits > 0)
      .map(([key]) => key)
  );

  return findShortestPath(graph, fromNodeId, startNodeId, { forbiddenUndirectedEdgeKeys });
}

function projectedReturnRepeatRatio(
  graph: EnrichedGraph,
  edgeVisits: Map<string, number>,
  returnPath: ReturnType<typeof findShortestPath>,
  currentDistanceKm: number
): number {
  if (!returnPath) return 0;
  let repeatedKm = 0;
  for (const edgeId of returnPath.edgeIds) {
    const edge = graph.edges.get(edgeId);
    if (!edge) continue;
    const key = undirectedEdgeKey(edge.from, edge.to, edge.osmWayId);
    if ((edgeVisits.get(key) ?? 0) > 0) repeatedKm += edge.lengthKm;
  }
  return repeatedKm / Math.max(currentDistanceKm + returnPath.distanceKm, 0.1);
}

function projectedReturnPavedRatio(
  graph: EnrichedGraph,
  returnPath: ReturnType<typeof findShortestPath>,
  currentDistanceKm: number,
  currentPavedDistanceKm: number
): number {
  if (!returnPath) return 0;
  let returnPavedKm = 0;
  for (const edgeId of returnPath.edgeIds) {
    const edge = graph.edges.get(edgeId);
    if (edge?.surface != null && PAVED_SURFACES.has(edge.surface)) returnPavedKm += edge.lengthKm;
  }
  return (currentPavedDistanceKm + returnPavedKm) / Math.max(currentDistanceKm + returnPath.distanceKm, 0.1);
}

function diagnoseReturnPathRejection(
  graph: EnrichedGraph,
  edgeVisits: Map<string, number>,
  returnPath: ReturnType<typeof findShortestPath>,
  currentDistanceKm: number,
  currentPavedDistanceKm: number,
  remainingBudgetKm: number,
  maxRepeatRatio?: number,
  maxPavedRatio?: number
): "missing" | "budget" | "repeat" | "paved" | null {
  if (!returnPath) return "missing";
  if (returnPath.distanceKm > remainingBudgetKm) return "budget";
  if (maxRepeatRatio != null && projectedReturnRepeatRatio(graph, edgeVisits, returnPath, currentDistanceKm) > maxRepeatRatio) return "repeat";
  if (maxPavedRatio != null && projectedReturnPavedRatio(graph, returnPath, currentDistanceKm, currentPavedDistanceKm) > maxPavedRatio) return "paved";
  return null;
}

function recordReturnRejection(
  diagnostics: SolverEmptyDiagnostics | undefined,
  reason: "missing" | "budget" | "repeat" | "paved" | null
): void {
  if (!diagnostics || reason == null) return;
  if (reason === "missing") incrementDiagnostic(diagnostics, "returnPathMissing");
  if (reason === "budget") incrementDiagnostic(diagnostics, "prunedReturnBudget");
  if (reason === "repeat") incrementDiagnostic(diagnostics, "returnRepeatCap");
  if (reason === "paved") incrementDiagnostic(diagnostics, "returnPavedCap");
}

function resolveReturnPath(
  graph: EnrichedGraph,
  fromNodeId: string,
  startNodeId: string,
  edgeVisits: Map<string, number>,
  returnCache: ReturnDistanceCache,
  mode: RouteIntent["cleanReturnMode"],
  remainingBudgetKm: number,
  currentDistanceKm: number,
  currentPavedDistanceKm: number,
  maxRepeatRatio?: number,
  maxPavedRatio?: number,
  diagnostics?: SolverEmptyDiagnostics
): { path: ReturnType<typeof findShortestPath> | null; relaxationsUsed: string[] } {
  const cleanPath = cleanReturnPath(graph, fromNodeId, startNodeId, edgeVisits);
  const cleanRejection = diagnoseReturnPathRejection(graph, edgeVisits, cleanPath, currentDistanceKm, currentPavedDistanceKm, remainingBudgetKm, maxRepeatRatio, maxPavedRatio);
  if (cleanRejection == null) {
    return { path: cleanPath, relaxationsUsed: [] };
  }

  if (mode === "strict") {
    recordReturnRejection(diagnostics, cleanRejection);
    return { path: null, relaxationsUsed: [] };
  }

  const fallbackPath = returnCache.getPath(graph, fromNodeId, startNodeId);
  const fallbackRejection = diagnoseReturnPathRejection(graph, edgeVisits, fallbackPath, currentDistanceKm, currentPavedDistanceKm, remainingBudgetKm, maxRepeatRatio, maxPavedRatio);
  if (fallbackRejection == null) {
    return { path: fallbackPath, relaxationsUsed: ["clean_return"] };
  }

  recordReturnRejection(diagnostics, fallbackRejection);
  return { path: null, relaxationsUsed: [] };
}

function computeBearing(fromLat: number, fromLng: number, toLat: number, toLng: number): number {
  const dLng = toLng - fromLng;
  const dLat = toLat - fromLat;
  return Math.atan2(dLng, dLat) * (180 / Math.PI);
}

function normalizeAngle(angle: number): number {
  let a = angle % 360;
  if (a < 0) a += 360;
  return a > 180 ? a - 360 : a;
}

/**
 * Smooth cosine penalty based on angle between candidate edge and reverse of incoming bearing.
 * 0° from reverse (U-turn) → 0.0, 90° → 0.5, 180° (straight ahead) → 1.0
 */
function backtrackPenalty(incomingBearing: number, candidateBearing: number): number {
  const reverseBearing = (incomingBearing + 180) % 360;
  const angleDiff = Math.abs(candidateBearing - reverseBearing);
  const normalized = Math.min(angleDiff, 360 - angleDiff); // 0 = perfect U-turn, 180 = straight ahead
  return 0.5 * (1 - Math.cos((normalized / 180) * Math.PI));
}

function selectTopScoringEdges(
  scores: number[],
  k: number
): number[] {
  return scores
    .map((score, index) => ({ score, index }))
    .sort((a, b) => b.score - a.score)
    .slice(0, k)
    .map((entry) => entry.index);
}

// ── Diverse beam selection (farthest-point sampling) ─────────────────────────

function getLastCoord(state: BeamState, graph: EnrichedGraph): { lat: number; lng: number } {
  const node = graph.nodes.get(state.currentNodeId);
  return node ? { lat: node.lat, lng: node.lng } : { lat: 0, lng: 0 };
}

function diverseBeamSelect(
  candidates: BeamState[],
  beamWidth: number,
  targetDistanceKm: number,
  targetElevationM: number,
  graph: EnrichedGraph
): BeamState[] {
  if (candidates.length <= beamWidth) return candidates;

  // Sort by adjusted score-per-km with elevation factor
  candidates.sort((a, b) => {
    const scoreA = a.distanceKm > 0 ? a.totalScore / a.distanceKm : 0;
    const scoreB = b.distanceKm > 0 ? b.totalScore / b.distanceKm : 0;

    if (targetElevationM > 0) {
      const progressA = a.distanceKm / targetDistanceKm;
      const expectedAscentA = targetElevationM * progressA;
      const elevFactorA = 1.0 - 0.3 * Math.max(0, Math.abs(a.cumulativeAscentM - expectedAscentA) / Math.max(targetElevationM, 1));

      const progressB = b.distanceKm / targetDistanceKm;
      const expectedAscentB = targetElevationM * progressB;
      const elevFactorB = 1.0 - 0.3 * Math.max(0, Math.abs(b.cumulativeAscentM - expectedAscentB) / Math.max(targetElevationM, 1));

      return (scoreB * elevFactorB) - (scoreA * elevFactorA);
    }

    return scoreB - scoreA;
  });

  // Farthest-point sampling for spatial diversity
  const selected: BeamState[] = [candidates[0]];
  const selectedCoords = [getLastCoord(candidates[0], graph)];
  const remaining = candidates.slice(1);

  while (selected.length < beamWidth && remaining.length > 0) {
    let bestIdx = 0;
    let bestMinDist = -1;

    for (let i = 0; i < remaining.length; i++) {
      const coord = getLastCoord(remaining[i], graph);
      let minDist = Infinity;
      for (const sc of selectedCoords) {
        const d = haversineKm(coord, sc);
        if (d < minDist) minDist = d;
      }
      if (minDist > bestMinDist) {
        bestMinDist = minDist;
        bestIdx = i;
      }
    }

    selected.push(remaining[bestIdx]);
    selectedCoords.push(getLastCoord(remaining[bestIdx], graph));
    remaining.splice(bestIdx, 1);
  }

  return selected;
}

// ── Solver per config ────────────────────────────────────────────────────────

function solveWithConfig(
  graph: EnrichedGraph,
  startNodeId: string,
  targetDistanceKm: number,
  targetElevationM: number,
  nodeElevation: Map<string, number>,
  config: SolverConfig,
  routeIntent?: RouteIntent,
  deadlineMs?: number,
  diagnostics?: SolverEmptyDiagnostics
): SolverPath[] {
  const beamWidth = routeIntent?.beamBudget.beamWidth ?? config.beamWidth;
  const maxIterations = routeIntent?.beamBudget.maxIterations ?? MAX_ITERATIONS;
  const { seedBearing } = config;
  const cleanReturnMode = routeIntent?.cleanReturnMode ?? "prefer";
  const returnPavedRatioCap = routeIntent?.type === "park_loop" || routeIntent?.type === "urban_nature_loop"
    ? routeIntent.maxPavedRatio != null ? routeIntent.maxPavedRatio + 0.02 : undefined
    : routeIntent?.type === "transition_to_woods" && routeIntent.maxPavedRatio != null
      ? routeIntent.maxPavedRatio + 0.02
      : routeIntent?.maxPavedRatio;
  const maxDist = targetDistanceKm * (1 + DISTANCE_TOLERANCE);
  const strictTrailMinDist = routeIntent?.type === "transition_to_woods" && routeIntent.distancePolicy.mode === "strict"
    ? targetDistanceKm * 0.9
    : null;
  const minDist = strictTrailMinDist ?? targetDistanceKm * (1 - DISTANCE_TOLERANCE);
  const startNode = graph.nodes.get(startNodeId);
  if (!startNode) return [];

  const startCoord = { lat: startNode.lat, lng: startNode.lng };
  const targetAnchors = buildTargetComponentAnchors(routeIntent);
  if (diagnostics) {
    diagnostics.targetEntryNodeCount = Math.max(
      diagnostics.targetEntryNodeCount ?? 0,
      targetAnchors.reduce((sum, anchor) => sum + (anchor.entryNodeIds?.size ?? 0), 0)
    );
  }
  const naturalAnchors = mergeTargetAnchorsFirst(targetAnchors, buildNaturalAnchors(graph, targetDistanceKm));
  const targetNodeIds = buildTargetNodeSet(routeIntent);
  const returnCache = new ReturnDistanceCache();

  let beam: BeamState[] = [
    {
      nodeIds: [startNodeId],
      edgeIds: [],
      edgeVisits: new Map(),
      currentNodeId: startNodeId,
      lastFrom: null,
      distanceKm: 0,
      totalScore: 0,
      cumulativeAscentM: 0,
      cumulativeDescentM: 0,
      naturalDistanceKm: 0,
      naturalStreakKm: 0,
      longestNaturalStreakKm: 0,
      naturalSegmentCount: 0,
      wasOnNaturalCorridor: false,
      pavedDistanceKm: 0,
      targetComponentNaturalDistanceKm: 0,
      enteredTargetComponent: false,
    },
  ];

  const accessSeedStates = buildTargetEntryAccessSeedStates({
    graph,
    startNodeId,
    targetAnchors,
    targetNodeIds,
    routeIntent,
    targetDistanceKm,
    maxDist,
    beamWidth,
    diagnostics,
  });
  if (accessSeedStates.length > 0) {
    beam = [...accessSeedStates, ...beam].slice(0, beamWidth);
  }

  const validPaths: SolverPath[] = [];

  for (let iter = 0; iter < maxIterations && beam.length > 0; iter++) {
    incrementDiagnostic(diagnostics, "iterations");
    if (deadlineMs != null && performance.now() >= deadlineMs) {
      if (diagnostics) diagnostics.deadlineReached = true;
      break;
    }
    const nextBeam: BeamState[] = [];

    for (const state of beam) {
      incrementDiagnostic(diagnostics, "statesVisited");
      if (diagnostics && targetAnchors.some((anchor) => anchor.entryNodeIds?.has(state.currentNodeId))) {
        incrementDiagnostic(diagnostics, "targetEntryStatesReached");
      }
      if (deadlineMs != null && performance.now() >= deadlineMs) {
        if (diagnostics) diagnostics.deadlineReached = true;
        break;
      }
      const currentNode = graph.nodes.get(state.currentNodeId);
      if (!currentNode) continue;

      const progress = state.distanceKm / targetDistanceKm;

      // Determine expansion factor: K=3 in first 60%, K=2 after
      const k = progress < 0.6
        ? config.expansionFactor
        : Math.max(2, config.expansionFactor - 1);

      // Find candidate edges (with visited-edge relaxation)
      const allEdges = currentNode.edges
        .map((eid) => graph.edges.get(eid)!)
        .filter((e) => e != null && e.score > 0);
      if (diagnostics) {
        diagnostics.edgesConsidered = (diagnostics.edgesConsidered ?? 0) + allEdges.length;
      }

      const unvisitedEdges = allEdges.filter((e) => {
        const key = undirectedEdgeKey(e.from, e.to, e.osmWayId);
        return (state.edgeVisits.get(key) ?? 0) === 0;
      });

      // Dead-end escape: allow revisits if no unvisited edges
      let candidateEdges = unvisitedEdges.length > 0
        ? unvisitedEdges
        : allEdges.filter((e) => {
            const key = undirectedEdgeKey(e.from, e.to, e.osmWayId);
            return (state.edgeVisits.get(key) ?? 0) < MAX_EDGE_REVISITS;
          });

      if (state.lastFrom !== null && candidateEdges.some((edge) => edge.to !== state.lastFrom)) {
        candidateEdges = candidateEdges.filter((edge) => edge.to !== state.lastFrom);
      }

      if (candidateEdges.length === 0) {
        incrementDiagnostic(diagnostics, "noExpandableEdges");
        continue;
      }

      // Compute adjusted scores
      const currentCoord = { lat: currentNode.lat, lng: currentNode.lng };
      const adjustedScores = candidateEdges.map((edge) => {
        let score = edge.score;
        const toNode = graph.nodes.get(edge.to);
        if (!toNode) return 0.01;

        const toCoord = { lat: toNode.lat, lng: toNode.lng };

        // 1.1 Anti-backtracking: hard-reject immediate U-turn
        if (state.lastFrom !== null && edge.to === state.lastFrom) {
          return 0.01;
        }

        // Graduated anti-backtracking: smooth cosine penalty
        if (state.lastFrom !== null) {
          const lastNode = graph.nodes.get(state.lastFrom);
          if (lastNode) {
            const inBearing = computeBearing(lastNode.lat, lastNode.lng, currentNode.lat, currentNode.lng);
            const edgeBearing = computeBearing(currentNode.lat, currentNode.lng, toNode.lat, toNode.lng);
            const inBearingNorm = ((inBearing % 360) + 360) % 360;
            const edgeBearingNorm = ((edgeBearing % 360) + 360) % 360;
            score *= backtrackPenalty(inBearingNorm, edgeBearingNorm);
          }
        }

        // 1.2 Distance budget guard — with road-distance factor
        const edgeDist = edge.lengthKm;
        const distAfterEdge = state.distanceKm + edgeDist;
        const straightLineReturn = haversineKm(toCoord, startCoord);
        const estimatedRoadReturn = straightLineReturn * ROAD_DISTANCE_FACTOR;
        const remainingBudget = maxDist - distAfterEdge;

        if (estimatedRoadReturn > remainingBudget) {
          return 0.01;
        }

        // 1.3 Revisit penalty
        const edgeKey = undirectedEdgeKey(edge.from, edge.to, edge.osmWayId);
        const visits = state.edgeVisits.get(edgeKey) ?? 0;
        if (visits > 0) {
          score *= REVISIT_PENALTY;
        }

        // 1.4 Corridor continuity: prefer edges that extend a real natural line,
        // not one-off green fragments that dump the runner back on roads.
        score += scoreNaturalCorridorStep(edge, state) / Math.max(edge.lengthKm, 0.1);

        // 1.5 Early massif pull: before the route has found a real corridor,
        // reward access roads that reduce distance to large natural components.
        score += scoreNaturalAnchorPull(currentCoord, toCoord, state, targetDistanceKm, naturalAnchors);
        score += scoreNaturalAnchorEntry(state.currentNodeId, edge.to, state, targetDistanceKm, naturalAnchors);
        score += scoreIntentEdge(edge, state, targetDistanceKm, targetNodeIds, routeIntent);

        // 4.1 Directional seeding: bias toward seed bearing in first 15%
        if (progress < 0.15) {
          const edgeBearing = computeBearing(currentNode.lat, currentNode.lng, toNode.lat, toNode.lng);
          const angleDiff = Math.abs(normalizeAngle(edgeBearing - seedBearing));
          const directionalBias = Math.max(0.1, Math.cos(angleDiff * Math.PI / 180));
          score *= directionalBias;
        }

        // Outward bias (0-50% progress): prefer edges moving away from start
        if (progress < 0.5) {
          const distFromStart = haversineKm(toCoord, startCoord);
          const currentDistFromStart = haversineKm(currentCoord, startCoord);
          if (distFromStart > currentDistFromStart) {
            score += 0.15;
          }
        }

        // Return-to-start bias (after 50% progress)
        if (progress > 0.5) {
          const remaining = targetDistanceKm - state.distanceKm;
          const closingFactor = Math.max(0.1, 1 - straightLineReturn / Math.max(remaining, 0.1));
          score *= 0.5 + 0.5 * closingFactor;
        }

        // 2.3 Gradient-aware edge selection bias (after 60%)
        if (progress > 0.6 && targetElevationM > 0) {
          const fromElev = nodeElevation.get(edge.from) ?? 0;
          const toElev = nodeElevation.get(edge.to) ?? 0;
          const elevDelta = toElev - fromElev;
          const expectedAscent = targetElevationM * progress;
          const isUphill = elevDelta > 0;

          if (isUphill) {
            if (state.cumulativeAscentM < expectedAscent) {
              score *= 1.3; // Under budget → prefer uphill
            } else if (state.cumulativeAscentM > expectedAscent * 1.2) {
              score *= 0.5; // Over budget → penalize uphill
            }
          }
        }

        return Math.max(score, 0.01);
      });

      // Multi-child expansion: select top-K edges
      const selectedIndices = selectTopScoringEdges(adjustedScores, k);
      if (selectedIndices.length === 0) continue;

      for (const selectedIdx of selectedIndices) {
        const selectedEdge = candidateEdges[selectedIdx];
        const newDist = state.distanceKm + selectedEdge.lengthKm;

        // Compute elevation changes
        const fromElev = nodeElevation.get(selectedEdge.from) ?? 0;
        const toElev = nodeElevation.get(selectedEdge.to) ?? 0;
        const elevDelta = toElev - fromElev;
        const newAscent = state.cumulativeAscentM + (elevDelta > 0 ? elevDelta : 0);
        const newDescent = state.cumulativeDescentM + (elevDelta < 0 ? -elevDelta : 0);

        // Prune if exceeding max distance
        if (newDist > maxDist) {
          incrementDiagnostic(diagnostics, "prunedDistanceBudget");
          const distToStart = haversineKm(
            { lat: currentNode.lat, lng: currentNode.lng },
            startCoord
          );
          if (distToStart < CLOSE_ENOUGH_KM && state.distanceKm >= minDist) {
            validPaths.push(buildSolverPath(graph, state.nodeIds, state.edgeIds, state.distanceKm, [], targetNodeIds));
          }
          continue;
        }

        const edgeKey = undirectedEdgeKey(selectedEdge.from, selectedEdge.to, selectedEdge.osmWayId);
        const newEdgeVisits = new Map(state.edgeVisits);
        newEdgeVisits.set(edgeKey, (newEdgeVisits.get(edgeKey) ?? 0) + 1);

        const corridorState = advanceNaturalCorridorState(state, selectedEdge);
        const selectedEdgeIsPaved = selectedEdge.surface != null && PAVED_SURFACES.has(selectedEdge.surface);
        const selectedEdgeIsTargetNatural = isTargetNaturalEdge(selectedEdge, targetNodeIds);
        const intentStepScore = scoreIntentEdge(selectedEdge, state, targetDistanceKm, targetNodeIds, routeIntent) * selectedEdge.lengthKm;
        const stepScore =
          selectedEdge.score * selectedEdge.lengthKm + scoreNaturalCorridorStep(selectedEdge, state) + intentStepScore;

        const newState: BeamState = {
          nodeIds: [...state.nodeIds, selectedEdge.to],
          edgeIds: [...state.edgeIds, selectedEdge.id],
          edgeVisits: newEdgeVisits,
          currentNodeId: selectedEdge.to,
          lastFrom: state.currentNodeId,
          distanceKm: newDist,
          totalScore: state.totalScore + stepScore,
          cumulativeAscentM: newAscent,
          cumulativeDescentM: newDescent,
          ...corridorState,
          pavedDistanceKm: state.pavedDistanceKm + (selectedEdgeIsPaved ? selectedEdge.lengthKm : 0),
          targetComponentNaturalDistanceKm: state.targetComponentNaturalDistanceKm + (selectedEdgeIsTargetNatural ? selectedEdge.lengthKm : 0),
          enteredTargetComponent: state.enteredTargetComponent || selectedEdgeIsTargetNatural,
        };

        const newProgress = newDist / targetDistanceKm;
        incrementDiagnostic(diagnostics, "statesExpanded");

        // 3.2 Forced loop closure at 65%+
        if (newProgress >= 0.65) {
          const returnDist = returnCache.getDistance(graph, selectedEdge.to, startNodeId);

          if (returnDist !== null) {
            // Can we close?
            if (newDist + returnDist > maxDist) {
              // Can't close — prune dead state
              incrementDiagnostic(diagnostics, "prunedReturnBudget");
              continue;
            }

            if (newDist + returnDist >= minDist && newDist + returnDist <= maxDist) {
              // Close loop via A* return path
              const closedDistance = newDist + returnDist;
              const resolvedReturn = resolveReturnPath(
                graph,
                selectedEdge.to,
                startNodeId,
                newState.edgeVisits,
                returnCache,
                cleanReturnMode,
                maxDist - newDist,
                newDist,
                newState.pavedDistanceKm,
                routeIntent?.maxRepeatEdgeRatio,
                returnPavedRatioCap,
                diagnostics
              );
              const returnPath = resolvedReturn.path;
              if (returnPath) {
                validPaths.push(buildSolverPath(
                  graph,
                  [...newState.nodeIds, ...returnPath.nodeIds.slice(1)],
                  [...newState.edgeIds, ...returnPath.edgeIds],
                  newDist + returnPath.distanceKm,
                  resolvedReturn.relaxationsUsed,
                  targetNodeIds
                ));
              }
              if (closedDistance >= targetDistanceKm * 0.98) {
                continue;
              }
            }

            // At 85%+, force closure for all reachable states
            if (newProgress >= 0.85) {
              const resolvedReturn = resolveReturnPath(
                graph,
                selectedEdge.to,
                startNodeId,
                newState.edgeVisits,
                returnCache,
                cleanReturnMode,
                maxDist * 1.1 - newDist,
                newDist,
                newState.pavedDistanceKm,
                routeIntent?.maxRepeatEdgeRatio,
                returnPavedRatioCap,
                diagnostics
              );
              const returnPath = resolvedReturn.path;
              const forcedClosedDistance = returnPath ? newDist + returnPath.distanceKm : null;
              if (returnPath && forcedClosedDistance != null && forcedClosedDistance >= minDist && forcedClosedDistance <= maxDist * 1.1) {
                validPaths.push(buildSolverPath(
                  graph,
                  [...newState.nodeIds, ...returnPath.nodeIds.slice(1)],
                  [...newState.edgeIds, ...returnPath.edgeIds],
                  forcedClosedDistance,
                  resolvedReturn.relaxationsUsed,
                  targetNodeIds
                ));
              }
              if (forcedClosedDistance != null && forcedClosedDistance >= minDist) {
                continue;
              }
            }
          }
        } else {
          incrementDiagnostic(diagnostics, "returnPathMissing");
        }

        // Check for natural loop closure
        const endNode = graph.nodes.get(selectedEdge.to);
        if (endNode && newDist >= minDist) {
          const distToStart = haversineKm(
            { lat: endNode.lat, lng: endNode.lng },
            startCoord
          );
          if (distToStart < CLOSE_ENOUGH_KM) {
            validPaths.push(buildSolverPath(graph, newState.nodeIds, newState.edgeIds, newState.distanceKm, [], targetNodeIds));
          }
        }

        nextBeam.push(newState);
      }
    }

    // Keep top beamWidth states using diverse beam selection
    beam = diverseBeamSelect(nextBeam, beamWidth, targetDistanceKm, targetElevationM, graph);
  }

  return validPaths;
}

function solverConfigsForIntent(routeIntent?: RouteIntent): SolverConfig[] {
  if (routeIntent?.type === "park_loop") return [
    { beamWidth: 16, temperature: 0.18, seedBearing: 0, expansionFactor: 2 },
    { beamWidth: 16, temperature: 0.2, seedBearing: 180, expansionFactor: 2 },
  ];
  if (routeIntent?.type === "urban_nature_loop") return SOLVER_CONFIGS.slice(0, 2);
  return SOLVER_CONFIGS;
}

// ── Geometric deduplication ──────────────────────────────────────────────────

function computeJaccardSimilarity(edgesA: string[], edgesB: string[]): number {
  const setA = new Set(edgesA);
  const setB = new Set(edgesB);

  let intersection = 0;
  for (const e of Array.from(setA)) {
    if (setB.has(e)) intersection++;
  }

  const union = setA.size + setB.size - intersection;
  return union === 0 ? 1 : intersection / union;
}

function deduplicatePaths(paths: SolverPath[], threshold = 0.6): SolverPath[] {
  if (paths.length <= 1) return paths;

  const kept: SolverPath[] = [paths[0]];

  for (let i = 1; i < paths.length; i++) {
    const candidate = paths[i];
    const isDuplicate = kept.some(
      (existing) => computeJaccardSimilarity(candidate.edgeIds, existing.edgeIds) > threshold
    );
    if (!isDuplicate) {
      kept.push(candidate);
    }
  }

  return kept;
}

// ── Public API ───────────────────────────────────────────────────────────────

export async function solve(
  graph: EnrichedGraph,
  startNodeId: string,
  targetDistanceKm: number,
  targetElevationM: number = 0,
  nodeElevation: Map<string, number> = new Map(),
  routeIntent?: RouteIntent,
  runtimeBudget: SolverRuntimeBudget = {}
): Promise<SolverPath[]> {
  const configs = solverConfigsForIntent(routeIntent);
  const deadlineMs = resolveSolverDeadline(routeIntent, runtimeBudget);
  const diagnostics = runtimeBudget.emptyDiagnostics;
  const allPaths: SolverPath[] = [];
  for (const config of configs) {
    incrementDiagnostic(diagnostics, "configsTried");
    if (deadlineMs != null && performance.now() >= deadlineMs && allPaths.length > 0) {
      if (diagnostics) diagnostics.deadlineReached = true;
      break;
    }
    allPaths.push(...solveWithConfig(graph, startNodeId, targetDistanceKm, targetElevationM, nodeElevation, config, routeIntent, deadlineMs, diagnostics));
    if (hasEnoughProgressivePaths(allPaths, routeIntent)) break;
  }


  // Sort by totalScore descending
  allPaths.sort((a, b) => b.totalScore - a.totalScore);

  // 4.2 Geometric deduplication
  const dedupedPaths = deduplicatePaths(allPaths);
  if (diagnostics) diagnostics.validPaths = dedupedPaths.length;
  return dedupedPaths;
}

export function resolveSolverDeadline(
  routeIntent?: RouteIntent,
  runtimeBudget: SolverRuntimeBudget = {},
  nowMs: number = performance.now()
): number | undefined {
  if (runtimeBudget.deadlineMs != null) return runtimeBudget.deadlineMs;
  if (!routeIntent) return undefined;

  const targetComponents = routeIntent.terrainComponents.filter((component) => routeIntent.targetComponents.includes(component.id));
  const targetComponentKm = Math.max(0, ...targetComponents.map((component) => component.totalKm));
  const hugeTransitionToWoods = routeIntent.type === "transition_to_woods" && (
    targetComponentKm >= 80 || routeIntent.beamBudget.maxIterations >= 600
  );
  const compactParkLoop = routeIntent.type === "park_loop" && routeIntent.distancePolicy.mode === "adjustable";
  const multiplier = hugeTransitionToWoods
    ? (routeIntent.targetDistanceKm >= 14 ? 14 : 12)
    : compactParkLoop
      ? 4
      : 10;
  const maxBudgetMs = hugeTransitionToWoods
    ? (routeIntent.targetDistanceKm >= 14 ? 60_000 : 55_000)
    : compactParkLoop
      ? 20_000
      : 45_000;
  const minBudgetMs = compactParkLoop ? 12_000 : 15_000;
  const softBudgetMs = Math.max(minBudgetMs, Math.min(maxBudgetMs, routeIntent.timeBudgetMs * multiplier));
  return nowMs + softBudgetMs;
}

function hasEnoughProgressivePaths(paths: SolverPath[], routeIntent?: RouteIntent): boolean {
  if (!routeIntent) return false;
  if (routeIntent.type === "transition_to_woods" || routeIntent.type === "forest_loop") return false;
  const shortlistSize = routeIntent.beamBudget.shortlistSize;
  if (paths.length < Math.max(4, Math.min(shortlistSize, 8))) return false;
  const minDistanceKm = routeIntent.targetDistanceKm * 0.9;
  const targetNodeIds = buildTargetNodeSet(routeIntent);
  const viableCount = paths.filter((path) => {
    if (path.distanceKm < minDistanceKm) return false;
    if (targetNodeIds.size === 0) return true;
    return path.nodeIds.some((nodeId) => targetNodeIds.has(nodeId));
  }).length;
  return viableCount >= Math.max(4, Math.min(shortlistSize, 8));
}
