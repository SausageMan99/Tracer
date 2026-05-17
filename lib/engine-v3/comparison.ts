import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import {
  BENCHMARK_CASES,
  getTerrainAwarePanelForBenchmark,
  type BenchmarkSummary,
  type RouteBenchmarkCase,
} from '../route-benchmarks';
import { benchmarkToRequestCore, summarizeBenchmarkFailure, summarizeBenchmarkResult } from '../route-benchmarks-core.mjs';
import type { GenerateRouteRequest } from '../types';

export type EngineComparisonOutcome = 'generated' | 'adjusted' | 'refused' | 'errored';
export type EngineComparisonDelta = 'better' | 'equivalent' | 'worse';
export type EngineComparisonVerdictLabel = 'v3_better' | 'v3_equivalent' | 'v3_worse' | 'errored';

export interface EngineSample {
  engine: 'v2.5' | 'v3';
  outcome: EngineComparisonOutcome;
  distanceKm: number | null;
  targetDistanceKm: number;
  distanceErrorRatio: number | null;
  pavedRatio: number | null;
  naturalWayRatio: number | null;
  trailRatio: number | null;
  repeatRatio: number | null;
  durationMs: number | null;
  gpxAvailable: boolean;
  geometryAvailable: boolean;
  reason: string[];
  opportunityCaptureScore: number | null;
  terrainTruthScore: number;
  raw?: unknown;
}

export interface EngineComparisonVerdict {
  productOutcomeDelta: EngineComparisonDelta;
  routeUtilityDelta: number;
  terrainTruthDelta: number;
  opportunityCaptureDelta: number;
  exportRegression: boolean;
  label: EngineComparisonVerdictLabel;
  reason: string[];
}

export interface EngineComparisonCaseResult {
  id: string;
  label: string;
  panel: ReturnType<typeof getTerrainAwarePanelForBenchmark>;
  request: GenerateRouteRequest;
  v25: EngineSample;
  v3: EngineSample;
  verdict: EngineComparisonVerdict;
  artifactPath?: string;
}

export interface EngineComparisonReport {
  schemaVersion: 1;
  generatedAt: string;
  baseUrl: string;
  total: number;
  summary: Record<EngineComparisonVerdictLabel, number>;
  panelSummary: Record<string, EngineComparisonPanelSummary>;
  overallVerdict: EngineComparisonOverallVerdict;
  cases: EngineComparisonCaseResult[];
}

export interface EngineComparisonPanelSummary {
  id: string;
  weight: number;
  total: number;
  weightedScore: number;
  verdicts: Record<EngineComparisonVerdictLabel, number>;
}

export interface EngineComparisonOverallVerdict {
  label: 'green' | 'amber' | 'red';
  weightedScore: number;
  reason: string[];
}

export interface EngineRunContext {
  benchmark: RouteBenchmarkCase;
  request: GenerateRouteRequest;
  endpoint: string;
  timeoutMs: number;
}

export type EngineRunner = (context: EngineRunContext) => Promise<EngineSample>;

export interface RunEngineComparisonOptions {
  cases?: RouteBenchmarkCase[];
  caseFilters?: string[];
  outputPath?: string;
  artifactDir?: string;
  baseUrl?: string;
  runV25?: EngineRunner;
  runV3?: EngineRunner;
  now?: () => Date;
  writeArtifacts?: boolean;
}

const DEFAULT_BASE_URL = 'http://localhost:3000';
const DEFAULT_OUTPUT_PATH = 'artifacts/engine-comparison/latest.json';
const DEFAULT_ARTIFACT_DIR = 'artifacts/engine-comparison/latest-cases';
const DEFAULT_TIMEOUT_MARGIN_MS = 45_000;

export function defaultEngineComparisonCases(): RouteBenchmarkCase[] {
  return BENCHMARK_CASES.filter((benchmark) => benchmark.profileId.startsWith('running_'));
}

