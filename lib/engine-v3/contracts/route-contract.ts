import type { TerrainComponentKindV3 } from '../types';
import type { TerrainInventoryComponentV3, TerrainInventoryV3 } from '../assemblers/terrain-inventory';

export type RouteContractStrategyV3 = 'forest_loop';

export type RouteContractViolationKindV3 =
  | 'distance'
  | 'paved'
  | 'natural_dwell'
  | 'target_dwell'
  | 'repeat'
  | 'closure'
  | 'no_loopable_component'
  | 'access_too_paved';

export interface RouteContractViolationV3 {
  kind: RouteContractViolationKindV3;
  severity: 'blocking' | 'adjustment';
  message: string;
  observed?: number | null;
  required?: number;
  componentId?: string;
}

export interface RouteContractV3 {
  id: string;
  version: 'v3-route-contract-v1';
  strategy: RouteContractStrategyV3;
  requestedDistanceKm: number;
  generatedDistanceRangeKm: { min: number; max: number };
  adjustedDistanceRangeKm: { min: number; max: number };
  maxPavedRatio: number;
  minNaturalWayRatio: number;
  minNaturalDwellKm: number;
  minTargetComponentDwellKm: number;
  maxRepeatEdgeKm: number;
  targetComponentIds: TerrainComponentKindV3[];
  closurePolicy: {
    required: true;
    mode: 'clean_loop';
    maxClosureKm: number;
  };
  accessTransitionBudget: {
    maxPavedKm: number;
    maxTotalKm: number;
  };
}

export type RouteContractPrecheckStatusV3 = 'generated_plausible' | 'adjusted_plausible' | 'refused_likely';

export interface RouteContractPrecheckV3 {
  status: RouteContractPrecheckStatusV3;
  contract: RouteContractV3;
  reasons: string[];
  violations: RouteContractViolationV3[];
  selectedComponent: TerrainInventoryComponentV3 | null;
  inventorySummary: {
    reachableNonPavedKm: number;
    componentCount: number;
    estimatedLoopableNaturalKm: number;
    bestNaturalSkeletonKm: number;
  };
}

export interface BuildForestLoopRouteContractInputV3 {
  requestedDistanceKm: number;
  targetComponentIds: TerrainComponentKindV3[];
}

export interface PrecheckForestLoopRouteContractInputV3 {
  contract: RouteContractV3;
  inventory: TerrainInventoryV3;
}

const GENERATED_MIN_RATIO = 0.9;
const GENERATED_MAX_RATIO = 1.1;
const ADJUSTED_MIN_RATIO = 0.75;
const ADJUSTED_MAX_RATIO = 1.25;
const FOREST_LOOP_MAX_PAVED_RATIO = 0.2;
const FOREST_LOOP_MIN_NATURAL_WAY_RATIO = 0.65;
const FOREST_LOOP_MIN_NATURAL_DWELL_RATIO = 0.55;
const FOREST_LOOP_MIN_TARGET_DWELL_RATIO = 0.45;
const FOREST_LOOP_MAX_REPEAT_RATIO = 0.12;
const FOREST_LOOP_MAX_CLOSURE_RATIO = 0.18;
const FOREST_LOOP_MAX_ACCESS_PAVED_RATIO = 0.12;
const FOREST_LOOP_MAX_ACCESS_TOTAL_RATIO = 0.18;
const ADJUSTED_TARGET_DWELL_FACTOR = 0.65;
const ADJUSTED_NATURAL_DWELL_FACTOR = 0.65;

export function buildForestLoopRouteContractV3(input: BuildForestLoopRouteContractInputV3): RouteContractV3 {
  const requestedDistanceKm = round(input.requestedDistanceKm);
  return {
    id: `route-contract-forest-loop-${requestedDistanceKm}k`,
    version: 'v3-route-contract-v1',
    strategy: 'forest_loop',
    requestedDistanceKm,
    generatedDistanceRangeKm: {
      min: round(requestedDistanceKm * GENERATED_MIN_RATIO),
      max: round(requestedDistanceKm * GENERATED_MAX_RATIO),
    },
    adjustedDistanceRangeKm: {
      min: round(requestedDistanceKm * ADJUSTED_MIN_RATIO),
      max: round(requestedDistanceKm * ADJUSTED_MAX_RATIO),
    },
    maxPavedRatio: FOREST_LOOP_MAX_PAVED_RATIO,
    minNaturalWayRatio: FOREST_LOOP_MIN_NATURAL_WAY_RATIO,
    minNaturalDwellKm: round(requestedDistanceKm * FOREST_LOOP_MIN_NATURAL_DWELL_RATIO),
    minTargetComponentDwellKm: round(requestedDistanceKm * FOREST_LOOP_MIN_TARGET_DWELL_RATIO),
    maxRepeatEdgeKm: round(requestedDistanceKm * FOREST_LOOP_MAX_REPEAT_RATIO),
    targetComponentIds: [...input.targetComponentIds],
    closurePolicy: {
      required: true,
      mode: 'clean_loop',
      maxClosureKm: round(requestedDistanceKm * FOREST_LOOP_MAX_CLOSURE_RATIO),
    },
    accessTransitionBudget: {
      maxPavedKm: round(requestedDistanceKm * FOREST_LOOP_MAX_ACCESS_PAVED_RATIO),
      maxTotalKm: round(requestedDistanceKm * FOREST_LOOP_MAX_ACCESS_TOTAL_RATIO),
    },
  };
}

