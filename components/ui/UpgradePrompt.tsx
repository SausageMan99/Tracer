"use client";

import { useState } from "react";

interface UpgradePromptProps {
  onClose: () => void;
}

const PRO_BENEFITS: string[] = [
  "Parcours scéniques optimisés (5 configurations)",
  "Export GPX illimité",
  "Jusqu'à 6 variantes de parcours",
  "Historique complet de vos routes",
];

export function UpgradePrompt({ onClose }: UpgradePromptProps) {
  const [loading, setLoading] = useState(false);

  async function handleCheckout(plan: "monthly" | "annual") {
    setLoading(true);
    try {
      const res = await fetch("/api/payments/checkout", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ plan }),
      });
      const data = await res.json();
      if (res.status === 401) {
        window.location.href = "/auth/signin?callbackUrl=%2Fapp%3Fupgrade%3Dpro";
        return;
      }
      if (data.url) {
        window.location.href = data.url;
      }
    } catch {
      // User can retry
    } finally {
      setLoading(false);
    }
  }

  return (
    /* Backdrop */
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby="upgrade-title"
      onClick={onClose}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "rgba(10, 13, 12, 0.85)",
        backdropFilter: "blur(4px)",
        padding: "16px",
      }}
    >
      {/* Modal panel */}
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          background: "var(--bg-surface, #111614)",
          border: "1px solid var(--border, rgba(255,255,255,0.08))",
          borderRadius: "4px",
          padding: "32px 28px",
          maxWidth: "380px",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        {/* Header */}
        <div>
          <p
            style={{
              fontFamily: "var(--font-syne), sans-serif",
              fontSize: "10px",
              fontWeight: 600,
              letterSpacing: "0.2em",
              textTransform: "uppercase",
              color: "var(--accent-lime, #7CB342)",
              marginBottom: "8px",
            }}
          >
            Fonctionnalité Pro
          </p>
          <h2
            id="upgrade-title"
            style={{
              fontFamily: "var(--font-syne), sans-serif",
              fontSize: "20px",
              fontWeight: 700,
              color: "var(--text-primary, #e8ede9)",
              margin: 0,
            }}
          >
            Passe à Pro
          </h2>
        </div>

        {/* Benefits list */}
        <ul
          style={{
            margin: 0,
            padding: 0,
            listStyle: "none",
            display: "flex",
            flexDirection: "column",
            gap: "10px",
          }}
        >
          {PRO_BENEFITS.map((benefit) => (
            <li
              key={benefit}
              style={{
                display: "flex",
                alignItems: "flex-start",
                gap: "10px",
                fontFamily: "var(--font-inter), sans-serif",
                fontSize: "13px",
                color: "var(--text-secondary, #9ca3af)",
                lineHeight: 1.5,
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  flexShrink: 0,
                  marginTop: "3px",
                  width: "14px",
                  height: "14px",
                  borderRadius: "50%",
                  background: "var(--accent-lime, #7CB342)",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                }}
              >
                <svg
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="var(--bg-deep, #0A0D0C)"
                  strokeWidth="2"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  width="8"
                  height="8"
                >
                  <polyline points="2 6 5 9 10 3" />
                </svg>
              </span>
              {benefit}
            </li>
          ))}
        </ul>

        {/* Pricing */}
        <div
          style={{
            padding: "14px 16px",
            background: "var(--bg-elevated, #1a1f1e)",
            border: "1px solid var(--border, rgba(255,255,255,0.08))",
            borderRadius: "2px",
          }}
        >
          <span
            style={{
              fontFamily: "var(--font-jetbrains), monospace",
              fontSize: "18px",
              fontWeight: 600,
              color: "var(--text-primary, #e8ede9)",
            }}
          >
            8,99€
          </span>
          <span
            style={{
              fontFamily: "var(--font-inter), sans-serif",
              fontSize: "12px",
              color: "var(--text-muted, #6b7280)",
              marginLeft: "4px",
            }}
          >
            /mois
          </span>
          <span
            style={{
              fontFamily: "var(--font-inter), sans-serif",
              fontSize: "12px",
              color: "var(--text-muted, #6b7280)",
              marginLeft: "12px",
            }}
          >
            ou{" "}
            <span style={{ color: "var(--accent-lime, #7CB342)", fontWeight: 600 }}>
              79,99€/an
            </span>
          </span>
        </div>

        {/* Actions */}
        <div style={{ display: "flex", flexDirection: "column", gap: "8px" }}>
          <button
            onClick={() => handleCheckout("monthly")}
            disabled={loading}
            style={{
              width: "100%",
              height: "48px",
              background: "var(--accent-lime, #7CB342)",
              color: "var(--bg-deep, #0A0D0C)",
              border: "none",
              borderRadius: "2px",
              fontFamily: "var(--font-syne), sans-serif",
              fontSize: "12px",
              fontWeight: 700,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              cursor: "pointer",
              transition: "box-shadow 0.2s ease",
              opacity: loading ? 0.6 : 1,
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.boxShadow =
                "0 0 20px rgba(124,179,66,0.35)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.boxShadow = "";
            }}
          >
            {loading ? "Redirection..." : "Passer Pro"}
          </button>

          <button
            onClick={onClose}
            style={{
              width: "100%",
              height: "40px",
              background: "transparent",
              color: "var(--text-muted, #6b7280)",
              border: "1px solid var(--border, rgba(255,255,255,0.08))",
              borderRadius: "2px",
              fontFamily: "var(--font-syne), sans-serif",
              fontSize: "11px",
              fontWeight: 600,
              letterSpacing: "0.15em",
              textTransform: "uppercase",
              cursor: "pointer",
              transition: "all 0.2s ease",
            }}
            onMouseEnter={(e) => {
              (e.currentTarget as HTMLElement).style.color =
                "var(--text-primary, #e8ede9)";
              (e.currentTarget as HTMLElement).style.borderColor =
                "var(--text-muted, #6b7280)";
            }}
            onMouseLeave={(e) => {
              (e.currentTarget as HTMLElement).style.color =
                "var(--text-muted, #6b7280)";
              (e.currentTarget as HTMLElement).style.borderColor =
                "var(--border, rgba(255,255,255,0.08))";
            }}
          >
            Continuer gratuitement
          </button>
        </div>
      </div>
    </div>
  );
}
