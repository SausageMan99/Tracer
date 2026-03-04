"use client";

import dynamic from "next/dynamic";
import Link from "next/link";
import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";
import GrainOverlay from "@/components/ui/GrainOverlay";
import NumberTicker from "@/components/ui/NumberTicker";
import { useRevealOnScroll, useStaggerReveal } from "@/hooks/useScrollAnimation";

// ── Dynamic import for WebGL (no SSR) ─────────────────────────────────────────

const TerrainCanvas = dynamic(
  () => import("@/components/landing/TerrainCanvas"),
  { ssr: false, loading: () => null }
);

gsap.registerPlugin(ScrollTrigger);

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

// ── Feature row ───────────────────────────────────────────────────────────────

function FeatureRow({
  reverse = false,
  badge,
  title,
  desc,
  visual,
}: {
  reverse?: boolean;
  badge: string;
  title: string;
  desc: string;
  visual: React.ReactNode;
}) {
  const ref = useRevealOnScroll<HTMLDivElement>({ threshold: 0.1 });
  return (
    <div
      ref={ref}
      className="reveal-up"
      style={{
        display: "grid",
        gridTemplateColumns: "1fr 1fr",
        gap: "clamp(32px, 6vw, 80px)",
        alignItems: "center",
        padding: "80px clamp(24px, 8vw, 120px)",
        borderTop: "1px solid var(--border)",
      }}
    >
      <div style={{ order: reverse ? 2 : 1 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            padding: "4px 12px",
            borderRadius: "2px",
            marginBottom: "20px",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-syne), sans-serif",
              fontSize: "10px",
              letterSpacing: "0.2em",
              color: "var(--accent-sage)",
              textTransform: "uppercase",
            }}
          >
            {badge}
          </span>
        </div>
        <h3
          style={{
            fontFamily: "var(--font-playfair), serif",
            fontSize: "clamp(24px, 3vw, 36px)",
            fontStyle: "italic",
            color: "var(--text-primary)",
            marginBottom: "16px",
            lineHeight: 1.3,
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontFamily: "var(--font-inter), sans-serif",
            fontSize: "15px",
            color: "var(--text-muted)",
            lineHeight: 1.7,
          }}
        >
          {desc}
        </p>
      </div>
      <div
        style={{
          order: reverse ? 1 : 2,
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "2px",
          overflow: "hidden",
          aspectRatio: "16/9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {visual}
      </div>
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

// ── Strava heatmap visual ─────────────────────────────────────────────────────

function StravaHeatmapVisual() {
  const containerRef = useRef<HTMLDivElement>(null);
  const cellsRef = useRef<HTMLDivElement[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;

    // Start all cells invisible
    cellsRef.current.forEach((cell) => {
      if (cell) gsap.set(cell, { opacity: 0, scale: 0.4 });
    });

    const trigger = ScrollTrigger.create({
      trigger: container,
      start: "top 80%",
      once: true,
      onEnter: () => {
        cellsRef.current.forEach((cell, i) => {
          if (!cell) return;
          gsap.to(cell, {
            opacity: 1,
            scale: 1,
            duration: 0.4,
            delay: i * 0.015,
            ease: "back.out(1.4)",
          });
        });
      },
    });
    return () => trigger.kill();
  }, []);

  // Build a 12×7 grid simulating heatmap intensity
  const cols = 12;
  const heatData: number[][] = [
    [0, 0, 1, 2, 2, 3, 4, 3, 2, 1, 0, 0],
    [0, 1, 2, 3, 4, 5, 5, 4, 3, 2, 1, 0],
    [1, 2, 3, 5, 6, 7, 8, 7, 5, 3, 2, 1],
    [0, 1, 3, 5, 7, 9, 9, 7, 5, 3, 1, 0],
    [0, 0, 2, 4, 5, 6, 6, 5, 4, 2, 0, 0],
    [0, 0, 1, 2, 3, 4, 4, 3, 2, 1, 0, 0],
    [0, 0, 0, 1, 1, 2, 2, 1, 1, 0, 0, 0],
  ];

  const maxVal = 9;
  const colors = [
    "transparent",
    "rgba(252,70,107,0.08)",
    "rgba(252,70,107,0.15)",
    "rgba(252,70,107,0.25)",
    "rgba(252,70,107,0.35)",
    "rgba(252,70,107,0.45)",
    "rgba(252,70,107,0.58)",
    "rgba(252,70,107,0.70)",
    "rgba(252,70,107,0.82)",
    "rgba(252,70,107,0.95)",
  ];

  let cellIndex = 0;

  return (
    <div
      ref={containerRef}
      style={{ padding: "24px", width: "100%", display: "flex", flexDirection: "column", gap: "12px" }}
    >
      {/* Strava-orange label */}
      <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "4px" }}>
        <svg viewBox="0 0 24 24" fill="#FC461B" width="14" height="14">
          <path d="M15.387 17.944l-2.089-4.116h-3.065L15.387 24l5.15-10.172h-3.066m-7.008-5.599l2.836 5.598h4.172L10.463 0l-7 13.828h4.169" />
        </svg>
        <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "9px", color: "rgba(252,70,107,0.7)", letterSpacing: "0.15em" }}>
          ACTIVITÉ LOCALE · 847 ATHLÈTES
        </span>
      </div>

      {/* Grid */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: `repeat(${cols}, 1fr)`,
          gap: "3px",
        }}
      >
        {heatData.map((row, ri) =>
          row.map((val, ci) => {
            const idx = cellIndex++;
            return (
              <div
                key={`${ri}-${ci}`}
                ref={(el) => { if (el) cellsRef.current[idx] = el; }}
                style={{
                  aspectRatio: "1",
                  borderRadius: "2px",
                  background: colors[Math.min(val, maxVal)],
                  border: val > 0 ? "1px solid rgba(252,70,107,0.12)" : "none",
                }}
              />
            );
          })
        )}
      </div>

      {/* Legend */}
      <div style={{ display: "flex", alignItems: "center", gap: "4px", marginTop: "4px" }}>
        <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "8px", color: "var(--text-muted)" }}>Faible</span>
        {[0.1, 0.25, 0.45, 0.65, 0.9].map((o) => (
          <div key={o} style={{ width: "16px", height: "6px", borderRadius: "1px", background: `rgba(252,70,107,${o})` }} />
        ))}
        <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "8px", color: "var(--text-muted)" }}>Fort</span>
      </div>
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
  from = 0,
  suffix = "",
  prefix = "",
  label,
}: {
  value: number;
  from?: number;
  suffix?: string;
  prefix?: string;
  label: string;
}) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "12px", alignItems: "center" }}>
      <NumberTicker
        from={from}
        to={value}
        suffix={suffix}
        prefix={prefix}
        duration={1.8}
        style={{
          fontFamily: "var(--font-playfair), serif",
          fontSize: "clamp(56px, 8vw, 80px)",
          fontStyle: "italic",
          color: "var(--accent-lime)",
          lineHeight: 1,
        } as React.CSSProperties}
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

