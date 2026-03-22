"use client";

import Link from "next/link";

export default function HeroSection() {
  return (
    <section
      style={{
        position: "relative",
        height: "100vh",
        minHeight: "600px",
        background: "linear-gradient(to bottom, #3d3529, #5a7247)",
        display: "flex",
        flexDirection: "column",
        overflow: "hidden",
      }}
    >
      {/* Nav */}
      <nav
        style={{
          position: "absolute",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 10,
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          padding: "24px 20px",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "13px",
            fontWeight: 700,
            letterSpacing: "0.15em",
            color: "#f2ece3",
            opacity: 0.9,
          }}
        >
          trailforge
        </span>
        <Link
          href="/app"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "12px",
            fontWeight: 600,
            letterSpacing: "0.05em",
            color: "#f2ece3",
            textDecoration: "none",
            border: "1px solid rgba(242, 236, 227, 0.4)",
            padding: "10px 20px",
            display: "inline-block",
          }}
        >
          Ouvrir l&apos;app →
        </Link>
      </nav>

      {/* Hero content */}
      <div
        style={{
          flex: 1,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
          textAlign: "center",
          padding: "20px",
          position: "relative",
          zIndex: 5,
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "11px",
            letterSpacing: "0.2em",
            color: "rgba(242, 236, 227, 0.6)",
            textTransform: "uppercase",
            marginBottom: "32px",
            display: "block",
          }}
        >
          Générateur de parcours GPS
        </span>

        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(32px, 7vw, 72px)",
            fontStyle: "italic",
            fontWeight: 700,
            lineHeight: 1.1,
            color: "#f2ece3",
            marginBottom: "20px",
            maxWidth: "700px",
          }}
        >
          J&apos;en avais marre des mauvais parcours.
        </h1>

        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "clamp(14px, 2vw, 17px)",
            color: "rgba(242, 236, 227, 0.75)",
            marginBottom: "48px",
            lineHeight: 1.6,
            maxWidth: "480px",
          }}
        >
          Alors j&apos;ai construit quelque chose de mieux.
        </p>

        <Link
          href="/app"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "14px",
            fontWeight: 700,
            letterSpacing: "0.05em",
            color: "#3d3529",
            background: "#f2ece3",
            textDecoration: "none",
            padding: "16px 36px",
            display: "inline-block",
            minHeight: "44px",
            lineHeight: 1,
          }}
        >
          Forger mon parcours
        </Link>

        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "11px",
            color: "rgba(242, 236, 227, 0.45)",
            marginTop: "16px",
          }}
        >
          Gratuit. Sans inscription.
        </p>
      </div>

      {/* Scroll indicator */}
      <div
        style={{
          position: "absolute",
          bottom: "28px",
          left: "50%",
          transform: "translateX(-50%)",
          zIndex: 10,
          color: "rgba(242, 236, 227, 0.4)",
        }}
        aria-hidden="true"
      >
        <svg
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          width="20"
          height="20"
        >
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
        </svg>
      </div>
    </section>
  );
}
