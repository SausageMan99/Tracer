#!/usr/bin/env node
/**
 * V3-only offline benchmark runner.
 *
 * Why this is a .mjs that calls vitest:
 * -------------------------------------
 * Every existing script in scripts/ (run-route-benchmarks.mjs,
 * compare-route-benchmarks.mjs, audit-osm-terrain.mjs,
 * run-ign-terrain-poc.mjs, release-evidence-check.mjs) imports precompiled
 * .mjs modules from lib/. We do not have tsx/ts-node installed, and vitest
 * is the only TypeScript runner available. The V3 benchmark library lives
 * in lib/engine-v3/benchmark-cases.ts (TypeScript), so we let vitest drive
 * it and then publish the artifact + exit code from this script.
 *
 * This is the same pattern used by `npm run smoke:engine-v3`, which is
 * `vitest run tests/engine-v3-smoke-harness.test.ts`.
 *
 * This script does NOT touch /api/generate-route, the V2 engine, the GPX
 * pipeline, lib/route-benchmarks-core, or lib/route-benchmarks-data.json.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, '..');
const args = process.argv.slice(2);

const defaultArtifactPath = 'artifacts/engine-v3-benchmarks/latest.json';
const artifactPath = resolve(
  repoRoot,
  (() => {
    const eqArg = args.find((a) => a.startsWith('--write='));
    if (eqArg) return eqArg.slice('--write='.length);
    const idx = args.indexOf('--write');
    if (idx >= 0 && args[idx + 1]) return args[idx + 1];
    return defaultArtifactPath;
  })(),
);

if (args.includes('--help') || args.includes('-h')) {
  console.log(`Usage: npm run bench:v3:offline

Runs the V3-only offline benchmark panel.

Options:
  --write <path>     Output JSON path. Default: ${defaultArtifactPath}
  --help             Show this help.

Exit code:
  0  no failed case
  1  at least one failed case or test error`);
  process.exit(0);
}

const testFile = 'tests/engine-v3-benchmarks.test.ts';
const tmpArtifact = resolve(repoRoot, `.tmp-engine-v3-bench-${process.pid}.json`);

console.log(`Running V3 offline benchmarks via vitest (${testFile})…`);

let testExitCode;
try {
  testExitCode = execFileSync(
    'npx',
    [
      'vitest',
      'run',
      testFile,
      '--reporter=default',
      '--no-color',
    ],
    {
      cwd: repoRoot,
      stdio: 'inherit',
      env: {
        ...process.env,
        ENGINE_V3_BENCH_ARTIFACT: tmpArtifact,
      },
    },
  ).status ?? 0;
} catch (error) {
  // execFileSync throws on non-zero exit. Surface the captured code.
  const status =
    error && typeof error === 'object' && 'status' in error && typeof error.status === 'number'
      ? error.status
      : 1;
  testExitCode = status;
}

let onDisk = null;
try {
  onDisk = JSON.parse(await readFile(tmpArtifact, 'utf8'));
} catch {
  onDisk = null;
} finally {
  await mkdir(dirname(tmpArtifact), { recursive: true }).catch(() => undefined);
  await import('node:fs/promises').then((fs) => fs.unlink(tmpArtifact).catch(() => undefined));
}

if (!onDisk) {
  console.error(
    `V3 benchmark artifact not found at ${tmpArtifact}. ` +
      `The test must write it when ENGINE_V3_BENCH_ARTIFACT is set.`,
  );
  process.exit(testExitCode !== 0 ? testExitCode : 1);
}

await mkdir(dirname(artifactPath), { recursive: true });
await writeFile(artifactPath, `${JSON.stringify(onDisk, null, 2)}\n`, 'utf8');

const symbol = (passed) => (passed ? '✓' : '✗');
for (const caseReport of onDisk.cases) {
  const sub = caseReport.actualSubCode ? ` [${caseReport.actualSubCode}]` : '';
  console.log(
    `${symbol(caseReport.passed)} ${caseReport.caseId} (${caseReport.durationMs}ms)${sub}`,
  );
  if (!caseReport.passed) {
    for (const failure of caseReport.failures) {
      console.log(`    ${failure.code}: ${failure.message}`);
    }
  }
}

console.log(
  `\nV3 benchmark summary: ${onDisk.passed}/${onDisk.totalCases} passed, ${onDisk.failed} failed.`,
);
console.log(`Artifact: ${artifactPath.replace(`${repoRoot}/`, '')}`);

if (onDisk.failed > 0) {
  process.exit(1);
}
if (testExitCode !== 0) {
  process.exit(testExitCode);
}
process.exit(0);