// ── CTA Button ────────────────────────────────────────────────────────────────

function CtaButton({
  href,
  children,
  primary = true,
}: {
  href: string;
  children: React.ReactNode;
  primary?: boolean;
}) {
  const base: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    gap: "8px",
    padding: "16px 36px",
    borderRadius: "2px",
    fontFamily: "var(--font-syne), sans-serif",
    fontSize: "14px",
    fontWeight: 600,
    letterSpacing: "0.1em",
    textTransform: "uppercase" as const,
    textDecoration: "none",
    transition: "all 0.4s cubic-bezier(0.16,1,0.3,1)",
    cursor: "pointer",
  };
  const primaryStyle: React.CSSProperties = {
    ...base,
    background: "var(--accent-lime)",
    color: "var(--bg-deep)",
    border: "1px solid transparent",
  };
  const ghostStyle: React.CSSProperties = {
    ...base,
    background: "transparent",
    color: "var(--text-muted)",
    border: "1px solid var(--border)",
  };
  return (
    <Link
      href={href}
      style={primary ? primaryStyle : ghostStyle}
      onMouseEnter={(e) => {
        const el = e.currentTarget;
        if (primary) {
          el.style.transform = "scale(1.02)";
          el.style.boxShadow = "0 0 32px rgba(168,214,114,0.25)";
        } else {
          el.style.borderColor = "var(--accent-moss)";
          el.style.color = "var(--text-primary)";
        }
      }}
      onMouseLeave={(e) => {
        const el = e.currentTarget;
        el.style.transform = "";
        el.style.boxShadow = "";
        if (!primary) {
          el.style.borderColor = "var(--border)";
          el.style.color = "var(--text-muted)";
        }
      }}
    >
      {children}
    </Link>
  );
}

// ── Main landing page component ───────────────────────────────────────────────

