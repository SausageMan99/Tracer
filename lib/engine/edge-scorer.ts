import type {
  Coordinate,
  EnrichedGraph,
  SessionProfile,
  SessionWeights,
} from "../types";
import {
  PAVED_SURFACES,
  UNPAVED_SURFACES,
  QUIET_HIGHWAY_TYPES,
  BUSY_HIGHWAY_TYPES,
  TRAIL_HIGHWAY_TYPES,
} from "./utils";
import type { DataFetcher } from "./adapters/data-fetcher";

export function deriveWeights(
  profile: SessionProfile,
  scenicMode?: boolean,
  enableFullScenic: boolean = true
): SessionWeights {
  const { sport, sessionType } = profile;

  // Base weights by sport
  let w: SessionWeights = { surface: 0.3, elevation: 0.15, nature: 0.25, quietness: 0.3 };

  if (sport === "cycling_road") {
    w = { surface: 0.35, elevation: 0.2, nature: 0.1, quietness: 0.35 };
  } else if (sport === "cycling_gravel") {
    w = { surface: 0.25, elevation: 0.2, nature: 0.35, quietness: 0.2 };
  } else if (sport === "cycling_mtb") {
    w = { surface: 0.15, elevation: 0.3, nature: 0.4, quietness: 0.15 };
  }

  // Intensity adjustments (immutable spreads)
  if (sessionType === "intervals_30_30" || sessionType === "intervals") {
    w = { ...w, elevation: 0.05, surface: w.surface + 0.1 };
  } else if (sessionType === "gran_fondo" || sessionType === "sortie_longue") {
    w = { ...w, elevation: 0.3, nature: w.nature + 0.05 };
  } else if (sessionType === "recuperation") {
    w = { ...w, elevation: 0.05, quietness: w.quietness + 0.1 };
  }

  // Scenic mode: boost nature & quietness, reduce surface & elevation
  if (scenicMode) {
    w = {
      surface: Math.max(0.05, w.surface - 0.1),
      elevation: Math.max(0.05, w.elevation - 0.1),
      nature: w.nature + 0.15,
      quietness: w.quietness + 0.05,
    };
  }

  // When full scenic is disabled, zero out quietness and redistribute proportionally
  if (!enableFullScenic) {
    const redistributed = w.surface + w.elevation + w.nature;
    const scaleFactor = redistributed > 0 ? (redistributed + w.quietness) / redistributed : 1;
    w = {
      surface: w.surface * scaleFactor,
      elevation: w.elevation * scaleFactor,
      nature: w.nature * scaleFactor,
      quietness: 0,
    };
  }

  // Normalize to sum = 1
  const sum = w.surface + w.elevation + w.nature + w.quietness;
  return {
    surface: w.surface / sum,
    elevation: w.elevation / sum,
    nature: w.nature / sum,
    quietness: w.quietness / sum,
  };
}

function scoreSurface(surface: string | undefined, sport: string): number {
  if (!surface) return 0.5;
  const isPaved = PAVED_SURFACES.has(surface);
  const isUnpaved = UNPAVED_SURFACES.has(surface);

  if (sport === "cycling_mtb") {
    if (isUnpaved) return 1.0;
    if (isPaved) return 0.3;
    return 0.5;
  }
  if (sport === "cycling_gravel") {
    // Gravel prefers a mix — both are good
    if (isUnpaved) return 0.8;
    if (isPaved) return 0.7;
    return 0.5;
  }
  // Running and road cycling prefer paved
  if (isPaved) return 1.0;
  if (isUnpaved) return 0.3;
  return 0.5;
}

function scoreQuietness(highway: string): number {
  if (TRAIL_HIGHWAY_TYPES.has(highway)) return 1.0;
  if (QUIET_HIGHWAY_TYPES.has(highway)) return 0.8;
  if (BUSY_HIGHWAY_TYPES.has(highway)) return 0.1;
  return 0.5;
}

