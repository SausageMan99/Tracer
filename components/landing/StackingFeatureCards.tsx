"use client";

import { useEffect, useRef } from "react";
import { gsap } from "@/lib/gsap-setup";
import { usePrefersReducedMotion } from "@/hooks/usePrefersReducedMotion";

// ── Types ────────────────────────────────────────────────────────────────────

interface FeatureCard {
  readonly badge: string;
  readonly title: string;
  readonly desc: string;
  readonly visual: React.ReactNode;
}

interface StackingFeatureCardsProps {
  readonly cards: readonly FeatureCard[];
}

// ── Card content ─────────────────────────────────────────────────────────────

function CardContent({
  badge,
  title,
  desc,
  visual,
  reverse,
}: FeatureCard & { reverse: boolean }) {
  return (
    <div
      className="grid grid-cols-1 md:grid-cols-2 py-12 md:py-20 px-6 md:px-16 lg:px-32"
      style={{
        gap: "clamp(32px, 6vw, 80px)",
        alignItems: "center",
        width: "100%",
        height: "100%",
        boxSizing: "border-box",
      }}
    >
      <div style={{ order: reverse ? 2 : 1 }}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            padding: "4px 12px",
            borderRadius: "2px",
            marginBottom: "20px",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-syne), sans-serif",
              fontSize: "10px",
              letterSpacing: "0.2em",
              color: "var(--accent-sage)",
              textTransform: "uppercase",
            }}
          >
            {badge}
          </span>
        </div>
        <h3
          style={{
            fontFamily: "var(--font-playfair), serif",
            fontSize: "clamp(24px, 3vw, 36px)",
            fontStyle: "italic",
            color: "var(--text-primary)",
            marginBottom: "16px",
            lineHeight: 1.3,
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontFamily: "var(--font-inter), sans-serif",
            fontSize: "15px",
            color: "var(--text-muted)",
            lineHeight: 1.7,
          }}
        >
          {desc}
        </p>
      </div>
      <div
        style={{
          order: reverse ? 1 : 2,
          background: "var(--bg-surface)",
          border: "1px solid var(--border)",
          borderRadius: "2px",
          overflow: "hidden",
          aspectRatio: "16/9",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {visual}
      </div>
    </div>
  );
}

// ── Stacking Feature Cards ───────────────────────────────────────────────────

export default function StackingFeatureCards({ cards }: StackingFeatureCardsProps) {
  const prefersReducedMotion = usePrefersReducedMotion();
  const containerRef = useRef<HTMLDivElement>(null);
  const cardRefs = useRef<(HTMLDivElement | null)[]>([]);

  useEffect(() => {
    if (prefersReducedMotion) return;

    const container = containerRef.current;
    if (!container) return;
    if (cardRefs.current.length === 0) return;

    const ctx = gsap.context(() => {
      const tl = gsap.timeline({
        scrollTrigger: {
          trigger: container,
          start: "top top",
          end: `+=${cards.length * window.innerHeight}`,
          pin: true,
          scrub: 0.5,
        },
      });

      cards.forEach((_, i) => {
        if (i === 0) return;
        const currentCard = cardRefs.current[i];
        const previousCard = cardRefs.current[i - 1];
        if (!currentCard || !previousCard) return;

        // Animate card in from below
        tl.fromTo(
          currentCard,
          { yPercent: 100 },
          { yPercent: 0, duration: 1, ease: "none" },
          i - 1,
        );
        // Scale down and dim previous card
        tl.to(
          previousCard,
          { scale: 0.96, opacity: 0.6, duration: 1, ease: "none" },
          i - 1,
        );
      });
    }, container);

    return () => ctx.revert();
  }, [cards, prefersReducedMotion]);

  // Reduced motion: simple stacked layout without animation
  if (prefersReducedMotion) {
    return (
      <div style={{ display: "flex", flexDirection: "column" }}>
        {cards.map((card, i) => (
          <div
            key={card.badge}
            style={{
              background: "var(--bg-surface)",
              border: "1px solid var(--border)",
              borderRadius: "2px",
            }}
          >
            <CardContent {...card} reverse={i % 2 !== 0} />
          </div>
        ))}
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      style={{
        position: "relative",
        overflow: "hidden",
        height: "100vh",
      }}
    >
      {cards.map((card, i) => (
        <div
          key={card.badge}
          ref={(el) => {
            cardRefs.current[i] = el;
          }}
          style={{
            position: i === 0 ? "relative" : "absolute",
            inset: 0,
            background: "var(--bg-surface)",
            border: "1px solid var(--border)",
            borderRadius: "2px",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            willChange: i === 0 ? undefined : "transform, opacity",
          }}
        >
          <CardContent {...card} reverse={i % 2 !== 0} />
        </div>
      ))}
    </div>
  );
}
