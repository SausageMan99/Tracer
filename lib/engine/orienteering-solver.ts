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
  { beamWidth: 50, temperature: 0.3, seedBearing: 0,   expansionFactor: 3 },
  { beamWidth: 30, temperature: 0.5, seedBearing: 72,  expansionFactor: 3 },
  { beamWidth: 80, temperature: 0.2, seedBearing: 144, expansionFactor: 3 },
  { beamWidth: 40, temperature: 0.8, seedBearing: 216, expansionFactor: 3 },
  { beamWidth: 60, temperature: 0.4, seedBearing: 288, expansionFactor: 3 },
];

const MAX_ITERATIONS = 2000;
const DISTANCE_TOLERANCE = 0.15;
const CLOSE_ENOUGH_KM = 0.2;
const MAX_EDGE_REVISITS = 2;
const REVISIT_PENALTY = 0.3;
const BACKTRACK_PENALTY = 0.3;
const NEAR_REVERSAL_DEGREES = 30;

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
      let candidateEdges = unvisitedEdges.length > 0
        ? unvisitedEdges
        : allEdges.filter((e) => {
            const key = undirectedEdgeKey(e.from, e.to, e.osmWayId);
            return (state.edgeVisits.get(key) ?? 0) < MAX_EDGE_REVISITS;
          });

      if (candidateEdges.length === 0) continue;

      // Compute adjusted scores
      const adjustedScores = candidateEdges.map((edge) => {
        let score = edge.score;
        const toNode = graph.nodes.get(edge.to);
        if (!toNode) return 0.01;

        // 1.1 Anti-backtracking: hard-reject immediate U-turn
        if (state.lastFrom !== null && edge.to === state.lastFrom) {
          return 0.01;
        }

        // Soft-penalize near-reversal
        if (state.lastFrom !== null) {
          const lastNode = graph.nodes.get(state.lastFrom);
          if (lastNode) {
            const incomingBearing = computeBearing(lastNode.lat, lastNode.lng, currentNode.lat, currentNode.lng);
            const reverseBearing = normalizeAngle(incomingBearing + 180);
            const edgeBearing = computeBearing(currentNode.lat, currentNode.lng, toNode.lat, toNode.lng);
            const angleDiff = Math.abs(normalizeAngle(edgeBearing - reverseBearing));
            if (angleDiff < NEAR_REVERSAL_DEGREES) {
              score *= BACKTRACK_PENALTY;
            }
          }
        }

        // 1.2 Distance budget guard
        const edgeDist = edge.lengthKm;
        const distAfterEdge = state.distanceKm + edgeDist;
        const distToStart = haversineKm({ lat: toNode.lat, lng: toNode.lng }, startCoord);
        if (distAfterEdge + distToStart > maxDist) {
          return 0.01; // Can't close loop — skip
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

        // Return-to-start bias (after 60% progress)
        if (progress > 0.6) {
          const remaining = targetDistanceKm - state.distanceKm;
          const closingFactor = Math.max(0.1, 1 - distToStart / Math.max(remaining, 0.1));
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

        // 3.2 Forced loop closure at 75%+
        if (newProgress >= 0.75) {
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
                validPaths.push({
                  nodeIds: [...newState.nodeIds, ...returnPath.nodeIds.slice(1)],
                  edgeIds: [...newState.edgeIds, ...returnPath.edgeIds],
                  totalScore: newState.totalScore,
                  distanceKm: newDist + returnPath.distanceKm,
                });
                continue;
              }
            }

            // At 90%+, force closure for all reachable states
            if (newProgress >= 0.9) {
              const returnPath = returnCache.getPath(graph, selectedEdge.to, startNodeId);
              if (returnPath && newDist + returnPath.distanceKm <= maxDist * 1.1) {
                validPaths.push({
                  nodeIds: [...newState.nodeIds, ...returnPath.nodeIds.slice(1)],
                  edgeIds: [...newState.edgeIds, ...returnPath.edgeIds],
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
            validPaths.push({
              nodeIds: newState.nodeIds,
              edgeIds: newState.edgeIds,
              totalScore: newState.totalScore,
              distanceKm: newState.distanceKm,
            });
            continue;
          }
        }

        nextBeam.push(newState);
      }
    }

    // Keep top beamWidth states by adjusted score-per-km
    nextBeam.sort((a, b) => {
      const scoreA = a.distanceKm > 0 ? a.totalScore / a.distanceKm : 0;
      const scoreB = b.distanceKm > 0 ? b.totalScore / b.distanceKm : 0;

      // 2.2 Elevation budget factor in beam pruning
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
    beam = nextBeam.slice(0, beamWidth);
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
  const results = await Promise.all(
    SOLVER_CONFIGS.map((config) =>
      Promise.resolve(
        solveWithConfig(graph, startNodeId, targetDistanceKm, targetElevationM, nodeElevation, config)
      )
    )
  );

  const allPaths = results.flat();

  // Sort by totalScore descending
  allPaths.sort((a, b) => b.totalScore - a.totalScore);

  // 4.2 Geometric deduplication
  return deduplicatePaths(allPaths);
}
