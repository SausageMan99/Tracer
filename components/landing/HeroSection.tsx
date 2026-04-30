"use client";

import { useEffect, useRef } from "react";
import Link from "next/link";
import dynamic from "next/dynamic";
import { gsap } from "@/lib/gsap-setup";
import GrainOverlay from "@/components/ui/GrainOverlay";
import TextReveal from "@/components/ui/TextReveal";
import MagneticButton from "@/components/ui/MagneticButton";
import SectionLabel from "@/components/landing/shared/SectionLabel";

const TerrainCanvas = dynamic(
  () => import("@/components/landing/TerrainCanvas"),
  { ssr: false, loading: () => null },
);

export default function HeroSection() {
  const heroSubRef = useRef<HTMLDivElement>(null);
  const heroCtaRef = useRef<HTMLDivElement>(null);
  const heroNavRef = useRef<HTMLElement>(null);
  
  useEffect(() => {
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({ defaults: { ease: "expo.out" } });

      if (heroSubRef.current) {
        gsap.set(heroSubRef.current, { opacity: 0, y: 20 });
        tl.to(heroSubRef.current, { opacity: 1, y: 0, duration: 0.7 }, 0.8);
      }
      if (heroCtaRef.current) {
        gsap.set(heroCtaRef.current, { opacity: 0, scale: 0.92 });
        tl.to(heroCtaRef.current, { opacity: 1, scale: 1, duration: 0.7 }, 1.1);
      }
      if (heroNavRef.current) {
        gsap.set(heroNavRef.current, { opacity: 0, y: -20 });
        tl.to(heroNavRef.current, { opacity: 1, y: 0, duration: 0.6 }, 1.5);
      }
    });

    return () => ctx.revert();
  }, []);

  return (
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
      <TerrainCanvas cameraY={34} cameraZ={68} opacity={0.28} />
      <div
        className="topo-surface"
        style={{
          position: "absolute",
          inset: 0,
          zIndex: 1,
          backgroundColor: "rgba(5,8,6,0.76)",
        }}
        aria-hidden="true"
      />
      <div
        style={{
          position: "absolute",
          inset: "12% 8% auto auto",
          zIndex: 2,
          width: "min(420px, 42vw)",
          height: "min(420px, 42vw)",
          borderRadius: "999px",
          background: "radial-gradient(circle, rgba(196,216,107,0.20), transparent 68%)",
          filter: "blur(8px)",
        }}
        aria-hidden="true"
      />

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
            borderRadius: "var(--radius-control)",
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
        <SectionLabel>GPS field lab · trail only</SectionLabel>

        <h1
          style={{
            fontFamily: "var(--font-playfair), serif",
            fontSize: "clamp(40px, 9vw, 110px)",
            fontStyle: "italic",
            fontWeight: 700,
            lineHeight: 1.05,
            marginTop: "24px",
            marginBottom: "28px",
            color: "var(--text-primary)",
          }}
        >
          <TextReveal as="span" trigger="mount" splitType="chars" stagger={0.03} delay={0.3}>
            Boucles trail
          </TextReveal>
          <br />
          <TextReveal
            as="span"
            trigger="mount"
            splitType="chars"
            stagger={0.03}
            delay={0.6}
            style={{ color: "var(--accent-lime)" }}
          >
            sans bricolage.
          </TextReveal>
        </h1>

        <div ref={heroSubRef} style={{ marginBottom: "40px", textAlign: "center" }}>
          <p
            style={{
              fontFamily: "var(--font-inter), sans-serif",
              fontSize: "clamp(17px, 2.2vw, 22px)",
              color: "var(--text-muted)",
              maxWidth: "540px",
              lineHeight: 1.7,
              margin: "0 auto",
            }}
          >
            5–15 km, D+ cible, surface nature. TrailForge affiche les compromis avant que tu partes courir.
          </p>
        </div>

        <div ref={heroCtaRef} style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <MagneticButton href="/app">Tracer une boucle test</MagneticButton>
          <p
            style={{
              fontFamily: "var(--font-inter), sans-serif",
              fontSize: "13px",
              color: "var(--text-muted)",
              marginTop: "12px",
              opacity: 0.7,
            }}
          >
            Gratuit · sans inscription · pensé pour montre GPS
          </p>
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
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="24" height="24" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
          </svg>
        </div>
      </div>
    </section>
  );
}
