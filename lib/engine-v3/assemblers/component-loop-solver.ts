import type { EnrichedEdge, EnrichedGraph } from '../../types';
import type { RouteSurfaceV3, TerrainComponentKindV3 } from '../types';
import { buildTargetComponentTraversal } from './target-component-traversal';
import { contractNaturalGraphV3 } from './natural-graph-contraction';
import type { NaturalGraphContractionDiagnosticsV3 } from './natural-graph-contraction';
import { buildOrderedCycleExpansionV3 } from './ordered-cycle-expansion';
import type { OrderedCycleExpansionDiagnosticsV3 } from './ordered-cycle-expansion';

const PAVED_SURFACES = new Set(['asphalt', 'concrete', 'paved', 'paving_stones', 'sett', 'cobblestone', 'compacted']);
const NATURAL_SURFACES = new Set(['dirt', 'earth', 'grass', 'ground', 'gravel', 'mud', 'sand', 'soil', 'unpaved', 'woodchips']);
const ROAD_LIKE_HIGHWAYS = new Set(['secondary', 'tertiary', 'unclassified', 'residential', 'living_street', 'service']);
const PATH_LIKE_HIGHWAYS = new Set(['path', 'track', 'footway', 'bridleway', 'pedestrian']);

interface DirectedComponentLoopEdgeV3 {
  edge: EnrichedEdge;
  from: string;
  to: string;
  kind: TerrainComponentKindV3;
  surface: RouteSurfaceV3;
}

export type ComponentLoopFailureReasonV3 =
  | 'no_access'
  | 'no_dwell'
  | 'no_clean_closure'
  | 'excessive_paved_closure'
  | 'insufficient_distance_after_dwell';

type ComponentLoopFailedPhaseV3 = 'accessPhase' | 'dwellPhase' | 'recoveryPhase' | 'closurePhase' | 'finalGate' | null;

export interface ComponentLoopSolverInputV3 {
  graph: EnrichedGraph;
  startNodeId: string;
  targetComponentIds: TerrainComponentKindV3[];
  targetDistanceKm: number;
  requestedNaturalDwellKm: number;
  minDistanceRatio?: number;
  maxDistanceRatio?: number;
  allowConnectorRepeatClosure?: boolean;
}

export interface ComponentLoopCandidateSummaryV3 {
  componentId: string;
  entryNodeId: string;
  accessKm: number;
  accessPavedKm: number;
  reachableTargetKm: number;
  cleanExploitableKm: number;
  naturalDwellKm: number;
  internalDistanceKm: number;
  closureKm: number;
  closurePavedKm: number;
  connectorRepeatKm: number;
  targetRepeatKm: number;
  status: 'success' | 'failure';
  reason: string | null;
}

export interface ComponentLoopSolverDiagnosticsV3 {
  selectedComponentId: string | null;
  componentReachableTargetKm: number;
  componentCleanExploitableKm: number;
  accessCandidates: { count: number; top: ComponentLoopCandidateSummaryV3[] };
  dwellCandidates: { count: number; top: ComponentLoopCandidateSummaryV3[] };
  closureCandidates: { count: number; top: ComponentLoopCandidateSummaryV3[] };
  failedPhase: ComponentLoopFailedPhaseV3;
  topComponentLoopCandidates: ComponentLoopCandidateSummaryV3[];
  naturalGraphContraction: NaturalGraphContractionDiagnosticsV3;
  orderedCycleExpansion?: OrderedCycleExpansionDiagnosticsV3;
}

export interface ComponentLoopSolverMetricsV3 {
  distanceKm: number;
  accessKm: number;
  accessPavedKm: number;
  internalDistanceKm: number;
  naturalDwellKm: number;
  recoveryKm: number;
  closureKm: number;
  closurePavedKm: number;
  pavedKm: number;
  targetRepeatKm: number;
  connectorRepeatKm: number;
}

export interface ComponentLoopSolverSuccessV3 {
  status: 'success';
  edgeIds: string[];
  nodeIds: string[];
  metrics: ComponentLoopSolverMetricsV3;
  diagnostics: ComponentLoopSolverDiagnosticsV3;
}

export interface ComponentLoopSolverFailureV3 {
  status: 'failure';
  reason: ComponentLoopFailureReasonV3;
  edgeIds: string[];
  nodeIds: string[];
  metrics: ComponentLoopSolverMetricsV3;
  diagnostics: ComponentLoopSolverDiagnosticsV3;
}

export type ComponentLoopSolverResultV3 = ComponentLoopSolverSuccessV3 | ComponentLoopSolverFailureV3;

interface TargetGraphComponentV3 {
  componentId: string;
  nodeIds: Set<string>;
  edgeIds: Set<string>;
  reachableTargetKm: number;
}

