#!/usr/bin/env node
import { createServer } from 'vite';

const args = process.argv.slice(2);
const DEFAULT_OUTPUT = 'artifacts/engine-comparison/latest.json';
const DEFAULT_ARTIFACT_DIR = 'artifacts/engine-comparison/latest-cases';

if (args.includes('--help') || args.includes('-h')) {
  console.log(usage());
  process.exit(0);
}

const caseFilters = args.flatMap((arg, index) => {
  if (arg === '--case') return [args[index + 1]].filter(Boolean);
  if (arg.startsWith('--case=')) return [arg.slice('--case='.length)];
  return [];
});
const outputPath = getArgValue('--output') ?? DEFAULT_OUTPUT;
const artifactDir = getArgValue('--artifact-dir') ?? DEFAULT_ARTIFACT_DIR;
const baseUrl = getArgValue('--base-url') ?? process.env.ENGINE_COMPARISON_BASE_URL ?? 'http://localhost:3000';
const listOnly = args.includes('--list');
const writeArtifacts = !args.includes('--no-output');

let server;
try {
  server = await createServer({
    server: { middlewareMode: true },
    appType: 'custom',
    logLevel: 'error',
  });
  const comparison = await server.ssrLoadModule('/lib/engine-v3/comparison.ts');

  if (listOnly) {
    const cases = comparison.defaultEngineComparisonCases();
    for (const benchmark of cases) {
      console.log(`${benchmark.id}\t${benchmark.tier ?? 'unclassified'}\t${(benchmark.tags ?? []).join(',')}\t${benchmark.label}`);
    }
    process.exit(0);
  }

  const report = await comparison.runEngineComparison({
    caseFilters,
    outputPath,
    artifactDir,
    baseUrl,
    writeArtifacts,
  });

  for (const result of report.cases) {
    const symbol = result.verdict.label === 'v3_better' ? '↑' : result.verdict.label === 'v3_worse' ? '↓' : result.verdict.label === 'errored' ? '✗' : '=';
    console.log(`${symbol} ${result.id}: ${result.verdict.label} (${result.v25.outcome} → ${result.v3.outcome}) utility=${result.verdict.routeUtilityDelta} terrain=${result.verdict.terrainTruthDelta} opportunity=${result.verdict.opportunityCaptureDelta}`);
  }
  console.log(JSON.stringify({
    outputPath: writeArtifacts ? outputPath : null,
    artifactDir: writeArtifacts ? artifactDir : null,
    total: report.total,
    summary: report.summary,
  }, null, 2));

  if (report.summary.errored > 0) process.exitCode = 1;
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
} finally {
  await server?.close();
}

function getArgValue(name) {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function usage() {
  return `Usage: node scripts/compare-engine-v25-v3.mjs [options]

Runs V2.5 and V3 experimental on the exact same terrain-aware benchmark requests and writes aggregate plus per-case comparison artifacts. The command succeeds when it produces evidence; V3 can still be reported as worse.

Options:
  --list                    Print comparison case ids and exit.
  --case <id-or-prefix>     Run only matching benchmark id(s). Repeatable.
  --base-url <url>          Target app URL. Default: http://localhost:3000.
  --output <path>           Aggregate JSON report. Default: ${DEFAULT_OUTPUT}.
  --artifact-dir <path>     Per-case comparison artifacts. Default: ${DEFAULT_ARTIFACT_DIR}.
  --no-output               Do not write report/artifacts.
  --help                    Show this help.
`;
}
