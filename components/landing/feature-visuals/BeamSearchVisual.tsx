"use client";

/**
 * Beam-search tree visualization — static SVG.
 * GSAP draw animation removed (dependency dropped).
 * Will be re-animated in Task 16 landing rewrite using CSS.
 */
export default function BeamSearchVisual() {
  return (
    <div style={{ padding: "24px", width: "100%" }}>
      <svg viewBox="0 0 400 180" style={{ width: "100%", overflow: "visible" }}>
        {/* Start node */}
        <circle cx="30" cy="90" r="6" fill="var(--app-accent-lime)" />
        <circle cx="30" cy="90" r="10" fill="none" stroke="var(--app-accent-lime)" strokeWidth="1" strokeOpacity="0.4" />

        {/* Pruned branches */}
        <path
          d="M30 90 C80 90 100 30 150 35 C200 40 220 25 270 30"
          fill="none" stroke="var(--app-border)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"
        />
        <path
          d="M30 90 C80 90 110 140 160 145 C210 150 240 160 280 155"
          fill="none" stroke="var(--app-border)" strokeWidth="1.5" strokeLinecap="round" opacity="0.5"
        />
        <path
          d="M30 90 C90 85 120 60 170 65 C220 70 250 50 300 55"
          fill="none" stroke="var(--app-border)" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"
        />
        <path
          d="M30 90 C70 95 100 120 150 115 C200 110 230 130 270 125"
          fill="none" stroke="var(--app-border)" strokeWidth="1.5" strokeLinecap="round" opacity="0.4"
        />

        {/* Winner path */}
        <path
          d="M30 90 C80 88 110 75 160 80 C210 85 250 70 300 75 C340 78 360 85 370 90"
          fill="none" stroke="var(--app-accent-lime)" strokeWidth="2.5" strokeLinecap="round"
        />

        {/* End node on winner */}
        <circle cx="370" cy="90" r="5" fill="var(--app-accent-lime)" />

        {/* Pruned X marks */}
        <text x="270" y="25" fill="var(--app-text-muted)" fontSize="10" fontFamily="var(--font-body)" opacity="0.5">✕</text>
        <text x="280" y="165" fill="var(--app-text-muted)" fontSize="10" fontFamily="var(--font-body)" opacity="0.5">✕</text>
        <text x="300" y="50" fill="var(--app-text-muted)" fontSize="10" fontFamily="var(--font-body)" opacity="0.4">✕</text>
        <text x="270" y="135" fill="var(--app-text-muted)" fontSize="10" fontFamily="var(--font-body)" opacity="0.4">✕</text>

        {/* Winner label */}
        <text x="340" y="110" fill="var(--app-accent-lime)" fontSize="9" fontFamily="var(--font-body)" fontWeight="500">
          BEST
        </text>

        {/* Candidates count */}
        <text x="10" y="170" fill="var(--app-text-muted)" fontSize="8" fontFamily="var(--font-body)">
          847 candidats
        </text>
      </svg>
    </div>
  );
}
