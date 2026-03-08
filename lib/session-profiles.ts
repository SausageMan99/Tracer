import type { SessionProfile, Sport } from "./types";

/**
 * Complete list of all available session profiles.
 *
 * Profiles are grouped by sport and ordered from low to high intensity.
 * Each profile encodes the physiological constraints of a training session
 * as numerical ranges and scoring weights, which the route generation
 * algorithm uses to select and rank candidate routes.
 *
 * Adding a new profile here is sufficient to make it appear in the UI —
 * no other changes are required (see DEVELOPER_GUIDE.md §Adding a new session type).
 */
export const SESSION_PROFILES: SessionProfile[] = [
  // ─── RUNNING ────────────────────────────────────────────────────────────────
  {
    id: "running_endurance",
    name: "Endurance",
    sport: "running",
    sessionType: "endurance",
    distanceRange: { min: 5, default: 10, max: 30 },
    elevationRange: { min: 50, default: 150, max: 500 },
    distancePresets: [5, 10, 15, 21, 30],
    elevationPresets: [50, 150, 300, 500],
    description: "Course à allure modérée, fréquence cardiaque zone 2. Terrain varié accepté.",
    graphhopperProfile: "foot",
    weights: {
      elevationMatch: 0.20,
      distanceMatch: 0.40,
      surfaceQuality: 0.20,
      loopQuality: 0.20,
    },
  },
  {
    id: "running_seuil",
    name: "Seuil Lactique",
    sport: "running",
    sessionType: "seuil_lactique",
    distanceRange: { min: 6, default: 10, max: 20 },
    elevationRange: { min: 0, default: 80, max: 200 },
    distancePresets: [6, 8, 10, 15, 20],
    elevationPresets: [0, 50, 100, 200],
    description: "Effort soutenu proche du seuil lactique. Terrain régulier, peu de dénivelé.",
    graphhopperProfile: "foot",
    weights: {
      elevationMatch: 0.15,
      distanceMatch: 0.45,
      surfaceQuality: 0.25,
      loopQuality: 0.15,
    },
  },
  {
    id: "running_intervals",
    name: "Intervals 30/30",
    sport: "running",
    sessionType: "intervals_30_30",
    distanceRange: { min: 5, default: 8, max: 12 },
    elevationRange: { min: 0, default: 30, max: 100 },
    distancePresets: [5, 7, 10, 12],
    elevationPresets: [0, 30, 60, 100],
    description: "Intervalles 30s effort / 30s récup. Terrain plat indispensable.",
    graphhopperProfile: "foot",
    weights: {
      elevationMatch: 0.05,
      distanceMatch: 0.50,
      surfaceQuality: 0.30,
      loopQuality: 0.15,
    },
  },
  {
    id: "running_sortie_longue",
    name: "Sortie Longue",
    sport: "running",
    sessionType: "sortie_longue",
    distanceRange: { min: 20, default: 28, max: 50 },
    elevationRange: { min: 100, default: 300, max: 1000 },
    distancePresets: [20, 25, 30, 35, 42],
    elevationPresets: [100, 300, 600, 1000],
    description: "Sortie longue à allure confortable. Peut inclure du dénivelé significatif.",
    graphhopperProfile: "foot",
    weights: {
      elevationMatch: 0.25,
      distanceMatch: 0.35,
      surfaceQuality: 0.20,
      loopQuality: 0.20,
    },
  },
  {
    id: "running_recuperation",
    name: "Récupération",
    sport: "running",
    sessionType: "recuperation",
    distanceRange: { min: 3, default: 6, max: 10 },
    elevationRange: { min: 0, default: 20, max: 80 },
    distancePresets: [3, 5, 7, 10],
    elevationPresets: [0, 20, 50, 80],
    description: "Footing très léger de récupération active. Terrain plat, surface souple.",
    graphhopperProfile: "foot",
    weights: {
      elevationMatch: 0.05,
      distanceMatch: 0.35,
      surfaceQuality: 0.40,
      loopQuality: 0.20,
    },
  },

  // ─── CYCLING ROAD ───────────────────────────────────────────────────────────
  // orsProfile: "cycling-road" → ORS routes sur routes lisses, évite pistes et grands axes
  {
    id: "cycling_road_endurance",
    name: "Endurance",
    sport: "cycling_road",
    sessionType: "endurance",
    distanceRange: { min: 30, default: 70, max: 150 },
    elevationRange: { min: 200, default: 600, max: 2000 },
    distancePresets: [40, 60, 80, 100, 150],
    elevationPresets: [200, 600, 1000, 2000],
    description: "Sortie en zone 2, petites routes asphaltées. Allure modérée sur longue durée.",
    graphhopperProfile: "bike",
    orsProfile: "cycling-road",
    weights: {
      elevationMatch: 0.25,
      distanceMatch: 0.35,
      surfaceQuality: 0.30,
      loopQuality: 0.10,
    },
  },
  {
    id: "cycling_road_seuil",
    name: "Seuil",
    sport: "cycling_road",
    sessionType: "seuil",
    distanceRange: { min: 25, default: 50, max: 100 },
    elevationRange: { min: 100, default: 400, max: 1000 },
    distancePresets: [25, 40, 60, 80],
    elevationPresets: [100, 400, 700, 1000],
    description: "Effort au seuil, puissance élevée maintenue. Routes régulières et calmes.",
    graphhopperProfile: "bike",
    orsProfile: "cycling-road",
    weights: {
      elevationMatch: 0.20,
      distanceMatch: 0.40,
      surfaceQuality: 0.30,
      loopQuality: 0.10,
    },
  },
  {
    id: "cycling_road_intervals",
    name: "Intervals",
    sport: "cycling_road",
    sessionType: "intervals",
    distanceRange: { min: 20, default: 40, max: 80 },
    elevationRange: { min: 0, default: 150, max: 400 },
    distancePresets: [20, 30, 40, 60],
    elevationPresets: [0, 150, 300, 400],
    description: "Intervalles haute intensité. Terrain légèrement vallonné, bonne surface.",
    graphhopperProfile: "bike",
    orsProfile: "cycling-road",
    weights: {
      elevationMatch: 0.10,
      distanceMatch: 0.50,
      surfaceQuality: 0.30,
      loopQuality: 0.10,
    },
  },
  {
    id: "cycling_road_gran_fondo",
    name: "Gran Fondo",
    sport: "cycling_road",
    sessionType: "gran_fondo",
    distanceRange: { min: 80, default: 130, max: 250 },
    elevationRange: { min: 1000, default: 2000, max: 5000 },
    distancePresets: [80, 100, 130, 180, 250],
    elevationPresets: [1000, 2000, 3500, 5000],
    description: "Longue sortie avec dénivelé significatif. Routes de campagne panoramiques.",
    graphhopperProfile: "bike",
    orsProfile: "cycling-road",
    weights: {
      elevationMatch: 0.35,
      distanceMatch: 0.30,
      surfaceQuality: 0.25,
      loopQuality: 0.10,
    },
  },
  {
    id: "cycling_road_recuperation",
    name: "Récupération",
    sport: "cycling_road",
    sessionType: "recuperation",
    distanceRange: { min: 15, default: 30, max: 60 },
    elevationRange: { min: 0, default: 100, max: 300 },
    distancePresets: [15, 25, 40, 60],
    elevationPresets: [0, 100, 200, 300],
    description: "Pédalage facile de récupération. Routes plates et tranquilles, effort minimal.",
    graphhopperProfile: "bike",
    orsProfile: "cycling-road",
    weights: {
      elevationMatch: 0.10,
      distanceMatch: 0.30,
      surfaceQuality: 0.45,
      loopQuality: 0.15,
    },
  },

  // ─── CYCLING GRAVEL ─────────────────────────────────────────────────────────
  // orsProfile: "cycling-regular" → ORS équilibré routes/chemins, idéal gravel
  {
    id: "cycling_gravel_endurance",
    name: "Endurance Gravel",
    sport: "cycling_gravel",
    sessionType: "endurance",
    distanceRange: { min: 40, default: 80, max: 180 },
    elevationRange: { min: 300, default: 900, max: 3000 },
    distancePresets: [40, 60, 80, 120],
    elevationPresets: [300, 900, 1500, 3000],
    description: "Aventure mixte routes et chemins. Dénivelé modéré à significatif.",
    graphhopperProfile: "bike",
    orsProfile: "cycling-regular",
    weights: {
      elevationMatch: 0.25,
      distanceMatch: 0.25,
      surfaceQuality: 0.35,
      loopQuality: 0.15,
    },
  },
  {
    id: "cycling_gravel_gran_fondo",
    name: "Gran Fondo Gravel",
    sport: "cycling_gravel",
    sessionType: "gran_fondo",
    distanceRange: { min: 100, default: 160, max: 300 },
    elevationRange: { min: 1500, default: 3000, max: 6000 },
    distancePresets: [100, 130, 160, 200],
    elevationPresets: [1500, 3000, 4500, 6000],
    description: "Longue aventure tout-terrain avec fort dénivelé.",
    graphhopperProfile: "bike",
    orsProfile: "cycling-regular",
    weights: {
      elevationMatch: 0.30,
      distanceMatch: 0.25,
      surfaceQuality: 0.35,
      loopQuality: 0.10,
    },
  },

  // ─── CYCLING MTB ────────────────────────────────────────────────────────────
  // orsProfile: "cycling-mountain" → ORS préfère activement sentiers, pistes, hors-route
  {
    id: "cycling_mtb_endurance",
    name: "Endurance VTT",
    sport: "cycling_mtb",
    sessionType: "endurance",
    distanceRange: { min: 15, default: 30, max: 80 },
    elevationRange: { min: 300, default: 800, max: 2500 },
    distancePresets: [15, 25, 35, 50],
    elevationPresets: [300, 800, 1500, 2500],
    description: "Sortie VTT technique sur sentiers et pistes forestières. Dénivelé important.",
    graphhopperProfile: "bike",
    orsProfile: "cycling-mountain",
    weights: {
      elevationMatch: 0.25,
      distanceMatch: 0.20,
      surfaceQuality: 0.45,
      loopQuality: 0.10,
    },
  },
  {
    id: "cycling_mtb_intervals",
    name: "Intervals VTT",
    sport: "cycling_mtb",
    sessionType: "intervals",
    distanceRange: { min: 10, default: 20, max: 40 },
    elevationRange: { min: 200, default: 500, max: 1500 },
    distancePresets: [10, 15, 20, 30],
    elevationPresets: [200, 500, 1000, 1500],
    description: "Montées répétées en sentiers techniques. Effort intense et récupération.",
    graphhopperProfile: "bike",
    orsProfile: "cycling-mountain",
    weights: {
      elevationMatch: 0.30,
      distanceMatch: 0.15,
      surfaceQuality: 0.45,
      loopQuality: 0.10,
    },
  },
];

/**
 * O(1) profile lookup by ID.
 *
 * @example
 * const profile = PROFILES_BY_ID.get("running_endurance");
 * // profile.distanceRange.default → 14
 */
export const PROFILES_BY_ID = new Map<string, SessionProfile>(
  SESSION_PROFILES.map((p) => [p.id, p])
);

/**
 * Profiles grouped by sport, preserving the original declaration order.
 * Used by the UI to render session-type chips per selected sport.
 *
 * @example
 * const runningProfiles = PROFILES_BY_SPORT["running"];
 * // [endurance, seuil, intervals_30_30, sortie_longue, recuperation]
 */
export const PROFILES_BY_SPORT: Record<Sport, SessionProfile[]> =
  SESSION_PROFILES.reduce(
    (acc, profile) => {
      if (!acc[profile.sport]) acc[profile.sport] = [];
      acc[profile.sport].push(profile);
      return acc;
    },
    {} as Record<Sport, SessionProfile[]>
  );

/**
 * French display labels for each sport, shown in the sport selector grid.
 */
export const SPORT_LABELS: Record<Sport, string> = {
  running: "Course à pied",
  cycling_road: "Vélo Route",
  cycling_gravel: "Gravel",
  cycling_mtb: "VTT",
};
