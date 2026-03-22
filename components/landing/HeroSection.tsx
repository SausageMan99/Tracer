"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import GrainOverlay from "@/components/ui/GrainOverlay";
import TextReveal from "@/components/ui/TextReveal";
import MagneticButton from "@/components/ui/MagneticButton";
import SectionLabel from "@/components/landing/shared/SectionLabel";

export default function HeroSection() {
  const videoRef = useRef<HTMLVideoElement>(null);
  const [videoFailed, setVideoFailed] = useState(false);

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
      {/* Video background */}
      {!videoFailed && (
        <>
          <video
            ref={videoRef}
            autoPlay
            muted
            loop
            playsInline
            onError={() => setVideoFailed(true)}
            style={{
              position: "absolute",
              inset: 0,
              width: "100%",
              height: "100%",
              objectFit: "cover",
              zIndex: 0,
            }}
          >
            <source src="/hero.mp4" type="video/mp4" />
          </video>
          <div
            style={{
              position: "absolute",
              inset: 0,
              background: "rgba(8, 12, 10, 0.65)",
              zIndex: 1,
            }}
            aria-hidden="true"
          />
        </>
      )}

      <GrainOverlay opacity={0.035} />

      {/* Nav */}
      <nav
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
            fontFamily: "var(--font-ui), sans-serif",
            fontSize: "13px",
            fontWeight: 700,
            letterSpacing: "0.3em",
            textTransform: "uppercase",
            color: "var(--app-text-primary)",
          }}
        >
          TRAILFORGE
        </span>
        <Link
          href="/app"
          style={{
            fontFamily: "var(--font-ui), sans-serif",
            fontSize: "12px",
            fontWeight: 600,
            letterSpacing: "0.1em",
            color: "var(--app-accent-lime)",
            textDecoration: "none",
            border: "1px solid rgba(168,214,114,0.3)",
            padding: "8px 20px",
            borderRadius: "2px",
            transition: "all 0.3s var(--ease-out-expo)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "var(--app-accent-lime)";
            (e.currentTarget as HTMLElement).style.color = "var(--app-bg-deep)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "";
            (e.currentTarget as HTMLElement).style.color = "var(--app-accent-lime)";
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
        <SectionLabel>Générateur de parcours GPS</SectionLabel>

        <h1
          style={{
            fontFamily: "var(--font-heading), serif",
            fontSize: "clamp(40px, 9vw, 110px)",
            fontStyle: "italic",
            fontWeight: 700,
            lineHeight: 1.05,
            marginTop: "24px",
            marginBottom: "28px",
            color: "var(--app-text-primary)",
          }}
        >
          <TextReveal as="span" trigger="mount" splitType="chars" stagger={0.03} delay={0.3}>
            Ton terrain
          </TextReveal>
          <br />
          <TextReveal
            as="span"
            trigger="mount"
            splitType="chars"
            stagger={0.03}
            delay={0.6}
            style={{ color: "var(--app-accent-lime)" }}
          >
            t&apos;attend.
          </TextReveal>
        </h1>

        <div style={{ marginBottom: "40px", textAlign: "center" }}>
          <p
            style={{
              fontFamily: "var(--font-ui), sans-serif",
              fontSize: "clamp(17px, 2.2vw, 22px)",
              color: "var(--app-text-muted)",
              maxWidth: "540px",
              lineHeight: 1.7,
              margin: "0 auto",
            }}
          >
            Génère le parcours parfait pour ta séance.
            <br />
            D+, distance, surface.{" "}
            <span style={{ color: "var(--app-accent-lime)", fontWeight: 600 }}>10 secondes.</span>
          </p>
        </div>

        <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
          <MagneticButton href="/app">Forger mon parcours</MagneticButton>
          <p
            style={{
              fontFamily: "var(--font-ui), sans-serif",
              fontSize: "13px",
              color: "var(--app-text-muted)",
              marginTop: "12px",
              opacity: 0.7,
            }}
          >
            Gratuit. Sans inscription.
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
            color: "var(--app-text-muted)",
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
