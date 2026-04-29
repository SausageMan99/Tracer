import type { GenerateRouteRequest } from "./types";

export interface RouteBenchmarkCase {
  id: string;
  label: string;
  address: string;
  profileId: string;
  targetDistanceKm: number;
  targetElevationM: number;
  scenicMode?: boolean;
  thresholds: {
    distanceToleranceRatio: number;
    elevationToleranceM: number;
    minProductionScore: number;
    maxLoopClosureKm: number;
    maxBusyRoadRatio: number;
    minNaturalWayRatio?: number;
  };
  notes: string;
}

export interface BenchmarkRouteSample {
  distanceKm: number;
  ascendM: number;
  quality?: {
    productionScore?: number;
    loopClosureKm?: number;
    busyRoadRatio?: number;
    naturalWayRatio?: number;
    warnings?: string[];
  };
}

export interface BenchmarkSummary {
  id: string;
  label: string;
  passed: boolean;
  failures: string[];
  metrics: {
    distanceErrorRatio: number;
    elevationErrorM: number;
    productionScore: number;
    loopClosureKm: number;
    busyRoadRatio: number;
    naturalWayRatio: number;
    warnings: string[];
  };
}

export const BENCHMARK_CASES: RouteBenchmarkCase[] = [
  {
    id: "lille-10k-citadel-loop",
    label: "Lille 10 km — boucle Citadelle/Deûle",
    address: "Grand Place, Lille",
    profileId: "running_endurance",
    targetDistanceKm: 10,
    targetElevationM: 80,
    scenicMode: true,
    thresholds: {
      distanceToleranceRatio: 0.08,
      elevationToleranceM: 90,
      minProductionScore: 0.72,
      maxLoopClosureKm: 0.3,
      maxBusyRoadRatio: 0.12,
      minNaturalWayRatio: 0.2,
    },
    notes: "Cas Reddit critique : éviter une trace 7–8 km et favoriser Citadelle/canal plutôt que centre dense.",
  },
  {
    id: "paris-19-canal-running",
    label: "Paris 19e 10 km — canal/Buttes-Chaumont",
    address: "Place de la Bataille de Stalingrad, Paris",
    profileId: "running_endurance",
    targetDistanceKm: 10,
    targetElevationM: 100,
    scenicMode: true,
    thresholds: {
      distanceToleranceRatio: 0.08,
      elevationToleranceM: 100,
      minProductionScore: 0.74,
      maxLoopClosureKm: 0.35,
      maxBusyRoadRatio: 0.1,
      minNaturalWayRatio: 0.25,
    },
    notes: "Doit capter canal/parks et éviter un parcours haché par trop d'intersections.",
  },
  {
    id: "paris-centre-5k-safety",
    label: "Paris centre 5 km — sécurité urbaine",
    address: "Hôtel de Ville, Paris",
    profileId: "running_recuperation",
    targetDistanceKm: 5,
    targetElevationM: 20,
    scenicMode: true,
    thresholds: {
      distanceToleranceRatio: 0.1,
      elevationToleranceM: 60,
      minProductionScore: 0.68,
      maxLoopClosureKm: 0.25,
      maxBusyRoadRatio: 0.08,
      minNaturalWayRatio: 0.1,
    },
    notes: "Zone dense : mieux vaut refuser/faiblement scorer qu'envoyer sur grands axes.",
  },
  {
    id: "dijon-hilly-running",
    label: "Dijon 12 km — D+ réaliste",
    address: "Place Darcy, Dijon",
    profileId: "running_endurance",
    targetDistanceKm: 12,
    targetElevationM: 250,
    scenicMode: true,
    thresholds: {
      distanceToleranceRatio: 0.1,
      elevationToleranceM: 120,
      minProductionScore: 0.7,
      maxLoopClosureKm: 0.4,
      maxBusyRoadRatio: 0.12,
      minNaturalWayRatio: 0.18,
    },
    notes: "Cas D+ : éviter les promesses impossibles et rester proche du dénivelé demandé.",
  },
  {
    id: "nanterre-east-avoid-highways",
    label: "Nanterre vers est — éviter grands axes",
    address: "Nanterre Université",
    profileId: "running_endurance",
    targetDistanceKm: 10,
    targetElevationM: 80,
    scenicMode: true,
    thresholds: {
      distanceToleranceRatio: 0.1,
      elevationToleranceM: 100,
      minProductionScore: 0.7,
      maxLoopClosureKm: 0.4,
      maxBusyRoadRatio: 0.1,
      minNaturalWayRatio: 0.12,
    },
    notes: "Régression type : ne pas optimiser vers des axes routiers rapides juste parce que le graphe est facile.",
  },
  {
    id: "rennes-saint-malo-road-bike",
    label: "Rennes 70 km route — direction Saint-Malo",
    address: "Place Sainte-Anne, Rennes",
    profileId: "cycling_road_endurance",
    targetDistanceKm: 70,
    targetElevationM: 500,
    thresholds: {
      distanceToleranceRatio: 0.12,
      elevationToleranceM: 220,
      minProductionScore: 0.68,
      maxLoopClosureKm: 1.5,
      maxBusyRoadRatio: 0.14,
    },
    notes: "Cas vélo route long : tolérance distance un peu plus large, mais sécurité routière prioritaire.",
  },
  {
    id: "mtb-40k-oneway-safety",
    label: "VTT 40 km — sécurité sens interdits",
    address: "Forêt de Meudon, Chaville",
    profileId: "cycling_mtb_endurance",
    targetDistanceKm: 40,
    targetElevationM: 800,
    scenicMode: true,
    thresholds: {
      distanceToleranceRatio: 0.12,
      elevationToleranceM: 250,
      minProductionScore: 0.72,
      maxLoopClosureKm: 1,
      maxBusyRoadRatio: 0.08,
      minNaturalWayRatio: 0.35,
    },
    notes: "Cas Reddit VTT : zéro tolérance implicite sur les incohérences de sécurité/sens de circulation.",
  },
];

