import { generatePermutations } from "flags/next";
import { newLandingHeroFlag } from "@/lib/feature-flags/flags";
import LandingPageV2 from "@/components/landing/LandingPageV2";

const landingFlags = [newLandingHeroFlag] as const;

function areLandingFlagsConfigured(): boolean {
  return Boolean(
    process.env.FLAGS_SECRET &&
      process.env.GROWTHBOOK_API_HOST &&
      process.env.GROWTHBOOK_CLIENT_KEY
  );
}

export async function generateStaticParams() {
  if (!areLandingFlagsConfigured()) {
    return [];
  }

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
