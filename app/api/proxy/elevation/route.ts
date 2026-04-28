import { NextRequest, NextResponse } from "next/server";
import { DirectFetcher } from "@/lib/engine/adapters/direct-fetcher";
import { validateBody } from "@/lib/utils/proxy-validators";

const fetcher = new DirectFetcher();

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
