import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';

import { generateRouteV3, type GeneratedRouteV3 } from './route-generator';
import type {
  CorridorMissionV3,
  RouteConstraintsV3,
  RouteMetricsV3,
  RouteOutcomeV3,
  RouteStrategyV3,
  TerrainSnapshotV3,
  UserRouteRequestV3,
} from './types';

export interface EngineV3SmokeCase {
  caseId: string;
  name: string;
  request: UserRouteRequestV3;
  snapshot: TerrainSnapshotV3;
}

export interface EngineV3SmokeDiagnostic {
  caseId: string;
  name: string;
  outcome: RouteOutcomeV3;
  intent: {
    strategy: RouteStrategyV3;
    constraints: RouteConstraintsV3;
  };
  mission: Pick<CorridorMissionV3, 'anchor' | 'returnMode' | 'cleanReturn' | 'targetComponents'>;
  metrics: RouteMetricsV3;
  warnings: string[];
  reasonsOrCompromises: string[];
}

export interface EngineV3SmokeReport {
  engine: 'v3-clean-room';
  cases: EngineV3SmokeDiagnostic[];
}

export interface RunEngineV3SmokePanelOptions {
  writeArtifactPath?: string;
}

export const ENGINE_V3_SMOKE_CASES: EngineV3SmokeCase[] = [
  {
    caseId: 'tourville-like-transition-to-woods',
    name: 'Tourville-like start with scenic pavement and reachable woods',
    request: {
      start: { lat: 49.31, lng: 0.88 },
      targetDistanceKm: 12,
      activity: 'running',
      mode: 'trail',
      loop: true,
    },
    snapshot: {
      audit: { confidence: 'medium', edgeCount: 210, totalLengthKm: 39, pavedRatio: 0.42, nonPavedRatio: 0.58, warnings: [] },
      components: [
        { id: 'tourville-asphalt-scenic', kind: 'scenic_paved', distanceFromStartKm: 0.2, edgeCount: 25, totalLengthKm: 7, pavedRatio: 1, nonPavedRatio: 0, confidence: 'high' },
        { id: 'tourville-woods', kind: 'forest', distanceFromStartKm: 1.1, edgeCount: 95, totalLengthKm: 18, pavedRatio: 0.18, nonPavedRatio: 0.82, confidence: 'medium' },
      ],
    },
  },
  {
    caseId: 'fontainebleau-like-forest-loop',
    name: 'Fontainebleau-like high-confidence forest loop',
    request: {
      start: { lat: 48.404, lng: 2.701 },
      targetDistanceKm: 12,
      activity: 'running',
      mode: 'trail',
      loop: true,
    },
    snapshot: {
      audit: { confidence: 'high', edgeCount: 420, totalLengthKm: 92, pavedRatio: 0.18, nonPavedRatio: 0.82, warnings: [] },
      components: [
        { id: 'fontainebleau-forest', kind: 'forest', distanceFromStartKm: 0.2, edgeCount: 340, totalLengthKm: 25, pavedRatio: 0.1, nonPavedRatio: 0.9, confidence: 'high' },
      ],
    },
  },
  {
    caseId: 'caen-park-short-loop',
    name: 'Caen park short urban-nature loop with paved compromises',
    request: {
      start: { lat: 49.2, lng: -0.37 },
      targetDistanceKm: 6,
      activity: 'running',
      mode: 'nature_urbaine',
      loop: true,
    },
    snapshot: {
      audit: { confidence: 'medium', edgeCount: 95, totalLengthKm: 13, pavedRatio: 0.55, nonPavedRatio: 0.45, warnings: ['park network contains paved paths'] },
      components: [
        { id: 'caen-park', kind: 'park', distanceFromStartKm: 0.25, edgeCount: 70, totalLengthKm: 8, pavedRatio: 0.6, nonPavedRatio: 0.4, confidence: 'medium' },
      ],
    },
  },
  {
    caseId: 'paris-urban-nature',
    name: 'Paris urban nature without pretending forest trail evidence',
    request: {
      start: { lat: 48.879, lng: 2.381 },
      targetDistanceKm: 7,
      activity: 'running',
      mode: 'nature_urbaine',
      loop: true,
    },
    snapshot: {
      audit: { confidence: 'medium', edgeCount: 260, totalLengthKm: 28, pavedRatio: 0.78, nonPavedRatio: 0.22, warnings: ['dense urban surface mix'] },
      components: [
        { id: 'paris-urban-green', kind: 'urban_green', distanceFromStartKm: 0.3, edgeCount: 90, totalLengthKm: 8, pavedRatio: 0.75, nonPavedRatio: 0.25, confidence: 'medium' },
        { id: 'paris-river-corridor', kind: 'river_corridor', distanceFromStartKm: 0.6, edgeCount: 120, totalLengthKm: 9, pavedRatio: 0.85, nonPavedRatio: 0.15, confidence: 'medium' },
      ],
    },
  },
  {
    caseId: 'poor-rural-refusal',
    name: 'Poor rural evidence refuses instead of fabricating an unroutable trail',
    request: {
      start: { lat: 48.9, lng: 0.15 },
      targetDistanceKm: 10,
      activity: 'running',
      mode: 'trail',
      loop: true,
    },
    snapshot: {
      audit: { confidence: 'low', edgeCount: 8, totalLengthKm: 2, pavedRatio: 0.9, nonPavedRatio: 0.1, warnings: ['sparse rural graph'] },
      components: [],
    },
  },
];

