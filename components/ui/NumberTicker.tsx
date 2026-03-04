"use client";

import { useEffect, useRef } from "react";
import { gsap } from "gsap";
import { ScrollTrigger } from "gsap/ScrollTrigger";

interface NumberTickerProps {
  /** Start value */
  from?: number;
  /** End value */
  to: number;
  /** Animation duration in seconds */
  duration?: number;
  /** Optional suffix (e.g. "+" or "s") */
  suffix?: string;
  /** Optional prefix (e.g. "<") */
  prefix?: string;
  className?: string;
  style?: React.CSSProperties;
  /** Whether to start animating immediately. Default true. */
  autoStart?: boolean;
}

/**
 * Animated number counter using GSAP ScrollTrigger.
 * Animates from `from` to `to` once the element enters the viewport.
 *
 * @example
 * <NumberTicker to={847} suffix="+" className="text-accent-lime" />
 */
export default function NumberTicker({
  from = 0,
  to,
  duration = 1.5,
  suffix = "",
  prefix = "",
  className = "",
  style,
  autoStart = true,
}: NumberTickerProps) {
  const spanRef = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    if (!autoStart || !spanRef.current) return;

    gsap.registerPlugin(ScrollTrigger);

    const el = spanRef.current;
    const obj = { val: from };

    // Set initial display value
    el.textContent = `${prefix}${from}${suffix}`;

    const tween = gsap.to(obj, {
      val: to,
      duration,
      ease: "power2.out",
      paused: true,
      onUpdate: () => {
        if (el) {
          el.textContent = `${prefix}${Math.round(obj.val)}${suffix}`;
        }
      },
    });

    const st = ScrollTrigger.create({
      trigger: el,
      start: "top 80%",
      once: true,
      onEnter: () => tween.play(),
    });

    return () => {
      tween.kill();
      st.kill();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <span ref={spanRef} className={`number-ticker ${className}`} style={style}>
      {prefix}
      {from}
      {suffix}
    </span>
  );
}
