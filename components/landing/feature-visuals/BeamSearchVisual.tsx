"use client";

import { useEffect, useRef } from "react";
import { gsap, ScrollTrigger } from "@/lib/gsap-setup";

/**
 * Animated beam-search tree visualization.
 * Shows branching paths from a start point, with pruned (dimmed) and
 * winning (lime) branches to convey the V2 engine's multi-candidate approach.
 */
export default function BeamSearchVisual() {
  const containerRef = useRef<HTMLDivElement>(null);
  const winnerRef = useRef<SVGPathElement>(null);
  const prunedRefs = useRef<(SVGPathElement | null)[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    const winner = winnerRef.current;
    if (!container || !winner) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const allPaths = [winner, ...prunedRefs.current.filter(Boolean)] as SVGPathElement[];
    allPaths.forEach((p) => {
      const len = p.getTotalLength();
      p.style.strokeDasharray = String(len);
      p.style.strokeDashoffset = String(len);
    });

    const trigger = ScrollTrigger.create({
      trigger: container,
      start: "top 80%",
      onEnter: () => {
        // Draw pruned paths first
        prunedRefs.current.filter(Boolean).forEach((p, i) => {
          gsap.to(p!, {
            strokeDashoffset: 0,
            duration: 1.2,
            ease: "power2.out",
            delay: i * 0.15,
          });
        });
        // Then draw winner
        gsap.to(winner, {
          strokeDashoffset: 0,
          duration: 1.6,
          ease: "power2.out",
          delay: 0.4,
        });
      },
    });

    return () => trigger.kill();
  }, []);

  return (
    <div ref={containerRef} style={{ padding: "24px", width: "100%" }}>
      <svg viewBox="0 0 400 180" style={{ width: "100%", overflow: "visible" }}>
        {/* Start node */}
        <circle cx="30" cy="90" r="6" fill="var(--accent-lime)" />
        <circle cx="30" cy="90" r="10" fill="none" stroke="var(--accent-lime)" strokeWidth="1" strokeOpacity="0.4" />

        {/* Pruned branches */}
        <path
          ref={(el) => { prunedRefs.current[0] = el; }}
          d="M30 90 C80 90 100 30 150 35 C200 40 220 25 270 30"
          fill="none" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"
        />
        <path
          ref={(el) => { prunedRefs.current[1] = el; }}
          d="M30 90 C80 90 110 140 160 145 C210 150 240 160 280 155"
          fill="none" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"
        />
        <path
          ref={(el) => { prunedRefs.current[2] = el; }}
          d="M30 90 C90 85 120 60 170 65 C220 70 250 50 300 55"
          fill="none" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"
        />
        <path
          ref={(el) => { prunedRefs.current[3] = el; }}
          d="M30 90 C70 95 100 120 150 115 C200 110 230 130 270 125"
          fill="none" stroke="var(--border)" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"
        />

        {/* Winner path */}
        <path
          ref={winnerRef}
          d="M30 90 C80 88 110 75 160 80 C210 85 250 70 300 75 C340 78 360 85 370 90"
          fill="none" stroke="var(--accent-lime)" strokeWidth="2.5" strokeLinecap="round"
        />

        {/* End node on winner */}
        <circle cx="370" cy="90" r="5" fill="var(--accent-lime)" />

        {/* Pruned X marks */}
        <text x="270" y="25" fill="var(--text-muted)" fontSize="10" fontFamily="var(--font-jetbrains)" opacity="0.5">✕</text>
        <text x="280" y="165" fill="var(--text-muted)" fontSize="10" fontFamily="var(--font-jetbrains)" opacity="0.5">✕</text>
        <text x="300" y="50" fill="var(--text-muted)" fontSize="10" fontFamily="var(--font-jetbrains)" opacity="0.4">✕</text>
        <text x="270" y="135" fill="var(--text-muted)" fontSize="10" fontFamily="var(--font-jetbrains)" opacity="0.4">✕</text>

        {/* Winner label */}
        <text x="340" y="110" fill="var(--accent-lime)" fontSize="9" fontFamily="var(--font-jetbrains)" fontWeight="500">
          BEST
        </text>

        {/* Candidates count */}
        <text x="10" y="170" fill="var(--text-muted)" fontSize="8" fontFamily="var(--font-jetbrains)">
          847 candidats
        </text>
      </svg>
    </div>
  );
}