interface EvaluatedComponentLoopCandidateV3 {
  component: TargetGraphComponentV3;
  accessTraversal: DirectedComponentLoopEdgeV3[];
  entryNodeId: string;
  traversal: ReturnType<typeof buildTargetComponentTraversal>;
  componentStatus: 'success' | 'failure';
  componentReason: string | null;
  summary: ComponentLoopCandidateSummaryV3;
  edgeIds: string[];
  nodeIds: string[];
  metrics: ComponentLoopSolverMetricsV3;
}

export function solveComponentLoopV3(input: ComponentLoopSolverInputV3): ComponentLoopSolverResultV3 {
  const minDistanceRatio = input.minDistanceRatio ?? 0.7;
  const maxDistanceRatio = input.maxDistanceRatio ?? 1.15;
  const allowConnectorRepeatClosure = input.allowConnectorRepeatClosure ?? true;
  const adjacency = buildAdjacency(input.graph);
  const naturalGraphContraction = contractNaturalGraphV3({
    graph: input.graph,
    targetComponentIds: input.targetComponentIds,
    startNodeId: input.startNodeId,
    minUsefulCycleKm: Math.max(1.5, input.requestedNaturalDwellKm * 0.45),
  });
  const orderedCycleExpansion = buildOrderedCycleExpansionV3({
    graph: input.graph,
    startNodeId: input.startNodeId,
    contraction: naturalGraphContraction,
    targetComponentIds: input.targetComponentIds,
    targetDistanceKm: input.targetDistanceKm,
  });
  const components = targetComponentsFromGraph(adjacency, input.targetComponentIds);
  const accessCandidates = components
    .map((component) => {
      const accessTraversal = shortestAccessTraversalToComponent(input.startNodeId, component.nodeIds, adjacency);
      if (!accessTraversal && !component.nodeIds.has(input.startNodeId)) return null;
      return {
        component,
        accessTraversal: accessTraversal ?? [],
        entryNodeId: accessTraversal?.at(-1)?.to ?? input.startNodeId,
      };
    })
    .filter((candidate): candidate is NonNullable<typeof candidate> => candidate !== null);

  const evaluated = accessCandidates
    .map(({ component, accessTraversal, entryNodeId }) => evaluateCandidate(input, component, accessTraversal, entryNodeId, minDistanceRatio, maxDistanceRatio))
    .sort((a, b) => candidateScore(b, input) - candidateScore(a, input));

  const selected = evaluated[0] ?? null;
  const successful = evaluated.find((candidate) =>
    candidate.componentStatus === 'success' &&
    candidate.metrics.naturalDwellKm + 0.001 >= input.requestedNaturalDwellKm &&
    (allowConnectorRepeatClosure || candidate.metrics.connectorRepeatKm <= 0.001),
  ) ?? null;

  const orderedCycleSummary = orderedCycleExpansion.status === 'success'
    ? summaryFromOrderedCycle(orderedCycleExpansion.metrics)
    : null;

  const diagnosticsFor = (failedPhase: ComponentLoopFailedPhaseV3, preferOrderedCycle = false): ComponentLoopSolverDiagnosticsV3 => ({
    selectedComponentId: preferOrderedCycle ? 'ordered-cycle-core' : selected?.component.componentId ?? null,
    componentReachableTargetKm: preferOrderedCycle ? orderedCycleExpansion.metrics.naturalCycleKm : selected?.component.reachableTargetKm ?? 0,
    componentCleanExploitableKm: preferOrderedCycle ? orderedCycleExpansion.metrics.naturalCycleKm : selected?.traversal.diagnostics.exploitableTargetKm ?? 0,
    accessCandidates: { count: accessCandidates.length + (orderedCycleSummary ? 1 : 0), top: [...(preferOrderedCycle && orderedCycleSummary ? [orderedCycleSummary] : []), ...evaluated.map((candidate) => candidate.summary), ...(!preferOrderedCycle && orderedCycleSummary ? [orderedCycleSummary] : [])].slice(0, 8) },
    dwellCandidates: {
      count: evaluated.filter((candidate) => candidate.traversal.diagnostics.targetDistanceKm + 0.001 >= input.requestedNaturalDwellKm).length + (orderedCycleExpansion.status === 'success' && orderedCycleExpansion.metrics.naturalCycleKm + 0.001 >= input.requestedNaturalDwellKm ? 1 : 0),
      top: [
        ...(preferOrderedCycle && orderedCycleSummary && orderedCycleExpansion.metrics.naturalCycleKm + 0.001 >= input.requestedNaturalDwellKm ? [orderedCycleSummary] : []),
        ...evaluated
          .filter((candidate) => candidate.traversal.diagnostics.targetDistanceKm + 0.001 >= input.requestedNaturalDwellKm)
          .map((candidate) => candidate.summary),
        ...(!preferOrderedCycle && orderedCycleSummary && orderedCycleExpansion.metrics.naturalCycleKm + 0.001 >= input.requestedNaturalDwellKm ? [orderedCycleSummary] : []),
      ].slice(0, 8),
    },
    closureCandidates: {
      count: evaluated.filter((candidate) => candidate.componentStatus === 'success').length + (orderedCycleExpansion.status === 'success' ? 1 : 0),
      top: [...(preferOrderedCycle && orderedCycleSummary ? [orderedCycleSummary] : []), ...evaluated.filter((candidate) => candidate.componentStatus === 'success').map((candidate) => candidate.summary), ...(!preferOrderedCycle && orderedCycleSummary ? [orderedCycleSummary] : [])].slice(0, 8),
    },
    failedPhase,
    topComponentLoopCandidates: [...(preferOrderedCycle && orderedCycleSummary ? [orderedCycleSummary] : []), ...evaluated.map((candidate) => candidate.summary), ...(!preferOrderedCycle && orderedCycleSummary ? [orderedCycleSummary] : [])].slice(0, 12),
    naturalGraphContraction: naturalGraphContraction.diagnostics,
    orderedCycleExpansion: orderedCycleExpansion.diagnostics,
  });

  const orderedCycleQualifies = orderedCycleExpansion.status === 'success'
    && orderedCycleExpansion.metrics.naturalCycleKm + 0.001 >= input.requestedNaturalDwellKm
    && orderedCycleExpansion.metrics.distanceKm + 0.001 >= input.targetDistanceKm * minDistanceRatio
    && orderedCycleExpansion.metrics.distanceKm <= input.targetDistanceKm * maxDistanceRatio + 0.001
    && orderedCycleExpansion.metrics.targetRepeatKm <= 0.001;
  const orderedCycleMateriallyImproves = orderedCycleExpansion.status === 'success' && (!successful
    || orderedCycleExpansion.metrics.naturalCycleKm > successful.metrics.naturalDwellKm + 0.25
    || orderedCycleExpansion.metrics.distanceKm > successful.metrics.distanceKm + 0.5
    || orderedCycleExpansion.metrics.pavedKm + 0.25 < successful.metrics.pavedKm);

  if (orderedCycleQualifies && orderedCycleMateriallyImproves) {
    return {
      status: 'success',
      edgeIds: orderedCycleExpansion.edgeIds,
      nodeIds: orderedCycleExpansion.nodeIds,
      metrics: metricsFromOrderedCycle(orderedCycleExpansion.metrics),
      diagnostics: diagnosticsFor(null, true),
    };
  }

  if (successful) {
    return {
      status: 'success',
      edgeIds: successful.edgeIds,
      nodeIds: successful.nodeIds,
      metrics: successful.metrics,
      diagnostics: diagnosticsFor(null),
    };
  }

  const reason = failureReason(evaluated, input, allowConnectorRepeatClosure);
  return {
    status: 'failure',
    reason,
    edgeIds: selected?.edgeIds ?? [],
    nodeIds: selected?.nodeIds ?? [input.startNodeId],
    metrics: selected?.metrics ?? emptyMetrics(),
    diagnostics: diagnosticsFor(failedPhase(reason)),
  };
}