export function benchmarkToRequest(benchmark: RouteBenchmarkCase): GenerateRouteRequest {
  return {
    address: benchmark.address,
    profileId: benchmark.profileId,
    targetDistanceKm: benchmark.targetDistanceKm,
    targetElevationM: benchmark.targetElevationM,
    scenicMode: benchmark.scenicMode,
  };
}

export function summarizeBenchmarkResult(
  benchmark: RouteBenchmarkCase,
  route: BenchmarkRouteSample
): BenchmarkSummary {
  const quality = route.quality ?? {};
  const distanceErrorRatio = Math.abs(route.distanceKm - benchmark.targetDistanceKm) / benchmark.targetDistanceKm;
  const elevationErrorM = Math.abs(route.ascendM - benchmark.targetElevationM);
  const productionScore = quality.productionScore ?? 0;
  const loopClosureKm = quality.loopClosureKm ?? Number.POSITIVE_INFINITY;
  const busyRoadRatio = quality.busyRoadRatio ?? 1;
  const naturalWayRatio = quality.naturalWayRatio ?? 0;
  const warnings = quality.warnings ?? [];

  const failures: string[] = [];

  if (distanceErrorRatio > benchmark.thresholds.distanceToleranceRatio) {
    failures.push("distance_tolerance");
  }
  if (elevationErrorM > benchmark.thresholds.elevationToleranceM) {
    failures.push("elevation_tolerance");
  }
  if (productionScore < benchmark.thresholds.minProductionScore) {
    failures.push("production_score");
  }
  if (loopClosureKm > benchmark.thresholds.maxLoopClosureKm) {
    failures.push("loop_closure");
  }
  if (busyRoadRatio > benchmark.thresholds.maxBusyRoadRatio) {
    failures.push("busy_road_ratio");
  }
  if (
    benchmark.thresholds.minNaturalWayRatio !== undefined &&
    naturalWayRatio < benchmark.thresholds.minNaturalWayRatio
  ) {
    failures.push("natural_way_ratio");
  }
  if (warnings.includes("ONEWAY_VIOLATION")) {
    failures.push("oneway_violation");
  }

  return {
    id: benchmark.id,
    label: benchmark.label,
    passed: failures.length === 0,
    failures,
    metrics: {
      distanceErrorRatio,
      elevationErrorM,
      productionScore,
      loopClosureKm,
      busyRoadRatio,
      naturalWayRatio,
      warnings,
    },
  };
}
