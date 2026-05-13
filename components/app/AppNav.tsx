"use client";

import Link from "next/link";
import TrailForgeMark from "@/components/brand/TrailForgeMark";
import { useAppStore } from "@/lib/store";

export default function AppNav() {
  const toggleSidebar = useAppStore((s) => s.toggleSidebar);
  const currentRoute = useAppStore((s) => s.currentRoute);
  const status = useAppStore((s) => s.status);

  const title = currentRoute
    ? `${currentRoute.best.distanceKm.toFixed(1)} km · ${currentRoute.best.ascendM.toFixed(0)} m D+`
    : status === "loading"
      ? "Recherche d'une boucle trail"
      : "TrailForge";

  return (
    <nav
      style={{
        height: "52px",
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        padding: "0 18px",
        background: "rgba(5,8,6,0.92)",
        backdropFilter: "blur(14px)",
        borderBottom: "1px solid var(--border)",
        flexShrink: 0,
        position: "relative",
        zIndex: 50,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "12px", minWidth: 0 }}>
        <button
          type="button"
          className="md:hidden"
          onClick={toggleSidebar}
          aria-label="Ouvrir le panneau de génération"
          style={{
            background: "rgba(17,26,21,0.7)",
            border: "1px solid var(--border)",
            borderRadius: "8px",
            color: "var(--text-muted)",
            cursor: "pointer",
            padding: "7px",
            display: "flex",
            alignItems: "center",
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="18" height="18">
            <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h16M4 12h16M4 18h16" />
          </svg>
        </button>

        <Link
          href="/"
          style={{ display: "flex", alignItems: "center", gap: "9px", textDecoration: "none", minWidth: 0 }}
          aria-label="Retour à la landing TrailForge"
        >
          <TrailForgeMark compact />
          <span style={{ display: "flex", flexDirection: "column", gap: "1px", minWidth: 0 }}>
            <span style={{ fontFamily: "var(--font-ibm-plex-mono), monospace", fontSize: "12px", color: "var(--text-primary)", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis" }}>
              {title}
            </span>
            <span className="hidden md:block" style={{ fontFamily: "var(--font-ibm-plex-mono), monospace", fontSize: "8px", fontWeight: 600, letterSpacing: "0.24em", color: "var(--text-dim)", textTransform: "uppercase" }}>
              la carte vivante · GPX terrain
            </span>
          </span>
        </Link>
      </div>

      <div className="hidden md:flex" style={{ alignItems: "center", gap: "8px" }}>
        <span style={{ width: "6px", height: "6px", borderRadius: "50%", background: status === "loading" ? "var(--accent-amber)" : "var(--accent-lime)" }} />
        <span style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "10px", fontWeight: 700, letterSpacing: "0.18em", color: "var(--text-muted)", textTransform: "uppercase" }}>
          Boucle trail courte · 5–15 km
        </span>
      </div>
    </nav>
  );
}
