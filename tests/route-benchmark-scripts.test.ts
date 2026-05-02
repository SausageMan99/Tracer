import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { describe, expect, it } from "vitest";

const repoRoot = resolve(__dirname, "..");
const nodeBin = process.execPath;

function writeReport(path: string, result: Record<string, unknown>) {
  writeFileSync(
    path,
    JSON.stringify({ generatedAt: "2026-01-01T00:00:00.000Z", results: [result] }, null, 2),
    "utf8"
  );
}

describe("route benchmark scripts", () => {
  it("prints benchmark tier and tags in --list without network", () => {
    const stdout = execFileSync(nodeBin, ["scripts/run-route-benchmarks.mjs", "--list"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(stdout).toContain("tourville-pommiers-trail-10k");
    expect(stdout).toContain("p0");
    expect(stdout).toContain("tourville,trail,field-feedback");
  });

  it("exposes the mandatory Sprint 4 multi-zone smoke command", () => {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    const command = packageJson.scripts["benchmark:routes:sprint4-smoke"];
    const requiredIds = [
      "tourville-pommiers-trail-8k",
      "tourville-pommiers-trail-12k",
      "fontainebleau-trail-15k",
      "caen-colline-aux-oiseaux-6k-soft",
      "meudon-forest-trail-10k",
    ];

    expect(command).toContain("node scripts/run-route-benchmarks.mjs");
    expect(command).toContain("--save-artifacts");
    expect(command).toContain("artifacts/route-benchmark-results/sprint4-smoke-latest.json");
    expect(command).toContain("artifacts/route-benchmark-results/sprint4-smoke-routes");

    const cases = [...command.matchAll(/--case\s+([^\s]+)/g)].map((match) => match[1]);
    expect(cases).toEqual(requiredIds);
  });

  it("documents the wider benchmark fetch timeout margin for grouped smoke diagnostics", () => {
    const stdout = execFileSync(nodeBin, ["scripts/run-route-benchmarks.mjs", "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(stdout).toContain("Default: 45000");
  });

  it("keeps metric-only regressions neutral without --strict", () => {
    const dir = mkdtempSync(join(tmpdir(), "route-benchmark-compare-"));
    const before = join(dir, "before.json");
    const after = join(dir, "after.json");
    writeReport(before, {
      id: "case-a",
      passed: true,
      failures: [],
      metrics: { productionScore: 0.9, busyRoadRatio: 0.02 },
    });
    writeReport(after, {
      id: "case-a",
      passed: true,
      failures: [],
      metrics: { productionScore: 0.8, busyRoadRatio: 0.04 },
    });

    const result = spawnSync(nodeBin, ["scripts/compare-route-benchmarks.mjs", "--before", before, "--after", after], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(result.status).toBe(0);
    expect(result.stdout).toContain("case-a neutral");
  });

  it("fails metric-only regressions with --strict and configurable tolerance", () => {
    const dir = mkdtempSync(join(tmpdir(), "route-benchmark-compare-"));
    const before = join(dir, "before.json");
    const after = join(dir, "after.json");
    const output = join(dir, "delta.json");
    writeReport(before, {
      id: "case-a",
      passed: true,
      failures: [],
      metrics: {
        productionScore: 0.9,
        geometry: { loopCompactness: 0.5 },
      },
    });
    writeReport(after, {
      id: "case-a",
      passed: true,
      failures: [],
      metrics: {
        productionScore: 0.897,
        geometry: { loopCompactness: 0.4995 },
      },
    });

    const result = spawnSync(
      nodeBin,
      [
        "scripts/compare-route-benchmarks.mjs",
        "--before",
        before,
        "--after",
        after,
        "--strict",
        "--tolerance",
        "0.001",
        "--output",
        output,
      ],
      { cwd: repoRoot, encoding: "utf8" }
    );

    expect(result.status).toBe(1);
    expect(result.stdout).toContain("case-a regressed");
    const report = JSON.parse(readFileSync(output, "utf8"));
    expect(report.strict).toBe(true);
    expect(report.tolerance).toBe(0.001);
    expect(report.results[0].verdict).toBe("regressed");
    expect(report.results[0].strictRegressionMetrics).toEqual(["productionScore"]);
  });
});
