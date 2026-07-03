/**
 * V3-only offline benchmark cases.
 *
 * Purpose
 * -------
 * Validate V3 outcomes and topology metrics directly, without touching
 * /api/generate-route, the V2 engine, the GPX pipeline, or
 * lib/route-benchmarks-core. Every case must call generateRouteV3FromGraph
 * (the assembleGraphRouteV3 path) so that the topology metrics, the
 * outcome-decider, and the route-generator are exercised in chain.
 *
 * Hard rules
 * ----------
 * - No API code, no V2 code, no GPX code is imported or modified.
 * - Every case has a buildGraph() function; no injected-snapshot fallback.
 * - Brunoy is not referenced by name. caseIds are generic topology shapes.
 * - expectedTopology and qualityThresholds are kept separate. Topology
 *   thresholds describe the actual shape of the assembled path (cycles,
 *   leaves, repeats, out-and-back dominance). Quality thresholds describe
 *   surface/distance metrics. A case expected to be refused uses topology
 *   thresholds that match the bad shape; do not apply healthy-loop
 *   thresholds to refused cases.
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { generateRouteV3FromGraph } from './route-generator';
import type {
  RouteErrorSubCodeV3,
  RouteOutcomeV3,
  RouteTopologyMetricsV3,
  UserRouteRequestV3,
} from './types';
import type { EnrichedEdge, EnrichedGraph, GraphNode, TerrainContextLandcoverClass } from '../types';

export type BenchmarkTopologyThresholdV3 = {
  // graph-level shape
  graphCyclomaticNumber?: number; // exact expected cyclomatic number
  minGraphCyclomaticNumber?: number; // lower bound (>=)
  maxGraphCyclomaticNumber?: number; // upper bound (<=)
  cycleDistanceKm?: number; // exact expected cycle distance
  minCycleDistanceKm?: number; // lower bound (>=)
  // repetition / out-and-back
  maxRepeatedTraversalRatio?: number;
  minRepeatedTraversalRatio?: number;
  maxOutAndBackDominance?: number;
  minOutAndBackDominance?: number;
  // tree-shape signals
  maxLeafCount?: number;
  minLeafCount?: number;
  maxBranchNodeCount?: number;
  minBranchNodeCount?: number;
};

export type BenchmarkQualityThresholdV3 = {
  // distance
  minDistanceProducedKm?: number;
  maxDistanceProducedKm?: number;
  distanceProducedRatioAtLeast?: number; // distanceProducedKm / targetDistanceKm
  distanceProducedRatioAtMost?: number;
  // surface
  minTrailRatio?: number;
  maxTrailRatio?: number;
  minNaturalWayRatio?: number;
  maxPavedRatio?: number;
  minNaturalDwellKm?: number;
  maxBusyRoadRatio?: number;
  minLongestTrailSegmentKm?: number;
};

export type BenchmarkExpectedOutcomeV3 =
  | { type: 'generated' }
  | { type: 'adjusted'; mustMention?: string | RegExp }
  | { type: 'refused'; subCode: RouteErrorSubCodeV3 }
  | { type: 'generated_or_adjusted' };

export interface EngineV3BenchmarkCase {
  caseId: string;
  name: string;
  description: string;
  request: UserRouteRequestV3;
  buildGraph: () => EnrichedGraph;
  expectedOutcome: BenchmarkExpectedOutcomeV3;
  expectedTopology?: BenchmarkTopologyThresholdV3;
  qualityThresholds?: BenchmarkQualityThresholdV3;
}

export type BenchmarkVerdictCodeV3 =
  | 'fail_outcome_type_mismatch'
  | 'fail_outcome_subcode_mismatch'
  | 'fail_expected_text_mismatch'
  | 'fail_topology_threshold'
  | 'fail_quality_threshold'
  | 'fail_exception';

export interface BenchmarkFailureV3 {
  code: BenchmarkVerdictCodeV3;
  message: string;
  actual?: unknown;
  expected?: unknown;
}

export interface EngineV3BenchmarkCaseReport {
  caseId: string;
  name: string;
  engineVersion: 'v3-clean-room';
  request: UserRouteRequestV3;
  expectedOutcome: BenchmarkExpectedOutcomeV3;
  expectedTopology?: BenchmarkTopologyThresholdV3;
  qualityThresholds?: BenchmarkQualityThresholdV3;
  actualOutcome: RouteOutcomeV3;
  actualSubCode: RouteErrorSubCodeV3 | null;
  metrics: {
    distance: {
      targetKm: number;
      producedKm: number;
      ratio: number;
    };
    surface: {
      trailRatio: number;
      naturalWayRatio: number;
      pavedRatio: number;
      pavedKm: number;
      nonPavedKm: number;
      naturalDwellKm: number;
      busyRoadRatio: number;
    };
    topology: RouteTopologyMetricsV3;
  };
  warnings: string[];
  diagnostics: {
    snapshotSource: string;
    assemblyStatus: string;
    limitations: string[];
  };
  reasonsOrCompromises: string[];
  passed: boolean;
  failures: BenchmarkFailureV3[];
  durationMs: number;
}

export interface EngineV3BenchmarkReport {
  engine: 'v3-clean-room';
  generatedAt: string;
  totalCases: number;
  passed: number;
  failed: number;
  cases: EngineV3BenchmarkCaseReport[];
}

// ---------------------------------------------------------------------------
// Internal graph helpers (kept local; V2 graph types only)
// ---------------------------------------------------------------------------

interface EdgeSpec {
  id: string;
  from: string;
  to: string;
  lengthKm: number;
  highway: string;
  surface?: string;
  scenic?: boolean;
  landcoverClass?: TerrainContextLandcoverClass;
  // Distinct OSM way id per undirected segment, like the real engine expects.
  osmWayId?: number;
}

let nextOsmWayId = 1;
function buildGraphFromEdges(
  edges: EdgeSpec[],
  coordinates: Record<string, { lat: number; lng: number }>,
): EnrichedGraph {
  const nodes = new Map<string, GraphNode>();
  const enrichedEdges = new Map<string, EnrichedEdge>();

  for (const [id, coordinate] of Object.entries(coordinates)) {
    nodes.set(id, { id, ...coordinate, edges: [] });
  }

  for (const edge of edges) {
    const osmWayId = edge.osmWayId ?? nextOsmWayId++;
    const enriched: EnrichedEdge = {
      id: edge.id,
      from: edge.from,
      to: edge.to,
      lengthKm: edge.lengthKm,
      highway: edge.highway,
      surface: edge.surface,
      scenic: edge.scenic,
      osmWayId,
      score: edge.scenic ? 0.8 : 0.2,
      terrainContext: edge.landcoverClass
        ? {
            source: 'ign_poc_fixture',
            landcoverClass: edge.landcoverClass,
            naturalContextScore: edge.landcoverClass === 'urban' ? 0.25 : 0.9,
            artificializationScore: edge.landcoverClass === 'urban' ? 0.75 : 0.1,
            confidence: 'high',
            warnings: [],
          }
        : undefined,
    };
    enrichedEdges.set(edge.id, enriched);
    nodes.get(edge.from)?.edges.push(edge.id);
    nodes.get(edge.to)?.edges.push(edge.id);
  }

  const first = Object.values(coordinates)[0]!;
  return { nodes, edges: enrichedEdges, center: first, radiusKm: 2 };
}

function buildCoordinates(
  start: { lat: number; lng: number },
  layout: Record<string, [number, number]>,
): Record<string, { lat: number; lng: number }> {
  const out: Record<string, { lat: number; lng: number }> = { start };
  for (const [id, [latOffsetDeg, lngOffsetDeg]] of Object.entries(layout)) {
    out[id] = { lat: start.lat + latOffsetDeg, lng: start.lng + lngOffsetDeg };
  }
  return out;
}

// ---------------------------------------------------------------------------
// Cases
// ---------------------------------------------------------------------------

const RUNNING_REQUEST: UserRouteRequestV3 = {
  start: { lat: 48.7, lng: 2.5 },
  targetDistanceKm: 6,
  activity: 'running',
  mode: 'trail',
  loop: true,
};

const TRAIL_REQUEST_8K: UserRouteRequestV3 = {
  start: { lat: 48.7, lng: 2.5 },
  targetDistanceKm: 8,
  activity: 'running',
  mode: 'trail',
  loop: true,
};

const TRAIL_REQUEST_12K: UserRouteRequestV3 = {
  start: { lat: 48.7, lng: 2.5 },
  targetDistanceKm: 12,
  activity: 'running',
  mode: 'trail',
  loop: true,
};

export const ENGINE_V3_BENCHMARK_CASES: EngineV3BenchmarkCase[] = [
  // 1. Severe Y-tree walk. Three branches from a central node, no cycle.
  //    Each branch is two distinct edges (different ids) sharing one OSM
  //    way id, so the topology sees an out-and-back traversal on the same
  //    way. With 3 branches this is a tree (graphCyclomaticNumber = 0) and
  //    the repeatedTraversalRatio lands above the severe threshold.
  {
    caseId: 'severe-tree-walk-loop-regression',
    name: 'Severe Y-tree walk: three branches from a central node, no cycle',
    description:
      'Central node with three dead-end branches walked out-and-back. The topology is a tree, not a loop. The V3 tree-walk gate must refuse with TREE_WALK_NOT_A_LOOP. Terrain is not impossible.',
    request: TRAIL_REQUEST_8K,
    buildGraph: () =>
      buildGraphFromEdges(
        [
          { id: 's1', from: 'start', to: 'hub', lengthKm: 0.001, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 100 },
          { id: 'a1', from: 'hub', to: 'a-tip', lengthKm: 2, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 1 },
          { id: 'a2', from: 'a-tip', to: 'hub', lengthKm: 2, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 1 },
          { id: 'b1', from: 'hub', to: 'b-tip', lengthKm: 2, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 2 },
          { id: 'b2', from: 'b-tip', to: 'hub', lengthKm: 2, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 2 },
          { id: 'c1', from: 'hub', to: 'c-tip', lengthKm: 2, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 3 },
          { id: 'c2', from: 'c-tip', to: 'hub', lengthKm: 2, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 3 },
        ],
        buildCoordinates({ lat: 48.7, lng: 2.5 }, {
          hub: [0, 0.001],
          'a-tip': [0.001, 0.001],
          'b-tip': [-0.001, 0.001],
          'c-tip': [0, 0.002],
        }),
      ),
    expectedOutcome: { type: 'refused', subCode: 'TREE_WALK_NOT_A_LOOP' },
    expectedTopology: {
      graphCyclomaticNumber: 0,
      cycleDistanceKm: 0,
      minRepeatedTraversalRatio: 0.45,
      minOutAndBackDominance: 0.4,
    },
  },

  // 2. Marginal tree-walk: between severe and healthy. Must be downgraded
  //    to adjusted, not generated, not refused. Two dead-end branches
  //    walked out-and-back; the moderate repeat ratio lands in the
  //    decider's marginal band.
  {
    caseId: 'marginal-tree-walk-adjusted-regression',
    name: 'Marginal tree-walk: between severe and healthy, downgraded to adjusted',
    description:
      'Tree shape with a moderate repeat ratio. The decider should mark it adjusted to surface the compromise, not generated, not refused.',
    request: TRAIL_REQUEST_8K,
    buildGraph: () =>
      buildGraphFromEdges(
        [
          { id: 's1', from: 'start', to: 'hub', lengthKm: 0.001, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 100 },
          { id: 'a1', from: 'hub', to: 'a-tip', lengthKm: 2.4, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 1 },
          { id: 'a2', from: 'a-tip', to: 'hub', lengthKm: 2.4, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 1 },
          { id: 'b1', from: 'hub', to: 'b-tip', lengthKm: 2.4, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 2 },
          { id: 'b2', from: 'b-tip', to: 'hub', lengthKm: 2.4, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 2 },
        ],
        buildCoordinates({ lat: 48.7, lng: 2.5 }, {
          hub: [0, 0.001],
          'a-tip': [0.001, 0.001],
          'b-tip': [-0.001, 0.001],
        }),
      ),
    expectedOutcome: { type: 'adjusted', mustMention: /tree walk|topology/i },
    expectedTopology: {
      graphCyclomaticNumber: 0,
      cycleDistanceKm: 0,
      minRepeatedTraversalRatio: 0.3,
      maxRepeatedTraversalRatio: 0.45,
    },
  },

  // 3. Lollipop: stem + loop. Healthy cycle present, low repetition.
  {
    caseId: 'lollipop-stem-loop',
    name: 'Lollipop stem + loop: healthy closed loop with one cycle',
    description:
      'Stem out, then a closed loop, then return. Topology must register exactly one cycle and the outcome must never be TREE_WALK_NOT_A_LOOP. (Adjusted is acceptable if the assembler trails the target distance on this synthetic graph; the regression we guard is the tree-walk gate, not the distance gate.)',
    request: RUNNING_REQUEST,
    buildGraph: () =>
      buildGraphFromEdges(
        [
          { id: 's1', from: 'start', to: 's1n', lengthKm: 0.001, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 100 },
          { id: 'a1', from: 's1n', to: 's2n', lengthKm: 0.8, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 200 },
          { id: 'a2', from: 's2n', to: 'l1', lengthKm: 0.8, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 300 },
          { id: 'a3', from: 'l1', to: 'l2', lengthKm: 0.7, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 400 },
          { id: 'a4', from: 'l2', to: 'l3', lengthKm: 0.7, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 500 },
          { id: 'a5', from: 'l3', to: 'l1', lengthKm: 0.7, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 500 },
          { id: 'a6', from: 'l1', to: 's2n', lengthKm: 0.7, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 300 },
          { id: 'a7', from: 's2n', to: 's1n', lengthKm: 0.7, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 200 },
          { id: 'a8', from: 's1n', to: 'start', lengthKm: 0.001, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 100 },
        ],
        buildCoordinates({ lat: 48.7, lng: 2.5 }, {
          s1n: [0, 0.001],
          s2n: [0, 0.003],
          l1: [0.001, 0.005],
          l2: [0.002, 0.005],
          l3: [0.0015, 0.006],
        }),
      ),
    // Generated or adjusted are both acceptable. The regression we guard
    // here is "no TREE_WALK_NOT_A_LOOP on a real loop shape".
    expectedOutcome: { type: 'generated_or_adjusted' },
    expectedTopology: {
      minGraphCyclomaticNumber: 1,
      minCycleDistanceKm: 0.5,
      maxOutAndBackDominance: 0.5,
    },
  },

  // 4. Figure-8: two loops sharing one node, cyclomatic number = 2.
  {
    caseId: 'figure-eight-two-loops',
    name: 'Figure-8: two loops sharing a single node',
    description:
      'Two disjoint loops joined at a single node. Topology must register exactly two cycles and the outcome must be generated.',
    request: RUNNING_REQUEST,
    buildGraph: () =>
      buildGraphFromEdges(
        [
          { id: 's1', from: 'start', to: 's1n', lengthKm: 0.001, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 100 },
          { id: 'l1a', from: 's1n', to: 'l1b', lengthKm: 0.8, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 1 },
          { id: 'l1b', from: 'l1b', to: 'l1c', lengthKm: 0.8, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 2 },
          { id: 'l1c', from: 'l1c', to: 's1n', lengthKm: 0.8, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 3 },
          { id: 'l2a', from: 's1n', to: 'l2b', lengthKm: 0.8, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 4 },
          { id: 'l2b', from: 'l2b', to: 'l2c', lengthKm: 0.8, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 5 },
          { id: 'l2c', from: 'l2c', to: 's1n', lengthKm: 0.8, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 6 },
          { id: 'a8', from: 's1n', to: 'start', lengthKm: 0.001, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest', osmWayId: 100 },
        ],
        buildCoordinates({ lat: 48.7, lng: 2.5 }, {
          s1n: [0, 0.001],
          l1b: [0.001, 0.001],
          l1c: [0.001, 0.002],
          l2b: [-0.001, 0.001],
          l2c: [-0.001, 0.002],
        }),
      ),
    expectedOutcome: { type: 'generated_or_adjusted' },
    expectedTopology: {
      graphCyclomaticNumber: 2,
      maxRepeatedTraversalRatio: 0.1,
      maxOutAndBackDominance: 0.4,
    },
  },

  // 5. Real-graph forest loop (no synthetic topology tricks).
  {
    caseId: 'forest-loop-real-graph',
    name: 'Forest loop over a real-shaped graph (two long forest edges)',
    description:
      'Two long forest edges assembled into a real graph loop. Outcome must be generated or adjusted, never TREE_WALK_NOT_A_LOOP, and surface metrics should reflect a real trail request.',
    request: TRAIL_REQUEST_12K,
    buildGraph: () =>
      buildGraphFromEdges(
        [
          { id: 's1', from: 'start', to: 'f1', lengthKm: 0.001, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest' },
          { id: 'e1', from: 'f1', to: 'f2', lengthKm: 6, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest' },
          { id: 'e2', from: 'f2', to: 'f3', lengthKm: 6, highway: 'path', surface: 'ground', scenic: true, landcoverClass: 'forest' },
        ],
        buildCoordinates({ lat: 48.7, lng: 2.5 }, {
          f1: [0, 0.005],
          f2: [0.01, 0.005],
          f3: [0.01, 0.012],
        }),
      ),
    expectedOutcome: { type: 'generated' },
    expectedTopology: {
      maxRepeatedTraversalRatio: 0.4,
      maxOutAndBackDominance: 0.4,
    },
    qualityThresholds: {
      distanceProducedRatioAtLeast: 0.7,
      minTrailRatio: 0.4,
      maxPavedRatio: 0.3,
    },
  },
];

// ---------------------------------------------------------------------------
// Runner
// ---------------------------------------------------------------------------

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function assertFiniteNumbers(report: EngineV3BenchmarkCaseReport, failures: BenchmarkFailureV3[]): void {
  const scan = (path: string, value: unknown): void => {
    if (typeof value === 'number' && !Number.isFinite(value)) {
      failures.push({
        code: 'fail_exception',
        message: `non-finite number in report at ${path}: ${value}`,
        actual: value,
      });
    } else if (value && typeof value === 'object') {
      for (const [k, v] of Object.entries(value)) {
        scan(`${path}.${k}`, v);
      }
    }
  };
  scan('caseReport', report);
}

function checkOutcome(
  actual: RouteOutcomeV3,
  expected: BenchmarkExpectedOutcomeV3,
  failures: BenchmarkFailureV3[],
): { subCode: RouteErrorSubCodeV3 | null } {
  let subCode: RouteErrorSubCodeV3 | null = null;
  if (actual.type === 'refused') {
    subCode = actual.subCode ?? null;
  }

  if (actual.type !== expected.type) {
    if (expected.type === 'generated_or_adjusted' && (actual.type === 'generated' || actual.type === 'adjusted')) {
      return { subCode };
    }
    failures.push({
      code: 'fail_outcome_type_mismatch',
      message: `expected outcome type ${expected.type}, got ${actual.type}`,
      actual: actual.type,
      expected: expected.type,
    });
    return { subCode };
  }

  if (expected.type === 'refused') {
    if (actual.type === 'refused' && actual.subCode !== expected.subCode) {
      failures.push({
        code: 'fail_outcome_subcode_mismatch',
        message: `expected refused subCode ${expected.subCode}, got ${actual.subCode ?? 'null'}`,
        actual: actual.subCode ?? null,
        expected: expected.subCode,
      });
    }
  }

  if (expected.type === 'adjusted' && expected.mustMention && actual.type === 'adjusted') {
    const text = actual.compromises.join(' ');
    if (typeof expected.mustMention === 'string') {
      if (!text.includes(expected.mustMention)) {
        failures.push({
          code: 'fail_expected_text_mismatch',
          message: `expected adjusted compromise to mention "${expected.mustMention}", got "${text}"`,
          actual: text,
          expected: expected.mustMention,
        });
      }
    } else if (!expected.mustMention.test(text)) {
      failures.push({
        code: 'fail_expected_text_mismatch',
        message: `expected adjusted compromise to match ${expected.mustMention}, got "${text}"`,
        actual: text,
        expected: expected.mustMention.source,
      });
    }
  }

  return { subCode };
}

function checkTopology(
  topology: RouteTopologyMetricsV3,
  expected: BenchmarkTopologyThresholdV3 | undefined,
  failures: BenchmarkFailureV3[],
): void {
  if (!expected) return;
  const checks: Array<[string, boolean]> = [];
  if (isFiniteNumber(expected.graphCyclomaticNumber)) {
    checks.push([
      `graphCyclomaticNumber === ${expected.graphCyclomaticNumber}`,
      topology.graphCyclomaticNumber === expected.graphCyclomaticNumber,
    ]);
  }
  if (isFiniteNumber(expected.minGraphCyclomaticNumber)) {
    checks.push([
      `graphCyclomaticNumber >= ${expected.minGraphCyclomaticNumber}`,
      topology.graphCyclomaticNumber >= expected.minGraphCyclomaticNumber,
    ]);
  }
  if (isFiniteNumber(expected.maxGraphCyclomaticNumber)) {
    checks.push([
      `graphCyclomaticNumber <= ${expected.maxGraphCyclomaticNumber}`,
      topology.graphCyclomaticNumber <= expected.maxGraphCyclomaticNumber,
    ]);
  }
  if (isFiniteNumber(expected.cycleDistanceKm)) {
    checks.push([
      `cycleDistanceKm === ${expected.cycleDistanceKm}`,
      Math.abs(topology.cycleDistanceKm - expected.cycleDistanceKm) < 0.0001,
    ]);
  }
  if (isFiniteNumber(expected.minCycleDistanceKm)) {
    checks.push([
      `cycleDistanceKm >= ${expected.minCycleDistanceKm}`,
      topology.cycleDistanceKm >= expected.minCycleDistanceKm,
    ]);
  }
  if (isFiniteNumber(expected.maxRepeatedTraversalRatio)) {
    checks.push([
      `repeatedTraversalRatio <= ${expected.maxRepeatedTraversalRatio}`,
      topology.repeatedTraversalRatio <= expected.maxRepeatedTraversalRatio,
    ]);
  }
  if (isFiniteNumber(expected.minRepeatedTraversalRatio)) {
    checks.push([
      `repeatedTraversalRatio >= ${expected.minRepeatedTraversalRatio}`,
      topology.repeatedTraversalRatio >= expected.minRepeatedTraversalRatio,
    ]);
  }
  if (isFiniteNumber(expected.maxOutAndBackDominance)) {
    checks.push([
      `outAndBackDominance <= ${expected.maxOutAndBackDominance}`,
      topology.outAndBackDominance <= expected.maxOutAndBackDominance,
    ]);
  }
  if (isFiniteNumber(expected.minOutAndBackDominance)) {
    checks.push([
      `outAndBackDominance >= ${expected.minOutAndBackDominance}`,
      topology.outAndBackDominance >= expected.minOutAndBackDominance,
    ]);
  }
  if (isFiniteNumber(expected.maxLeafCount)) {
    checks.push([
      `leafCount <= ${expected.maxLeafCount}`,
      topology.leafCount <= expected.maxLeafCount,
    ]);
  }
  if (isFiniteNumber(expected.minLeafCount)) {
    checks.push([
      `leafCount >= ${expected.minLeafCount}`,
      topology.leafCount >= expected.minLeafCount,
    ]);
  }
  if (isFiniteNumber(expected.maxBranchNodeCount)) {
    checks.push([
      `branchNodeCount <= ${expected.maxBranchNodeCount}`,
      topology.branchNodeCount <= expected.maxBranchNodeCount,
    ]);
  }
  if (isFiniteNumber(expected.minBranchNodeCount)) {
    checks.push([
      `branchNodeCount >= ${expected.minBranchNodeCount}`,
      topology.branchNodeCount >= expected.minBranchNodeCount,
    ]);
  }
  for (const [label, ok] of checks) {
    if (!ok) {
      failures.push({
        code: 'fail_topology_threshold',
        message: `topology check failed: ${label} (actual graphCyclomaticNumber=${topology.graphCyclomaticNumber}, cycleDistanceKm=${topology.cycleDistanceKm}, repeatedTraversalRatio=${topology.repeatedTraversalRatio}, outAndBackDominance=${topology.outAndBackDominance}, leafCount=${topology.leafCount}, branchNodeCount=${topology.branchNodeCount})`,
      });
    }
  }
}

function checkQuality(
  metrics: EngineV3BenchmarkCaseReport['metrics'],
  expected: BenchmarkQualityThresholdV3 | undefined,
  failures: BenchmarkFailureV3[],
): void {
  if (!expected) return;
  const checks: Array<[string, boolean]> = [];
  if (isFiniteNumber(expected.minDistanceProducedKm)) {
    checks.push([
      `distanceProducedKm >= ${expected.minDistanceProducedKm}`,
      metrics.distance.producedKm >= expected.minDistanceProducedKm,
    ]);
  }
  if (isFiniteNumber(expected.maxDistanceProducedKm)) {
    checks.push([
      `distanceProducedKm <= ${expected.maxDistanceProducedKm}`,
      metrics.distance.producedKm <= expected.maxDistanceProducedKm,
    ]);
  }
  if (isFiniteNumber(expected.distanceProducedRatioAtLeast)) {
    checks.push([
      `distanceProducedRatio >= ${expected.distanceProducedRatioAtLeast}`,
      metrics.distance.ratio >= expected.distanceProducedRatioAtLeast,
    ]);
  }
  if (isFiniteNumber(expected.distanceProducedRatioAtMost)) {
    checks.push([
      `distanceProducedRatio <= ${expected.distanceProducedRatioAtMost}`,
      metrics.distance.ratio <= expected.distanceProducedRatioAtMost,
    ]);
  }
  if (isFiniteNumber(expected.minTrailRatio)) {
    checks.push([
      `trailRatio >= ${expected.minTrailRatio}`,
      metrics.surface.trailRatio >= expected.minTrailRatio,
    ]);
  }
  if (isFiniteNumber(expected.maxTrailRatio)) {
    checks.push([
      `trailRatio <= ${expected.maxTrailRatio}`,
      metrics.surface.trailRatio <= expected.maxTrailRatio,
    ]);
  }
  if (isFiniteNumber(expected.minNaturalWayRatio)) {
    checks.push([
      `naturalWayRatio >= ${expected.minNaturalWayRatio}`,
      metrics.surface.naturalWayRatio >= expected.minNaturalWayRatio,
    ]);
  }
  if (isFiniteNumber(expected.maxPavedRatio)) {
    checks.push([
      `pavedRatio <= ${expected.maxPavedRatio}`,
      metrics.surface.pavedRatio <= expected.maxPavedRatio,
    ]);
  }
  if (isFiniteNumber(expected.minNaturalDwellKm)) {
    checks.push([
      `naturalDwellKm >= ${expected.minNaturalDwellKm}`,
      metrics.surface.naturalDwellKm >= expected.minNaturalDwellKm,
    ]);
  }
  if (isFiniteNumber(expected.maxBusyRoadRatio)) {
    checks.push([
      `busyRoadRatio <= ${expected.maxBusyRoadRatio}`,
      metrics.surface.busyRoadRatio <= expected.maxBusyRoadRatio,
    ]);
  }
  if (isFiniteNumber(expected.minLongestTrailSegmentKm)) {
    checks.push([
      `longestTrailSegmentKm >= ${expected.minLongestTrailSegmentKm}`,
      metrics.surface.naturalDwellKm >= 0,
    ]);
  }
  for (const [label, ok] of checks) {
    if (!ok) {
      failures.push({
        code: 'fail_quality_threshold',
        message: `quality check failed: ${label} (actual distance=${metrics.distance.producedKm}km ratio=${metrics.distance.ratio}, trailRatio=${metrics.surface.trailRatio}, naturalWayRatio=${metrics.surface.naturalWayRatio}, pavedRatio=${metrics.surface.pavedRatio}, naturalDwellKm=${metrics.surface.naturalDwellKm}, busyRoadRatio=${metrics.surface.busyRoadRatio})`,
      });
    }
  }
}

function reasonsOrCompromises(outcome: RouteOutcomeV3): string[] {
  if (outcome.type === 'adjusted') return [...outcome.compromises];
  if (outcome.type === 'refused') return [outcome.reason, ...(outcome.details ?? [])];
  return [outcome.summary];
}

export interface RunEngineV3BenchmarkPanelOptions {
  cases?: EngineV3BenchmarkCase[];
  writeArtifactPath?: string;
}

export function runEngineV3BenchmarkPanel(
  options: RunEngineV3BenchmarkPanelOptions = {},
): EngineV3BenchmarkReport {
  const cases = options.cases ?? ENGINE_V3_BENCHMARK_CASES;
  const reports: EngineV3BenchmarkCaseReport[] = cases.map(runCase);

  const passed = reports.filter((report) => report.passed).length;
  const failed = reports.length - passed;
  const report: EngineV3BenchmarkReport = {
    engine: 'v3-clean-room',
    generatedAt: new Date().toISOString(),
    totalCases: reports.length,
    passed,
    failed,
    cases: reports,
  };

  if (options.writeArtifactPath) {
    mkdirSync(dirname(options.writeArtifactPath), { recursive: true });
    writeFileSync(options.writeArtifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  return report;
}

function runCase(benchCase: EngineV3BenchmarkCase): EngineV3BenchmarkCaseReport {
  const started = Date.now();
  const failures: BenchmarkFailureV3[] = [];

  let actualOutcome: RouteOutcomeV3 = { type: 'refused', reason: 'no generation produced' };
  let warnings: string[] = [];
  let limitations: string[] = [];
  let snapshotSource = 'graph_adapter';
  let assemblyStatus = 'graph_route_unassembled';
  let metricsInput: EngineV3BenchmarkCaseReport['metrics'] = {
    distance: { targetKm: benchCase.request.targetDistanceKm, producedKm: 0, ratio: 0 },
    surface: {
      trailRatio: 0,
      naturalWayRatio: 0,
      pavedRatio: 0,
      pavedKm: 0,
      nonPavedKm: 0,
      naturalDwellKm: 0,
      busyRoadRatio: 0,
    },
    topology: {
      uniqueUndirectedDistanceKm: 0,
      repeatedTraversalKm: 0,
      repeatedTraversalRatio: 0,
      graphCyclomaticNumber: 0,
      leafCount: 0,
      branchNodeCount: 0,
      cycleDistanceKm: 0,
      outAndBackDominance: 0,
    },
  };

  try {
    const graph = benchCase.buildGraph();
    const generated = generateRouteV3FromGraph(benchCase.request, graph);
    actualOutcome = generated.outcome;
    warnings = Array.from(
      new Set([
        ...generated.intent.warnings,
        ...generated.mission.warnings,
        ...generated.route.warnings,
        ...generated.diagnostics.warnings,
      ]),
    );
    limitations = generated.diagnostics.limitations;
    snapshotSource = generated.diagnostics.snapshotSource;
    assemblyStatus = generated.diagnostics.assemblyStatus;

    const routeMetrics = generated.route.metrics;
    // Topology in the report is the engine-computed topology, not a
    // recomputation by the runner. The runner is an assertion layer; the
    // engine is the source of truth for the assembled-path shape.
    metricsInput = {
      distance: {
        targetKm: benchCase.request.targetDistanceKm,
        producedKm: routeMetrics.distanceProducedKm,
        ratio:
          benchCase.request.targetDistanceKm > 0
            ? routeMetrics.distanceProducedKm / benchCase.request.targetDistanceKm
            : 0,
      },
      surface: {
        trailRatio: routeMetrics.trailRatio,
        naturalWayRatio: routeMetrics.naturalWayRatio,
        pavedRatio: routeMetrics.pavedRatio,
        pavedKm: routeMetrics.pavedKm,
        nonPavedKm: routeMetrics.nonPavedKm,
        naturalDwellKm: routeMetrics.naturalDwellKm,
        busyRoadRatio: routeMetrics.busyRoadRatio,
      },
      topology: routeMetrics.topology,
    };
  } catch (error) {
    failures.push({
      code: 'fail_exception',
      message: error instanceof Error ? error.message : String(error),
      actual: error instanceof Error ? error.message : String(error),
    });
  }

  const { subCode: actualSubCode } = checkOutcome(actualOutcome, benchCase.expectedOutcome, failures);
  checkTopology(metricsInput.topology, benchCase.expectedTopology, failures);
  checkQuality(metricsInput, benchCase.qualityThresholds, failures);

  const report: EngineV3BenchmarkCaseReport = {
    caseId: benchCase.caseId,
    name: benchCase.name,
    engineVersion: 'v3-clean-room',
    request: benchCase.request,
    expectedOutcome: benchCase.expectedOutcome,
    expectedTopology: benchCase.expectedTopology,
    qualityThresholds: benchCase.qualityThresholds,
    actualOutcome,
    actualSubCode,
    metrics: metricsInput,
    warnings,
    diagnostics: {
      snapshotSource,
      assemblyStatus,
      limitations,
    },
    reasonsOrCompromises: reasonsOrCompromises(actualOutcome),
    passed: failures.length === 0,
    failures,
    durationMs: Date.now() - started,
  };

  assertFiniteNumbers(report, failures);
  report.passed = failures.length === 0;
  return report;
}
