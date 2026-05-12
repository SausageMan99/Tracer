"use client";

import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { downloadGPX } from "@/lib/gpx-export";
import { exportFeedbacksAsJSON, loadFeedbacks } from "@/lib/feedback-store";
import FeedbackButtons from "@/components/sidebar/FeedbackButtons";
import WaitlistForm from "@/components/ui/WaitlistForm";
import { translateQualityWarning } from "@/lib/route-quality-copy";
import { buildWatchExportGuide } from "@/lib/watch-export";
import { buildRouteExplanation } from "@/lib/route-explanations";
import { buildFeedbackInsights } from "@/lib/feedback-insights";

function formatDuration(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  if (h > 0) return `${h}h${m.toString().padStart(2, "0")}`;
  return `${m} min`;
}

function labelForScore(score: number) {
  if (score >= 82) return { label: "Boucle exploitable", color: "var(--accent-lime)" };
  if (score >= 65) return { label: "Boucle à vérifier", color: "var(--accent-amber)" };
  return { label: "Boucle fragile", color: "var(--accent-danger)" };
}

function terrainConfidenceCopy(confidence?: "low" | "medium" | "high") {
  if (confidence === "high") return { label: "Donnée solide", value: "haute", ok: true };
  if (confidence === "medium") return { label: "Donnée partielle", value: "moyenne", ok: false };
  if (confidence === "low") return { label: "Donnée faible", value: "basse", ok: false };
  return { label: "Donnée inconnue", value: "n/a", ok: false };
}

function trailPotentialCopy(potential?: "low" | "medium" | "high") {
  if (potential === "high") return "potentiel trail élevé";
  if (potential === "medium") return "potentiel trail moyen";
  if (potential === "low") return "potentiel trail faible";
  return "potentiel non mesuré";
}

function StatBlock({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div
      style={{
        background: "rgba(17,26,21,0.82)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
        overflow: "hidden",
      }}
    >
      <div style={{ padding: "9px 12px", borderBottom: "1px solid rgba(125,143,130,0.11)" }}>
        <span style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "9px", fontWeight: 700, letterSpacing: "0.2em", textTransform: "uppercase", color: "var(--text-dim)" }}>
          {label}
        </span>
      </div>
      <div style={{ padding: "12px" }}>
        <span style={{ display: "block", fontFamily: "var(--font-jetbrains), monospace", fontSize: "20px", color: "var(--text-primary)", letterSpacing: "-0.04em", lineHeight: 1 }}>
          {value}
        </span>
        {sub && (
          <span style={{ display: "block", marginTop: "6px", fontFamily: "var(--font-jetbrains), monospace", fontSize: "10px", color: "var(--text-dim)" }}>
            {sub}
          </span>
        )}
      </div>
    </div>
  );
}

function HealthRow({ label, value, ok }: { label: string; value: string; ok: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "12px", padding: "9px 0", borderBottom: "1px solid rgba(125,143,130,0.1)" }}>
      <span style={{ display: "flex", alignItems: "center", gap: "8px", fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "var(--text-muted)" }}>
        <span style={{ width: "7px", height: "7px", borderRadius: "50%", background: ok ? "var(--accent-lime)" : "var(--accent-amber)", boxShadow: ok ? "0 0 8px rgba(163,201,106,0.18)" : "none" }} />
        {label}
      </span>
      <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "11px", color: ok ? "var(--text-primary)" : "var(--accent-amber)", whiteSpace: "nowrap" }}>
        {value}
      </span>
    </div>
  );
}

function MiniPanel({ children, label }: { children: React.ReactNode; label?: string }) {
  return (
    <div
      style={{
        padding: "14px",
        background: "rgba(17,26,21,0.78)",
        border: "1px solid var(--border)",
        borderRadius: "var(--radius-card)",
      }}
    >
      {label && (
        <p style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "10px", fontWeight: 700, letterSpacing: "0.2em", color: "var(--text-dim)", textTransform: "uppercase", marginBottom: "10px" }}>
          {label}
        </p>
      )}
      {children}
    </div>
  );
}

