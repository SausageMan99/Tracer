import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { dirname } from 'node:path';

import type { EngineV3BenchmarkReport } from './benchmark-runner';

type OutcomeType = 'generated' | 'adjusted' | 'refused' | 'errored';
export type EngineV3ProductVerdict = 'good_route' | 'acceptable_adjusted' | 'honest_refusal' | 'engine_failure' | 'fake_success';

interface LooseBenchmarkCase {
  id: string;
  name: string;
  outcome: { type: OutcomeType; reason?: string; summary?: string };
  outcomeReasons?: string[];
  metrics: Record<string, unknown> | null;
  warnings?: string[];
  artifacts?: { json?: string; geojson?: string; gpx?: string };
  timings?: Record<string, unknown>;
  diagnostics?: Record<string, unknown>;
}

interface LooseBenchmarkReport extends Omit<EngineV3BenchmarkReport, 'cases'> {
  cases: LooseBenchmarkCase[];
}

export interface EngineV3BestRejectedCandidateSummary {
  id: string | null;
  rank: number | null;
  distanceKm: number | null;
  naturalDwellKm: number | null;
  pavedRatio: number | null;
  repeatEdgeKm: number | null;
  targetRepeatKm: number | null;
  connectorRepeatKm: number | null;
  busyRoadRatio: number | null;
  rejectionReason: string | null;
}

export interface EngineV3BenchmarkCaseSummary {
  id: string;
  name: string;
  outcome: OutcomeType;
  verdict: EngineV3ProductVerdict;
  targetDistanceKm: number | null;
  distanceProducedKm: number | null;
  trailRatio: number | null;
  naturalWayRatio: number | null;
  pavedRatio: number | null;
  naturalDwellKm: number | null;
  longestTrailSegmentKm: number | null;
  repeatEdgeKm: number | null;
  targetRepeatKm: number | null;
  connectorRepeatKm: number | null;
  busyRoadRatio: number | null;
  bestRejectedCandidate: EngineV3BestRejectedCandidateSummary | null;
  rejectionReason: string | null;
  artifacts: { json: string | null; geojson: string | null; gpx: string | null };
}

export interface EngineV3BenchmarkCtoSummary {
  sourceReport?: string;
  engine: string;
  panelKind: string;
  generatedAt: string;
  harnessSuccess: boolean;
  outcomeCounts: Record<OutcomeType, number>;
  verdictCounts: Record<EngineV3ProductVerdict, number>;
  cases: EngineV3BenchmarkCaseSummary[];
}

export interface WriteEngineV3BenchmarkSummaryOptions {
  inputPath: string;
  outputJsonPath: string;
  outputMarkdownPath: string;
}

export async function writeEngineV3BenchmarkSummaryFromFile(options: WriteEngineV3BenchmarkSummaryOptions): Promise<EngineV3BenchmarkCtoSummary> {
  const report = await readBenchmarkReportWithArtifacts(options.inputPath);
  const summary = summarizeEngineV3BenchmarkReport(report, options.inputPath);

  await mkdir(dirname(options.outputJsonPath), { recursive: true });
  await writeFile(options.outputJsonPath, `${JSON.stringify(summary, null, 2)}\n`, 'utf8');
  await mkdir(dirname(options.outputMarkdownPath), { recursive: true });
  await writeFile(options.outputMarkdownPath, renderEngineV3BenchmarkSummaryMarkdown(summary), 'utf8');

  return summary;
}

export async function readBenchmarkReportWithArtifacts(inputPath: string): Promise<LooseBenchmarkReport> {
  const report = JSON.parse(await readFile(inputPath, 'utf8')) as LooseBenchmarkReport;
  const cases = await Promise.all(report.cases.map(async (benchmarkCase) => {
    const artifactPath = benchmarkCase.artifacts?.json;
    if (!artifactPath) return benchmarkCase;

    try {
      const artifact = JSON.parse(await readFile(artifactPath, 'utf8')) as Partial<LooseBenchmarkCase>;
      return {
        ...benchmarkCase,
        diagnostics: artifact.diagnostics ?? benchmarkCase.diagnostics,
        metrics: benchmarkCase.metrics ?? artifact.metrics ?? null,
        outcomeReasons: benchmarkCase.outcomeReasons ?? artifact.outcomeReasons,
      };
    } catch {
      return benchmarkCase;
    }
  }));

  return { ...report, cases };
}

export function summarizeEngineV3BenchmarkReport(report: LooseBenchmarkReport, sourceReport?: string): EngineV3BenchmarkCtoSummary {
  const cases = report.cases.map(summarizeCase);
  return {
    sourceReport,
    engine: report.engine,
    panelKind: report.panelKind,
    generatedAt: report.generatedAt,
    harnessSuccess: Boolean(report.summary?.success),
    outcomeCounts: countOutcomes(report.cases),
    verdictCounts: countVerdicts(cases),
    cases,
  };
}