export function runEngineV3SmokePanel(options: RunEngineV3SmokePanelOptions = {}): EngineV3SmokeReport {
  const report: EngineV3SmokeReport = {
    engine: 'v3-clean-room',
    cases: ENGINE_V3_SMOKE_CASES.map(runSmokeCase),
  };

  if (options.writeArtifactPath) {
    mkdirSync(dirname(options.writeArtifactPath), { recursive: true });
    writeFileSync(options.writeArtifactPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  return report;
}

function runSmokeCase(smokeCase: EngineV3SmokeCase): EngineV3SmokeDiagnostic {
  const generated = generateRouteV3(smokeCase.request, smokeCase.snapshot);
  return toDiagnostic(smokeCase, generated);
}

function toDiagnostic(smokeCase: EngineV3SmokeCase, generated: GeneratedRouteV3): EngineV3SmokeDiagnostic {
  return {
    caseId: smokeCase.caseId,
    name: smokeCase.name,
    outcome: cloneOutcome(generated.outcome),
    intent: {
      strategy: generated.intent.strategy,
      constraints: {
        ...generated.intent.constraints,
        targetComponents: [...generated.intent.constraints.targetComponents],
      },
    },
    mission: {
      anchor: generated.mission.anchor ? { ...generated.mission.anchor } : null,
      returnMode: generated.mission.returnMode,
      cleanReturn: generated.mission.cleanReturn,
      targetComponents: [...generated.mission.targetComponents],
    },
    metrics: { ...generated.route.metrics },
    warnings: unique([...generated.intent.warnings, ...generated.mission.warnings, ...generated.route.warnings]),
    reasonsOrCompromises: reasonsOrCompromises(generated.outcome),
  };
}

function reasonsOrCompromises(outcome: RouteOutcomeV3): string[] {
  if (outcome.type === 'adjusted') return [...outcome.compromises];
  if (outcome.type === 'refused') return [outcome.reason, ...(outcome.details ?? [])];
  return [outcome.summary];
}

function cloneOutcome(outcome: RouteOutcomeV3): RouteOutcomeV3 {
  if (outcome.type === 'adjusted') return { ...outcome, compromises: [...outcome.compromises] };
  if (outcome.type === 'refused') return { ...outcome, details: outcome.details ? [...outcome.details] : undefined };
  return { ...outcome };
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}
