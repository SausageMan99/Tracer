import type { BenchmarkFailureSample, BenchmarkRouteSample, BenchmarkSummary, RouteBenchmarkCase } from "./route-benchmarks";
import type { GenerateRouteRequest } from "./types";

export function benchmarkToRequestCore(benchmark: RouteBenchmarkCase): GenerateRouteRequest;
export function summarizeBenchmarkFailure(
  benchmark: RouteBenchmarkCase,
  payload: BenchmarkFailureSample
): BenchmarkSummary;
export function summarizeBenchmarkResult(
  benchmark: RouteBenchmarkCase,
  route: BenchmarkRouteSample,
  durationMsOverride?: number
): BenchmarkSummary;
