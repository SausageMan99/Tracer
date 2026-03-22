"use client";

import SectionLabel from "@/components/landing/shared/SectionLabel";
import TextReveal from "@/components/ui/TextReveal";
import TopographicDivider from "@/components/landing/shared/TopographicDivider";

const PAIN_STATEMENTS = [
  "Tu cherches. 20 minutes. Sans garantie.",
  "Ton fractionné finit sur un boulevard.",
  "Ton D+ est un mensonge. Chaque fois.",
] as const;

export default function ManifestoSection() {
  return (
    <section
      className="px-6 md:px-16 lg:px-32"
      style={{
        paddingTop: "clamp(100px, 12vw, 160px)",
        paddingBottom: "32px",
        background: "var(--app-bg-deep)",
      }}
    >
      <SectionLabel>01 — Le constat</SectionLabel>

      <h2
        style={{
          fontFamily: "var(--font-heading), serif",
          fontSize: "clamp(28px, 4.5vw, 56px)",
          fontStyle: "italic",
          color: "var(--app-text-primary)",
          lineHeight: 1.2,
          marginTop: "24px",
          marginBottom: "16px",
          maxWidth: "800px",
        }}
      >
        <TextReveal trigger="scroll" splitType="words">
          Planifier un parcours ne devrait pas être un parcours.
        </TextReveal>
      </h2>

      <TopographicDivider height={60} opacity={0.12} />

      <div
        style={{
          display: "flex",
          flexDirection: "column",
          gap: "32px",
          maxWidth: "640px",
          paddingTop: "24px",
        }}
      >
        {PAIN_STATEMENTS.map((text, i) => (
          <p
            key={i}
            className="reveal-up"
            style={{
              fontFamily: "var(--font-ui), sans-serif",
              fontSize: "clamp(18px, 2.5vw, 24px)",
              color: "var(--app-text-muted)",
              lineHeight: 1.6,
              borderLeft: "2px solid var(--app-accent-moss)",
              paddingLeft: "20px",
            }}
          >
            {text}
          </p>
        ))}
      </div>
    </section>
  );
}
