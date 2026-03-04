import type { EnrichedGraph, SolverPath } from "../types";
import { haversineKm } from "../route-generator-legacy";

interface BeamState {
  nodeIds: string[];
  edgeIds: string[];
  visitedEdges: Set<string>;
  currentNodeId: string;
  distanceKm: number;
  totalScore: number;
}

interface SolverConfig {
  beamWidth: number;
  temperature: number;
}

const SOLVER_CONFIGS: SolverConfig[] = [
  { beamWidth: 50, temperature: 0.3 },
  { beamWidth: 30, temperature: 0.5 },
  { beamWidth: 80, temperature: 0.2 },
  { beamWidth: 40, temperature: 0.8 },
  { beamWidth: 60, temperature: 0.4 },
];

const MAX_ITERATIONS = 2000;
const DISTANCE_TOLERANCE = 0.15;
const CLOSE_ENOUGH_KM = 0.2; // 200m

function softmaxSelect(
  scores: number[],
  temperature: number
): number {
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

function solveWithConfig(
  graph: EnrichedGraph,
  startNodeId: string,
  targetDistanceKm: number,
  config: SolverConfig
): SolverPath[] {
  const { beamWidth, temperature } = config;
  const maxDist = targetDistanceKm * (1 + DISTANCE_TOLERANCE);
  const minDist = targetDistanceKm * (1 - DISTANCE_TOLERANCE);
  const startNode = graph.nodes.get(startNodeId);
  if (!startNode) return [];

  const startCoord = { lat: startNode.lat, lng: startNode.lng };

  let beam: BeamState[] = [
    {
      nodeIds: [startNodeId],
      edgeIds: [],
      visitedEdges: new Set(),
      currentNodeId: startNodeId,
      distanceKm: 0,
      totalScore: 0,
    },
  ];

  const validPaths: SolverPath[] = [];

  for (let iter = 0; iter < MAX_ITERATIONS && beam.length > 0; iter++) {
    const nextBeam: BeamState[] = [];

    for (const state of beam) {
      const currentNode = graph.nodes.get(state.currentNodeId);
      if (!currentNode) continue;

      // Find unvisited edges
      const candidateEdges = currentNode.edges
        .map((eid) => graph.edges.get(eid)!)
        .filter((e) => e && !state.visitedEdges.has(e.id));

      if (candidateEdges.length === 0) continue;

      // Compute adjusted scores with return-to-start bias
      const progress = state.distanceKm / targetDistanceKm;
      const adjustedScores = candidateEdges.map((edge) => {
        let score = edge.score;

        if (progress > 0.6) {
          // Bias toward start
          const toNode = graph.nodes.get(edge.to);
          if (toNode) {
            const distToStart = haversineKm(
              { lat: toNode.lat, lng: toNode.lng },
              startCoord
            );
            const remaining = targetDistanceKm - state.distanceKm;
            const closingFactor = Math.max(0.1, 1 - distToStart / Math.max(remaining, 0.1));
            score *= 0.5 + 0.5 * closingFactor;
          }
        }

        return Math.max(score, 0.01);
      });

      // Probabilistic selection
      const selectedIdx = softmaxSelect(adjustedScores, temperature);
      if (selectedIdx < 0) continue;

      const selectedEdge = candidateEdges[selectedIdx];
      const newDist = state.distanceKm + selectedEdge.lengthKm;

      // Prune if exceeding max distance
      if (newDist > maxDist) {
        // Check if current state is a valid loop
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

      const newVisited = new Set(state.visitedEdges);
      newVisited.add(selectedEdge.id);

      const newState: BeamState = {
        nodeIds: [...state.nodeIds, selectedEdge.to],
        edgeIds: [...state.edgeIds, selectedEdge.id],
        visitedEdges: newVisited,
        currentNodeId: selectedEdge.to,
        distanceKm: newDist,
        totalScore: state.totalScore + selectedEdge.score * selectedEdge.lengthKm,
      };

      // Check for loop closure
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
          continue; // Don't extend further
        }
      }

      nextBeam.push(newState);
    }

    // Keep top beamWidth states by score-per-km
    nextBeam.sort((a, b) => {
      const scoreA = a.distanceKm > 0 ? a.totalScore / a.distanceKm : 0;
      const scoreB = b.distanceKm > 0 ? b.totalScore / b.distanceKm : 0;
      return scoreB - scoreA;
    });
    beam = nextBeam.slice(0, beamWidth);
  }

  return validPaths;
}

export async function solve(
  graph: EnrichedGraph,
  startNodeId: string,
  targetDistanceKm: number
): Promise<SolverPath[]> {
  const results = await Promise.all(
    SOLVER_CONFIGS.map((config) =>
      Promise.resolve(solveWithConfig(graph, startNodeId, targetDistanceKm, config))
    )
  );

  const allPaths = results.flat();

  // Deduplicate by similar distance (within 5%) and sort by totalScore
  allPaths.sort((a, b) => b.totalScore - a.totalScore);

  return allPaths;
}
