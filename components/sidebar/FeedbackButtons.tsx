"use client";

import { useState } from "react";
import type { GeneratedRoute } from "@/lib/types";
import { saveFeedback, type RouteFeedback } from "@/lib/feedback-store";
import { useAppStore } from "@/lib/store";
import { FEEDBACK_REASON_OPTIONS, type FeedbackReason } from "@/lib/feedback-reasons";

interface FeedbackButtonsProps {
  route: GeneratedRoute;
  sessionConfig: {
    targetDistanceKm: number;
    targetElevationM: number;
  };
}

export default function FeedbackButtons({
  route,
  sessionConfig,
}: FeedbackButtonsProps) {
  const [submitted, setSubmitted] = useState<"positive" | "negative" | null>(null);
  const [selectedReasons, setSelectedReasons] = useState<FeedbackReason[]>([]);
  const { scenicMode } = useAppStore();

  const toggleReason = (reason: FeedbackReason) => {
    setSelectedReasons((current) =>
      current.includes(reason)
        ? current.filter((item) => item !== reason)
        : [...current, reason]
    );
  };

  if (submitted) {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          gap: "8px",
          padding: "10px 16px",
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-control)",
        }}
      >
        <span
          style={{
            fontFamily: "var(--font-syne), sans-serif",
            fontSize: "11px",
            color: "var(--text-muted)",
          }}
        >
          Merci pour ton retour !
        </span>
        <span style={{ fontSize: "14px" }}>
          {submitted === "positive" ? "👍" : "👎"}
        </span>
      </div>
    );
  }

  const handleFeedback = (rating: "positive" | "negative") => {
    const { best, profile } = route;
    const distanceError =
      Math.abs(best.distanceKm - sessionConfig.targetDistanceKm) /
      Math.max(sessionConfig.targetDistanceKm, 1);
    const elevationError =
      sessionConfig.targetElevationM > 0
        ? Math.abs(best.ascendM - sessionConfig.targetElevationM) /
          sessionConfig.targetElevationM
        : null;

    const feedback: RouteFeedback = {
      id: crypto.randomUUID(),
      timestamp: Date.now(),
      rating,
      reasons: selectedReasons,
      sessionType: profile.sessionType,
      sport: profile.sport,
      mode: scenicMode ? "SCENIC" : "PERFORMANCE",
      requestedDistanceKm: sessionConfig.targetDistanceKm,
      requestedElevationM: sessionConfig.targetElevationM || null,
      actualDistanceKm: best.distanceKm,
      actualElevationM: best.ascendM,
      algorithmicScore: best.totalScore,
      distanceErrorPct: Math.round(distanceError * 100),
      elevationErrorPct: elevationError !== null ? Math.round(elevationError * 100) : null,
    };

    saveFeedback(feedback);
    setSubmitted(rating);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: "10px" }}>
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <span
          style={{
            flex: 1,
            fontFamily: "var(--font-syne), sans-serif",
            fontSize: "11px",
            color: "var(--text-muted)",
          }}
        >
          Tu partirais courir cette trace ?
        </span>
        <button
          onClick={() => handleFeedback("positive")}
          style={{
            padding: "6px 12px",
            background: "rgba(168,214,114,0.08)",
            border: "1px solid rgba(168,214,114,0.2)",
            borderRadius: "var(--radius-control)",
            fontSize: "14px",
            cursor: "pointer",
            transition: "all 0.2s var(--ease-out-expo)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgba(168,214,114,0.16)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(168,214,114,0.4)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgba(168,214,114,0.08)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(168,214,114,0.2)";
          }}
          aria-label="J'aime ce parcours"
        >
          👍
        </button>
        <button
          onClick={() => handleFeedback("negative")}
          style={{
            padding: "6px 12px",
            background: "rgba(248,113,113,0.08)",
            border: "1px solid rgba(248,113,113,0.2)",
            borderRadius: "var(--radius-control)",
            fontSize: "14px",
            cursor: "pointer",
            transition: "all 0.2s var(--ease-out-expo)",
          }}
          onMouseEnter={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgba(248,113,113,0.16)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(248,113,113,0.4)";
          }}
          onMouseLeave={(e) => {
            (e.currentTarget as HTMLElement).style.background = "rgba(248,113,113,0.08)";
            (e.currentTarget as HTMLElement).style.borderColor = "rgba(248,113,113,0.2)";
          }}
          aria-label="Je n'aime pas ce parcours"
        >
          👎
        </button>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px" }} aria-label="Raisons du feedback">
        {FEEDBACK_REASON_OPTIONS.map((option) => {
          const active = selectedReasons.includes(option.code);
          return (
            <button
              key={option.code}
              type="button"
              onClick={() => toggleReason(option.code)}
              aria-pressed={active}
              style={{
                padding: "6px 8px",
                borderRadius: "999px",
                border: active ? "1px solid var(--accent-lime)" : "1px solid var(--border)",
                background: active ? "rgba(168,214,114,0.12)" : "var(--bg-surface)",
                color: active ? "var(--accent-lime)" : "var(--text-muted)",
                cursor: "pointer",
                fontFamily: "var(--font-syne), sans-serif",
                fontSize: "10px",
                letterSpacing: "0.04em",
              }}
            >
              {option.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}
