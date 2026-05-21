import { buildGraph } from "../engine/graph-builder";
import { geocodeAddress } from "../route-generator-legacy";
import type { RouteRequest } from "../types";
import { planRouteIntentV3 } from "./route-intent-planner";
import { generateRouteV3FromGraph, type GeneratedRouteV3 } from "./route-generator";
import { validateRouteV3ExportConsistency } from "./route-export";
import { buildTerrainSnapshotV3FromGraph } from "./terrain-snapshot-builder";
import { routeV3WarningCopy } from "./product-copy";
import type { ProductOutcomeLabelV3, RouteMetricsV3, RouteModeV3, RouteOutcomeV3, RouteStrategyV3, TerrainComponentV3, TerrainSnapshotV3 } from "./types";

export type GenerateRouteV3ApiOutcome = "generated" | "adjusted" | "refused";

export interface GenerateRouteV3ApiResponse {
  engine: "v3-clean-room";
  betaOutcome: GenerateRouteV3ApiOutcome;
  betaOutcomeLabel: ProductOutcomeLabelV3;
  productLabel: ProductOutcomeLabelV3;
  metrics: RouteMetricsV3 | null;
  reason: string;
  warnings: string[];
  userWarnings: string[];
  routeGeoJson: {
    type: "Feature";
    geometry: {
      type: "LineString";
      coordinates: number[][];
    };
    properties: {
      engine: "v3-clean-room";
      strategy: string;
      betaOutcome: GenerateRouteV3ApiOutcome;
      betaOutcomeLabel: ProductOutcomeLabelV3;
      productLabel: ProductOutcomeLabelV3;
    };
  } | null;
  gpxAvailable: boolean;
}

export interface TerrainIntentV3ApiOutcome {
  type: RouteOutcomeV3["type"];
  summary: string;
}

export interface TerrainIntentV3ApiResponse {
  engine: "v3-clean-room";
  terrainSnapshot: TerrainSnapshotV3;
  components: TerrainComponentV3[];
  recommendedStrategy: RouteStrategyV3;
  possibleOutcomes: TerrainIntentV3ApiOutcome[];
  risks: string[];
  userSummary: string;
}

export async function inspectTerrainIntentV3Api(request: RouteRequest): Promise<TerrainIntentV3ApiResponse> {
  const start = await geocodeAddress(request.address);
  const { graph } = await buildGraph(start, {
    targetDistanceKm: request.targetDistanceKm,
    sport: "running",
  });
  const terrainSnapshot = buildTerrainSnapshotV3FromGraph(graph);
  const intent = planRouteIntentV3({
    start,
    targetDistanceKm: request.targetDistanceKm,
    activity: "running",
    sport: "running",
    mode: modeForRequest(request),
    loop: true,
  }, terrainSnapshot);

  return {
    engine: "v3-clean-room",
    terrainSnapshot,
    components: terrainSnapshot.components,
    recommendedStrategy: intent.strategy,
    possibleOutcomes: possibleOutcomesFor(intent.strategy, intent.outcome),
    risks: risksForIntent(intent.outcome, intent.warnings),
    userSummary: userSummaryForIntent(intent.strategy),
  };
}

export async function generateRouteV3Api(request: RouteRequest): Promise<GenerateRouteV3ApiResponse> {
  const start = await geocodeAddress(request.address);
  const { graph } = await buildGraph(start, {
    targetDistanceKm: request.targetDistanceKm,
    sport: "running",
  });

  if (graph.nodes.size === 0 || graph.edges.size === 0) {
    return refusedContract("NO_ROAD_NETWORK", ["V3 experimental found no routable graph evidence around the start point."]);
  }

  const generated = generateRouteV3FromGraph({
    start,
    targetDistanceKm: request.targetDistanceKm,
    activity: "running",
    sport: "running",
    mode: modeForRequest(request),
    loop: true,
  }, graph);

  return buildGenerateRouteV3ApiResponseFromGenerated(generated);
}

export function buildGenerateRouteV3ApiResponseFromGenerated(generated: GeneratedRouteV3): GenerateRouteV3ApiResponse {
  const betaOutcome = generated.outcome.type;
  const betaOutcomeLabel = generated.outcome.productLabel ?? fallbackProductLabel(betaOutcome);
  const coordinates = generated.route.geometry.coordinates;
  const polyline = coordinates.map(([lng, lat]) => ({ lat, lng }));
  const hasGeometry = betaOutcome !== "refused" && coordinates.length >= 2;
  const exportValidation = hasGeometry
    ? validateRouteV3ExportConsistency({
      polyline,
      metricDistanceKm: generated.route.metrics.distanceProducedKm,
      loop: true,
      routeEdges: generated.route.edges,
    })
    : null;
  const exportValid = exportValidation?.valid ?? false;
  const effectiveOutcome = hasGeometry && !exportValid ? "refused" : betaOutcome;
  const effectiveLabel = hasGeometry && !exportValid ? "refused_other" : betaOutcomeLabel;
  const exportWarnings = exportValidation && !exportValidation.valid
    ? [`V3 export geometry invalid: ${exportValidation.reasons.join('; ')}`]
    : [];
  const routeGeoJson = hasGeometry && exportValid
    ? {
      type: "Feature" as const,
      geometry: {
        type: "LineString" as const,
        coordinates,
      },
      properties: {
        engine: generated.engine,
        strategy: generated.intent.strategy,
        betaOutcome,
        betaOutcomeLabel,
        productLabel: betaOutcomeLabel,
      },
    }
    : null;
  const warnings = unique([
    ...generated.diagnostics.warnings,
    ...generated.diagnostics.limitations,
    ...exportWarnings,
  ]);

  return {
    engine: generated.engine,
    betaOutcome: effectiveOutcome,
    betaOutcomeLabel: effectiveLabel,
    productLabel: effectiveLabel,
    metrics: generated.route.metrics,
    reason: exportValidation && !exportValidation.valid
      ? `EXPORT_GEOMETRY_INVALID — ${exportValidation.reasons.join(' — ')}`
      : reasonForOutcome(generated.outcome),
    warnings,
    userWarnings: warnings.map(routeV3WarningCopy),
    routeGeoJson,
    gpxAvailable: routeGeoJson != null && exportValid,
  };
}

