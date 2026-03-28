"use client";

import Link from "next/link";

interface ErrorPageProps {
  error: Error & { digest?: string };
  reset: () => void;
}

export default function ErrorPage({ error, reset }: ErrorPageProps) {
  return (
    <div
      style={{
        minHeight: "100vh",
        backgroundColor: "#f2ece3",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "2rem",
        fontFamily: '"JetBrains Mono", "Courier New", monospace',
      }}
    >
      <div
        style={{
          maxWidth: "480px",
          width: "100%",
          textAlign: "center",
        }}
      >
        {/* Logo */}
        <Link
          href="/"
          style={{
            display: "inline-block",
            marginBottom: "2.5rem",
            textDecoration: "none",
            fontFamily: '"Georgia", "Times New Roman", serif',
            fontSize: "1.25rem",
            fontWeight: "700",
            color: "#5a7247",
            letterSpacing: "0.02em",
          }}
        >
          TrailForge
        </Link>

        {/* Error icon */}
        <div
          style={{
            fontSize: "3rem",
            marginBottom: "1rem",
            color: "#a39683",
          }}
        >
          ⚠
        </div>

        {/* Heading */}
        <h1
          style={{
            fontFamily: '"Georgia", "Times New Roman", serif',
            fontSize: "1.75rem",
            fontWeight: "700",
            color: "#3d3529",
            marginBottom: "1rem",
            lineHeight: "1.3",
          }}
        >
          Quelque chose s&apos;est mal passé
        </h1>

        {/* Message */}
        <p
          style={{
            fontSize: "0.9rem",
            color: "#7a6e5d",
            marginBottom: "2rem",
            lineHeight: "1.6",
          }}
        >
          Une erreur inattendue est survenue. Réessaie ou retourne à l&apos;accueil.
        </p>

        {/* Error digest (debug info) */}
        {error.digest && (
          <p
            style={{
              fontSize: "0.75rem",
              color: "#a39683",
              marginBottom: "2rem",
              fontFamily: '"JetBrains Mono", "Courier New", monospace',
            }}
          >
            Réf: {error.digest}
          </p>
        )}

        {/* Buttons */}
        <div
          style={{
            display: "flex",
            gap: "0.75rem",
            justifyContent: "center",
            flexWrap: "wrap",
          }}
        >
          <button
            onClick={reset}
            style={{
              padding: "0.65rem 1.5rem",
              backgroundColor: "#5a7247",
              color: "#f2ece3",
              border: "none",
              borderRadius: "4px",
              fontSize: "0.85rem",
              fontFamily: '"JetBrains Mono", "Courier New", monospace',
              fontWeight: "500",
              cursor: "pointer",
              letterSpacing: "0.03em",
            }}
          >
            Réessayer
          </button>

          <Link
            href="/"
            style={{
              display: "inline-block",
              padding: "0.65rem 1.5rem",
              backgroundColor: "transparent",
              color: "#3d3529",
              border: "1.5px solid #d4c9b8",
              borderRadius: "4px",
              fontSize: "0.85rem",
              fontFamily: '"JetBrains Mono", "Courier New", monospace',
              fontWeight: "500",
              textDecoration: "none",
              letterSpacing: "0.03em",
            }}
          >
            Accueil
          </Link>
        </div>
      </div>
    </div>
  );
}
