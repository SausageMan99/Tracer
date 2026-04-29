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
}

interface SolverConfig {
  beamWidth: number;
  temperature: number;
  seedBearing: number;
  expansionFactor: number;
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

// ── Utility functions ────────────────────────────────────────────────────────

function undirectedEdgeKey(from: string, to: string, wayId: number): string {
  return from < to
    ? `${from}-${to}-${wayId}`
    : `${to}-${from}-${wayId}`;
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

function softmaxSelect(scores: number[], temperature: number): number {
  if (scores.length === 0) return -1;
  if (scores.length === 1) return 0;

  const maxScore = Math.max(...scores);
  const exps = scores.map((s) => Math.exp((s - maxScore) / Math.max(temperature, 0.01)));
  const sumExp = exps.reduce((a, b) => a + b, 0);

  const r = Math.random() * sumExp;
  let cumulative = 0;
  for (let i = 0; i < exps.length; i++) {
    cumulative += exps[i];
    if (r <= cumulative) return i;
  }
  return exps.length - 1;
}

/**
 * Select top-K indices from an array of scores using softmax sampling.
 */
function softmaxSelectMultiple(
  scores: number[],
  temperature: number,
  k: number
): number[] {
  if (scores.length === 0) return [];
  if (scores.length <= k) return scores.map((_, i) => i);

  const selected: number[] = [];
  const remaining = scores.map((s, i) => ({ score: s, index: i }));

  for (let pick = 0; pick < k && remaining.length > 0; pick++) {
    const remScores = remaining.map((r) => r.score);
    const idx = softmaxSelect(remScores, temperature);
    if (idx < 0) break;
    selected.push(remaining[idx].index);
    remaining.splice(idx, 1);
  }

  return selected;
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
  const { beamWidth, temperature, seedBearing } = config;
  const maxDist = targetDistanceKm * (1 + DISTANCE_TOLERANCE);
  const minDist = targetDistanceKm * (1 - DISTANCE_TOLERANCE);
  const startNode = graph.nodes.get(startNodeId);
  if (!startNode) return [];

  const startCoord = { lat: startNode.lat, lng: startNode.lng };
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
      const selectedIndices = softmaxSelectMultiple(adjustedScores, temperature, k);
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
            validPaths.push({
              nodeIds: state.nodeIds,
              edgeIds: state.edgeIds,
              totalScore: state.totalScore,
              distanceKm: state.distanceKm,
            });
          }
          continue;
        }

        const edgeKey = undirectedEdgeKey(selectedEdge.from, selectedEdge.to, selectedEdge.osmWayId);
        const newEdgeVisits = new Map(state.edgeVisits);
        newEdgeVisits.set(edgeKey, (newEdgeVisits.get(edgeKey) ?? 0) + 1);

        const newState: BeamState = {
          nodeIds: [...state.nodeIds, selectedEdge.to],
          edgeIds: [...state.edgeIds, selectedEdge.id],
          edgeVisits: newEdgeVisits,
          currentNodeId: selectedEdge.to,
          lastFrom: state.currentNodeId,
          distanceKm: newDist,
          totalScore: state.totalScore + selectedEdge.score * selectedEdge.lengthKm,
          cumulativeAscentM: newAscent,
          cumulativeDescentM: newDescent,
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
                validPaths.push({
                  nodeIds: [...newState.nodeIds, ...returnPath.nodeIds.slice(1)],
                  edgeIds: [...newState.edgeIds, ...returnPath.edgeIds],
                  totalScore: newState.totalScore,
                  distanceKm: closedDistance,
                });
              }
              if (closedDistance >= targetDistanceKm * 0.98) {
                continue;
              }
            }

            // At 85%+, force closure for all reachable states
            if (newProgress >= 0.85) {
              const returnPath = returnCache.getPath(graph, selectedEdge.to, startNodeId);
              if (returnPath && newDist + returnPath.distanceKm <= maxDist * 1.1) {
                validPaths.push({
                  nodeIds: [...newState.nodeIds, ...returnPath.nodeIds.slice(1)],
                  edgeIds: [...newState.edgeIds, ...returnPath.edgeIds],
                  totalScore: newState.totalScore,
                  distanceKm: newDist + returnPath.distanceKm,
                });
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
            validPaths.push({
              nodeIds: newState.nodeIds,
              edgeIds: newState.edgeIds,
              totalScore: newState.totalScore,
              distanceKm: newState.distanceKm,
            });
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
  for (const e of setA) {
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
