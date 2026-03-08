import { generatePermutations } from "flags/next";
import { newLandingHeroFlag } from "@/lib/feature-flags/flags";
import LandingPageV2 from "@/components/landing/LandingPageV2";

const landingFlags = [newLandingHeroFlag] as const;

export async function generateStaticParams() {
  const codes = await generatePermutations(landingFlags);
  return codes.map((code) => ({ code }));
}

export default async function PrecomputedLandingPage({
  params,
}: {
  params: Promise<{ code: string }>;
}) {
  // params consumed to satisfy Next.js dynamic route contract
  await params;

  return <LandingPageV2 />;
}
