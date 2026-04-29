import { describe, expect, it } from "vitest";
import {
  buildMeasuredEngineTuningPlan,
  type EngineMeasurementInput,
} from "@/lib/engine-measurement";

describe("measured engine improvement", () => {
  it("prioritizes fixes from benchmark and feedback evidence", () => {
    const plan = buildMeasuredEngineTuningPlan({
      benchmarkSummaries: [
        { id: "paris", failures: ["busy_road_ratio", "natural_way_ratio"], passed: false },
        { id: "lille", failures: ["distance_tolerance"], passed: false },
      ],
      feedbackInsights: {
        total: 12,
        topReasons: [
          { reason: "too_much_busy_road", count: 5, ratio: 0.42 },
          { reason: "not_enough_nature", count: 4, ratio: 0.33 },
        ],
      },
    } as EngineMeasurementInput);

    expect(plan.readyForSolverChange).toBe(true);
    expect(plan.priorities[0].id).toBe("reduce_busy_roads");
    expect(plan.priorities[0].evidence.length).toBeGreaterThanOrEqual(2);
    expect(plan.guardrails).toContain("npm run benchmark:routes");
  });

  it("blocks solver changes when there is not enough evidence", () => {
    const plan = buildMeasuredEngineTuningPlan({
      benchmarkSummaries: [],
      feedbackInsights: { total: 0, topReasons: [] },
    } as unknown as EngineMeasurementInput);

    expect(plan.readyForSolverChange).toBe(false);
    expect(plan.priorities[0].id).toBe("collect_more_evidence");
  });
});