export async function runEngineComparison(options: RunEngineComparisonOptions = {}): Promise<EngineComparisonReport> {
  const baseUrl = (options.baseUrl ?? process.env.ENGINE_COMPARISON_BASE_URL ?? DEFAULT_BASE_URL).replace(/\/$/, '');
  const endpoint = `${baseUrl}/api/generate-route`;
  const now = options.now ?? (() => new Date());
  const selectedCases = selectCases(options.cases ?? defaultEngineComparisonCases(), options.caseFilters ?? []);
  const runV25 = options.runV25 ?? runV25AgainstApi;
  const runV3 = options.runV3 ?? runV3AgainstApi;
  const shouldWriteArtifacts = options.writeArtifacts ?? true;
  const artifactDir = options.artifactDir ?? DEFAULT_ARTIFACT_DIR;
  const outputPath = options.outputPath ?? DEFAULT_OUTPUT_PATH;
  const results: EngineComparisonCaseResult[] = [];

  if (shouldWriteArtifacts) await mkdir(artifactDir, { recursive: true });

  for (const benchmark of selectedCases) {
    const request = benchmarkToRequestCore(benchmark);
    const timeoutMs = Math.max(1_000, Number(benchmark.thresholds.maxDurationMs ?? 90_000) + DEFAULT_TIMEOUT_MARGIN_MS);
    const context: EngineRunContext = { benchmark, request, endpoint, timeoutMs };
    const [v25, v3] = await Promise.all([
      runV25(context).catch((error: unknown) => erroredSample('v2.5', benchmark, error)),
      runV3(context).catch((error: unknown) => erroredSample('v3', benchmark, error)),
    ]);
    const result: EngineComparisonCaseResult = {
      id: benchmark.id,
      label: benchmark.label,
      panel: getTerrainAwarePanelForBenchmark(benchmark),
      request,
      v25,
      v3,
      verdict: compareEngineSamples(v25, v3),
    };

    if (shouldWriteArtifacts) {
      const artifactPath = resolve(artifactDir, `${benchmark.id}.comparison.json`);
      await writeFile(artifactPath, `${JSON.stringify(result, null, 2)}\n`, 'utf8');
      result.artifactPath = artifactPath;
    }

    results.push(result);
    if (shouldWriteArtifacts) {
      const partialReport: EngineComparisonReport = {
        schemaVersion: 1,
        generatedAt: now().toISOString(),
        baseUrl,
        total: results.length,
        summary: summarizeComparison(results),
        panelSummary: summarizePanels(results),
        overallVerdict: decideOverallVerdict(results),
        cases: results,
      };
      await mkdir(dirname(outputPath), { recursive: true });
      await writeFile(outputPath, `${JSON.stringify(partialReport, null, 2)}\n`, 'utf8');
    }
  }

  const report: EngineComparisonReport = {
    schemaVersion: 1,
    generatedAt: now().toISOString(),
    baseUrl,
    total: results.length,
    summary: summarizeComparison(results),
    panelSummary: summarizePanels(results),
    overallVerdict: decideOverallVerdict(results),
    cases: results,
  };

  if (shouldWriteArtifacts) {
    await mkdir(dirname(outputPath), { recursive: true });
    await writeFile(outputPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  }

  return report;
}

export function compareEngineSamples(v25: EngineSample, v3: EngineSample): EngineComparisonVerdict {
  const reasons: string[] = [];
  const outcomeDeltaValue = outcomeRank(v3.outcome) - outcomeRank(v25.outcome);
  const productOutcomeDelta = deltaFromNumber(outcomeDeltaValue);
  const exportRegression = v25.gpxAvailable && !v3.gpxAvailable;
  const routeUtilityDelta = roundDelta(routeUtilityScore(v3) - routeUtilityScore(v25));
  const terrainTruthDelta = roundDelta(v3.terrainTruthScore - v25.terrainTruthScore);
  const opportunityCaptureDelta = roundDelta((v3.opportunityCaptureScore ?? 0) - (v25.opportunityCaptureScore ?? 0));

  if (productOutcomeDelta === 'better') reasons.push('V3 improves product outcome rank.');
  if (productOutcomeDelta === 'worse') reasons.push('V3 loses product outcome rank versus V2.5.');
  if (exportRegression) reasons.push('V3 loses GPX/GeoJSON availability while V2.5 had usable export evidence.');
  if ((v25.outcome === 'generated' || v25.outcome === 'adjusted') && v3.outcome === 'refused') reasons.push('V3 refusal is treated as assembly/product weakness when V2.5 produced route evidence.');
  if (v25.outcome === 'refused' && v3.outcome === 'refused') reasons.push('Both engines refuse; speed alone does not make V3 better.');
  if (terrainTruthDelta > 0.05) reasons.push('V3 improves terrain truth metrics without considering speed as primary evidence.');
  if (terrainTruthDelta < -0.05) reasons.push('V3 regresses terrain truth metrics.');
  if (opportunityCaptureDelta > 0.05) reasons.push('V3 improves opportunity capture score.');
  if (opportunityCaptureDelta < -0.05) reasons.push('V3 regresses opportunity capture score.');
  if (reasons.length === 0) reasons.push('No material product, terrain, export or opportunity-capture delta.');

  let label: EngineComparisonVerdictLabel;
  if (v25.outcome === 'errored' || v3.outcome === 'errored') {
    label = 'errored';
  } else if (exportRegression || productOutcomeDelta === 'worse' || routeUtilityDelta < -0.12) {
    label = 'v3_worse';
  } else if (productOutcomeDelta === 'better' || (routeUtilityDelta > 0.12 && terrainTruthDelta >= -0.05 && !exportRegression)) {
    label = 'v3_better';
  } else {
    label = 'v3_equivalent';
  }

  return {
    productOutcomeDelta,
    routeUtilityDelta,
    terrainTruthDelta,
    opportunityCaptureDelta,
    exportRegression,
    label,
    reason: reasons,
  };
}

export function sampleFromV25BenchmarkSummary(benchmark: RouteBenchmarkCase, summary: BenchmarkSummary): EngineSample {
  const metrics = summary.metrics;
  const outcome = v25OutcomeFromSummary(summary);
  const hasRouteEvidence = outcome !== 'errored' && outcome !== 'refused' && finiteOrNull(metrics.distanceKm) !== null;
  return {
    engine: 'v2.5',
    outcome,
    distanceKm: finiteOrNull(metrics.distanceKm),
    targetDistanceKm: benchmark.targetDistanceKm,
    distanceErrorRatio: finiteOrNull(metrics.distanceErrorRatio),
    pavedRatio: finiteOrNull(metrics.pavedRatio),
    naturalWayRatio: finiteOrNull(metrics.naturalWayRatio),
    trailRatio: finiteOrNull(metrics.trailRatio),
    repeatRatio: finiteOrNull(metrics.repeatEdgeRatio),
    durationMs: finiteOrNull(metrics.durationMs),
    gpxAvailable: hasRouteEvidence,
    geometryAvailable: hasRouteEvidence,
    reason: summary.failures.length > 0 ? summary.failures : [metrics.actualOutcome ?? 'route_success'],
    opportunityCaptureScore: finiteOrNull(metrics.opportunityCapture?.opportunityCaptureScore),
    terrainTruthScore: terrainTruthScore({
      pavedRatio: metrics.pavedRatio,
      naturalWayRatio: metrics.naturalWayRatio,
      trailRatio: metrics.trailRatio,
      repeatRatio: metrics.repeatEdgeRatio,
    }),
    raw: summary,
  };
}

export function sampleFromV3ApiResponse(
  benchmark: RouteBenchmarkCase,
  response: V3ApiComparisonResponse,
  durationMs: number | null = null,
): EngineSample {
  const metrics = response.metrics;
  const hasGeometry = response.routeGeoJson?.geometry?.coordinates != null && response.routeGeoJson.geometry.coordinates.length >= 2;
  return {
    engine: 'v3',
    outcome: response.betaOutcome,
    distanceKm: finiteOrNull(metrics?.distanceProducedKm),
    targetDistanceKm: benchmark.targetDistanceKm,
    distanceErrorRatio: metrics?.distanceProducedKm == null
      ? null
      : Math.abs(metrics.distanceProducedKm - benchmark.targetDistanceKm) / Math.max(benchmark.targetDistanceKm, 0.001),
    pavedRatio: finiteOrNull(metrics?.pavedRatio),
    naturalWayRatio: finiteOrNull(metrics?.naturalWayRatio),
    trailRatio: finiteOrNull(metrics?.trailRatio),
    repeatRatio: finiteOrNull(metrics?.repeatRatio),
    durationMs,
    gpxAvailable: response.gpxAvailable === true,
    geometryAvailable: hasGeometry,
    reason: [response.reason, ...response.warnings].filter((value) => value.trim().length > 0),
    opportunityCaptureScore: estimateV3OpportunityCaptureScore(metrics),
    terrainTruthScore: terrainTruthScore({
      pavedRatio: metrics?.pavedRatio,
      naturalWayRatio: metrics?.naturalWayRatio,
      trailRatio: metrics?.trailRatio,
      repeatRatio: metrics?.repeatRatio,
    }),
    raw: response,
  };
}

async function runV25AgainstApi(context: EngineRunContext): Promise<EngineSample> {
  const started = Date.now();
  const payload = await postJson(context.endpoint, {
    ...context.request,
    includeEdgeDiagnostics: true,
    includeGenerationDiagnostics: true,
  }, context.timeoutMs);
  const durationMs = Date.now() - started;
  const routePayload = payload.body.route as Parameters<typeof summarizeBenchmarkResult>[1] | undefined;
  const summary = (payload.ok && payload.body.success === true
    ? summarizeBenchmarkResult(context.benchmark, routePayload ?? ({ distanceKm: 0, ascendM: 0 }), durationMs)
    : summarizeBenchmarkFailure(context.benchmark, {
      status: payload.status,
      durationMs,
      errorCode: stringOrUndefined(payload.body.errorCode),
      subCode: typeof payload.body.subCode === 'string' ? payload.body.subCode : null,
      error: typeof payload.body.error === 'string' ? payload.body.error : null,
      rejectedCandidatesDiagnostics: payload.body.rejectedCandidatesDiagnostics,
      stageTimings: payload.body.stageTimings,
      generationDiagnostics: payload.body.generationDiagnostics,
    })) as BenchmarkSummary;
  return sampleFromV25BenchmarkSummary(context.benchmark, summary);
}

async function runV3AgainstApi(context: EngineRunContext): Promise<EngineSample> {
  const started = Date.now();
  const payload = await postJson(context.endpoint, {
    ...context.request,
    engineVersion: 'v3_experimental',
  }, context.timeoutMs);
  const durationMs = Date.now() - started;
  if (!payload.ok || payload.body.engine !== 'v3-clean-room') {
    return erroredSample('v3', context.benchmark, payload.body.error ?? `Unexpected V3 response status ${payload.status}`);
  }
  return sampleFromV3ApiResponse(context.benchmark, payload.body as unknown as V3ApiComparisonResponse, durationMs);
}

interface V3ApiComparisonResponse {
  engine: 'v3-clean-room';
  betaOutcome: Exclude<EngineComparisonOutcome, 'errored'>;
  metrics: {
    distanceProducedKm: number;
    pavedRatio: number;
    naturalWayRatio: number;
    trailRatio: number;
    repeatRatio: number;
    naturalDwellKm?: number;
    targetDistanceKm?: number;
  } | null;
  reason: string;
  warnings: string[];
  routeGeoJson: { geometry: { coordinates: number[][] } } | null;
  gpxAvailable: boolean;
}

async function postJson(endpoint: string, body: Record<string, unknown>, timeoutMs: number): Promise<{ ok: boolean; status: number; body: Record<string, unknown> }> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const response = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
      signal: controller.signal,
    });
    const parsed = await response.json().catch(() => ({}));
    return { ok: response.ok, status: response.status, body: isRecord(parsed) ? parsed : {} };
  } finally {
    clearTimeout(timeout);
  }
}