export function renderEngineV3BenchmarkSummaryMarkdown(summary: EngineV3BenchmarkCtoSummary): string {
  const lines = [
    '# Engine V3 — résumé CTO benchmark multi-terrain',
    '',
    `Source: ${summary.sourceReport ?? 'non spécifiée'}`,
    `Généré: ${summary.generatedAt}`,
    `Commande benchmark réussie: ${summary.harnessSuccess ? 'oui' : 'non'}`,
    `Outcomes moteur: generated=${summary.outcomeCounts.generated}, adjusted=${summary.outcomeCounts.adjusted}, refused=${summary.outcomeCounts.refused}, errored=${summary.outcomeCounts.errored}`,
    `Verdicts produit: good_route=${summary.verdictCounts.good_route}, acceptable_adjusted=${summary.verdictCounts.acceptable_adjusted}, honest_refusal=${summary.verdictCounts.honest_refusal}, engine_failure=${summary.verdictCounts.engine_failure}, fake_success=${summary.verdictCounts.fake_success}`,
    '',
    'Important: ce résumé sépare la réussite de commande du résultat produit. Un `refused` typé peut être honnête ; un `generated` sous-distance ou sans géométrie serait un fake success.',
    '',
    '| Cas | Outcome | Verdict produit | Distance | trail | naturalWay | paved | dwell naturel | longest trail | repeat total/target/connector | busy road | meilleur rejeté | raison |',
    '| --- | --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: | --- | --- |',
    ...summary.cases.map(renderCaseRow),
    '',
    `Fake success: ${listCases(summary.cases, 'fake_success')}`,
    `Engine failure: ${listCases(summary.cases, 'engine_failure')}`,
    '',
  ];

  return `${lines.join('\n')}\n`;
}

function summarizeCase(benchmarkCase: LooseBenchmarkCase): EngineV3BenchmarkCaseSummary {
  const metrics = benchmarkCase.metrics ?? {};
  const outcome = benchmarkCase.outcome.type;
  const targetDistanceKm = numberField(metrics, 'targetDistanceKm');
  const distanceProducedKm = numberField(metrics, 'distanceProducedKm');

  return {
    id: benchmarkCase.id,
    name: benchmarkCase.name,
    outcome,
    verdict: productVerdict(outcome, targetDistanceKm, distanceProducedKm, metrics),
    targetDistanceKm,
    distanceProducedKm,
    trailRatio: numberField(metrics, 'trailRatio'),
    naturalWayRatio: numberField(metrics, 'naturalWayRatio'),
    pavedRatio: numberField(metrics, 'pavedRatio'),
    naturalDwellKm: numberField(metrics, 'naturalDwellKm'),
    longestTrailSegmentKm: numberField(metrics, 'longestTrailSegmentKm'),
    repeatEdgeKm: numberField(metrics, 'repeatEdgeKm'),
    targetRepeatKm: numberField(metrics, 'targetRepeatKm'),
    connectorRepeatKm: numberField(metrics, 'connectorRepeatKm'),
    busyRoadRatio: numberField(metrics, 'busyRoadRatio'),
    bestRejectedCandidate: bestRejectedCandidate(benchmarkCase.diagnostics),
    rejectionReason: rejectionReason(benchmarkCase),
    artifacts: {
      json: benchmarkCase.artifacts?.json ?? null,
      geojson: benchmarkCase.artifacts?.geojson ?? null,
      gpx: benchmarkCase.artifacts?.gpx ?? null,
    },
  };
}

function productVerdict(outcome: OutcomeType, targetDistanceKm: number | null, distanceProducedKm: number | null, metrics: Record<string, unknown>): EngineV3ProductVerdict {
  if (outcome === 'errored') return 'engine_failure';
  if (outcome === 'refused') return 'honest_refusal';

  if (!targetDistanceKm || distanceProducedKm === null) return 'fake_success';
  const distanceRatio = distanceProducedKm / targetDistanceKm;
  const hasSomeGeometryEvidence = distanceProducedKm > 0;
  const trailRatio = numberField(metrics, 'trailRatio') ?? 0;
  const naturalWayRatio = numberField(metrics, 'naturalWayRatio') ?? 0;
  const pavedRatio = numberField(metrics, 'pavedRatio') ?? 1;

  if (!hasSomeGeometryEvidence || distanceRatio < 0.75) return 'fake_success';
  if (pavedRatio > 0.9 && trailRatio === 0 && naturalWayRatio === 0) return 'fake_success';
  if (outcome === 'adjusted') return 'acceptable_adjusted';
  return distanceRatio >= 0.9 ? 'good_route' : 'acceptable_adjusted';
}

