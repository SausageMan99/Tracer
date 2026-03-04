import { getPrecomputed, generatePermutations } from "flags/next";
import { newLandingHeroFlag } from "@/lib/feature-flags/flags";
import LandingPage from "@/components/landing/LandingPage";

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
  const { code } = await params;
  const showNewHero = await getPrecomputed(newLandingHeroFlag, landingFlags, code);

  return <LandingPage showNewHero={showNewHero} />;
}
