import { describe, it, expect } from "vitest";
import { LIGHT_CONFIG, FULL_CONFIG } from "../lib/engine/solver-config";

describe("LIGHT_CONFIG", () => {
  it("has 2 solver configs", () => {
    expect(LIGHT_CONFIG.solverConfigs).toHaveLength(2);
  });
  it("seeds are 0° and 180°", () => {
    expect(LIGHT_CONFIG.solverConfigs[0].seedBearing).toBe(0);
    expect(LIGHT_CONFIG.solverConfigs[1].seedBearing).toBe(180);
  });
  it("maxIterations is 800", () => {
    expect(LIGHT_CONFIG.maxIterations).toBe(800);
  });
  it("maxCandidates is 2", () => {
    expect(LIGHT_CONFIG.maxCandidates).toBe(2);
  });
  it("deduplicationMode is jaccard", () => {
    expect(LIGHT_CONFIG.deduplicationMode).toBe("jaccard");
  });
  it("enableFullScenic is true", () => {
    expect(LIGHT_CONFIG.enableFullScenic).toBe(true);
  });
});

describe("FULL_CONFIG", () => {
  it("has 5 solver configs", () => {
    expect(FULL_CONFIG.solverConfigs).toHaveLength(5);
  });
  it("maxIterations is 2000", () => {
    expect(FULL_CONFIG.maxIterations).toBe(2000);
  });
  it("maxCandidates is 6", () => {
    expect(FULL_CONFIG.maxCandidates).toBe(6);
  });
  it("deduplicationMode is jaccard", () => {
    expect(FULL_CONFIG.deduplicationMode).toBe("jaccard");
  });
  it("enableFullScenic is true", () => {
    expect(FULL_CONFIG.enableFullScenic).toBe(true);
  });
});
