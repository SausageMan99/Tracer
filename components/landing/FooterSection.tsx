"use client";

import Link from "next/link";

export default function FooterSection() {
  return (
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
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: "11px",
          color: "var(--text-muted)",
          opacity: 0.5,
        }}
      >
        Trail runners uniquement
      </span>

      <div style={{ display: "flex", gap: "24px", alignItems: "center" }}>
        <Link
          href="/app"
          style={{
            fontFamily: "var(--font-inter), sans-serif",
            fontSize: "12px",
            color: "var(--text-muted)",
            textDecoration: "none",
          }}
        >
          Application
        </Link>
        <a
          href="https://github.com"
          style={{
            fontFamily: "var(--font-inter), sans-serif",
            fontSize: "12px",
            color: "var(--text-muted)",
            textDecoration: "none",
          }}
        >
          GitHub
        </a>
      </div>

      <span
        style={{
          fontFamily: "var(--font-inter), sans-serif",
          fontSize: "11px",
          color: "var(--text-muted)",
          opacity: 0.5,
          width: "100%",
          textAlign: "center",
        }}
      >
        Phase 1 · boucles 5–15 km · 2026
      </span>
    </footer>
  );
}