export default function RouteResult() {
  const {
    currentRoute,
    candidateIndex,
    setCandidateIndex,
    status,
    errorMessage,
    generationId,
    betaOutcome,
    errorCode,
    errorSubCode,
    clearRoute,
    targetDistanceKm,
    targetElevationM,
    scenicMode,
  } = useAppStore();

  const feedbacks = loadFeedbacks();
  const feedbackCount = feedbacks.length;
  const feedbackInsights = buildFeedbackInsights(feedbacks);
  const [showWaitlistWidget, setShowWaitlistWidget] = useState(false);
  const [waitlistDismissed, setWaitlistDismissed] = useState(() => {
    if (typeof window === "undefined") return false;
    return localStorage.getItem("tf-waitlist-dismissed") === "1";
  });

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
    if (!waitlistDismissed) setShowWaitlistWidget(true);
  }, [currentRoute, waitlistDismissed]);

  if (status === "error") {
    return (
      <div className="px-4 md:px-6 py-6">
        <MiniPanel>
          <p style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "12px", fontWeight: 700, letterSpacing: "0.16em", color: "var(--accent-danger)", textTransform: "uppercase", marginBottom: "8px" }}>
            Refus honnête beta
          </p>
          <p style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "10px", color: "var(--accent-amber)", marginBottom: "8px" }}>
            {errorCode ?? "UNKNOWN"}{errorSubCode ? ` / ${errorSubCode}` : ""}
          </p>
          <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.5 }}>
            {errorMessage}
          </p>
          <p style={{ marginTop: "10px", fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "var(--text-dim)", lineHeight: 1.45 }}>
            La beta préfère refuser plutôt que vendre une trace mensongère. Essaie une distance plus courte, un départ plus proche des chemins, ou le mode nature urbaine.
          </p>
          {generationId && (
            <p style={{ marginTop: "8px", fontFamily: "var(--font-jetbrains), monospace", fontSize: "10px", color: "var(--text-dim)" }}>
              génération {generationId}
            </p>
          )}
          <button onClick={clearRoute} style={{ marginTop: "14px", fontFamily: "var(--font-syne), sans-serif", fontSize: "11px", color: "var(--text-primary)", background: "transparent", border: "1px solid var(--border)", borderRadius: "8px", padding: "10px 12px", cursor: "pointer" }}>
            Paramètres
          </button>
        </MiniPanel>
      </div>
    );
  }

  if (!currentRoute) return null;

  const { best, candidates } = currentRoute;
  const matchPercent = Math.round(best.totalScore * 100);
  const scoreLabel = labelForScore(matchPercent);
  const quality = best.quality;
  const distanceErrorPct = quality?.distanceErrorPct ?? Math.round(Math.abs(best.distanceKm - targetDistanceKm) / Math.max(targetDistanceKm, 1) * 100);
  const elevationErrorPct = quality?.elevationErrorPct ?? Math.round(Math.abs(best.ascendM - targetElevationM) / Math.max(targetElevationM || 1, 1) * 100);
  const loopGapKm = quality?.loopGapKm;
  const trailRatio = quality?.trailRatio ?? quality?.naturalCorridorRatio ?? best.surfaceScore;
  const terrainConfidence = terrainConfidenceCopy(quality?.terrainDataConfidence);
  const terrainPotential = trailPotentialCopy(quality?.trailPotential);
  const unknownSurfaceRatio = quality?.terrainUnknownSurfaceRatio;
  const qualityWarnings = (quality?.warnings ?? [])
    .map(translateQualityWarning)
    .filter((warning): warning is NonNullable<typeof warning> => warning != null);
  const watchExportGuide = buildWatchExportGuide(currentRoute.profile);
  const routeExplanation = buildRouteExplanation(currentRoute, { targetDistanceKm, targetElevationM, scenicMode });
  const total = candidates.length;
  const outcome = currentRoute.betaOutcome ?? betaOutcome ?? (currentRoute.distanceAdjustment ? "adjusted" : "generated");
  const outcomeTitle = outcome === "adjusted" ? "Distance adaptée" : "Boucle générée";
  const outcomeSubtitle = outcome === "adjusted" && currentRoute.distanceAdjustment
    ? `Demandé ${currentRoute.distanceAdjustment.requestedDistanceKm.toFixed(1)} km · proposé ${currentRoute.distanceAdjustment.adjustedDistanceKm.toFixed(1)} km`
    : "Promesse tenue sur ce terrain compatible";

  return (
    <div className="flex flex-col pb-6">
      <div className="px-4 md:px-6" style={{ paddingTop: "16px", paddingBottom: "16px", borderBottom: "1px solid var(--border)" }}>
        <button
          onClick={clearRoute}
          style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-syne), sans-serif", fontSize: "10px", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: "14px" }}
          aria-label="Retour au formulaire"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" width="12" height="12">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 18l-6-6 6-6"/>
          </svg>
          Paramètres
        </button>

        <div>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: scoreLabel.color }} />
            <h2 style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "22px", color: "var(--text-primary)", letterSpacing: "-0.03em", lineHeight: 1.05 }}>
              {outcomeTitle}
            </h2>
          </div>
          <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: outcome === "adjusted" ? "var(--accent-amber)" : "var(--text-muted)", lineHeight: 1.5, marginBottom: "6px" }}>
            {outcomeSubtitle}
          </p>
          <p style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "12px", color: "var(--text-primary)", lineHeight: 1.6 }}>
            {best.distanceKm.toFixed(1)} km · {best.ascendM.toFixed(0)} m D+ · {formatDuration(best.durationSeconds)} estimée
          </p>
          <p style={{ marginTop: "4px", fontFamily: "var(--font-jetbrains), monospace", fontSize: "11px", color: "var(--text-dim)", lineHeight: 1.6 }}>
            Écart: {distanceErrorPct}% distance · {elevationErrorPct}% D+ · {Math.round(trailRatio * 100)}% sentiers · GPX prêt
          </p>
        </div>
      </div>

      <div className="px-4 md:px-6" style={{ paddingTop: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <button
            onClick={handleDownloadGPX}
            style={{ width: "100%", height: "48px", background: "var(--accent-lime)", color: "var(--bg-deep)", border: "1px solid rgba(232,230,223,0.08)", borderRadius: "8px", fontFamily: "var(--font-syne), sans-serif", fontSize: "12px", fontWeight: 800, letterSpacing: "0.16em", textTransform: "uppercase", cursor: "pointer" }}
            aria-label="Télécharger le parcours au format GPX"
          >
            Télécharger GPX
          </button>
          <button onClick={clearRoute} style={{ width: "100%", height: "40px", background: "rgba(17,26,21,0.58)", color: "var(--text-muted)", border: "1px solid var(--border)", borderRadius: "8px", fontFamily: "var(--font-syne), sans-serif", fontSize: "11px", fontWeight: 700, letterSpacing: "0.14em", textTransform: "uppercase", cursor: "pointer" }}>
            Générer une autre boucle
          </button>
        </div>

        <MiniPanel label="Pourquoi ce tracé">
          <p style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "12px", fontWeight: 700, color: "var(--text-primary)", letterSpacing: "0.04em", marginBottom: "6px" }}>
            {routeExplanation.headline}
          </p>
          <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.5 }}>
            {routeExplanation.summary}
          </p>
          <div style={{ display: "flex", flexWrap: "wrap", gap: "6px", marginTop: "10px" }}>
            {routeExplanation.signals.slice(0, 3).map((signal) => (
              <span key={signal} style={{ padding: "5px 7px", border: "1px solid var(--border)", borderRadius: "999px", fontFamily: "var(--font-syne), sans-serif", fontSize: "9px", color: "var(--accent-sage)", letterSpacing: "0.08em", textTransform: "uppercase" }}>
                {signal}
              </span>
            ))}
          </div>
        </MiniPanel>

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px" }}>
          <StatBlock label="Distance" value={`${best.distanceKm.toFixed(1)} km`} sub={`écart ${distanceErrorPct}%`} />
          <StatBlock label="Dénivelé" value={`${best.ascendM.toFixed(0)} m`} sub={`D− ${best.descendM.toFixed(0)} m`} />
          <StatBlock label="Temps" value={formatDuration(best.durationSeconds)} sub="estimation" />
          <StatBlock label="Sentiers" value={`${Math.round(trailRatio * 100)}%`} sub="Part de sentiers" />
        </div>

        <MiniPanel label="Fiabilité">
          <HealthRow label="Boucle fermée" value={loopGapKm != null ? `${loopGapKm.toFixed(2)}km` : `${Math.round(best.loopScore * 100)}%`} ok={loopGapKm != null ? loopGapKm <= 0.5 : best.loopScore >= 0.72} />
          <HealthRow label="Distance visée" value={`±${distanceErrorPct}%`} ok={distanceErrorPct <= 15} />
          <HealthRow label="D+ visé" value={`±${elevationErrorPct}%`} ok={elevationErrorPct <= 35} />
          <HealthRow label="Terrain trail" value={`${Math.round(trailRatio * 100)}%`} ok={trailRatio >= 0.45} />
          <HealthRow label={terrainConfidence.label} value={terrainConfidence.value} ok={terrainConfidence.ok} />
          <p style={{ marginTop: "10px", fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "var(--text-dim)", lineHeight: 1.45 }}>
            {terrainPotential}{unknownSurfaceRatio != null ? ` · ${Math.round(unknownSurfaceRatio * 100)}% des surfaces OSM inconnues` : ""}. Indicateurs techniques, pas validation terrain. À tester avant de faire confiance aveuglément au GPX.
          </p>
        </MiniPanel>

        {qualityWarnings.length > 0 && (
          <MiniPanel label="À vérifier avant de partir">
            <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
              {qualityWarnings.map((warning) => (
                <div key={warning.label} style={{ paddingLeft: "10px", borderLeft: "2px solid var(--accent-amber)" }}>
                  <p style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "11px", color: "var(--text-primary)", marginBottom: "3px" }}>{warning.label}</p>
                  <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.45 }}>{warning.description}</p>
                </div>
              ))}
            </div>
          </MiniPanel>
        )}

        {total > 1 && (
          <MiniPanel label={`Variantes (${total})`}>
            <div className="session-scroll" style={{ display: "flex", gap: "6px", overflowX: "auto", paddingBottom: "2px" }}>
              {candidates.map((c, i) => {
                const active = i === candidateIndex;
                const pct = Math.round(c.totalScore * 100);
                return (
                  <button
                    key={i}
                    onClick={() => setCandidateIndex(i)}
                    aria-pressed={active}
                    aria-label={`Variante ${i + 1}, ${c.distanceKm.toFixed(1)} km, qualité ${pct}%`}
                    style={{
                      flexShrink: 0,
                      minWidth: "76px",
                      padding: "9px 10px",
                      borderRadius: "8px",
                      border: active ? "1px solid rgba(163,201,106,0.4)" : "1px solid var(--border)",
                      background: active ? "rgba(163,201,106,0.08)" : "rgba(10,15,12,0.52)",
                      cursor: "pointer",
                    }}
                  >
                    <span style={{ display: "block", fontFamily: "var(--font-jetbrains), monospace", fontSize: "12px", color: active ? "var(--accent-lime)" : "var(--text-primary)" }}>{c.distanceKm.toFixed(1)}km</span>
                    <span style={{ display: "block", marginTop: "3px", fontFamily: "var(--font-jetbrains), monospace", fontSize: "10px", color: "var(--text-dim)" }}>{pct}%</span>
                  </button>
                );
              })}
            </div>
          </MiniPanel>
        )}

        <MiniPanel label={watchExportGuide.title}>
          <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.5, marginBottom: "8px" }}>
            {watchExportGuide.description}
          </p>
          <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
            {watchExportGuide.targets.map((target) => (
              <details key={target.id} style={{ borderTop: "1px solid rgba(125,143,130,0.1)", paddingTop: "7px" }}>
                <summary style={{ cursor: "pointer", fontFamily: "var(--font-syne), sans-serif", fontSize: "11px", color: "var(--text-primary)" }}>
                  {target.label}
                </summary>
                <p style={{ marginTop: "5px", fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.45 }}>
                  {target.primaryAction}
                </p>
              </details>
            ))}
          </div>
        </MiniPanel>

        <MiniPanel label="Retour terrain">
          <FeedbackButtons route={currentRoute} sessionConfig={{ targetDistanceKm, targetElevationM }} outcome={outcome} generationId={currentRoute.generationId ?? generationId ?? undefined} />
        </MiniPanel>

        {feedbackCount > 0 && (
          <MiniPanel label="Signaux feedback">
            <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: "8px", marginBottom: "8px" }}>
              <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "12px", color: "var(--text-primary)" }}>{Math.round(feedbackInsights.positiveRate * 100)}% positifs</span>
              <span style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "12px", color: "var(--text-primary)" }}>{Math.round(feedbackInsights.negativeRate * 100)}% négatifs</span>
            </div>
            <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "11px", color: "var(--text-muted)", lineHeight: 1.5 }}>{feedbackInsights.actions[0]}</p>
            <button onClick={() => exportFeedbacksAsJSON()} style={{ marginTop: "10px", fontFamily: "var(--font-syne), sans-serif", fontSize: "10px", color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", padding: 0, letterSpacing: "0.1em" }}>
              EXPORTER FEEDBACKS ({feedbackCount})
            </button>
          </MiniPanel>
        )}

        {showWaitlistWidget && !waitlistDismissed && (
          <MiniPanel>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: "10px" }}>
              <span style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "12px", color: "var(--text-muted)" }}>Tu veux être prévenu quand la génération s’améliore dans ta zone ?</span>
              <button onClick={handleDismissWaitlist} style={{ background: "none", border: "none", color: "var(--text-muted)", cursor: "pointer", fontSize: "14px", padding: "2px 6px", opacity: 0.6 }} aria-label="Fermer">✕</button>
            </div>
            <WaitlistForm source="post-generation" compact />
          </MiniPanel>
        )}
      </div>
    </div>
  );
}
