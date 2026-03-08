"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap-setup";

interface ScrambleNumberProps {
  text: string;
  duration?: number;
  speed?: number;
  className?: string;
  style?: React.CSSProperties;
}

export default function ScrambleNumber({
  text,
  duration = 1.5,
  speed = 0.4,
  className,
  style,
}: ScrambleNumberProps) {
  const ref = useRef<HTMLSpanElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      el.textContent = text;
      return;
    }

    // Start with placeholder
    el.textContent = text.replace(/[0-9]/g, "0").replace(/[a-zA-Z]/g, "\u2014");

    const tween = gsap.to(el, {
      duration,
      scrambleText: {
        text,
        chars: "0123456789+-<>",
        speed,
        revealDelay: 0.3,
      },
      scrollTrigger: {
        trigger: el,
        start: "top 80%",
        once: true,
      },
    });

    return () => {
      tween.kill();
    };
  }, [text, duration, speed]);

  return (
    <span ref={ref} className={className} style={style}>
      {text}
    </span>
  );
}
