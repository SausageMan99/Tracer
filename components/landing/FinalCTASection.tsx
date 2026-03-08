"use client";

import dynamic from "next/dynamic";
import GrainOverlay from "@/components/ui/GrainOverlay";
import TextReveal from "@/components/ui/TextReveal";
import MagneticButton from "@/components/ui/MagneticButton";
import ScrambleNumber from "@/components/ui/ScrambleNumber";

const TerrainCanvas = dynamic(
  () => import("@/components/landing/TerrainCanvas"),
  { ssr: false, loading: () => null },
);

export default function FinalCTASection() {
  return (
    <section
      className="min-h-screen"
      style={{
        position: "relative",
        overflow: "hidden",
        background: "var(--bg-deep)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        textAlign: "center",
        borderTop: "1px solid var(--border)",
      }}
    >
      <TerrainCanvas cameraY={50} cameraZ={40} opacity={0.5} />
      <GrainOverlay opacity={0.03} />

      <div
        className="px-6 md:px-16 lg:px-32"
        style={{
          position: "relative",
          zIndex: 5,
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          gap: "32px",
        }}
      >
        <h2
          style={{
            fontFamily: "var(--font-playfair), serif",
            fontSize: "clamp(36px, 6vw, 72px)",
            fontStyle: "italic",
            color: "var(--text-primary)",
            lineHeight: 1.15,
            maxWidth: "600px",
          }}
        >
          <TextReveal trigger="scroll" splitType="words">
            Prêt à forger ?
          </TextReveal>
        </h2>

        <div style={{ display: "flex", gap: "16px", flexWrap: "wrap", justifyContent: "center" }}>
          <MagneticButton href="/app">Ouvrir TrailForge</MagneticButton>
          <MagneticButton href="https://github.com" primary={false}>
            Voir sur GitHub
          </MagneticButton>
        </div>

        {/* Counter */}
        <div style={{ marginTop: "16px" }}>
          <ScrambleNumber
            text="127 parcours forgés cette semaine"
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "13px",
              color: "var(--text-muted)",
              opacity: 0.7,
            }}
          />
        </div>
      </div>
    </section>
  );
}
