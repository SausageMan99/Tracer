import type { SessionProfile, Sport } from "./types";

export type WatchExportTargetId = "garmin" | "wahoo" | "coros" | "suunto" | "strava";

export interface WatchExportTarget {
  id: WatchExportTargetId;
  label: string;
  primaryAction: string;
  detail: string;
}

export interface WatchExportGuide {
  title: string;
  description: string;
  targets: WatchExportTarget[];
}

const TARGETS: Record<WatchExportTargetId, WatchExportTarget> = {
  garmin: {
    id: "garmin",
    label: "Garmin Connect",
    primaryAction: "Importer le GPX dans Garmin Connect, puis Envoyer vers l'appareil.",
    detail: "Connect web ou mobile accepte le fichier GPX TrailForge, puis synchronise la montre au prochain sync.",
  },
  wahoo: {
    id: "wahoo",
    label: "Wahoo ELEMNT",
    primaryAction: "Importer le GPX dans l'app Wahoo ELEMNT, puis synchroniser le compteur.",
    detail: "Recommandé pour vélo route et gravel : l'app transfère ensuite l'itinéraire au compteur.",
  },
  coros: {
    id: "coros",
    label: "COROS",
    primaryAction: "Ouvrir le GPX dans l'app COROS, puis l'enregistrer comme itinéraire.",
    detail: "Utile pour running et trail : le GPX peut être envoyé sur montre depuis l'app mobile.",
  },
  suunto: {
    id: "suunto",
    label: "Suunto",
    primaryAction: "Importer le GPX dans Suunto App, puis synchroniser la montre.",
    detail: "Suunto conserve le tracé comme route navigable après synchronisation.",
  },
  strava: {
    id: "strava",
    label: "Strava Routes",
    primaryAction: "Créer une route Strava depuis le GPX, puis synchroniser avec l'appareil connecté.",
    detail: "Option pratique si l'utilisateur envoie déjà ses routes Strava vers Garmin, Wahoo ou Suunto.",
  },
};

const TARGET_ORDER_BY_SPORT: Record<Sport, WatchExportTargetId[]> = {
  running: ["garmin", "coros", "suunto", "strava"],
  cycling_road: ["garmin", "wahoo", "strava", "suunto"],
  cycling_gravel: ["garmin", "wahoo", "strava", "suunto"],
  cycling_mtb: ["garmin", "wahoo", "strava", "suunto"],
};

export function getWatchExportTargets(profile: SessionProfile): WatchExportTarget[] {
  return TARGET_ORDER_BY_SPORT[profile.sport].map((id) => TARGETS[id]);
}

export function buildWatchExportGuide(profile: SessionProfile): WatchExportGuide {
  return {
    title: "Envoyer sur montre",
    description: "Télécharge le GPX, puis importe-le dans ton écosystème montre/compteur. TrailForge génère un GPX standard compatible avec les apps principales.",
    targets: getWatchExportTargets(profile),
  };
}
