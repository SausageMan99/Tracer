import { describe, expect, it } from "vitest";
import { translateQualityWarning } from "@/lib/route-quality-copy";

describe("route quality copy", () => {
  it("turns machine warning codes into user-facing French compromise labels", () => {
    expect(translateQualityWarning("TOO_MUCH_BUSY_ROAD")?.label).toBe("Trop de grands axes");
    expect(translateQualityWarning("DISTANCE_OFF_TARGET")?.description).toContain("distance demandée");
  });

  it("does not expose unknown technical warning codes", () => {
    expect(translateQualityWarning("INTERNAL_DEBUG_ONLY")).toBeNull();
  });
});