function selectCases(cases: RouteBenchmarkCase[], filters: string[]): RouteBenchmarkCase[] {
  if (filters.length === 0) return cases;
  return cases.filter((benchmark) => filters.some((filter) => benchmark.id === filter || benchmark.id.startsWith(filter) || benchmark.id.includes(filter)));
}

function summarizeComparison(results: EngineComparisonCaseResult[]): Record<EngineComparisonVerdictLabel, number> {
  const summary: Record<EngineComparisonVerdictLabel, number> = emptyVerdictCounts();
  for (const result of results) summary[result.verdict.label] += 1;
  return summary;
}

function summarizePanels(results: EngineComparisonCaseResult[]): Record<string, EngineComparisonPanelSummary> {
  const summaries: Record<string, EngineComparisonPanelSummary> = {};
  for (const result of results) {
    const panelId = result.panel?.id ?? 'unpanelled';
    const summary = summaries[panelId] ?? {
      id: panelId,
      weight: panelWeight(panelId),
      total: 0,
      weightedScore: 0,
      verdicts: emptyVerdictCounts(),
    };
    summary.total += 1;
    summary.verdicts[result.verdict.label] += 1;
    summary.weightedScore = roundDelta(summary.weightedScore + verdictScore(result.verdict.label) * summary.weight);
    summaries[panelId] = summary;
  }
  return summaries;
}

