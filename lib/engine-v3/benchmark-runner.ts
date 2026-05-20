import { mkdir, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';

import { buildGraph } from '../engine/graph-builder';
import type { EnrichedGraph } from '../types';
import { generateRouteV3FromGraph, type GeneratedRouteV3 } from './route-generator';
import type { RouteModeV3, RouteOutcomeV3, UserRouteRequestV3 } from './types';

export interface EngineV3BenchmarkCase {
  id: string;
  name: string;
  description: string;
  request: UserRouteRequestV3;
  tags: string[];
  contract?: EngineV3BenchmarkContract;
}

export interface EngineV3BenchmarkContract {
  role: 'clean-capacity' | 'diagnostic-anchor' | 'regression' | 'negative';
  expectedOutcomeTypes: RouteOutcomeV3['type'][];
  requiresGeometryExports: boolean;
  notes: string;
}

export interface EngineV3BenchmarkArtifactPaths {
  json: string;
  geojson: string;
  gpx: string;
}

export interface EngineV3BenchmarkResult {
  id: string;
  name: string;
  outcome: RouteOutcomeV3 | { type: 'errored'; reason: string };
  outcomeReasons: string[];
  metrics: GeneratedRouteV3['route']['metrics'] | null;
  warnings: string[];
  timings: EngineV3BenchmarkTimings;
  artifacts: EngineV3BenchmarkArtifactPaths;
}

export interface EngineV3BenchmarkSummary {
  success: boolean;
  total: number;
  byOutcome: {
    generated: number;
    adjusted: number;
    refused: number;
    errored: number;
  };
}

export interface EngineV3BenchmarkReport {
  engine: 'v3-clean-room';
  panelKind: 'real-osm-overpass';
  generatedAt: string;
  cases: EngineV3BenchmarkResult[];
  summary: EngineV3BenchmarkSummary;
}

export interface EngineV3BenchmarkTimings {
  totalMs: number;
  graphMs: number;
  generationMs: number;
  artifactMs: number;
}

interface GraphBuildResult {
  graph: EnrichedGraph;
  scenicWayIds: Set<string>;
}

export interface RunEngineV3BenchmarkPanelOptions {
  cases?: EngineV3BenchmarkCase[];
  artifactDir?: string;
  reportPath?: string;
  graphBuilder?: (benchmarkCase: EngineV3BenchmarkCase) => Promise<GraphBuildResult>;
  routeGenerator?: (benchmarkCase: EngineV3BenchmarkCase, graph: EnrichedGraph) => GeneratedRouteV3;
  now?: () => Date;
}

interface SuccessfulBenchmarkArtifact {
  case: EngineV3BenchmarkCase;
  request: UserRouteRequestV3;
  terrainSnapshot: GeneratedRouteV3['intent']['snapshot'];
  intent: GeneratedRouteV3['intent'];
  mission: GeneratedRouteV3['mission'];
  edges: GeneratedRouteV3['route']['edges'];
  geojson: GeoJSON.FeatureCollection;
  gpx: string;
  metrics: GeneratedRouteV3['route']['metrics'];
  outcome: RouteOutcomeV3;
  outcomeReasons: string[];
  warnings: string[];
  diagnostics: GeneratedRouteV3['diagnostics'];
  timings: EngineV3BenchmarkTimings;
}

interface ErroredBenchmarkArtifact {
  case: EngineV3BenchmarkCase;
  request: UserRouteRequestV3;
  terrainSnapshot: null;
  intent: null;
  mission: null;
  edges: [];
  geojson: GeoJSON.FeatureCollection;
  gpx: string;
  metrics: null;
  outcome: { type: 'errored'; reason: string };
  outcomeReasons: string[];
  warnings: string[];
  diagnostics: { error: string };
  timings: EngineV3BenchmarkTimings;
}

const DEFAULT_ARTIFACT_DIR = 'artifacts/engine-v3-benchmarks/latest-routes';
const DEFAULT_REPORT_PATH = 'artifacts/engine-v3-benchmarks/latest.json';

const REGRESSION_CONTRACT: EngineV3BenchmarkContract = {
  role: 'regression',
  expectedOutcomeTypes: ['generated', 'adjusted', 'refused'],
  requiresGeometryExports: true,
  notes: 'Regression coverage case: inspect outcome metrics instead of treating command success as product success.',
};

const NEGATIVE_CONTRACT: EngineV3BenchmarkContract = {
  role: 'negative',
  expectedOutcomeTypes: ['refused', 'adjusted'],
  requiresGeometryExports: false,
  notes: 'Negative terrain/data-confidence case: honest refusal is acceptable and preferred to fake trail/paved laundering.',
};

export const ENGINE_V3_BENCHMARK_CASES: EngineV3BenchmarkCase[] = [
  benchmarkCase('tourville-trail-8k', 'Tourville 8k', 'Tourville-sur-Odon / Bois des Amis: accept road transitions only to actually enter wooded paths.', 49.1436, -0.5062, 8, 'trail', ['tourville', 'woods-transition', 'legacy-readiness-id'], REGRESSION_CONTRACT),
  benchmarkCase('tourville-pommiers-trail-8k', 'Tourville Pommiers 8k', 'Transition-to-woods field feedback case: accept road connectors only if they unlock real wooded/path dwell.', 49.1436, -0.5062, 8, 'trail', ['tourville', 'woods-transition', 'field-feedback', 'beta-multiterrain'], REGRESSION_CONTRACT),
  benchmarkCase('tourville-pommiers-trail-12k', 'Tourville Pommiers 12k', 'Longer transition-to-woods field feedback case around Jean Bosco / Baron; no parasite loops or scenic-paved laundering.', 49.1436, -0.5062, 12, 'trail', ['tourville', 'woods-transition', 'field-feedback', 'unstable', 'beta-multiterrain']),
  benchmarkCase('caen-colline-aux-oiseaux-6k-soft', 'Caen Colline aux Oiseaux 6k', 'Urban park recovery/nature case: useful short loop, no fake forest promise.', 49.2058, -0.3762, 6, 'nature_urbaine', ['caen', 'park', 'urban-nature', 'beta-multiterrain'], REGRESSION_CONTRACT),
  benchmarkCase('caen-prairie-8k-mixed', 'Caen Prairie/Orne 8k', 'Mixed urban nature case: exploit Prairie/Orne without drifting to major city axes.', 49.1829, -0.3707, 8, 'nature_urbaine', ['caen', 'urban-nature', 'mixed', 'orne', 'beta-multiterrain']),
  benchmarkCase(
    'fontainebleau-trail-12k',
    'Fontainebleau town-edge 12k diagnostic',
    'Town-edge Fontainebleau anchor: expected to stay honest as adjusted/refused/under-distance from this start, not product-green clean 12k.',
    48.4039,
    2.7016,
    12,
    'trail',
    ['fontainebleau', 'forest', 'diagnostic-anchor', 'town-edge', 'legacy-readiness-id'],
    {
      role: 'diagnostic-anchor',
      expectedOutcomeTypes: ['adjusted', 'refused'],
      requiresGeometryExports: false,
      notes: 'ASM-3h showed this exact anchor produces an honest ~10 km adjusted route for a 12 km request; do not weaken thresholds or relabel paved/unknown surfaces to make it green.',
    },
  ),
  benchmarkCase(
    'fontainebleau-croix-augas-trail-12k',
    'Fontainebleau Croix d’Augas 12k',
    'Clean Fontainebleau forest-capacity benchmark: nearby Croix d’Augas start has current evidence for a geometry-bearing usable 12k-ish trail route.',
    48.4054,
    2.6786,
    12,
    'trail',
    ['fontainebleau', 'forest', 'clean-capacity', 'croix-augas', 'readiness-id'],
    {
      role: 'clean-capacity',
      expectedOutcomeTypes: ['generated', 'adjusted'],
      requiresGeometryExports: true,
      notes: 'ASM-3h evidence: 12.124 km, naturalWayRatio 0.982, pavedRatio 0.018, naturalDwellKm 11.909, targetRepeatKm 0.108, GPX/GeoJSON present.',
    },
  ),
  benchmarkCase('fontainebleau-trail-15k', 'Fontainebleau 15k', 'Longer Fontainebleau forest/trail capacity check; adjusted/refused is acceptable if evidence is weak.', 48.4039, 2.7016, 15, 'trail', ['fontainebleau', 'forest', 'longer', 'beta-multiterrain']),
  benchmarkCase('meudon-forest-trail-10k', 'Meudon forest 10k', 'Peri-urban forest case with access ambiguity; do not hide restricted/paved compromises.', 48.8055, 2.1877, 10, 'trail', ['meudon', 'forest', 'periurban', 'beta-multiterrain']),
  benchmarkCase('paris-19-canal-running', 'Paris 19 canal running', 'Dense urban canal/park corridor case: urban nature running, never forest trail claim.', 48.884, 2.3691, 10, 'nature_urbaine', ['paris', 'dense-urban', 'canal', 'urban-nature', 'beta-multiterrain'], REGRESSION_CONTRACT),
  benchmarkCase('osm-poor-rural-trail-8k', 'Poor rural 8k', 'Sparse rural / poor OSM negative case: refuse or warn instead of fabricating surface confidence.', 48.9438, -0.6986, 8, 'trail', ['negative', 'poor-rural', 'osm-poor-data', 'beta-multiterrain'], NEGATIVE_CONTRACT),
  benchmarkCase('clecy-trail-10k', 'Clécy 10k', 'Suisse normande trail-ish terrain with rural connectors and real natural path evidence.', 48.9171, -0.4849, 10, 'trail', ['clecy', 'suisse-normande']),
  benchmarkCase('clecy-trail-12k', 'Clécy 12k', 'Longer Suisse normande rural/trail case; should expose if distance padding becomes dishonest.', 48.9171, -0.4849, 12, 'trail', ['clecy', 'suisse-normande', 'longer']),
  benchmarkCase('paris-buttes-chaumont-urban-nature', 'Paris Buttes-Chaumont', 'Dense urban park case: nature urbaine only, never a forest trail claim.', 48.8809, 2.3824, 6, 'nature_urbaine', ['paris', 'dense-urban', 'park']),
  benchmarkCase('small-park-too-long-trail', 'Petit parc trop long', 'Small park negative case: a long trail request must be adjusted/refused instead of padded with paved loops.', 48.8792, 2.3091, 15, 'trail', ['negative', 'small-park', 'too-long']),
  benchmarkCase('poor-rural-trail', 'Poor rural', 'Sparse rural graph negative case: refuse rather than fabricate GPS/terrain evidence.', 48.9438, -0.6986, 12, 'trail', ['negative', 'poor-rural']),
  benchmarkCase('semi-rural-normand-9k', 'Semi-rural normand 9k', 'Normandy semi-rural case with mixed roads/paths; outcome should explain paved compromises honestly.', 49.0284, -0.5744, 9, 'trail', ['normandy', 'semi-rural']),
];

export async function runEngineV3BenchmarkPanel(options: RunEngineV3BenchmarkPanelOptions = {}): Promise<EngineV3BenchmarkReport> {
  const cases = options.cases ?? ENGINE_V3_BENCHMARK_CASES;
  const artifactDir = options.artifactDir ?? DEFAULT_ARTIFACT_DIR;
  const reportPath = options.reportPath ?? DEFAULT_REPORT_PATH;
  const now = options.now ?? (() => new Date());
  const results: EngineV3BenchmarkResult[] = [];

  await mkdir(artifactDir, { recursive: true });

  for (const benchmark of cases) {
    results.push(await runEngineV3BenchmarkCase(benchmark, {
      artifactDir,
      graphBuilder: options.graphBuilder ?? defaultGraphBuilder,
      routeGenerator: options.routeGenerator ?? defaultRouteGenerator,
    }));
  }

  const report: EngineV3BenchmarkReport = {
    engine: 'v3-clean-room',
    panelKind: 'real-osm-overpass',
    generatedAt: now().toISOString(),
    cases: results,
    summary: summarize(results),
  };

  await mkdir(dirname(reportPath), { recursive: true });
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  return report;
}

async function runEngineV3BenchmarkCase(
  benchmark: EngineV3BenchmarkCase,
  options: Required<Pick<RunEngineV3BenchmarkPanelOptions, 'graphBuilder' | 'routeGenerator'>> & { artifactDir: string },
): Promise<EngineV3BenchmarkResult> {
  const totalStarted = Date.now();
  const timings: EngineV3BenchmarkTimings = { totalMs: 0, graphMs: 0, generationMs: 0, artifactMs: 0 };
  const paths = artifactPaths(options.artifactDir, benchmark.id);

  try {
    const graphStarted = Date.now();
    const { graph } = await options.graphBuilder(benchmark);
    timings.graphMs = elapsed(graphStarted);

    const generationStarted = Date.now();
    const generated = options.routeGenerator(benchmark, graph);
    timings.generationMs = elapsed(generationStarted);
    timings.totalMs = elapsed(totalStarted);

    const outcomeReasons = reasonsOrCompromises(generated.outcome);
    const warnings = unique([
      ...generated.intent.snapshot.audit.warnings,
      ...generated.intent.warnings,
      ...generated.mission.warnings,
      ...generated.route.warnings,
      ...generated.diagnostics.warnings,
      ...generated.diagnostics.limitations,
    ]);
    const geojson = routeToGeoJson(benchmark, generated);
    const gpx = routeToGpx(benchmark, generated);
    const artifact: SuccessfulBenchmarkArtifact = {
      case: benchmark,
      request: benchmark.request,
      terrainSnapshot: generated.intent.snapshot,
      intent: generated.intent,
      mission: generated.mission,
      edges: generated.route.edges,
      geojson,
      gpx,
      metrics: generated.route.metrics,
      outcome: generated.outcome,
      outcomeReasons,
      warnings,
      diagnostics: generated.diagnostics,
      timings,
    };

    const artifactStarted = Date.now();
    await writeArtifacts(paths, artifact);
    timings.artifactMs = elapsed(artifactStarted);
    timings.totalMs = elapsed(totalStarted);
    artifact.timings = { ...timings };
    await writeArtifacts(paths, artifact);

    return {
      id: benchmark.id,
      name: benchmark.name,
      outcome: generated.outcome,
      outcomeReasons,
      metrics: generated.route.metrics,
      warnings,
      timings,
      artifacts: paths,
    };
  } catch (error) {
    timings.totalMs = elapsed(totalStarted);
    const message = error instanceof Error ? error.message : String(error);
    const outcome = { type: 'errored' as const, reason: message };
    const geojson = emptyGeoJson(benchmark);
    const gpx = emptyGpx(benchmark);
    const artifact: ErroredBenchmarkArtifact = {
      case: benchmark,
      request: benchmark.request,
      terrainSnapshot: null,
      intent: null,
      mission: null,
      edges: [],
      geojson,
      gpx,
      metrics: null,
      outcome,
      outcomeReasons: [message],
      warnings: ['benchmark errored before V3 could classify generated/adjusted/refused'],
      diagnostics: { error: message },
      timings,
    };
    const artifactStarted = Date.now();
    await writeArtifacts(paths, artifact);
    timings.artifactMs = elapsed(artifactStarted);
    timings.totalMs = elapsed(totalStarted);
    artifact.timings = { ...timings };
    await writeArtifacts(paths, artifact);

    return {
      id: benchmark.id,
      name: benchmark.name,
      outcome,
      outcomeReasons: [message],
      metrics: null,
      warnings: artifact.warnings,
      timings,
      artifacts: paths,
    };
  }
}

async function defaultGraphBuilder(benchmark: EngineV3BenchmarkCase): Promise<GraphBuildResult> {
  return buildGraph(benchmark.request.start, {
    targetDistanceKm: benchmark.request.targetDistanceKm,
    sport: benchmark.request.sport,
  });
}

function defaultRouteGenerator(benchmark: EngineV3BenchmarkCase, graph: EnrichedGraph): GeneratedRouteV3 {
  return generateRouteV3FromGraph(benchmark.request, graph);
}

function benchmarkCase(
  id: string,
  name: string,
  description: string,
  lat: number,
  lng: number,
  targetDistanceKm: number,
  mode: RouteModeV3,
  tags: string[],
  contract?: EngineV3BenchmarkContract,
): EngineV3BenchmarkCase {
  return {
    id,
    name,
    description,
    request: {
      start: { lat, lng },
      targetDistanceKm,
      activity: 'running',
      mode,
      loop: true,
    },
    tags,
    contract,
  };
}

function artifactPaths(artifactDir: string, id: string): EngineV3BenchmarkArtifactPaths {
  return {
    json: resolve(artifactDir, `${id}.json`),
    geojson: resolve(artifactDir, `${id}.geojson`),
    gpx: resolve(artifactDir, `${id}.gpx`),
  };
}

async function writeArtifacts(paths: EngineV3BenchmarkArtifactPaths, artifact: SuccessfulBenchmarkArtifact | ErroredBenchmarkArtifact): Promise<void> {
  await writeFile(paths.json, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  await writeFile(paths.geojson, `${JSON.stringify(artifact.geojson, null, 2)}\n`, 'utf8');
  await writeFile(paths.gpx, `${artifact.gpx}\n`, 'utf8');
}

function summarize(results: EngineV3BenchmarkResult[]): EngineV3BenchmarkSummary {
  const byOutcome = { generated: 0, adjusted: 0, refused: 0, errored: 0 };
  for (const result of results) {
    byOutcome[result.outcome.type] += 1;
  }
  return {
    success: byOutcome.errored === 0,
    total: results.length,
    byOutcome,
  };
}

function routeToGeoJson(benchmark: EngineV3BenchmarkCase, generated: GeneratedRouteV3): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: {
          caseId: benchmark.id,
          name: benchmark.name,
          outcome: generated.outcome.type,
          targetDistanceKm: benchmark.request.targetDistanceKm,
          distanceProducedKm: generated.route.metrics.distanceProducedKm,
          pavedRatio: generated.route.metrics.pavedRatio,
          naturalWayRatio: generated.route.metrics.naturalWayRatio,
        },
        geometry: generated.route.geometry,
      },
    ],
  };
}

