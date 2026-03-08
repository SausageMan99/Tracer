"use client";

import { useEffect, useRef } from "react";
import { gsap, ScrollTrigger } from "@/lib/gsap-setup";

export default function RouteMapVisual() {
  const pathRef = useRef<SVGPathElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const path = pathRef.current;
    const container = containerRef.current;
    if (!path || !container) return;
    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);

    const trigger = ScrollTrigger.create({
      trigger: container,
      start: "top 80%",
      onEnter: () => {
        gsap.to(path, {
          strokeDashoffset: 0,
          duration: 1.8,
          ease: "power2.out",
          delay: 0.2,
        });
      },
    });
    return () => trigger.kill();
  }, []);

  return (
    <div ref={containerRef} style={{ padding: "16px", width: "100%" }}>
      <svg viewBox="0 0 400 220" style={{ width: "100%", opacity: 0.9 }}>
        {[0, 40, 80, 120, 160, 200].map((y) => (
          <line key={`h${y}`} x1="0" y1={y} x2="400" y2={y} stroke="var(--border)" strokeWidth="0.5" />
        ))}
        {[0, 80, 160, 240, 320, 400].map((x) => (
          <line key={`v${x}`} x1={x} y1="0" x2={x} y2="220" stroke="var(--border)" strokeWidth="0.5" />
        ))}
        <path
          ref={pathRef}
          d="M60 180 C80 180 100 160 120 140 C140 120 160 100 180 80 C200 60 220 50 250 60 C280 70 300 90 320 100 C340 110 360 130 340 160 C320 185 280 190 250 190 C200 195 120 200 60 180"
          fill="none"
          stroke="var(--accent-lime)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="60" cy="180" r="5" fill="var(--accent-lime)" />
        <circle cx="60" cy="180" r="9" fill="none" stroke="var(--accent-lime)" strokeWidth="1.5" strokeOpacity="0.4" />
        <rect x="290" y="10" width="90" height="22" rx="2" fill="var(--accent-lime)" />
        <text x="335" y="25" textAnchor="middle" fontSize="10" fontFamily="var(--font-syne)" fontWeight="700" fill="var(--bg-deep)">
          Export GPX
        </text>
      </svg>
    </div>
  );
}
