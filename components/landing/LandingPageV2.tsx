"use client";

import { useCallback, useState } from "react";
import CustomCursor from "@/components/ui/CustomCursor";
import LoadingSequence from "@/components/landing/LoadingSequence";
import HeroSection from "@/components/landing/HeroSection";
import ManifestoSection from "@/components/landing/ManifestoSection";
import HowItWorksSection from "@/components/landing/HowItWorksSection";
import FeatureShowcase from "@/components/landing/FeatureShowcase";
import MetricsSection from "@/components/landing/MetricsSection";
import WaitlistSection from "@/components/landing/WaitlistSection";
import FinalCTASection from "@/components/landing/FinalCTASection";
import FooterSection from "@/components/landing/FooterSection";

export default function LandingPageV2() {
  const [loadingDone, setLoadingDone] = useState(false);

  const handleLoadingComplete = useCallback(() => {
    setLoadingDone(true);
  }, []);

  return (
    <main
      className="custom-cursor"
      style={{
        background: "var(--bg-deep)",
        color: "var(--text-primary)",
        overflowX: "hidden",
      }}
    >
      <CustomCursor />

      {!loadingDone && <LoadingSequence onComplete={handleLoadingComplete} />}

      <HeroSection />
      <ManifestoSection />
      <HowItWorksSection />
      <FeatureShowcase />
      <MetricsSection />
      <WaitlistSection />
      <FinalCTASection />
      <FooterSection />
    </main>
  );
}
