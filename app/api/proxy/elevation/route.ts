import { NextRequest, NextResponse } from "next/server";
import type { Coordinate } from "@/lib/types";
import { DirectFetcher } from "@/lib/engine/adapters/direct-fetcher";

const fetcher = new DirectFetcher();

function validateBody(body: unknown): Coordinate[] {
  const { coordinates } = body as { coordinates: Coordinate[] };
  if (!Array.isArray(coordinates) || coordinates.length === 0) {
    throw new Error("coordinates array required");
  }
  if (coordinates.length > 500) {
    throw new Error("Max 500 coordinates per request");
  }
  return coordinates;
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const coords = validateBody(body);
    const elevations = await fetcher.fetchElevations(coords);
    return NextResponse.json(
      { elevations },
      {
        headers: { "Cache-Control": "public, max-age=604800" },
      }
    );
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    return NextResponse.json({ error: msg }, { status: 400 });
  }
}
