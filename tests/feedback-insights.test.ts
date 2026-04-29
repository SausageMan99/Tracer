import { describe, expect, it } from "vitest";
import {
  buildFeedbackInsights,
  type FeedbackInsights,
} from "@/lib/feedback-insights";
import type { RouteFeedback } from "@/lib/feedback-store";

function feedback(overrides: Partial<RouteFeedback>): RouteFeedback {
  return {
    id: crypto.randomUUID(),
    timestamp: Date.now(),
    rating: "negative",
    reasons: ["too_much_busy_road"],
    sessionType: "endurance",
    sport: "running",
    mode: "SCENIC",
    requestedDistanceKm: 10,
    requestedElevationM: 100,
    actualDistanceKm: 8.8,
    actualElevationM: 80,
    algorithmicScore: 0.7,
    distanceErrorPct: 12,
    elevationErrorPct: 20,
    ...overrides,
  };
}

describe("feedback insights", () => {
  it("summarizes feedback into actionable product signals", () => {
    const insights: FeedbackInsights = buildFeedbackInsights([
      feedback({ rating: "negative", reasons: ["too_much_busy_road", "not_enough_nature"], sport: "running" }),
      feedback({ rating: "negative", reasons: ["too_much_busy_road"], sport: "running" }),
      feedback({ rating: "positive", reasons: [], sport: "cycling_gravel", algorithmicScore: 0.86 }),
    ]);

    expect(insights.total).toBe(3);
    expect(insights.negativeRate).toBeCloseTo(2 / 3, 3);
    expect(insights.topReasons[0]).toMatchObject({ reason: "too_much_busy_road", count: 2 });
    expect(insights.bySport.running.total).toBe(2);
    expect(insights.actions[0]).toContain("grands axes");
  });

  it("returns a stable empty dashboard when no feedback exists", () => {
    const insights = buildFeedbackInsights([]);

    expect(insights.total).toBe(0);
    expect(insights.positiveRate).toBe(0);
    expect(insights.topReasons).toEqual([]);
    expect(insights.actions).toContain("Pas encore assez de feedback pour arbitrer le moteur.");
  });
});
