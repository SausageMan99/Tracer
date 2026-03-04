import { precompute } from "flags/next";
import { NextResponse, type NextRequest } from "next/server";
import { newLandingHeroFlag } from "@/lib/feature-flags/flags";

const landingFlags = [newLandingHeroFlag] as const;

export async function middleware(request: NextRequest) {
  const code = await precompute(landingFlags);

  const nextUrl = request.nextUrl.clone();
  nextUrl.pathname = `/${code}${nextUrl.pathname === "/" ? "" : nextUrl.pathname}`;

  return NextResponse.rewrite(nextUrl);
}

export const config = {
  matcher: ["/"],
};
