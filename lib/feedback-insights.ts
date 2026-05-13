import type { FeedbackReason } from "./feedback-reasons";
import type { RouteFeedback } from "./feedback-store";

export interface FeedbackBucket {
  total: number;
  positive: number;
  negative: number;
  positiveRate: number;
  negativeRate: number;
  avgAlgorithmicScore: number;
  avgDistanceErrorPct: number;
  avgElevationErrorPct: number | null;
}

export interface FeedbackReasonSummary {
  reason: FeedbackReason;
  count: number;
  ratio: number;
}

export interface FeedbackInsights {
  total: number;
  positive: number;
  negative: number;
  positiveRate: number;
  negativeRate: number;
  avgAlgorithmicScore: number;
  avgDistanceErrorPct: number;
  avgElevationErrorPct: number | null;
  topReasons: FeedbackReasonSummary[];
  bySport: Record<string, FeedbackBucket>;
  bySessionType: Record<string, FeedbackBucket>;
  actions: string[];
}

function average(values: number[]): number {
  if (values.length === 0) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function buildBucket(feedbacks: RouteFeedback[]): FeedbackBucket {
  const positive = feedbacks.filter((feedback) => feedback.rating === "positive").length;
  const negative = feedbacks.length - positive;
  const elevationErrors = feedbacks
    .map((feedback) => feedback.elevationErrorPct)
    .filter((value): value is number => typeof value === "number");

  return {
    total: feedbacks.length,
    positive,
    negative,
    positiveRate: feedbacks.length > 0 ? positive / feedbacks.length : 0,
    negativeRate: feedbacks.length > 0 ? negative / feedbacks.length : 0,
    avgAlgorithmicScore: average(feedbacks.map((feedback) => feedback.algorithmicScore).filter((value): value is number => typeof value === "number")),
    avgDistanceErrorPct: average(feedbacks.map((feedback) => feedback.distanceErrorPct).filter((value): value is number => typeof value === "number")),
    avgElevationErrorPct: elevationErrors.length > 0 ? average(elevationErrors) : null,
  };
}

function groupBy(feedbacks: RouteFeedback[], key: "sport" | "sessionType"): Record<string, FeedbackBucket> {
  const groups = feedbacks.reduce<Record<string, RouteFeedback[]>>((acc, feedback) => {
    const groupKey = feedback[key] || "unknown";
    acc[groupKey] = acc[groupKey] ?? [];
    acc[groupKey].push(feedback);
    return acc;
  }, {});

  return Object.fromEntries(
    Object.entries(groups).map(([groupKey, items]) => [groupKey, buildBucket(items)])
  );
}

function buildActions(args: {
  total: number;
  topReasons: FeedbackReasonSummary[];
  bucket: FeedbackBucket;
}): string[] {
  const { total, topReasons, bucket } = args;
  if (total === 0) return ["Pas encore assez de feedback pour arbitrer le moteur."];
  if (total < 5 && (topReasons[0]?.count ?? 0) < 2) {
    return ["Pas encore assez de feedback pour arbitrer le moteur."];
  }

  const actions: string[] = [];
  const topReason = topReasons[0]?.reason;

  if (topReason === "too_much_busy_road") {
    actions.push("Réduire les grands axes : augmenter le poids quietness/nature et durcir les seuils busyRoadRatio.");
  }
  if (topReason === "not_enough_nature") {
    actions.push("Augmenter la naturalité : favoriser chemins, parcs et surfaces non routières sur running/trail/gravel.");
  }
  if (topReason === "distance_off_target" || bucket.avgDistanceErrorPct > 12) {
    actions.push("Revoir la précision distance : pénaliser plus tôt les candidats hors tolérance.");
  }
  if (topReason === "elevation_off_target" || (bucket.avgElevationErrorPct ?? 0) > 30) {
    actions.push("Recalibrer le D+ : séparer zones plates impossibles et vrais échecs de scoring.");
  }
  if (topReason === "loop_not_clean") {
    actions.push("Renforcer la fermeture de boucle avant d'améliorer les variantes secondaires.");
  }

  return actions.length > 0 ? actions : ["Surveiller les retours : aucun problème dominant ne justifie un changement moteur risqué."];
}

export function buildFeedbackInsights(feedbacks: RouteFeedback[]): FeedbackInsights {
  const bucket = buildBucket(feedbacks);
  const reasonCounts = new Map<FeedbackReason, number>();

  for (const feedback of feedbacks) {
    for (const reason of feedback.reasons ?? []) {
      reasonCounts.set(reason, (reasonCounts.get(reason) ?? 0) + 1);
    }
  }

  const topReasons = Array.from(reasonCounts.entries())
    .map(([reason, count]) => ({
      reason,
      count,
      ratio: feedbacks.length > 0 ? count / feedbacks.length : 0,
    }))
    .sort((a, b) => b.count - a.count);

  return {
    ...bucket,
    topReasons,
    bySport: groupBy(feedbacks, "sport"),
    bySessionType: groupBy(feedbacks, "sessionType"),
    actions: buildActions({ total: feedbacks.length, topReasons, bucket }),
  };
}
