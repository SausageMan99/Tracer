import { type ApiData, verifyAccess, version } from "flags";
import { getProviderData } from "flags/next";
import { NextResponse, type NextRequest } from "next/server";
import * as flags from "@/lib/feature-flags/flags";

export async function GET(request: NextRequest) {
  const access = await verifyAccess(request.headers.get("Authorization"));
  if (!access) return NextResponse.json(null, { status: 401 });

  const providerData = await getProviderData(flags);

  return NextResponse.json<ApiData>(providerData, {
    headers: { "x-flags-sdk-version": version },
  });
}
