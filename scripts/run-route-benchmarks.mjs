#!/usr/bin/env node

const baseUrl = (process.env.ROUTE_BENCHMARK_BASE_URL ?? "http://localhost:3000").replace(/\/$/, "");

if (process.argv.includes("--help") || process.argv.includes("-h")) {
  console.log(`Usage: ROUTE_BENCHMARK_BASE_URL=https://your-app.vercel.app npm run benchmark:routes

Runs TrailForge production smoke benchmarks against /api/generate-route.
Default base URL: http://localhost:3000`);
  process.exit(0);
}

const endpoint = `${baseUrl}/api/generate-route`;

const benchmarks = [
  ["lille-10k-citadel-loop", "Grand Place, Lille", "running_endurance", 10, 80, true],
  ["paris-19-canal-running", "Place de la Bataille de Stalingrad, Paris", "running_endurance", 10, 100, true],
  ["paris-centre-5k-safety", "Hôtel de Ville, Paris", "running_recuperation", 5, 20, true],
  ["dijon-hilly-running", "Place Darcy, Dijon", "running_endurance", 12, 250, true],
  ["nanterre-east-avoid-highways", "Nanterre Université", "running_endurance", 10, 80, true],
  ["rennes-saint-malo-road-bike", "Place Sainte-Anne, Rennes", "cycling_road_endurance", 70, 500, false],
  ["mtb-40k-oneway-safety", "Forêt de Meudon, Chaville", "cycling_mtb_endurance", 40, 800, true],
];

function requestFrom(tuple) {
  const [id, address, profileId, targetDistanceKm, targetElevationM, scenicMode] = tuple;
  return { id, address, profileId, targetDistanceKm, targetElevationM, scenicMode };
}

async function runBenchmark(tuple) {
  const { id, ...body } = requestFrom(tuple);
  const started = Date.now();

  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });
    const payload = await response.json().catch(() => ({}));
    const durationMs = Date.now() - started;

    if (!response.ok || payload.success !== true) {
      return {
        id,
        passed: false,
        status: response.status,
        durationMs,
        errorCode: payload.errorCode ?? "UNKNOWN",
        error: payload.error ?? "No JSON error body",
      };
    }

    const best = payload.route?.best;
    return {
      id,
      passed: true,
      status: response.status,
      durationMs,
      distanceKm: best?.distanceKm,
      ascendM: best?.ascendM,
      productionScore: best?.quality?.productionScore,
      warnings: best?.quality?.warnings ?? [],
    };
  } catch (error) {
    return {
      id,
      passed: false,
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
  const symbol = result.passed ? "✓" : "✗";
  console.log(`${symbol} ${result.id} (${result.durationMs}ms)`);
  if (!result.passed) {
    console.log(`  ${result.status} ${result.errorCode}: ${result.error}`);
  }
}

const failed = results.filter((result) => !result.passed);
console.log(JSON.stringify({ endpoint, total: results.length, failed: failed.length, results }, null, 2));

if (failed.length > 0) process.exit(1);
