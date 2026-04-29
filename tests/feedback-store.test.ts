import { beforeEach, describe, expect, it, vi } from "vitest";
import { saveFeedback, type RouteFeedback } from "@/lib/feedback-store";

const baseFeedback: RouteFeedback = {
  id: "feedback-1",
  timestamp: 1,
  rating: "negative",
  reasons: ["too_much_busy_road", "not_enough_nature"],
  sessionType: "endurance",
  sport: "running",
  mode: "SCENIC",
  requestedDistanceKm: 10,
  requestedElevationM: 100,
  actualDistanceKm: 8.8,
  actualElevationM: 80,
  algorithmicScore: 0.71,
  distanceErrorPct: 12,
  elevationErrorPct: 20,
};

describe("feedback-store", () => {
  beforeEach(() => {
    localStorage.clear();
    vi.stubGlobal("fetch", vi.fn(() => Promise.resolve(new Response(null, { status: 200 }))));
  });

  it("persists structured reason codes locally and sends them to the API", () => {
    saveFeedback(baseFeedback);

    const stored = JSON.parse(localStorage.getItem("trailforge-feedbacks") ?? "[]");
    expect(stored).toHaveLength(1);
    expect(stored[0].reasons).toEqual(["too_much_busy_road", "not_enough_nature"]);

    expect(fetch).toHaveBeenCalledWith("/api/feedback", expect.objectContaining({
      method: "POST",
      body: expect.stringContaining("too_much_busy_road"),
    }));
  });
});
