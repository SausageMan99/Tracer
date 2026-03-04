"use client";

import Link from "next/link";
import { useAppStore } from "@/lib/store";

/**
 * Fixed top navigation bar for the /app route.
 * Shows: logo+back link / centered label / heatmap status
 */
export default function AppNav() {
  const { heatmapVisible } = useAppStore();

  return (
    <nav
      style={{
        height: "52px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 20px",
        background: "rgba(8,12,10,0.92)",
        backdropFilter: "blur(12px)",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
        position: "relative",
        zIndex: 50,
      }}
    >
      {/* Left: back link */}
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
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="14" height="14" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 5l-7 7 7 7" />
        </svg>
        TrailForge
      </Link>

      {/* Centre: app label */}
      <span
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

      {/* Right: heatmap status */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "6px",
          fontFamily: "var(--font-syne), sans-serif",
          fontSize: "11px",
          color: "var(--text-muted)",
        }}
      >
        <span
          style={{
            width: "6px",
            height: "6px",
            borderRadius: "50%",
            background: heatmapVisible ? "var(--accent-lime)" : "var(--text-muted)",
            flexShrink: 0,
            transition: "background 0.3s",
          }}
        />
        Heatmap
      </div>
    </nav>
  );
}
