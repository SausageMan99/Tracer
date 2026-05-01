const EDGE_DIAGNOSTIC_FIELDS = [
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
];

function readPath(value, path) {
  return path.split(".").reduce((current, key) => current?.[key], value);
}

function missingRequiredFields(edges) {
  if (!Array.isArray(edges)) return ["edgeDiagnostics"];
  if (edges.length === 0) return [];

  const required = [
    "edgeId",
    "osmWayId",
    "highway",
    "surface",
    "lengthKm",
    "score",
    "flags.trail",
    "flags.natural",
    "flags.paved",
    "flags.busy",
    "repeatCount",
  ];

  return required.filter((field) => edges.some((edge) => readPath(edge, field) === undefined));
}

export function routeToGeoJson(benchmark, route) {
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
          trailRatio: best.quality?.trailRatio ?? null,
          naturalWayRatio: best.quality?.naturalWayRatio ?? null,
          pavedRatio: best.quality?.pavedRatio ?? null,
          scenicPavedRatio: best.quality?.scenicPavedRatio ?? null,
        },
        geometry: {
          type: "LineString",
          coordinates,
        },
      },
    ],
  };
}

export function summarizeEdgeDiagnostics(candidate) {
  const hasDiagnostics = Array.isArray(candidate?.edgeDiagnostics);
  const edges = hasDiagnostics ? candidate.edgeDiagnostics : [];
  const totalKm = edges.reduce((sum, edge) => sum + (edge.lengthKm ?? 0), 0);
  const sumFlag = (flag) => edges
    .filter((edge) => edge.flags?.[flag] === true)
    .reduce((sum, edge) => sum + (edge.lengthKm ?? 0), 0);
  const rawTrailKm = sumFlag("trail");
  const rawPavedKm = sumFlag("paved");
  const rawNaturalKm = sumFlag("natural");
  const rawScenicKm = sumFlag("scenic");
  const rawBusyKm = sumFlag("busy");
  const rawScenicPavedKm = edges
    .filter((edge) => edge.flags?.scenic === true && edge.flags?.paved === true)
    .reduce((sum, edge) => sum + (edge.lengthKm ?? 0), 0);
  const seenEdgeKeys = new Set();
  const repeatedExtraKm = edges.reduce((sum, edge) => {
    if (seenEdgeKeys.has(edge.edgeKey)) return sum + (edge.lengthKm ?? 0);
    seenEdgeKeys.add(edge.edgeKey);
    return sum;
  }, 0);

  return {
    diagnosticsAvailable: hasDiagnostics,
    edgeCount: edges.length,
    totalKm: Number(totalKm.toFixed(5)),
    rawFlagSemantics: "edgeDiagnostics flags are raw OSM/post-processor booleans; productSurfaceSummary is the product quality-ratio source of truth.",
    rawTrailKm: Number(rawTrailKm.toFixed(5)),
    rawPavedKm: Number(rawPavedKm.toFixed(5)),
    rawNaturalKm: Number(rawNaturalKm.toFixed(5)),
    rawScenicKm: Number(rawScenicKm.toFixed(5)),
    rawTrailRatio: totalKm > 0 ? Number((rawTrailKm / totalKm).toFixed(5)) : 0,
    rawNaturalRatio: totalKm > 0 ? Number((rawNaturalKm / totalKm).toFixed(5)) : 0,
    rawPavedRatio: totalKm > 0 ? Number((rawPavedKm / totalKm).toFixed(5)) : 0,
    rawScenicPavedRatio: totalKm > 0 ? Number((rawScenicPavedKm / totalKm).toFixed(5)) : 0,
    trailKm: Number(rawTrailKm.toFixed(5)),
    pavedKm: Number(rawPavedKm.toFixed(5)),
    naturalKm: Number(rawNaturalKm.toFixed(5)),
    scenicKm: Number(rawScenicKm.toFixed(5)),
    trailRatio: totalKm > 0 ? Number((rawTrailKm / totalKm).toFixed(5)) : 0,
    naturalWayRatio: totalKm > 0 ? Number((rawNaturalKm / totalKm).toFixed(5)) : 0,
    pavedRatio: totalKm > 0 ? Number((rawPavedKm / totalKm).toFixed(5)) : 0,
    scenicPavedRatio: totalKm > 0 ? Number((rawScenicPavedKm / totalKm).toFixed(5)) : 0,
    busyKm: Number(rawBusyKm.toFixed(5)),
    repeatedTraversalKm: Number(edges
      .filter((edge) => edge.repeated === true)
      .reduce((sum, edge) => sum + (edge.lengthKm ?? 0), 0)
      .toFixed(5)),
    repeatedExtraKm: Number(repeatedExtraKm.toFixed(5)),
    availableFields: EDGE_DIAGNOSTIC_FIELDS,
    missingFields: missingRequiredFields(candidate?.edgeDiagnostics),
  };
}

function summarizeProductSurface(candidate) {
  const quality = candidate?.quality;
  const distanceKm = candidate?.distanceKm ?? null;
  const ratioKm = (value) => (typeof value === "number" && typeof distanceKm === "number"
    ? Number((value * distanceKm).toFixed(5))
    : null);

  if (quality == null) return null;
  return {
    trailRatio: quality.trailRatio ?? null,
    trailKm: ratioKm(quality.trailRatio),
    naturalWayRatio: quality.naturalWayRatio ?? null,
    naturalWayKm: ratioKm(quality.naturalWayRatio),
    pavedRatio: quality.pavedRatio ?? null,
    pavedKm: ratioKm(quality.pavedRatio),
    scenicPavedRatio: quality.scenicPavedRatio ?? null,
    scenicPavedKm: ratioKm(quality.scenicPavedRatio),
  };
}

export function summarizeRouteIntent(routeIntent) {
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

export function routeToEdgeDiagnosticsArtifact(benchmark, route) {
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
    ...(route.stageTimings != null ? { stageTimings: route.stageTimings } : {}),
    ...(route.diagnostics != null ? { diagnostics: route.diagnostics } : {}),
    candidates: candidates.map((candidate, candidateIndex) => {
      const summary = summarizeEdgeDiagnostics(candidate);
      return {
        candidateIndex,
        isBest: candidateIndex === 0,
        distanceKm: candidate.distanceKm ?? null,
        ascendM: candidate.ascendM ?? null,
        totalScore: candidate.totalScore ?? null,
        quality: candidate.quality ?? null,
        productSurfaceSummary: summarizeProductSurface(candidate),
        rawFlagSummary: summary,
        summary,
        edgeSummary: summary,
        edges: Array.isArray(candidate.edgeDiagnostics) ? candidate.edgeDiagnostics : [],
      };
    }),
  };
}
