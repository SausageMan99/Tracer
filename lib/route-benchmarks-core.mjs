const TINY_PARK_COMPACTNESS_SEVERITY_LIMIT = 0.003;
const TINY_PARK_COMPACTNESS_WEIGHT = 0.05;

const GENERALIZED_SHAPE_THRESHOLDS = {
  maxGeometryOverlapRatio: 0.18,
  maxSelfIntersectionCount: 2,
  maxSharpTurnDensityPerKm: 4.5,
  maxHeadingReversalRatio: 0.16,
  maxOutAndBackSimilarityRatio: 0.32,
  minLoopCompactness: 0.035,
  maxStartEndStemKm: 0.45,
  minMaxDistanceFromStartRatio: 0.09,
};

const STRICT_SHAPE_THRESHOLDS = {
  maxGeometryOverlapRatio: 0.12,
  maxSelfIntersectionCount: 0,
  maxSharpTurnDensityPerKm: 3.5,
  maxHeadingReversalRatio: 0.12,
  maxOutAndBackSimilarityRatio: 0.24,
  minLoopCompactness: 0.05,
  maxStartEndStemKm: 0.3,
  minMaxDistanceFromStartRatio: 0.11,
};

export function benchmarkToRequestCore(benchmark) {
  return {
    address: benchmark.address,
    profileId: benchmark.profileId,
    targetDistanceKm: benchmark.targetDistanceKm,
    targetElevationM: benchmark.targetElevationM,
    routeGateElevationToleranceM: benchmark.thresholds?.elevationToleranceM,
    scenicMode: benchmark.scenicMode,
  };
}

function usesStrictShapeGates(benchmark) {
  const tags = new Set(benchmark.tags ?? []);
  return benchmark.profileId === "running_trail" || tags.has("park") || tags.has("forest") || tags.has("field-feedback");
}

function usesBlockingShapeGates(benchmark) {
  const tags = new Set(benchmark.tags ?? []);
  return benchmark.profileId === "running_trail" || tags.has("forest") || tags.has("field-feedback");
}

function shapeThresholdsForBenchmark(benchmark) {
  const strict = usesStrictShapeGates(benchmark);
  const defaults = strict ? STRICT_SHAPE_THRESHOLDS : GENERALIZED_SHAPE_THRESHOLDS;
  const thresholds = benchmark.thresholds ?? {};
  const minSpread = thresholds.minMaxDistanceFromStartKm ?? Number((benchmark.targetDistanceKm * defaults.minMaxDistanceFromStartRatio).toFixed(3));
  return {
    source: "generalized_shape_defaults",
    maxGeometryOverlapRatio: thresholds.maxGeometryOverlapRatio ?? defaults.maxGeometryOverlapRatio,
    maxSelfIntersectionCount: thresholds.maxSelfIntersectionCount ?? defaults.maxSelfIntersectionCount,
    maxSharpTurnDensityPerKm: thresholds.maxSharpTurnDensityPerKm ?? defaults.maxSharpTurnDensityPerKm,
    maxHeadingReversalRatio: thresholds.maxHeadingReversalRatio ?? defaults.maxHeadingReversalRatio,
    maxOutAndBackSimilarityRatio: thresholds.maxOutAndBackSimilarityRatio ?? defaults.maxOutAndBackSimilarityRatio,
    minLoopCompactness: thresholds.minLoopCompactness ?? defaults.minLoopCompactness,
    maxStartEndStemKm: thresholds.maxStartEndStemKm ?? defaults.maxStartEndStemKm,
    minMaxDistanceFromStartKm: minSpread,
  };
}

function addShapeIssue(issues, key, actual, limit, direction, weight = 1) {
  if (!Number.isFinite(actual) || !Number.isFinite(limit)) return;
  const failed = direction === "max" ? actual > limit : actual < limit;
  if (!failed) return;
  const severity = direction === "max"
    ? (actual - limit) / Math.max(Math.abs(limit), 0.001)
    : (limit - actual) / Math.max(Math.abs(limit), 0.001);
  issues.push({ key, actual, limit, direction, severity: Number(Math.max(0, severity).toFixed(5)), weight });
}

