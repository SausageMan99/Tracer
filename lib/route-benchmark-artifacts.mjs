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

function roundKm(value) {
  return Number((value ?? 0).toFixed(5));
}

function roundRatio(value) {
  return Number((value ?? 0).toFixed(5));
}

function profileToOpportunityMode(profileId) {
  if (profileId === "running_trail") return "trail";
  if (profileId === "running_recuperation") return "recovery";
  if (profileId === "running_endurance") return "endurance";
  return "nature_urbaine";
}

function opportunityKindForComponent(kind) {
  if (kind === "trail_cluster") return "field_paths";
  if (kind === "unknown_natural") return "unknown";
  return kind ?? "unknown";
}

function weakestConfidence(levels) {
  const rank = { low: 0, medium: 1, high: 2 };
  const normalized = levels.filter((level) => rank[level] !== undefined);
  if (normalized.length === 0) return "low";
  return normalized.reduce((weakest, level) => rank[level] < rank[weakest] ? level : weakest, normalized[0]);
}

function realisticOutcomeForOpportunity(routeIntent, bestAvailable) {
  if (routeIntent?.type === "low_trail_potential") return "refused";
  if (routeIntent?.distancePolicy?.mode === "adjustable") return "adjusted";
  if (bestAvailable.maxNaturalDwellKm < Math.min(1.2, Math.max(0.6, (routeIntent?.targetDistanceKm ?? 0) * 0.12))) {
    return "adjusted";
  }
  return "generated";
}

function reasonForOpportunity(routeIntent, bestAvailable) {
  if (routeIntent?.type === "transition_to_woods") {
    return "Useful natural terrain exists away from the start; road connectors are acceptable only if they unlock real dwell in target components.";
  }
  if (routeIntent?.type === "forest_loop") {
    return "Rich natural terrain is available in the local graph; the benchmark should expect strong dwell and low avoidable pavement.";
  }
  if (routeIntent?.type === "park_loop") {
    return "Local opportunity looks park-scale; adjusted distance or urban-nature framing may be more honest than a strict forest trail promise.";
  }
  if (routeIntent?.type === "urban_nature_loop") {
    return "Natural opportunity is urban or corridor-like; judge safety, shape and honest pavement rather than forest-trail purity.";
  }
  if (routeIntent?.type === "low_trail_potential") {
    return "The graph exposes too little reliable natural dwell for the requested trail promise.";
  }
  if (bestAvailable.maxNaturalDwellKm <= 0) return "No measurable natural terrain opportunity was exposed by the planner.";
  return "Terrain opportunity derived from planner components; observation-only artifact, not a route scoring input.";
}

function pointToCoordinate(point) {
  if (!Number.isFinite(point?.lng) || !Number.isFinite(point?.lat)) return null;
  return [point.lng, point.lat];
}

function edgeToSegmentSummary(edge, reason) {
  return {
    reason,
    index: edge.index ?? null,
    edgeId: edge.edgeId ?? null,
    edgeKey: edge.edgeKey ?? null,
    osmWayId: edge.osmWayId ?? null,
    fromNodeId: edge.fromNodeId ?? null,
    toNodeId: edge.toNodeId ?? null,
    from: edge.from ?? null,
    to: edge.to ?? null,
    highway: edge.highway ?? null,
    surface: edge.surface ?? null,
    lengthKm: roundKm(edge.lengthKm),
    score: edge.score ?? null,
    scoreReason: edge.scoreReason ?? null,
    name: edge.name ?? null,
    ref: edge.ref ?? null,
    componentId: edge.componentId ?? null,
    flags: edge.flags ?? {},
    repeatCount: edge.repeatCount ?? 0,
    repeated: edge.repeated === true,
  };
}

function worstSegments(edges, predicate, reason, limit = 5) {
  return edges
    .filter(predicate)
    .slice()
    .sort((a, b) => (b.lengthKm ?? 0) - (a.lengthKm ?? 0))
    .slice(0, limit)
    .map((edge) => edgeToSegmentSummary(edge, reason));
}