function evaluateCandidate(
  input: ComponentLoopSolverInputV3,
  component: TargetGraphComponentV3,
  accessTraversal: DirectedComponentLoopEdgeV3[],
  entryNodeId: string,
  minDistanceRatio: number,
  maxDistanceRatio: number,
): EvaluatedComponentLoopCandidateV3 {
  const traversal = buildTargetComponentTraversal({
    graph: input.graph,
    startNodeId: input.startNodeId,
    entryNodeId,
    targetComponentIds: input.targetComponentIds,
    targetDistanceKm: input.targetDistanceKm,
    minDistanceRatio,
    maxDistanceRatio,
    usedEdgeKeys: new Set(accessTraversal.map((edge) => edge.edge.id)),
    forbidTargetRepeat: true,
  });
  const adjacency = adjacencyFromGraph(input.graph);
  const componentLoop = buildComponentLoopTraversal({ input, component, accessTraversal, entryNodeId, adjacency, minDistanceRatio, maxDistanceRatio });
  const fallbackTraversalEdgeIds = traversal.status === 'success' ? traversal.edgeIds : [];
  const edgeIds = componentLoop.edgeIds.length > 0
    ? componentLoop.edgeIds
    : [...accessTraversal.map((edge) => edge.edge.id), ...fallbackTraversalEdgeIds];
  const directedEdges = edgeIdsToDirectedTraversal(input.startNodeId, edgeIds, input.graph, adjacency);
  const nodeIds = nodesFromDirectedEdges(input.startNodeId, directedEdges);
  const metrics = componentLoop.edgeIds.length > 0
    ? metricsFromPhases(componentLoop.access, componentLoop.internal, componentLoop.closure, input.targetComponentIds)
    : metricsFromDirectedEdges(accessTraversal.length, directedEdges, traversal);
  const componentStatus = componentLoop.status;
  const reason = componentLoop.reason === 'no_dwell' && traversal.status === 'failure'
    ? traversal.diagnostics.blocker
    : componentLoop.reason ?? (traversal.status === 'failure' ? traversal.diagnostics.blocker : null);
  const summary: ComponentLoopCandidateSummaryV3 = {
    componentId: component.componentId,
    entryNodeId,
    accessKm: round(sumDirectedLengths(accessTraversal)),
    accessPavedKm: round(sumPaved(accessTraversal)),
    reachableTargetKm: round(component.reachableTargetKm),
    cleanExploitableKm: Math.max(traversal.diagnostics.exploitableTargetKm, component.reachableTargetKm),
    naturalDwellKm: metrics.naturalDwellKm,
    internalDistanceKm: metrics.internalDistanceKm,
    closureKm: metrics.closureKm,
    closurePavedKm: metrics.closurePavedKm,
    connectorRepeatKm: metrics.connectorRepeatKm,
    targetRepeatKm: metrics.targetRepeatKm,
    status: componentStatus,
    reason,
  };
  return { component, accessTraversal, entryNodeId, traversal, componentStatus, componentReason: reason, summary, edgeIds, nodeIds, metrics };
}

