import type {
  EnrichedEdge,
  EnrichedGraph,
  GraphNode,
  TerrainContextLandcoverClass,
} from '@/lib/types';
import type { CandidateLaneV3, MissionContractV3 } from '@/lib/engine-v3/contracts';
import type { TerrainComponentKindV3 } from '@/lib/engine-v3/types';

export interface SyntheticGraphCaseV3 {
  id: string;
  description: string;
  graph: EnrichedGraph;
  mission: MissionContractV3;
  expected: {
    selectableCandidate: boolean;
    expectedOutcome: 'generated' | 'adjusted' | 'refused';
    minDistanceKm?: number;
    minNaturalDwellKm?: number;
    maxPavedRatio?: number;
    requiredPortfolioLane?: CandidateLaneV3;
    forbiddenTrailEdgeIds?: string[];
    requiredBlocker?: string;
  };
}

export type SyntheticSurfaceConfidenceV3 = 'low' | 'medium' | 'high';

export type SyntheticEnrichedEdgeV3 = EnrichedEdge & {
  componentKind: TerrainComponentKindV3;
  landcoverClass: TerrainContextLandcoverClass;
  surfaceConfidence: SyntheticSurfaceConfidenceV3;
  completeRouteGroup?: string;
};

interface MakeEdgeInput {
  id: string;
  from: string;
  to: string;
  lengthKm: number;
  surface: string;
  highway: string;
  componentKind: TerrainComponentKindV3;
  landcoverClass?: TerrainContextLandcoverClass;
  scenic?: boolean;
  score?: number;
  surfaceConfidence?: SyntheticSurfaceConfidenceV3;
  completeRouteGroup?: string;
}

const DEFAULT_PHASES: MissionContractV3['phases'] = [
  'access',
  'target_dwell',
  'distance_recovery',
  'closure',
  'final_gate',
];

let syntheticWayId = 10_000;

export function makeNode(id: string, index: number): GraphNode {
  return {
    id,
    lat: 49 + index * 0.001,
    lng: -0.4 + index * 0.001,
    edges: [],
  };
}

export function makeEdge(input: MakeEdgeInput): SyntheticEnrichedEdgeV3 {
  const landcoverClass = input.landcoverClass ?? landcoverForComponent(input.componentKind);

  return {
    id: input.id,
    from: input.from,
    to: input.to,
    lengthKm: input.lengthKm,
    highway: input.highway,
    surface: input.surface,
    scenic: input.scenic ?? false,
    osmWayId: syntheticWayId++,
    score: input.score ?? 1,
    componentKind: input.componentKind,
    landcoverClass,
    surfaceConfidence: input.surfaceConfidence ?? 'high',
    completeRouteGroup: input.completeRouteGroup,
    terrainContext: {
      source: 'ign_poc_fixture',
      landcoverClass,
      naturalContextScore: ['forest', 'park', 'grassland'].includes(landcoverClass) ? 0.9 : 0.15,
      artificializationScore: landcoverClass === 'urban' ? 0.8 : 0.1,
      forestProximityM: landcoverClass === 'forest' ? 0 : undefined,
      parkProximityM: landcoverClass === 'park' ? 0 : undefined,
      confidence: input.surfaceConfidence ?? 'high',
      warnings: input.surfaceConfidence === 'low' ? ['weak_surface_confidence'] : [],
    },
  };
}

export function makeGraph(edges: SyntheticEnrichedEdgeV3[]): EnrichedGraph {
  const nodes = new Map<string, GraphNode>();
  const edgeMap = new Map<string, EnrichedEdge>();

  for (const edge of edges) {
    if (!nodes.has(edge.from)) nodes.set(edge.from, makeNode(edge.from, nodes.size));
    if (!nodes.has(edge.to)) nodes.set(edge.to, makeNode(edge.to, nodes.size));

    nodes.get(edge.from)!.edges.push(edge.id);
    nodes.get(edge.to)!.edges.push(edge.id);
    edgeMap.set(edge.id, edge);
  }

  return {
    nodes,
    edges: edgeMap,
    center: { lat: 49, lng: -0.4 },
    radiusKm: 3,
  };
}

