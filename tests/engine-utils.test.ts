import { describe, it, expect } from "vitest";
import {
  haversineKm,
  computeAscent,
  computeLoopScore,
  scoreRoute,
  PAVED_SURFACES,
  UNPAVED_SURFACES,
  QUIET_HIGHWAY_TYPES,
  BUSY_HIGHWAY_TYPES,
  TRAIL_HIGHWAY_TYPES,
} from "../lib/engine/utils";

describe("haversineKm", () => {
  it("returns 0 for same point", () => {
    const p = { lat: 48.8566, lng: 2.3522 };
    expect(haversineKm(p, p)).toBe(0);
  });
  it("calculates Paris to Lyon ~390km", () => {
    const paris = { lat: 48.8566, lng: 2.3522 };
    const lyon = { lat: 45.764, lng: 4.8357 };
    const d = haversineKm(paris, lyon);
    expect(d).toBeGreaterThan(380);
    expect(d).toBeLessThan(400);
  });
});

describe("computeAscent", () => {
  it("computes ascent and descent", () => {
    const elevations = [100, 150, 120, 200];
    const result = computeAscent(elevations);
    expect(result.ascendM).toBe(130);
    expect(result.descendM).toBe(30);
  });
  it("returns zero for flat", () => {
    const result = computeAscent([100, 100, 100]);
    expect(result.ascendM).toBe(0);
    expect(result.descendM).toBe(0);
  });
});

describe("computeLoopScore", () => {
  it("returns 1.0 for perfect loop", () => {
    const start = { lat: 48.8566, lng: 2.3522 };
    const points = [
      { lat: 48.86, lng: 2.36 },
      { lat: 48.8566, lng: 2.3522 },
    ];
    expect(computeLoopScore(points, start)).toBeCloseTo(1.0, 1);
  });
});

describe("constants", () => {
  it("PAVED_SURFACES contains asphalt", () => {
    expect(PAVED_SURFACES.has("asphalt")).toBe(true);
  });
  it("TRAIL_HIGHWAY_TYPES contains path", () => {
    expect(TRAIL_HIGHWAY_TYPES.has("path")).toBe(true);
  });
});
