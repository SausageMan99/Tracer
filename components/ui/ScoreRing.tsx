"use client";

import { useEffect, useRef } from "react";

interface ScoreRingProps {
  score: number;
  size?: number;
  color?: string;
  trackColor?: string;
  strokeWidth?: number;
  className?: string;
}

/**
 * SVG circular progress ring.
 * Animates from 0 to `score` on mount using IntersectionObserver + rAF.
 * GSAP dependency removed.
 */
export default function ScoreRing({
  score,
  size = 80,
  color = "var(--app-accent-lime)",
  trackColor = "var(--app-bg-elevated)",
  strokeWidth = 3,
  className = "",
}: ScoreRingProps) {
  const progressRef = useRef<SVGCircleElement>(null);
  const textRef = useRef<SVGTextElement>(null);
  const hasRun = useRef(false);

  const cx = size / 2;
  const cy = size / 2;
  const r = (size - strokeWidth * 2) / 2 - 2;
  const circumference = 2 * Math.PI * r;

  useEffect(() => {
    const el = progressRef.current;
    if (!el) return;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasRun.current) {
          hasRun.current = true;
          const duration = 1200;
          const start = performance.now();
          const targetOffset = ((100 - score) / 100) * circumference;

          function tick(now: number) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            // ease out quad
            const eased = 1 - (1 - progress) * (1 - progress);
            const currentOffset = circumference - eased * (circumference - targetOffset);
            if (progressRef.current) {
              progressRef.current.style.strokeDashoffset = String(currentOffset);
            }
            if (textRef.current) {
              textRef.current.textContent = `${Math.round(eased * score)}%`;
            }
            if (progress < 1) requestAnimationFrame(tick);
          }

          requestAnimationFrame(tick);
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [score, circumference]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label={`Score: ${score}%`}
    >
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={trackColor}
        strokeWidth={strokeWidth}
      />
      <circle
        ref={progressRef}
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="square"
        strokeDasharray={circumference}
        strokeDashoffset={circumference}
        transform={`rotate(-90 ${cx} ${cy})`}
      />
      <text
        ref={textRef}
        x={cx} y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        fontSize={size * 0.2}
        fontFamily="var(--font-body), monospace"
        fontWeight="500"
      >
        0%
      </text>
    </svg>
  );
}
