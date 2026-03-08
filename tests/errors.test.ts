import { describe, it, expect } from "vitest";
import { RouteGenerationError } from "@/lib/errors";

describe("RouteGenerationError", () => {
  it("carries code and subCode", () => {
    const err = new RouteGenerationError("NO_ROAD_NETWORK", { subCode: "EMPTY_GRAPH" });
    expect(err.code).toBe("NO_ROAD_NETWORK");
    expect(err.subCode).toBe("EMPTY_GRAPH");
    expect(err.message).toBe("NO_ROAD_NETWORK:EMPTY_GRAPH");
    expect(err).toBeInstanceOf(Error);
    expect(err.name).toBe("RouteGenerationError");
  });

  it("carries maxElevationEstimate", () => {
    const err = new RouteGenerationError("IMPOSSIBLE_ELEVATION", {
      maxElevationEstimate: 350,
    });
    expect(err.code).toBe("IMPOSSIBLE_ELEVATION");
    expect(err.maxElevationEstimate).toBe(350);
    expect(err.subCode).toBeUndefined();
  });

  it("works with code only", () => {
    const err = new RouteGenerationError("GEOCODING_FAILED");
    expect(err.code).toBe("GEOCODING_FAILED");
    expect(err.message).toBe("GEOCODING_FAILED");
  });

  it("allows custom message", () => {
    const err = new RouteGenerationError("UNKNOWN", { message: "Something broke" });
    expect(err.message).toBe("Something broke");
    expect(err.code).toBe("UNKNOWN");
  });
});
