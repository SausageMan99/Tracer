import { NextRequest, NextResponse } from "next/server";
import { DirectFetcher } from "@/lib/engine/adapters/direct-fetcher";
import { validateParams } from "@/lib/utils/proxy-validators";

const fetcher = new DirectFetcher();

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
