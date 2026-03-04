"use client";

import { useEffect, useRef } from "react";

interface SurfaceSegment {
  label: string;
  pct: number;
  color: string;
}

interface SurfaceBarProps {
  segments: SurfaceSegment[];
  height?: number;
  className?: string;
}

/**
 * Horizontal stacked bar showing surface breakdown.
 * Segments animate their width on mount.
 *
 * @example
 * <SurfaceBar segments={[
 *   { label: "Asphalte", pct: 60, color: "var(--accent-moss)" },
 *   { label: "Gravier",  pct: 25, color: "var(--accent-trail)" },
 *   { label: "Trail",    pct: 15, color: "var(--accent-sage)" },
 * ]} />
 */
export default function SurfaceBar({
  segments,
  height = 4,
  className = "",
}: SurfaceBarProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const barsRef = useRef<HTMLDivElement[]>([]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container || !barsRef.current.length) return;

    // Set initial widths to 0
    barsRef.current.forEach((bar) => {
      if (bar) bar.style.width = "0%";
    });

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting) {
          barsRef.current.forEach((bar, i) => {
            if (!bar) return;
            const seg = segments[i];
            if (!seg) return;
            setTimeout(() => {
              bar.style.width = `${seg.pct}%`;
              bar.style.transition = "width 0.8s cubic-bezier(0.16,1,0.3,1)";
            }, i * 80);
          });
          observer.disconnect();
        }
      },
      { threshold: 0.5 }
    );
    observer.observe(container);
    return () => observer.disconnect();
  }, [segments]);

  return (
    <div className={className}>
      {/* Stacked bar */}
      <div
        ref={containerRef}
        className="flex overflow-hidden"
        style={{ height, borderRadius: "2px" }}
        role="img"
        aria-label="Répartition des surfaces"
      >
        {segments.map((seg, i) => (
          <div
            key={seg.label}
            ref={(el) => { if (el) barsRef.current[i] = el; }}
            style={{
              width: `${seg.pct}%`,
              background: seg.color,
              height: "100%",
            }}
            title={`${seg.label}: ${seg.pct}%`}
          />
        ))}
      </div>

      {/* Legend */}
      <div className="flex flex-wrap gap-3 mt-2">
        {segments.map((seg) => (
          <div key={seg.label} className="flex items-center gap-1.5">
            <span
              className="inline-block w-2.5 h-2.5 flex-shrink-0"
              style={{ background: seg.color, borderRadius: "1px" }}
            />
            <span
              style={{
                fontFamily: "var(--font-syne), sans-serif",
                fontSize: "10px",
                color: "var(--text-muted)",
              }}
            >
              {seg.label} {seg.pct}%
            </span>
          </div>
        ))}
      </div>
    </div>
  );
}