export function precheckForestLoopRouteContractV3(
  input: PrecheckForestLoopRouteContractInputV3,
): RouteContractPrecheckV3 {
  const selectedComponent = input.inventory.components[0] ?? null;
  const violations = selectedComponent
    ? componentViolations(input.contract, selectedComponent)
    : [noLoopableComponentViolation(input.contract)];
  if (selectedComponent && input.inventory.totals.estimatedLoopableNaturalKm <= 0) {
    violations.push(noLoopableComponentViolation(input.contract));
  }

  const blockingViolations = violations.filter((violation) => violation.severity === 'blocking');
  const status = precheckStatus(input.contract, input.inventory, selectedComponent, violations, blockingViolations);

  return {
    status,
    contract: input.contract,
    reasons: reasonsFor(status, violations),
    violations,
    selectedComponent,
    inventorySummary: {
      reachableNonPavedKm: input.inventory.reachableNonPavedKm,
      componentCount: input.inventory.componentCount,
      estimatedLoopableNaturalKm: input.inventory.totals.estimatedLoopableNaturalKm,
      bestNaturalSkeletonKm: input.inventory.totals.bestNaturalSkeletonKm,
    },
  };
}

function componentViolations(contract: RouteContractV3, component: TerrainInventoryComponentV3): RouteContractViolationV3[] {
  const violations: RouteContractViolationV3[] = [];
  if (component.estimatedLoopableNaturalKm <= 0) {
    violations.push(noLoopableComponentViolation(contract, component.componentId));
  }
  if (component.estimatedLoopableNaturalKm < contract.minNaturalDwellKm) {
    violations.push({
      kind: 'natural_dwell',
      severity: component.estimatedLoopableNaturalKm >= contract.minNaturalDwellKm * ADJUSTED_NATURAL_DWELL_FACTOR ? 'adjustment' : 'blocking',
      message: 'loopable natural dwell capacity is below generated forest_loop contract',
      observed: component.estimatedLoopableNaturalKm,
      required: contract.minNaturalDwellKm,
      componentId: component.componentId,
    });
  }
  if (component.estimatedLoopableNaturalKm < contract.minTargetComponentDwellKm) {
    violations.push({
      kind: 'target_dwell',
      severity: component.estimatedLoopableNaturalKm >= contract.minTargetComponentDwellKm * ADJUSTED_TARGET_DWELL_FACTOR ? 'adjustment' : 'blocking',
      message: 'target component dwell capacity is below generated forest_loop contract',
      observed: component.estimatedLoopableNaturalKm,
      required: contract.minTargetComponentDwellKm,
      componentId: component.componentId,
    });
  }
  if (component.estimatedClosureCostKm === null) {
    violations.push({
      kind: 'closure',
      severity: 'blocking',
      message: 'no two-core portal exists for a clean loop closure',
      observed: null,
      required: contract.closurePolicy.maxClosureKm,
      componentId: component.componentId,
    });
  } else if (component.estimatedClosureCostKm > contract.closurePolicy.maxClosureKm) {
    violations.push({
      kind: 'closure',
      severity: component.estimatedClosureCostKm <= contract.closurePolicy.maxClosureKm * 1.5 ? 'adjustment' : 'blocking',
      message: 'estimated closure/access cost exceeds forest_loop clean-loop budget',
      observed: component.estimatedClosureCostKm,
      required: contract.closurePolicy.maxClosureKm,
      componentId: component.componentId,
    });
  }
  if (component.accessPavedKm > contract.accessTransitionBudget.maxPavedKm) {
    violations.push({
      kind: 'access_too_paved',
      severity: component.accessPavedKm <= contract.accessTransitionBudget.maxPavedKm * 1.5 ? 'adjustment' : 'blocking',
      message: 'paved access transition exceeds forest_loop budget',
      observed: component.accessPavedKm,
      required: contract.accessTransitionBudget.maxPavedKm,
      componentId: component.componentId,
    });
  }
  return violations;
}

function precheckStatus(
  contract: RouteContractV3,
  inventory: TerrainInventoryV3,
  selectedComponent: TerrainInventoryComponentV3 | null,
  violations: RouteContractViolationV3[],
  blockingViolations: RouteContractViolationV3[],
): RouteContractPrecheckStatusV3 {
  if (!selectedComponent) return 'refused_likely';
  if (blockingViolations.some((violation) => violation.kind === 'no_loopable_component' || violation.kind === 'closure')) {
    return 'refused_likely';
  }
  if (blockingViolations.length === 0 && violations.length === 0) return 'generated_plausible';
  const adjustedNaturalKm = inventory.totals.estimatedLoopableNaturalKm >= contract.minNaturalDwellKm * ADJUSTED_NATURAL_DWELL_FACTOR;
  const adjustedTargetKm = selectedComponent.estimatedLoopableNaturalKm >= contract.minTargetComponentDwellKm * ADJUSTED_TARGET_DWELL_FACTOR;
  const hasCleanClosure = selectedComponent.estimatedClosureCostKm !== null;
  if (adjustedNaturalKm && adjustedTargetKm && hasCleanClosure) return 'adjusted_plausible';
  return 'refused_likely';
}

function noLoopableComponentViolation(contract: RouteContractV3, componentId?: string): RouteContractViolationV3 {
  return {
    kind: 'no_loopable_component',
    severity: 'blocking',
    message: 'no reachable two-core natural component can support a forest_loop contract',
    observed: 0,
    required: contract.minTargetComponentDwellKm,
    componentId,
  };
}

function reasonsFor(status: RouteContractPrecheckStatusV3, violations: RouteContractViolationV3[]): string[] {
  if (status === 'generated_plausible') {
    return ['terrain inventory satisfies generated forest_loop route contract'];
  }
  if (status === 'adjusted_plausible') {
    return [
      'loopable natural capacity is below generated forest_loop dwell contract but enough for adjusted route evidence',
      ...violations.map((violation) => violation.message),
    ];
  }
  return [
    'terrain inventory cannot honestly satisfy forest_loop route contract',
    ...violations.map((violation) => violation.message),
  ];
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}
