"use client";

import { useCallback, useEffect, useState } from "react";
import { useAppStore } from "@/lib/store";
import { downloadGPX, downloadV3GPX } from "@/lib/gpx-export";
import { exportFeedbacksAsJSON, loadFeedbacks, saveFeedback, type RouteFeedback } from "@/lib/feedback-store";
import FeedbackButtons from "@/components/sidebar/FeedbackButtons";
import WaitlistForm from "@/components/ui/WaitlistForm";
import { translateQualityWarning } from "@/lib/route-quality-copy";
import { buildWatchExportGuide } from "@/lib/watch-export";
import { buildRouteExplanation } from "@/lib/route-explanations";
import { buildFeedbackInsights } from "@/lib/feedback-insights";
import { FEEDBACK_REASON_OPTIONS, type FeedbackReason } from "@/lib/feedback-reasons";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import { routeV3ProductCopy } from "@/lib/engine-v3/product-copy";

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

function ResultCartouche({
  distanceKm,
  ascendM,
  score,
}: {
  distanceKm: number;
  ascendM: number;
  score: number;
}) {
  return (
    <div className="tf-result-cartouche" aria-label="Aperçu cartographique du résultat">
      <div className="tf-result-cartouche-map" aria-hidden="true">
        <svg viewBox="0 0 360 220" preserveAspectRatio="none">
          <path className="cartouche-contour" d="M-12 58 C62 18 126 22 188 58 C248 92 304 86 374 46" />
          <path className="cartouche-contour" d="M-18 116 C54 82 116 80 182 120 C244 158 304 152 378 106" />
          <path className="cartouche-contour" d="M-8 176 C64 134 140 148 200 178 C260 208 316 198 374 156" />
          <path className="cartouche-path-muted" d="M48 166 C96 118 136 132 178 86 C220 42 268 50 318 76" />
          <path className="cartouche-path-muted cartouche-path-muted-b" d="M40 64 C104 88 136 112 184 118 C236 124 278 150 326 186" />
          <path className="cartouche-route" d="M82 158 C42 112 72 56 144 50 C222 42 296 78 300 132 C304 184 188 202 116 178 C102 174 90 166 82 158 Z" />
          <circle cx="82" cy="158" r="4.5" />
        </svg>
      </div>
      <div className="tf-result-cartouche-body">
        <p>Boucle terrain stabilisée</p>
        <strong>{distanceKm.toFixed(1)} km · {ascendM.toFixed(0)} m D+</strong>
        <span>indice beta {Math.round(score * 100)} · GPX exportable après vérification</span>
      </div>
    </div>
  );
}