function decideOverallVerdict(results: EngineComparisonCaseResult[]): EngineComparisonOverallVerdict {
  const panelSummary = summarizePanels(results);
  const weightedScore = roundDelta(Object.values(panelSummary).reduce((sum, panel) => sum + panel.weightedScore, 0));
  const criticalRegressionPanels = Object.values(panelSummary).filter((panel) => panel.weight >= 2 && panel.weightedScore < 0);
  const reasons: string[] = [];
  if (criticalRegressionPanels.length > 0) {
    reasons.push(`Critical weighted panel regression: ${criticalRegressionPanels.map((panel) => panel.id).join(', ')}.`);
  }
  if (results.some((result) => result.verdict.exportRegression)) {
    reasons.push('At least one V3 case loses GPX/GeoJSON evidence that V2.5 had.');
  }
  if (reasons.length === 0) reasons.push('Weighted panel comparison has no critical product regression.');
  const label = criticalRegressionPanels.length > 0 || weightedScore < 0 ? 'red' : weightedScore > 0 ? 'green' : 'amber';
  return { label, weightedScore, reason: reasons };
}

function emptyVerdictCounts(): Record<EngineComparisonVerdictLabel, number> {
  return {
    v3_better: 0,
    v3_equivalent: 0,
    v3_worse: 0,
    errored: 0,
  };
}