function candidateScore(candidate: EvaluatedComponentLoopCandidateV3, input: ComponentLoopSolverInputV3): number {
  const minDistanceKm = input.targetDistanceKm * 0.7;
  const successBonus = candidate.componentStatus === 'success' ? 10_000 : 0;
  const distanceProgress = Math.min(candidate.metrics.distanceKm, minDistanceKm) * 140;
  const dwellProgress = Math.min(candidate.metrics.naturalDwellKm, input.requestedNaturalDwellKm) * 160;
  const closureBonus = candidate.metrics.closureKm > 0 ? 250 : 0;
  const capacityBonus = Math.min(candidate.traversal.diagnostics.exploitableTargetKm, input.targetDistanceKm * 2) * 3;
  const repeatPenalty = candidate.metrics.targetRepeatKm * 300 + candidate.metrics.connectorRepeatKm * 30;
  const pavedPenalty = (candidate.metrics.accessPavedKm + candidate.metrics.closurePavedKm) * 12;
  const accessPenalty = candidate.metrics.accessKm * 8;
  return successBonus + distanceProgress + dwellProgress + closureBonus + capacityBonus - repeatPenalty - pavedPenalty - accessPenalty;
}

function summaryFromOrderedCycle(metrics: ReturnType<typeof buildOrderedCycleExpansionV3>['metrics']): ComponentLoopCandidateSummaryV3 {
  return {
    componentId: 'ordered-cycle-core',
    entryNodeId: 'ordered-cycle-entry',
    accessKm: metrics.accessKm,
    accessPavedKm: Math.max(0, metrics.pavedKm - metrics.closureKm - Math.max(0, metrics.cycleKm - metrics.naturalCycleKm)),
    reachableTargetKm: metrics.naturalCycleKm,
    cleanExploitableKm: metrics.naturalCycleKm,
    naturalDwellKm: metrics.naturalCycleKm,
    internalDistanceKm: metrics.cycleKm,
    closureKm: metrics.closureKm,
    closurePavedKm: Math.min(metrics.closureKm, metrics.pavedKm),
    connectorRepeatKm: metrics.connectorRepeatKm,
    targetRepeatKm: metrics.targetRepeatKm,
    status: 'success',
    reason: null,
  };
}

function metricsFromOrderedCycle(metrics: ReturnType<typeof buildOrderedCycleExpansionV3>['metrics']): ComponentLoopSolverMetricsV3 {
  return {
    distanceKm: metrics.distanceKm,
    accessKm: metrics.accessKm,
    accessPavedKm: Math.max(0, metrics.pavedKm - metrics.closureKm - Math.max(0, metrics.cycleKm - metrics.naturalCycleKm)),
    internalDistanceKm: metrics.cycleKm,
    naturalDwellKm: metrics.naturalCycleKm,
    recoveryKm: 0,
    closureKm: metrics.closureKm,
    closurePavedKm: Math.min(metrics.closureKm, metrics.pavedKm),
    pavedKm: metrics.pavedKm,
    targetRepeatKm: metrics.targetRepeatKm,
    connectorRepeatKm: metrics.connectorRepeatKm,
  };
}