function emptyGeoJson(benchmark: EngineV3BenchmarkCase): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: [
      {
        type: 'Feature',
        properties: { caseId: benchmark.id, name: benchmark.name, outcome: 'errored' },
        geometry: { type: 'LineString', coordinates: [] },
      },
    ],
  };
}

function routeToGpx(benchmark: EngineV3BenchmarkCase, generated: GeneratedRouteV3): string {
  const trkpts = generated.route.geometry.coordinates
    .map(([lng, lat]) => `      <trkpt lat="${escapeXml(String(lat))}" lon="${escapeXml(String(lng))}" />`)
    .join('\n');
  return gpxDocument(benchmark, trkpts);
}

function emptyGpx(benchmark: EngineV3BenchmarkCase): string {
  return gpxDocument(benchmark, '');
}

function gpxDocument(benchmark: EngineV3BenchmarkCase, trkpts: string): string {
  return `<?xml version="1.0" encoding="UTF-8"?>
<gpx version="1.1" creator="TrailForge Engine V3 Benchmark" xmlns="http://www.topografix.com/GPX/1/1">
  <trk>
    <name>${escapeXml(benchmark.name)}</name>
    <trkseg>
${trkpts}
    </trkseg>
  </trk>
</gpx>`;
}

function reasonsOrCompromises(outcome: RouteOutcomeV3): string[] {
  if (outcome.type === 'generated') return [outcome.summary];
  if (outcome.type === 'adjusted') return [outcome.summary, ...outcome.compromises];
  return [outcome.reason, ...(outcome.details ?? [])];
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

function elapsed(started: number): number {
  return Date.now() - started;
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}
