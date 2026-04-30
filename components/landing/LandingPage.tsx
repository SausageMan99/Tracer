"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { gsap, ScrollTrigger } from "@/lib/gsap-setup";
import GrainOverlay from "@/components/ui/GrainOverlay";
import CustomCursor from "@/components/ui/CustomCursor";
import TextReveal from "@/components/ui/TextReveal";
import MagneticButton from "@/components/ui/MagneticButton";
import ScrambleNumber from "@/components/ui/ScrambleNumber";
import { useRevealOnScroll, useStaggerReveal } from "@/hooks/useScrollAnimation";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";
import StackingFeatureCards from "@/components/landing/StackingFeatureCards";

// ── Dynamic import for WebGL (no SSR) ─────────────────────────────────────────

const TerrainCanvas = dynamic(
  () => import("@/components/landing/TerrainCanvas"),
  { ssr: false, loading: () => null }
);

// ── Icon components ───────────────────────────────────────────────────────────

function MapPinIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" aria-hidden="true">
      <path d="M21 10c0 7-9 13-9 13s-9-6-9-13a9 9 0 0 1 18 0z" />
      <circle cx="12" cy="10" r="3" />
    </svg>
  );
}

function MountainIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20" aria-hidden="true">
      <path d="m8 3 4 8 5-5 5 15H2L8 3z" />
    </svg>
  );
}

function ChevronDownIcon() {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24" aria-hidden="true">
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  );
}

// ── Section label ─────────────────────────────────────────────────────────────

function SectionLabel({ children }: { children: React.ReactNode }) {
  return (
    <span
      style={{
        fontFamily: "var(--font-syne), sans-serif",
        fontSize: "11px",
        letterSpacing: "0.4em",
        color: "var(--text-muted)",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}

// ── Big section number ────────────────────────────────────────────────────────

function SectionNumber({ n }: { n: string }) {
  return (
    <div
      style={{
        fontFamily: "var(--font-syne), sans-serif",
        fontSize: "clamp(100px, 14vw, 180px)",
        fontWeight: 700,
        color: "var(--border)",
        lineHeight: 1,
        userSelect: "none",
        pointerEvents: "none",
      }}
      aria-hidden="true"
    >
      {n}
    </div>
  );
}

// ── Pain Point Card ───────────────────────────────────────────────────────────

function PainCard({
  icon,
  title,
  desc,
}: {
  icon: React.ReactNode;
  title: string;
  desc: string;
}) {
  return (
    <div
      className="reveal-up"
      style={{
        border: "1px solid var(--border)",
        background: "var(--bg-surface)",
        padding: "28px 32px",
        borderRadius: "2px",
      }}
    >
      <div style={{ color: "var(--accent-sage)", marginBottom: "12px" }}>{icon}</div>
      <h3
        style={{
          fontFamily: "var(--font-syne), sans-serif",
          fontSize: "16px",
          fontWeight: 600,
          color: "var(--text-primary)",
          marginBottom: "8px",
        }}
      >
        {title}
      </h3>
      <p
        style={{
          fontFamily: "var(--font-inter), sans-serif",
          fontSize: "14px",
          color: "var(--text-muted)",
          lineHeight: 1.6,
        }}
      >
        {desc}
      </p>
    </div>
  );
}

// ── Elevation SVG visual ──────────────────────────────────────────────────────

function ElevationVisual() {
  const pathRef = useRef<SVGPathElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const path = pathRef.current;
    const container = containerRef.current;
    if (!path || !container) return;
    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);

    const trigger = ScrollTrigger.create({
      trigger: container,
      start: "top 80%",
      onEnter: () => {
        gsap.to(path, {
          strokeDashoffset: 0,
          duration: 1.5,
          ease: "power2.out",
        });
      },
    });
    return () => trigger.kill();
  }, []);

  return (
    <div ref={containerRef} style={{ padding: "24px", width: "100%" }}>
      <svg viewBox="0 0 400 120" style={{ width: "100%", overflow: "visible" }}>
        <defs>
          <linearGradient id="elev-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4A7C59" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#4A7C59" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path
          d="M0 100 C30 100 40 60 60 45 C80 30 90 70 110 55 C130 40 140 20 160 15 C180 10 195 35 210 30 C225 25 240 50 260 45 C280 40 290 70 310 65 C330 60 350 30 380 25 L400 25 L400 120 L0 120 Z"
          fill="url(#elev-grad)"
        />
        <path
          ref={pathRef}
          d="M0 100 C30 100 40 60 60 45 C80 30 90 70 110 55 C130 40 140 20 160 15 C180 10 195 35 210 30 C225 25 240 50 260 45 C280 40 290 70 310 65 C330 60 350 30 380 25 L400 25"
          fill="none"
          stroke="var(--accent-sage)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <text x="8" y="18" fill="var(--accent-amber)" fontSize="9" fontFamily="var(--font-jetbrains)" fontWeight="500">
          D+ 847m
        </text>
        <text x="360" y="30" fill="var(--text-muted)" fontSize="8" fontFamily="var(--font-jetbrains)">
          30m precision
        </text>
      </svg>
    </div>
  );
}

