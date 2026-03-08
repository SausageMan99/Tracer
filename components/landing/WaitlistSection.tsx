"use client";

import SectionLabel from "@/components/landing/shared/SectionLabel";
import TextReveal from "@/components/ui/TextReveal";
import WaitlistForm from "@/components/ui/WaitlistForm";
import { useRevealOnScroll } from "@/hooks/useScrollAnimation";

export default function WaitlistSection() {
  const formRef = useRevealOnScroll<HTMLDivElement>({ threshold: 0.15 });

  return (
    <section
      className="px-6 md:px-16 lg:px-32"
      style={{
        paddingTop: "clamp(160px, 16vw, 256px)",
        paddingBottom: "clamp(100px, 10vw, 160px)",
        background: "var(--bg-deep)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <SectionLabel>04 — Accès anticipé</SectionLabel>

      <h2
        style={{
          fontFamily: "var(--font-playfair), serif",
          fontSize: "clamp(32px, 5vw, 64px)",
          fontStyle: "italic",
          color: "var(--text-primary)",
          lineHeight: 1.2,
          marginTop: "24px",
          marginBottom: "16px",
          maxWidth: "700px",
        }}
      >
        <TextReveal trigger="scroll" splitType="words">
          Rejoins les premiers
        </TextReveal>
        <br />
        <TextReveal trigger="scroll" splitType="words" delay={0.2}>
          forgeurs.
        </TextReveal>
      </h2>

      <p
        style={{
          fontFamily: "var(--font-inter), sans-serif",
          fontSize: "16px",
          color: "var(--text-muted)",
          lineHeight: 1.7,
          maxWidth: "480px",
          marginBottom: "40px",
        }}
      >
        TrailForge est en accès anticipé. Inscris-toi pour recevoir les prochaines mises à jour
        et être parmi les premiers à tester les nouvelles fonctionnalités.
      </p>

      <div ref={formRef} className="reveal-up">
        <WaitlistForm source="landing" />
      </div>
    </section>
  );
}
