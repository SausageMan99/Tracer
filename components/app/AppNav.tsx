"use client";

import Link from "next/link";
import { useAppStore } from "@/lib/store";

/**
 * Fixed top navigation bar for the /app route.
 * Shows: hamburger (mobile) / logo+back link / centered label
 */
export default function AppNav() {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);

  return (
    <nav
      style={{
        height: "52px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        background: "rgba(10,13,12,0.92)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
        position: "relative",
        zIndex: 50,
      }}
    >
      {/* Left: hamburger (mobile) + back link */}
      <div style={{ display: "flex", alignItems: "center", gap: "12px" }}>
        {/* Hamburger — mobile only */}
        <button
          type="button"
          className="md:hidden"
          onClick={toggleSidebar}
          aria-label="Ouvrir le panneau de configuration"
          style={{
            background: "none",
            border: "none",
            color: "var(--text-muted)",
            cursor: "pointer",
            padding: "4px",
            display: "flex",
            alignItems: "center",
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="20" height="20">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <Link
          href="/"
          style={{
            display: "flex",
            alignItems: "center",
            gap: "8px",
            fontFamily: "var(--font-syne), sans-serif",
            fontSize: "12px",
            fontWeight: 600,
            color: "var(--text-muted)",
            textDecoration: "none",
            letterSpacing: "0.05em",
            transition: "color 0.3s var(--ease-out-expo)",
          }}
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-primary)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden="true" className="hidden md:block">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 5l-7 7 7 7" />
          </svg>
          TrailForge
        </Link>
      </div>

      {/* Centre: app label — hidden on small screens */}
      <span
        className="hidden md:block"
        style={{
          position: "absolute",
          left: "50%",
          transform: "translateX(-50%)",
          fontFamily: "var(--font-syne), sans-serif",
          fontSize: "11px",
          fontWeight: 700,
          letterSpacing: "0.3em",
          color: "var(--text-muted)",
          textTransform: "uppercase",
          pointerEvents: "none",
        }}
      >
        TRAILFORGE APP
      </span>

      {/* Right: spacer for symmetry */}
      <div style={{ width: "80px" }} />
    </nav>
  );
}
