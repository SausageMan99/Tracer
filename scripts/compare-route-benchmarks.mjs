#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import { dirname, resolve } from "node:path";

const args = process.argv.slice(2);

function getArgValue(name) {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return undefined;
}

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run benchmark:routes:compare -- --before before.json --after after.json [--output delta.json] [--strict] [--tolerance 0.001]

Compares two TrailForge route benchmark aggregate JSON reports and exits 1 on pass/failure regressions.
With --strict, metric-only regressions in tracked numeric metrics also exit 1.`);
  process.exit(0);
}

const beforePath = getArgValue("--before");
const afterPath = getArgValue("--after");
const outputPath = getArgValue("--output");
const strict = args.includes("--strict");
const toleranceValue = Number(getArgValue("--tolerance") ?? 0.001);
const tolerance = Number.isFinite(toleranceValue) && toleranceValue >= 0 ? toleranceValue : 0.001;

if (!beforePath || !afterPath) {
  console.error("Missing --before or --after");
  process.exit(2);
}

const higherIsBetter = new Set([
  "productionScore",
  "trailRatio",
  "naturalWayRatio",
  "trailBeautyScore",
  "longestTrailSegmentKm",
  "naturalCorridorRatio",
  "loopCompactness",
  "maxDistanceFromStartKm",
]);

const lowerIsBetter = new Set([
  "distanceErrorRatio",
  "elevationErrorM",
  "elevationErrorPct",
  "loopClosureKm",
  "busyRoadRatio",
  "pavedRatio",
  "scenicPavedRatio",
  "repeatEdgeRatio",
  "uTurnRatio",
  "durationMs",
  "geometryOverlapRatio",
  "selfIntersectionCount",
  "sharpTurnDensityPerKm",
  "headingReversalRatio",
  "outAndBackSimilarityRatio",
  "startStemKm",
  "endStemKm",
]);

function flattenMetrics(metrics = {}) {
  const flattened = {};
  for (const [key, value] of Object.entries(metrics)) {
    if (value != null && typeof value === "object" && !Array.isArray(value)) {
      for (const [nestedKey, nestedValue] of Object.entries(value)) flattened[nestedKey] = nestedValue;
    } else {
      flattened[key] = value;
    }
  }
  return flattened;
}

function readResults(report) {
  return new Map((report.results ?? []).map((result) => [result.id, result]));
}

function statusChange(before, after) {
  if (!before) return "missing_before";
  if (!after) return "missing_after";
  if (before.passed && after.passed) return "unchanged_pass";
  if (!before.passed && !after.passed) return "unchanged_fail";
  if (before.passed && !after.passed) return "pass_to_fail";
  return "fail_to_pass";
}

function compareMetric(key, beforeValue, afterValue) {
  if (typeof beforeValue !== "number" || typeof afterValue !== "number") return null;
  const delta = Number((afterValue - beforeValue).toFixed(5));
  const improved = higherIsBetter.has(key)
    ? delta > 0
    : lowerIsBetter.has(key)
      ? delta < 0
      : false;
  const regressed = higherIsBetter.has(key)
    ? delta < 0
    : lowerIsBetter.has(key)
      ? delta > 0
      : false;
  return {
    before: beforeValue,
    after: afterValue,
    delta,
    direction: delta > 0 ? "up" : delta < 0 ? "down" : "flat",
    improved,
    regressed,
  };
}

const beforeReport = JSON.parse(await readFile(resolve(beforePath), "utf8"));
const afterReport = JSON.parse(await readFile(resolve(afterPath), "utf8"));
const beforeById = readResults(beforeReport);
const afterById = readResults(afterReport);
const ids = Array.from(new Set([...beforeById.keys(), ...afterById.keys()])).sort();

const results = ids.map((id) => {
  const before = beforeById.get(id);
  const after = afterById.get(id);
  const beforeFailures = new Set(before?.failures ?? []);
  const afterFailures = new Set(after?.failures ?? []);
  const failureDelta = {
    added: [...afterFailures].filter((failure) => !beforeFailures.has(failure)),
    removed: [...beforeFailures].filter((failure) => !afterFailures.has(failure)),
    unchanged: [...afterFailures].filter((failure) => beforeFailures.has(failure)),
  };
  const beforeMetrics = flattenMetrics(before?.metrics ?? {});
  const afterMetrics = flattenMetrics(after?.metrics ?? {});
  const metricDelta = {};
  for (const key of new Set([...Object.keys(beforeMetrics), ...Object.keys(afterMetrics)])) {
    const comparison = compareMetric(key, beforeMetrics[key], afterMetrics[key]);
    if (comparison) metricDelta[key] = comparison;
  }

  const change = statusChange(before, after);
  const strictRegressionMetrics = Object.entries(metricDelta)
    .filter(([, metric]) => metric.regressed && Math.abs(metric.delta) > tolerance)
    .map(([key]) => key)
    .sort();
  const regressionMetrics = Object.values(metricDelta).filter((metric) => metric.regressed && Math.abs(metric.delta) > tolerance).length;
  const improvementMetrics = Object.values(metricDelta).filter((metric) => metric.improved && Math.abs(metric.delta) > tolerance).length;
  const verdict = change === "pass_to_fail" || failureDelta.added.length > 0 || (strict && strictRegressionMetrics.length > 0)
    ? "regressed"
    : change === "fail_to_pass" || failureDelta.removed.length > 0 || improvementMetrics > regressionMetrics
      ? "improved"
      : "neutral";

  return {
    id,
    statusChange: change,
    beforePassed: before?.passed ?? null,
    afterPassed: after?.passed ?? null,
    failureDelta,
    metricDelta,
    strictRegressionMetrics,
    verdict,
  };
});

const summary = {
  totalCompared: ids.length,
  passToFail: results.filter((result) => result.statusChange === "pass_to_fail").length,
  failToPass: results.filter((result) => result.statusChange === "fail_to_pass").length,
  stillFailing: results.filter((result) => result.statusChange === "unchanged_fail").length,
  stillPassing: results.filter((result) => result.statusChange === "unchanged_pass").length,
  regressions: results.filter((result) => result.verdict === "regressed").length,
  improvements: results.filter((result) => result.verdict === "improved").length,
};

const report = {
  generatedAt: new Date().toISOString(),
  before: beforePath,
  after: afterPath,
  strict,
  tolerance,
  summary,
  results,
};

for (const result of results) {
  const symbol = result.verdict === "regressed" ? "✗" : result.verdict === "improved" ? "✓" : "=";
  const detail = result.failureDelta.added.length
    ? `added ${result.failureDelta.added.join(", ")}`
    : result.failureDelta.removed.length
      ? `removed ${result.failureDelta.removed.join(", ")}`
      : result.statusChange;
  console.log(`${symbol} ${result.id} ${result.verdict} — ${detail}`);
}

if (outputPath) {
  await mkdir(dirname(resolve(outputPath)), { recursive: true });
  await writeFile(resolve(outputPath), `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Benchmark delta written to ${outputPath}`);
}

console.log(JSON.stringify(report.summary, null, 2));
process.exit(summary.regressions > 0 ? 1 : 0);
