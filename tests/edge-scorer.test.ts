import { describe, it, expect } from "vitest";
import { deriveWeights } from "@/lib/engine/edge-scorer";
import { PROFILES_BY_ID } from "@/lib/session-profiles";

describe("deriveWeights", () => {
  it("returns weights that sum to 1", () => {
    for (const profile of PROFILES_BY_ID.values()) {
      const w = deriveWeights(profile);
      const sum = w.surface + w.elevation + w.nature + w.quietness;
      expect(sum).toBeCloseTo(1.0, 5);
    }
  });

  it("returns weights summing to 1 in scenic mode", () => {
    for (const profile of PROFILES_BY_ID.values()) {
      const w = deriveWeights(profile, true);
      const sum = w.surface + w.elevation + w.nature + w.quietness;
      expect(sum).toBeCloseTo(1.0, 5);
    }
  });

  it("scenic mode boosts nature weight", () => {
    const profile = PROFILES_BY_ID.get("running_endurance")!;
    const normal = deriveWeights(profile, false);
    const scenic = deriveWeights(profile, true);
    expect(scenic.nature).toBeGreaterThan(normal.nature);
  });

  it("intervals profile reduces elevation weight", () => {
    const profile = PROFILES_BY_ID.get("running_intervals")!;
    const w = deriveWeights(profile);
    expect(w.elevation).toBeLessThan(0.1);
  });

  it("gran fondo profile increases elevation weight", () => {
    const profile = PROFILES_BY_ID.get("cycling_road_gran_fondo")!;
    const w = deriveWeights(profile);
    expect(w.elevation).toBeGreaterThan(0.2);
  });

  it("does not mutate the profile object", () => {
    const profile = PROFILES_BY_ID.get("running_endurance")!;
    const before = JSON.stringify(profile);
    deriveWeights(profile, true);
    expect(JSON.stringify(profile)).toBe(before);
  });

  it("all weights are positive", () => {
    for (const profile of PROFILES_BY_ID.values()) {
      for (const scenic of [false, true]) {
        const w = deriveWeights(profile, scenic);
        expect(w.surface).toBeGreaterThan(0);
        expect(w.elevation).toBeGreaterThan(0);
        expect(w.nature).toBeGreaterThan(0);
        expect(w.quietness).toBeGreaterThan(0);
      }
    }
  });
});
