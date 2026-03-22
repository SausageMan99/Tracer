import { describe, it, expect } from "vitest";
import { FREE_TIER, PRO_TIER } from "../lib/engine/tier-config";

describe("TierConfig presets", () => {
  it("free tier has 2 solver configs", () => {
    expect(FREE_TIER.solverConfigs).toHaveLength(2);
  });
  it("pro tier has 5 solver configs", () => {
    expect(PRO_TIER.solverConfigs).toHaveLength(5);
  });
  it("free tier disables full scenic", () => {
    expect(FREE_TIER.enableFullScenic).toBe(false);
  });
  it("pro tier enables full scenic", () => {
    expect(PRO_TIER.enableFullScenic).toBe(true);
  });
  it("free tier returns 1 candidate", () => {
    expect(FREE_TIER.maxCandidates).toBe(1);
  });
  it("pro tier returns 6 candidates", () => {
    expect(PRO_TIER.maxCandidates).toBe(6);
  });
});
