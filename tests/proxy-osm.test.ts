import { describe, it, expect } from "vitest";
import { validateParams } from "../lib/utils/proxy-validators";

describe("OSM proxy validation", () => {
  it("rejects missing lat param", () => {
    const params = new URLSearchParams("lng=-0.09&radius=5.6");
    expect(() => validateParams(params)).toThrow("Missing params");
  });
  it("rejects radius > 25", () => {
    const params = new URLSearchParams("lat=48.73&lng=-0.09&radius=30");
    expect(() => validateParams(params)).toThrow("Radius too large");
  });
  it("rejects radius < 0.5", () => {
    const params = new URLSearchParams("lat=48.73&lng=-0.09&radius=0.1");
    expect(() => validateParams(params)).toThrow("Radius too small");
  });
  it("accepts valid params", () => {
    const params = new URLSearchParams("lat=48.73&lng=-0.09&radius=5.6");
    const result = validateParams(params);
    expect(result).toEqual({ lat: 48.73, lng: -0.09, radius: 5.6 });
  });
});
