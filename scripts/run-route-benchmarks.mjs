#!/usr/bin/env node
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

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

if (args.includes("--help") || args.includes("-h")) {
  console.log(`Usage: npm run benchmark:routes -- [options]

Runs TrailForge route benchmarks against /api/generate-route and fails on quality threshold regressions.

Environment:
  ROUTE_BENCHMARK_BASE_URL     Target app URL. Default: http://localhost:3000
  ROUTE_BENCHMARK_OUTPUT       JSON report path. Default: artifacts/route-benchmark-results/latest.json
  ROUTE_BENCHMARK_ARTIFACT_DIR Per-route artifact directory. Default: artifacts/route-benchmark-results/routes

Options:
  --case <id-or-prefix>        Run only matching benchmark id(s). Repeatable.
  --list                       Print benchmark ids and exit.
  --output <path>              Override JSON report path.
  --artifact-dir <path>        Override per-route artifact directory.
  --save-artifacts             Save route JSON, best-route GeoJSON, and candidate edge-diagnostics JSON artifacts.
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
    console.log(`${benchmark.id}\t${benchmark.label}`);
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

function compareOrderedLevel(actual, minimum) {
  const rank = { unknown: -1, low: 0, medium: 1, high: 2 };
  return rank[actual ?? "unknown"] - rank[minimum];
}

function warningToFailure(warning) {
  if (warning === "ONEWAY_VIOLATION") return "oneway_violation";
  if (warning === "U_TURN_DETECTED") return "u_turn_detected";
  if (warning === "TOO_MUCH_BACKTRACKING") return "backtracking_detected";
  return `blocking_warning:${warning}`;
}

function summarizeBenchmarkResult(benchmark, route, durationMs) {
  const quality = route.quality ?? {};
  const distanceKm = route.distanceKm ?? 0;
  const ascendM = route.ascendM ?? 0;
  const distanceErrorRatio = Math.abs(distanceKm - benchmark.targetDistanceKm) / benchmark.targetDistanceKm;
  const elevationErrorM = Math.abs(ascendM - benchmark.targetElevationM);
  const productionScore = quality.productionScore ?? 0;
  const loopClosureKm = quality.loopGapKm ?? quality.loopClosureKm ?? Number.POSITIVE_INFINITY;
  const busyRoadRatio = quality.busyRoadRatio ?? 1;
  const naturalWayRatio = quality.trailRatio ?? quality.naturalWayRatio ?? 0;
  const pavedRatio = quality.pavedRatio ?? 0;
  const trailBeautyScore = quality.trailBeautyScore ?? 0;
  const longestTrailSegmentKm = quality.longestTrailSegmentKm ?? 0;
  const naturalCorridorRatio = quality.naturalCorridorRatio ?? 0;
  const repeatEdgeRatio = quality.repeatEdgeRatio ?? 0;
  const uTurnRatio = quality.uTurnRatio ?? 0;
  const terrainDataConfidence = quality.terrainDataConfidence ?? "unknown";
  const trailPotential = quality.trailPotential ?? "unknown";
  const warnings = quality.warnings ?? [];
  const failures = [];

  if (distanceErrorRatio > benchmark.thresholds.distanceToleranceRatio) failures.push("distance_tolerance");
  if (elevationErrorM > benchmark.thresholds.elevationToleranceM) failures.push("elevation_tolerance");
  if (productionScore < benchmark.thresholds.minProductionScore) failures.push("production_score");
  if (loopClosureKm > benchmark.thresholds.maxLoopClosureKm) failures.push("loop_closure");
  if (busyRoadRatio > benchmark.thresholds.maxBusyRoadRatio) failures.push("busy_road_ratio");
  if (benchmark.thresholds.minNaturalWayRatio !== undefined && naturalWayRatio < benchmark.thresholds.minNaturalWayRatio) failures.push("natural_way_ratio");
  if (benchmark.thresholds.maxPavedRatio !== undefined && pavedRatio > benchmark.thresholds.maxPavedRatio) failures.push("paved_ratio");
  if (benchmark.thresholds.minTrailBeautyScore !== undefined && trailBeautyScore < benchmark.thresholds.minTrailBeautyScore) failures.push("trail_beauty_score");
  if (benchmark.thresholds.minLongestTrailSegmentKm !== undefined && longestTrailSegmentKm < benchmark.thresholds.minLongestTrailSegmentKm) failures.push("longest_trail_segment");
  if (benchmark.thresholds.minNaturalCorridorRatio !== undefined && naturalCorridorRatio < benchmark.thresholds.minNaturalCorridorRatio) failures.push("natural_corridor_ratio");
  if (benchmark.thresholds.maxRepeatEdgeRatio !== undefined && repeatEdgeRatio > benchmark.thresholds.maxRepeatEdgeRatio) failures.push("repeat_edge_ratio");
  if (benchmark.thresholds.maxUTurnRatio !== undefined && uTurnRatio > benchmark.thresholds.maxUTurnRatio) failures.push("u_turn_ratio");
  if (benchmark.thresholds.minTerrainDataConfidence !== undefined && compareOrderedLevel(terrainDataConfidence, benchmark.thresholds.minTerrainDataConfidence) < 0) failures.push("terrain_data_confidence");
  if (benchmark.thresholds.minTrailPotential !== undefined && compareOrderedLevel(trailPotential, benchmark.thresholds.minTrailPotential) < 0) failures.push("trail_potential");
  if (benchmark.thresholds.maxDurationMs !== undefined && durationMs > benchmark.thresholds.maxDurationMs) failures.push("duration_ms");

  for (const warning of benchmark.blockingWarnings ?? ["ONEWAY_VIOLATION"]) {
    if (warnings.includes(warning)) failures.push(warningToFailure(warning));
  }

  return {
    id: benchmark.id,
    label: benchmark.label,
    passed: failures.length === 0,
    failures,
    metrics: {
      distanceKm,
      ascendM,
      distanceErrorRatio,
      elevationErrorM,
      productionScore,
      loopClosureKm,
      busyRoadRatio,
      naturalWayRatio,
      pavedRatio,
      trailBeautyScore,
      longestTrailSegmentKm,
      naturalCorridorRatio,
      repeatEdgeRatio,
      uTurnRatio,
      terrainDataConfidence,
      trailPotential,
      durationMs,
      warnings,
    },
    thresholds: benchmark.thresholds,
    blockingWarnings: benchmark.blockingWarnings ?? ["ONEWAY_VIOLATION"],
  };
}

function routeToGeoJson(benchmark, route) {
  const best = route?.best;
  const coordinates = best?.geometry?.coordinates;
  if (!Array.isArray(coordinates) || coordinates.length === 0) return null;

  return {
    type: "FeatureCollection",
    features: [
      {
        type: "Feature",
        properties: {
          benchmarkId: benchmark.id,
          label: benchmark.label,
          targetDistanceKm: benchmark.targetDistanceKm,
          targetElevationM: benchmark.targetElevationM,
          profileId: benchmark.profileId,
          distanceKm: best.distanceKm ?? null,
          ascendM: best.ascendM ?? null,
          productionScore: best.quality?.productionScore ?? null,
          repeatEdgeRatio: best.quality?.repeatEdgeRatio ?? null,
          uTurnRatio: best.quality?.uTurnRatio ?? null,
          busyRoadRatio: best.quality?.busyRoadRatio ?? null,
          naturalWayRatio: best.quality?.trailRatio ?? best.quality?.naturalWayRatio ?? null,
        },
        geometry: {
          type: "LineString",
          coordinates,
        },
      },
    ],
  };
}

function summarizeEdgeDiagnostics(candidate) {
  const edges = Array.isArray(candidate?.edgeDiagnostics) ? candidate.edgeDiagnostics : [];
  const totalKm = edges.reduce((sum, edge) => sum + (edge.lengthKm ?? 0), 0);
  const sumFlag = (flag) => edges
    .filter((edge) => edge.flags?.[flag] === true)
    .reduce((sum, edge) => sum + (edge.lengthKm ?? 0), 0);
  const seenEdgeKeys = new Set();
  const repeatedExtraKm = edges.reduce((sum, edge) => {
    if (seenEdgeKeys.has(edge.edgeKey)) return sum + (edge.lengthKm ?? 0);
    seenEdgeKeys.add(edge.edgeKey);
    return sum;
  }, 0);
  return {
    edgeCount: edges.length,
    totalKm: Number(totalKm.toFixed(5)),
    trailKm: Number(sumFlag("trail").toFixed(5)),
    pavedKm: Number(sumFlag("paved").toFixed(5)),
    naturalKm: Number(sumFlag("natural").toFixed(5)),
    scenicKm: Number(sumFlag("scenic").toFixed(5)),
    busyKm: Number(sumFlag("busy").toFixed(5)),
    repeatedTraversalKm: Number(edges
      .filter((edge) => edge.repeated === true)
      .reduce((sum, edge) => sum + (edge.lengthKm ?? 0), 0)
      .toFixed(5)),
    repeatedExtraKm: Number(repeatedExtraKm.toFixed(5)),
    availableFields: [
      "index",
      "edgeId",
      "edgeKey",
      "osmWayId",
      "fromNodeId",
      "toNodeId",
      "from",
      "to",
      "highway",
      "surface",
      "access",
      "foot",
      "bicycle",
      "oneway",
      "lengthKm",
      "score",
      "scoreReason",
      "name",
      "ref",
      "componentId",
      "flags.trail",
      "flags.paved",
      "flags.natural",
      "flags.scenic",
      "flags.busy",
      "flags.restricted",
      "flags.onewayViolation",
      "repeatCount",
      "repeated",
    ],
    missingFields: [],
  };
}

function summarizeRouteIntent(routeIntent) {
  if (routeIntent == null) return null;
  return {
    type: routeIntent.type ?? null,
    strategy: routeIntent.strategy ?? null,
    targetComponents: routeIntent.targetComponents ?? [],
    minNaturalZoneDwellKm: routeIntent.minNaturalZoneDwellKm ?? null,
    minNonPavedTrailStreakKm: routeIntent.minNonPavedTrailStreakKm ?? null,
    maxPavedRatio: routeIntent.maxPavedRatio ?? null,
    maxBusyRoadRatio: routeIntent.maxBusyRoadRatio ?? null,
    maxRepeatEdgeRatio: routeIntent.maxRepeatEdgeRatio ?? null,
    cleanReturnMode: routeIntent.cleanReturnMode ?? null,
    timeBudgetMs: routeIntent.timeBudgetMs ?? null,
    beamBudget: routeIntent.beamBudget ?? null,
    terrainComponents: Array.isArray(routeIntent.terrainComponents)
      ? routeIntent.terrainComponents.slice(0, 8).map((component) => ({
          id: component.id,
          kind: component.kind,
          center: component.center,
          totalKm: component.totalKm,
          nonPavedKm: component.nonPavedKm,
          pavedKm: component.pavedKm,
          unknownSurfaceKm: component.unknownSurfaceKm,
          distanceFromStartKm: component.distanceFromStartKm,
          entryNodeCount: Array.isArray(component.entryNodeIds) ? component.entryNodeIds.length : 0,
        }))
      : [],
  };
}

function routeToEdgeDiagnosticsArtifact(benchmark, route) {
  const candidates = Array.isArray(route?.candidates) ? route.candidates : [];
  if (candidates.length === 0) return null;

  return {
    benchmark: {
      id: benchmark.id,
      label: benchmark.label,
      address: benchmark.address,
      profileId: benchmark.profileId,
      targetDistanceKm: benchmark.targetDistanceKm,
      targetElevationM: benchmark.targetElevationM,
      scenicMode: benchmark.scenicMode === true,
    },
    routeIntent: summarizeRouteIntent(route.routeIntent),
    candidates: candidates.map((candidate, candidateIndex) => ({
      candidateIndex,
      isBest: candidateIndex === 0,
      distanceKm: candidate.distanceKm ?? null,
      ascendM: candidate.ascendM ?? null,
      totalScore: candidate.totalScore ?? null,
      quality: candidate.quality ?? null,
      edgeSummary: summarizeEdgeDiagnostics(candidate),
      edges: Array.isArray(candidate.edgeDiagnostics) ? candidate.edgeDiagnostics : [],
    })),
  };
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

  return artifacts;
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
    const summary = summarizeBenchmarkResult(benchmark, best ?? {}, durationMs);
    const routeArtifacts = await saveRouteArtifacts(benchmark, payload);

    return {
      ...summary,
      status: response.status,
      durationMs,
      routeArtifacts,
      routeArtifact: routeArtifacts?.routeJson,
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
