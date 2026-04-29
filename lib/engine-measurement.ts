import type { FeedbackInsights } from "./feedback-insights";

export interface MinimalBenchmarkSummary {
  id: string;
  passed: boolean;
  failures: string[];
}

export interface EngineMeasurementInput {
  benchmarkSummaries: MinimalBenchmarkSummary[];
  feedbackInsights: Pick<FeedbackInsights, "total" | "topReasons">;
}

export interface EngineTuningPriority {
  id:
    | "reduce_busy_roads"
    | "increase_nature"
    | "improve_distance_match"
    | "improve_elevation_match"
    | "improve_loop_closure"
    | "collect_more_evidence";
  title: string;
  evidence: string[];
  suggestedChange: string;
}

export interface EngineTuningPlan {
  readyForSolverChange: boolean;
  priorities: EngineTuningPriority[];
  guardrails: string[];
}

function addPriority(
  priorities: EngineTuningPriority[],
  priority: EngineTuningPriority
): void {
  if (!priorities.some((item) => item.id === priority.id)) priorities.push(priority);
}

export function buildMeasuredEngineTuningPlan(input: EngineMeasurementInput): EngineTuningPlan {
  const failedBenchmarks = input.benchmarkSummaries.filter((summary) => !summary.passed);
  const failures = new Set(failedBenchmarks.flatMap((summary) => summary.failures));
  const topReasonIds = new Set(input.feedbackInsights.topReasons.slice(0, 3).map((item) => item.reason));
  const hasEvidence = failedBenchmarks.length > 0 || input.feedbackInsights.total >= 10;

  if (!hasEvidence) {
    return {
      readyForSolverChange: false,
      priorities: [{
        id: "collect_more_evidence",
        title: "Collecter plus d'évidence",
        evidence: ["Benchmarks verts ou absents", "Volume feedback insuffisant"],
        suggestedChange: "Ne pas modifier le solver tant que benchmarks et feedbacks ne convergent pas.",
      }],
      guardrails: ["npm run test:run", "npm run lint", "npm run build", "npm run benchmark:routes"],
    };
  }

  const priorities: EngineTuningPriority[] = [];

  if (failures.has("busy_road_ratio") || topReasonIds.has("too_much_busy_road")) {
    addPriority(priorities, {
      id: "reduce_busy_roads",
      title: "Réduire les grands axes",
      evidence: [
        failures.has("busy_road_ratio") ? "Benchmark busy_road_ratio en échec" : "Benchmark grands axes OK",
        topReasonIds.has("too_much_busy_road") ? "Feedback dominant : trop de grands axes" : "Feedback non dominant",
      ],
      suggestedChange: "Augmenter quietness/nature et pénaliser BUSY_HIGHWAY_TYPES avant le solver.",
    });
  }

  if (failures.has("natural_way_ratio") || topReasonIds.has("not_enough_nature")) {
    addPriority(priorities, {
      id: "increase_nature",
      title: "Augmenter la naturalité",
      evidence: [
        failures.has("natural_way_ratio") ? "Benchmark natural_way_ratio en échec" : "Benchmark naturalité OK",
        topReasonIds.has("not_enough_nature") ? "Feedback dominant : pas assez de nature" : "Feedback non dominant",
      ],
      suggestedChange: "Favoriser TRAIL_HIGHWAY_TYPES, chemins et surfaces non routières selon l'intention.",
    });
  }

  if (failures.has("distance_tolerance") || topReasonIds.has("distance_off_target")) {
    addPriority(priorities, {
      id: "improve_distance_match",
      title: "Améliorer la précision distance",
      evidence: ["Écart distance observé dans benchmarks ou feedback"],
      suggestedChange: "Resserrer progressivement la tolérance solver sans réduire la diversité des candidats.",
    });
  }

  if (failures.has("elevation_tolerance") || topReasonIds.has("elevation_off_target")) {
    addPriority(priorities, {
      id: "improve_elevation_match",
      title: "Améliorer le respect du D+",
      evidence: ["Écart D+ observé dans benchmarks ou feedback"],
      suggestedChange: "Ajuster scoring gradient et exposer l'impossibilité terrain quand le relief local manque.",
    });
  }

  if (failures.has("loop_closure") || topReasonIds.has("loop_not_clean")) {
    addPriority(priorities, {
      id: "improve_loop_closure",
      title: "Renforcer la boucle",
      evidence: ["Fermeture de boucle insuffisante"],
      suggestedChange: "Durcir la pénalité loopGap avant de toucher aux optimisations avancées.",
    });
  }

  return {
    readyForSolverChange: priorities.length > 0,
    priorities: priorities.length > 0 ? priorities : [{
      id: "collect_more_evidence",
      title: "Aucun changement moteur prioritaire",
      evidence: ["Signaux dispersés"],
      suggestedChange: "Continuer la collecte avant modification risquée.",
    }],
    guardrails: ["npm run test:run", "npm run lint", "npm run build", "npm run benchmark:routes"],
  };
}
