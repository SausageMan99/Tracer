"use client";

const PAIN_POINTS = [
  {
    num: "01",
    text: "Je passais des heures à planifier sur Komoot pour un résultat moyen.",
  },
  {
    num: "02",
    text: "Mes parcours finissaient toujours sur des routes passantes.",
  },
  {
    num: "03",
    text: "Le dénivelé ne correspondait jamais à ce que je voulais.",
  },
] as const;

export default function ProblemSection() {
  return (
    <section
      style={{
        background: "#f2ece3",
        padding: "80px 20px",
        borderTop: "1px solid #d4c9b8",
      }}
    >
      <div style={{ maxWidth: "680px", margin: "0 auto" }}>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "11px",
            letterSpacing: "0.2em",
            color: "#a39683",
            textTransform: "uppercase",
            marginBottom: "48px",
          }}
        >
          Le constat
        </p>

        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "40px",
          }}
        >
          {PAIN_POINTS.map(({ num, text }) => (
            <div
              key={num}
              style={{
                display: "flex",
                gap: "24px",
                alignItems: "flex-start",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "13px",
                  color: "#a39683",
                  flexShrink: 0,
                  paddingTop: "3px",
                  minWidth: "28px",
                }}
              >
                {num}
              </span>
              <p
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "clamp(16px, 2.5vw, 20px)",
                  color: "#3d3529",
                  lineHeight: 1.6,
                  margin: 0,
                }}
              >
                {text}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
