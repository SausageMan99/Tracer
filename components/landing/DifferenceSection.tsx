"use client";

const CLASSIC_POINTS = [
  "Routes passantes",
  "D+ aléatoire",
  "Surfaces incohérentes",
  "Planification manuelle",
] as const;

const TRAILFORGE_POINTS = [
  "Chemins nature privilégiés",
  "D+ précis au mètre",
  "Surfaces adaptées à ton sport",
  "Génération en 10 secondes",
] as const;

export default function DifferenceSection() {
  return (
    <section
      style={{
        background: "#f2ece3",
        padding: "80px 20px",
        borderTop: "1px solid #d4c9b8",
      }}
    >
      <div style={{ maxWidth: "800px", margin: "0 auto" }}>
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
          La différence
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "2px",
          }}
        >
          {/* Classic column */}
          <div
            style={{
              background: "#e8e0d4",
              padding: "32px",
              border: "1px solid #d4c9b8",
            }}
          >
            <h3
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "12px",
                letterSpacing: "0.15em",
                color: "#a39683",
                textTransform: "uppercase",
                marginBottom: "24px",
              }}
            >
              Parcours classique
            </h3>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              {CLASSIC_POINTS.map((point) => (
                <li
                  key={point}
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "14px",
                    color: "#7a6e5d",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    lineHeight: 1.4,
                  }}
                >
                  <span
                    style={{
                      width: "16px",
                      height: "1px",
                      background: "#a39683",
                      flexShrink: 0,
                      display: "inline-block",
                    }}
                    aria-hidden="true"
                  />
                  {point}
                </li>
              ))}
            </ul>
          </div>

          {/* TrailForge column */}
          <div
            style={{
              background: "#3d3529",
              padding: "32px",
              border: "1px solid #3d3529",
            }}
          >
            <h3
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "12px",
                letterSpacing: "0.15em",
                color: "#8fa87e",
                textTransform: "uppercase",
                marginBottom: "24px",
              }}
            >
              Parcours TrailForge
            </h3>
            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: "16px",
              }}
            >
              {TRAILFORGE_POINTS.map((point) => (
                <li
                  key={point}
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "14px",
                    color: "#f2ece3",
                    display: "flex",
                    alignItems: "center",
                    gap: "12px",
                    lineHeight: 1.4,
                  }}
                >
                  <span
                    style={{
                      width: "16px",
                      height: "1px",
                      background: "#5a7247",
                      flexShrink: 0,
                      display: "inline-block",
                    }}
                    aria-hidden="true"
                  />
                  {point}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