// ── Session chips visual ──────────────────────────────────────────────────────

function SessionChipsVisual() {
  const chips = ["Fractionné", "Seuil", "Trail", "Endurance", "Gran Fondo", "Gravel", "MTB", "Récup"];
  return (
    <div style={{ padding: "24px", display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
      {chips.map((c, i) => (
        <span
          key={c}
          style={{
            fontFamily: "var(--font-syne), sans-serif",
            fontSize: "11px",
            padding: "6px 14px",
            borderRadius: "2px",
            border: "1px solid var(--border)",
            background: i === 0 || i === 2 ? "var(--accent-lime)" : "var(--bg-elevated)",
            color: i === 0 || i === 2 ? "var(--bg-deep)" : "var(--text-muted)",
            fontWeight: i === 0 || i === 2 ? 700 : 400,
          }}
        >
          {c}
        </span>
      ))}
    </div>
  );
}

// ── Route mockup visual ───────────────────────────────────────────────────────

function RouteMapVisual() {
  const pathRef = useRef<SVGPathElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const path = pathRef.current;
    const container = containerRef.current;
    if (!path || !container) return;
    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);

    const trigger = ScrollTrigger.create({
      trigger: container,
      start: "top 80%",
      onEnter: () => {
        gsap.to(path, {
          strokeDashoffset: 0,
          duration: 1.8,
          ease: "power2.out",
          delay: 0.2,
        });
      },
    });
    return () => trigger.kill();
  }, []);

  return (
    <div ref={containerRef} style={{ padding: "16px", width: "100%" }}>
      <svg viewBox="0 0 400 220" style={{ width: "100%", opacity: 0.9 }}>
        {/* Grid lines (map background) */}
        {[0, 40, 80, 120, 160, 200].map(y => (
          <line key={y} x1="0" y1={y} x2="400" y2={y} stroke="var(--border)" strokeWidth="0.5" />
        ))}
        {[0, 80, 160, 240, 320, 400].map(x => (
          <line key={x} x1={x} y1="0" x2={x} y2="220" stroke="var(--border)" strokeWidth="0.5" />
        ))}
        {/* Route */}
        <path
          ref={pathRef}
          d="M60 180 C80 180 100 160 120 140 C140 120 160 100 180 80 C200 60 220 50 250 60 C280 70 300 90 320 100 C340 110 360 130 340 160 C320 185 280 190 250 190 C200 195 120 200 60 180"
          fill="none"
          stroke="var(--accent-lime)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        {/* Start dot */}
        <circle cx="60" cy="180" r="5" fill="var(--accent-lime)" />
        <circle cx="60" cy="180" r="9" fill="none" stroke="var(--accent-lime)" strokeWidth="1.5" strokeOpacity="0.4" />
        {/* GPX badge */}
        <rect x="290" y="10" width="90" height="22" rx="2" fill="var(--accent-lime)" />
        <text x="335" y="25" textAnchor="middle" fontSize="10" fontFamily="var(--font-syne)" fontWeight="700" fill="var(--bg-deep)">
          Export GPX
        </text>
      </svg>
    </div>
  );
}

