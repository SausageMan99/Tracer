"use client";

import HeroSection from "@/components/landing/HeroSection";
import ProblemSection from "@/components/landing/ProblemSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import DifferenceSection from "@/components/landing/DifferenceSection";
import PricingSection from "@/components/landing/PricingSection";
import FooterSection from "@/components/landing/FooterSection";

export default function LandingPageV2() {
  return (
    <main style={{ background: "var(--bg-parchment)", color: "#3d3529" }}>
      <HeroSection />
      <ProblemSection />
      <HowItWorksSection />
      <DifferenceSection />
      <PricingSection />
      <FooterSection />
    </main>
  );
}
