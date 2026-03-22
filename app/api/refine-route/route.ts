import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserTier } from "@/lib/db";
import { generateRouteV2 } from "@/lib/engine";
import { PRO_TIER } from "@/lib/engine/tier-config";
import { FilesystemCache } from "@/lib/engine/adapters/filesystem-cache";
import { DirectFetcher } from "@/lib/engine/adapters/direct-fetcher";
import * as path from "path";

export const dynamic = "force-dynamic";

const cache = new FilesystemCache(
  path.join(process.cwd(), ".cache", "graphs"),
  7 * 24 * 60 * 60 * 1000
);
const fetcher = new DirectFetcher();

export async function POST(request: NextRequest) {
  // Auth check
  const session = await auth();
  if (!session?.user?.id) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Tier check
  const tier = await getUserTier(session.user.id);
  if (tier !== "pro") {
    return NextResponse.json(
      { error: "Pro subscription required" },
      { status: 403 }
    );
  }

  try {
    const body = await request.json();
    const result = await generateRouteV2(body, PRO_TIER, cache, fetcher);
    return NextResponse.json(result);
  } catch (e) {
    const msg = e instanceof Error ? e.message : "Unknown error";
    const code = (e as { code?: string })?.code ?? "UNKNOWN";
    return NextResponse.json({ error: msg, code }, { status: 422 });
  }
}
