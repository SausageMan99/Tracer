#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  benchmarkToRequestCore,
  summarizeBenchmarkFailure,
  summarizeBenchmarkResult,
} from "../lib/route-benchmarks-core.mjs";
import {
  routeToEdgeDiagnosticsArtifact,
  routeToEdgesGeoJson,
  routeToGeoJson,
  routeToOpportunityCaptureArtifact,
  routeToOpportunityCaptureMetrics,
  routeToTerrainOpportunityReport,
} from "../lib/route-benchmark-artifacts.mjs";
import {
  TERRAIN_AWARE_BENCHMARK_PANEL_IDS,
  TERRAIN_AWARE_BENCHMARK_PANELS,
  filterBenchmarksByPanel,
  resolveBenchmarkPanel,
  summarizeBenchmarkPanels,
} from "../lib/route-benchmark-panels.mjs";

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = resolve(__dirname, "..");
const args = process.argv.slice(2);
const baseUrl = (process.env.ROUTE_BENCHMARK_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");
const outputPath = getArgValue("--output") ?? process.env.ROUTE_BENCHMARK_OUTPUT ?? "artifacts/route-benchmark-results/latest.json";
const artifactDir = getArgValue("--artifact-dir") ?? process.env.ROUTE_BENCHMARK_ARTIFACT_DIR ?? "artifacts/route-benchmark-results/routes";
const shouldWriteOutput = !args.includes("--no-output");
const shouldSaveArtifacts = args.includes("--save-artifacts");
const betaSmokeExcludedReason = getArgValue("--beta-scope-report") ?? null;
const caseFilters = args.flatMap((arg, index) => arg === "--case" ? [args[index + 1]].filter(Boolean) : arg.startsWith("--case=") ? [arg.slice("--case=".length)] : []);
const panelFilters = args.flatMap((arg, index) => arg === "--panel" ? [args[index + 1]].filter(Boolean) : arg.startsWith("--panel=") ? [arg.slice("--panel=".length)] : []);
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
  --panel <panel-id>           Run only one terrain-aware panel. Repeatable. Known: ${TERRAIN_AWARE_BENCHMARK_PANEL_IDS.join(", ")}.
  --list                       Print benchmark ids and exit.
  --output <path>              Override JSON report path.
  --artifact-dir <path>        Override per-route artifact directory.
  --save-artifacts             Save route JSON, best-route GeoJSON, candidate edge-diagnostics JSON, edge-level GeoJSON, TerrainOpportunityReport, and opportunity-capture artifacts.
  --beta-scope-report <reason> Add beta-scope evidence fields when a case is intentionally excluded from the beta smoke.
  --no-output                  Do not write the aggregate JSON report.
  --help                       Show this help.

Examples:
  npm run benchmark:routes -- --list
  npm run benchmark:routes -- --panel transition_to_woods --save-artifacts
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
    const panel = resolveBenchmarkPanel(benchmark);
    console.log(`${benchmark.id}\t${tier}\t${panel?.id ?? "unpanelled"}\t${tags}\t${benchmark.label}`);
  }
  process.exit(0);
}

