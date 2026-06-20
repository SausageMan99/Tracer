import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildGraph } from '../lib/engine/graph-builder';
import { runEngineV3BenchmarkPanel, ENGINE_V3_BENCHMARK_CASES, type EngineV3BenchmarkCase } from '../lib/engine-v3/benchmark-runner';
import { enrichEdgesWithTerrainContext } from '../lib/engine/terrain-context-enricher';
import type { EnrichedEdge, EnrichedGraph, TerrainContextFeatureCollection } from '../lib/types';

const DEFAULT_CASE_IDS = ['tourville-trail-8k', 'fontainebleau-croix-augas-trail-12k'];
const DEFAULT_OUTPUT = 'artifacts/engine-v3-benchmarks/latest.json';
const DEFAULT_ARTIFACT_DIR = 'artifacts/engine-v3-benchmarks/latest-routes';
const DEFAULT_IGN_POC_DIR = 'fixtures/ign-poc';

interface CliOptions {
  caseIds: string[];
  panelId: string | null;
  output: string;
  artifactDir: string;
  help: boolean;
  enableIgnPocFixtures: boolean;
  ignPocDir: string;
}

const ENGINE_V3_BENCHMARK_PANELS = {
  'readiness-two-case': DEFAULT_CASE_IDS,
  'beta-multiterrain': [
    'tourville-pommiers-trail-8k',
    'tourville-pommiers-trail-12k',
    'caen-colline-aux-oiseaux-6k-soft',
    'caen-prairie-8k-mixed',
    'fontainebleau-trail-15k',
    'meudon-forest-trail-10k',
    'paris-19-canal-running',
    'osm-poor-rural-trail-8k',
  ],
  'asm-3i-fontainebleau-contract': [
    'fontainebleau-croix-augas-trail-12k',
    'fontainebleau-trail-12k',
    'tourville-pommiers-trail-8k',
    'caen-colline-aux-oiseaux-6k-soft',
    'paris-19-canal-running',
    'osm-poor-rural-trail-8k',
  ],
  'asm-3-golden': [
    'paris-buttes-chaumont-urban-nature',
    'paris-19-canal-running',
    'caen-colline-aux-oiseaux-6k-soft',
    'tourville-pommiers-trail-8k',
    'tourville-pommiers-trail-12k',
    'fontainebleau-croix-augas-trail-12k',
    'osm-poor-rural-trail-8k',
  ],
} as const;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const cases = selectCases(resolveCaseIds(options));

  // T15/T17: optional IGN POC fixture enrichment behind --enable-ign-poc-fixtures.
  // Default graphBuilder (no flag, or flag but missing fixture) is strictly
  // byte-identical to the previous behavior. When the flag is set AND a
  // fixtures/ign-poc/<caseId>.geojson file exists, edges get terrainContext
  // assigned via enrichEdgesWithTerrainContext (existing, tested function).
  // The nodeResolver pulls lat/lng from graph.nodes because buildGraph does
  // not populate edge.fromCoordinate / edge.toCoordinate.
  // No engine file is modified; this is a script-level wiring only.
  const graphBuilder = options.enableIgnPocFixtures
    ? buildIgnPocEnrichedGraphBuilder(options.ignPocDir)
    : undefined;

  const report = await runEngineV3BenchmarkPanel({
    cases,
    reportPath: options.output,
    artifactDir: options.artifactDir,
    graphBuilder,
  });

  process.stdout.write(`${JSON.stringify({
    engine: report.engine,
    panelKind: report.panelKind,
    reportPath: options.output,
    artifactDir: options.artifactDir,
    summary: report.summary,
    cases: report.cases.map((result) => ({
      id: result.id,
      outcome: result.outcome.type,
      reasons: result.outcomeReasons,
      artifacts: result.artifacts,
      timings: result.timings,
    })),
  }, null, 2)}\n`);
}

export function parseArgs(args: string[]): CliOptions {
  const caseIds: string[] = [];
  let panelId: string | null = null;
  let output = DEFAULT_OUTPUT;
  let artifactDir = DEFAULT_ARTIFACT_DIR;
  let help = false;
  let enableIgnPocFixtures = false;
  let ignPocDir = DEFAULT_IGN_POC_DIR;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--case') {
      caseIds.push(requireValue(args, index, '--case'));
      index += 1;
    } else if (arg === '--panel') {
      panelId = requireValue(args, index, '--panel');
      index += 1;
    } else if (arg === '--output') {
      output = requireValue(args, index, '--output');
      index += 1;
    } else if (arg === '--artifact-dir') {
      artifactDir = requireValue(args, index, '--artifact-dir');
      index += 1;
    } else if (arg === '--enable-ign-poc-fixtures') {
      enableIgnPocFixtures = true;
    } else if (arg === '--ign-poc-dir') {
      ignPocDir = requireValue(args, index, '--ign-poc-dir');
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  return {
    caseIds,
    panelId,
    output,
    artifactDir,
    help,
    enableIgnPocFixtures,
    ignPocDir,
  };
}

function resolveCaseIds(options: CliOptions): string[] {
  if (options.caseIds.length > 0) {
    return options.caseIds;
  }

  if (!options.panelId) {
    return [...DEFAULT_CASE_IDS];
  }

  const panelCaseIds = ENGINE_V3_BENCHMARK_PANELS[options.panelId as keyof typeof ENGINE_V3_BENCHMARK_PANELS];
  if (!panelCaseIds) {
    throw new Error(`Unknown Engine V3 benchmark panel: ${options.panelId}`);
  }

  return [...panelCaseIds];
}