function panelWeight(panelId: string): number {
  if (panelId === 'true_forest_trail') return 3;
  if (panelId === 'transition_to_woods') return 3;
  if (panelId === 'park_recovery' || panelId === 'urban_nature') return 2;
  if (panelId === 'poor_osm_rural') return 1.5;
  if (panelId === 'negative_impossible') return 1;
  return 1;
}

function verdictScore(label: EngineComparisonVerdictLabel): number {
  if (label === 'v3_better') return 1;
  if (label === 'v3_worse' || label === 'errored') return -1;
  return 0;
}

function v25OutcomeFromSummary(summary: BenchmarkSummary): EngineComparisonOutcome {
  const actualOutcome = summary.metrics.actualOutcome;
  if (actualOutcome === 'route_success' || actualOutcome === 'exact_distance') return 'generated';
  if (actualOutcome === 'adjusted_distance' || actualOutcome === 'best_effort_route') return 'adjusted';
  if (actualOutcome === 'typed_refusal') return 'refused';
  return summary.passed ? 'generated' : 'errored';
}

function erroredSample(engine: EngineSample['engine'], benchmark: RouteBenchmarkCase, error: unknown): EngineSample {
  const message = error instanceof Error ? error.message : String(error);
  return {
    engine,
    outcome: 'errored',
    distanceKm: null,
    targetDistanceKm: benchmark.targetDistanceKm,
    distanceErrorRatio: null,
    pavedRatio: null,
    naturalWayRatio: null,
    trailRatio: null,
    repeatRatio: null,
    durationMs: null,
    gpxAvailable: false,
    geometryAvailable: false,
    reason: [message],
    opportunityCaptureScore: null,
    terrainTruthScore: 0,
    raw: { error: message },
  };
}

function routeUtilityScore(sample: EngineSample): number {
  const outcomeScore = outcomeRank(sample.outcome) / 3;
  const distanceScore = sample.distanceErrorRatio == null ? 0 : Math.max(0, 1 - sample.distanceErrorRatio * 4);
  const exportScore = sample.gpxAvailable && sample.geometryAvailable ? 1 : 0;
  const repeatScore = sample.repeatRatio == null ? 0.5 : Math.max(0, 1 - sample.repeatRatio * 3);
  return roundScore(outcomeScore * 0.45 + distanceScore * 0.2 + sample.terrainTruthScore * 0.2 + exportScore * 0.1 + repeatScore * 0.05);
}

function terrainTruthScore(metrics: { pavedRatio?: number | null; naturalWayRatio?: number | null; trailRatio?: number | null; repeatRatio?: number | null }): number {
  const paved = clampRatio(metrics.pavedRatio ?? 1);
  const natural = clampRatio(metrics.naturalWayRatio ?? 0);
  const trail = clampRatio(metrics.trailRatio ?? 0);
  const repeat = clampRatio(metrics.repeatRatio ?? 0);
  return roundScore(natural * 0.45 + trail * 0.25 + (1 - paved) * 0.2 + (1 - repeat) * 0.1);
}

function estimateV3OpportunityCaptureScore(metrics: V3ApiComparisonResponse['metrics']): number | null {
  if (metrics == null) return null;
  const target = Math.max(metrics.targetDistanceKm ?? 0, 0.001);
  const naturalDwellRatio = clampRatio((metrics.naturalDwellKm ?? 0) / target);
  return roundScore(naturalDwellRatio * 0.45 + metrics.naturalWayRatio * 0.3 + (1 - metrics.pavedRatio) * 0.2 + (1 - metrics.repeatRatio) * 0.05);
}

function outcomeRank(outcome: EngineComparisonOutcome): number {
  if (outcome === 'generated') return 3;
  if (outcome === 'adjusted') return 2;
  if (outcome === 'refused') return 1;
  return 0;
}

function deltaFromNumber(value: number): EngineComparisonDelta {
  if (value > 0) return 'better';
  if (value < 0) return 'worse';
  return 'equivalent';
}

function finiteOrNull(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

function clampRatio(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function roundScore(value: number): number {
  return Number(Math.max(0, Math.min(1, value)).toFixed(5));
}

function roundDelta(value: number): number {
  return Number(value.toFixed(5));
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function stringOrUndefined(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined;
}
