import { writeEngineV3BenchmarkSummaryFromFile } from '../lib/engine-v3/benchmark-summary';

interface CliOptions {
  inputPath: string;
  outputJsonPath: string;
  outputMarkdownPath: string;
  help: boolean;
}

const DEFAULT_INPUT = 'artifacts/engine-v3-benchmarks/latest.json';
const DEFAULT_OUTPUT_JSON = 'artifacts/engine-v3-benchmarks/latest-summary.json';
const DEFAULT_OUTPUT_MD = 'artifacts/engine-v3-benchmarks/latest-summary.md';

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    process.stdout.write(usage());
    return;
  }

  const summary = await writeEngineV3BenchmarkSummaryFromFile({
    inputPath: options.inputPath,
    outputJsonPath: options.outputJsonPath,
    outputMarkdownPath: options.outputMarkdownPath,
  });

  process.stdout.write(`${JSON.stringify({
    sourceReport: options.inputPath,
    outputJsonPath: options.outputJsonPath,
    outputMarkdownPath: options.outputMarkdownPath,
    harnessSuccess: summary.harnessSuccess,
    outcomeCounts: summary.outcomeCounts,
    verdictCounts: summary.verdictCounts,
    fakeSuccess: summary.cases.filter((benchmarkCase) => benchmarkCase.verdict === 'fake_success').map((benchmarkCase) => benchmarkCase.id),
    engineFailures: summary.cases.filter((benchmarkCase) => benchmarkCase.verdict === 'engine_failure').map((benchmarkCase) => benchmarkCase.id),
  }, null, 2)}\n`);
}

export function parseArgs(args: string[]): CliOptions {
  let inputPath = DEFAULT_INPUT;
  let outputJsonPath = DEFAULT_OUTPUT_JSON;
  let outputMarkdownPath = DEFAULT_OUTPUT_MD;
  let help = false;

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === '--help' || arg === '-h') {
      help = true;
    } else if (arg === '--input') {
      inputPath = requireValue(args, index, '--input');
      index += 1;
    } else if (arg === '--output-json') {
      outputJsonPath = requireValue(args, index, '--output-json');
      index += 1;
    } else if (arg === '--output-md') {
      outputMarkdownPath = requireValue(args, index, '--output-md');
      index += 1;
    } else {
      throw new Error(`Unknown argument: ${arg}\n\n${usage()}`);
    }
  }

  return { inputPath, outputJsonPath, outputMarkdownPath, help };
}

function requireValue(args: string[], index: number, flag: string): string {
  const value = args[index + 1];
  if (!value || value.startsWith('--')) {
    throw new Error(`Missing value for ${flag}`);
  }
  return value;
}

function usage(): string {
  return `Usage: npm run benchmark:engine-v3:summary -- [--input <aggregate.json>] [--output-json <summary.json>] [--output-md <summary.md>]\n\nBuilds a CTO-readable product verdict summary from an Engine V3 benchmark aggregate and its per-case artifacts. It does not rerun generation and does not change product thresholds.\n`;
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exitCode = 1;
});