function failureReason(
  evaluated: EvaluatedComponentLoopCandidateV3[],
  input: ComponentLoopSolverInputV3,
  allowConnectorRepeatClosure: boolean,
): ComponentLoopFailureReasonV3 {
  if (evaluated.length === 0) return 'no_access';
  const hasDwell = evaluated.some((candidate) => candidate.metrics.naturalDwellKm + 0.001 >= input.requestedNaturalDwellKm);
  if (!hasDwell) return 'no_dwell';
  const hasClosureBlockedByConnectorRepeat = evaluated.some((candidate) => candidate.traversal.diagnostics.closureDistanceKm > 0.001);
  if (!allowConnectorRepeatClosure && hasClosureBlockedByConnectorRepeat) return 'no_clean_closure';
  const hasCleanClosure = evaluated.some((candidate) => candidate.componentStatus === 'success');
  if (!hasCleanClosure) return 'no_clean_closure';
  return 'insufficient_distance_after_dwell';
}

function failedPhase(reason: ComponentLoopFailureReasonV3): ComponentLoopFailedPhaseV3 {
  if (reason === 'no_access') return 'accessPhase';
  if (reason === 'no_dwell') return 'dwellPhase';
  if (reason === 'no_clean_closure' || reason === 'excessive_paved_closure') return 'closurePhase';
  return 'finalGate';
}

interface BuiltComponentLoopTraversalV3 {
  status: 'success' | 'failure';
  reason: string | null;
  edgeIds: string[];
  access: DirectedComponentLoopEdgeV3[];
  internal: DirectedComponentLoopEdgeV3[];
  closure: DirectedComponentLoopEdgeV3[];
}

function buildComponentLoopTraversal({
  input,
  component,
  accessTraversal,
  entryNodeId,
  adjacency,
  minDistanceRatio,
  maxDistanceRatio,
}: {
  input: ComponentLoopSolverInputV3;
  component: TargetGraphComponentV3;
  accessTraversal: DirectedComponentLoopEdgeV3[];
  entryNodeId: string;
  adjacency: Map<string, DirectedComponentLoopEdgeV3[]>;
  minDistanceRatio: number;
  maxDistanceRatio: number;
}): BuiltComponentLoopTraversalV3 {
  const minDistanceKm = input.targetDistanceKm * minDistanceRatio;
  const maxDistanceKm = input.targetDistanceKm * maxDistanceRatio;
  const accessKm = sumDirectedLengths(accessTraversal);
  const dwellTargetKm = Math.min(
    Math.max(input.requestedNaturalDwellKm, input.targetDistanceKm * 0.72),
    Math.max(input.requestedNaturalDwellKm, maxDistanceKm - accessKm - 0.5),
  );
  const internal = buildInternalDwellTraversal(entryNodeId, component.edgeIds, adjacency, dwellTargetKm);
  const internalKm = sumDirectedLengths(internal);
  if (internal.length === 0) {
    return { status: 'failure', reason: 'no_dwell', edgeIds: [...accessTraversal, ...internal].map((edge) => edge.edge.id), access: accessTraversal, internal, closure: [] };
  }

  const usedTargetEdgeIds = new Set(internal.map((edge) => edge.edge.id));
  const usedConnectorEdgeIds = new Set(accessTraversal.map((edge) => edge.edge.id));
  const closureBudgetKm = maxDistanceKm - accessKm - internalKm;
  const closure = shortestClosureTraversal(internal.at(-1)?.to ?? entryNodeId, input.startNodeId, adjacency, input.targetComponentIds, usedTargetEdgeIds, usedConnectorEdgeIds, closureBudgetKm, input.allowConnectorRepeatClosure ?? true);
  if (closure.length === 0) {
    return { status: 'failure', reason: 'no_clean_closure', edgeIds: [...accessTraversal, ...internal].map((edge) => edge.edge.id), access: accessTraversal, internal, closure: [] };
  }

  const totalKm = accessKm + internalKm + sumDirectedLengths(closure);
  if (totalKm + 0.001 < minDistanceKm) {
    return { status: 'failure', reason: 'insufficient_distance_after_dwell', edgeIds: [...accessTraversal, ...internal, ...closure].map((edge) => edge.edge.id), access: accessTraversal, internal, closure };
  }

  return { status: 'success', reason: null, edgeIds: [...accessTraversal, ...internal, ...closure].map((edge) => edge.edge.id), access: accessTraversal, internal, closure };
}

