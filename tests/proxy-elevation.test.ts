import { describe, it, expect } from "vitest";
import { validateBody } from "../app/api/proxy/elevation/route";

describe("Elevation proxy validation", () => {
  it("rejects empty coordinates", () => {
    expect(() => validateBody({ coordinates: [] })).toThrow("coordinates array required");
  });
  it("rejects > 500 coordinates", () => {
    const coords = Array(501).fill({ lat: 48.73, lng: -0.09 });
    expect(() => validateBody({ coordinates: coords })).toThrow("Max 500");
  });
  it("rejects missing coordinates field", () => {
    expect(() => validateBody({})).toThrow();
  });
  it("accepts valid coordinates", () => {
    const result = validateBody({ coordinates: [{ lat: 48.73, lng: -0.09 }] });
    expect(result).toHaveLength(1);
    expect(result[0].lat).toBe(48.73);
  });
});
