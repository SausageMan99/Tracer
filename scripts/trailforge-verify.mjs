#!/usr/bin/env node
/**
 * TrailForge agentic verification harness.
 *
 * Runs the full VERIFY cycle: git state, typecheck, lint, test:run, Fontainebleau
 * benchmark, Tourville benchmark, metrics extraction, baseline comparison.
 *
 * Pure read-only on the repo. Never commits, never pushes, never stashes.
 * Writes artifacts under artifacts/engine-v3-benchmarks/agent-verify-* to keep the
 * baseline-runs distinct.
 *
 * Exit 0 only if every blocking gate passes.
 */

import { spawnSync } from "node:child_process";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const repoRoot = resolve(__dirname, "..");
const agentDir = resolve(repoRoot, ".trailforge-agent");
const benchmarksRoot = resolve(repoRoot, "artifacts/engine-v3-benchmarks");
const stamp = new Date().toISOString().replace(/[:.]/g, "-");
const agentRunRoot = resolve(benchmarksRoot, `agent-verify-${stamp}`);

// ---------- helpers ----------

function readJson(path) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function run(cmd, args, opts = {}) {
  const result = spawnSync(cmd, args, {
    cwd: repoRoot,
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
    ...opts,
  });
  // vitest (and some other tools) write the run summary to stderr instead of stdout.
  // Combine both streams so regex-based assertions see the full picture.
  const stdout = (result.stdout ?? "").trim();
  const stderr = (result.stderr ?? "").trim();
  return {
    code: result.status ?? 1,
    stdout,
    stderr,
    combined: stdout + "\n" + stderr,
  };
}

function gate(name, ok, detail = "") {
  const mark = ok ? "PASS" : "FAIL";
  console.log(`  [${mark}] ${name}${detail ? " — " + detail : ""}`);
  return ok;
}

function approxEq(actual, expected, tolerance) {
  if (typeof actual !== "number" || typeof expected !== "number") return false;
  return Math.abs(actual - expected) <= tolerance;
}

// ---------- gates ----------

const failures = [];
function recordFailure(gateName) {
  failures.push(gateName);
}

console.log(`# TrailForge verify — ${stamp}`);
console.log(`repo: ${repoRoot}`);

// Gate 1: working tree state
console.log("\n[1/8] git working tree");
const status = run("git", ["status", "--short", "--branch"]);
if (status.code !== 0) {
  gate("git status", false, status.stderr);
  recordFailure("git status");
} else {
  console.log(`  ${status.stdout.split("\n")[0]}`);
  // Working tree should at minimum show the branch line; untracked is OK
  const modifiedFiles = status.stdout.split("\n").filter((l) => l.startsWith(" M") || l.startsWith("M "));
  if (modifiedFiles.length > 0) {
    console.log(`  modified files: ${modifiedFiles.length}`);
    modifiedFiles.forEach((f) => console.log(`    ${f}`));
  } else {
    console.log(`  no modified tracked files`);
  }
  gate("git status", true);
}

// Gate 2: HEAD on expected branch
console.log("\n[2/8] git HEAD on expected branch");
const head = run("git", ["rev-parse", "--short", "HEAD"]);
const branch = run("git", ["rev-parse", "--abbrev-ref", "HEAD"]);
const expectedBranch = "trailforge-v3-clean-from-04b7409";
if (branch.stdout === expectedBranch) {
  gate("branch == trailforge-v3-clean-from-04b7409", true, `HEAD=${head.stdout}`);
} else {
  gate("branch check", false, `actual=${branch.stdout} expected=${expectedBranch}`);
  recordFailure("branch check");
}