function selectCases(caseIds: string[]): EngineV3BenchmarkCase[] {
  return caseIds.map((caseId) => {
    const benchmarkCase = ENGINE_V3_BENCHMARK_CASES.find((candidate) => candidate.id === caseId);
    if (!benchmarkCase) {
      throw new Error(`Unknown Engine V3 benchmark case: ${caseId}`);
    }
    return benchmarkCase;
  });
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function usage(): string {
  return `Usage: npm run benchmark:engine-v3 -- [--case <case-id>] [--panel <panel-id>] [--output <path>] [--artifact-dir <dir>] [--enable-ign-poc-fixtures] [--ign-poc-dir <path>]\n\nRuns the Engine V3 real OSM/Overpass benchmark harness. By default it uses the RAM-safe two-case readiness panel: tourville-trail-8k and fontainebleau-croix-augas-trail-12k. Use --panel beta-multiterrain for the explicit eight-case short beta panel, --panel asm-3-golden for the seven-case ASM golden product-label gate, or --panel asm-3i-fontainebleau-contract for the Fontainebleau contract split regression panel. Outcomes may be generated, adjusted, refused, or errored; the command writes an aggregate JSON plus JSON, GeoJSON, and GPX artifacts for each case.\n\nOptional IGN POC fixture enrichment (T15/T17, benchmark-only): --enable-ign-poc-fixtures loads fixtures/ign-poc/<case-id>.geojson and calls enrichEdgesWithTerrainContext on the graph edges (with a nodeResolver built from graph.nodes) before the terrain snapshot is built. This is opt-in and only affects benchmarks; the production API is not touched. When the flag is absent, or when the fixture file does not exist, the graphBuilder is strictly byte-identical to the default buildGraph result. Use --ign-poc-dir <path> to override the default fixtures/ign-poc directory.\n`;
}

// T15/T17 helpers — exported for tests/engine-v3-ign-poc-wiring.test.ts.

// Case-id → fixture-filename mapping for the few cases that ship with a
// pre-authored fixture. Falls back to a slugified variant and a leading-segment
// match so the wiring does not require renaming fixtures to match the case id.
const IGN_POC_FIXTURE_NAME_OVERRIDES: Readonly<Record<string, string>> = {
  'caen-colline-aux-oiseaux-6k-soft': 'caen-colline.geojson',
  'meudon-forest-trail-10k': 'meudon.geojson',
  'tourville-trail-8k': 'tourville.geojson',
  'tourville-pommiers-trail-8k': 'tourville.geojson',
  'tourville-pommiers-trail-12k': 'tourville.geojson',
};

function candidateFixtureNames(caseId: string): string[] {
  const out: string[] = [];
  const override = IGN_POC_FIXTURE_NAME_OVERRIDES[caseId];
  if (override) out.push(override);
  out.push(`${caseId}.geojson`);
  // Slugified variants: strip common suffixes and the "6k" / "8k" / "12k" tags.
  const slug = caseId
    .replace(/-aux-oiseaux/g, '')
    .replace(/-trail-\d+k?/g, '')
    .replace(/-pommiers/g, '')
    .replace(/-forest/g, '')
    .replace(/-\d+k?$/g, '')
    .replace(/-soft$/g, '')
    .replace(/-mixed$/g, '')
    .replace(/_/g, '-');
  if (slug !== caseId) {
    out.push(`${slug}.geojson`);
  }
  // Deduplicate.
  return Array.from(new Set(out));
}

export function resolveIgnPocFixtureForCase(
  caseId: string,
  fixtureDir: string = DEFAULT_IGN_POC_DIR,
): TerrainContextFeatureCollection | null {
  for (const filename of candidateFixtureNames(caseId)) {
    const path = join(fixtureDir, filename);
    if (!existsSync(path)) continue;
    try {
      return JSON.parse(readFileSync(path, 'utf8')) as TerrainContextFeatureCollection;
    } catch {
      return null;
    }
  }
  return null;
}

export type IgnPocGraphBuilder = (benchmark: EngineV3BenchmarkCase) => Promise<{ graph: EnrichedGraph; scenicWayIds: Set<string> }>;

export function buildIgnPocEnrichedGraphBuilder(
  fixtureDir: string = DEFAULT_IGN_POC_DIR,
): IgnPocGraphBuilder {
  return async (benchmark) => {
    const result = await buildGraph(benchmark.request.start, {
      targetDistanceKm: benchmark.request.targetDistanceKm,
      sport: benchmark.request.sport,
    });
    const fixture = resolveIgnPocFixtureForCase(benchmark.id, fixtureDir);
    if (fixture == null) return result;
    // T17: buildGraph does not populate edge.fromCoordinate/toCoordinate;
    // we use graph.nodes to resolve node lat/lng on the fly.
    const nodeMap = result.graph.nodes;
    const nodeResolver = (nodeId: string) => {
      const node = nodeMap.get(nodeId);
      return node ? { lat: node.lat, lng: node.lng } : undefined;
    };
    const enrichedEdges = enrichEdgesWithTerrainContext(
      Array.from(result.graph.edges.values()),
      { fixtureGeoJson: fixture, nodeResolver },
    );
    const enrichedEdgeMap = new Map<string, EnrichedEdge>();
    for (const edge of enrichedEdges) enrichedEdgeMap.set(edge.id, edge);
    const enrichedGraph: EnrichedGraph = {
      nodes: result.graph.nodes,
      edges: enrichedEdgeMap,
      center: result.graph.center,
      radiusKm: result.graph.radiusKm,
    };
    return { graph: enrichedGraph, scenicWayIds: result.scenicWayIds };
  };
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
