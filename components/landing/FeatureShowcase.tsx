"use client";

import TextReveal from "@/components/ui/TextReveal";
import StackingFeatureCards from "@/components/landing/StackingFeatureCards";
import ElevationVisual from "@/components/landing/feature-visuals/ElevationVisual";
import SessionChipsVisual from "@/components/landing/feature-visuals/SessionChipsVisual";
import RouteMapVisual from "@/components/landing/feature-visuals/RouteMapVisual";
import BeamSearchVisual from "@/components/landing/feature-visuals/BeamSearchVisual";

const CARDS = [
  {
    badge: "D+ contrôlé",
    title: "Le dénivelé compte vraiment.",
    desc: "TrailForge vise ton D+ et affiche les compromis quand le terrain local ne permet pas de respecter la séance.",
    visual: <ElevationVisual />,
  },
  {
    badge: "Profil trail",
    title: "Moins de bitume, plus de terrain.",
    desc: "Le scoring privilégie sentiers, chemins, parcs et corridors naturels au lieu de tracer une simple boucle urbaine.",
    visual: <SessionChipsVisual />,
  },
  {
    badge: "Export GPX universel",
    title: "Direct sur ta montre.",
    desc: "Format GPX propre, compatible Garmin, COROS, Suunto et Strava. Tu exportes, tu synchronises, tu pars.",
    visual: <RouteMapVisual />,
  },
  {
    badge: "Confiance terrain",
    title: "Pas de fausse promesse.",
    desc: "Si la boucle est contrainte, TrailForge l’indique clairement : distance ajustée, D+ approximatif ou trop de route.",
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
            TrailForge devient volontairement plus étroit.
          </TextReveal>
        </h2>
      </div>

      <StackingFeatureCards cards={CARDS} />
    </section>
  );
}