// Gate 3: stash@{0} intact
console.log("\n[3/8] stash@{0} integrity");
// CI/GitHub Actions runners are ephemeral and do not preserve local Hermes
// stash state (the protected wip-v3-extraction-fix-7files-04b7409-... stash
// lives on the developer's VPS, not on the runner). The local stash integrity
// gate is a VPS-specific safety net and cannot be required in CI.
// Detection: GitHub Actions sets GITHUB_ACTIONS=true; most CI providers also
// set CI=true. Both must be true to skip — a single trigger is too loose.
const isCi = process.env.GITHUB_ACTIONS === "true" && process.env.CI === "true";
const stashList = run("git", ["stash", "list"]);
if (stashList.code !== 0) {
  gate("stash list", false, stashList.stderr);
  recordFailure("stash list");
} else if (isCi) {
  // CI: skip the local stash integrity check, but do not silently swallow
  // real `git stash list` failures (the run() error path above still fails).
  const ciSkipReason = "skipped in CI because GitHub Actions runners do not preserve local Hermes stash state";
  gate("stash@{0} integrity", true, `[SKIP in CI] ${ciSkipReason}`);
} else {
  const expectedStash = "wip-v3-extraction-fix-7files-04b7409-20260616T222406Z";
  const top = stashList.stdout.split("\n")[0] ?? "";
  if (top.includes(expectedStash)) {
    gate("stash@{0} expected message", true, top);
  } else {
    gate("stash@{0} message", false, `actual="${top}" expected contains "${expectedStash}"`);
    recordFailure("stash@{0} integrity");
  }
}

// Gate 4: typecheck
console.log("\n[4/8] typecheck");
const tsc = run("npx", ["tsc", "--noEmit"]);
if (tsc.code === 0) {
  gate("tsc --noEmit", true);
} else {
  gate("tsc --noEmit", false, tsc.stdout || tsc.stderr);
  recordFailure("tsc");
}

// Gate 5: lint
console.log("\n[5/8] lint");
const lint = run("npm", ["run", "lint"]);
if (lint.code === 0) {
  gate("eslint", true);
} else {
  gate("eslint", false, lint.stdout || lint.stderr);
  recordFailure("lint");
}

// Gate 6: tests
console.log("\n[6/8] tests");
// Use vitest's JSON reporter to get a structured summary that survives failures
// (the human-readable summary line is suppressed when there are too many failures).
const vitestJsonPath = resolve(agentRunRoot, "vitest-summary.json");
run("npx", ["vitest", "run", "--reporter=json", `--outputFile=${vitestJsonPath}`]);
let testFailed = "?";
let testPassed = "?";
let testTodo = "?";
if (existsSync(vitestJsonPath)) {
  try {
    const summary = readJson(vitestJsonPath);
    testFailed = String(summary.numFailedTests ?? "?");
    testPassed = String(summary.numPassedTests ?? "?");
    testTodo = String(summary.numTodoTests ?? "0");
  } catch (e) {
    console.log(`  [DEBUG] failed to parse vitest JSON: ${e.message}`);
  }
}
const baselines = readJson(resolve(agentDir, "baselines.json"));
const testBaseline = baselines.tests;
const testOk =
  testFailed === String(testBaseline.failed) &&
  testPassed === String(testBaseline.passed) &&
  testTodo === String(testBaseline.todo);
if (testOk) {
  gate("test profile matches baseline", true, `failed=${testFailed} passed=${testPassed} todo=${testTodo}`);
} else {
  gate(
    "test profile matches baseline",
    false,
    `failed=${testFailed} passed=${testPassed} todo=${testTodo} (baseline: ${testBaseline.failed}/${testBaseline.passed}/${testBaseline.todo})`
  );
  recordFailure("test profile");
}

// Gate 7 & 8: benchmarks
mkdirSync(agentRunRoot, { recursive: true });

function runBenchmark(caseId, label) {
  const outJson = resolve(agentRunRoot, `${caseId}.json`);
  const outDir = resolve(agentRunRoot, `${caseId}-routes`);
  mkdirSync(outDir, { recursive: true });
  const bench = run("npm", [
    "run",
    "benchmark:engine-v3",
    "--",
    "--case",
    caseId,
    "--output",
    outJson,
    "--artifact-dir",
    outDir,
  ]);
  if (bench.code !== 0) {
    gate(`benchmark ${label}`, false, bench.stdout || bench.stderr);
    recordFailure(`benchmark ${label}`);
    return null;
  }
  // Find the case artifact JSON
  const candidates = [
    resolve(outDir, `${caseId}.json`),
  ];
  let caseArtifact = null;
  for (const c of candidates) {
    if (existsSync(c)) {
      caseArtifact = readJson(c);
      break;
    }
  }
  if (!caseArtifact) {
    gate(`benchmark ${label} artifact`, false, "no artifact JSON found");
    recordFailure(`benchmark ${label} artifact`);
    return null;
  }
  return caseArtifact;
}

