"use client";

import React, { type CSSProperties, type ElementType } from "react";

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

/**
 * Text reveal component — animations removed (GSAP/SplitText dependency
 * dropped). Renders children directly. Will be replaced in Task 16 landing
 * rewrite with a CSS-only reveal approach.
 */
export default function TextReveal({
  children,
  as: Tag = "span",
  className,
  style,
}: TextRevealProps) {
  return React.createElement(Tag, { className, style }, children);
}
