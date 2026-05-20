import { runEngineV3BenchmarkPanel, ENGINE_V3_BENCHMARK_CASES, type EngineV3BenchmarkCase } from '../lib/engine-v3/benchmark-runner';

const DEFAULT_CASE_IDS = ['tourville-trail-8k', 'fontainebleau-croix-augas-trail-12k'];
const DEFAULT_OUTPUT = 'artifacts/engine-v3-benchmarks/latest.json';
const DEFAULT_ARTIFACT_DIR = 'artifacts/engine-v3-benchmarks/latest-routes';

interface CliOptions {
  caseIds: string[];
  panelId: string | null;
  output: string;
  artifactDir: string;
  help: boolean;
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
} as const;

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));

  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const cases = selectCases(resolveCaseIds(options));
  const report = await runEngineV3BenchmarkPanel({
    cases,
    reportPath: options.output,
    artifactDir: options.artifactDir,
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
  return `Usage: npm run benchmark:engine-v3 -- [--case <case-id>] [--panel <panel-id>] [--output <path>] [--artifact-dir <dir>]\n\nRuns the Engine V3 real OSM/Overpass benchmark harness. By default it uses the RAM-safe two-case readiness panel: tourville-trail-8k and fontainebleau-croix-augas-trail-12k. Use --panel beta-multiterrain for the explicit eight-case short beta panel, or --panel asm-3i-fontainebleau-contract for the Fontainebleau contract split regression panel. Outcomes may be generated, adjusted, refused, or errored; the command writes an aggregate JSON plus JSON, GeoJSON, and GPX artifacts for each case.\n`;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
