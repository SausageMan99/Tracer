"use client";

import SectionLabel from "@/components/landing/shared/SectionLabel";
import ScrambleNumber from "@/components/ui/ScrambleNumber";

interface Step {
  readonly num: string;
  readonly title: string;
  readonly desc: string;
}

const STEPS: readonly Step[] = [
  {
    num: "01",
    title: "Décris ta séance.",
    desc: "Sport, profil, distance, D+. En 5 secondes, TrailForge sait exactement ce dont tu as besoin.",
  },
  {
    num: "02",
    title: "TrailForge forge.",
    desc: "847 candidats analysés. Surface, dénivelé, boucle — le meilleur parcours est sélectionné automatiquement.",
  },
  {
    num: "03",
    title: "Lance-toi.",
    desc: "Export GPX direct vers ta montre. Garmin, Wahoo, Suunto — prêt à partir en 10 secondes.",
  },
] as const;

// ── Step visuals ─────────────────────────────────────────────────────────────

function FormMockup() {
  return (
    <div style={{ padding: "24px", width: "100%" }}>
      <svg viewBox="0 0 280 180" style={{ width: "100%", maxWidth: "280px", margin: "0 auto", display: "block" }}>
        <rect x="10" y="10" width="260" height="160" rx="2" fill="none" stroke="var(--app-border)" strokeWidth="1" />
        <rect x="30" y="30" width="60" height="22" rx="2" fill="var(--app-accent-lime)" />
        <text x="60" y="45" textAnchor="middle" fontSize="9" fontFamily="var(--font-ui)" fontWeight="700" fill="var(--app-bg-deep)">Running</text>
        <rect x="100" y="30" width="60" height="22" rx="2" fill="none" stroke="var(--app-border)" strokeWidth="1" />
        <text x="130" y="45" textAnchor="middle" fontSize="9" fontFamily="var(--font-ui)" fill="var(--app-text-muted)">Cycling</text>
        <line x1="30" y1="80" x2="250" y2="80" stroke="var(--app-bg-elevated)" strokeWidth="2" />
        <circle cx="160" cy="80" r="6" fill="var(--app-accent-lime)" />
        <text x="30" y="98" fontSize="8" fontFamily="var(--font-body)" fill="var(--app-text-muted)">12 km</text>
        <line x1="30" y1="120" x2="250" y2="120" stroke="var(--app-bg-elevated)" strokeWidth="2" />
        <circle cx="100" cy="120" r="6" fill="var(--app-accent-lime)" />
        <text x="30" y="138" fontSize="8" fontFamily="var(--font-body)" fill="var(--app-text-muted)">D+ 350m</text>
      </svg>
    </div>
  );
}

function RouteSvgMockup() {
  return (
    <div style={{ padding: "24px", width: "100%" }}>
      <svg viewBox="0 0 280 180" style={{ width: "100%", maxWidth: "280px", margin: "0 auto", display: "block" }}>
        {[30, 70, 110, 150].map((y) => (
          <line key={y} x1="10" y1={y} x2="270" y2={y} stroke="var(--app-border)" strokeWidth="0.3" />
        ))}
        <path
          d="M40 140 C60 140 80 100 100 80 C120 60 140 50 170 60 C200 70 220 90 240 100 C255 107 260 125 240 135 C220 145 180 145 140 145 C100 145 60 145 40 140"
          fill="none"
          stroke="var(--app-accent-lime)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="40" cy="140" r="5" fill="var(--app-accent-lime)" />
        <circle cx="40" cy="140" r="9" fill="none" stroke="var(--app-accent-lime)" strokeWidth="1" strokeOpacity="0.3" />
      </svg>
    </div>
  );
}

function GpxDownloadMockup() {
  return (
    <div style={{ padding: "24px", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
      <svg viewBox="0 0 60 70" width="60" height="70" aria-hidden="true">
        <rect x="5" y="5" width="50" height="60" rx="2" fill="none" stroke="var(--app-accent-moss)" strokeWidth="1.5" />
        <path d="M30 25 L30 50" stroke="var(--app-accent-lime)" strokeWidth="2" strokeLinecap="round" />
        <path d="M22 42 L30 50 L38 42" stroke="var(--app-accent-lime)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <text x="30" y="18" textAnchor="middle" fontSize="8" fontFamily="var(--font-ui)" fontWeight="700" fill="var(--app-accent-lime)">.GPX</text>
      </svg>
      <span style={{ fontFamily: "var(--font-body), monospace", fontSize: "11px", color: "var(--app-text-muted)" }}>
        parcours_12km_350m.gpx
      </span>
    </div>
  );
}

const STEP_VISUALS = [<FormMockup key="form" />, <RouteSvgMockup key="route" />, <GpxDownloadMockup key="gpx" />];

// ── Step card ────────────────────────────────────────────────────────────────

function StepCard({ step, index }: { readonly step: Step; readonly index: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <ScrambleNumber
        text={step.num}
        style={{
          fontFamily: "var(--font-body), monospace",
          fontSize: "clamp(36px, 5vw, 56px)",
          fontWeight: 500,
          color: "var(--app-accent-lime)",
          lineHeight: 1,
          display: "block",
          marginBottom: "12px",
        }}
      />
      <h3
        style={{
          fontFamily: "var(--font-heading), serif",
          fontSize: "clamp(20px, 2.5vw, 32px)",
          fontStyle: "italic",
          color: "var(--app-text-primary)",
          marginBottom: "10px",
          lineHeight: 1.2,
        }}
      >
        {step.title}
      </h3>
      <p
        style={{
          fontFamily: "var(--font-ui), sans-serif",
          fontSize: "15px",
          color: "var(--app-text-muted)",
          lineHeight: 1.7,
        }}
      >
        {step.desc}
      </p>
      <div
        style={{
          background: "var(--app-bg-surface)",
          border: "1px solid var(--app-border)",
          borderRadius: "2px",
          aspectRatio: "4/3",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          overflow: "hidden",
        }}
      >
        {STEP_VISUALS[index]}
      </div>
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function HowItWorksSection() {
  return (
    <section
      className="px-6 md:px-16 lg:px-32 py-20"
      style={{
        background: "var(--app-bg-deep)",
        borderTop: "1px solid var(--app-border)",
      }}
    >
      <SectionLabel>02 — Comment ça marche</SectionLabel>

      <div
        className="grid grid-cols-1 md:grid-cols-3"
        style={{
          gap: "clamp(32px, 4vw, 64px)",
          marginTop: "40px",
        }}
      >
        {STEPS.map((step, i) => (
          <StepCard key={step.num} step={step} index={i} />
        ))}
      </div>
    </section>
  );
}
