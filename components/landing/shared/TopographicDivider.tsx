"use client";

interface TopographicDividerProps {
  readonly height?: number;
  readonly opacity?: number;
}

/**
 * Topographic line divider — static SVG.
 * GSAP stroke-draw animation removed (dependency dropped).
 * Will be re-animated in Task 16 landing rewrite using CSS.
 */
export default function TopographicDivider({
  height = 80,
  opacity = 0.15,
}: TopographicDividerProps) {
  return (
    <svg
      viewBox="0 0 1200 80"
      preserveAspectRatio="none"
      style={{ width: "100%", height, opacity }}
      aria-hidden="true"
    >
      <path
        d="M0 40 C100 20 200 60 300 35 C400 10 500 55 600 40 C700 25 800 50 900 30 C1000 15 1100 45 1200 40"
        fill="none"
        stroke="var(--app-accent-moss)"
        strokeWidth="1"
        strokeLinecap="round"
      />
      <path
        d="M0 55 C150 35 250 65 400 50 C550 35 650 60 800 45 C950 30 1050 55 1200 50"
        fill="none"
        stroke="var(--app-border)"
        strokeWidth="0.5"
        strokeLinecap="round"
        opacity="0.5"
      />
      <path
        d="M0 25 C200 40 350 15 500 30 C650 45 800 20 950 35 C1100 50 1150 25 1200 30"
        fill="none"
        stroke="var(--app-border)"
        strokeWidth="0.5"
        strokeLinecap="round"
        opacity="0.3"
      />
    </svg>
  );
}
