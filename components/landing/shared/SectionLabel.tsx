"use client";

interface SectionLabelProps {
  readonly children: React.ReactNode;
}

export default function SectionLabel({ children }: SectionLabelProps) {
  return (
    <span
      style={{
        fontFamily: "var(--font-syne), sans-serif",
        fontSize: "11px",
        letterSpacing: "0.4em",
        color: "var(--text-muted)",
        textTransform: "uppercase",
      }}
    >
      {children}
    </span>
  );
}