function shapeIssueFailureKey(issueKey) {
  const failureKeys = {
    geometry_overlap: "geometry_overlap",
    self_intersection: "geometry_self_intersection",
    sharp_turn_density: "geometry_sharp_turn_density",
    heading_reversal: "geometry_heading_reversal",
    out_and_back_similarity: "geometry_out_and_back_similarity",
    loop_compactness: "geometry_loop_compactness",
    start_end_stem: "geometry_start_end_stem",
    spatial_spread: "geometry_spatial_spread",
  };
  return failureKeys[issueKey] ?? null;
}

function addFailureOnce(failures, key) {
  if (key != null && !failures.includes(key)) failures.push(key);
}

function summarizeShapeQuality(benchmark, geometry, hasGeometry) {
  const thresholds = shapeThresholdsForBenchmark(benchmark);
  if (!hasGeometry) {
    return {
      available: false,
      score: 0,
      thresholds,
      issues: [{ key: "shape_metrics_missing", actual: null, limit: null, direction: "present", severity: 1, weight: 1 }],
    };
  }
  const issues = [];
  addShapeIssue(issues, "geometry_overlap", geometry.geometryOverlapRatio, thresholds.maxGeometryOverlapRatio, "max", 1.4);
  addShapeIssue(issues, "self_intersection", geometry.selfIntersectionCount, thresholds.maxSelfIntersectionCount, "max", 1.2);
  addShapeIssue(issues, "sharp_turn_density", geometry.sharpTurnDensityPerKm, thresholds.maxSharpTurnDensityPerKm, "max", 0.75);
  addShapeIssue(issues, "heading_reversal", geometry.headingReversalRatio, thresholds.maxHeadingReversalRatio, "max", 0.8);
  addShapeIssue(issues, "out_and_back_similarity", geometry.outAndBackSimilarityRatio, thresholds.maxOutAndBackSimilarityRatio, "max", 1.2);
  addShapeIssue(issues, "loop_compactness", geometry.loopCompactness, thresholds.minLoopCompactness, "min", 0.8);
  addShapeIssue(issues, "start_end_stem", Math.max(geometry.startStemKm, geometry.endStemKm), thresholds.maxStartEndStemKm, "max", 1);
  addShapeIssue(issues, "spatial_spread", geometry.maxDistanceFromStartKm, thresholds.minMaxDistanceFromStartKm, "min", 0.9);
  const weightedSeverity = issues.reduce((sum, issue) => sum + issue.severity * issue.weight, 0);
  return {
    available: true,
    score: Number(Math.max(0, Math.min(1, 1 - weightedSeverity / 8)).toFixed(5)),
    thresholds,
    issues,
  };
}

export function summarizeBenchmarkFailure(benchmark, payload) {
  const failures = [];
  const expectsTypedRefusal = ["typed_refusal", "park_recovery", "route_or_typed_refusal"].includes(benchmark.expectedOutcome);
  const actualOutcome = payload.status === 422 && payload.errorCode === "ROUTE_CANDIDATES_REJECTED"
    ? "typed_refusal"
    : "http_error";

  if (expectsTypedRefusal) {
    if (actualOutcome !== "typed_refusal") {
      failures.push("expected_typed_refusal");
    }
    if (benchmark.expectedRefusalSubCode != null && payload.subCode !== benchmark.expectedRefusalSubCode) {
      failures.push("typed_refusal_sub_code_mismatch");
    }
  } else {
    failures.push("http_error");
  }

  return {
    id: benchmark.id,
    label: benchmark.label,
    tier: benchmark.tier,
    tags: benchmark.tags ?? [],
    passed: failures.length === 0,
    failures,
    status: payload.status,
    durationMs: payload.durationMs,
    errorCode: payload.errorCode ?? "UNKNOWN",
    subCode: payload.subCode ?? null,
    error: payload.error ?? null,
    metrics: {
      expectedOutcome: benchmark.expectedOutcome ?? "exact_distance",
      actualOutcome,
      expectedRefusalSubCode: benchmark.expectedRefusalSubCode ?? null,
      refusalSubCode: payload.subCode ?? null,
    },
    rejectedCandidatesDiagnostics: payload.rejectedCandidatesDiagnostics ?? null,
    stageTimings: payload.stageTimings ?? null,
    generationDiagnostics: payload.generationDiagnostics ?? null,
    routeArtifacts: payload.routeArtifacts,
  };
}

