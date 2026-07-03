import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import {
  ENGINE_V3_BENCHMARK_CASES,
  runEngineV3BenchmarkPanel,
  type EngineV3BenchmarkCase,
  type EngineV3BenchmarkReport,
} from '../lib/engine-v3/benchmark-cases';

// The script (scripts/run-engine-v3-benchmarks.mjs) sets this env var to
// capture the panel report to a tmp path it owns. We re-run the panel once
// per env var and write the resulting JSON to that path after all tests.
const engineV3ArtifactPath = process.env.ENGINE_V3_BENCH_ARTIFACT ?? null;
let scriptReport: EngineV3BenchmarkReport | null = null;

beforeAll(() => {
  if (engineV3ArtifactPath) {
    scriptReport = runEngineV3BenchmarkPanel();
  }
});

afterAll(() => {
  if (engineV3ArtifactPath && scriptReport) {
    writeFileSync(engineV3ArtifactPath, `${JSON.stringify(scriptReport, null, 2)}\n`, 'utf8');
  }
});

const EXPECTED_CASE_IDS = [
  'severe-tree-walk-loop-regression',
  'marginal-tree-walk-adjusted-regression',
  'lollipop-stem-loop',
  'figure-eight-two-loops',
  'forest-loop-real-graph',
];

describe('engine V3 offline benchmark panel', () => {
  it('declares exactly the five expected generic case ids in order', () => {
    expect(ENGINE_V3_BENCHMARK_CASES.map((entry) => entry.caseId)).toEqual(EXPECTED_CASE_IDS);
  });

  it('runner returns exactly five cases with engine v3-clean-room and zero non-finite numbers', () => {
    const report = runEngineV3BenchmarkPanel();

    expect(report.engine).toBe('v3-clean-room');
    expect(report.totalCases).toBe(5);
    expect(report.cases).toHaveLength(5);
    expect(report.passed + report.failed).toBe(5);

    for (const caseReport of report.cases) {
      expect(caseReport.engineVersion).toBe('v3-clean-room');
      // No NaN / Infinity anywhere in the case report.
      const seen = new WeakSet<object>();
      const walk = (value: unknown, path: string): void => {
        if (typeof value === 'number') {
          expect.soft(Number.isFinite(value), `${path} should be finite (got ${value})`).toBe(true);
        } else if (value && typeof value === 'object') {
          if (seen.has(value as object)) return;
          seen.add(value as object);
          for (const [k, v] of Object.entries(value)) walk(v, `${path}.${k}`);
        }
      };
      walk(caseReport, 'caseReport');
    }
  });

  it('writes a JSON artifact matching the in-memory report when --write is provided', () => {
    const artifactDir = mkdtempSync(join(tmpdir(), 'engine-v3-bench-'));
    const artifactPath = join(artifactDir, 'panel.json');
    try {
      const report = runEngineV3BenchmarkPanel({ writeArtifactPath: artifactPath });
      const onDisk = JSON.parse(readFileSync(artifactPath, 'utf8'));
      // JSON.stringify drops `undefined` properties; the in-memory report may
      // carry them. Compare the structurally meaningful fields rather than
      // doing a strict toEqual on the whole object.
      expect(onDisk.engine).toEqual(report.engine);
      expect(onDisk.totalCases).toEqual(report.totalCases);
      expect(onDisk.passed).toEqual(report.passed);
      expect(onDisk.failed).toEqual(report.failed);
      expect(onDisk.cases).toHaveLength(report.cases.length);
      for (let i = 0; i < onDisk.cases.length; i += 1) {
        const disk = onDisk.cases[i];
        const live = report.cases[i]!;
        expect(disk.caseId).toEqual(live.caseId);
        expect(disk.passed).toEqual(live.passed);
        expect(disk.actualOutcome).toEqual(live.actualOutcome);
        expect(disk.metrics).toEqual(live.metrics);
        expect(disk.diagnostics).toEqual(live.diagnostics);
      }
      expect(onDisk.generatedAt).toEqual(report.generatedAt);
    } finally {
      rmSync(artifactDir, { recursive: true, force: true });
    }
  });

  it('severe-tree-walk-loop-regression passes as refused TREE_WALK_NOT_A_LOOP', () => {
    const report = runEngineV3BenchmarkPanel();
    const caseReport = report.cases.find((c) => c.caseId === 'severe-tree-walk-loop-regression')!;
    expect(caseReport.actualOutcome.type).toBe('refused');
    expect(caseReport.actualSubCode).toBe('TREE_WALK_NOT_A_LOOP');
    expect(caseReport.passed).toBe(true);
    expect(caseReport.failures).toEqual([]);
  });

  it('marginal-tree-walk-adjusted-regression passes as adjusted with a tree-walk/ topology compromise', () => {
    const report = runEngineV3BenchmarkPanel();
    const caseReport = report.cases.find((c) => c.caseId === 'marginal-tree-walk-adjusted-regression')!;
    expect(caseReport.actualOutcome.type).toBe('adjusted');
    expect(caseReport.actualSubCode).toBeNull();
    expect(caseReport.passed).toBe(true);
    expect(caseReport.failures).toEqual([]);
    if (caseReport.actualOutcome.type === 'adjusted') {
      const text = caseReport.actualOutcome.compromises.join(' ');
      expect(text).toMatch(/tree walk|topology/i);
    }
  });

  it('lollipop-stem-loop passes and is never refused', () => {
    const report = runEngineV3BenchmarkPanel();
    const caseReport = report.cases.find((c) => c.caseId === 'lollipop-stem-loop')!;
    expect(caseReport.actualOutcome.type).not.toBe('refused');
    expect(caseReport.actualSubCode).toBeNull();
    expect(caseReport.passed).toBe(true);
    expect(caseReport.failures).toEqual([]);
    expect(caseReport.metrics.topology.graphCyclomaticNumber).toBeGreaterThanOrEqual(1);
    expect(caseReport.metrics.topology.cycleDistanceKm).toBeGreaterThan(0);
  });

  it('figure-eight-two-loops passes and has graphCyclomaticNumber >= 2', () => {
    const report = runEngineV3BenchmarkPanel();
    const caseReport = report.cases.find((c) => c.caseId === 'figure-eight-two-loops')!;
    expect(caseReport.actualOutcome.type).not.toBe('refused');
    expect(caseReport.passed).toBe(true);
    expect(caseReport.failures).toEqual([]);
    expect(caseReport.metrics.topology.graphCyclomaticNumber).toBeGreaterThanOrEqual(2);
  });

  it('forest-loop-real-graph passes and is never TREE_WALK_NOT_A_LOOP', () => {
    const report = runEngineV3BenchmarkPanel();
    const caseReport = report.cases.find((c) => c.caseId === 'forest-loop-real-graph')!;
    expect(caseReport.passed).toBe(true);
    expect(caseReport.failures).toEqual([]);
    if (caseReport.actualOutcome.type === 'refused') {
      expect(caseReport.actualSubCode).not.toBe('TREE_WALK_NOT_A_LOOP');
    }
  });

  it('forced threshold failure returns passed=false and a fail_topology_threshold code', () => {
    // Take the lollipop case, force an impossible topology threshold. The case
    // must be marked failed with a topology failure code; the runner does not
    // throw, and the underlying outcome may still be 'generated' (we are
    // exercising the assertion layer, not the engine).
    const baseCase = ENGINE_V3_BENCHMARK_CASES.find((c) => c.caseId === 'lollipop-stem-loop')!;
    const forced: EngineV3BenchmarkCase = {
      ...baseCase,
      caseId: 'lollipop-stem-loop-forced-fail',
      expectedTopology: {
        // Lollipop has 1 cycle; we force 99. The decider is unaffected; the
        // assertion layer must catch it.
        minGraphCyclomaticNumber: 99,
      },
    };
    const report = runEngineV3BenchmarkPanel({ cases: [forced] });
    const caseReport = report.cases[0]!;
    expect(caseReport.passed).toBe(false);
    expect(caseReport.failures.map((f) => f.code)).toContain('fail_topology_threshold');
    expect(report.failed).toBe(1);
    expect(report.passed).toBe(0);
  });
});
