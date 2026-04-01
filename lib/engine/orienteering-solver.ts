import type { EnrichedGraph, SolverPath } from "../types";
import { haversineKm } from "./utils";
import { ReturnDistanceCache } from "./pathfinder";
import { type TierConfig, type SolverConfig, FULL_CONFIG } from "./solver-config";

// ── Types ────────────────────────────────────────────────────────────────────

interface BeamState {
  parent: BeamState | null;
  lastNodeId: string;
  lastEdgeId: string | null;
  lastEdgeKey: string | null;
  currentNodeId: string;
  lastFrom: string | null;
  distanceKm: number;
  totalScore: number;
  cumulativeAscentM: number;
  cumulativeDescentM: number;
  depth: number;
}

// ── Constants ────────────────────────────────────────────────────────────────
const CLOSE_ENOUGH_KM = 0.2;
const MAX_EDGE_REVISITS = 1;
const REVISIT_PENALTY = 0.15;
const ROAD_DISTANCE_FACTOR = 1.4;

/**
 * Adaptive distance tolerance: tighter for longer routes where ±15% is too loose.
 */
export function getDistanceTolerance(targetKm: number): number {
  if (targetKm <= 10) return 0.15;  // ±15% for short routes
  if (targetKm <= 30) return 0.12;  // ±12% for medium
  if (targetKm <= 60) return 0.10;  // ±10% for long
  return 0.08;                       // ±8% for very long
}

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
 * Walk the parent chain to check if an edge has been visited at all.
 * Short-circuits on first match → O(1) best case, O(depth) worst case.
 */
function hasVisitedEdge(state: BeamState, edgeKey: string): boolean {
  let current: BeamState | null = state;
  while (current) {
    if (current.lastEdgeKey === edgeKey) return true;
    current = current.parent;
  }
  return false;
}

/**
 * Walk the parent chain to count how many times an edge has been visited.
 * Used for dead-end escape where exact count matters.
 */
