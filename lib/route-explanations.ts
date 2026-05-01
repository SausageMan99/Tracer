import type { GeneratedRoute } from "./types";
import { getRouteIntention } from "./route-intentions";

export interface RouteExplanationInput {
  targetDistanceKm: number;
  targetElevationM: number;
  scenicMode?: boolean;
}

export interface RouteExplanation {
  headline: string;
  summary: string;
  signals: string[];
  compromises: string[];
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function qualityNumber(value: number | undefined, fallback = 0): number {
  return Number.isFinite(value) ? value! : fallback;
}

export function buildRouteExplanation(
  route: GeneratedRoute,
  input: RouteExplanationInput
): RouteExplanation {
  const { best, profile } = route;
  const quality = best.quality;
  const intention = getRouteIntention(profile, input.scenicMode === true);

  const distanceError = qualityNumber(
    quality?.distanceErrorPct,
    Math.abs(best.distanceKm - input.targetDistanceKm) / Math.max(input.targetDistanceKm, 0.1)
  );
  const elevationError = qualityNumber(
    quality?.elevationErrorPct,
    input.targetElevationM > 0
      ? Math.abs(best.ascendM - input.targetElevationM) / Math.max(input.targetElevationM, 1)
      : 0
  );
  const busyRoadRatio = qualityNumber(quality?.busyRoadRatio, 0);
  const trailRatio = qualityNumber(quality?.trailRatio, 0);
  const naturalWayRatio = qualityNumber(quality?.naturalWayRatio, trailRatio);
  const pavedRatio = qualityNumber(quality?.pavedRatio, 0);
  const scenicPavedRatio = qualityNumber(quality?.scenicPavedRatio, 0);
  const loopGapKm = qualityNumber(quality?.loopGapKm, Math.max(0, 1 - best.loopScore) * 5);
  const warnings = quality?.warnings ?? [];

  const compromises: string[] = [];
  if (distanceError > 0.15 || warnings.includes("DISTANCE_OFF_TARGET")) {
    compromises.push("Distance éloignée de la cible");
  }
  if (input.targetElevationM > 0 && (elevationError > 0.35 || warnings.includes("ELEVATION_OFF_TARGET"))) {
    compromises.push("D+ estimé au-dessus de la cible");
  }
  if (busyRoadRatio > 0.08 || warnings.includes("TOO_MUCH_BUSY_ROAD")) {
    compromises.push("Passage routier plus présent que souhaité");
  }
  if ((naturalWayRatio >= 0.5 && pavedRatio > 0.45) || warnings.includes("TOO_MUCH_PAVEMENT") || warnings.includes("NATURAL_BUT_PAVED")) {
    compromises.push("Cadre naturel mais trop bitumé");
  }
  if (loopGapKm > 0.5 || warnings.includes("LOOP_NOT_CLOSED")) {
    compromises.push("Boucle moins bien refermée");
  }
  if (warnings.includes("TOO_MUCH_BACKTRACKING")) {
    compromises.push("Allers-retours détectés");
  }
  if (warnings.includes("OSM_SURFACE_DATA_WEAK")) {
    compromises.push("Données terrain incomplètes");
  }
  if (warnings.includes("ROUTE_INTENT_WEAK_MATCH")) {
    compromises.push("Zone naturelle peu exploitée");
  }
  if (warnings.includes("LOOP_TOO_CONSTRAINED")) {
    compromises.push("Réseau local très contraint");
  }
  if (warnings.includes("OUT_AND_BACK_SHAPE") || warnings.includes("LOOP_GEOMETRY_WEAK")) {
    compromises.push("Géométrie de boucle fragile");
  }

  const signals = [
    `Intention : ${intention.label}`,
    `Écart distance : ${pct(distanceError)}`,
    `Écart D+ : ${pct(elevationError)}`,
    `Sentiers non bitumés : ${pct(trailRatio)}`,
    `Cadre naturel/scénique : ${pct(naturalWayRatio)}`,
    `Revêtement bitumé : ${pct(pavedRatio)}`,
    `Bitumé scénique : ${pct(scenicPavedRatio)}`,
    `Grands axes : ${pct(busyRoadRatio)}`,
  ];

  const hasCompromise = compromises.length > 0;
  const headline = hasCompromise
    ? "Boucle trouvée avec compromis"
    : "Boucle propre générée";

  const summary = hasCompromise
    ? `TrailForge a sécurisé une boucle ${intention.label.toLowerCase()}, mais le meilleur résultat impose un compromis sur la ${compromises[0].toLowerCase()}.`
    : `TrailForge a privilégié ${intention.engineBiases.join(", ")} pour produire une boucle cohérente avec l'objectif, avec une bonne part de nature quand le terrain le permet.`;

  return {
    headline,
    summary,
    signals,
    compromises,
  };
}
