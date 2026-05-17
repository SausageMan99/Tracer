export const TERRAIN_AWARE_BENCHMARK_PANELS = Object.freeze({
  true_forest_trail: Object.freeze({
    id: "true_forest_trail",
    label: "Vrai trail forestier",
    promise: "High natural-capacity terrain: the engine must exploit forest/trail corridors instead of escaping to road.",
    caseIds: Object.freeze([
      "fontainebleau-trail-15k",
      "meudon-forest-trail-10k",
      "clecy-suisse-normande-trail-12k",
    ]),
    hardSignals: Object.freeze([
      "high natural dwell",
      "high continuous natural corridor",
      "low pavedRatio",
      "high opportunityCaptureScore",
      "no weak assembler refusal when opportunity is objectively strong",
    ]),
    acceptableOutcomes: Object.freeze(["generated", "adjusted_with_evidence"]),
  }),
  transition_to_woods: Object.freeze({
    id: "transition_to_woods",
    label: "Transition vers bois",
    promise: "Road connectors are acceptable only when they unlock real dwell inside the target woods.",
    caseIds: Object.freeze([
      "tourville-pommiers-trail-5k",
      "tourville-pommiers-trail-8k",
      "tourville-pommiers-trail-10k",
      "tourville-pommiers-trail-12k",
    ]),
    hardSignals: Object.freeze([
      "target component dwell in Jean Bosco / Baron",
      "no contour-only route around woods",
      "no parasite loop",
      "good connectorEfficiencyRatio",
      "low avoidablePavementKm",
    ]),
    acceptableOutcomes: Object.freeze(["generated", "best_effort_with_explicit_compromise", "adjusted_with_evidence"]),
  }),
  park_recovery: Object.freeze({
    id: "park_recovery",
    label: "Parc urbain / récupération",
    promise: "Clean short recovery/nature loop; paved park running is acceptable but must not be sold as forest trail.",
    caseIds: Object.freeze([
      "caen-colline-aux-oiseaux-6k-soft",
    ]),
    hardSignals: Object.freeze([
      "clean shape",
      "honest pavedRatio",
      "no figure-8",
      "no start/end stem abuse",
      "adjusted/refused accepted when the park is too small",
    ]),
    acceptableOutcomes: Object.freeze(["generated", "park_recovery_adjusted", "honest_refusal"]),
  }),
  urban_nature: Object.freeze({
    id: "urban_nature",
    label: "Nature urbaine / endurance scenic",
    promise: "Capture urban green/canal/river corridors while controlling busy roads, intersections, and shape.",
    caseIds: Object.freeze([
      "caen-prairie-8k-mixed",
      "lille-10k-citadel-loop",
      "paris-19-canal-running",
      "nanterre-east-avoid-highways",
    ]),
    hardSignals: Object.freeze([
      "low busyRoadRatio",
      "park/canal/river corridor captured",
      "intersection density controlled",
      "no false NO_ROAD_NETWORK on dense valid graphs",
      "honest paved/natural split",
    ]),
    acceptableOutcomes: Object.freeze(["generated", "adjusted_with_evidence", "typed_urban_nature_refusal"]),
  }),
  poor_osm_rural: Object.freeze({
    id: "poor_osm_rural",
    label: "Terrain pauvre / OSM incertain",
    promise: "Allow low-confidence rural graphs only with explicit warnings and no surface make-up.",
    caseIds: Object.freeze([
      "osm-poor-rural-trail-8k",
    ]),
    hardSignals: Object.freeze([
      "explicit OSM confidence warning",
      "no unknown-surface enrichment into fake trail",
      "safe adjusted/refused accepted",
      "no artificial long route padding",
    ]),
    acceptableOutcomes: Object.freeze(["generated_with_warning", "adjusted_with_warning", "honest_refusal"]),
  }),
  negative_impossible: Object.freeze({
    id: "negative_impossible",
    label: "Promesse impossible / cas négatif",
    promise: "Impossible or over-constrained requests should succeed by refusing or adjusting honestly, not by forcing a fake trail.",
    caseIds: Object.freeze([
      "paris-buttes-chaumont-5k-constrained",
    ]),
    hardSignals: Object.freeze([
      "honest adjusted/refused outcome",
      "no long paved loop sold as trail",
      "explicit impossible/too-constrained reason",
      "visual shape remains inspectable if a route is returned",
    ]),
    acceptableOutcomes: Object.freeze(["honest_refusal", "park_recovery_adjusted"]),
  }),
});

export const TERRAIN_AWARE_BENCHMARK_PANEL_IDS = Object.freeze(Object.keys(TERRAIN_AWARE_BENCHMARK_PANELS));

const PANEL_BY_CASE_ID = new Map(
  Object.values(TERRAIN_AWARE_BENCHMARK_PANELS).flatMap((panel) =>
    panel.caseIds.map((caseId) => [caseId, panel])
  )
);

export function resolveBenchmarkPanel(benchmarkOrId) {
  const id = typeof benchmarkOrId === "string" ? benchmarkOrId : benchmarkOrId?.id;
  return PANEL_BY_CASE_ID.get(id) ?? null;
}

export function filterBenchmarksByPanel(benchmarks, panelId) {
  const panel = TERRAIN_AWARE_BENCHMARK_PANELS[panelId];
  if (!panel) return [];
  const ids = new Set(panel.caseIds);
  return benchmarks.filter((benchmark) => ids.has(benchmark.id));
}

export function summarizeBenchmarkPanels(results) {
  return TERRAIN_AWARE_BENCHMARK_PANEL_IDS.map((panelId) => {
    const panel = TERRAIN_AWARE_BENCHMARK_PANELS[panelId];
    const panelResults = results.filter((result) => result.panel?.id === panelId || panel.caseIds.includes(result.id));
    const failed = panelResults.filter((result) => !result.passed);
    const skipped = panelResults.filter((result) => result.skipped);
    return {
      id: panel.id,
      label: panel.label,
      promise: panel.promise,
      caseIds: [...panel.caseIds],
      total: panelResults.length,
      passed: panelResults.length - failed.length - skipped.length,
      failed: failed.length,
      skipped: skipped.length,
      hardSignals: [...panel.hardSignals],
      acceptableOutcomes: [...panel.acceptableOutcomes],
    };
  });
}

export function assertBenchmarkPanelCoverage(benchmarks) {
  const benchmarkIds = new Set(benchmarks.map((benchmark) => benchmark.id));
  const assignedIds = new Set();
  const errors = [];

  for (const panel of Object.values(TERRAIN_AWARE_BENCHMARK_PANELS)) {
    if (panel.caseIds.length === 0) {
      errors.push(`${panel.id} has no cases`);
    }
    for (const caseId of panel.caseIds) {
      if (!benchmarkIds.has(caseId)) {
        errors.push(`${panel.id} references unknown case ${caseId}`);
      }
      if (assignedIds.has(caseId)) {
        errors.push(`${caseId} appears in multiple terrain-aware panels`);
      }
      assignedIds.add(caseId);
    }
  }

  for (const benchmark of benchmarks) {
    if (!assignedIds.has(benchmark.id)) {
      errors.push(`${benchmark.id} is not assigned to a terrain-aware panel`);
    }
  }

  return { ok: errors.length === 0, errors };
}