function modeForRequest(request: RouteRequest): RouteModeV3 {
  if (request.profileId.includes("trail")) return "trail";
  if (request.scenicMode === true) return "nature_urbaine";
  return "trail";
}

function possibleOutcomesFor(strategy: RouteStrategyV3, outcome: RouteOutcomeV3): TerrainIntentV3ApiOutcome[] {
  const primary = outcomeToApiOutcome(outcome);
  const outcomes: TerrainIntentV3ApiOutcome[] = [primary];

  if (strategy === "forest_loop") {
    outcomes.push({ type: "adjusted", summary: "Trail can remain possible with honest paved connectors if the clean loop is constrained." });
  } else if (strategy === "transition_to_woods") {
    outcomes.push({ type: "refused", summary: "Terrain may be insufficient for an honest trail loop if the connector or wooded component cannot close cleanly." });
  } else if (strategy === "park_loop" || strategy === "urban_nature_loop" || strategy === "simple_quiet_loop") {
    outcomes.push({ type: "refused", summary: "Pure trail should be refused if the requested promise requires real non-paved dwell." });
  } else if (strategy === "low_trail_potential") {
    outcomes.push({ type: "refused", summary: "Terrain can be refused when even a quiet honest loop is not supported by the graph." });
  }

  return dedupeOutcomes(outcomes);
}

function outcomeToApiOutcome(outcome: RouteOutcomeV3): TerrainIntentV3ApiOutcome {
  if (outcome.type === "refused") return { type: "refused", summary: [outcome.reason, ...(outcome.details ?? [])].join(" — ") };
  if (outcome.type === "adjusted") return { type: "adjusted", summary: [outcome.summary, ...outcome.compromises].join(" — ") };
  return { type: "generated", summary: outcome.summary };
}

function risksForIntent(outcome: RouteOutcomeV3, warnings: string[]): string[] {
  const risks = [...warnings];
  if (outcome.type === "adjusted") risks.push(...outcome.compromises);
  if (outcome.type === "refused") risks.push(outcome.reason, ...(outcome.details ?? []));
  return unique(risks).filter((risk) => risk.trim().length > 0);
}

function userSummaryForIntent(strategy: RouteStrategyV3): string {
  switch (strategy) {
    case "forest_loop":
      return "Ce secteur permet une boucle trail honnête.";
    case "transition_to_woods":
      return "Trail possible mais nécessite une transition route vers les bois.";
    case "park_loop":
    case "urban_nature_loop":
    case "simple_quiet_loop":
      return "Ce secteur est compatible nature urbaine, pas trail pur.";
    case "low_trail_potential":
    case "unroutable":
      return "Terrain insuffisant pour une boucle honnête.";
  }
}

function dedupeOutcomes(outcomes: TerrainIntentV3ApiOutcome[]): TerrainIntentV3ApiOutcome[] {
  const seen = new Set<string>();
  return outcomes.filter((outcome) => {
    const key = `${outcome.type}:${outcome.summary}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function reasonForOutcome(outcome: ReturnType<typeof generateRouteV3FromGraph>["outcome"]): string {
  if (outcome.type === "refused") {
    return [outcome.reason, ...(outcome.details ?? [])].join(" — ");
  }
  if (outcome.type === "adjusted") {
    return [outcome.summary, ...outcome.compromises].join(" — ");
  }
  return outcome.summary;
}

function refusedContract(reason: string, warnings: string[]): GenerateRouteV3ApiResponse {
  return {
    engine: "v3-clean-room",
    betaOutcome: "refused",
    betaOutcomeLabel: "refused_topology",
    productLabel: "refused_topology",
    metrics: null,
    reason,
    warnings,
    userWarnings: warnings.map(routeV3WarningCopy),
    routeGeoJson: null,
    gpxAvailable: false,
  };
}

function fallbackProductLabel(outcome: GenerateRouteV3ApiOutcome): ProductOutcomeLabelV3 {
  if (outcome === "generated") return "generated_trail";
  if (outcome === "adjusted") return "adjusted_trail";
  return "refused_other";
}

function unique(values: string[]): string[] {
  return Array.from(new Set(values));
}

export function isV3ApiProductRefusal(response: GenerateRouteV3ApiResponse): boolean {
  return response.betaOutcome === "refused";
}
