import type { EnrichedEdge, EnrichedGraph } from '../../types';
import { classifyEdgeSemanticsV3 } from '../edge-semantics';
import type { RouteSurfaceV3, TerrainComponentKindV3 } from '../types';
import type { NaturalCycleCandidateV3 } from './natural-graph-contraction';

interface DirectedRankedCycleEdgeV3 {
  edge: EnrichedEdge;
  from: string;
  to: string;
  kind: TerrainComponentKindV3;
  surface: RouteSurfaceV3;
}

export type RankedNaturalCycleBasisMethodV3 = 'spanning_tree_back_edges';
export type RankedNaturalCyclePruningReasonV3 = 'none' | 'no_useful_cycle' | 'max_back_edges' | 'max_candidates' | 'bounded_edges';

export interface RankedNaturalCycleCandidateV3 extends NaturalCycleCandidateV3 {
  naturalKm: number;
  pavedKm: number;
  nodeCount: number;
  originalEdgeCount: number;
  basisMethod: RankedNaturalCycleBasisMethodV3;
}

export interface RankedNaturalCyclesDiagnosticsV3 {
  candidateCount: number;
  selectedCycleId: string | null;
  lengthKm: number;
  naturalKm: number;
  pavedKm: number;
  nodeCount: number;
  originalEdgeCount: number;
  basisMethod: RankedNaturalCycleBasisMethodV3;
  pruningReason: RankedNaturalCyclePruningReasonV3;
  rejectedMicroCycles: number;
  jaccardDedupCount: number;
  runtimeMs: number;
}

export interface RankedNaturalCycleExtractorInputV3 {
  graph: EnrichedGraph;
  targetComponentIds: TerrainComponentKindV3[];
  minUsefulCycleKm?: number;
  targetDistanceKm?: number;
  maxCandidates?: number;
  maxBackEdges?: number;
  maxEdges?: number;
  includePavedWithinNaturalContext?: boolean;
}

export interface RankedNaturalCycleExtractorResultV3 {
  cycles: RankedNaturalCycleCandidateV3[];
  diagnostics: RankedNaturalCyclesDiagnosticsV3;
}

interface RawCycleV3 {
  originalNodeIds: string[];
  originalEdgeIds: string[];
  naturalKm: number;
  pavedKm: number;
  lengthKm: number;
}

interface TreeStateV3 {
  parentNodeId: string | null;
  parentEdgeId: string | null;
  depth: number;
}

