"use client";

import React, { useEffect, useRef, type CSSProperties, type ElementType } from "react";
import { gsap, ScrollTrigger, SplitText } from "@/lib/gsap-setup";

type SplitMode = "chars" | "words" | "lines";

interface TextRevealProps {
  children: string;
  as?: ElementType;
  splitType?: SplitMode;
  stagger?: number;
  duration?: number;
  delay?: number;
  trigger?: "scroll" | "mount";
  className?: string;
  style?: CSSProperties;
}

export default function TextReveal({
  children,
  as: Tag = "span",
  splitType = "words",
  stagger = 0.04,
  duration = 0.7,
  delay = 0,
  trigger = "scroll",
  className,
  style,
}: TextRevealProps) {
  const ref = useRef<HTMLElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;

    // Check reduced motion
    if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;

    const split = new SplitText(el, { type: splitType, mask: splitType });

    const targets =
      splitType === "chars"
        ? split.chars
        : splitType === "words"
          ? split.words
          : split.lines;

    const animConfig = {
      yPercent: 110,
      duration,
      stagger,
      ease: "power3.out",
      delay,
    };

    if (trigger === "scroll") {
      gsap.from(targets, {
        ...animConfig,
        scrollTrigger: {
          trigger: el,
          start: "top 85%",
          once: true,
        },
      });
    } else {
      gsap.from(targets, animConfig);
    }

    return () => {
      split.revert();
      ScrollTrigger.getAll().forEach((st) => {
        if (st.trigger === el) st.kill();
      });
    };
  }, [children, splitType, stagger, duration, delay, trigger]);

  return React.createElement(
    Tag,
    { ref, className, style },
    children,
  );
}