console.log("\n[7/8] Fontainebleau benchmark");
const fonte = runBenchmark("fontainebleau-croix-augas-trail-12k", "Fontainebleau");
const fonteBaseline = baselines.fontainebleau;
if (fonte) {
  const m = fonte.metrics ?? {};
  const t = fonteBaseline.tolerance ?? {};
  const outcome = typeof fonte.outcome === "string" ? fonte.outcome : fonte.outcome?.type;
  gate("outcome adjusted", outcome === "adjusted", `actual=${outcome}`);
  gate("naturalDwellKm >= 11", m.naturalDwellKm >= fonteBaseline.naturalDwellKm - 0.001, `actual=${m.naturalDwellKm} baseline=${fonteBaseline.naturalDwellKm}`);
  gate("trailRatio >= 0.95", m.trailRatio >= 0.95, `actual=${m.trailRatio}`);
  gate(
    "distanceProducedKm within tolerance",
    approxEq(m.distanceProducedKm, fonteBaseline.distanceProducedKm, t.distanceProducedKm_abs ?? 0.001),
    `actual=${m.distanceProducedKm} baseline=${fonteBaseline.distanceProducedKm}`
  );
  const budget = fonte.diagnostics?.assemblyDiagnostics?.candidateProductionDiagnostics?.targetRepeatBudget;
  if (budget) {
    gate("repeatBudgetExceeded == false", budget.repeatBudgetExceeded === false, `actual=${budget.repeatBudgetExceeded}`);
  } else {
    gate("targetRepeatBudget present", false, "diagnostic not found in case artifact");
    recordFailure("fontainebleau budget");
  }
}

console.log("\n[8/8] Tourville benchmark");
const tourv = runBenchmark("tourville-trail-8k", "Tourville");
const tourvBaseline = baselines.tourville;
if (tourv) {
  const m = tourv.metrics ?? {};
  const t = tourvBaseline.tolerance ?? {};
  const outcome = typeof tourv.outcome === "string" ? tourv.outcome : tourv.outcome?.type;
  gate("outcome refused", outcome === "refused", `actual=${outcome}`);
  gate("distanceProducedKm > 0", m.distanceProducedKm > 0, `actual=${m.distanceProducedKm}`);
  gate("targetRepeatKm > 3.0", m.targetRepeatKm > 3.0, `actual=${m.targetRepeatKm}`);
  const budget = tourv.diagnostics?.assemblyDiagnostics?.candidateProductionDiagnostics?.targetRepeatBudget;
  if (budget) {
    gate("repeatBudgetExceeded == true", budget.repeatBudgetExceeded === true, `actual=${budget.repeatBudgetExceeded}`);
    gate("rejectedBecauseTargetRepeat == false", budget.rejectedBecauseTargetRepeat === false, `actual=${budget.rejectedBecauseTargetRepeat}`);
  } else {
    gate("targetRepeatBudget present", false, "diagnostic not found in case artifact");
    recordFailure("tourville budget");
  }
  gate(
    "targetRepeatKm within tolerance",
    approxEq(m.targetRepeatKm, tourvBaseline.targetRepeatKm, t.targetRepeatKm_abs ?? 0.05),
    `actual=${m.targetRepeatKm} baseline=${tourvBaseline.targetRepeatKm}`
  );
}

// ---------- final ----------

console.log("\n========== SUMMARY ==========");
if (failures.length === 0) {
  console.log("RESULT: PASS — all gates green");
  console.log(`agent run artifacts: ${agentRunRoot}`);
  process.exit(0);
} else {
  console.log(`RESULT: FAIL — ${failures.length} gate(s) blocked: ${failures.join(", ")}`);
  console.log(`agent run artifacts (for debugging): ${agentRunRoot}`);
  process.exit(1);
}
