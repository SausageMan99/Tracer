import { execFile, execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";

const execFileAsync = promisify(execFile);

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

  it("exposes separate beta smoke and readiness unstable commands for the Tourville12 quarantine", () => {
    const packageJson = JSON.parse(readFileSync(resolve(repoRoot, "package.json"), "utf8"));
    const betaCommand = packageJson.scripts["benchmark:routes:beta-smoke"];
    const readinessCommand = packageJson.scripts["benchmark:routes:readiness-unstable"];

    expect(betaCommand).toContain("node scripts/run-route-benchmarks.mjs");
    expect(betaCommand).toContain("--save-artifacts");
    expect(betaCommand).toContain("artifacts/route-benchmark-results/beta-smoke-latest.json");
    expect(betaCommand).toContain("artifacts/route-benchmark-results/beta-smoke-routes");
    expect(betaCommand).toContain("--beta-scope-report");
    expect(betaCommand).toContain("tourville12_quality_pavement_unstable");

    const betaCases = [...betaCommand.matchAll(/--case\s+([^\s]+)/g)].map((match) => match[1]);
    expect(betaCases).toEqual([
      "tourville-pommiers-trail-8k",
      "fontainebleau-trail-15k",
      "caen-colline-aux-oiseaux-6k-soft",
      "meudon-forest-trail-10k",
    ]);
    expect(betaCases).not.toContain("tourville-pommiers-trail-12k");

    expect(readinessCommand).toContain("tourville-pommiers-trail-12k");
    expect(readinessCommand).toContain("artifacts/route-benchmark-results/readiness-unstable-latest.json");
    expect(readinessCommand).toContain("artifacts/route-benchmark-results/readiness-unstable-routes");
  });

  it("documents the wider benchmark fetch timeout margin for grouped smoke diagnostics", () => {
    const stdout = execFileSync(nodeBin, ["scripts/run-route-benchmarks.mjs", "--help"], {
      cwd: repoRoot,
      encoding: "utf8",
    });

    expect(stdout).toContain("Default: 45000");
  });

  it("writes beta-scope evidence fields when the beta smoke command opts into the report", async () => {
    const dir = mkdtempSync(join(tmpdir(), "route-benchmark-beta-scope-"));
    const output = join(dir, "report.json");
    const receivedBodies: unknown[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        receivedBodies.push(JSON.parse(body));
        res.writeHead(200, { "content-type": "application/json" });
        res.end(JSON.stringify({
          success: true,
          route: {
            distanceKm: 15.1,
            ascendM: 230,
            quality: {
              productionScore: 0.9,
              loopClosureKm: 0.1,
              busyRoadRatio: 0.01,
              naturalWayRatio: 0.75,
              pavedRatio: 0.2,
              trailBeautyScore: 0.8,
              longestTrailSegmentKm: 4,
              naturalCorridorRatio: 0.7,
              repeatEdgeRatio: 0,
              uTurnRatio: 0,
              terrainDataConfidence: "high",
              trailPotential: "high",
              routeTrailQuality: "high",
              warnings: [],
            },
          },
        }));
      });
    });

    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (address == null || typeof address === "string") throw new Error("Expected local test server port");

    try {
      await execFileAsync(
        nodeBin,
        [
          "scripts/run-route-benchmarks.mjs",
          "--case",
          "fontainebleau-trail-15k",
          "--output",
          output,
          "--beta-scope-report",
          "tourville12_quality_pavement_unstable",
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            ROUTE_BENCHMARK_BASE_URL: `http://127.0.0.1:${address.port}`,
          },
        }
      );
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }

    expect(receivedBodies).toHaveLength(1);
    const report = JSON.parse(readFileSync(output, "utf8"));
    expect(report).toMatchObject({
      failed: 0,
      beta_smoke_excluded_reason: "tourville12_quality_pavement_unstable",
      beta_smoke_excluded_cases: ["tourville-pommiers-trail-12k"],
      beta_scope_status: "BETA_SCOPE_CANDIDATE_LOCAL",
      ga_status: "NO-GO_GA",
      readiness_blockers: ["tourville-pommiers-trail-12k"],
      thresholdsChanged: false,
      surfaceReclassification: false,
      typedRefusalMasked: false,
    });
  });

  it("persists rejected candidate diagnostics from 422 benchmark responses as artifact-only debug data", async () => {
    const dir = mkdtempSync(join(tmpdir(), "route-benchmark-rejected-"));
    const output = join(dir, "report.json");
    const artifactDir = join(dir, "artifacts");
    const rejectedCandidatesDiagnostics = {
      subCode: "TRAIL_PROMISE_UNMET",
      candidateCount: 422,
      selectedCandidateIndex: 0,
      topCandidateIndex: 0,
      rejectionReasonsHistogram: { paved_ratio: 17, critical_stability_risk: 5 },
      topCandidates: [{
        candidateIndex: 0,
        distanceKm: 7.9,
        ascendM: 110,
        productionScore: 0.72,
        pavedRatio: 0.51,
        trailRatio: 0.3,
        naturalWayRatio: 0.6,
        trailBeautyScore: 0.7,
        longestTrailSegmentKm: 2.1,
        repeatEdgeRatio: 0.01,
        uTurnRatio: 0,
        warnings: ["LOW_TRAIL_SHARE"],
        gate: {
          strictViable: false,
          relaxedViable: true,
          bucket: 1,
          violations: [{ key: "paved_ratio", severity: 0.06, blocking: true }],
          blockingViolationCount: 1,
          totalSeverity: 0.06,
          criticalStabilityRisk: 0.08,
        },
        criticalStabilityRisk: 0.08,
        thresholds: { maxPavedRatio: 0.45, minProductionScore: 0.7 },
        deltas: [{ key: "paved_ratio", actual: 0.51, limit: 0.45, deltaToPass: -0.06 }],
      }],
    };
    const receivedBodies: unknown[] = [];
    const server = createServer((req, res) => {
      let body = "";
      req.on("data", (chunk) => {
        body += chunk;
      });
      req.on("end", () => {
        receivedBodies.push(JSON.parse(body));
        res.writeHead(422, { "content-type": "application/json" });
        res.end(JSON.stringify({
          success: false,
          errorCode: "ROUTE_CANDIDATES_REJECTED",
          subCode: "TRAIL_PROMISE_UNMET",
          error: "rejected",
          rejectedCandidatesDiagnostics,
        }));
      });
    });

    await new Promise<void>((resolveListen) => server.listen(0, "127.0.0.1", resolveListen));
    const address = server.address();
    if (address == null || typeof address === "string") throw new Error("Expected local test server port");

    try {
      await execFileAsync(
        nodeBin,
        [
          "scripts/run-route-benchmarks.mjs",
          "--case",
          "tourville-pommiers-trail-8k",
          "--save-artifacts",
          "--output",
          output,
          "--artifact-dir",
          artifactDir,
        ],
        {
          cwd: repoRoot,
          env: {
            ...process.env,
            ROUTE_BENCHMARK_BASE_URL: `http://127.0.0.1:${address.port}`,
          },
        }
      );
    } finally {
      await new Promise<void>((resolveClose, rejectClose) => {
        server.close((error) => error ? rejectClose(error) : resolveClose());
      });
    }

    expect(receivedBodies[0]).toMatchObject({
      includeEdgeDiagnostics: true,
      includeGenerationDiagnostics: true,
    });
    const report = JSON.parse(readFileSync(output, "utf8"));
    expect(report.results[0]).toMatchObject({
      passed: true,
      status: 422,
      errorCode: "ROUTE_CANDIDATES_REJECTED",
      subCode: "TRAIL_PROMISE_UNMET",
      rejectedCandidatesDiagnostics,
      routeArtifacts: {
        rejectedCandidatesJson: expect.stringContaining("tourville-pommiers-trail-8k.rejected-candidates.json"),
      },
    });
    const artifact = JSON.parse(readFileSync(join(artifactDir, "tourville-pommiers-trail-8k.rejected-candidates.json"), "utf8"));
    expect(artifact).toEqual(rejectedCandidatesDiagnostics);
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
