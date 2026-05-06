#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  benchmarkToRequestCore,
  summarizeBenchmarkResult,
} from "../lib/route-benchmarks-core.mjs";
import {
  routeToEdgeDiagnosticsArtifact,
  routeToEdgesGeoJson,
  routeToGeoJson,
} from "../lib/route-benchmark-artifacts.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const args = process.argv.slice(2);
const baseUrl = (process.env.ROUTE_BENCHMARK_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const outputPath = getArgValue("--output") ?? process.env.ROUTE_BENCHMARK_OUTPUT ?? "artifacts/route-benchmark-results/latest.json";
const artifactDir = getArgValue("--artifact-dir") ?? process.env.ROUTE_BENCHMARK_ARTIFACT_DIR ?? "artifacts/route-benchmark-results/routes";
const shouldWriteOutput = !args.includes("--no-output");
const shouldSaveArtifacts = args.includes("--save-artifacts");
const caseFilters = args.flatMap((arg, index) => arg === "--case" ? [args[index + 1]].filter(Boolean) : arg.startsWith("--case=") ? [arg.slice("--case=".length)] : []);
const hasExternalRoutingKey = Boolean(process.env.ORS_API_KEY || process.env.GRAPHHOPPER_API_KEY);
const benchmarkTimeoutMarginMs = Number(process.env.ROUTE_BENCHMARK_TIMEOUT_MARGIN_MS ?? 45_000);

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run benchmark:routes -- [options]

Runs TrailForge route benchmarks against /api/generate-route and fails on quality threshold regressions.

Environment:
  ROUTE_BENCHMARK_BASE_URL          Target app URL. Default: http://localhost:3000
  ROUTE_BENCHMARK_OUTPUT            JSON report path. Default: artifacts/route-benchmark-results/latest.json
  ROUTE_BENCHMARK_ARTIFACT_DIR      Per-route artifact directory. Default: artifacts/route-benchmark-results/routes
  ROUTE_BENCHMARK_TIMEOUT_MARGIN_MS Extra timeout budget above each case maxDurationMs. Default: 45000

Options:
  --case <id-or-prefix>        Run only matching benchmark id(s). Repeatable.
  --list                       Print benchmark ids and exit.
  --output <path>              Override JSON report path.
  --artifact-dir <path>        Override per-route artifact directory.
  --save-artifacts             Save route JSON, best-route GeoJSON, candidate edge-diagnostics JSON, and edge-level GeoJSON artifacts.
  --no-output                  Do not write the aggregate JSON report.
  --help                       Show this help.

Examples:
  npm run benchmark:routes -- --list
  npm run benchmark:routes -- --case tourville --save-artifacts
  ROUTE_BENCHMARK_BASE_URL=https://preview.vercel.app npm run benchmark:routes -- --case tourville-pommiers-trail-10k`);
  process.exit(0);
}

const endpoint = `${baseUrl}/api/generate-route`;
const benchmarkDataPath = resolve(repoRoot, "lib/route-benchmarks-data.json");
let benchmarks = JSON.parse(await readFile(benchmarkDataPath, "utf8"));

if (args.includes("--list")) {
  for (const benchmark of benchmarks) {
    const tier = benchmark.tier ?? "unclassified";
    const tags = (benchmark.tags ?? []).join(",");
    console.log(`${benchmark.id}\t${tier}\t${tags}\t${benchmark.label}`);
  }
  process.exit(0);
}

if (caseFilters.length > 0) {
  benchmarks = benchmarks.filter((benchmark) =>
    caseFilters.some((filter) => benchmark.id === filter || benchmark.id.startsWith(filter) || benchmark.id.includes(filter))
  );

  if (benchmarks.length === 0) {
    console.error(`No route benchmark matched: ${caseFilters.join(", ")}`);
    process.exit(2);
  }
}

function getArgValue(name) {
  const equalsArg = args.find((arg) => arg.startsWith(`${name}=`));
  if (equalsArg) return equalsArg.slice(name.length + 1);
  const index = args.indexOf(name);
  if (index >= 0) return args[index + 1];
  return undefined;
}

function requestFrom(benchmark) {
  return {
    ...benchmarkToRequestCore(benchmark),
    includeEdgeDiagnostics: true,
    includeGenerationDiagnostics: true,
  };
}

function requiresExternalRouting(benchmark) {
  return benchmark.profileId.startsWith("cycling_");
}

