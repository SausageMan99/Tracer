import { describe, it, expect, vi, afterEach } from "vitest";
import { ProxyFetcher } from "../lib/engine/adapters/proxy-fetcher";

describe("ProxyFetcher", () => {
  afterEach(() => { vi.restoreAllMocks(); });

  it("calls /api/proxy/osm with correct params", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ elements: [] }),
    });
    global.fetch = mockFetch;

    const fetcher = new ProxyFetcher();
    await fetcher.fetchOverpassData({ lat: 48.73, lng: -0.09 }, 5.6);

    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/proxy/osm?lat=48.73&lng=-0.09&radius=5.6"),
      expect.any(Object)
    );
  });

  it("calls /api/proxy/elevation with POST", async () => {
    const mockFetch = vi.fn().mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ elevations: [150] }),
    });
    global.fetch = mockFetch;

    const fetcher = new ProxyFetcher();
    const result = await fetcher.fetchElevations([{ lat: 48.73, lng: -0.09 }]);

    expect(result).toEqual([150]);
    expect(mockFetch).toHaveBeenCalledWith(
      expect.stringContaining("/api/proxy/elevation"),
      expect.objectContaining({ method: "POST" })
    );
  });

  it("returns zeros on elevation fetch failure", async () => {
    global.fetch = vi.fn().mockResolvedValue({ ok: false, status: 500 });

    const fetcher = new ProxyFetcher();
    const result = await fetcher.fetchElevations([{ lat: 48.73, lng: -0.09 }]);
    expect(result).toEqual([0]);
  });

  it("returns empty array for empty coords", async () => {
    const fetcher = new ProxyFetcher();
    const result = await fetcher.fetchElevations([]);
    expect(result).toEqual([]);
  });
});
