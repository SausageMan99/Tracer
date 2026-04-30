"use client";

import { useEffect, useRef, useState } from "react";
import { gsap } from "@/lib/gsap-setup";
import SectionLabel from "@/components/landing/shared/SectionLabel";
import ScrambleNumber from "@/components/ui/ScrambleNumber";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

interface Step {
  readonly num: string;
  readonly title: string;
  readonly desc: string;
}

const STEPS: readonly Step[] = [
  {
    num: "01",
    title: "Choisis ton départ.",
    desc: "Adresse, parking ou spot habituel. Ajoute distance, D+ cible et niveau de surface nature attendu.",
  },
  {
    num: "02",
    title: "TrailForge vérifie.",
    desc: "Le moteur cherche une vraie boucle et signale les compromis : trop de route, D+ approximatif, boucle imparfaite.",
  },
  {
    num: "03",
    title: "Lance-toi.",
    desc: "Export GPX direct vers Garmin, COROS, Suunto ou Strava. Tu synchronises, tu cours.",
  },
] as const;

// ── Step visual SVGs ────────────────────────────────────────────────────────

function FormMockup() {
  return (
    <div style={{ padding: "24px", width: "100%" }}>
      <svg viewBox="0 0 280 180" style={{ width: "100%", maxWidth: "280px", margin: "0 auto", display: "block" }}>
        <rect x="10" y="10" width="260" height="160" rx="2" fill="none" stroke="var(--border)" strokeWidth="1" />
        <rect x="30" y="30" width="60" height="22" rx="2" fill="var(--accent-lime)" />
        <text x="60" y="45" textAnchor="middle" fontSize="9" fontFamily="var(--font-syne)" fontWeight="700" fill="var(--bg-deep)">Trail</text>
        <rect x="100" y="30" width="60" height="22" rx="2" fill="none" stroke="var(--border)" strokeWidth="1" />
        <text x="130" y="45" textAnchor="middle" fontSize="9" fontFamily="var(--font-syne)" fill="var(--text-muted)">Route</text>
        <line x1="30" y1="80" x2="250" y2="80" stroke="var(--bg-elevated)" strokeWidth="2" />
        <circle cx="160" cy="80" r="6" fill="var(--accent-lime)" />
        <text x="30" y="98" fontSize="8" fontFamily="var(--font-jetbrains)" fill="var(--text-muted)">12 km</text>
        <line x1="30" y1="120" x2="250" y2="120" stroke="var(--bg-elevated)" strokeWidth="2" />
        <circle cx="100" cy="120" r="6" fill="var(--accent-lime)" />
        <text x="30" y="138" fontSize="8" fontFamily="var(--font-jetbrains)" fill="var(--text-muted)">D+ 350m</text>
      </svg>
    </div>
  );
}

function RouteSvgMockup() {
  return (
    <div style={{ padding: "24px", width: "100%" }}>
      <svg viewBox="0 0 280 180" style={{ width: "100%", maxWidth: "280px", margin: "0 auto", display: "block" }}>
        {[30, 70, 110, 150].map((y) => (
          <line key={y} x1="10" y1={y} x2="270" y2={y} stroke="var(--border)" strokeWidth="0.3" />
        ))}
        <path
          d="M40 140 C60 140 80 100 100 80 C120 60 140 50 170 60 C200 70 220 90 240 100 C255 107 260 125 240 135 C220 145 180 145 140 145 C100 145 60 145 40 140"
          fill="none"
          stroke="var(--accent-lime)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <circle cx="40" cy="140" r="5" fill="var(--accent-lime)" />
        <circle cx="40" cy="140" r="9" fill="none" stroke="var(--accent-lime)" strokeWidth="1" strokeOpacity="0.3" />
      </svg>
    </div>
  );
}

function GpxDownloadMockup() {
  return (
    <div style={{ padding: "24px", width: "100%", display: "flex", flexDirection: "column", alignItems: "center", gap: "16px" }}>
      <svg viewBox="0 0 60 70" width="60" height="70" aria-hidden="true">
        <rect x="5" y="5" width="50" height="60" rx="2" fill="none" stroke="var(--accent-moss)" strokeWidth="1.5" />
        <path d="M30 25 L30 50" stroke="var(--accent-lime)" strokeWidth="2" strokeLinecap="round" />
        <path d="M22 42 L30 50 L38 42" stroke="var(--accent-lime)" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" fill="none" />
        <text x="30" y="18" textAnchor="middle" fontSize="8" fontFamily="var(--font-syne)" fontWeight="700" fill="var(--accent-lime)">.GPX</text>
      </svg>
      <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "11px", color: "var(--text-muted)" }}>
        parcours_12km_350m.gpx
      </span>
    </div>
  );
}

const STEP_VISUALS = [<FormMockup key="form" />, <RouteSvgMockup key="route" />, <GpxDownloadMockup key="gpx" />];

// ── Vertical step (mobile / reduced-motion) ─────────────────────────────────