export function makeMission(overrides: Partial<MissionContractV3> = {}): MissionContractV3 {
  const targetDistanceKm = overrides.request?.targetDistanceKm ?? 8;

  return {
    id: overrides.id ?? 'synthetic-mission',
    version: 'v3-mission-v1',
    strategy: overrides.strategy ?? 'forest_loop',
    promise: overrides.promise ?? 'trail_with_connector',
    request: {
      start: overrides.request?.start ?? { lat: 49, lng: -0.4 },
      targetDistanceKm,
      minDistanceKm: overrides.request?.minDistanceKm ?? targetDistanceKm * 0.85,
      maxDistanceKm: overrides.request?.maxDistanceKm ?? targetDistanceKm * 1.15,
      sport: 'running',
      mode: overrides.request?.mode ?? 'trail',
      loop: true,
    },
    phases: overrides.phases ?? DEFAULT_PHASES,
    target: overrides.target ?? {
      componentIds: ['target-1'],
      componentKinds: ['forest'],
      requiredEntry: 'mandatory',
      minNaturalDwellKm: 4,
      minContinuousTrailKm: 2,
    },
    budgets: overrides.budgets ?? {
      maxPavedKm: 2,
      maxPavedRatio: 0.3,
      maxBusyRoadRatio: 0.05,
      maxRepeatKm: 1.5,
      maxTargetRepeatKm: 0.1,
      maxConnectorRepeatKm: 1.2,
      maxOverlapRatio: 0.12,
      maxAccessPavedKm: 1.2,
      maxClosurePavedKm: 1.2,
      maxTargetPavedKm: 0.25,
    },
    closure: overrides.closure ?? {
      required: true,
      mode: 'clean_loop',
      maxClosureKm: 1.5,
    },
    relaxations: overrides.relaxations ?? [],
    refusalPolicy: overrides.refusalPolicy ?? {
      refuseIfNoTargetEntry: true,
      refuseIfUnderMinDistance: true,
      refuseIfDominantPavedTrail: true,
      refuseIfMissingGpsGeometry: true,
    },
  };
}

export function syntheticLargeForestLoop(): SyntheticGraphCaseV3 {
  const forestLoop = [
    makeEdge({ id: 'forest-access', from: 'start', to: 'f1', lengthKm: 0.7, surface: 'ground', highway: 'track', componentKind: 'forest' }),
    makeEdge({ id: 'forest-loop-1', from: 'f1', to: 'f2', lengthKm: 2.4, surface: 'ground', highway: 'path', componentKind: 'forest' }),
    makeEdge({ id: 'forest-loop-2', from: 'f2', to: 'f3', lengthKm: 2.3, surface: 'dirt', highway: 'track', componentKind: 'forest' }),
    makeEdge({ id: 'forest-loop-3', from: 'f3', to: 'f4', lengthKm: 2.1, surface: 'earth', highway: 'path', componentKind: 'forest' }),
    makeEdge({ id: 'forest-loop-4', from: 'f4', to: 'f1', lengthKm: 2.2, surface: 'ground', highway: 'track', componentKind: 'forest' }),
    makeEdge({ id: 'scenic-paved-decoy', from: 'start', to: 'f3', lengthKm: 2, surface: 'asphalt', highway: 'service', componentKind: 'scenic_paved', landcoverClass: 'forest', scenic: true }),
  ];

  return {
    id: 'large_forest_loop',
    description: 'Large forest component with a usable natural loop and a shorter scenic-paved decoy.',
    graph: makeGraph(forestLoop),
    mission: makeMission({
      id: 'mission-large-forest-loop',
      strategy: 'forest_loop',
      promise: 'pure_trail',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 10, minDistanceKm: 8, maxDistanceKm: 12, sport: 'running', mode: 'trail', loop: true },
      target: { componentIds: ['forest-core'], componentKinds: ['forest'], requiredEntry: 'mandatory', minNaturalDwellKm: 8, minContinuousTrailKm: 2 },
    }),
    expected: {
      selectableCandidate: true,
      expectedOutcome: 'generated',
      minDistanceKm: 8,
      minNaturalDwellKm: 8,
      maxPavedRatio: 0.25,
      requiredPortfolioLane: 'complete_valid',
      forbiddenTrailEdgeIds: ['scenic-paved-decoy'],
    },
  };
}