async function saveRouteArtifacts(benchmark, payload) {
  if (!shouldSaveArtifacts || payload?.route == null) return null;
  const absoluteArtifactDir = resolve(repoRoot, artifactDir);
  await mkdir(absoluteArtifactDir, { recursive: true });

  const routeArtifactPath = resolve(absoluteArtifactDir, `${benchmark.id}.json`);
  await writeFile(routeArtifactPath, `${JSON.stringify(payload.route, null, 2)}\n`, "utf8");

  const artifacts = {
    routeJson: routeArtifactPath.replace(`${repoRoot}/`, ""),
  };

  const geoJson = routeToGeoJson(benchmark, payload.route);
  if (geoJson) {
    const geoJsonArtifactPath = resolve(absoluteArtifactDir, `${benchmark.id}.geojson`);
    await writeFile(geoJsonArtifactPath, `${JSON.stringify(geoJson, null, 2)}\n`, "utf8");
    artifacts.geoJson = geoJsonArtifactPath.replace(`${repoRoot}/`, "");
  }

  const edgeDiagnostics = routeToEdgeDiagnosticsArtifact(benchmark, payload.route);
  if (edgeDiagnostics) {
    const edgeDiagnosticsArtifactPath = resolve(absoluteArtifactDir, `${benchmark.id}.edges.json`);
    await writeFile(edgeDiagnosticsArtifactPath, `${JSON.stringify(edgeDiagnostics, null, 2)}\n`, "utf8");
    artifacts.edgeDiagnosticsJson = edgeDiagnosticsArtifactPath.replace(`${repoRoot}/`, "");
  }

  const edgeGeoJson = routeToEdgesGeoJson(benchmark, payload.route);
  if (edgeGeoJson) {
    const edgeGeoJsonArtifactPath = resolve(absoluteArtifactDir, `${benchmark.id}.edges.geojson`);
    await writeFile(edgeGeoJsonArtifactPath, `${JSON.stringify(edgeGeoJson, null, 2)}\n`, "utf8");
    artifacts.edgeDiagnosticsGeoJson = edgeGeoJsonArtifactPath.replace(`${repoRoot}/`, "");
  }

  return artifacts;
}

async function saveRejectedCandidatesArtifacts(benchmark, payload) {
  if (!shouldSaveArtifacts || payload?.rejectedCandidatesDiagnostics == null) return null;
  const absoluteArtifactDir = resolve(repoRoot, artifactDir);
  await mkdir(absoluteArtifactDir, { recursive: true });

  const rejectedCandidatesArtifactPath = resolve(absoluteArtifactDir, `${benchmark.id}.rejected-candidates.json`);
  await writeFile(
    rejectedCandidatesArtifactPath,
    `${JSON.stringify(payload.rejectedCandidatesDiagnostics, null, 2)}\n`,
    "utf8"
  );

  return {
    rejectedCandidatesJson: rejectedCandidatesArtifactPath.replace(`${repoRoot}/`, ""),
  };
}

async function runBenchmark(benchmark) {
  if (requiresExternalRouting(benchmark) && !hasExternalRoutingKey) {
    return {
      id: benchmark.id,
      label: benchmark.label,
      tier: benchmark.tier,
      tags: benchmark.tags ?? [],
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
  const timeoutMs = Math.max(
    1_000,
    Number(benchmark.thresholds?.maxDurationMs ?? 90_000) + benchmarkTimeoutMarginMs
  );
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(requestFrom(benchmark)),
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => ({}));
    const durationMs = Date.now() - started;

    if (!response.ok || payload.success !== true) {
      const rejectedCandidateArtifacts = await saveRejectedCandidatesArtifacts(benchmark, payload);
      return {
        id: benchmark.id,
        label: benchmark.label,
        tier: benchmark.tier,
        tags: benchmark.tags ?? [],
        passed: false,
        failures: ["http_error"],
        status: response.status,
        durationMs,
        errorCode: payload.errorCode ?? "UNKNOWN",
        subCode: payload.subCode ?? null,
        error: payload.error ?? "No JSON error body",
        rejectedCandidatesDiagnostics: payload.rejectedCandidatesDiagnostics ?? null,
        routeArtifacts: rejectedCandidateArtifacts,
      };
    }

    const best = payload.route?.best;
    const summary = summarizeBenchmarkResult(benchmark, best ?? {}, durationMs);
    const routeArtifacts = await saveRouteArtifacts(benchmark, payload);

    return {
      ...summary,
      status: response.status,
      durationMs,
      routeArtifacts,
      routeArtifact: routeArtifacts?.routeJson,
      requestTimeoutMs: timeoutMs,
      stageTimings: payload.route?.stageTimings ?? null,
      diagnostics: payload.route?.diagnostics ?? null,
      errorCode: null,
      error: null,
    };
  } catch (error) {
    const aborted = error instanceof Error && error.name === "AbortError";
    return {
      id: benchmark.id,
      label: benchmark.label,
      tier: benchmark.tier,
      tags: benchmark.tags ?? [],
      passed: false,
      failures: [aborted ? "duration_timeout" : "network_error"],
      status: 0,
      durationMs: Date.now() - started,
      requestTimeoutMs: timeoutMs,
      errorCode: aborted ? "BENCHMARK_TIMEOUT" : "NETWORK_ERROR",
      error: aborted
        ? `Benchmark exceeded ${timeoutMs}ms fetch timeout for case ${benchmark.id}`
        : error instanceof Error ? error.message : String(error),
    };
  } finally {
    clearTimeout(timeout);
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
const skipped = results.filter((result) => result.skipped);
const report = {
  endpoint,
  generatedAt: new Date().toISOString(),
  total: results.length,
  failed: failed.length,
  skipped: skipped.length,
  passed: results.length - failed.length - skipped.length,
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
