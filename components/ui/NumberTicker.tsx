"use client";

import { useEffect, useRef, useState } from "react";

interface NumberTickerProps {
  from?: number;
  to: number;
  duration?: number;
  suffix?: string;
  prefix?: string;
  className?: string;
  style?: React.CSSProperties;
  autoStart?: boolean;
}

/**
 * Animated number counter using IntersectionObserver + requestAnimationFrame.
 * GSAP dependency removed.
 */
export default function NumberTicker({
  from = 0,
  to,
  duration = 1500,
  suffix = "",
  prefix = "",
  className = "",
  style,
  autoStart = true,
}: NumberTickerProps) {
  const spanRef = useRef<HTMLSpanElement>(null);
  const [displayed, setDisplayed] = useState(from);
  const hasRun = useRef(false);

  useEffect(() => {
    if (!autoStart || !spanRef.current) return;

    const el = spanRef.current;

    const observer = new IntersectionObserver(
      ([entry]) => {
        if (entry.isIntersecting && !hasRun.current) {
          hasRun.current = true;
          const start = performance.now();
          const range = to - from;

          function tick(now: number) {
            const elapsed = now - start;
            const progress = Math.min(elapsed / duration, 1);
            // ease out quad
            const eased = 1 - (1 - progress) * (1 - progress);
            setDisplayed(Math.round(from + range * eased));
            if (progress < 1) requestAnimationFrame(tick);
          }

          requestAnimationFrame(tick);
          observer.disconnect();
        }
      },
      { threshold: 0.3 }
    );

    observer.observe(el);
    return () => observer.disconnect();
  }, [autoStart, from, to, duration]);

  return (
    <span ref={spanRef} className={`number-ticker ${className}`} style={style}>
      {prefix}
      {displayed}
      {suffix}
    </span>
  );
}
