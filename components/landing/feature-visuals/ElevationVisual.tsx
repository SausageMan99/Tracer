"use client";

/**
 * Elevation profile visualization — static SVG.
 * GSAP stroke-draw animation removed (dependency dropped).
 * Will be re-animated in Task 16 landing rewrite using CSS.
 */
export default function ElevationVisual() {
  return (
    <div style={{ padding: "24px", width: "100%" }}>
      <svg viewBox="0 0 400 120" style={{ width: "100%", overflow: "visible" }}>
        <defs>
          <linearGradient id="elev-grad" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#4A7C59" stopOpacity="0.4" />
            <stop offset="100%" stopColor="#4A7C59" stopOpacity="0.02" />
          </linearGradient>
        </defs>
        <path
          d="M0 100 C30 100 40 60 60 45 C80 30 90 70 110 55 C130 40 140 20 160 15 C180 10 195 35 210 30 C225 25 240 50 260 45 C280 40 290 70 310 65 C330 60 350 30 380 25 L400 25 L400 120 L0 120 Z"
          fill="url(#elev-grad)"
        />
        <path
          d="M0 100 C30 100 40 60 60 45 C80 30 90 70 110 55 C130 40 140 20 160 15 C180 10 195 35 210 30 C225 25 240 50 260 45 C280 40 290 70 310 65 C330 60 350 30 380 25 L400 25"
          fill="none"
          stroke="var(--app-accent-sage)"
          strokeWidth="2"
          strokeLinecap="round"
        />
        <text x="8" y="18" fill="var(--app-accent-amber)" fontSize="9" fontFamily="var(--font-body)" fontWeight="500">
          D+ 847m
        </text>
        <text x="360" y="30" fill="var(--app-text-muted)" fontSize="8" fontFamily="var(--font-body)">
          30m res.
        </text>
      </svg>
    </div>
  );
}
