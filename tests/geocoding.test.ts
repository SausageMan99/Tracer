import { afterEach, describe, expect, it, vi } from "vitest";
import { geocodeAddress } from "@/lib/route-generator-legacy";

const originalMapboxToken = process.env.MAPBOX_TOKEN;
const originalNextPublicMapboxToken = process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

afterEach(() => {
  process.env.MAPBOX_TOKEN = originalMapboxToken;
  process.env.NEXT_PUBLIC_MAPBOX_TOKEN = originalNextPublicMapboxToken;
  vi.unstubAllGlobals();
});

describe("geocodeAddress", () => {
  it("uses the configured Mapbox token instead of a redacted placeholder", async () => {
    process.env.MAPBOX_TOKEN = "test-mapbox-token";
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify({ features: [{ center: [3.0633, 50.6372] }] }), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const coordinate = await geocodeAddress("Grand Place, Lille");

    expect(coordinate).toEqual({ lat: 50.6372, lng: 3.0633 });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.hostname).toBe("api.mapbox.com");
    expect(url.searchParams.get("access_token")).toBe("test-mapbox-token");
    expect(String(fetchMock.mock.calls[0][0])).not.toContain("access_token=***");
  });

  it("falls back to OpenStreetMap Nominatim when no Mapbox token is configured", async () => {
    delete process.env.MAPBOX_TOKEN;
    delete process.env.NEXT_PUBLIC_MAPBOX_TOKEN;

    const fetchMock = vi.fn().mockResolvedValue(
      new Response(JSON.stringify([{ lat: "48.8566", lon: "2.3522" }]), { status: 200 })
    );
    vi.stubGlobal("fetch", fetchMock);

    const coordinate = await geocodeAddress("Paris");

    expect(coordinate).toEqual({ lat: 48.8566, lng: 2.3522 });
    const url = new URL(String(fetchMock.mock.calls[0][0]));
    expect(url.hostname).toBe("nominatim.openstreetmap.org");
    expect(fetchMock.mock.calls[0][1]).toEqual(
      expect.objectContaining({
        headers: expect.objectContaining({ "User-Agent": expect.stringContaining("TrailForge") }),
      })
    );
  });
});