function VerticalStep({ step, index }: { readonly step: Step; readonly index: number }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "20px" }}>
      <div>
        <span
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "36px",
            fontWeight: 500,
            color: "var(--accent-lime)",
            lineHeight: 1,
            display: "block",
            marginBottom: "12px",
          }}
        >
          {step.num}
        </span>
        <h3
          style={{
            fontFamily: "var(--font-playfair), serif",
            fontSize: "24px",
            fontStyle: "italic",
            color: "var(--text-primary)",
            marginBottom: "10px",
            lineHeight: 1.2,
          }}
        >
          {step.title}
        </h3>
        <p
          style={{
            fontFamily: "var(--font-inter), sans-serif",
            fontSize: "15px",
            color: "var(--text-muted)",
            lineHeight: 1.7,
          }}
        >
          {step.desc}
        </p>
      </div>
      <div
        style={{
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
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

// ── Horizontal step card (desktop) ──────────────────────────────────────────

function StepCard({ step, index }: { readonly step: Step; readonly index: number }) {
  return (
    <div
      className="how-step"
      style={{
        flex: "0 0 100vw",
        height: "100%",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "clamp(24px, 4vw, 80px)",
      }}
    >
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: "clamp(32px, 4vw, 64px)",
          alignItems: "center",
          maxWidth: "1000px",
          width: "100%",
        }}
      >
        <div>
          <ScrambleNumber
            text={step.num}
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "clamp(48px, 6vw, 72px)",
              fontWeight: 500,
              color: "var(--accent-lime)",
              lineHeight: 1,
              display: "block",
              marginBottom: "16px",
            }}
          />
          <h3
            style={{
              fontFamily: "var(--font-playfair), serif",
              fontSize: "clamp(24px, 3vw, 40px)",
              fontStyle: "italic",
              color: "var(--text-primary)",
              marginBottom: "16px",
              lineHeight: 1.2,
            }}
          >
            {step.title}
          </h3>
          <p
            style={{
              fontFamily: "var(--font-inter), sans-serif",
              fontSize: "15px",
              color: "var(--text-muted)",
              lineHeight: 1.7,
              maxWidth: "380px",
            }}
          >
            {step.desc}
          </p>
        </div>
        <div
          style={{
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
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
    </div>
  );
}

// ── Main component ──────────────────────────────────────────────────────────

export default function HowItWorksSection() {
  const prefersReducedMotion = usePrefersReducedMotion();
  const sectionRef = useRef<HTMLDivElement>(null);
  const trackRef = useRef<HTMLDivElement>(null);
  const [isDesktop, setIsDesktop] = useState(() => {
    if (typeof window === "undefined") return false;
    return window.matchMedia("(min-width: 768px)").matches;
  });

  useEffect(() => {
    const mq = window.matchMedia("(min-width: 768px)");
    const handler = (e: MediaQueryListEvent) => setIsDesktop(e.matches);
    mq.addEventListener("change", handler);
    return () => mq.removeEventListener("change", handler);
  }, []);

  useEffect(() => {
    if (prefersReducedMotion || !isDesktop) return;

    const section = sectionRef.current;
    const track = trackRef.current;
    if (!section || !track) return;

    const ctx = gsap.context(() => {
      gsap.to(track, {
        xPercent: -((STEPS.length - 1) * 100) / STEPS.length,
        ease: "none",
        scrollTrigger: {
          trigger: section,
          start: "top top",
          end: `+=${STEPS.length * window.innerHeight}`,
          pin: true,
          scrub: 0.5,
        },
      });
    }, section);

    return () => ctx.revert();
  }, [prefersReducedMotion, isDesktop]);

  // Mobile or reduced motion: vertical stack
  if (!isDesktop || prefersReducedMotion) {
    return (
      <section
        className="px-6 py-20"
        style={{ background: "var(--bg-deep)", borderTop: "1px solid var(--border)" }}
      >
        <SectionLabel>02 — Comment ça marche</SectionLabel>
        <div style={{ display: "flex", flexDirection: "column", gap: "48px", marginTop: "40px" }}>
          {STEPS.map((step, i) => (
            <VerticalStep key={step.num} step={step} index={i} />
          ))}
        </div>
      </section>
    );
  }

  // Desktop: horizontal scroll
  return (
    <section
      ref={sectionRef}
      style={{
        overflow: "hidden",
        height: "100vh",
        background: "var(--bg-deep)",
        borderTop: "1px solid var(--border)",
        position: "relative",
      }}
    >
      <div
        className="px-6 md:px-16 lg:px-32"
        style={{ position: "absolute", top: "clamp(24px, 3vw, 48px)", zIndex: 5 }}
      >
        <SectionLabel>02 — Comment ça marche</SectionLabel>
      </div>

      <div
        ref={trackRef}
        style={{
          display: "flex",
          width: `${STEPS.length * 100}vw`,
          height: "100%",
        }}
      >
        {STEPS.map((step, i) => (
          <StepCard key={step.num} step={step} index={i} />
        ))}
      </div>
    </section>
  );
}
