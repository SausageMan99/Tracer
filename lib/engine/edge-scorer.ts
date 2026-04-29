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

function scoreNature(osmWayId: number, scenicWayIds: Set<string>, highway: string, surface: string | undefined): number {
  if (scenicWayIds.has(String(osmWayId))) return 1.0;
  if (TRAIL_HIGHWAY_TYPES.has(highway)) return 0.85;
  if (surface && UNPAVED_SURFACES.has(surface)) return 0.7;
  if (highway === "living_street" || highway === "pedestrian") return 0.55;
  return 0.25;
}

function scoreSafety(edge: { lit?: string; access?: string; foot?: string; bicycle?: string; onewayViolation?: boolean }, sport: string): number {
  // Never route through private/restricted access.
  if (edge.access === "private" || edge.access === "no") return 0.0;
  if (sport === "running" && edge.foot === "no") return 0.0;
  if (sport !== "running" && (edge.bicycle === "no" || edge.onewayViolation)) return 0.0;

  // Lighting score blended into quietness; unknown is neutral rather than fatal.
  if (edge.lit === "yes") return 1.0;
  if (edge.lit === "no") return 0.35;
  return 0.65;
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
    const safetyScore = scoreSafety(edge, profile.sport);
    const quietnessScore = scoreQuietness(edge.highway) * 0.7 + safetyScore * 0.3;
    const natureScore = scoreNature(edge.osmWayId, scenicWayIds, edge.highway, edge.surface);

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