function RefusalFeedbackButtons({
  generationId,
  errorCode,
  subCode,
  targetDistanceKm,
  targetElevationM,
  selectedProfileId,
  scenicMode,
}: {
  generationId?: string | null;
  errorCode?: string | null;
  subCode?: string | null;
  targetDistanceKm: number;
  targetElevationM: number;
  selectedProfileId: string;
  scenicMode: boolean;
}) {
  const [submitted, setSubmitted] = useState<"positive" | "negative" | null>(null);
  const [selectedReasons, setSelectedReasons] = useState<FeedbackReason[]>([]);
  const profile = PROFILES_BY_ID.get(selectedProfileId);
  const refusalReasons = FEEDBACK_REASON_OPTIONS.filter((option) => option.appliesTo === "refusal");

  const toggleReason = (reason: FeedbackReason) => {
    setSelectedReasons((current) =>
      current.includes(reason)
        ? current.filter((item) => item !== reason)
        : [...current, reason]
    );
  };

  const handleFeedback = (rating: "positive" | "negative") => {
    const feedback: RouteFeedback = {
      id: crypto.randomUUID(),
      generationId: generationId ?? undefined,
      outcome: "refused",
      errorCode: errorCode ?? undefined,
      subCode: subCode ?? undefined,
      timestamp: Date.now(),
      rating,
      reasons: selectedReasons,
      sessionType: profile?.sessionType ?? "unknown",
      sport: profile?.sport ?? "running",
      mode: scenicMode ? "SCENIC" : "PERFORMANCE",
      requestedDistanceKm: targetDistanceKm,
      requestedElevationM: targetElevationM || null,
      actualDistanceKm: null,
      actualElevationM: null,
      algorithmicScore: null,
      distanceErrorPct: null,
      elevationErrorPct: null,
    };

    saveFeedback(feedback);
    setSubmitted(rating);
  };

  if (submitted) {
    return (
      <div style={{ padding: "10px 12px", border: "1px solid var(--border)", borderRadius: "var(--radius-control)", background: "var(--bg-surface)", textAlign: "center" }}>
        <span style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "11px", color: "var(--text-muted)" }}>
          Merci, ce refus est relié à la génération beta.
        </span>
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px", marginTop: "14px" }}>
      <p style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "11px", color: "var(--text-muted)" }}>
        Ce refus t&apos;aide à choisir quoi faire ?
      </p>
      <div style={{ display: "flex", gap: "8px" }}>
        <button onClick={() => handleFeedback("positive")} style={{ flex: 1, padding: "8px 10px", background: "rgba(168,214,114,0.08)", border: "1px solid rgba(168,214,114,0.2)", borderRadius: "var(--radius-control)", color: "var(--text-primary)", cursor: "pointer", fontFamily: "var(--font-syne), sans-serif", fontSize: "11px" }}>
          Refus clair 👍
        </button>
        <button onClick={() => handleFeedback("negative")} style={{ flex: 1, padding: "8px 10px", background: "rgba(248,113,113,0.08)", border: "1px solid rgba(248,113,113,0.2)", borderRadius: "var(--radius-control)", color: "var(--text-primary)", cursor: "pointer", fontFamily: "var(--font-syne), sans-serif", fontSize: "11px" }}>
          Pas clair 👎
        </button>
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }} aria-label="Raisons du feedback refusé">
        {refusalReasons.map((option) => {
          const active = selectedReasons.includes(option.code);
          return (
            <button
              key={option.code}
              type="button"
              onClick={() => toggleReason(option.code)}
              aria-pressed={active}
              style={{ padding: "6px 8px", borderRadius: "999px", border: active ? "1px solid var(--accent-lime)" : "1px solid var(--border)", background: active ? "rgba(168,214,114,0.12)" : "var(--bg-surface)", color: active ? "var(--accent-lime)" : "var(--text-muted)", cursor: "pointer", fontFamily: "var(--font-syne), sans-serif", fontSize: "10px", letterSpacing: "0.04em" }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function RouteResult() {
  const {
    currentRoute,
    currentRouteV3,
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
    selectedProfileId,
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

  const handleDownloadV3GPX = useCallback(() => {
    if (!currentRouteV3?.routeGeoJson || !currentRouteV3.gpxAvailable) return;
    downloadV3GPX(currentRouteV3.routeGeoJson, {
      name: routeV3ProductCopy(currentRouteV3.productLabel, currentRouteV3.reason).title,
      sport: "running",
      distanceKm: currentRouteV3.metrics?.distanceProducedKm ?? currentRouteV3.metrics?.targetDistanceKm ?? 0,
      description: currentRouteV3.reason,
    });
    if (!waitlistDismissed) setShowWaitlistWidget(true);
  }, [currentRouteV3, waitlistDismissed]);

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
          <RefusalFeedbackButtons
            generationId={generationId}
            errorCode={errorCode}
            subCode={errorSubCode}
            targetDistanceKm={targetDistanceKm}
            targetElevationM={targetElevationM}
            selectedProfileId={selectedProfileId}
            scenicMode={scenicMode}
          />
        </MiniPanel>
      </div>
    );
  }

  if (currentRouteV3) {
    const copy = routeV3ProductCopy(currentRouteV3.productLabel, currentRouteV3.reason);
    const metrics = currentRouteV3.metrics;
    const distanceKm = metrics?.distanceProducedKm ?? metrics?.targetDistanceKm ?? 0;
    const toneColor = copy.tone === "ok" ? "var(--accent-lime)" : copy.tone === "adjusted" ? "var(--accent-amber)" : "var(--accent-danger)";
    const warnings = currentRouteV3.userWarnings ?? currentRouteV3.warnings;

    return (
      <div className="flex flex-col pb-6">
        <div className="px-4 md:px-6" style={{ paddingTop: "16px", paddingBottom: "16px", borderBottom: "1px solid var(--border)" }}>
          <button onClick={clearRoute} style={{ display: "inline-flex", alignItems: "center", gap: "6px", fontFamily: "var(--font-syne), sans-serif", fontSize: "10px", fontWeight: 700, letterSpacing: "0.16em", textTransform: "uppercase", color: "var(--text-dim)", background: "none", border: "none", cursor: "pointer", padding: 0, marginBottom: "14px" }} aria-label="Retour au formulaire">
            Paramètres
          </button>
          <div style={{ display: "flex", alignItems: "center", gap: "8px", marginBottom: "8px" }}>
            <span style={{ width: "8px", height: "8px", borderRadius: "50%", background: toneColor }} />
            <h2 style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "22px", color: "var(--text-primary)", letterSpacing: "-0.03em", lineHeight: 1.05 }}>
              {copy.title}
            </h2>
          </div>
          <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: copy.tone === "ok" ? "var(--text-muted)" : toneColor, lineHeight: 1.5, marginBottom: "6px" }}>
            {copy.subtitle}
          </p>
          <p style={{ fontFamily: "var(--font-jetbrains), monospace", fontSize: "12px", color: "var(--text-primary)", lineHeight: 1.6 }}>
            {distanceKm.toFixed(1)} km · label {currentRouteV3.productLabel} · {currentRouteV3.gpxAvailable ? "GPX prêt" : "GPX indisponible"}
          </p>
          <p style={{ marginTop: "4px", fontFamily: "var(--font-jetbrains), monospace", fontSize: "11px", color: "var(--text-dim)", lineHeight: 1.6 }}>
            trail strict {Math.round((metrics?.trailRatio ?? 0) * 100)}% · naturel {Math.round((metrics?.naturalWayRatio ?? 0) * 100)}% · pavé {Math.round((metrics?.pavedRatio ?? 0) * 100)}% · inconnu chemin {(metrics?.pathTrackUnknownKm ?? 0).toFixed(1)} km · repeat {Math.round((metrics?.repeatRatio ?? 0) * 100)}%
          </p>
        </div>

        <div className="px-4 md:px-6" style={{ paddingTop: "16px", display: "flex", flexDirection: "column", gap: "12px" }}>
          <MiniPanel label="Lecture V3">
            <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.55 }}>
              {currentRouteV3.reason}
            </p>
          </MiniPanel>

          <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
            <StatBlock label="Trail strict" value={`${Math.round((metrics?.trailRatio ?? 0) * 100)}%`} sub={`${(metrics?.strictTrailKm ?? 0).toFixed(1)} km`} />
            <StatBlock label="Naturel" value={`${Math.round((metrics?.naturalWayRatio ?? 0) * 100)}%`} sub={`${(metrics?.naturalDwellKm ?? 0).toFixed(1)} km dwell`} />
            <StatBlock label="Pavé" value={`${Math.round((metrics?.pavedRatio ?? 0) * 100)}%`} sub={`${(metrics?.pavedKm ?? 0).toFixed(1)} km`} />
            <StatBlock label="Répétition" value={`${Math.round((metrics?.repeatRatio ?? 0) * 100)}%`} sub={`${(metrics?.repeatEdgeKm ?? 0).toFixed(1)} km`} />
          </div>

          {warnings.length > 0 && (
            <MiniPanel label="Warnings terrain">
              <ul style={{ display: "flex", flexDirection: "column", gap: "8px", margin: 0, paddingLeft: "16px" }}>
                {warnings.map((warning) => (
                  <li key={warning} style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "var(--text-muted)", lineHeight: 1.45 }}>
                    {warning}
                  </li>
                ))}
              </ul>
            </MiniPanel>
          )}

          <button onClick={handleDownloadV3GPX} disabled={!currentRouteV3.gpxAvailable} style={{ padding: "14px 16px", borderRadius: "var(--radius-control)", border: "1px solid var(--border)", background: currentRouteV3.gpxAvailable ? "var(--accent-lime)" : "var(--bg-surface)", color: currentRouteV3.gpxAvailable ? "#10140d" : "var(--text-dim)", fontFamily: "var(--font-syne), sans-serif", fontWeight: 700, cursor: currentRouteV3.gpxAvailable ? "pointer" : "not-allowed" }}>
            Exporter GPX V3
          </button>
        </div>
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
        <ResultCartouche distanceKm={best.distanceKm} ascendM={best.ascendM} score={best.totalScore} />

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
