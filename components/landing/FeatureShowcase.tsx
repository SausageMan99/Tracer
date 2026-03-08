"use client";

import TextReveal from "@/components/ui/TextReveal";
import StackingFeatureCards from "@/components/landing/StackingFeatureCards";
import ElevationVisual from "@/components/landing/feature-visuals/ElevationVisual";
import SessionChipsVisual from "@/components/landing/feature-visuals/SessionChipsVisual";
import RouteMapVisual from "@/components/landing/feature-visuals/RouteMapVisual";
import BeamSearchVisual from "@/components/landing/feature-visuals/BeamSearchVisual";

const CARDS = [
  {
    badge: "Précision altimétrique",
    title: "D+ au mètre. Pas à l'estimation.",
    desc: "Données Open-Meteo à 30m de résolution. Gradient max, régularité, D+ et D− calculés sur chaque segment.",
    visual: <ElevationVisual />,
  },
  {
    badge: "14 profils de séance",
    title: "Chaque séance a son ADN.",
    desc: "Fractionné 30/30, seuil lactique, gran fondo, trail — chaque profil a ses propres critères de scoring. Zéro compromis.",
    visual: <SessionChipsVisual />,
  },
  {
    badge: "Export GPX universel",
    title: "Direct sur ta montre.",
    desc: "Transfert vers Garmin, Wahoo ou Suunto. Format GPX 1.1 avec élévation sur chaque point. Prêt à partir en 10 secondes.",
    visual: <RouteMapVisual />,
  },
  {
    badge: "Moteur V2",
    title: "847 routes. La meilleure gagne.",
    desc: "Beam-search multi-directionnel, scoring multi-critères, déduplication géométrique. Le parcours optimal émerge automatiquement.",
    visual: <BeamSearchVisual />,
  },
] as const;

export default function FeatureShowcase() {
  return (
    <section style={{ background: "var(--bg-surface)", borderTop: "1px solid var(--border)" }}>
      <div className="py-16 md:py-20 px-6 md:px-16 lg:px-32 pb-10" style={{ textAlign: "center" }}>
        <h2
          style={{
            fontFamily: "var(--font-playfair), serif",
            fontSize: "clamp(28px, 4vw, 48px)",
            fontStyle: "italic",
            color: "var(--text-primary)",
          }}
        >
          <TextReveal trigger="scroll" splitType="words">
            Tout ce dont tu as besoin.
          </TextReveal>
        </h2>
      </div>

      <StackingFeatureCards cards={CARDS} />
    </section>
  );
}
