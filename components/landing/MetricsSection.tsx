"use client";

import ScrambleNumber from "@/components/ui/ScrambleNumber";
import SectionLabel from "@/components/landing/shared/SectionLabel";
import { useRevealOnScroll } from "@/hooks/useScrollAnimation";

interface Metric {
  readonly value: string;
  readonly label: string;
}

const METRICS: readonly Metric[] = [
  { value: "3", label: "intentions trail" },
  { value: "15km", label: "focus phase 1" },
  { value: "0", label: "choix vélo" },
  { value: "GPX", label: "sortie montre" },
] as const;

export default function MetricsSection() {
  const sectionRef = useRevealOnScroll<HTMLDivElement>({
    threshold: 0.2,
    visibleClass: "is-visible",
  });

  return (
    <section
      style={{
        background: "var(--bg-deep)",
        borderTop: "1px solid var(--border)",
        padding: "clamp(48px, 6vw, 96px) clamp(24px, 8vw, 120px)",
        position: "relative",
        overflow: "hidden",
      }}
    >
      {/* Subtle topo SVG background */}
      <svg
        aria-hidden="true"
        style={{ position: "absolute", inset: 0, width: "100%", height: "100%", opacity: 0.03 }}
        preserveAspectRatio="none"
        viewBox="0 0 800 200"
      >
        <path d="M0 100 C100 60 200 140 300 100 C400 60 500 140 600 100 C700 60 800 140 800 100" fill="none" stroke="var(--accent-moss)" strokeWidth="1" />
        <path d="M0 80 C150 40 250 120 400 80 C550 40 650 120 800 80" fill="none" stroke="var(--accent-moss)" strokeWidth="0.5" />
        <path d="M0 120 C120 80 280 160 400 120 C520 80 680 160 800 120" fill="none" stroke="var(--accent-moss)" strokeWidth="0.5" />
      </svg>

      <div style={{ position: "relative", zIndex: 1, textAlign: "center" }}>
        <SectionLabel>03 — En chiffres</SectionLabel>

        <div
          ref={sectionRef}
          className="reveal-fade grid grid-cols-2 md:grid-cols-4"
          style={{
            gap: "clamp(24px, 4vw, 48px)",
            marginTop: "48px",
            maxWidth: "900px",
            marginLeft: "auto",
            marginRight: "auto",
          }}
        >
          {METRICS.map((metric) => (
            <div
              key={metric.label}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                alignItems: "center",
              }}
            >
              <ScrambleNumber
                text={metric.value}
                style={{
                  fontFamily: "var(--font-playfair), serif",
                  fontSize: "clamp(40px, 6vw, 64px)",
                  fontStyle: "italic",
                  color: "var(--accent-lime)",
                  lineHeight: 1,
                }}
              />
              <span
                style={{
                  fontFamily: "var(--font-syne), sans-serif",
                  fontSize: "11px",
                  letterSpacing: "0.3em",
                  color: "var(--text-muted)",
                  textTransform: "uppercase",
                }}
              >
                {metric.label}
              </span>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