function buildInternalDwellTraversal(
  entryNodeId: string,
  componentEdgeIds: Set<string>,
  adjacency: Map<string, DirectedComponentLoopEdgeV3[]>,
  targetKm: number,
): DirectedComponentLoopEdgeV3[] {
  const beamWidth = 96;
  let frontier: Array<{ current: string; traversal: DirectedComponentLoopEdgeV3[]; usedEdgeIds: Set<string>; usedPairs: Set<string>; distanceKm: number }> = [
    { current: entryNodeId, traversal: [], usedEdgeIds: new Set(), usedPairs: new Set(), distanceKm: 0 },
  ];
  let best = frontier[0];

  for (let step = 0; step < Math.min(512, componentEdgeIds.size) && frontier.length > 0; step += 1) {
    const expanded: typeof frontier = [];
    for (const state of frontier) {
      if (state.distanceKm > best.distanceKm) best = state;
      if (state.distanceKm >= targetKm) return state.traversal;
      const nextEdges = (adjacency.get(state.current) ?? [])
        .filter((edge) => componentEdgeIds.has(edge.edge.id) && edge.surface !== 'paved' && !state.usedEdgeIds.has(edge.edge.id) && !state.usedPairs.has(edgePairKey(edge)))
        .sort((a, b) => unusedTargetDegree(b.to, componentEdgeIds, state.usedEdgeIds, adjacency) - unusedTargetDegree(a.to, componentEdgeIds, state.usedEdgeIds, adjacency));
      for (const edge of nextEdges.slice(0, 8)) {
        const usedEdgeIds = new Set(state.usedEdgeIds);
        const usedPairs = new Set(state.usedPairs);
        usedEdgeIds.add(edge.edge.id);
        usedPairs.add(edgePairKey(edge));
        expanded.push({
          current: edge.to,
          traversal: [...state.traversal, edge],
          usedEdgeIds,
          usedPairs,
          distanceKm: state.distanceKm + Math.max(0, edge.edge.lengthKm),
        });
      }
    }
    frontier = expanded
      .sort((a, b) => b.distanceKm - a.distanceKm || unusedTargetDegree(b.current, componentEdgeIds, b.usedEdgeIds, adjacency) - unusedTargetDegree(a.current, componentEdgeIds, a.usedEdgeIds, adjacency))
      .slice(0, beamWidth);
  }

  return best.traversal;
}

function unusedTargetDegree(
  nodeId: string,
  componentEdgeIds: Set<string>,
  usedEdgeIds: Set<string>,
  adjacency: Map<string, DirectedComponentLoopEdgeV3[]>,
): number {
  return (adjacency.get(nodeId) ?? []).filter((edge) => componentEdgeIds.has(edge.edge.id) && !usedEdgeIds.has(edge.edge.id) && edge.surface !== 'paved').length;
}

function shortestClosureTraversal(
  fromNodeId: string,
  startNodeId: string,
  adjacency: Map<string, DirectedComponentLoopEdgeV3[]>,
  targetComponentIds: TerrainComponentKindV3[],
  usedTargetEdgeIds: Set<string>,
  usedConnectorEdgeIds: Set<string>,
  maxDistanceKm: number,
  allowConnectorRepeatClosure: boolean,
): DirectedComponentLoopEdgeV3[] {
  const targetComponents = new Set(targetComponentIds);
  const canUseTargetEdge = (edge: DirectedComponentLoopEdgeV3): boolean => !usedTargetEdgeIds.has(edge.edge.id);
  const cleanConnectorClosure = shortestPath(fromNodeId, startNodeId, adjacency, (edge, traversal) => {
    if (sumDirectedLengths(traversal) + Math.max(0, edge.edge.lengthKm) > maxDistanceKm + 0.001) return false;
    if (targetComponents.has(edge.kind)) return canUseTargetEdge(edge);
    return !usedConnectorEdgeIds.has(edge.edge.id);
  });
  if (cleanConnectorClosure.length > 0) return cleanConnectorClosure;

  return shortestPath(fromNodeId, startNodeId, adjacency, (edge, traversal) => {
    if (sumDirectedLengths(traversal) + Math.max(0, edge.edge.lengthKm) > maxDistanceKm + 0.001) return false;
    if (targetComponents.has(edge.kind)) return canUseTargetEdge(edge);
    if (!usedConnectorEdgeIds.has(edge.edge.id)) return true;
    return allowConnectorRepeatClosure && edge.to === startNodeId;
  });
}

function edgePairKey(edge: DirectedComponentLoopEdgeV3): string {
  return [edge.from, edge.to].sort().join('::');
}

