import type { EnrichedGraph, SolverPath } from "../types";
import { haversineKm } from "../route-generator-legacy";
import { ReturnDistanceCache } from "./pathfinder";

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

// ── Utility functions ────────────────────────────────────────────────────────

function undirectedEdgeKey(from: string, to: string, wayId: number): string {
  return from < to
    ? `${from}-${to}-${wayId}`
    : `${to}-${from}-${wayId}`;
}

function isNaturalCorridorEdge(edge: { highway: string; surface?: string; scenic?: boolean }): boolean {
  return (
    edge.scenic === true ||
    NATURAL_HIGHWAY_TYPES.has(edge.highway) ||
    (edge.surface != null && NATURAL_SURFACES.has(edge.surface))
  );
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
    const pull = approachRatio * anchorScale * NATURAL_ANCHOR_PULL_BONUS;
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
    const isEnteringAnchor = !anchor.nodeIds.has(currentNodeId) && anchor.nodeIds.has(toNodeId);
    if (isEnteringAnchor) {
      const anchorScale = Math.min(1, anchor.totalNaturalKm / Math.max(MIN_NATURAL_ANCHOR_KM, targetDistanceKm * 0.25));
      return NATURAL_ANCHOR_ENTRY_BONUS * anchorScale;
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

function scorePathWithCorridorPreference(graph: EnrichedGraph, edgeIds: string[]): number {
  let rawScore = 0;
  let totalDistanceKm = 0;
  let naturalDistanceKm = 0;
  let currentNaturalStreakKm = 0;
  let longestNaturalStreakKm = 0;
  let naturalSegmentCount = 0;
  let wasNatural = false;

  for (const edgeId of edgeIds) {
    const edge = graph.edges.get(edgeId);
    if (!edge) continue;
    rawScore += edge.score * edge.lengthKm;
    totalDistanceKm += edge.lengthKm;

    const isNatural = isNaturalCorridorEdge(edge);
    if (isNatural) {
      naturalDistanceKm += edge.lengthKm;
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

  return rawScore + corridorBonus + massifVisitBonus - fragmentationPenalty - lowNaturePenalty;
}

function buildSolverPath(graph: EnrichedGraph, nodeIds: string[], edgeIds: string[], distanceKm: number): SolverPath {
  return {
    nodeIds,
    edgeIds,
    totalScore: scorePathWithCorridorPreference(graph, edgeIds),
    distanceKm,
  };
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
  config: SolverConfig
): SolverPath[] {
  const { beamWidth, seedBearing } = config;
  const maxDist = targetDistanceKm * (1 + DISTANCE_TOLERANCE);
  const minDist = targetDistanceKm * (1 - DISTANCE_TOLERANCE);
  const startNode = graph.nodes.get(startNodeId);
  if (!startNode) return [];

  const startCoord = { lat: startNode.lat, lng: startNode.lng };
  const naturalAnchors = buildNaturalAnchors(graph, targetDistanceKm);
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
    },
  ];

  const validPaths: SolverPath[] = [];

  for (let iter = 0; iter < MAX_ITERATIONS && beam.length > 0; iter++) {
    const nextBeam: BeamState[] = [];

    for (const state of beam) {
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
        .filter((e) => e != null);

      const unvisitedEdges = allEdges.filter((e) => {
        const key = undirectedEdgeKey(e.from, e.to, e.osmWayId);
        return (state.edgeVisits.get(key) ?? 0) === 0;
      });

      // Dead-end escape: allow revisits if no unvisited edges
      const candidateEdges = unvisitedEdges.length > 0
        ? unvisitedEdges
        : allEdges.filter((e) => {
            const key = undirectedEdgeKey(e.from, e.to, e.osmWayId);
            return (state.edgeVisits.get(key) ?? 0) < MAX_EDGE_REVISITS;
          });

      if (candidateEdges.length === 0) continue;

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
          const distToStart = haversineKm(
            { lat: currentNode.lat, lng: currentNode.lng },
            startCoord
          );
          if (distToStart < CLOSE_ENOUGH_KM && state.distanceKm >= minDist) {
            validPaths.push(buildSolverPath(graph, state.nodeIds, state.edgeIds, state.distanceKm));
          }
          continue;
        }

        const edgeKey = undirectedEdgeKey(selectedEdge.from, selectedEdge.to, selectedEdge.osmWayId);
        const newEdgeVisits = new Map(state.edgeVisits);
        newEdgeVisits.set(edgeKey, (newEdgeVisits.get(edgeKey) ?? 0) + 1);

        const corridorState = advanceNaturalCorridorState(state, selectedEdge);
        const stepScore =
          selectedEdge.score * selectedEdge.lengthKm + scoreNaturalCorridorStep(selectedEdge, state);

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
        };

        const newProgress = newDist / targetDistanceKm;

        // 3.2 Forced loop closure at 65%+
        if (newProgress >= 0.65) {
          const returnDist = returnCache.getDistance(graph, selectedEdge.to, startNodeId);

          if (returnDist !== null) {
            // Can we close?
            if (newDist + returnDist > maxDist) {
              // Can't close — prune dead state
              continue;
            }

            if (newDist + returnDist >= minDist && newDist + returnDist <= maxDist) {
              // Close loop via A* return path
              const closedDistance = newDist + returnDist;
              const returnPath = returnCache.getPath(graph, selectedEdge.to, startNodeId);
              if (returnPath) {
                validPaths.push(buildSolverPath(
                  graph,
                  [...newState.nodeIds, ...returnPath.nodeIds.slice(1)],
                  [...newState.edgeIds, ...returnPath.edgeIds],
                  closedDistance
                ));
              }
              if (closedDistance >= targetDistanceKm * 0.98) {
                continue;
              }
            }

            // At 85%+, force closure for all reachable states
            if (newProgress >= 0.85) {
              const returnPath = returnCache.getPath(graph, selectedEdge.to, startNodeId);
              if (returnPath && newDist + returnPath.distanceKm <= maxDist * 1.1) {
                validPaths.push(buildSolverPath(
                  graph,
                  [...newState.nodeIds, ...returnPath.nodeIds.slice(1)],
                  [...newState.edgeIds, ...returnPath.edgeIds],
                  newDist + returnPath.distanceKm
                ));
              }
              continue;
            }
          }
        }

        // Check for natural loop closure
        const endNode = graph.nodes.get(selectedEdge.to);
        if (endNode && newDist >= minDist) {
          const distToStart = haversineKm(
            { lat: endNode.lat, lng: endNode.lng },
            startCoord
          );
          if (distToStart < CLOSE_ENOUGH_KM) {
            validPaths.push(buildSolverPath(graph, newState.nodeIds, newState.edgeIds, newState.distanceKm));
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
  nodeElevation: Map<string, number> = new Map()
): Promise<SolverPath[]> {
  const results = SOLVER_CONFIGS.map((config) =>
    solveWithConfig(graph, startNodeId, targetDistanceKm, targetElevationM, nodeElevation, config)
  );

  const allPaths = results.flat();

  // Sort by totalScore descending
  allPaths.sort((a, b) => b.totalScore - a.totalScore);

  // 4.2 Geometric deduplication
  return deduplicatePaths(allPaths);
}
