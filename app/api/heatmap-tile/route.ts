/**
 * GET /api/heatmap-tile
 *
 * Same-origin proxy for Strava heatmap tiles. Forwards requests to the
 * local Go proxy (port 8080) which handles Strava CloudFront authentication.
 *
 * This Next.js route exists solely to bypass browser CORS restrictions —
 * the client cannot call localhost:8080 directly from the page because
 * cross-origin requests to localhost are blocked in most browsers.
 *
 * Query parameters:
 * - `sport` — "all" | "running" | "ride" (validated against whitelist)
 * - `color` — "hot" | "blue" | "bluered" (validated against whitelist)
 * - `z`, `x`, `y` — tile coordinates (required)
 *
 * Caches successful responses for 1 hour (stale-while-revalidate 24h).
 * Returns the raw PNG bytes with Content-Type: image/png.
 *
 * Returns 400 on missing/invalid parameters, 502 on proxy unavailability.
 */
import { NextRequest, NextResponse } from "next/server";

const PROXY_BASE = "http://localhost:8080/identified/globalheat";
const ALLOWED_SPORTS = new Set(["all", "running", "ride"]);
const ALLOWED_COLORS = new Set(["hot", "blue", "bluered"]);

/**
 * Proxies Strava heatmap tile requests to bypass CORS.
 * URL: /api/heatmap-tile?sport=all&color=hot&z=12&x=2075&y=1409
 */
export async function GET(request: NextRequest) {
  const { searchParams } = request.nextUrl;
  const sport = searchParams.get("sport") ?? "all";
  const color = searchParams.get("color") ?? "hot";
  const z = searchParams.get("z");
  const x = searchParams.get("x");
  const y = searchParams.get("y");

  if (!z || !x || !y) {
    return NextResponse.json({ error: "Missing z/x/y" }, { status: 400 });
  }

  if (!ALLOWED_SPORTS.has(sport) || !ALLOWED_COLORS.has(color)) {
    return NextResponse.json({ error: "Invalid sport or color" }, { status: 400 });
  }

  const url = `${PROXY_BASE}/${sport}/${color}/${z}/${x}/${y}@2x.png?v=19`;

  try {
    const res = await fetch(url, { signal: AbortSignal.timeout(5000) });

    if (!res.ok) {
      return new NextResponse(null, { status: res.status });
    }

    const buffer = await res.arrayBuffer();

    return new NextResponse(buffer, {
      status: 200,
      headers: {
        "Content-Type": "image/png",
        "Cache-Control": "public, max-age=3600, stale-while-revalidate=86400",
      },
    });
  } catch {
    return new NextResponse(null, { status: 502 });
  }
}