if (panelFilters.length > 0) {
  const unknownPanels = panelFilters.filter((panelId) => TERRAIN_AWARE_BENCHMARK_PANELS[panelId] == null);
  if (unknownPanels.length > 0) {
    console.error(`Unknown terrain-aware benchmark panel(s): ${unknownPanels.join(", ")}`);
    console.error(`Known panels: ${TERRAIN_AWARE_BENCHMARK_PANEL_IDS.join(", ")}`);
    process.exit(2);
  }

  const byId = new Map(benchmarks.map((benchmark) => [benchmark.id, benchmark]));
  benchmarks = panelFilters.flatMap((panelId) => filterBenchmarksByPanel(benchmarks, panelId));
  benchmarks = [...new Map(benchmarks.map((benchmark) => [benchmark.id, byId.get(benchmark.id) ?? benchmark])).values()];

  if (benchmarks.length === 0) {
    console.error(`No route benchmark matched panel(s): ${panelFilters.join(", ")}`);
    process.exit(2);
  }
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

  const terrainOpportunityReport = routeToTerrainOpportunityReport(benchmark, payload.route);
  if (terrainOpportunityReport) {
    const terrainOpportunityArtifactPath = resolve(absoluteArtifactDir, `${benchmark.id}.terrain-opportunity.json`);
    await writeFile(
      terrainOpportunityArtifactPath,
      `${JSON.stringify(terrainOpportunityReport, null, 2)}\n`,
      "utf8"
    );
    artifacts.terrainOpportunityReportJson = terrainOpportunityArtifactPath.replace(`${repoRoot}/`, "");
  }

  const opportunityCaptureArtifact = routeToOpportunityCaptureArtifact(benchmark, payload.route);
  if (opportunityCaptureArtifact) {
    const opportunityCaptureArtifactPath = resolve(absoluteArtifactDir, `${benchmark.id}.opportunity-capture.json`);
    await writeFile(
      opportunityCaptureArtifactPath,
      `${JSON.stringify(opportunityCaptureArtifact, null, 2)}\n`,
      "utf8"
    );
    artifacts.opportunityCaptureJson = opportunityCaptureArtifactPath.replace(`${repoRoot}/`, "");
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

async function saveGenerationDiagnosticsArtifacts(benchmark, payload) {
  if (!shouldSaveArtifacts || payload?.generationDiagnostics == null) return null;
  const absoluteArtifactDir = resolve(repoRoot, artifactDir);
  await mkdir(absoluteArtifactDir, { recursive: true });

  const generationDiagnosticsArtifactPath = resolve(absoluteArtifactDir, `${benchmark.id}.generation-diagnostics.json`);
  await writeFile(
    generationDiagnosticsArtifactPath,
    `${JSON.stringify(payload.generationDiagnostics, null, 2)}\n`,
    "utf8"
  );

  return {
    generationDiagnosticsJson: generationDiagnosticsArtifactPath.replace(`${repoRoot}/`, ""),
  };
}

async function runBenchmark(benchmark) {
  if (requiresExternalRouting(benchmark) && !hasExternalRoutingKey) {
    return {
      id: benchmark.id,
      label: benchmark.label,
      tier: benchmark.tier,
      panel: resolveBenchmarkPanel(benchmark),
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
      const generationDiagnosticsArtifacts = await saveGenerationDiagnosticsArtifacts(benchmark, payload);
      return {
        ...summarizeBenchmarkFailure(benchmark, {
          status: response.status,
          durationMs,
          errorCode: payload.errorCode ?? "UNKNOWN",
          subCode: payload.subCode ?? null,
          error: payload.error ?? "No JSON error body",
          rejectedCandidatesDiagnostics: payload.rejectedCandidatesDiagnostics ?? null,
          stageTimings: payload.stageTimings ?? null,
          generationDiagnostics: payload.generationDiagnostics ?? null,
          routeArtifacts: {
            ...(rejectedCandidateArtifacts ?? {}),
            ...(generationDiagnosticsArtifacts ?? {}),
          },
        }),
        panel: resolveBenchmarkPanel(benchmark),
      };
    }

    const best = payload.route?.best;
    const summary = summarizeBenchmarkResult(benchmark, payload.route ?? best ?? {}, durationMs);
    const opportunityCapture = routeToOpportunityCaptureMetrics(benchmark, payload.route ?? best ?? {});
    const routeArtifacts = await saveRouteArtifacts(benchmark, payload);

    return {
      ...summary,
      panel: resolveBenchmarkPanel(benchmark),
      metrics: {
        ...summary.metrics,
        ...(opportunityCapture == null ? {} : { opportunityCapture }),
      },
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
      panel: resolveBenchmarkPanel(benchmark),
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
  panelFilters,
  panelSummary: summarizeBenchmarkPanels(results),
  failed: failed.length,
  skipped: skipped.length,
  passed: results.length - failed.length - skipped.length,
  ...(betaSmokeExcludedReason == null ? {} : {
    beta_smoke_excluded_reason: betaSmokeExcludedReason,
    beta_smoke_excluded_cases: ["tourville-pommiers-trail-12k"],
    beta_smoke_rca_artifact: "artifacts/route-benchmark-results/night-cto-root-cause/tourville12-quality-pavement-nondeterminism.md",
    beta_scope_status: failed.length === 0 ? "BETA_SCOPE_CANDIDATE_LOCAL" : "BETA_SCOPE_BLOCKED",
    ga_status: "NO-GO_GA",
    readiness_blockers: ["tourville-pommiers-trail-12k"],
    thresholdsChanged: false,
    surfaceReclassification: false,
    typedRefusalMasked: false,
  }),
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
