"use client";

/**
 * Route map visualization — static SVG.
 * GSAP stroke-draw animation removed (dependency dropped).
 * Will be re-animated in Task 16 landing rewrite using CSS.
 */
export default function RouteMapVisual() {
  return (
    <div style={{ padding: "16px", width: "100%" }}>
      <svg viewBox="0 0 400 220" style={{ width: "100%", opacity: 0.9 }}>
        {[0, 40, 80, 120, 160, 200].map((y) => (
          <line key={`h${y}`} x1="0" y1={y} x2="400" y2={y} stroke="var(--app-border)" strokeWidth="0.5" />
        ))}
        {[0, 80, 160, 240, 320, 400].map((x) => (
          <line key={`v${x}`} x1={x} y1="0" x2={x} y2="220" stroke="var(--app-border)" strokeWidth="0.5" />
        ))}
        <path
          d="M60 180 C80 180 100 160 120 140 C140 120 160 100 180 80 C200 60 220 50 250 60 C280 70 300 90 320 100 C340 110 360 130 340 160 C320 185 280 190 250 190 C200 195 120 200 60 180"
          fill="none"
          stroke="var(--app-accent-lime)"
          strokeWidth="2.5"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
        <circle cx="60" cy="180" r="5" fill="var(--app-accent-lime)" />
        <circle cx="60" cy="180" r="9" fill="none" stroke="var(--app-accent-lime)" strokeWidth="1.5" strokeOpacity="0.4" />
        <rect x="290" y="10" width="90" height="22" rx="2" fill="var(--app-accent-lime)" />
        <text x="335" y="25" textAnchor="middle" fontSize="10" fontFamily="var(--font-ui)" fontWeight="700" fill="var(--app-bg-deep)">
          Export GPX
        </text>
      </svg>
    </div>
  );
}