// ── GPS device icons ──────────────────────────────────────────────────────────

function GpsDevicesVisual() {
  return (
    <div style={{ padding: "32px", display: "flex", gap: "24px", alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
      {["Garmin", "Wahoo", "Suunto"].map(brand => (
        <div
          key={brand}
          style={{
            padding: "16px 24px",
            border: "1px solid var(--border)",
            borderRadius: "2px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "8px",
            background: "var(--bg-elevated)",
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28" style={{ color: "var(--accent-sage)" }}>
            <rect x="4" y="3" width="16" height="18" rx="2" />
            <circle cx="12" cy="14" r="3" />
            <line x1="12" y1="3" x2="12" y2="7" />
          </svg>
          <span style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "11px", color: "var(--text-muted)" }}>
            {brand}
          </span>
        </div>
      ))}
    </div>
  );
}

// ── Timeline section ──────────────────────────────────────────────────────────

function TimelineStep({
  num,
  title,
  desc,
  delay = 0,
}: {
  num: string;
  title: string;
  desc: string;
  delay?: number;
}) {
  const ref = useRevealOnScroll<HTMLDivElement>({ delay });
  return (
    <div
      ref={ref}
      className="reveal-up"
      style={{ display: "flex", flexDirection: "column", gap: "16px", alignItems: "flex-start" }}
    >
      <div
        style={{
          width: "40px",
          height: "40px",
          borderRadius: "50%",
          border: "1px solid var(--accent-moss)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          flexShrink: 0,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "14px",
            fontWeight: 500,
            color: "var(--accent-lime)",
          }}
        >
          {num}
        </span>
      </div>
      <div>
        <h3
          style={{
            fontFamily: "var(--font-syne), sans-serif",
            fontSize: "18px",
            fontWeight: 600,
            color: "var(--text-primary)",
            marginBottom: "8px",
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontFamily: "var(--font-inter), sans-serif",
            fontSize: "14px",
            color: "var(--text-muted)",
            lineHeight: 1.65,
          }}
        >
          {desc}
        </p>
      </div>
    </div>
  );
}

// ── Stat block ────────────────────────────────────────────────────────────────

function StatBlock({
  value,
  suffix = "",
  prefix = "",
  label,
}: {
  value: number;
  suffix?: string;
  prefix?: string;
  label: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
      <ScrambleNumber
        text={`${prefix}${value}${suffix}`}
        style={{
          fontFamily: "var(--font-playfair), serif",
          fontSize: "clamp(56px, 8vw, 80px)",
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
        {label}
      </span>
    </div>
  );
}

// ── Main landing page component ───────────────────────────────────────────────

export default function LandingPage({ showNewHero = false }: { showNewHero?: boolean }) {
  const prefersReducedMotion = usePrefersReducedMotion();

  const painCardsRef = useStaggerReveal<HTMLDivElement>(".reveal-up", {
    staggerMs: 150,
    threshold: 0.1,
  });

  // ── Section refs ────────────────────────────────────────────────────────────
  const heroSubRef   = useRef<HTMLParagraphElement>(null);
  const heroCtaRef   = useRef<HTMLDivElement>(null);
  const heroNavRef   = useRef<HTMLElement>(null);

  const statsSectionRef = useRevealOnScroll<HTMLDivElement>({
    threshold: 0.2,
    visibleClass: "is-visible",
  });

  const problemHeadingRef = useRevealOnScroll<HTMLDivElement>();

  // ── Hero entry animations ────────────────────────────────────────────────────
  useEffect(() => {
    if (prefersReducedMotion) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });

      // Subtitle
      if (heroSubRef.current) {
        gsap.set(heroSubRef.current, { opacity: 0, y: 20 });
        tl.to(heroSubRef.current, { opacity: 1, y: 0, duration: 0.7 }, 0.8);
      }

      // CTA
      if (heroCtaRef.current) {
        gsap.set(heroCtaRef.current, { opacity: 0, scale: 0.92 });
        tl.to(heroCtaRef.current, { opacity: 1, scale: 1, duration: 0.7 }, 1.1);
      }

      // Nav
      if (heroNavRef.current) {
        gsap.set(heroNavRef.current, { opacity: 0, y: -20 });
        tl.to(heroNavRef.current, { opacity: 1, y: 0, duration: 0.6 }, 1.5);
      }
    });

    return () => ctx.revert();
  }, [prefersReducedMotion]);

  return (
    <main className="custom-cursor" style={{ background: "var(--bg-deep)", color: "var(--text-primary)", overflowX: "hidden" }}>
      <CustomCursor />

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 1 — HERO
      ══════════════════════════════════════════════════════════════════════ */}
      <section
        style={{
          position: "relative",
          height: "100vh",
          overflow: "hidden",
          background: "var(--gradient-hero)",
          display: "flex",
          flexDirection: "column",
        }}
      >
        {/* Terrain canvas */}
        <TerrainCanvas cameraY={32} cameraZ={65} opacity={0.65} />

        {/* Grain */}
        <GrainOverlay opacity={0.035} />

        {/* Nav */}
        <nav
          ref={heroNavRef}
          className="py-6 md:py-7 px-6 md:px-10"
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-syne), sans-serif",
              fontSize: "13px",
              fontWeight: 700,
              letterSpacing: "0.3em",
              textTransform: "uppercase",
              color: "var(--text-primary)",
            }}
          >
            TRAILFORGE
          </span>
          <Link
            href="/app"
            style={{
              fontFamily: "var(--font-syne), sans-serif",
              fontSize: "12px",
              fontWeight: 600,
              letterSpacing: "0.1em",
              color: "var(--accent-lime)",
              textDecoration: "none",
              border: "1px solid rgba(168,214,114,0.3)",
              padding: "8px 20px",
              borderRadius: "2px",
              transition: "all 0.3s var(--ease-out-expo)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.background = "var(--accent-lime)";
              (e.currentTarget as HTMLElement).style.color = "var(--bg-deep)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.background = "";
              (e.currentTarget as HTMLElement).style.color = "var(--accent-lime)";
            }}
          >
            Ouvrir l&apos;app →
          </Link>
        </nav>

        {/* Hero content */}
        <div
          className="px-6 md:px-16 lg:px-32"
          style={{
            position: "relative",
            zIndex: 5,
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
          }}
        >
          <SectionLabel>Boucles trail prêtes pour montre</SectionLabel>

          <h1
            style={{
              fontFamily: "var(--font-playfair), serif",
              fontSize: "clamp(52px, 9vw, 96px)",
              fontStyle: "italic",
              fontWeight: 700,
              lineHeight: 1.05,
              marginTop: "24px",
              marginBottom: "28px",
              color: "var(--text-primary)",
            }}
          >
            {showNewHero ? (
              <>
                <TextReveal as="span" trigger="mount" splitType="chars" stagger={0.03} delay={0.3}>
                  Trace ta boucle,
                </TextReveal>
                <TextReveal as="span" trigger="mount" splitType="chars" stagger={0.03} delay={0.6} style={{ color: "var(--accent-lime)" }}>
                  lance-toi.
                </TextReveal>
              </>
            ) : (
              <>
                <TextReveal as="span" trigger="mount" splitType="chars" stagger={0.03} delay={0.3}>
                  Trace ta
                </TextReveal>
                <TextReveal as="span" trigger="mount" splitType="chars" stagger={0.03} delay={0.6} style={{ color: "var(--accent-lime)" }}>
                  boucle.
                </TextReveal>
              </>
            )}
          </h1>

          <div ref={heroSubRef} style={{ marginBottom: "40px", textAlign: "center" }}>
            <p style={{
              fontFamily: "var(--font-inter), sans-serif",
              fontSize: "clamp(17px, 2.2vw, 22px)",
              color: "var(--text-muted)",
              maxWidth: "520px",
              lineHeight: 1.7,
              margin: "0 auto",
            }}>
              Distance, D+, surface : tu fixes les règles.
              <br />
              TrailForge trace une boucle trail fiable, exportable sur ta montre.
            </p>
          </div>

          <div ref={heroCtaRef} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
            <MagneticButton href="/app">Créer ma première boucle</MagneticButton>
            <p style={{
              fontFamily: "var(--font-inter), sans-serif",
              fontSize: "13px",
              color: "var(--text-muted)",
              marginTop: "12px",
              opacity: 0.7,
            }}>
              Gratuit, sans inscription
            </p>
            <div style={{
              marginTop: "48px",
              opacity: 0.5,
              maxWidth: "320px",
              width: "100%",
            }}>
              <svg viewBox="0 0 320 80" style={{ width: "100%" }}>
                {/* Simplified route line */}
                <path
                  d="M20 60 C60 60 80 20 120 25 C160 30 180 55 220 40 C260 25 280 35 300 30"
                  fill="none"
                  stroke="var(--accent-lime)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  opacity="0.6"
                />
                {/* Start point */}
                <circle cx="20" cy="60" r="4" fill="var(--accent-lime)" opacity="0.8" />
                {/* End point */}
                <circle cx="300" cy="30" r="4" fill="var(--accent-lime)" opacity="0.8" />
                {/* Distance label */}
                <text x="160" y="75" textAnchor="middle" fontSize="10" fontFamily="var(--font-jetbrains)" fill="var(--text-muted)" opacity="0.6">
                  14.2 km · D+ 312m
                </text>
              </svg>
            </div>
          </div>
        </div>

        {/* Scroll indicator */}
        <div
          style={{
            position: "absolute",
            bottom: "32px",
            left: "50%",
            transform: "translateX(-50%)",
            zIndex: 10,
            animation: "fade-up 1s var(--ease-out-expo) 2s both",
          }}
        >
          <div
            className="animate-bounce"
            style={{
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: "4px",
              color: "var(--text-muted)",
              opacity: 0.6,
            }}
          >
            <ChevronDownIcon />
          </div>
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 2 — PROBLEM STATEMENT
      ══════════════════════════════════════════════════════════════════════ */}
      <section
        className="grid grid-cols-1 md:grid-cols-2"
        style={{
          minHeight: "100vh",
          background: "var(--bg-deep)",
          gap: 0,
        }}
      >
        {/* Left sticky column */}
        <div
          className="md:sticky md:top-0 md:h-screen py-16 md:py-20 px-6 md:px-12 lg:px-20 md:border-r border-border"
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
          }}
        >
          <div ref={problemHeadingRef} className="reveal-up">
            <SectionNumber n="01" />
            <h2
              style={{
                fontFamily: "var(--font-playfair), serif",
                fontSize: "clamp(28px, 4vw, 48px)",
                fontStyle: "italic",
                color: "var(--text-primary)",
                lineHeight: 1.25,
                marginTop: "16px",
                marginBottom: "24px",
              }}
            >
              <TextReveal trigger="scroll" splitType="words">
                Aucun outil ne génère vraiment les parcours.
              </TextReveal>
            </h2>
            <p
              style={{
                fontFamily: "var(--font-inter), sans-serif",
                fontSize: "15px",
                color: "var(--text-muted)",
                lineHeight: 1.75,
              }}
            >
              Les traileurs passent trop de temps à bricoler des boucles sur plusieurs outils.
              Distance, D+, surface, export montre : chaque compromis peut ruiner la sortie.
            </p>
          </div>
        </div>

        {/* Right scrolling column — pain point cards */}
        <div
          ref={painCardsRef as React.RefObject<HTMLDivElement>}
          className="py-16 md:py-20 px-6 md:px-12 lg:px-20"
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "24px",
          }}
        >
          <PainCard
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
            title="Tu perds 20 minutes avant même de courir"
            desc="Entre carte, relief, surface et GPX, préparer une boucle fiable prend plus de temps que ça ne devrait."
          />
          <PainCard
            icon={<MapPinIcon />}
            title="La boucle ne respecte pas ta sortie"
            desc="Tu demandes 12 km avec du D+ et tu finis avec une boucle trop plate, trop courte ou trop urbaine."
          />
          <PainCard
            icon={<MountainIcon />}
            title="Tu découvres les problèmes sur le terrain"
            desc="Trop de bitume, route passante, chemin douteux, boucle mal fermée : une mauvaise trace coûte une vraie sortie."
          />
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 3 — HOW IT WORKS
      ══════════════════════════════════════════════════════════════════════ */}
      <section
        className="py-20 md:py-28 lg:py-32 px-6 md:px-16 lg:px-32"
        style={{
          background: "linear-gradient(180deg, var(--bg-deep) 0%, var(--bg-surface) 100%)",
          borderTop: "1px solid var(--border)",
        }}
      >
        <div style={{ textAlign: "center", marginBottom: "80px" }}>
          <SectionNumber n="02" />
          <h2
            style={{
              fontFamily: "var(--font-playfair), serif",
              fontSize: "clamp(28px, 4vw, 48px)",
              fontStyle: "italic",
              color: "var(--text-primary)",
              marginTop: "8px",
            }}
          >
            <TextReveal trigger="scroll" splitType="words">
              TrailForge fait le travail.
            </TextReveal>
          </h2>
        </div>

        {/* Timeline */}
        <div
          className="grid grid-cols-1 md:grid-cols-3"
          style={{
            gap: "clamp(24px, 4vw, 60px)",
            position: "relative",
          }}
        >
          {/* Connecting line (decorative) */}
          <div
            className="hidden md:block"
            aria-hidden="true"
            style={{
              position: "absolute",
              top: "20px",
              left: "calc(16.67% + 20px)",
              right: "calc(16.67% + 20px)",
              height: "1px",
              background: "linear-gradient(90deg, transparent, var(--accent-moss) 30%, var(--accent-moss) 70%, transparent)",
              pointerEvents: "none",
            }}
          />

          <TimelineStep
            num="01"
            title="Décris ta séance"
            desc="Choisis ton départ, ta distance, ton D+ cible et le niveau de terrain naturel attendu."
            delay={0}
          />
          <TimelineStep
            num="02"
            title="TrailForge vérifie"
            desc="Le moteur cherche une vraie boucle et signale les compromis : trop de route, D+ approximatif, boucle imparfaite."
            delay={150}
          />
          <TimelineStep
            num="03"
            title="Lance-toi"
            desc="Export GPX direct vers Garmin, COROS, Suunto ou Strava. Tu synchronises, tu cours."
            delay={300}
          />
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 4 — FEATURE SHOWCASE
      ══════════════════════════════════════════════════════════════════════ */}
      <section style={{ background: "var(--bg-surface)", borderTop: "1px solid var(--border)" }}>
        <div className="py-16 md:py-20 px-6 md:px-16 lg:px-32 pb-10" style={{ textAlign: "center" }}>
          <h2
            style={{
              fontFamily: "var(--font-playfair), serif",
              fontSize: "clamp(28px, 4vw, 48px)",
              fontStyle: "italic",
              color: "var(--text-primary)",
            }}
          >
            <TextReveal trigger="scroll" splitType="words">
              Tout ce dont tu as besoin.
            </TextReveal>
          </h2>
        </div>

        <StackingFeatureCards
          cards={[
            {
              badge: "D+ contrôlé",
              title: "Le dénivelé compte vraiment.",
              desc: "TrailForge vise ton D+ et affiche les compromis quand le terrain local ne permet pas de respecter la séance.",
              visual: <ElevationVisual />,
            },
            {
              badge: "Profil trail",
              title: "Moins de bitume, plus de terrain.",
              desc: "Le scoring privilégie sentiers, chemins, parcs et corridors naturels au lieu de tracer une simple boucle urbaine.",
              visual: <SessionChipsVisual />,
            },
            {
              badge: "Export GPX universel",
              title: "Prêt pour ta montre.",
              desc: "Format GPX propre, compatible Garmin, COROS, Suunto et Strava. Tu exportes, tu synchronises, tu pars.",
              visual: <RouteMapVisual />,
            },
            {
              badge: "Confiance terrain",
              title: "Pas de fausse promesse.",
              desc: "Si la boucle est contrainte, TrailForge l’indique clairement : distance ajustée, D+ approximatif ou trop de route.",
              visual: <GpsDevicesVisual />,
            },
          ]}
        />
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 5 — STATS
      ══════════════════════════════════════════════════════════════════════ */}
      <section
        style={{
          minHeight: "60vh",
          background: "var(--bg-deep)",
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          padding: "80px clamp(24px, 8vw, 120px)",
        }}
      >
        <div
          ref={statsSectionRef}
          className="reveal-fade grid grid-cols-1 sm:grid-cols-3"
          style={{
            gap: "clamp(32px, 6vw, 80px)",
            width: "100%",
            maxWidth: "900px",
            textAlign: "center",
          }}
        >
          <StatBlock value={1} label="Promesse trail claire" />
          <StatBlock value={10} suffix="s" prefix="< " label="Temps de génération" />
          <StatBlock value={30} suffix="%+" label="Objectif export GPX beta" />
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 6 — CTA FINAL
      ══════════════════════════════════════════════════════════════════════ */}
      <section
        className="min-h-screen"
        style={{
          position: "relative",
          overflow: "hidden",
          background: "var(--bg-deep)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          borderTop: "1px solid var(--border)",
        }}
      >
        {/* Different terrain angle */}
        <TerrainCanvas cameraY={50} cameraZ={40} opacity={0.5} />
        <GrainOverlay opacity={0.03} />

        <div
          className="px-6 md:px-16 lg:px-32"
          style={{
            position: "relative",
            zIndex: 5,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "32px",
          }}
        >
          <h2
            style={{
              fontFamily: "var(--font-playfair), serif",
              fontSize: "clamp(32px, 5vw, 64px)",
              fontStyle: "italic",
              color: "var(--text-primary)",
              lineHeight: 1.2,
              maxWidth: "700px",
            }}
          >
            <TextReveal trigger="scroll" splitType="words">
              Prêt à tracer une vraie boucle trail ?
            </TextReveal>
          </h2>

          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", justifyContent: "center" }}>
            <MagneticButton href="/app">Créer ma première boucle</MagneticButton>
            <MagneticButton href="https://github.com" primary={false}>
              Voir la doc
            </MagneticButton>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer
        className="py-8 px-6 md:px-16 lg:px-32"
        style={{
          borderTop: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          flexWrap: "wrap",
          gap: "16px",
          background: "var(--bg-surface)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-syne), sans-serif",
            fontSize: "12px",
            letterSpacing: "0.2em",
            color: "var(--text-muted)",
          }}
        >
          TRAILFORGE
        </span>
        <span
          style={{
            fontFamily: "var(--font-inter), sans-serif",
            fontSize: "12px",
            color: "var(--text-muted)",
          }}
        >
          Projet personnel · Tous droits réservés
        </span>
        <div style={{ display: "flex", gap: "24px" }}>
          <Link href="/app" style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "var(--text-muted)", textDecoration: "none" }}>
            Application
          </Link>
          <a href="https://github.com" style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "var(--text-muted)", textDecoration: "none" }}>
            GitHub
          </a>
        </div>
      </footer>

    </main>
  );
}