export function syntheticTransitionWoodsConnectorThenDwell(): SyntheticGraphCaseV3 {
  return {
    id: 'transition_woods_connector_then_dwell',
    description: 'Village start with an honest paved connector before field/forest dwell; connector repeat is allowed only outside target terrain.',
    graph: makeGraph([
      makeEdge({ id: 'village-paved-access', from: 'start', to: 'woods-entry', lengthKm: 1, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'field-dwell-1', from: 'woods-entry', to: 'field-1', lengthKm: 1.8, surface: 'ground', highway: 'track', componentKind: 'field_paths', landcoverClass: 'grassland' }),
      makeEdge({ id: 'forest-dwell-1', from: 'field-1', to: 'forest-1', lengthKm: 2.1, surface: 'dirt', highway: 'path', componentKind: 'forest' }),
      makeEdge({ id: 'forest-dwell-2', from: 'forest-1', to: 'woods-entry', lengthKm: 2, surface: 'earth', highway: 'track', componentKind: 'forest' }),
      makeEdge({ id: 'residential-decoy-loop', from: 'start', to: 'start-loop', lengthKm: 1.2, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
    ]),
    mission: makeMission({
      id: 'mission-transition-woods',
      strategy: 'transition_to_woods',
      promise: 'trail_with_connector',
      closure: { required: true, mode: 'connector_repeat_allowed', maxClosureKm: 1.2 },
      target: { componentIds: ['field-core', 'forest-core'], componentKinds: ['field_paths', 'forest'], requiredEntry: 'mandatory', minNaturalDwellKm: 4, minContinuousTrailKm: 1.5 },
      budgets: { maxPavedKm: 2.4, maxPavedRatio: 0.32, maxBusyRoadRatio: 0.08, maxRepeatKm: 2.2, maxTargetRepeatKm: 0.1, maxConnectorRepeatKm: 2.1, maxOverlapRatio: 0.18, maxAccessPavedKm: 1.2, maxClosurePavedKm: 1.2, maxTargetPavedKm: 0.2 },
    }),
    expected: {
      selectableCandidate: true,
      expectedOutcome: 'generated',
      minNaturalDwellKm: 4,
      maxPavedRatio: 0.32,
      requiredPortfolioLane: 'complete_valid',
    },
  };
}

export function syntheticParkSmall(): SyntheticGraphCaseV3 {
  return {
    id: 'park_small_adjusted_or_refused',
    description: 'Small park capacity is below requested trail distance; surrounding residential pavement must not be sold as trail.',
    graph: makeGraph([
      makeEdge({ id: 'park-loop-1', from: 'start', to: 'park-1', lengthKm: 0.6, surface: 'fine_gravel', highway: 'path', componentKind: 'park', landcoverClass: 'park' }),
      makeEdge({ id: 'park-loop-2', from: 'park-1', to: 'park-2', lengthKm: 0.8, surface: 'compacted', highway: 'path', componentKind: 'park', landcoverClass: 'park' }),
      makeEdge({ id: 'park-loop-3', from: 'park-2', to: 'start', lengthKm: 0.7, surface: 'paved', highway: 'footway', componentKind: 'park', landcoverClass: 'park' }),
      makeEdge({ id: 'residential-stretch-1', from: 'park-2', to: 'road-1', lengthKm: 2, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
      makeEdge({ id: 'residential-stretch-2', from: 'road-1', to: 'start', lengthKm: 2.1, surface: 'asphalt', highway: 'residential', componentKind: 'residential', landcoverClass: 'urban' }),
    ]),
    mission: makeMission({
      id: 'mission-park-small',
      strategy: 'park_loop',
      promise: 'park_compromise',
      request: { start: { lat: 49, lng: -0.4 }, targetDistanceKm: 6, minDistanceKm: 5.1, maxDistanceKm: 6.9, sport: 'running', mode: 'nature_urbaine', loop: true },
      target: { componentIds: ['park-core'], componentKinds: ['park'], requiredEntry: 'preferred', minNaturalDwellKm: 1.8, minContinuousTrailKm: 0 },
      relaxations: [{ id: 'adjust_to_park_capacity', allowed: true, order: 1, userFacingCompromise: 'Boucle réduite à la capacité réelle du parc.' }],
    }),
    expected: {
      selectableCandidate: true,
      expectedOutcome: 'adjusted',
      minDistanceKm: 1.8,
      requiredPortfolioLane: 'complete_adjustable',
    },
  };
}

export function syntheticRuralPoorSurfaceConfidence(): SyntheticGraphCaseV3 {
  return {
    id: 'rural_poor_surface_confidence_refusal',
    description: 'Connected rural graph with weak surface confidence and unknown road-like segments; a trail promise should refuse rather than fake trail.',
    graph: makeGraph([
      makeEdge({ id: 'rural-road-1', from: 'start', to: 'r1', lengthKm: 1.6, surface: 'unknown', highway: 'unclassified', componentKind: 'residential', landcoverClass: 'agriculture', surfaceConfidence: 'low' }),
      makeEdge({ id: 'rural-track-unknown-1', from: 'r1', to: 'r2', lengthKm: 1.4, surface: 'unknown', highway: 'track', componentKind: 'field_paths', landcoverClass: 'agriculture', surfaceConfidence: 'low' }),
      makeEdge({ id: 'rural-paved-1', from: 'r2', to: 'r3', lengthKm: 1.9, surface: 'asphalt', highway: 'service', componentKind: 'residential', landcoverClass: 'agriculture', surfaceConfidence: 'medium' }),
      makeEdge({ id: 'rural-track-unknown-2', from: 'r3', to: 'start', lengthKm: 1.5, surface: 'unknown', highway: 'track', componentKind: 'field_paths', landcoverClass: 'agriculture', surfaceConfidence: 'low' }),
    ]),
    mission: makeMission({
      id: 'mission-rural-poor-confidence',
      strategy: 'poor_osm_rural',
      promise: 'pure_trail',
      target: { componentIds: ['rural-weak'], componentKinds: ['field_paths'], requiredEntry: 'mandatory', minNaturalDwellKm: 4, minContinuousTrailKm: 2 },
    }),
    expected: {
      selectableCandidate: false,
      expectedOutcome: 'refused',
      requiredBlocker: 'weak_surface_confidence',
    },
  };
}

export function syntheticScenicPavedTrap(): SyntheticGraphCaseV3 {
  return {
    id: 'scenic_paved_trap',
    description: 'Closed scenic asphalt/service-road loop competes with harder natural edges; paved scenic core must remain paved, never trail.',
    graph: makeGraph([
      makeEdge({ id: 'scenic-paved-a1', from: 'start', to: 's1', lengthKm: 2, surface: 'asphalt', highway: 'service', componentKind: 'scenic_paved', landcoverClass: 'forest', scenic: true, completeRouteGroup: 'scenic-asphalt-loop' }),
      makeEdge({ id: 'scenic-paved-a2', from: 's1', to: 's2', lengthKm: 2, surface: 'asphalt', highway: 'service', componentKind: 'scenic_paved', landcoverClass: 'forest', scenic: true, completeRouteGroup: 'scenic-asphalt-loop' }),
      makeEdge({ id: 'scenic-paved-a3', from: 's2', to: 'start', lengthKm: 2, surface: 'asphalt', highway: 'service', componentKind: 'scenic_paved', landcoverClass: 'forest', scenic: true, completeRouteGroup: 'scenic-asphalt-loop' }),
      makeEdge({ id: 'natural-hard-b1', from: 'start', to: 'n1', lengthKm: 1.6, surface: 'ground', highway: 'path', componentKind: 'forest', completeRouteGroup: 'natural-hard-loop' }),
      makeEdge({ id: 'natural-hard-b2', from: 'n1', to: 'n2', lengthKm: 1.7, surface: 'dirt', highway: 'track', componentKind: 'forest', completeRouteGroup: 'natural-hard-loop' }),
      makeEdge({ id: 'natural-hard-b3', from: 'n2', to: 's2', lengthKm: 1.5, surface: 'earth', highway: 'path', componentKind: 'forest', completeRouteGroup: 'natural-hard-loop' }),
    ]),
    mission: makeMission({
      id: 'mission-scenic-paved-trap',
      strategy: 'forest_loop',
      promise: 'pure_trail',
      target: { componentIds: ['forest-core'], componentKinds: ['forest'], requiredEntry: 'mandatory', minNaturalDwellKm: 4, minContinuousTrailKm: 2 },
    }),
    expected: {
      selectableCandidate: false,
      expectedOutcome: 'refused',
      requiredBlocker: 'dominant_paved_scenic_core',
      forbiddenTrailEdgeIds: ['scenic-paved-a1', 'scenic-paved-a2', 'scenic-paved-a3'],
    },
  };
}

function landcoverForComponent(componentKind: TerrainComponentKindV3): TerrainContextLandcoverClass {
  if (componentKind === 'forest' || componentKind === 'scenic_paved') return 'forest';
  if (componentKind === 'park' || componentKind === 'urban_green') return 'park';
  if (componentKind === 'field_paths') return 'grassland';
  if (componentKind === 'river_corridor') return 'water_corridor';
  if (componentKind === 'residential') return 'urban';
  return 'unknown';
}
