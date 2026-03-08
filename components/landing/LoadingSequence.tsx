"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap-setup";

interface LoadingSequenceProps {
  readonly onComplete: () => void;
}

export default function LoadingSequence({ onComplete }: LoadingSequenceProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  const coordRef = useRef<HTMLSpanElement>(null);

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

    const container = containerRef.current;
    const textEl = textRef.current;
    const coordEl = coordRef.current;
    if (!container || !textEl || !coordEl) return;

    const tl = gsap.timeline({
      onComplete: () => {
        sessionStorage.setItem("tf-loaded", "1");
        onComplete();
      },
    });

    // Scramble text animation
    tl.to(textEl, {
      duration: 1.4,
      scrambleText: {
        text: "TERRAFORMING EN COURS...",
        chars: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789",
        speed: 0.5,
        revealDelay: 0.3,
      },
      ease: "none",
    });

    // Fade in coordinates
    tl.fromTo(
      coordEl,
      { opacity: 0, y: 10 },
      { opacity: 0.5, y: 0, duration: 0.5, ease: "expo.out" },
      0.6,
    );

    // Hold
    tl.to({}, { duration: 0.4 });

    // Clip-path wipe out
    tl.to(container, {
      clipPath: "inset(0 0 100% 0)",
      duration: 0.8,
      ease: "expo.inOut",
    });

    return () => {
      tl.kill();
    };
  }, [onComplete]);

  return (
    <div
      ref={containerRef}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 100,
        background: "var(--bg-deep)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: "16px",
        clipPath: "inset(0 0 0% 0)",
      }}
    >
      <span
        ref={textRef}
        style={{
          fontFamily: "var(--font-syne), sans-serif",
          fontSize: "clamp(14px, 2vw, 18px)",
          fontWeight: 600,
          letterSpacing: "0.4em",
          color: "var(--accent-lime)",
          textTransform: "uppercase",
        }}
      >
        TERRAFORMING EN COURS...
      </span>
      <span
        ref={coordRef}
        style={{
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: "12px",
          color: "var(--text-muted)",
          opacity: 0,
        }}
      >
        48.8566°N 2.3522°E
      </span>
    </div>
  );
}