export function summarizeBenchmarkResult(benchmark, route, durationMsOverride) {
  const candidate = route?.best ?? route;
  const quality = candidate?.quality ?? {};
  const distanceKm = candidate?.distanceKm ?? 0;
  const ascendM = candidate?.ascendM ?? 0;
  const distanceErrorRatio = Math.abs(distanceKm - benchmark.targetDistanceKm) / benchmark.targetDistanceKm;
  const distanceAdjustment = route?.distanceAdjustment ?? candidate?.distanceAdjustment ?? null;
  const hasAdjustedDistance = distanceAdjustment?.policy === "adjusted_distance";
  const terrainFallback = route?.terrainFallback ?? candidate?.terrainFallback ?? null;
  const hasBestEffortTerrainFallback = terrainFallback?.policy === "best_effort_terrain";
  const expectsAdjustedDistance = benchmark.expectedOutcome === "adjusted_distance" || (benchmark.expectedOutcome === "park_recovery" && hasAdjustedDistance);
  const expectsBestEffortTerrain = benchmark.expectedOutcome === "best_effort_route";
  const actualOutcome = hasBestEffortTerrainFallback ? "best_effort_route" : hasAdjustedDistance ? "adjusted_distance" : "route_success";
  const elevationErrorM = Math.abs(ascendM - benchmark.targetElevationM);
  const productionScore = quality.productionScore ?? 0;
  const loopClosureKm = quality.loopGapKm ?? quality.loopClosureKm ?? Number.POSITIVE_INFINITY;
  const busyRoadRatio = quality.busyRoadRatio ?? 1;
  const trailRatio = quality.trailRatio ?? 0;
  const naturalWayRatio = quality.naturalWayRatio ?? 0;
  const pavedRatio = quality.pavedRatio ?? 0;
  const scenicPavedRatio = quality.scenicPavedRatio ?? 0;
  const trailBeautyScore = quality.trailBeautyScore ?? 0;
  const longestTrailSegmentKm = quality.longestTrailSegmentKm ?? 0;
  const naturalCorridorRatio = quality.naturalCorridorRatio ?? 0;
  const repeatEdgeRatio = quality.repeatEdgeRatio ?? 0;
  const uTurnRatio = quality.uTurnRatio ?? 0;
  const terrainDataConfidence = quality.terrainDataConfidence ?? "unknown";
  const trailPotential = quality.trailPotential ?? "unknown";
  const routeTrailQuality = quality.routeTrailQuality ?? "unknown";
  const durationMs = durationMsOverride ?? route?.durationMs ?? null;
  const warnings = quality.warnings ?? [];
  const elevationErrorPct = benchmark.targetElevationM > 0 ? elevationErrorM / Math.max(benchmark.targetElevationM, 1) : 0;
  const elevationWithinTolerance = quality.elevationDiagnostics?.withinAbsoluteTolerance ?? null;
  const elevationDiagnosticCode = quality.elevationDiagnostics?.messageCode ?? null;
  const hasGeometryMetrics = quality.geometry != null;
  const geometry = {
    loopCompactness: quality.geometry?.loopCompactness ?? 0,
    geometryOverlapRatio: quality.geometry?.geometryOverlapRatio ?? 0,
    selfIntersectionCount: quality.geometry?.selfIntersectionCount ?? 0,
    sharpTurnDensityPerKm: quality.geometry?.sharpTurnDensityPerKm ?? 0,
    headingReversalRatio: quality.geometry?.headingReversalRatio ?? 0,
    outAndBackSimilarityRatio: quality.geometry?.outAndBackSimilarityRatio ?? 0,
    startStemKm: quality.geometry?.startStemKm ?? 0,
    endStemKm: quality.geometry?.endStemKm ?? 0,
    maxDistanceFromStartKm: quality.geometry?.maxDistanceFromStartKm ?? 0,
  };
  const shapeQuality = summarizeShapeQuality(benchmark, geometry, hasGeometryMetrics);

  const failures = [];

  if (benchmark.expectedOutcome === "typed_refusal") {
    failures.push("expected_typed_refusal");
  }
  if (expectsBestEffortTerrain && !hasBestEffortTerrainFallback) {
    failures.push("missing_best_effort_terrain_fallback");
  }

  if (expectsAdjustedDistance) {
    if (!hasAdjustedDistance) {
      failures.push("missing_distance_adjustment");
    } else {
      const range = benchmark.adjustedDistanceKm;
      if (range != null && (distanceAdjustment.adjustedDistanceKm < range.min || distanceAdjustment.adjustedDistanceKm > range.max)) {
        failures.push("adjusted_distance_out_of_range");
      }
      if (distanceAdjustment.requestedDistanceKm !== benchmark.targetDistanceKm) {
        failures.push("adjusted_distance_requested_mismatch");
      }
    }
  } else if (distanceErrorRatio > benchmark.thresholds.distanceToleranceRatio) {
    failures.push("distance_tolerance");
  }
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
  if (benchmark.thresholds.minRouteTrailQuality !== undefined && compareOrderedLevel(routeTrailQuality, benchmark.thresholds.minRouteTrailQuality) < 0) failures.push("route_trail_quality");
  if (benchmark.thresholds.maxDurationMs !== undefined && durationMs !== null && durationMs > benchmark.thresholds.maxDurationMs) failures.push("duration_ms");
  if (benchmark.thresholds.maxGeometryOverlapRatio !== undefined && geometry.geometryOverlapRatio > benchmark.thresholds.maxGeometryOverlapRatio) failures.push("geometry_overlap");
  if (benchmark.thresholds.maxSelfIntersectionCount !== undefined && geometry.selfIntersectionCount > benchmark.thresholds.maxSelfIntersectionCount) failures.push("geometry_self_intersection");
  if (benchmark.thresholds.maxSharpTurnDensityPerKm !== undefined && geometry.sharpTurnDensityPerKm > benchmark.thresholds.maxSharpTurnDensityPerKm) failures.push("geometry_sharp_turn_density");
  if (benchmark.thresholds.maxHeadingReversalRatio !== undefined && geometry.headingReversalRatio > benchmark.thresholds.maxHeadingReversalRatio) failures.push("geometry_heading_reversal");
  if (benchmark.thresholds.maxOutAndBackSimilarityRatio !== undefined && geometry.outAndBackSimilarityRatio > benchmark.thresholds.maxOutAndBackSimilarityRatio) failures.push("geometry_out_and_back_similarity");
  if (benchmark.thresholds.minLoopCompactness !== undefined && geometry.loopCompactness < benchmark.thresholds.minLoopCompactness) failures.push("geometry_loop_compactness");
  if (benchmark.thresholds.maxStartEndStemKm !== undefined && Math.max(geometry.startStemKm, geometry.endStemKm) > benchmark.thresholds.maxStartEndStemKm) failures.push("geometry_start_end_stem");
  if (benchmark.thresholds.minMaxDistanceFromStartKm !== undefined && geometry.maxDistanceFromStartKm < benchmark.thresholds.minMaxDistanceFromStartKm) failures.push("geometry_spatial_spread");
  if (usesBlockingShapeGates(benchmark)) {
    for (const issue of shapeQuality.issues) {
      addFailureOnce(failures, shapeIssueFailureKey(issue.key));
    }
  }
  if (allowsTinyAdjustedParkCompactnessMiss(benchmark, geometry, distanceAdjustment)) {
    const index = failures.indexOf("geometry_loop_compactness");
    if (index >= 0) failures.splice(index, 1);
  }
  if (benchmark.requireHonestWarnings === true) {
    for (const expectedWarning of benchmark.expectedWarnings ?? []) {
      if (!warnings.includes(expectedWarning)) failures.push("missing_honest_warning");
    }
  }

  for (const warning of benchmark.blockingWarnings ?? ["ONEWAY_VIOLATION"]) {
    if (warnings.includes(warning)) failures.push(warningToFailure(warning));
  }

  if (expectsBestEffortTerrain && hasBestEffortTerrainFallback) {
    removeAllowedBestEffortTerrainFailures(failures);
  }

  return {
    id: benchmark.id,
    label: benchmark.label,
    tier: benchmark.tier,
    tags: benchmark.tags ?? [],
    passed: failures.length === 0,
    failures,
    metrics: {
      expectedOutcome: benchmark.expectedOutcome ?? "exact_distance",
      actualOutcome,
      distanceKm,
      ascendM,
      distanceErrorRatio,
      requestedDistanceKm: distanceAdjustment?.requestedDistanceKm ?? null,
      adjustedDistanceKm: distanceAdjustment?.adjustedDistanceKm ?? null,
      distanceAdjustmentReason: distanceAdjustment?.reason ?? null,
      terrainFallbackReason: terrainFallback?.reason ?? null,
      terrainFallbackMessageCode: terrainFallback?.messageCode ?? null,
      elevationErrorM,
      productionScore,
      loopClosureKm,
      busyRoadRatio,
      trailRatio,
      naturalWayRatio,
      pavedRatio,
      scenicPavedRatio,
      trailBeautyScore,
      longestTrailSegmentKm,
      naturalCorridorRatio,
      repeatEdgeRatio,
      uTurnRatio,
      terrainDataConfidence,
      trailPotential,
      routeTrailQuality,
      durationMs,
      warnings,
      elevationErrorPct,
      elevationWithinTolerance,
      elevationDiagnosticCode,
      geometry,
      shapeQualityScore: shapeQuality.score,
      shapeQuality,
    },
    thresholds: benchmark.thresholds,
    blockingWarnings: benchmark.blockingWarnings ?? ["ONEWAY_VIOLATION"],
  };
}

