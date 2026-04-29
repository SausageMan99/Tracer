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
  const loopGapKm = qualityNumber(quality?.loopGapKm, Math.max(0, 1 - best.loopScore) * 5);
  const warnings = quality?.warnings ?? [];

  const compromises: string[] = [];
  if (distanceError > 0.15 || warnings.includes("DISTANCE_OFF_TARGET")) {
    compromises.push("Distance éloignée de la cible");
  }
  if (input.targetElevationM > 0 && (elevationError > 0.35 || warnings.includes("ELEVATION_OFF_TARGET"))) {
    compromises.push("D+ imparfait par rapport à la demande");
  }
  if (busyRoadRatio > 0.08 || warnings.includes("TOO_MUCH_BUSY_ROAD")) {
    compromises.push("Passage routier plus présent que souhaité");
  }
  if (loopGapKm > 0.5 || warnings.includes("LOOP_NOT_CLOSED")) {
    compromises.push("Boucle moins bien refermée");
  }
  if (warnings.includes("TOO_MUCH_BACKTRACKING")) {
    compromises.push("Allers-retours détectés");
  }

  const signals = [
    `Intention : ${intention.label}`,
    `Écart distance : ${pct(distanceError)}`,
    `Écart D+ : ${pct(elevationError)}`,
    `Chemins/nature : ${pct(trailRatio)}`,
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
