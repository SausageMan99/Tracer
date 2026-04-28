import { describe, it, expect } from "vitest";
import { isHeavyRoute, HEAVY_DISTANCE_KM, HEAVY_ELEVATION_M } from "../lib/engine/dispatch-config";

describe("isHeavyRoute", () => {
  it("returns false for light distance and elevation", () => {
    expect(isHeavyRoute(10, 300)).toBe(false);
  });
  it("returns true when distance exceeds threshold", () => {
    expect(isHeavyRoute(HEAVY_DISTANCE_KM + 0.1, 0)).toBe(true);
  });
  it("returns true when elevation exceeds threshold", () => {
    expect(isHeavyRoute(10, HEAVY_ELEVATION_M + 1)).toBe(true);
  });
  it("returns true when both exceed thresholds", () => {
    expect(isHeavyRoute(30, 800)).toBe(true);
  });
  it("returns false at exactly the distance boundary", () => {
    expect(isHeavyRoute(HEAVY_DISTANCE_KM, 0)).toBe(false);
  });
  it("returns false at exactly the elevation boundary", () => {
    expect(isHeavyRoute(0, HEAVY_ELEVATION_M)).toBe(false);
  });
});
