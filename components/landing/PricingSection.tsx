"use client";

import Link from "next/link";

const FREE_FEATURES = [
  "Parcours illimités",
  "4 sports (trail, route, gravel, VTT)",
  "14 profils de session",
  "Carte interactive",
  "Export GPX",
] as const;

const PRO_FEATURES = [
  "Tout ce qui est gratuit",
  "Routes scéniques optimisées",
  "Multi-parcours simultanés",
  "Historique des parcours",
  "Support prioritaire",
] as const;

export default function PricingSection() {
  return (
    <section
      style={{
        background: "#e8e0d4",
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
          Tarifs
        </p>

        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fit, minmax(280px, 1fr))",
            gap: "2px",
          }}
        >
          {/* Free plan */}
          <div
            style={{
              background: "#f7f3ed",
              padding: "36px 32px",
              border: "1px solid #d4c9b8",
              display: "flex",
              flexDirection: "column",
              gap: "24px",
            }}
          >
            <div>
              <h3
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: "clamp(22px, 3vw, 30px)",
                  fontStyle: "italic",
                  color: "#3d3529",
                  margin: "0 0 8px 0",
                }}
              >
                Gratuit
              </h3>
              <p
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "12px",
                  color: "#a39683",
                  margin: 0,
                }}
              >
                pour toujours
              </p>
            </div>

            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                flex: 1,
              }}
            >
              {FREE_FEATURES.map((feature) => (
                <li
                  key={feature}
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "13px",
                    color: "#7a6e5d",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    lineHeight: 1.4,
                  }}
                >
                  <span
                    style={{
                      color: "#5a7247",
                      fontWeight: 700,
                      fontSize: "16px",
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                  {feature}
                </li>
              ))}
            </ul>

            <Link
              href="/app"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "13px",
                fontWeight: 700,
                letterSpacing: "0.05em",
                color: "#3d3529",
                textDecoration: "none",
                border: "1px solid #d4c9b8",
                padding: "14px 24px",
                display: "block",
                textAlign: "center",
                minHeight: "44px",
                lineHeight: 1,
              }}
            >
              Commencer gratuitement
            </Link>
          </div>

          {/* Pro plan */}
          <div
            style={{
              background: "#3d3529",
              padding: "36px 32px",
              border: "1px solid #3d3529",
              display: "flex",
              flexDirection: "column",
              gap: "24px",
            }}
          >
            <div>
              <h3
                style={{
                  fontFamily: "var(--font-heading)",
                  fontSize: "clamp(22px, 3vw, 30px)",
                  fontStyle: "italic",
                  color: "#f2ece3",
                  margin: "0 0 8px 0",
                }}
              >
                Pro
              </h3>
              <p
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "24px",
                  fontWeight: 700,
                  color: "#f2ece3",
                  margin: "0 0 4px 0",
                }}
              >
                8,99€
                <span
                  style={{
                    fontSize: "13px",
                    fontWeight: 400,
                    color: "#8fa87e",
                    marginLeft: "4px",
                  }}
                >
                  /mois
                </span>
              </p>
              <p
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "11px",
                  color: "#8fa87e",
                  margin: 0,
                }}
              >
                ou 79,99€/an (2 mois offerts)
              </p>
            </div>

            <ul
              style={{
                listStyle: "none",
                padding: 0,
                margin: 0,
                display: "flex",
                flexDirection: "column",
                gap: "12px",
                flex: 1,
              }}
            >
              {PRO_FEATURES.map((feature) => (
                <li
                  key={feature}
                  style={{
                    fontFamily: "var(--font-body)",
                    fontSize: "13px",
                    color: "#f2ece3",
                    display: "flex",
                    alignItems: "center",
                    gap: "10px",
                    lineHeight: 1.4,
                  }}
                >
                  <span
                    style={{
                      color: "#8fa87e",
                      fontWeight: 700,
                      fontSize: "16px",
                      lineHeight: 1,
                      flexShrink: 0,
                    }}
                    aria-hidden="true"
                  >
                    ✓
                  </span>
                  {feature}
                </li>
              ))}
            </ul>

            <button
              type="button"
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "13px",
                fontWeight: 700,
                letterSpacing: "0.05em",
                color: "#3d3529",
                background: "#f2ece3",
                border: "none",
                padding: "14px 24px",
                display: "block",
                width: "100%",
                textAlign: "center",
                minHeight: "44px",
                cursor: "pointer",
                lineHeight: 1,
              }}
            >
              Passer Pro
            </button>
          </div>
        </div>
      </div>
    </section>
  );
}
