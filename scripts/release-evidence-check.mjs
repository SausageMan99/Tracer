#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname } from "node:path";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const args = process.argv.slice(2);

const DEFAULT_REPORT = "artifacts/route-benchmark-results/beta-smoke-latest.json";
const DEFAULT_BENCHMARK_DATA = "lib/route-benchmarks-data.json";
const DEFAULT_EXPECTED_BRANCH = "feat/p1-2-quality-ratio-interpretation";
const DEFAULT_EXPECTED_HEAD = "f5ccccbf6fab990fa03020ec0a37895c3be654c4";
const REQUIRED_BETA_SMOKE_CASE_IDS = [
  "fontainebleau-trail-15k",
  "caen-colline-aux-oiseaux-6k-soft",
  "meudon-forest-trail-10k",
  "tourville-pommiers-trail-8k",
];

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run release:evidence-check -- [options]

Checks the pushed beta-scope evidence ledger without rerunning live route generation.

Options:
  --report <path>              Beta smoke report JSON. Default: ${DEFAULT_REPORT}
  --benchmark-data <path>      Benchmark contract data JSON. Default: ${DEFAULT_BENCHMARK_DATA}
  --expected-branch <branch>   Expected git branch. Default: ${DEFAULT_EXPECTED_BRANCH}
  --expected-head <sha>        Expected local/remote HEAD. Default: ${DEFAULT_EXPECTED_HEAD}
  --skip-git                  Skip branch/head/status checks; intended for network-free unit tests only.
  --help                      Show this help.`);
  process.exit(0);
}

const reportPath = resolve(repoRoot, getArgValue("--report") ?? DEFAULT_REPORT);
const benchmarkDataPath = resolve(repoRoot, getArgValue("--benchmark-data") ?? DEFAULT_BENCHMARK_DATA);
const expectedBranch = getArgValue("--expected-branch") ?? DEFAULT_EXPECTED_BRANCH;
const expectedHead = getArgValue("--expected-head") ?? DEFAULT_EXPECTED_HEAD;
const skipGit = args.includes("--skip-git");

const failures = [];
const warnings = [];

function getArgValue(name) {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function readJson(path, label) {
  if (!existsSync(path)) {
    failures.push(`${label} missing at ${path}`);
    return null;
  }
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    failures.push(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
    return null;
  }
}

function git(args) {
  return execFileSync("git", args, { cwd: repoRoot, encoding: "utf8" }).trim();
}

function checkGitState() {
  if (skipGit) return;

  const branch = git(["branch", "--show-current"]);
  const head = git(["rev-parse", "HEAD"]);
  const remoteHead = git(["rev-parse", `origin/${expectedBranch}`]);
  const status = git(["status", "--short"]);

  if (branch !== expectedBranch) failures.push(`branch mismatch: expected ${expectedBranch}, got ${branch}`);
  if (head.length === 0) failures.push("HEAD could not be resolved");
  if (remoteHead !== expectedHead && remoteHead !== head) {
    failures.push(`remote HEAD mismatch: expected origin/${expectedBranch} at beta base ${expectedHead} or local HEAD ${head}, got ${remoteHead}`);
  }
  try {
    execFileSync("git", ["merge-base", "--is-ancestor", expectedHead, "HEAD"], { cwd: repoRoot, encoding: "utf8" });
  } catch {
    failures.push(`expected beta base ${expectedHead} is not an ancestor of local HEAD ${head}`);
  }
  if (status.length > 0) failures.push(`working tree must be clean before beta evidence sign-off; git status --short:\n${status}`);
}

function byId(items) {
  return new Map((items ?? []).filter((item) => item?.id).map((item) => [item.id, item]));
}

function checkExactBetaSmokePanel(report) {
  const results = report?.results;
  if (!Array.isArray(results)) {
    failures.push("beta-smoke results must be an array with the exact required beta case panel");
    return;
  }

  if (results.length !== REQUIRED_BETA_SMOKE_CASE_IDS.length) {
    failures.push(`beta-smoke results must contain exactly ${REQUIRED_BETA_SMOKE_CASE_IDS.length} cases, got ${results.length}`);
  }

  const counts = new Map();
  for (const result of results) {
    const id = result?.id;
    if (typeof id !== "string" || id.length === 0) {
      failures.push("beta-smoke result is missing a string id");
      continue;
    }
    counts.set(id, (counts.get(id) ?? 0) + 1);
    if (!REQUIRED_BETA_SMOKE_CASE_IDS.includes(id)) {
      failures.push(`unexpected beta-smoke case ${id}`);
    }
  }

  for (const id of REQUIRED_BETA_SMOKE_CASE_IDS) {
    const count = counts.get(id) ?? 0;
    if (count === 0) failures.push(`missing required beta-smoke case ${id}`);
    if (count > 1) failures.push(`duplicate beta-smoke case ${id}`);
  }
}

function checkReportSummary(report) {
  if (report == null) return;

  if (report.total !== 4) failures.push(`beta-smoke total must be 4, got ${report.total}`);
  if (report.passed !== 4) failures.push(`beta-smoke passed must be 4, got ${report.passed}`);
  if (report.failed !== 0) failures.push(`beta-smoke failed must be 0, got ${report.failed}`);
  if (report.skipped !== 0) failures.push(`beta-smoke skipped must be 0, got ${report.skipped}`);
  if (report.beta_scope_status !== "BETA_SCOPE_CANDIDATE_LOCAL") {
    failures.push(`beta_scope_status must be BETA_SCOPE_CANDIDATE_LOCAL, got ${report.beta_scope_status}`);
  }
  if (report.ga_status !== "NO-GO_GA") failures.push(`ga_status must remain NO-GO_GA, got ${report.ga_status}`);

  for (const flag of ["thresholdsChanged", "surfaceReclassification", "typedRefusalMasked"]) {
    if (report[flag] !== false) failures.push(`${flag} must be false, got ${report[flag]}`);
  }

  if (!Array.isArray(report.beta_smoke_excluded_cases) || !report.beta_smoke_excluded_cases.includes("tourville-pommiers-trail-12k")) {
    failures.push("beta_smoke_excluded_cases must include tourville-pommiers-trail-12k");
  }
  if (!Array.isArray(report.readiness_blockers) || !report.readiness_blockers.includes("tourville-pommiers-trail-12k")) {
    failures.push("readiness_blockers must include tourville-pommiers-trail-12k");
  }
}

function artifactExists(relativePath) {
  return typeof relativePath === "string" && existsSync(resolve(repoRoot, relativePath));
}

function checkRequiredArtifacts(report) {
  for (const result of report?.results ?? []) {
    const artifacts = result.routeArtifacts ?? {};
    const actualOutcome = result.metrics?.actualOutcome;
    if (actualOutcome === "typed_refusal") {
      if (!artifactExists(artifacts.rejectedCandidatesJson) && result.rejectedCandidatesDiagnostics == null) {
        failures.push(`${result.id}: typed_refusal must keep rejected candidate diagnostics artifact or inline diagnostics`);
      }
      continue;
    }

    if (result.passed === true) {
      if (!artifactExists(artifacts.routeJson ?? result.routeArtifact)) {
        failures.push(`${result.id}: successful beta result is missing route JSON artifact`);
      }
      if (!artifactExists(artifacts.edgeDiagnosticsJson)) {
        failures.push(`${result.id}: successful beta result is missing edge diagnostics artifact`);
      }
    }
  }
}

function checkExpectedContracts(report, benchmarkData) {
  const results = byId(report?.results);
  const benchmarks = byId(benchmarkData);

  for (const result of report?.results ?? []) {
    const benchmark = benchmarks.get(result.id);
    if (benchmark?.thresholds != null && result.thresholds != null) {
      const expected = JSON.stringify(benchmark.thresholds);
      const actual = JSON.stringify(result.thresholds);
      if (expected !== actual) failures.push(`${result.id}: result thresholds differ from benchmark data without approval`);
    }
  }

  for (const benchmark of benchmarkData ?? []) {
    const result = results.get(benchmark.id);
    if (result == null) continue;

    const metrics = result.metrics ?? {};
    if (benchmark.expectedOutcome === "typed_refusal") {
      if (metrics.actualOutcome !== "typed_refusal") {
        failures.push(`${benchmark.id}: expected typed_refusal but got ${metrics.actualOutcome ?? "missing actualOutcome"}`);
      }
      if (benchmark.expectedRefusalSubCode != null && metrics.refusalSubCode !== benchmark.expectedRefusalSubCode) {
        failures.push(`${benchmark.id}: expected refusal subCode ${benchmark.expectedRefusalSubCode} but got ${metrics.refusalSubCode ?? "missing refusalSubCode"}`);
      }
    }

    const hasAdjustedDistanceContract = benchmark.expectedOutcome === "adjusted_distance" || metrics.actualOutcome === "adjusted_distance";
    if (hasAdjustedDistanceContract) {
      if (typeof metrics.adjustedDistanceKm !== "number") {
        failures.push(`${benchmark.id}: adjusted_distance outcome must expose metrics.adjustedDistanceKm`);
      }
      const range = benchmark.adjustedDistanceKm;
      if (range != null && typeof metrics.adjustedDistanceKm === "number") {
        if (metrics.adjustedDistanceKm < range.min || metrics.adjustedDistanceKm > range.max) {
          failures.push(`${benchmark.id}: adjustedDistanceKm ${metrics.adjustedDistanceKm} outside approved range ${range.min}-${range.max}`);
        }
      }
    }
  }
}

function checkSurfaceLaundering(report) {
  for (const result of report?.results ?? []) {
    const metrics = result.metrics ?? {};
    if (typeof metrics.pavedRatio === "number" && typeof metrics.naturalWayRatio === "number" && typeof metrics.trailRatio === "number") {
      if (metrics.pavedRatio > 0 && metrics.trailRatio >= metrics.naturalWayRatio + metrics.pavedRatio - 0.000001) {
        failures.push(`${result.id}: suspicious surface laundering; pavedRatio appears folded into trailRatio`);
      }
    }

    for (const candidate of result.rejectedCandidatesDiagnostics?.topCandidates ?? []) {
      if (typeof candidate.pavedRatio === "number" && typeof candidate.naturalWayRatio === "number" && candidate.pavedRatio > 0.2 && candidate.naturalWayRatio >= 0.95) {
        warnings.push(`${result.id}: candidate ${candidate.candidateIndex} has high pavedRatio and near-total naturalWayRatio; inspect surface taxonomy if this regresses`);
      }
    }
  }
}

checkGitState();
const report = readJson(reportPath, "beta smoke report");
const benchmarkData = readJson(benchmarkDataPath, "benchmark data");
checkReportSummary(report);
checkExactBetaSmokePanel(report);
checkRequiredArtifacts(report);
checkExpectedContracts(report, benchmarkData);
checkSurfaceLaundering(report);

if (warnings.length > 0) {
  for (const warning of warnings) console.warn(`warning: ${warning}`);
}

if (failures.length > 0) {
  console.error("release evidence check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`release evidence check passed: ${reportPath.replace(`${repoRoot}/`, "")}`);