function shortestPath(
  fromNodeId: string,
  toNodeId: string,
  adjacency: Map<string, DirectedComponentLoopEdgeV3[]>,
  allowed: (edge: DirectedComponentLoopEdgeV3, traversal: DirectedComponentLoopEdgeV3[]) => boolean,
): DirectedComponentLoopEdgeV3[] {
  const bestDistances = new Map<string, number>([[fromNodeId, 0]]);
  const pending: Array<{ nodeId: string; distanceKm: number; traversal: DirectedComponentLoopEdgeV3[] }> = [{ nodeId: fromNodeId, distanceKm: 0, traversal: [] }];
  while (pending.length > 0) {
    const current = pending.sort((a, b) => a.distanceKm - b.distanceKm).shift();
    if (!current) break;
    if (current.nodeId === toNodeId && current.traversal.length > 0) return current.traversal;
    if (current.distanceKm > (bestDistances.get(current.nodeId) ?? Number.POSITIVE_INFINITY) + 0.000001) continue;
    for (const edge of adjacency.get(current.nodeId) ?? []) {
      if (!allowed(edge, current.traversal)) continue;
      const nextDistanceKm = current.distanceKm + Math.max(0, edge.edge.lengthKm);
      if (nextDistanceKm + 0.000001 >= (bestDistances.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      bestDistances.set(edge.to, nextDistanceKm);
      pending.push({ nodeId: edge.to, distanceKm: nextDistanceKm, traversal: [...current.traversal, edge] });
    }
  }
  return [];
}

function metricsFromPhases(
  access: DirectedComponentLoopEdgeV3[],
  internal: DirectedComponentLoopEdgeV3[],
  closure: DirectedComponentLoopEdgeV3[],
  targetComponentIds: TerrainComponentKindV3[],
): ComponentLoopSolverMetricsV3 {
  const all = [...access, ...internal, ...closure];
  const targetComponents = new Set(targetComponentIds);
  const accessIds = new Set(access.map((edge) => edge.edge.id));
  const internalTargetPairs = new Set(internal.map((edge) => edgePairKey(edge)));
  const connectorRepeatKm = closure.filter((edge) => !internal.some((candidate) => candidate.edge.id === edge.edge.id) && accessIds.has(edge.edge.id)).reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
  const targetRepeatKm = closure
    .filter((edge) => internalTargetPairs.has(edgePairKey(edge)))
    .reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
  return {
    distanceKm: round(sumDirectedLengths(all)),
    accessKm: round(sumDirectedLengths(access)),
    accessPavedKm: round(sumPaved(access)),
    internalDistanceKm: round(sumDirectedLengths(internal)),
    naturalDwellKm: round(sumDirectedLengths([...internal, ...closure].filter((edge) => targetComponents.has(edge.kind) && edge.surface !== 'paved'))),
    recoveryKm: 0,
    closureKm: round(sumDirectedLengths(closure)),
    closurePavedKm: round(sumPaved(closure)),
    pavedKm: round(sumPaved(all)),
    targetRepeatKm: round(targetRepeatKm),
    connectorRepeatKm: round(connectorRepeatKm),
  };
}

function targetComponentsFromGraph(
  adjacency: Map<string, DirectedComponentLoopEdgeV3[]>,
  targetComponentIds: TerrainComponentKindV3[],
): TargetGraphComponentV3[] {
  const targetComponents = new Set(targetComponentIds);
  const seenEdges = new Set<string>();
  const components: TargetGraphComponentV3[] = [];
  for (const edges of Array.from(adjacency.values())) {
    for (const seed of edges) {
      if (seenEdges.has(seed.edge.id) || !targetComponents.has(seed.kind) || seed.surface === 'paved') continue;
      const nodeIds = new Set<string>();
      const edgeIds = new Set<string>();
      const pending = [seed.from, seed.to];
      let reachableTargetKm = 0;
      while (pending.length > 0) {
        const current = pending.shift();
        if (!current || nodeIds.has(current)) continue;
        nodeIds.add(current);
        for (const edge of adjacency.get(current) ?? []) {
          if (!targetComponents.has(edge.kind) || edge.surface === 'paved') continue;
          if (!edgeIds.has(edge.edge.id)) {
            edgeIds.add(edge.edge.id);
            seenEdges.add(edge.edge.id);
            reachableTargetKm += Math.max(0, edge.edge.lengthKm);
          }
          if (!nodeIds.has(edge.to)) pending.push(edge.to);
        }
      }
      components.push({
        componentId: `target-component-${components.length + 1}`,
        nodeIds,
        edgeIds,
        reachableTargetKm: round(reachableTargetKm),
      });
    }
  }
  return components;
}

function shortestAccessTraversalToComponent(
  startNodeId: string,
  componentNodeIds: Set<string>,
  adjacency: Map<string, DirectedComponentLoopEdgeV3[]>,
): DirectedComponentLoopEdgeV3[] | null {
  if (componentNodeIds.has(startNodeId)) return [];
  const bestDistances = new Map<string, number>([[startNodeId, 0]]);
  const pending: Array<{ nodeId: string; distanceKm: number; traversal: DirectedComponentLoopEdgeV3[] }> = [
    { nodeId: startNodeId, distanceKm: 0, traversal: [] },
  ];
  while (pending.length > 0) {
    const current = pending.sort((a, b) => a.distanceKm - b.distanceKm).shift();
    if (!current) break;
    if (componentNodeIds.has(current.nodeId) && current.traversal.length > 0) return current.traversal;
    if (current.distanceKm > (bestDistances.get(current.nodeId) ?? Number.POSITIVE_INFINITY) + 0.000001) continue;
    for (const edge of adjacency.get(current.nodeId) ?? []) {
      const nextDistanceKm = current.distanceKm + Math.max(0, edge.edge.lengthKm);
      if (nextDistanceKm + 0.000001 >= (bestDistances.get(edge.to) ?? Number.POSITIVE_INFINITY)) continue;
      bestDistances.set(edge.to, nextDistanceKm);
      pending.push({ nodeId: edge.to, distanceKm: nextDistanceKm, traversal: [...current.traversal, edge] });
    }
  }
  return null;
}

function buildAdjacency(graph: EnrichedGraph): Map<string, DirectedComponentLoopEdgeV3[]> {
  const adjacency = new Map<string, DirectedComponentLoopEdgeV3[]>();
  for (const nodeId of Array.from(graph.nodes.keys())) adjacency.set(nodeId, []);
  for (const edge of Array.from(graph.edges.values())) {
    const kind = componentKind(edge);
    const surface = routeSurface(edge);
    adjacency.get(edge.from)?.push({ edge, from: edge.from, to: edge.to, kind, surface });
    adjacency.get(edge.to)?.push({ edge, from: edge.to, to: edge.from, kind, surface });
  }
  return adjacency;
}

function adjacencyFromGraph(graph: EnrichedGraph): Map<string, DirectedComponentLoopEdgeV3[]> {
  return buildAdjacency(graph);
}

function edgeIdsToDirectedTraversal(
  startNodeId: string,
  edgeIds: string[],
  graph: EnrichedGraph,
  adjacency: Map<string, DirectedComponentLoopEdgeV3[]>,
): DirectedComponentLoopEdgeV3[] {
  const traversal: DirectedComponentLoopEdgeV3[] = [];
  let current = startNodeId;
  for (const edgeId of edgeIds) {
    const edge = (adjacency.get(current) ?? []).find((candidate) => candidate.edge.id === edgeId);
    if (!edge) {
      const fallback = graph.edges.get(edgeId);
      if (!fallback) return traversal;
      const directed = fallback.from === current
        ? { edge: fallback, from: fallback.from, to: fallback.to, kind: componentKind(fallback), surface: routeSurface(fallback) }
        : { edge: fallback, from: fallback.to, to: fallback.from, kind: componentKind(fallback), surface: routeSurface(fallback) };
      traversal.push(directed);
      current = directed.to;
      continue;
    }
    traversal.push(edge);
    current = edge.to;
  }
  return traversal;
}

function metricsFromDirectedEdges(
  accessEdgeCount: number,
  edges: DirectedComponentLoopEdgeV3[],
  traversal: ReturnType<typeof buildTargetComponentTraversal>,
): ComponentLoopSolverMetricsV3 {
  const accessEdges = edges.slice(0, accessEdgeCount);
  const closureEdgeCount = traversal.status === 'success' ? traversal.closure.edgeIds.length : 0;
  const closureEdges = closureEdgeCount > 0 ? edges.slice(edges.length - closureEdgeCount) : [];
  const internalEdges = closureEdgeCount > 0 ? edges.slice(accessEdgeCount, edges.length - closureEdgeCount) : edges.slice(accessEdgeCount);
  const pavedKm = sumPaved(edges);
  return {
    distanceKm: round(sumDirectedLengths(edges)),
    accessKm: round(sumDirectedLengths(accessEdges)),
    accessPavedKm: round(sumPaved(accessEdges)),
    internalDistanceKm: round(sumDirectedLengths(internalEdges)),
    naturalDwellKm: round(sumDirectedLengths(internalEdges.filter((edge) => edge.surface === 'natural')) || traversal.diagnostics.targetDistanceKm),
    recoveryKm: 0,
    closureKm: round(sumDirectedLengths(closureEdges)),
    closurePavedKm: round(sumPaved(closureEdges)),
    pavedKm: round(pavedKm),
    targetRepeatKm: traversal.status === 'success' ? traversal.closure.targetRepeatKm : 0,
    connectorRepeatKm: traversal.status === 'success' ? traversal.closure.connectorRepeatKm : 0,
  };
}

function emptyMetrics(): ComponentLoopSolverMetricsV3 {
  return {
    distanceKm: 0,
    accessKm: 0,
    accessPavedKm: 0,
    internalDistanceKm: 0,
    naturalDwellKm: 0,
    recoveryKm: 0,
    closureKm: 0,
    closurePavedKm: 0,
    pavedKm: 0,
    targetRepeatKm: 0,
    connectorRepeatKm: 0,
  };
}

function nodesFromDirectedEdges(startNodeId: string, edges: DirectedComponentLoopEdgeV3[]): string[] {
  const nodes = [startNodeId];
  for (const edge of edges) nodes.push(edge.to);
  return nodes;
}

function sumDirectedLengths(edges: DirectedComponentLoopEdgeV3[]): number {
  return edges.reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
}

function sumPaved(edges: DirectedComponentLoopEdgeV3[]): number {
  return edges.filter((edge) => edge.surface === 'paved').reduce((sum, edge) => sum + Math.max(0, edge.edge.lengthKm), 0);
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
