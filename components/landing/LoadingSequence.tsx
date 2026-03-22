"use client";

import { useEffect } from "react";

interface LoadingSequenceProps {
  readonly onComplete: () => void;
}

export default function LoadingSequence({ onComplete }: LoadingSequenceProps) {
  useEffect(() => {
    // Skip on return visits
    if (typeof window !== "undefined" && sessionStorage.getItem("tf-loaded")) {
      onComplete();
      return;
    }

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      sessionStorage.setItem("tf-loaded", "1");
      onComplete();
      return;
    }

    // Simple timeout — GSAP-based scramble animation removed
    const timer = setTimeout(() => {
      sessionStorage.setItem("tf-loaded", "1");
      onComplete();
    }, 1200);

    return () => clearTimeout(timer);
  }, [onComplete]);

  return (
    <div
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "var(--app-bg-deep)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        animation: "fade-up 0.3s var(--ease-out-expo) both",
      }}
    >
      <span
        style={{
          fontFamily: "var(--font-ui), sans-serif",
          fontSize: "clamp(14px, 2vw, 18px)",
          fontWeight: 600,
          letterSpacing: "0.4em",
          color: "var(--app-accent-lime)",
          textTransform: "uppercase",
        }}
      >
        TERRAFORMING EN COURS...
      </span>
      <span
        style={{
          fontFamily: "var(--font-body), monospace",
          fontSize: "12px",
          color: "var(--app-text-muted)",
          opacity: 0.5,
        }}
      >
        48.8566°N 2.3522°E
      </span>
    </div>
  );
}
