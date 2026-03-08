"use client";

const CHIPS = [
  "Fractionné", "Seuil", "Trail", "Endurance",
  "Gran Fondo", "Gravel", "MTB", "Récup",
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
              borderRadius: "2px",
              border: "1px solid var(--border)",
              background: isActive ? "var(--accent-lime)" : "var(--bg-elevated)",
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
