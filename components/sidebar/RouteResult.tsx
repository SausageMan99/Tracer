"use client";

import { useEffect, useState, useCallback } from "react";
import { useAppStore } from "@/lib/store";
import { downloadGPX } from "@/lib/gpx-export";
import { exportFeedbacksAsJSON, loadFeedbacks } from "@/lib/feedback-store";
import FeedbackButtons from "@/components/sidebar/FeedbackButtons";
import ScoreRing from "@/components/ui/ScoreRing";
import WaitlistForm from "@/components/ui/WaitlistForm";
import { translateQualityWarning } from "@/lib/route-quality-copy";

// ── Helpers ───────────────────────────────────────────────────────────────────

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m.toString().padStart(2, "0")}`;
  return `${m} min`;
}

// ── Slope legend ──────────────────────────────────────────────────────────────

const SLOPE_LEGEND = [
  { label: "Descente", color: "#22c55e" },
  { label: "Plat",     color: "#cbd5e1" },
  { label: "≥ 4%",    color: "#fde047" },
  { label: "≥ 7%",    color: "#fb923c" },
  { label: "≥ 10%",   color: "#ef4444" },
];

// ── Stat card ─────────────────────────────────────────────────────────────────

function StatCard({
  label,
  value,
  sub,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  icon: React.ReactNode;
}) {
  return (
    <div
      style={{
        background: "var(--bg-surface)",
        border: "1px solid var(--border)",
        borderRadius: "2px",
        padding: "16px",
        display: "flex",
        flexDirection: "column",
        gap: "6px",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
        <span style={{ color: "var(--text-muted)" }}>{icon}</span>
        <span
          style={{
            fontFamily: "var(--font-syne), sans-serif",
            fontSize: "10px",
            fontWeight: 600,
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            color: "var(--text-muted)",
          }}
        >
          {label}
        </span>
      </div>
      <span
        style={{
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: "22px",
          fontWeight: 500,
          color: "var(--text-primary)",
          lineHeight: 1,
        }}
      >
        {value}
      </span>
      {sub && (
        <span
          style={{
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "11px",
            color: "var(--text-muted)",
          }}
        >
          {sub}
        </span>
      )}
    </div>
  );
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function RouteResult() {
  const {
    currentRoute,
    candidateIndex,
    setCandidateIndex,
    status,
    errorMessage,
    clearRoute,
    targetDistanceKm,
    targetElevationM,
  } = useAppStore();

  const feedbackCount = loadFeedbacks().length;
  const [showWaitlistWidget, setShowWaitlistWidget] = useState(false);
  const [waitlistDismissed, setWaitlistDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("tf-waitlist-dismissed") === "1";
  });

  // Show waitlist widget after 30s or after first GPX download
  useEffect(() => {
    if (typeof window === "undefined" || waitlistDismissed) return;
    const timer = setTimeout(() => setShowWaitlistWidget(true), 30000);
    return () => clearTimeout(timer);
  }, [waitlistDismissed]);

  const handleDismissWaitlist = useCallback(() => {
    setWaitlistDismissed(true);
    localStorage.setItem("tf-waitlist-dismissed", "1");
  }, []);

  const handleDownloadGPX = useCallback(() => {
    if (!currentRoute) return;
    downloadGPX(currentRoute);
    // Show waitlist widget after first download
    if (!waitlistDismissed) {
      setShowWaitlistWidget(true);
    }
  }, [currentRoute, waitlistDismissed]);

  if (status === "error") {
    return (
      <div className="px-4 md:px-6 py-6">
        <div
          role="alert"
          aria-live="assertive"
          style={{
            padding: "16px",
            background: "rgba(239,68,68,0.08)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: "2px",
          }}
        >
          <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "#f87171", lineHeight: 1.5 }}>
            {errorMessage}
          </p>
          <button
            onClick={clearRoute}
            style={{
              marginTop: "12px",
              fontFamily: "var(--font-syne), sans-serif",
              fontSize: "11px",
              color: "#f87171",
              background: "none",
              border: "none",
              cursor: "pointer",
              padding: 0,
              textDecoration: "underline",
            }}
          >
            Retour
          </button>
        </div>
      </div>
    );
  }

  if (!currentRoute) return null;

  const { best, candidates, profile } = currentRoute;
  const matchPercent = Math.round(best.totalScore * 100);
  const qualityWarnings = (best.quality?.warnings ?? [])
    .map(translateQualityWarning)
    .filter((warning): warning is NonNullable<typeof warning> => warning != null);
  const total = candidates.length;

  return (
    <div className="flex flex-col pb-6">

      {/* ── Header ────────────────────────────────────────────────────────── */}
      <div
        className="px-4 md:px-6"
        style={{
          paddingTop: "16px",
          paddingBottom: "16px",
          borderBottom: "1px solid var(--border)",
          display: "flex",
          alignItems: "center",
          gap: "16px",
        }}
      >
        <button
          onClick={clearRoute}
          style={{
            display: "flex",
            alignItems: "center",
            gap: "4px",
            fontFamily: "var(--font-syne), sans-serif",
            fontSize: "11px",
            color: "var(--text-muted)",
            background: "none",
            border: "none",
            cursor: "pointer",
            padding: 0,
            transition: "color 0.2s",
          }}
          aria-label="Retour au formulaire"
          onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-primary)")}
          onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6"/>
          </svg>
          Nouvelle recherche
        </button>

        <div style={{ marginLeft: "auto", display: "flex", flexDirection: "column", alignItems: "center", gap: "2px" }}>
          <ScoreRing
            score={matchPercent}
            size={60}
            color="var(--accent-lime)"
            trackColor="var(--bg-elevated)"
            strokeWidth={3}
          />
        </div>
      </div>

      <div className="px-4 md:px-6">

        {/* ── Profile ─────────────────────────────────────────────────────── */}
        <div style={{ padding: "14px 0 14px", borderBottom: "1px solid var(--border)" }}>
          <span
            style={{
              fontFamily: "var(--font-syne), sans-serif",
              fontSize: "11px",
              color: "var(--text-muted)",
              letterSpacing: "0.1em",
            }}
          >
            {profile.name} · {profile.sport.replace(/_/g, " ")}
          </span>
        </div>

        {/* ── 4 stat cards ─────────────────────────────────────────────────── */}
        <div style={{ paddingTop: "16px", display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <StatCard
            label="Distance"
            value={`${best.distanceKm.toFixed(1)} km`}
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="M3 12h18M12 3l9 9-9 9"/></svg>}
          />
          <StatCard
            label="D+"
            value={`${best.ascendM.toFixed(0)} m`}
            sub={`D− ${best.descendM.toFixed(0)} m`}
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>}
          />
          <StatCard
            label="Durée est."
            value={formatDuration(best.durationSeconds)}
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>}
          />
          <StatCard
            label="Score"
            value={`${matchPercent}%`}
            icon={<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12"><polyline points="22 12 18 12 15 21 9 3 6 12 2 12"/></svg>}
          />
        </div>

        {qualityWarnings.length > 0 && (
          <div
            style={{
              marginTop: "16px",
              padding: "12px 14px",
              background: "rgba(245,158,11,0.08)",
              border: "1px solid rgba(245,158,11,0.24)",
              borderRadius: "2px",
            }}
            aria-label="Compromis qualité du parcours"
          >
            <p
              style={{
                fontFamily: "var(--font-syne), sans-serif",
                fontSize: "10px",
                fontWeight: 700,
                letterSpacing: "0.18em",
                color: "#fbbf24",
                textTransform: "uppercase",
                marginBottom: "8px",
              }}
            >
              Compromis détectés
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
              {qualityWarnings.map((warning) => (
                <div key={warning.label} style={{ display: "flex", flexDirection: "column", gap: "2px" }}>
                  <span style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "11px", color: "var(--text-primary)" }}>
                    {warning.label}
                  </span>
                  <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.4 }}>
                    {warning.description}
                  </span>
                </div>
              ))}
            </div>
          </div>
        )}

        {/* ── Slope legend ─────────────────────────────────────────────────── */}
        <div
          style={{
            marginTop: "16px",
            padding: "12px 16px",
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: "2px",
          }}
        >
          <p
            style={{
              fontFamily: "var(--font-syne), sans-serif",
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.2em",
              color: "var(--text-muted)",
              textTransform: "uppercase",
              marginBottom: "8px",
            }}
          >
            Couleurs de pente
          </p>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", flexWrap: "wrap", gap: "4px" }}>
            {SLOPE_LEGEND.map(({ label, color }) => (
              <div key={label} style={{ display: "flex", alignItems: "center", gap: "4px" }}>
                <span
                  style={{
                    display: "inline-block",
                    width: "10px",
                    height: "10px",
                    borderRadius: "1px",
                    background: color,
                    flexShrink: 0,
                  }}
                  aria-hidden="true"
                />
                <span
                  style={{
                    fontFamily: "var(--font-syne), sans-serif",
                    fontSize: "10px",
                    color: "var(--text-muted)",
                  }}
                >
                  {label}
                </span>
              </div>
            ))}
          </div>
        </div>

        {/* ── Variants ─────────────────────────────────────────────────────── */}
        {total > 1 && (
          <div style={{ marginTop: "16px" }}>
            <p
              style={{
                fontFamily: "var(--font-syne), sans-serif",
                fontSize: "10px",
                fontWeight: 600,
                letterSpacing: "0.2em",
                color: "var(--text-muted)",
                textTransform: "uppercase",
                marginBottom: "8px",
              }}
            >
              Variantes ({total})
            </p>
            <div className="session-scroll" style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "4px" }}>
              {candidates.map((c, i) => {
                const isActive = i === candidateIndex;
                const pct = Math.round(c.totalScore * 100);
                return (
                  <button
                    key={i}
                    onClick={() => setCandidateIndex(i)}
                    aria-pressed={isActive}
                    aria-label={`Variante ${i + 1}, ${c.distanceKm.toFixed(1)} km, score ${pct}%`}
                    style={{
                      flexShrink: 0,
                      padding: "8px 12px",
                      borderRadius: "2px",
                      border: isActive ? "1px solid var(--accent-lime)" : "1px solid var(--border)",
                      background: isActive ? "var(--bg-elevated)" : "var(--bg-surface)",
                      cursor: "pointer",
                      transition: "all 0.2s var(--ease-out-expo)",
                      display: "flex",
                      flexDirection: "column",
                      alignItems: "center",
                      gap: "2px",
                    }}
                  >
                    <span
                      style={{
                        fontFamily: "var(--font-jetbrains), monospace",
                        fontSize: "12px",
                        fontWeight: 500,
                        color: isActive ? "var(--accent-lime)" : "var(--text-primary)",
                      }}
                    >
                      {c.distanceKm.toFixed(1)} km
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--font-jetbrains), monospace",
                        fontSize: "10px",
                        color: "var(--text-muted)",
                      }}
                    >
                      {pct}%
                    </span>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        {/* ── Actions ───────────────────────────────────────────────────────── */}
        <div style={{ marginTop: "20px", display: "flex", flexDirection: "column", gap: "8px" }}>
          <button
            onClick={handleDownloadGPX}
            style={{
              width: "100%",
              height: "48px",
              background: "var(--accent-lime)",
              color: "var(--bg-deep)",
              border: "none",
              borderRadius: "2px",
              fontFamily: "var(--font-syne), sans-serif",
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              cursor: "pointer",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              gap: "8px",
              transition: "all 0.2s var(--ease-out-expo)",
            }}
            onMouseEnter={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = "0 0 20px rgba(168,214,114,0.3)"; }}
            onMouseLeave={(e) => { (e.currentTarget as HTMLElement).style.boxShadow = ""; }}
            aria-label="Télécharger le parcours au format GPX"
          >
            <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" aria-hidden="true">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v1a3 3 0 003 3h10a3 3 0 003-3v-1m-4-4l-4 4m0 0l-4-4m4 4V4"/>
            </svg>
            TÉLÉCHARGER GPX
          </button>

          <button
            onClick={clearRoute}
            style={{
              width: "100%",
              height: "40px",
              background: "transparent",
              color: "var(--text-muted)",
              border: "1px solid var(--border)",
              borderRadius: "2px",
              fontFamily: "var(--font-syne), sans-serif",
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              cursor: "pointer",
              transition: "all 0.2s var(--ease-out-expo)",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-moss)";
              (e.currentTarget as HTMLElement).style.color = "var(--text-primary)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.borderColor = "var(--border)";
              (e.currentTarget as HTMLElement).style.color = "var(--text-muted)";
            }}
          >
            RÉGÉNÉRER
          </button>
        </div>

        {/* ── Feedback ─────────────────────────────────────────────────────── */}
        <div
          style={{
            marginTop: "20px",
            paddingTop: "16px",
            borderTop: "1px solid var(--border)",
          }}
        >
          <FeedbackButtons
            route={currentRoute}
            sessionConfig={{ targetDistanceKm, targetElevationM }}
          />
        </div>

        {feedbackCount > 0 && (
          <div style={{ marginTop: "10px", display: "flex", justifyContent: "center" }}>
            <button
              onClick={() => {
                exportFeedbacksAsJSON();
              }}
              style={{
                fontFamily: "var(--font-syne), sans-serif",
                fontSize: "10px",
                color: "var(--text-muted)",
                background: "none",
                border: "none",
                cursor: "pointer",
                padding: "4px 0",
                letterSpacing: "0.1em",
              }}
              onMouseEnter={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-primary)")}
              onMouseLeave={(e) => ((e.currentTarget as HTMLElement).style.color = "var(--text-muted)")}
            >
              EXPORTER FEEDBACKS ({feedbackCount})
            </button>
          </div>
        )}
        {/* ── Post-generation waitlist widget ───────────────────────────── */}
        {showWaitlistWidget && !waitlistDismissed && (
          <div
            style={{
              marginTop: "20px",
              paddingTop: "16px",
              borderTop: "1px solid var(--border)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <span
                style={{
                  fontFamily: "var(--font-syne), sans-serif",
                  fontSize: "12px",
                  color: "var(--text-muted)",
                }}
              >
                Recevoir les nouveautés ?
              </span>
              <button
                onClick={handleDismissWaitlist}
                style={{
                  background: "none",
                  border: "none",
                  color: "var(--text-muted)",
                  cursor: "pointer",
                  fontSize: "14px",
                  padding: "2px 6px",
                  opacity: 0.5,
                }}
                aria-label="Fermer"
              >
                ✕
              </button>
            </div>
            <WaitlistForm source="post-generation" compact />
          </div>
        )}
      </div>
    </div>
  );
}
