"use client";

/**
 * SVG feTurbulence noise grain overlay.
 * Position absolute over any parent to add texture.
 */
export default function GrainOverlay({ opacity = 0.04 }: { opacity?: number }) {
  return (
    <svg
      aria-hidden="true"
      className="pointer-events-none absolute inset-0 w-full h-full"
      style={{ opacity, zIndex: 1 }}
    >
      <filter id="grain-noise">
        <feTurbulence
          type="fractalNoise"
          baseFrequency="0.65"
          numOctaves="3"
          stitchTiles="stitch"
        />
        <feColorMatrix type="saturate" values="0" />
      </filter>
      <rect
        width="100%"
        height="100%"
        filter="url(#grain-noise)"
        style={{ mixBlendMode: "overlay" }}
      />
    </svg>
  );
}