function countEdgeVisits(state: BeamState, edgeKey: string): number {
  let count = 0;
  let current: BeamState | null = state;
  while (current) {
    if (current.lastEdgeKey === edgeKey) count++;
    current = current.parent;
  }
  return count;
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

// ── Path reconstruction (linked-list → arrays) ──────────────────────────────

function reconstructPath(state: BeamState): { nodeIds: string[]; edgeIds: string[] } {
  const nodeIds = new Array<string>(state.depth + 1);
  const edgeIds = new Array<string>(state.depth);
  let current: BeamState | null = state;
  let i = state.depth;
  while (current) {
    nodeIds[i] = current.lastNodeId;
    if (current.lastEdgeId) {
      edgeIds[i - 1] = current.lastEdgeId;
    }
    i--;
    current = current.parent;
  }
  return { nodeIds, edgeIds };
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
  earlyK: number,
  lateK: number,
  maxIterations: number
): SolverPath[] {
  const { beamWidth, temperature, seedBearing } = config;
  const tolerance = getDistanceTolerance(targetDistanceKm);
  const maxDist = targetDistanceKm * (1 + tolerance);
  const minDist = targetDistanceKm * (1 - tolerance);
  const startNode = graph.nodes.get(startNodeId);
  if (!startNode) return [];

  const startCoord = { lat: startNode.lat, lng: startNode.lng };
  const returnCache = new ReturnDistanceCache();

  let beam: BeamState[] = [
    {
      parent: null,
      lastNodeId: startNodeId,
      lastEdgeId: null,
      lastEdgeKey: null,
      currentNodeId: startNodeId,
      lastFrom: null,
      distanceKm: 0,
      totalScore: 0,
      cumulativeAscentM: 0,
      cumulativeDescentM: 0,
      depth: 0,
    },
  ];

  const validPaths: SolverPath[] = [];

  for (let iter = 0; iter < maxIterations && beam.length > 0; iter++) {
    const nextBeam: BeamState[] = [];

    for (const state of beam) {
      const currentNode = graph.nodes.get(state.currentNodeId);
      if (!currentNode) continue;

      const progress = state.distanceKm / targetDistanceKm;

      // Determine expansion factor: earlyK in first 60%, lateK after
      const k = progress < 0.6 ? earlyK : lateK;

      // Find candidate edges (with visited-edge relaxation)
      const allEdges = currentNode.edges
        .map((eid) => graph.edges.get(eid)!)
        .filter((e) => e != null);

      const unvisitedEdges = allEdges.filter((e) => {
        const key = undirectedEdgeKey(e.from, e.to, e.osmWayId);
        return !hasVisitedEdge(state, key);
      });

      // Dead-end escape: allow revisits if no unvisited edges
      const candidateEdges = unvisitedEdges.length > 0
        ? unvisitedEdges
        : allEdges.filter((e) => {
            const key = undirectedEdgeKey(e.from, e.to, e.osmWayId);
            return countEdgeVisits(state, key) < MAX_EDGE_REVISITS;
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

        if (progress >= 0.5) {
          // After 50% progress, prefer A* cache distance when available
          const cachedReturn = returnCache.getDistance(graph, edge.to, startNodeId);
          const returnEst = cachedReturn !== null ? cachedReturn : estimatedRoadReturn;
          if (returnEst > remainingBudget) {
            return 0.01;
          }
        } else if (estimatedRoadReturn > remainingBudget) {
          return 0.01;
        }

        // 1.3 Revisit penalty
        const edgeKey = undirectedEdgeKey(edge.from, edge.to, edge.osmWayId);
        if (hasVisitedEdge(state, edgeKey)) {
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

        // 2.3 Gradient-aware edge selection bias (progressive from 20% onward)
        if (progress > 0.2 && targetElevationM > 0) {
          const fromElev = nodeElevation.get(edge.from) ?? 0;
          const toElev = nodeElevation.get(edge.to) ?? 0;
          const elevDelta = toElev - fromElev;
          const expectedAscent = targetElevationM * progress;
          const isUphill = elevDelta > 0;

          // Progressive weight: 0.5x at 20% progress → 1.5x at 80%+
          const elevWeight = 0.5 + Math.min(1.0, progress) * 1.0;

          if (isUphill) {
            if (state.cumulativeAscentM < expectedAscent * 0.8) {
              // Under budget → boost uphill proportionally to deficit
              const deficit = (expectedAscent - state.cumulativeAscentM) / Math.max(targetElevationM, 1);
              score *= 1 + deficit * elevWeight * 0.5;
            } else if (state.cumulativeAscentM > expectedAscent * 1.3) {
              // Over budget → penalize uphill
              score *= Math.max(0.3, 1 - elevWeight * 0.3);
            }
          } else if (elevDelta < -5) {
            // Downhill: prefer when over D+ budget
            if (state.cumulativeAscentM > expectedAscent * 1.3) {
              score *= 1.2;
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
            const { nodeIds, edgeIds } = reconstructPath(state);
            validPaths.push({
              nodeIds,
              edgeIds,
              totalScore: state.totalScore,
              distanceKm: state.distanceKm,
            });
          }
          continue;
        }

        const edgeKey = undirectedEdgeKey(selectedEdge.from, selectedEdge.to, selectedEdge.osmWayId);

        const newState: BeamState = {
          parent: state,
          lastNodeId: selectedEdge.to,
          lastEdgeId: selectedEdge.id,
          lastEdgeKey: edgeKey,
          currentNodeId: selectedEdge.to,
          lastFrom: state.currentNodeId,
          distanceKm: newDist,
          totalScore: state.totalScore + selectedEdge.score * selectedEdge.lengthKm,
          cumulativeAscentM: newAscent,
          cumulativeDescentM: newDescent,
          depth: state.depth + 1,
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
              const returnPath = returnCache.getPath(graph, selectedEdge.to, startNodeId);
              if (returnPath) {
                const { nodeIds, edgeIds } = reconstructPath(newState);
                validPaths.push({
                  nodeIds: [...nodeIds, ...returnPath.nodeIds.slice(1)],
                  edgeIds: [...edgeIds, ...returnPath.edgeIds],
                  totalScore: newState.totalScore,
                  distanceKm: newDist + returnPath.distanceKm,
                });
                continue;
              }
            }

            // At 85%+, force closure for all reachable states
            if (newProgress >= 0.85) {
              const returnPath = returnCache.getPath(graph, selectedEdge.to, startNodeId);
              if (returnPath && newDist + returnPath.distanceKm <= maxDist * 1.1) {
                const { nodeIds, edgeIds } = reconstructPath(newState);
                validPaths.push({
                  nodeIds: [...nodeIds, ...returnPath.nodeIds.slice(1)],
                  edgeIds: [...edgeIds, ...returnPath.edgeIds],
                  totalScore: newState.totalScore,
                  distanceKm: newDist + returnPath.distanceKm,
                });
                continue;
              }
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
            const { nodeIds, edgeIds } = reconstructPath(newState);
            validPaths.push({
              nodeIds,
              edgeIds,
              totalScore: newState.totalScore,
              distanceKm: newState.distanceKm,
            });
            continue;
          }
        }

        nextBeam.push(newState);
      }
    }

    // Keep top beamWidth states using diverse beam selection
    beam = diverseBeamSelect(nextBeam, beamWidth, targetDistanceKm, targetElevationM, graph);
  }

  // Fallback: if no valid paths found, try to close the best remaining beam states
  if (validPaths.length === 0 && beam.length > 0) {
    const fallbackMinDist = minDist * 0.8;
    const fallbackMaxDist = maxDist * 1.2;
    for (const state of beam) {
      const returnPath = returnCache.getPath(graph, state.currentNodeId, startNodeId);
      if (returnPath) {
        const totalDist = state.distanceKm + returnPath.distanceKm;
        if (totalDist >= fallbackMinDist && totalDist <= fallbackMaxDist) {
          const { nodeIds, edgeIds } = reconstructPath(state);
          validPaths.push({
            nodeIds: [...nodeIds, ...returnPath.nodeIds.slice(1)],
            edgeIds: [...edgeIds, ...returnPath.edgeIds],
            totalScore: state.totalScore,
            distanceKm: totalDist,
          });
        }
      }
    }
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

/**
 * Simple deduplication by distance similarity (free tier).
 * Two routes are considered duplicates if their distances are within 5% of each other.
 */
function deduplicateByDistance(paths: SolverPath[], toleranceFraction = 0.05): SolverPath[] {
  if (paths.length <= 1) return paths;

  const kept: SolverPath[] = [paths[0]];

  for (let i = 1; i < paths.length; i++) {
    const candidate = paths[i];
    const isDuplicate = kept.some(
      (existing) =>
        Math.abs(candidate.distanceKm - existing.distanceKm) / Math.max(existing.distanceKm, 0.001) < toleranceFraction
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
  tierConfig: TierConfig = FULL_CONFIG
): Promise<SolverPath[]> {
  const { solverConfigs, maxIterations, earlyK, lateK, maxCandidates, deduplicationMode } = tierConfig;
  const allPaths: SolverPath[] = [];

  for (const config of solverConfigs) {
    const paths = solveWithConfig(
      graph, startNodeId, targetDistanceKm, targetElevationM, nodeElevation,
      config, earlyK, lateK, maxIterations
    );
    allPaths.push(...paths);

    // Early stop: if we have enough diverse paths, skip remaining configs
    const sorted = [...allPaths].sort((a, b) => b.totalScore - a.totalScore);
    const deduped = deduplicationMode === "jaccard"
      ? deduplicatePaths(sorted)
      : deduplicateByDistance(sorted);
    if (deduped.length >= maxCandidates) break;
  }

  // Sort by totalScore descending
  allPaths.sort((a, b) => b.totalScore - a.totalScore);

  // Deduplication based on tier mode
  const deduped = deduplicationMode === "jaccard"
    ? deduplicatePaths(allPaths)
    : deduplicateByDistance(allPaths);

  return deduped.slice(0, maxCandidates);
}
