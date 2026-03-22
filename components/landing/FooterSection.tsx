"use client";

import Link from "next/link";

export default function FooterSection() {
  return (
    <footer
      style={{
        background: "#3d3529",
        borderTop: "1px solid rgba(255,255,255,0.08)",
        padding: "48px 20px",
      }}
    >
      <div
        style={{
          maxWidth: "800px",
          margin: "0 auto",
          display: "flex",
          flexDirection: "column",
          gap: "32px",
        }}
      >
        <p
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(16px, 2vw, 20px)",
            fontStyle: "italic",
            color: "#f2ece3",
            margin: 0,
            opacity: 0.85,
          }}
        >
          Construit par un traileur, pour les traileurs.
        </p>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            justifyContent: "space-between",
            flexWrap: "wrap",
            gap: "16px",
          }}
        >
          <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
            <Link
              href="/app"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "12px",
                color: "#8fa87e",
                textDecoration: "none",
                letterSpacing: "0.05em",
              }}
            >
              Application
            </Link>
            <a
              href="https://github.com"
              target="_blank"
              rel="noopener noreferrer"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "12px",
                color: "#8fa87e",
                textDecoration: "none",
                letterSpacing: "0.05em",
              }}
            >
              GitHub
            </a>
          </div>

          <span
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "11px",
              color: "rgba(242, 236, 227, 0.3)",
              letterSpacing: "0.05em",
            }}
          >
            © 2026 TrailForge
          </span>
        </div>
      </div>
    </footer>
  );
}
