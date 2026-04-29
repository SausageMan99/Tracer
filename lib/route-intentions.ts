import type { SessionProfile, SessionType } from "./types";

export type RouteIntentionId =
  | "easy_recovery"
  | "steady_endurance"
  | "threshold_work"
  | "intervals_flat"
  | "long_adventure"
  | "nature_escape";

export interface RouteIntention {
  id: RouteIntentionId;
  label: string;
  promise: string;
  engineBiases: string[];
  weightMultipliers: {
    surface?: number;
    elevation?: number;
    nature?: number;
    quietness?: number;
  };
}

export const ROUTE_INTENTIONS: Record<RouteIntentionId, RouteIntention> = {
  easy_recovery: {
    id: "easy_recovery",
    label: "Récupération facile",
    promise: "TrailForge cherche une boucle calme, lisible et peu agressive pour récupérer sans subir le terrain.",
    engineBiases: ["calme", "faible D+", "surface régulière"],
    weightMultipliers: { quietness: 1.35, elevation: 0.55, surface: 1.1 },
  },
  steady_endurance: {
    id: "steady_endurance",
    label: "Endurance stable",
    promise: "TrailForge privilégie une boucle équilibrée, régulière et assez naturelle pour tenir l'allure longtemps.",
    engineBiases: ["distance fiable", "boucle propre", "terrain varié"],
    weightMultipliers: { surface: 1.05, nature: 1.05, quietness: 1.05 },
  },
  threshold_work: {
    id: "threshold_work",
    label: "Travail au seuil",
    promise: "TrailForge cherche un parcours plus roulant, régulier et sans ruptures inutiles pour soutenir l'effort.",
    engineBiases: ["surface régulière", "distance précise", "peu de relances"],
    weightMultipliers: { surface: 1.35, elevation: 0.75, quietness: 1.05, nature: 0.8 },
  },
  intervals_flat: {
    id: "intervals_flat",
    label: "Intervalles plats",
    promise: "TrailForge priorise le plat, la surface propre et la répétabilité pour une séance intense contrôlable.",
    engineBiases: ["plat", "surface propre", "régularité"],
    weightMultipliers: { elevation: 0.45, surface: 1.45, quietness: 1.05, nature: 0.75 },
  },
  long_adventure: {
    id: "long_adventure",
    label: "Sortie longue aventure",
    promise: "TrailForge accepte plus de relief et de chemins pour construire une vraie boucle longue avec du caractère.",
    engineBiases: ["relief", "nature", "boucle durable"],
    weightMultipliers: { elevation: 1.35, nature: 1.25, quietness: 1.05, surface: 0.9 },
  },
  nature_escape: {
    id: "nature_escape",
    label: "Échappée nature",
    promise: "TrailForge privilégie la nature et les chemins calmes, quitte à accepter un léger compromis de précision.",
    engineBiases: ["nature", "chemins", "calme"],
    weightMultipliers: { nature: 1.55, quietness: 1.2, surface: 0.85, elevation: 0.9 },
  },
};

const SESSION_TYPE_TO_INTENTION: Record<SessionType, RouteIntentionId> = {
  endurance: "steady_endurance",
  seuil_lactique: "threshold_work",
  intervals_30_30: "intervals_flat",
  sortie_longue: "long_adventure",
  recuperation: "easy_recovery",
  seuil: "threshold_work",
  intervals: "intervals_flat",
  gran_fondo: "long_adventure",
};

export function getRouteIntention(profile: SessionProfile, scenicMode = false): RouteIntention {
  if (scenicMode) return ROUTE_INTENTIONS.nature_escape;
  return ROUTE_INTENTIONS[SESSION_TYPE_TO_INTENTION[profile.sessionType]];
}

export interface RouteIntentionCard {
  title: string;
  promise: string;
  biases: string[];
}

export function buildRouteIntentionCard(profile: SessionProfile, scenicMode = false): RouteIntentionCard {
  const intention = getRouteIntention(profile, scenicMode);
  return {
    title: intention.label,
    promise: intention.promise,
    biases: intention.engineBiases,
  };
}
