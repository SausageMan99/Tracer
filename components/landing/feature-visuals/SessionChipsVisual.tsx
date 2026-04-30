"use client";

const CHIPS = [
  "Trail", "Découverte", "Endurance", "Forêt",
  "D+", "GPX", "Surface nature",
] as const;

const ACTIVE_INDICES = new Set([0, 2]);

export default function SessionChipsVisual() {
  return (
    <div style={{ padding: "24px", display: "flex", flexWrap: "wrap", gap: "8px", justifyContent: "center" }}>
      {CHIPS.map((chip, i) => {
        const isActive = ACTIVE_INDICES.has(i);
        return (
          <span
            key={chip}
            style={{
              fontFamily: "var(--font-syne), sans-serif",
              fontSize: "11px",
              padding: "6px 14px",
              borderRadius: "999px",
              border: "1px solid var(--border)",
              background: isActive ? "linear-gradient(135deg, var(--accent-lime), var(--accent-sage))" : "var(--bg-elevated)",
              color: isActive ? "var(--bg-deep)" : "var(--text-muted)",
              fontWeight: isActive ? 700 : 400,
            }}
          >
            {chip}
          </span>
        );
      })}
    </div>
  );
}