export default function LandingPage({ showNewHero = false }: { showNewHero?: boolean }) {
  const painCardsRef = useStaggerReveal<HTMLDivElement>(".reveal-up", {
    staggerMs: 150,
    threshold: 0.1,
  });

  // ── Section refs ────────────────────────────────────────────────────────────
  const heroTitleRef = useRef<HTMLHeadingElement>(null);
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
    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });

      // Title lines
      const titleLines = heroTitleRef.current?.querySelectorAll(".hero-line");
      if (titleLines?.length) {
        gsap.set(titleLines, { clipPath: "inset(100% 0 0 0)" });
        tl.to(
          titleLines,
          {
            clipPath: "inset(0% 0 0 0)",
            duration: 1.2,
            stagger: 0.15,
          },
          0.3
        );
      }

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
  }, []);

  return (
    <main style={{ background: "var(--bg-deep)", color: "var(--text-primary)", overflowX: "hidden" }}>

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
          style={{
            position: "absolute",
            top: 0,
            left: 0,
            right: 0,
            zIndex: 10,
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            padding: "28px 40px",
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
          style={{
            position: "relative",
            zIndex: 5,
            flex: 1,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            textAlign: "center",
            padding: "0 clamp(24px, 8vw, 120px)",
          }}
        >
          <SectionLabel>Générateur de parcours GPS</SectionLabel>

          {showNewHero ? (
            <h1
              ref={heroTitleRef}
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
              <span className="hero-line">Ton terrain,</span>
              <span className="hero-line" style={{ color: "var(--accent-lime)" }}>
                ton parcours.
              </span>
            </h1>
          ) : (
            <h1
              ref={heroTitleRef}
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
              <span className="hero-line">Forge ton</span>
              <span className="hero-line" style={{ color: "var(--accent-lime)" }}>
                parcours.
              </span>
            </h1>
          )}

          <p
            ref={heroSubRef}
            style={{
              fontFamily: "var(--font-inter), sans-serif",
              fontSize: "clamp(15px, 2vw, 18px)",
              color: "var(--text-muted)",
              maxWidth: "480px",
              lineHeight: 1.7,
              marginBottom: "40px",
            }}
          >
            Génère un parcours adapté à ta séance en 10 secondes.
            D+, distance, surface — zéro compromis.
          </p>

          <div ref={heroCtaRef}>
            <CtaButton href="/app">Générer mon parcours</CtaButton>
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
        style={{
          minHeight: "100vh",
          background: "var(--bg-deep)",
          display: "grid",
          gridTemplateColumns: "1fr 1fr",
          gap: 0,
        }}
      >
        {/* Left sticky column */}
        <div
          style={{
            position: "sticky",
            top: 0,
            height: "100vh",
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            padding: "80px clamp(24px, 6vw, 80px)",
            borderRight: "1px solid var(--border)",
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
              Aucun outil ne génère vraiment les parcours.
            </h2>
            <p
              style={{
                fontFamily: "var(--font-inter), sans-serif",
                fontSize: "15px",
                color: "var(--text-muted)",
                lineHeight: 1.75,
              }}
            >
              Les runners et cyclistes passent des heures à planifier manuellement.
              Trouver un parcours qui corresponde exactement à une séance spécifique
              est fastidieux, imprécis, et souvent décevant.
            </p>
          </div>
        </div>

        {/* Right scrolling column — pain point cards */}
        <div
          ref={painCardsRef as React.RefObject<HTMLDivElement>}
          style={{
            display: "flex",
            flexDirection: "column",
            justifyContent: "center",
            gap: "24px",
            padding: "120px clamp(24px, 6vw, 80px)",
          }}
        >
          <PainCard
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
            title="Tu cherches sur Maps pendant 20 minutes"
            desc="Planifier un parcours manuellement prend du temps, de l'énergie, et tu n'es jamais sûr du résultat avant de partir."
          />
          <PainCard
            icon={<MapPinIcon />}
            title="Le parcours ne correspond pas à ta séance"
            desc="Un jour de fractionné, le lendemain un long. Chaque séance a des besoins différents que les outils généralistes ignorent."
          />
          <PainCard
            icon={<MountainIcon />}
            title="Tu rates ton D+ ou tu te retrouves en city run"
            desc="Trop peu de dénivelé pour ta sortie montagne, ou trop d'asphalte pour ta sortie trail. Les compromis s'accumulent."
          />
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 3 — HOW IT WORKS
      ══════════════════════════════════════════════════════════════════════ */}
      <section
        style={{
          background: "linear-gradient(180deg, var(--bg-deep) 0%, var(--bg-surface) 100%)",
          padding: "120px clamp(24px, 8vw, 120px)",
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
            TrailForge fait le travail.
          </h2>
        </div>

        {/* Timeline */}
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "clamp(24px, 4vw, 60px)",
            position: "relative",
          }}
        >
          {/* Connecting line (decorative) */}
          <div
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
            desc="Sport, profil de séance, distance et dénivelé. En 5 secondes, TrailForge sait exactement ce dont tu as besoin."
            delay={0}
          />
          <TimelineStep
            num="02"
            title="TrailForge calcule"
            desc="Jusqu'à 847 candidats analysés. D+ au mètre près, terrain, boucle — le meilleur parcours est sélectionné automatiquement."
            delay={150}
          />
          <TimelineStep
            num="03"
            title="Lance-toi"
            desc="Export GPX direct vers ta montre. Garmin, Wahoo, Suunto — prêt à partir en 10 secondes."
            delay={300}
          />
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 4 — FEATURE SHOWCASE
      ══════════════════════════════════════════════════════════════════════ */}
      <section style={{ background: "var(--bg-surface)", borderTop: "1px solid var(--border)" }}>
        <div style={{ textAlign: "center", padding: "80px clamp(24px, 8vw, 120px) 0" }}>
          <h2
            style={{
              fontFamily: "var(--font-playfair), serif",
              fontSize: "clamp(28px, 4vw, 48px)",
              fontStyle: "italic",
              color: "var(--text-primary)",
            }}
          >
            Tout ce dont tu as besoin.
          </h2>
        </div>

        <FeatureRow
          badge="Profil altimétrique"
          title="D+ calculé au mètre près."
          desc="Données Open-Meteo à 30m de résolution. Gradient max, régularité, dénivelé positif et négatif. Tout est là, précis."
          visual={<ElevationVisual />}
        />

        <FeatureRow
          reverse
          badge="14 profils de séance"
          title="Chaque séance, son parcours."
          desc="Fractionné 30/30, seuil lactique, gran fondo, trail — chaque profil a ses propres critères de scoring. Zéro compromis."
          visual={<SessionChipsVisual />}
        />

        <FeatureRow
          badge="Export GPX universel"
          title="Prêt pour ta montre."
          desc="Transfert direct vers Garmin, Wahoo ou Suunto. Format GPX 1.1 avec élévation sur chaque point. Prêt à partir en 10 secondes."
          visual={<RouteMapVisual />}
        />

        <FeatureRow
          reverse
          badge="Compatibilité matériel"
          title="Toutes les marques supportées."
          desc="GPX 1.1, timestamps synthétiques pour Wahoo, élévation sur chaque trackpoint pour Garmin. Aucune configuration requise."
          visual={<GpsDevicesVisual />}
        />

        <FeatureRow
          badge="Mode Scenic"
          title="Vois où les autres s'entraînent."
          desc="Superpose les données d'activité Strava sur ta carte. Identifie les zones les plus empruntées, découvre des itinéraires locaux populaires et optimise ton parcours selon les préférences de la communauté."
          visual={<StravaHeatmapVisual />}
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
          className="reveal-fade"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(3, 1fr)",
            gap: "clamp(32px, 6vw, 80px)",
            width: "100%",
            maxWidth: "900px",
            textAlign: "center",
          }}
        >
          <StatBlock value={14} label="Profils de séance" />
          <StatBlock value={10} suffix="s" prefix="< " label="Temps de génération" />
          <StatBlock value={3} label="Moteurs de routage" />
        </div>
      </section>

      {/* ═══════════════════════════════════════════════════════════════════════
          SECTION 6 — CTA FINAL
      ══════════════════════════════════════════════════════════════════════ */}
      <section
        style={{
          position: "relative",
          height: "100vh",
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
          style={{
            position: "relative",
            zIndex: 5,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "32px",
            padding: "0 clamp(24px, 8vw, 120px)",
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
            Prêt à forger ton premier parcours ?
          </h2>

          <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", justifyContent: "center" }}>
            <CtaButton href="/app">Ouvrir TrailForge</CtaButton>
            <CtaButton href="https://github.com" primary={false}>
              Voir la doc
            </CtaButton>
          </div>
        </div>
      </section>

      {/* ── Footer ──────────────────────────────────────────────────────────── */}
      <footer
        style={{
          borderTop: "1px solid var(--border)",
          padding: "32px clamp(24px, 8vw, 120px)",
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
