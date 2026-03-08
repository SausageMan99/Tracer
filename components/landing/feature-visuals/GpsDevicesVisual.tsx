"use client";

const BRANDS = ["Garmin", "Wahoo", "Suunto"] as const;

export default function GpsDevicesVisual() {
  return (
    <div style={{ padding: "32px", display: "flex", gap: "24px", alignItems: "center", justifyContent: "center", flexWrap: "wrap" }}>
      {BRANDS.map((brand) => (
        <div
          key={brand}
          style={{
            padding: "16px 24px",
            border: "1px solid var(--border)",
            borderRadius: "2px",
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            gap: "8px",
            background: "var(--bg-elevated)",
          }}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" width="28" height="28" style={{ color: "var(--accent-sage)" }}>
            <rect x="4" y="3" width="16" height="18" rx="2" />
            <circle cx="12" cy="14" r="3" />
            <line x1="12" y1="3" x2="12" y2="7" />
          </svg>
          <span style={{ fontFamily: "var(--font-syne), sans-serif", fontSize: "11px", color: "var(--text-muted)" }}>
            {brand}
          </span>
        </div>
      ))}
    </div>
  );
}