function bestRejectedCandidate(diagnostics: Record<string, unknown> | undefined): EngineV3BestRejectedCandidateSummary | null {
  const assembly = objectField(diagnostics, 'assemblyDiagnostics');
  const candidates = [
    ...arrayField(assembly, 'topRejected'),
    ...arrayField(assembly, 'topFinalCandidates').filter((candidate) => stringField(candidate, 'rejectedReason')),
    ...arrayField(objectField(assembly, 'targetComponentHandoff'), 'componentCandidates').filter((candidate) => stringField(candidate, 'rejectedReason')),
  ];
  const candidate = candidates[0];
  if (!candidate) return null;

  return {
    id: stringField(candidate, 'id') ?? stringField(candidate, 'componentId'),
    rank: numberField(candidate, 'rank'),
    distanceKm: numberField(candidate, 'distanceKm') ?? numberField(candidate, 'targetDistanceKm'),
    naturalDwellKm: numberField(candidate, 'naturalDwellKm') ?? numberField(candidate, 'targetKm'),
    pavedRatio: numberField(candidate, 'pavedRatio') ?? numberField(candidate, 'finalPavedRatioEstimate'),
    repeatEdgeKm: numberField(candidate, 'repeatEdgeKm') ?? numberField(candidate, 'repeatKm'),
    targetRepeatKm: numberField(candidate, 'targetRepeatKm'),
    connectorRepeatKm: numberField(candidate, 'connectorRepeatKm'),
    busyRoadRatio: numberField(candidate, 'busyRoadRatio'),
    rejectionReason: stringField(candidate, 'rejectedReason') ?? stringField(candidate, 'reason'),
  };
}

function rejectionReason(benchmarkCase: LooseBenchmarkCase): string | null {
  return benchmarkCase.outcome.reason
    ?? benchmarkCase.outcome.summary
    ?? benchmarkCase.outcomeReasons?.[0]
    ?? null;
}

function countOutcomes(cases: LooseBenchmarkCase[]): Record<OutcomeType, number> {
  const counts = { generated: 0, adjusted: 0, refused: 0, errored: 0 };
  for (const benchmarkCase of cases) counts[benchmarkCase.outcome.type] += 1;
  return counts;
}

function countVerdicts(cases: EngineV3BenchmarkCaseSummary[]): Record<EngineV3ProductVerdict, number> {
  const counts = { good_route: 0, acceptable_adjusted: 0, honest_refusal: 0, engine_failure: 0, fake_success: 0 };
  for (const benchmarkCase of cases) counts[benchmarkCase.verdict] += 1;
  return counts;
}

function renderCaseRow(benchmarkCase: EngineV3BenchmarkCaseSummary): string {
  const candidate = benchmarkCase.bestRejectedCandidate
    ? `${benchmarkCase.bestRejectedCandidate.id ?? 'n/a'} (${formatKm(benchmarkCase.bestRejectedCandidate.distanceKm)}, ${benchmarkCase.bestRejectedCandidate.rejectionReason ?? 'raison n/a'})`
    : 'n/a';

  return [
    benchmarkCase.id,
    benchmarkCase.outcome,
    benchmarkCase.verdict,
    `${formatKm(benchmarkCase.distanceProducedKm)} / ${formatKm(benchmarkCase.targetDistanceKm)}`,
    formatRatio(benchmarkCase.trailRatio),
    formatRatio(benchmarkCase.naturalWayRatio),
    formatRatio(benchmarkCase.pavedRatio),
    formatKm(benchmarkCase.naturalDwellKm),
    formatKm(benchmarkCase.longestTrailSegmentKm),
    `${formatKm(benchmarkCase.repeatEdgeKm)} / ${formatKm(benchmarkCase.targetRepeatKm)} / ${formatKm(benchmarkCase.connectorRepeatKm)}`,
    formatRatio(benchmarkCase.busyRoadRatio),
    candidate,
    benchmarkCase.rejectionReason ?? 'n/a',
  ].map(escapeMarkdownTable).join(' | ').replace(/^/, '| ').replace(/$/, ' |');
}

function listCases(cases: EngineV3BenchmarkCaseSummary[], verdict: EngineV3ProductVerdict): string {
  const matching = cases.filter((benchmarkCase) => benchmarkCase.verdict === verdict).map((benchmarkCase) => benchmarkCase.id);
  return matching.length > 0 ? matching.join(', ') : 'aucun';
}

function formatKm(value: number | null): string {
  return value === null ? 'n/a' : `${round(value)} km`;
}

function formatRatio(value: number | null): string {
  return value === null ? 'n/a' : String(round(value));
}

function round(value: number): number {
  return Math.round(value * 1000) / 1000;
}

function escapeMarkdownTable(value: unknown): string {
  return String(value).replace(/\|/g, '\\|').replace(/\n/g, ' ');
}

function objectField(source: unknown, key: string): Record<string, unknown> | undefined {
  if (!source || typeof source !== 'object') return undefined;
  const value = (source as Record<string, unknown>)[key];
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : undefined;
}

function arrayField(source: unknown, key: string): Record<string, unknown>[] {
  const object = source && typeof source === 'object' ? source as Record<string, unknown> : undefined;
  const value = object?.[key];
  return Array.isArray(value) ? value.filter((item): item is Record<string, unknown> => Boolean(item) && typeof item === 'object' && !Array.isArray(item)) : [];
}

function stringField(source: unknown, key: string): string | null {
  if (!source || typeof source !== 'object') return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'string' ? value : null;
}

function numberField(source: unknown, key: string): number | null {
  if (!source || typeof source !== 'object') return null;
  const value = (source as Record<string, unknown>)[key];
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}
