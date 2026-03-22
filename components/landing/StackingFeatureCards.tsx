"use client";

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
        boxSizing: "border-box",
      }}
    >
      <div className={reverse ? "md:order-2" : "md:order-1"}>
        <div
          style={{
            display: "inline-flex",
            alignItems: "center",
            gap: "6px",
            background: "var(--app-bg-elevated)",
            border: "1px solid var(--app-border)",
            padding: "4px 12px",
            borderRadius: "2px",
            marginBottom: "20px",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-ui), sans-serif",
              fontSize: "10px",
              letterSpacing: "0.2em",
              color: "var(--app-accent-sage)",
              textTransform: "uppercase",
            }}
          >
            {badge}
          </span>
        </div>
        <h3
          style={{
            fontFamily: "var(--font-heading), serif",
            fontSize: "clamp(24px, 3vw, 36px)",
            fontStyle: "italic",
            color: "var(--app-text-primary)",
            marginBottom: "16px",
            lineHeight: 1.3,
          }}
        >
          {title}
        </h3>
        <p
          style={{
            fontFamily: "var(--font-ui), sans-serif",
            fontSize: "15px",
            color: "var(--app-text-muted)",
            lineHeight: 1.7,
          }}
        >
          {desc}
        </p>
      </div>
      <div
        className={reverse ? "md:order-1" : "md:order-2"}
        style={{
          background: "var(--app-bg-surface)",
          border: "1px solid var(--app-border)",
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

/**
 * Feature cards layout — GSAP stacking scroll animation removed.
 * Renders as a simple stacked list. Will be replaced in Task 16 landing rewrite.
 */
export default function StackingFeatureCards({ cards }: StackingFeatureCardsProps) {
  return (
    <div style={{ display: "flex", flexDirection: "column" }}>
      {cards.map((card, i) => (
        <div
          key={card.badge}
          style={{
            background: "var(--app-bg-surface)",
            border: "1px solid var(--app-border)",
            borderBottom: i < cards.length - 1 ? "none" : "1px solid var(--app-border)",
            borderRadius: "2px",
          }}
        >
          <CardContent {...card} reverse={i % 2 !== 0} />
        </div>
      ))}
    </div>
  );
}