export function extractRankedNaturalCyclesV3(input: RankedNaturalCycleExtractorInputV3): RankedNaturalCycleExtractorResultV3 {
  const startedAt = Date.now();
  const minUsefulCycleKm = input.minUsefulCycleKm ?? 1.5;
  const maxCandidates = input.maxCandidates ?? 24;
  const maxBackEdges = input.maxBackEdges ?? 160;
  const maxEdges = input.maxEdges ?? 4000;
  const targetDistanceKm = input.targetDistanceKm ?? 8;
  const adjacency = buildCycleAdjacency(input);
  const uniqueEdges = uniqueEdgeIds(adjacency);

  let pruningReason: RankedNaturalCyclePruningReasonV3 = 'none';
  if (uniqueEdges.size > maxEdges) pruningReason = 'bounded_edges';

  const rawCycles: RawCycleV3[] = [];
  let rejectedMicroCycles = 0;
  let backEdgesVisited = 0;
  const state = new Map<string, TreeStateV3>();
  const visited = new Set<string>();
  const treeEdgeIds = new Set<string>();
  const seenBackEdgeIds = new Set<string>();

  for (const root of Array.from(adjacency.keys()).sort()) {
    if (visited.has(root)) continue;
    state.set(root, { parentNodeId: null, parentEdgeId: null, depth: 0 });
    const stack = [root];
    while (stack.length > 0) {
      const nodeId = stack.pop();
      if (!nodeId || visited.has(nodeId)) continue;
      visited.add(nodeId);
      const edges = (adjacency.get(nodeId) ?? [])
        .filter((edge) => uniqueEdges.has(edge.edge.id))
        .sort((a, b) => a.edge.id.localeCompare(b.edge.id));
      for (const edge of edges) {
        const currentState = state.get(nodeId);
        if (edge.edge.id === currentState?.parentEdgeId) continue;
        if (!state.has(edge.to)) {
          treeEdgeIds.add(edge.edge.id);
          state.set(edge.to, { parentNodeId: nodeId, parentEdgeId: edge.edge.id, depth: (currentState?.depth ?? 0) + 1 });
          stack.push(edge.to);
          continue;
        }
        if (treeEdgeIds.has(edge.edge.id) || seenBackEdgeIds.has(edge.edge.id)) continue;
        seenBackEdgeIds.add(edge.edge.id);
        backEdgesVisited += 1;
        if (backEdgesVisited > maxBackEdges) {
          pruningReason = 'max_back_edges';
          break;
        }
        const cycle = cycleFromBackEdge(nodeId, edge.to, edge, state, input.graph);
        if (!cycle) continue;
        if (cycle.lengthKm < minUsefulCycleKm) {
          rejectedMicroCycles += 1;
          continue;
        }
        rawCycles.push(cycle);
        rawCycles.push({ ...cycle, originalEdgeIds: [...cycle.originalEdgeIds], originalNodeIds: [...cycle.originalNodeIds] });
      }
      if (backEdgesVisited > maxBackEdges) break;
    }
  }

  const { cycles, dedupCount } = rankAndDedupCycles(rawCycles, targetDistanceKm, maxCandidates);
  if (cycles.length === 0 && pruningReason === 'none') pruningReason = 'no_useful_cycle';
  if (rawCycles.length > maxCandidates && pruningReason === 'none') pruningReason = 'max_candidates';
  const selected = cycles[0] ?? null;
  return {
    cycles,
    diagnostics: {
      candidateCount: cycles.length,
      selectedCycleId: selected?.id ?? null,
      lengthKm: selected?.lengthKm ?? 0,
      naturalKm: selected?.naturalKm ?? 0,
      pavedKm: selected?.pavedKm ?? 0,
      nodeCount: selected?.nodeCount ?? 0,
      originalEdgeCount: selected?.originalEdgeCount ?? 0,
      basisMethod: 'spanning_tree_back_edges',
      pruningReason,
      rejectedMicroCycles,
      jaccardDedupCount: dedupCount,
      runtimeMs: Date.now() - startedAt,
    },
  };
}

function buildCycleAdjacency(input: RankedNaturalCycleExtractorInputV3): Map<string, DirectedRankedCycleEdgeV3[]> {
  const targetComponents = new Set(input.targetComponentIds);
  const adjacency = new Map<string, DirectedRankedCycleEdgeV3[]>();
  for (const nodeId of Array.from(input.graph.nodes.keys())) adjacency.set(nodeId, []);
  for (const edge of Array.from(input.graph.edges.values())) {
    const surface = routeSurface(edge);
    const kind = componentKind(edge);
    const naturalContext = edge.terrainContext?.landcoverClass === 'forest' || edge.terrainContext?.landcoverClass === 'park';
    const eligible = targetComponents.has(kind)
      || (input.includePavedWithinNaturalContext === true && naturalContext);
    if (!eligible) continue;
    adjacency.get(edge.from)?.push({ edge, from: edge.from, to: edge.to, kind, surface });
    adjacency.get(edge.to)?.push({ edge, from: edge.to, to: edge.from, kind, surface });
  }
  return new Map(Array.from(adjacency.entries()).filter(([, edges]) => edges.length > 0));
}

