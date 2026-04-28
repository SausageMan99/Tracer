import { describe, it, expect, vi, beforeEach } from "vitest";
import { DirectFetcher } from "../lib/engine/adapters/direct-fetcher";

// ---------------------------------------------------------------------------
// fetchElevations
// ---------------------------------------------------------------------------

describe("DirectFetcher.fetchElevations", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns an empty array for empty input", async () => {
    const fetcher = new DirectFetcher();
    const result = await fetcher.fetchElevations([]);
    expect(result).toEqual([]);
  });

  it("fetches elevations in a single batch when coords <= 100", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ elevation: Array(50).fill(150) }),
    });
    global.fetch = mockFetch;

    const fetcher = new DirectFetcher();
    const coords = Array(50).fill({ lat: 48.73, lng: -0.09 });
    const elevations = await fetcher.fetchElevations(coords);

    expect(elevations).toHaveLength(50);
    expect(elevations[0]).toBe(150);
    expect(mockFetch).toHaveBeenCalledTimes(1);
  });

  it("splits coords into multiple batches of 100", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ elevation: Array(100).fill(200) }),
    });
    global.fetch = mockFetch;

    const fetcher = new DirectFetcher();
    const coords = Array(250).fill({ lat: 45.0, lng: 6.0 });
    const elevations = await fetcher.fetchElevations(coords);

    // 3 batches: 100 + 100 + 50 — but mock always returns 100 values
    expect(mockFetch).toHaveBeenCalledTimes(3);
    // Each batch resolves to 100 values → total 300; but only 250 coords sent
    // The implementation pushes whatever the API returns for each batch.
    expect(elevations.length).toBeGreaterThanOrEqual(250);
  });

  it("returns zeros on fetch failure (graceful degradation)", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Network error"));

    const fetcher = new DirectFetcher();
    const coords = [{ lat: 48.73, lng: -0.09 }];
    const elevations = await fetcher.fetchElevations(coords);

    expect(elevations).toEqual([0]);
  });

  it("returns zeros when API responds with non-ok status", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 500,
      json: () => Promise.resolve({}),
    });

    const fetcher = new DirectFetcher();
    const coords = [{ lat: 48.0, lng: 2.0 }];
    const elevations = await fetcher.fetchElevations(coords);

    expect(elevations).toEqual([0]);
  });

  it("returns zeros when API returns empty elevation array", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ elevation: [] }),
    });

    const fetcher = new DirectFetcher();
    const coords = [{ lat: 48.0, lng: 2.0 }];
    const elevations = await fetcher.fetchElevations(coords);

    // Empty elevation array → falls back to zeros for the batch
    expect(elevations).toEqual([0]);
  });
});

// ---------------------------------------------------------------------------
// fetchOverpassData
// ---------------------------------------------------------------------------

describe("DirectFetcher.fetchOverpassData", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("returns parsed JSON on success", async () => {
    const mockData = { elements: [{ type: "node", id: 1, lat: 48.73, lon: -0.09 }] };
    global.fetch = vi.fn().mockResolvedValue({
      ok: true,
      status: 200,
      json: () => Promise.resolve(mockData),
    });

    const fetcher = new DirectFetcher();
    const result = await fetcher.fetchOverpassData({ lat: 48.73, lng: -0.09 }, 3);

    expect(result).toEqual(mockData);
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it("tries the fallback endpoint when the primary returns 429", async () => {
    const mockData = { elements: [] };
    let callCount = 0;

    global.fetch = vi.fn().mockImplementation((url: string) => {
      callCount++;
      if (url.includes("overpass-api.de")) {
        return Promise.resolve({ ok: false, status: 429, json: () => Promise.resolve({}) });
      }
      return Promise.resolve({ ok: true, status: 200, json: () => Promise.resolve(mockData) });
    });

    const fetcher = new DirectFetcher();
    const result = await fetcher.fetchOverpassData({ lat: 48.73, lng: -0.09 }, 3);

    expect(result).toEqual(mockData);
    expect(callCount).toBeGreaterThanOrEqual(2);
  });

  it("throws after all retries and endpoints are exhausted", async () => {
    global.fetch = vi.fn().mockResolvedValue({
      ok: false,
      status: 503,
      json: () => Promise.resolve({}),
    });

    const fetcher = new DirectFetcher();

    await expect(
      fetcher.fetchOverpassData({ lat: 48.73, lng: -0.09 }, 3)
    ).rejects.toThrow();
  });

  it("throws when all attempts result in network errors", async () => {
    global.fetch = vi.fn().mockRejectedValue(new Error("Connection refused"));

    const fetcher = new DirectFetcher();

    await expect(
      fetcher.fetchOverpassData({ lat: 48.73, lng: -0.09 }, 3)
    ).rejects.toThrow();
  });
});