function edgeToFeature(benchmark, candidate, candidateIndex, edge) {
  const from = pointToCoordinate(edge.from);
  const to = pointToCoordinate(edge.to);
  if (from == null || to == null) return null;

  return {
    type: "Feature",
    properties: {
      benchmarkId: benchmark.id,
      label: benchmark.label,
      profileId: benchmark.profileId,
      candidateIndex,
      isBest: candidateIndex === 0,
      candidateDistanceKm: candidate.distanceKm ?? null,
      edgeIndex: edge.index ?? null,
      edgeId: edge.edgeId ?? null,
      edgeKey: edge.edgeKey ?? null,
      osmWayId: edge.osmWayId ?? null,
      fromNodeId: edge.fromNodeId ?? null,
      toNodeId: edge.toNodeId ?? null,
      highway: edge.highway ?? null,
      surface: edge.surface ?? null,
      access: edge.access ?? null,
      foot: edge.foot ?? null,
      bicycle: edge.bicycle ?? null,
      oneway: edge.oneway ?? null,
      lengthKm: edge.lengthKm ?? null,
      score: edge.score ?? null,
      scoreReason: edge.scoreReason ?? null,
      name: edge.name ?? null,
      ref: edge.ref ?? null,
      componentId: edge.componentId ?? null,
      trail: edge.flags?.trail === true,
      paved: edge.flags?.paved === true,
      natural: edge.flags?.natural === true,
      scenic: edge.flags?.scenic === true,
      busy: edge.flags?.busy === true,
      restricted: edge.flags?.restricted === true,
      onewayViolation: edge.flags?.onewayViolation === true,
      repeatCount: edge.repeatCount ?? 0,
      repeated: edge.repeated === true,
    },
    geometry: {
      type: "LineString",
      coordinates: [from, to],
    },
  };
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

export function routeToEdgesGeoJson(benchmark, route) {
  const candidates = Array.isArray(route?.candidates) ? route.candidates : [];
  const features = candidates.flatMap((candidate, candidateIndex) => {
    const edges = Array.isArray(candidate.edgeDiagnostics) ? candidate.edgeDiagnostics : [];
    return edges
      .map((edge) => edgeToFeature(benchmark, candidate, candidateIndex, edge))
      .filter(Boolean);
  });

  if (features.length === 0) return null;
  return {
    type: "FeatureCollection",
    features,
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
    worstSegments: {
      paved: worstSegments(edges, (edge) => edge.flags?.paved === true, "paved"),
      repeated: worstSegments(
        edges,
        (edge) => edge.repeated === true || (edge.repeatCount ?? 0) > 1,
        "repeated"
      ),
    },
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
    distancePolicy: routeIntent.distancePolicy ?? null,
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

export function routeToTerrainOpportunityReport(benchmark, route) {
  const routeIntent = route?.routeIntent;
  const components = Array.isArray(routeIntent?.terrainComponents) ? routeIntent.terrainComponents : [];
  if (routeIntent == null && components.length === 0) return null;

  const opportunityComponents = components.map((component) => {
    const totalLengthKm = roundKm(component.totalKm);
    const pavedKm = roundKm(component.pavedKm);
    const nonPavedKm = roundKm(component.nonPavedKm);
    const unknownSurfaceKm = roundKm(component.unknownSurfaceKm);
    const knownKm = Math.max(0, totalLengthKm - unknownSurfaceKm);
    const warnings = [];
    if (unknownSurfaceKm > Math.max(0.2, totalLengthKm * 0.25)) warnings.push("LOW_SURFACE_CONFIDENCE");
    if (pavedKm > nonPavedKm && opportunityKindForComponent(component.kind) !== "scenic_paved") warnings.push("PAVED_DOMINANT_COMPONENT");

    return {
      id: component.id,
      kind: opportunityKindForComponent(component.kind),
      sourceKind: component.kind ?? null,
      distanceFromStartKm: roundKm(component.distanceFromStartKm),
      totalLengthKm,
      pavedKm,
      nonPavedKm,
      unknownSurfaceKm,
      pavedRatio: totalLengthKm > 0 ? roundRatio(pavedKm / totalLengthKm) : 0,
      nonPavedRatio: totalLengthKm > 0 ? roundRatio(nonPavedKm / totalLengthKm) : 0,
      unknownSurfaceRatio: totalLengthKm > 0 ? roundRatio(unknownSurfaceKm / totalLengthKm) : 0,
      accessConfidence: component.confidence ?? "low",
      surfaceConfidence: knownKm / Math.max(totalLengthKm, 0.001) >= 0.75 ? component.confidence ?? "medium" : "low",
      estimatedDwellCapacityKm: roundKm(nonPavedKm + unknownSurfaceKm * 0.35),
      connectorCostKm: roundKm(component.distanceFromStartKm),
      entryNodeCount: Array.isArray(component.entryNodeIds) ? component.entryNodeIds.length : 0,
      exitNodeCount: Array.isArray(component.exitNodeIds) ? component.exitNodeIds.length : 0,
      warnings,
    };
  });

  const targetIds = new Set(routeIntent?.targetComponents ?? []);
  const targetComponents = opportunityComponents.filter((component) => targetIds.has(component.id));
  const candidateComponents = targetComponents.length > 0 ? targetComponents : opportunityComponents;
  const maxNaturalDwellKm = candidateComponents.reduce((max, component) => Math.max(max, component.estimatedDwellCapacityKm), 0);
  const maxContinuousNaturalKm = candidateComponents.reduce((max, component) => Math.max(max, component.nonPavedKm), 0);
  const totalOpportunityKm = opportunityComponents.reduce((sum, component) => sum + component.totalLengthKm, 0);
  const totalNonPavedKm = opportunityComponents.reduce((sum, component) => sum + component.nonPavedKm, 0);
  const minConnectorKmToUsefulTerrain = candidateComponents.length > 0
    ? Math.min(...candidateComponents.map((component) => component.connectorCostKm))
    : null;
  const graphWarnings = [];
  if (opportunityComponents.length === 0) graphWarnings.push("NO_TERRAIN_COMPONENTS_REPORTED");
  if (opportunityComponents.some((component) => component.surfaceConfidence === "low")) graphWarnings.push("SURFACE_CONFIDENCE_MIXED");

  const bestAvailable = {
    maxNaturalDwellKm: roundKm(maxNaturalDwellKm),
    maxContinuousNaturalKm: roundKm(maxContinuousNaturalKm),
    maxNonPavedRatioEstimate: totalOpportunityKm > 0 ? roundRatio(totalNonPavedKm / totalOpportunityKm) : 0,
    minConnectorKmToUsefulTerrain: minConnectorKmToUsefulTerrain == null ? null : roundKm(minConnectorKmToUsefulTerrain),
    realisticOutcome: "generated",
    reason: "",
  };
  bestAvailable.realisticOutcome = realisticOutcomeForOpportunity(routeIntent, bestAvailable);
  bestAvailable.reason = reasonForOpportunity(routeIntent, bestAvailable);

  return {
    schemaVersion: 1,
    observationOnly: true,
    scoringBehaviorChanged: false,
    caseId: benchmark.id,
    request: {
      start: routeIntent?.start ?? null,
      address: benchmark.address ?? null,
      targetDistanceKm: benchmark.targetDistanceKm,
      targetElevationM: benchmark.targetElevationM,
      mode: profileToOpportunityMode(benchmark.profileId),
      profileId: benchmark.profileId,
      scenicMode: benchmark.scenicMode === true,
    },
    graph: {
      totalEdgeKm: route?.diagnostics?.graph?.totalEdgeKm ?? null,
      usableEdgeKm: roundKm(totalOpportunityKm),
      connectedComponentKm: roundKm(opportunityComponents.reduce((max, component) => Math.max(max, component.totalLengthKm), 0)),
      nodeCount: route?.diagnostics?.graph?.nodeCount ?? null,
      edgeCount: route?.diagnostics?.graph?.edgeCount ?? null,
      confidence: weakestConfidence(opportunityComponents.map((component) => component.surfaceConfidence)),
      warnings: graphWarnings,
    },
    strategy: {
      routeIntentType: routeIntent?.type ?? null,
      routeStrategy: routeIntent?.strategy ?? null,
      targetComponents: routeIntent?.targetComponents ?? [],
      distancePolicy: routeIntent?.distancePolicy ?? null,
      cleanReturnMode: routeIntent?.cleanReturnMode ?? null,
    },
    components: opportunityComponents,
    bestAvailable,
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
        worstSegments: summary.worstSegments,
        edges: Array.isArray(candidate.edgeDiagnostics) ? candidate.edgeDiagnostics : [],
      };
    }),
  };
}