function cycleFromBackEdge(
  fromNodeId: string,
  toNodeId: string,
  backEdge: DirectedRankedCycleEdgeV3,
  state: Map<string, TreeStateV3>,
  graph: EnrichedGraph,
): RawCycleV3 | null {
  const left = ancestors(fromNodeId, state);
  const right = ancestors(toNodeId, state);
  const rightPositions = new Map(right.map((step, index) => [step.nodeId, index]));
  const lcaIndex = left.findIndex((step) => rightPositions.has(step.nodeId));
  if (lcaIndex < 0) return null;
  const lcaNode = left[lcaIndex]?.nodeId;
  if (!lcaNode) return null;
  const rightLcaIndex = rightPositions.get(lcaNode);
  if (rightLcaIndex === undefined) return null;

  const leftToLca = left.slice(0, lcaIndex);
  const toToLca = right.slice(0, rightLcaIndex);
  const lcaToTo = [...toToLca].reverse();
  const nodeIds = [fromNodeId];
  const edgeIds: string[] = [];

  for (const step of leftToLca) {
    if (!step.parentEdgeId || !step.parentNodeId) return null;
    edgeIds.push(step.parentEdgeId);
    nodeIds.push(step.parentNodeId);
  }
  const reversedEdgeIds: string[] = [];
  for (const step of lcaToTo) {
    if (!step.parentEdgeId) return null;
    reversedEdgeIds.push(step.parentEdgeId);
    nodeIds.push(step.nodeId);
  }
  edgeIds.push(...reversedEdgeIds, backEdge.edge.id);
  nodeIds.push(fromNodeId);

  if (new Set(edgeIds).size !== edgeIds.length || edgeIds.length < 3) return null;
  if (new Set(nodeIds.slice(0, -1)).size !== nodeIds.length - 1) return null;
  if (!isContinuousCycle(nodeIds, edgeIds, graph)) return null;

  let naturalKm = 0;
  let pavedKm = 0;
  let lengthKm = 0;
  for (const edgeId of edgeIds) {
    const edge = graph.edges.get(edgeId);
    if (!edge) return null;
    const length = Math.max(0, edge.lengthKm);
    lengthKm += length;
    const semantics = classifyEdgeSemanticsV3(edge);
    pavedKm += length * semantics.pavedEquivalentWeight;
    naturalKm += length * semantics.candidateNaturalWeight;
  }
  return {
    originalNodeIds: canonicalizeClosedNodeCycle(nodeIds, edgeIds, graph).nodeIds,
    originalEdgeIds: canonicalizeClosedNodeCycle(nodeIds, edgeIds, graph).edgeIds,
    naturalKm: round(naturalKm),
    pavedKm: round(pavedKm),
    lengthKm: round(lengthKm),
  };
}

function ancestors(nodeId: string, state: Map<string, TreeStateV3>): Array<{ nodeId: string; parentNodeId: string | null; parentEdgeId: string | null; depth: number }> {
  const result: Array<{ nodeId: string; parentNodeId: string | null; parentEdgeId: string | null; depth: number }> = [];
  let current: string | null = nodeId;
  while (current) {
    const currentState = state.get(current);
    if (!currentState) break;
    result.push({ nodeId: current, ...currentState });
    current = currentState.parentNodeId;
  }
  return result;
}

function canonicalizeClosedNodeCycle(nodeIds: string[], edgeIds: string[], graph: EnrichedGraph): { nodeIds: string[]; edgeIds: string[] } {
  const edgeOnlyRotations = edgeIds.map((_, index) => rotateCycle(nodeIds, edgeIds, index, graph));
  const reversedNodes = [...nodeIds].reverse();
  const reversedEdges = [...edgeIds].reverse();
  const reversedRotations = edgeIds.map((_, index) => rotateCycle(reversedNodes, reversedEdges, index, graph));
  return [...edgeOnlyRotations, ...reversedRotations].sort((a, b) => a.nodeIds.join('\u0000').localeCompare(b.nodeIds.join('\u0000')) || a.edgeIds.join('\u0000').localeCompare(b.edgeIds.join('\u0000')))[0];
}

function rotateCycle(nodeIds: string[], edgeIds: string[], index: number, graph: EnrichedGraph): { nodeIds: string[]; edgeIds: string[] } {
  const openNodes = nodeIds.slice(0, -1);
  const rotatedEdges = [...edgeIds.slice(index), ...edgeIds.slice(0, index)];
  let current = openNodes[index] ?? openNodes[0];
  const rotatedNodes = [current];
  for (const edgeId of rotatedEdges) {
    const edge = graph.edges.get(edgeId);
    if (!edge || !current) break;
    current = edge.from === current ? edge.to : edge.from;
    rotatedNodes.push(current);
  }
  return { nodeIds: rotatedNodes, edgeIds: rotatedEdges };
}

