import type {
  Coordinate,
  EnrichedGraph,
  SessionProfile,
  SessionWeights,
} from "../types";
import {
  fetchElevations,
  PAVED_SURFACES,
  UNPAVED_SURFACES,
  QUIET_HIGHWAY_TYPES,
  BUSY_HIGHWAY_TYPES,
  TRAIL_HIGHWAY_TYPES,
} from "../route-generator-legacy";

export function deriveWeights(profile: SessionProfile, scenicMode?: boolean): SessionWeights {
  const { sport, sessionType } = profile;

  // Base weights by sport
  const base: SessionWeights = { surface: 0.3, elevation: 0.15, nature: 0.25, quietness: 0.3 };

  if (sport === "running") {
    base.surface = 0.3;
    base.quietness = 0.3;
    base.nature = 0.25;
    base.elevation = 0.15;
  } else if (sport === "cycling_road") {
    base.surface = 0.35;
    base.quietness = 0.35;
    base.nature = 0.1;
    base.elevation = 0.2;
  } else if (sport === "cycling_gravel") {
    base.surface = 0.25;
    base.quietness = 0.2;
    base.nature = 0.35;
    base.elevation = 0.2;
  } else if (sport === "cycling_mtb") {
    base.surface = 0.15;
    base.quietness = 0.15;
    base.nature = 0.4;
    base.elevation = 0.3;
  }

  // Intensity adjustments
  if (sessionType === "intervals_30_30" || sessionType === "intervals") {
    base.elevation = 0.05;
    base.surface += 0.1;
  } else if (sessionType === "gran_fondo" || sessionType === "sortie_longue") {
    base.elevation = 0.3;
    base.nature += 0.05;
  } else if (sessionType === "recuperation") {
    base.elevation = 0.05;
    base.quietness += 0.1;
  }

  // Scenic mode: boost nature & quietness, reduce surface & elevation
  if (scenicMode) {
    base.nature += 0.15;
    base.quietness += 0.05;
    base.surface -= 0.1;
    base.elevation -= 0.1;
    // Clamp to minimum 0.05
    base.surface = Math.max(0.05, base.surface);
    base.elevation = Math.max(0.05, base.elevation);
  }

  // Normalize to sum = 1
  const sum = base.surface + base.elevation + base.nature + base.quietness;
  base.surface /= sum;
  base.elevation /= sum;
  base.nature /= sum;
  base.quietness /= sum;

  return base;
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

function scoreNature(osmWayId: number, scenicWayIds: Set<string>): number {
  return scenicWayIds.has(String(osmWayId)) ? 1.0 : 0.3;
}

function scoreSafety(lit?: string, access?: string): number {
  // Penalize private/restricted access
  if (access === "private" || access === "no") return 0.0;

  // Lighting score blended into quietness
  if (lit === "yes") return 1.0;
  if (lit === "no") return 0.3;
  return 0.5; // unknown
}

export async function scoreEdges(
  graph: EnrichedGraph,
  weights: SessionWeights,
  profile: SessionProfile,
  scenicWayIds: Set<string>
): Promise<{ nodeElevation: Map<string, number> }> {
  // Fetch elevations for all unique nodes
  const nodeIds = Array.from(graph.nodes.keys());
  const coords: Coordinate[] = nodeIds.map((id) => {
    const n = graph.nodes.get(id)!;
    return { lat: n.lat, lng: n.lng };
  });

  let elevations: number[];
  try {
    elevations = await fetchElevations(coords);
  } catch {
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
    const safetyScore = scoreSafety(edge.lit, edge.access);
    const quietnessScore = scoreQuietness(edge.highway) * 0.7 + safetyScore * 0.3;
    const natureScore = scoreNature(edge.osmWayId, scenicWayIds);

    // Elevation score: based on gradient
    const fromElev = nodeElevation.get(edge.from) ?? 0;
    const toElev = nodeElevation.get(edge.to) ?? 0;
    const gradient = edge.lengthKm > 0.001
      ? Math.abs(toElev - fromElev) / (edge.lengthKm * 1000)
      : 0;

    let elevScore: number;
    if (prefersFlat) {
      // Prefer flat: penalize steep gradients
      elevScore = Math.max(0, 1 - gradient * 10);
    } else if (prefersClimbs) {
      // Prefer moderate climbs (3-8% gradient is ideal)
      if (gradient < 0.03) elevScore = 0.4 + gradient * 10;
      else if (gradient <= 0.08) elevScore = 1.0;
      else elevScore = Math.max(0.2, 1 - (gradient - 0.08) * 5);
    } else {
      // Endurance: moderate preference, peaks around 3-5%
      if (gradient < 0.02) elevScore = 0.6;
      else if (gradient <= 0.05) elevScore = 0.9;
      else elevScore = Math.max(0.3, 1 - (gradient - 0.05) * 5);
    }

    edge.score =
      weights.surface * surfaceScore +
      weights.elevation * elevScore +
      weights.nature * natureScore +
      weights.quietness * quietnessScore;
  }

  return { nodeElevation };
}
