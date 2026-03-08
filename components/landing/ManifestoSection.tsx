"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap-setup";
import SectionLabel from "@/components/landing/shared/SectionLabel";
import TextReveal from "@/components/ui/TextReveal";
import TopographicDivider from "@/components/landing/shared/TopographicDivider";

const PAIN_STATEMENTS = [
  "Tu cherches. 20 minutes. Sans garantie.",
  "Ton fractionné finit sur un boulevard.",
  "Ton D+ est un mensonge. Chaque fois.",
] as const;

export default function ManifestoSection() {
  const sectionRef = useRef<HTMLDivElement>(null);
  const statementsRef = useRef<(HTMLParagraphElement | null)[]>([]);

  useEffect(() => {
    const section = sectionRef.current;
    if (!section) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      statementsRef.current.forEach((el) => {
        if (el) el.style.opacity = "1";
      });
      return;
    }

    const ctx = gsap.context(() => {
      statementsRef.current.forEach((el, i) => {
        if (!el) return;
        gsap.fromTo(
          el,
          { opacity: 0, y: 30 },
          {
            opacity: 1,
            y: 0,
            duration: 0.8,
            ease: "expo.out",
            scrollTrigger: {
              trigger: el,
              start: "top 82%",
              once: true,
            },
            delay: i * 0.1,
          },
        );
      });
    }, section);

    return () => ctx.revert();
  }, []);

  return (
    <section
      ref={sectionRef}
      className="px-6 md:px-16 lg:px-32"
      style={{
        paddingTop: "clamp(100px, 12vw, 160px)",
        paddingBottom: "32px",
        background: "var(--bg-deep)",
      }}
    >
      <SectionLabel>01 — Le constat</SectionLabel>

      <h2
        style={{
          fontFamily: "var(--font-playfair), serif",
          fontSize: "clamp(28px, 4.5vw, 56px)",
          fontStyle: "italic",
          color: "var(--text-primary)",
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
            ref={(el) => { statementsRef.current[i] = el; }}
            style={{
              fontFamily: "var(--font-inter), sans-serif",
              fontSize: "clamp(18px, 2.5vw, 24px)",
              color: "var(--text-muted)",
              lineHeight: 1.6,
              opacity: 0,
              borderLeft: "2px solid var(--accent-moss)",
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
