import { NextRequest, NextResponse } from "next/server";
import { DirectFetcher } from "@/lib/engine/adapters/direct-fetcher";

const fetcher = new DirectFetcher();

export function validateParams(params: URLSearchParams) {
  const rawLat = params.get("lat");
  const rawLng = params.get("lng");
  const rawRadius = params.get("radius");
  if (rawLat === null || rawLng === null || rawRadius === null) throw new Error("Missing params");
  const lat = Number(rawLat);
  const lng = Number(rawLng);
  const radius = Number(rawRadius);
  if (isNaN(lat) || isNaN(lng) || isNaN(radius)) throw new Error("Missing params");
  if (radius > 25) throw new Error("Radius too large");
  if (radius < 0.5) throw new Error("Radius too small");
  return { lat, lng, radius };
}

export async function GET(request: NextRequest) {
  try {
    const { lat, lng, radius } = validateParams(request.nextUrl.searchParams);
    const data = await fetcher.fetchOverpassData({ lat, lng }, radius);
    const json = JSON.stringify(data);

    if (json.length > 10 * 1024 * 1024) {
      return NextResponse.json(
        { error: "GRAPH_TOO_LARGE", message: "Reduce target distance" },
        { status: 413 }
      );
    }

    return new NextResponse(json, {
      headers: {
        "Content-Type": "application/json",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
