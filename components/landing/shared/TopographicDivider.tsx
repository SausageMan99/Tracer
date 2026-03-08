"use client";

import { useEffect, useRef } from "react";
import { gsap, ScrollTrigger } from "@/lib/gsap-setup";

interface TopographicDividerProps {
  readonly height?: number;
  readonly opacity?: number;
}

export default function TopographicDivider({
  height = 80,
  opacity = 0.15,
}: TopographicDividerProps) {
  const pathRef = useRef<SVGPathElement>(null);
  const containerRef = useRef<SVGSVGElement>(null);

  useEffect(() => {
    const path = pathRef.current;
    const container = containerRef.current;
    if (!path || !container) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const length = path.getTotalLength();
    path.style.strokeDasharray = String(length);
    path.style.strokeDashoffset = String(length);

    const trigger = ScrollTrigger.create({
      trigger: container,
      start: "top 90%",
      onEnter: () => {
        gsap.to(path, {
          strokeDashoffset: 0,
          duration: 2,
          ease: "power2.out",
        });
      },
    });

    return () => trigger.kill();
  }, []);

  return (
    <svg
      ref={containerRef}
      viewBox="0 0 1200 80"
      preserveAspectRatio="none"
      style={{ width: "100%", height, opacity }}
      aria-hidden="true"
    >
      <path
        ref={pathRef}
        d="M0 40 C100 20 200 60 300 35 C400 10 500 55 600 40 C700 25 800 50 900 30 C1000 15 1100 45 1200 40"
        fill="none"
        stroke="var(--accent-moss)"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M0 55 C150 35 250 65 400 50 C550 35 650 60 800 45 C950 30 1050 55 1200 50"
        fill="none"
        stroke="var(--border)"
        strokeWidth="0.5"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path
        d="M0 25 C200 40 350 15 500 30 C650 45 800 20 950 35 C1100 50 1150 25 1200 30"
        fill="none"
        stroke="var(--border)"
        strokeWidth="0.5"
        strokeLinecap="round"
        opacity="0.3"
      />
    </svg>
  );
}
