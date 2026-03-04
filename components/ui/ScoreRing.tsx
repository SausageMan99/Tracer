"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";

interface ScoreRingProps {
  /** Score 0–100 */
  score: number;
  /** Ring diameter in px */
  size?: number;
  /** Ring stroke color */
  color?: string;
  /** Track color (background ring) */
  trackColor?: string;
  /** Stroke width */
  strokeWidth?: number;
  className?: string;
}

/**
 * SVG circular progress ring.
 * Animates from 0 to `score` on mount.
 *
 * @example
 * <ScoreRing score={87} size={80} color="var(--accent-lime)" />
 */
export default function ScoreRing({
  score,
  size = 80,
  color = "var(--accent-lime)",
  trackColor = "var(--bg-elevated)",
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
          const target = ((100 - score) / 100) * circumference;
          gsap.to(el, {
            strokeDashoffset: target,
            duration: 1.2,
            ease: "power2.out",
          });
          // Also animate the text number
          if (textRef.current) {
            const obj = { val: 0 };
            gsap.to(obj, {
              val: score,
              duration: 1.2,
              ease: "power2.out",
              onUpdate: () => {
                if (textRef.current) {
                  textRef.current.textContent = `${Math.round(obj.val)}%`;
                }
              },
            });
          }
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(el);
    return () => observer.disconnect();
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [score]);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className={className}
      role="img"
      aria-label={`Score: ${score}%`}
    >
      {/* Track */}
      <circle
        cx={cx} cy={cy} r={r}
        fill="none"
        stroke={trackColor}
        strokeWidth={strokeWidth}
      />
      {/* Progress */}
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
      {/* Label */}
      <text
        ref={textRef}
        x={cx} y={cy}
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        fontSize={size * 0.2}
        fontFamily="var(--font-jetbrains), monospace"
        fontWeight="500"
      >
        0%
      </text>
    </svg>
  );
}