function rankAndDedupCycles(rawCycles: RawCycleV3[], targetDistanceKm: number, maxCandidates: number): { cycles: RankedNaturalCycleCandidateV3[]; dedupCount: number } {
  const scored = rawCycles
    .map((cycle) => {
      const lengthFit = Math.min(cycle.lengthKm, targetDistanceKm * 0.8) * 100 - Math.max(0, cycle.lengthKm - targetDistanceKm) * 15;
      const naturalReward = cycle.naturalKm * 45;
      const pavedPenalty = cycle.pavedKm * 90;
      const microPenalty = cycle.lengthKm < 2 ? 1000 : 0;
      const simplicityPenalty = Math.max(0, cycle.originalEdgeIds.length - 64) * 0.5;
      return { cycle, score: round(lengthFit + naturalReward - pavedPenalty - microPenalty - simplicityPenalty) };
    })
    .sort((a, b) => b.score - a.score || b.cycle.lengthKm - a.cycle.lengthKm || a.cycle.originalEdgeIds.join(',').localeCompare(b.cycle.originalEdgeIds.join(',')));

  const kept: RankedNaturalCycleCandidateV3[] = [];
  let dedupCount = 0;
  for (const { cycle, score } of scored) {
    const edgeSet = new Set(cycle.originalEdgeIds);
    const duplicate = kept.some((existing) => jaccard(new Set(existing.originalEdgeIds), edgeSet) >= 0.6);
    if (duplicate) {
      dedupCount += 1;
      continue;
    }
    kept.push({
      id: `ranked-cycle-${kept.length + 1}`,
      originalNodeIds: cycle.originalNodeIds,
      originalEdgeIds: cycle.originalEdgeIds,
      lengthKm: cycle.lengthKm,
      naturalKm: cycle.naturalKm,
      pavedKm: cycle.pavedKm,
      corridorIds: [],
      qualityScore: score,
      nodeCount: Math.max(0, cycle.originalNodeIds.length - 1),
      originalEdgeCount: cycle.originalEdgeIds.length,
      basisMethod: 'spanning_tree_back_edges',
    });
    if (kept.length >= maxCandidates) break;
  }
  return { cycles: kept, dedupCount };
}

function isContinuousCycle(nodeIds: string[], edgeIds: string[], graph: EnrichedGraph): boolean {
  if (nodeIds.length !== edgeIds.length + 1 || nodeIds[0] !== nodeIds.at(-1)) return false;
  for (let index = 0; index < edgeIds.length; index += 1) {
    const edge = graph.edges.get(edgeIds[index]);
    const from = nodeIds[index];
    const to = nodeIds[index + 1];
    if (!edge || !from || !to) return false;
    if (!((edge.from === from && edge.to === to) || (edge.from === to && edge.to === from))) return false;
  }
  return true;
}

function uniqueEdgeIds(adjacency: Map<string, DirectedRankedCycleEdgeV3[]>): Set<string> {
  return new Set(Array.from(adjacency.values()).flat().map((edge) => edge.edge.id));
}

function jaccard(a: Set<string>, b: Set<string>): number {
  const union = new Set([...Array.from(a), ...Array.from(b)]);
  const intersection = Array.from(a).filter((value) => b.has(value)).length;
  return union.size === 0 ? 0 : intersection / union.size;
}

function routeSurface(edge: EnrichedEdge): RouteSurfaceV3 {
  return classifyEdgeSemanticsV3(edge).routeSurface;
}

function componentKind(edge: EnrichedEdge): TerrainComponentKindV3 {
  return classifyEdgeSemanticsV3(edge).componentKind;
}

function round(value: number): number {
  return Number.isFinite(value) ? Math.round(value * 1000) / 1000 : 0;
}
