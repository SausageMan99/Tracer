"use client";

import { Suspense } from "react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// ── Error code → French message map ───────────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  Configuration: "Erreur de configuration du serveur. Contacte le support.",
  AccessDenied: "Accès refusé.",
  Verification: "Le lien de connexion a expiré ou a déjà été utilisé.",
  OAuthSignin: "Impossible d'initier la connexion. Réessaie.",
  OAuthCallback: "Erreur lors du retour d'authentification. Réessaie.",
  OAuthAccountNotLinked:
    "Ce compte est déjà associé à une autre méthode de connexion.",
  EmailSignin: "Impossible d'envoyer l'email de connexion.",
  SessionRequired: "Tu dois être connecté pour accéder à cette page.",
  Default: "Une erreur est survenue lors de la connexion.",
};

function getErrorMessage(code: string | null): string {
  if (!code) return ERROR_MESSAGES["Default"];
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES["Default"];
}

// ── Warning icon ───────────────────────────────────────────────────────────────

function WarningIcon() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <path
        d="M24 6L44 40H4L24 6Z"
        stroke="#c17a3a"
        strokeWidth="2"
        strokeLinejoin="round"
        fill="none"
      />
      <line
        x1="24"
        y1="20"
        x2="24"
        y2="30"
        stroke="#c17a3a"
        strokeWidth="2"
        strokeLinecap="round"
      />
      <circle cx="24" cy="35" r="1.5" fill="#c17a3a" />
    </svg>
  );
}

// ── Error content (inner — uses useSearchParams) ───────────────────────────────

function ErrorContent() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error");
  const message = getErrorMessage(errorCode);

  return (
    <main
      style={{
        minHeight: "100vh",
        background: "var(--bg-parchment)",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        padding: "24px 20px",
        fontFamily: "var(--font-body)",
        color: "#3d3529",
      }}
    >
      {/* Logo / brand */}
      <Link
        href="/"
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "13px",
          fontWeight: 700,
          letterSpacing: "0.15em",
          color: "#3d3529",
          textDecoration: "none",
          marginBottom: "40px",
          opacity: 0.85,
        }}
      >
        trailforge
      </Link>

      {/* Card */}
      <div
        style={{
          width: "100%",
          maxWidth: "400px",
          background: "#f7f3ed",
          border: "1px solid #d4c9b8",
          padding: "48px 32px",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
        }}
      >
        <WarningIcon />

        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "22px",
            fontWeight: 400,
            color: "#3d3529",
            margin: "24px 0 12px",
            letterSpacing: "-0.01em",
          }}
        >
          Erreur de connexion
        </h1>

        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "13px",
            color: "#7a6e5d",
            margin: "0 0 32px",
            lineHeight: 1.6,
            maxWidth: "300px",
          }}
        >
          {message}
        </p>

        {/* Actions */}
        <Link
          href="/auth/signin"
          style={{
            display: "inline-block",
            minHeight: "44px",
            padding: "12px 28px",
            fontFamily: "var(--font-body)",
            fontSize: "13px",
            fontWeight: 600,
            letterSpacing: "0.05em",
            color: "#f2ece3",
            background: "#5a7247",
            border: "none",
            textDecoration: "none",
            marginBottom: "16px",
            lineHeight: "20px",
          }}
        >
          Réessayer
        </Link>

        <Link
          href="/"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "12px",
            color: "#7a6e5d",
            textDecoration: "underline",
            letterSpacing: "0.02em",
          }}
        >
          Retour à l&apos;accueil
        </Link>
      </div>
    </main>
  );
}

// ── Page (wrapped in Suspense for useSearchParams) ─────────────────────────────

export default function AuthErrorPage() {
  return (
    <Suspense>
      <ErrorContent />
    </Suspense>
  );
}
