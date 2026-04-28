"use client";

const STEPS = [
  {
    num: "01",
    title: "Décris ta session",
    desc: "Sport, profil, distance, D+. En quelques secondes, TrailForge sait ce qu'il te faut.",
  },
  {
    num: "02",
    title: "L'algorithme forge ton parcours",
    desc: "Graphe OSM, beam-search, analyse des surfaces. Le meilleur parcours est sélectionné automatiquement.",
  },
  {
    num: "03",
    title: "Exporte en GPX et pars courir",
    desc: "Export direct vers ta montre. Garmin, Wahoo, Suunto — prêt à partir en 10 secondes.",
  },
] as const;

export default function HowItWorksSection() {
  return (
    <section
      style={{
        background: "#e8e0d4",
        padding: "80px 20px",
        borderTop: "1px solid #d4c9b8",
      }}
    >
      <div style={{ maxWidth: "960px", margin: "0 auto" }}>
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
          Comment ça marche
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(240px, 1fr))",
            gap: "40px",
          }}
        >
          {STEPS.map(({ num, title, desc }) => (
            <div
              key={num}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              <span
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "clamp(32px, 4vw, 48px)",
                  fontWeight: 500,
                  color: "#5a7247",
                  lineHeight: 1,
                  display: "block",
                }}
              >
                {num}
              </span>
              <h3
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: "clamp(18px, 2.2vw, 24px)",
                  fontStyle: "italic",
                  color: "#3d3529",
                  margin: 0,
                  lineHeight: 1.2,
                }}
              >
                {title}
              </h3>
              <p
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "13px",
                  color: "#7a6e5d",
                  lineHeight: 1.7,
                  margin: 0,
                }}
              >
                {desc}
              </p>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