const NATURE_AFFINITY: Readonly<Record<string, number>> = {
  path: 0.8,
  track: 0.7,
  bridleway: 0.75,
  footway: 0.6,
  cycleway: 0.5,
  pedestrian: 0.4,
  living_street: 0.35,
  residential: 0.2,
  service: 0.15,
  unclassified: 0.25,
  tertiary: 0.15,
  secondary: 0.1,
};

function scoreNature(
  osmWayId: number,
  highway: string,
  scenicWayIds: Set<string>
): number {
  const affinityScore = NATURE_AFFINITY[highway] ?? 0.3;
  const isScenic = scenicWayIds.has(String(osmWayId));

  // Blend: scenic detection (60%) + highway affinity (40%)
  return isScenic ? 1.0 * 0.6 + affinityScore * 0.4 : affinityScore;
}

export async function scoreEdges(
  graph: EnrichedGraph,
  weights: SessionWeights,
  profile: SessionProfile,
  scenicWayIds: Set<string>,
  fetcher: DataFetcher,
  enableFullScenic: boolean = true
): Promise<{ nodeElevation: Map<string, number> }> {
  // Fetch elevations for all unique nodes
  const nodeIds = Array.from(graph.nodes.keys());
  const coords: Coordinate[] = nodeIds.map((id) => {
    const n = graph.nodes.get(id)!;
    return { lat: n.lat, lng: n.lng };
  });

  let elevations: number[];
  try {
    elevations = await fetcher.fetchElevations(coords);
  } catch (err) {
    console.warn(
      "[edge-scorer] Elevation API failed, defaulting all elevations to 0:",
      err instanceof Error ? err.message : err
    );
    elevations = coords.map(() => 0);
  }

  const nodeElevation = new Map<string, number>();
  for (let i = 0; i < nodeIds.length; i++) {
    nodeElevation.set(nodeIds[i], elevations[i] ?? 0);
  }

  // Determine preferred gradient based on profile intensity
  const prefersFlat =
    profile.sessionType === "intervals_30_30" ||
    profile.sessionType === "intervals" ||
    profile.sessionType === "recuperation";
  const prefersClimbs =
    profile.sessionType === "gran_fondo" || profile.sessionType === "sortie_longue";

  // Score each edge
  for (const edge of graph.edges.values()) {
    // Skip private/restricted access edges entirely
    if (edge.access === "private" || edge.access === "no") {
      edge.score = 0;
      continue;
    }

    const surfaceScore = scoreSurface(edge.surface, profile.sport);
    const quietnessScore = scoreQuietness(edge.highway);
    const natureScore = scoreNature(edge.osmWayId, edge.highway, scenicWayIds);
    const litBonus = enableFullScenic && edge.lit === "yes" ? 0.05 : 0;

    // Elevation score: based on gradient
    const fromElev = nodeElevation.get(edge.from) ?? 0;
    const toElev = nodeElevation.get(edge.to) ?? 0;
    const gradient = edge.lengthKm > 0.001
      ? Math.abs(toElev - fromElev) / (edge.lengthKm * 1000)
      : 0;

    let elevScore: number;
    if (prefersFlat) {
      // Prefer flat: penalize steep gradients (already smooth)
      elevScore = Math.max(0, 1 - gradient * 10);
    } else if (prefersClimbs) {
      // Smooth Gaussian bump centered at 5.5%, ideal range ~3-8%
      const idealCenter = 0.055;
      const idealWidth = 0.035;
      const deviation = Math.abs(gradient - idealCenter) / idealWidth;
      elevScore = Math.max(0.2, Math.exp(-0.5 * deviation * deviation));
    } else {
      // Endurance: smooth Gaussian bump centered at 3.5%, ideal range ~2-5%
      const idealCenter = 0.035;
      const idealWidth = 0.02;
      const deviation = Math.abs(gradient - idealCenter) / idealWidth;
      elevScore = Math.max(0.3, Math.exp(-0.5 * deviation * deviation));
    }

    edge.score =
      weights.surface * surfaceScore +
      weights.elevation * elevScore +
      weights.nature * natureScore +
      weights.quietness * quietnessScore +
      litBonus;
  }

  return { nodeElevation };
}