function removeAllowedBestEffortTerrainFailures(failures) {
  const allowed = new Set([
    "elevation_tolerance",
    "paved_ratio",
    "trail_beauty_score",
    "longest_trail_segment",
    "natural_corridor_ratio",
    "trail_potential",
    "route_trail_quality",
  ]);
  for (let index = failures.length - 1; index >= 0; index -= 1) {
    if (allowed.has(failures[index])) failures.splice(index, 1);
  }
}

function allowsTinyAdjustedParkCompactnessMiss(benchmark, geometry, distanceAdjustment) {
  const minLoopCompactness = benchmark.thresholds.minLoopCompactness;
  if (benchmark.expectedOutcome !== "adjusted_distance" && benchmark.expectedOutcome !== "park_recovery") return false;
  if (distanceAdjustment?.policy !== "adjusted_distance") return false;
  if (!Array.isArray(benchmark.tags) || !benchmark.tags.includes("park")) return false;
  if (minLoopCompactness == null || geometry.loopCompactness >= minLoopCompactness) return false;
  const severity = ((minLoopCompactness - geometry.loopCompactness) / Math.max(Math.abs(minLoopCompactness), 0.001)) * TINY_PARK_COMPACTNESS_WEIGHT;
  return severity <= TINY_PARK_COMPACTNESS_SEVERITY_LIMIT;
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
