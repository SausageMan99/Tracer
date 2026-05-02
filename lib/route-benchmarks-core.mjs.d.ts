import type { BenchmarkRouteSample, BenchmarkSummary, RouteBenchmarkCase } from "./route-benchmarks";
import type { GenerateRouteRequest } from "./types";

export function benchmarkToRequestCore(benchmark: RouteBenchmarkCase): GenerateRouteRequest;
export function summarizeBenchmarkResult(
  benchmark: RouteBenchmarkCase,
  route: BenchmarkRouteSample,
  durationMsOverride?: number
): BenchmarkSummary;
