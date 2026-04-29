#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const baseUrl = (process.env.ROUTE_BENCHMARK_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const outputPath = process.env.ROUTE_BENCHMARK_OUTPUT ?? "artifacts/route-benchmark-results/latest.json";
const shouldWriteOutput = !process.argv.includes("--no-output");
const hasExternalRoutingKey = Boolean(process.env.ORS_API_KEY || process.env.GRAPHHOPPER_API_KEY);

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: ROUTE_BENCHMARK_BASE_URL=https://your-app.vercel.app npm run benchmark:routes

Runs TrailForge production smoke benchmarks against /api/generate-route and fails on quality threshold regressions.

Environment:
  ROUTE_BENCHMARK_BASE_URL  Target app URL. Default: http://localhost:3000
  ROUTE_BENCHMARK_OUTPUT    JSON output path. Default: artifacts/route-benchmark-results/latest.json

Options:
  --no-output               Do not write the JSON artifact.`);
  process.exit(0);
}

const endpoint = `${baseUrl}/api/generate-route`;
const benchmarkDataPath = resolve(repoRoot, "lib/route-benchmarks-data.json");
const benchmarks = JSON.parse(await readFile(benchmarkDataPath, "utf8"));

function requestFrom(benchmark) {
  return {
    address: benchmark.address,
    profileId: benchmark.profileId,
    targetDistanceKm: benchmark.targetDistanceKm,
    targetElevationM: benchmark.targetElevationM,
    scenicMode: benchmark.scenicMode,
  };
}

function requiresExternalRouting(benchmark) {
  return benchmark.profileId.startsWith("cycling_");
}

function summarizeBenchmarkResult(benchmark, route) {
  const quality = route.quality ?? {};
  const distanceErrorRatio = Math.abs(route.distanceKm - benchmark.targetDistanceKm) / benchmark.targetDistanceKm;
  const elevationErrorM = Math.abs(route.ascendM - benchmark.targetElevationM);
  const productionScore = quality.productionScore ?? 0;
  const loopClosureKm = quality.loopGapKm ?? quality.loopClosureKm ?? Number.POSITIVE_INFINITY;
  const busyRoadRatio = quality.busyRoadRatio ?? 1;
  const naturalWayRatio = quality.trailRatio ?? quality.naturalWayRatio ?? 0;
  const warnings = quality.warnings ?? [];
  const failures = [];

  if (distanceErrorRatio > benchmark.thresholds.distanceToleranceRatio) failures.push("distance_tolerance");
  if (elevationErrorM > benchmark.thresholds.elevationToleranceM) failures.push("elevation_tolerance");
  if (productionScore < benchmark.thresholds.minProductionScore) failures.push("production_score");
  if (loopClosureKm > benchmark.thresholds.maxLoopClosureKm) failures.push("loop_closure");
  if (busyRoadRatio > benchmark.thresholds.maxBusyRoadRatio) failures.push("busy_road_ratio");
  if (benchmark.thresholds.minNaturalWayRatio !== undefined && naturalWayRatio < benchmark.thresholds.minNaturalWayRatio) {
    failures.push("natural_way_ratio");
  }
  if (warnings.includes("ONEWAY_VIOLATION")) failures.push("oneway_violation");

  return {
    id: benchmark.id,
    label: benchmark.label,
    passed: failures.length === 0,
    failures,
    metrics: {
      distanceKm: route.distanceKm,
      ascendM: route.ascendM,
      distanceErrorRatio,
      elevationErrorM,
      productionScore,
      loopClosureKm,
      busyRoadRatio,
      naturalWayRatio,
      warnings,
    },
    thresholds: benchmark.thresholds,
  };
}

async function runBenchmark(benchmark) {
  if (requiresExternalRouting(benchmark) && !hasExternalRoutingKey) {
    return {
      id: benchmark.id,
      label: benchmark.label,
      passed: true,
      skipped: true,
      failures: [],
      status: 0,
      durationMs: 0,
      errorCode: "EXTERNAL_ROUTER_NOT_CONFIGURED",
      error: "Skipped locally: cycling benchmarks require ORS_API_KEY or GRAPHHOPPER_API_KEY.",
    };
  }

  const started = Date.now();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestFrom(benchmark)),
    });
    const payload = await response.json().catch(() => ({}));
    const durationMs = Date.now() - started;

    if (!response.ok || payload.success !== true) {
      return {
        id: benchmark.id,
        label: benchmark.label,
        passed: false,
        failures: ["http_error"],
        status: response.status,
        durationMs,
        errorCode: payload.errorCode ?? "UNKNOWN",
        error: payload.error ?? "No JSON error body",
      };
    }

    const best = payload.route?.best;
    const summary = summarizeBenchmarkResult(benchmark, {
      distanceKm: best?.distanceKm ?? 0,
      ascendM: best?.ascendM ?? 0,
      quality: best?.quality,
    });

    return {
      ...summary,
      status: response.status,
      durationMs,
      errorCode: null,
      error: null,
    };
  } catch (error) {
    return {
      id: benchmark.id,
      label: benchmark.label,
      passed: false,
      failures: ["network_error"],
      status: 0,
      durationMs: Date.now() - started,
      errorCode: "NETWORK_ERROR",
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

const results = [];
for (const benchmark of benchmarks) {
  const result = await runBenchmark(benchmark);
  results.push(result);
  const symbol = result.skipped ? "↷" : result.passed ? "✓" : "✗";
  const failureSuffix = result.failures.length ? ` — ${result.failures.join(", ")}` : "";
  console.log(`${symbol} ${result.id} (${result.durationMs}ms)${failureSuffix}`);
  if (!result.passed && result.error) {
    console.log(`  ${result.status} ${result.errorCode}: ${result.error}`);
  }
}

const failed = results.filter((result) => !result.passed);
const report = {
  endpoint,
  generatedAt: new Date().toISOString(),
  total: results.length,
  failed: failed.length,
  passed: results.length - failed.length,
  results,
};

console.log(JSON.stringify(report, null, 2));

if (shouldWriteOutput) {
  const absoluteOutputPath = resolve(repoRoot, outputPath);
  await mkdir(dirname(absoluteOutputPath), { recursive: true });
  await writeFile(absoluteOutputPath, `${JSON.stringify(report, null, 2)}\n`, "utf8");
  console.log(`Benchmark report written to ${outputPath}`);
}

if (failed.length > 0) process.exit(1);
