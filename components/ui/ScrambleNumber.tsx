"use client";

interface ScrambleNumberProps {
  text: string;
  duration?: number;
  speed?: number;
  className?: string;
  style?: React.CSSProperties;
}

/**
 * Number display component — scramble animation removed (GSAP dependency
 * dropped). Renders text directly. Will be replaced in Task 16 landing
 * rewrite with a CSS-based counter animation if needed.
 */
export default function ScrambleNumber({
  text,
  className,
  style,
}: ScrambleNumberProps) {
  return (
    <span className={className} style={style}>
      {text}
    </span>
  );
}
