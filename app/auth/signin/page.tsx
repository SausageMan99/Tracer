"use client";

import { Suspense, useState } from "react";
import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import Link from "next/link";

// ── Error message map ──────────────────────────────────────────────────────────

const ERROR_MESSAGES: Record<string, string> = {
  OAuthSignin: "Impossible d'initier la connexion. Réessaie.",
  OAuthCallback: "Erreur lors du retour d'authentification. Réessaie.",
  OAuthAccountNotLinked:
    "Ce compte est déjà associé à une autre méthode de connexion.",
  EmailSignin: "Impossible d'envoyer l'email de connexion.",
  Configuration: "Erreur de configuration du serveur. Contacte le support.",
  AccessDenied: "Accès refusé.",
  Verification:
    "Le lien de connexion a expiré ou a déjà été utilisé.",
  Default: "Une erreur est survenue lors de la connexion.",
};

function getErrorMessage(code: string | null): string | null {
  if (!code) return null;
  return ERROR_MESSAGES[code] ?? ERROR_MESSAGES["Default"];
}

// ── Google SVG icon ────────────────────────────────────────────────────────────

function GoogleIcon() {
  return (
    <svg
      width="18"
      height="18"
      viewBox="0 0 18 18"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
      style={{ flexShrink: 0 }}
    >
      <path
        d="M17.64 9.205c0-.639-.057-1.252-.164-1.841H9v3.481h4.844a4.14 4.14 0 0 1-1.796 2.716v2.259h2.908c1.702-1.567 2.684-3.875 2.684-6.615Z"
        fill="#4285F4"
      />
      <path
        d="M9 18c2.43 0 4.467-.806 5.956-2.18l-2.908-2.259c-.806.54-1.837.86-3.048.86-2.344 0-4.328-1.584-5.036-3.711H.957v2.332A8.997 8.997 0 0 0 9 18Z"
        fill="#34A853"
      />
      <path
        d="M3.964 10.71A5.41 5.41 0 0 1 3.682 9c0-.593.102-1.17.282-1.71V4.958H.957A8.996 8.996 0 0 0 0 9c0 1.452.348 2.827.957 4.042l3.007-2.332Z"
        fill="#FBBC05"
      />
      <path
        d="M9 3.58c1.321 0 2.508.454 3.44 1.345l2.582-2.58C13.463.891 11.426 0 9 0A8.997 8.997 0 0 0 .957 4.958L3.964 7.29C4.672 5.163 6.656 3.58 9 3.58Z"
        fill="#EA4335"
      />
    </svg>
  );
}

// ── Sign-in form (inner — uses useSearchParams) ────────────────────────────────

function SignInForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/app";
  const errorCode = searchParams.get("error");
  const errorMessage = getErrorMessage(errorCode);

  const [email, setEmail] = useState("");
  const [emailSent, setEmailSent] = useState(false);
  const [loading, setLoading] = useState(false);
  const [googleLoading, setGoogleLoading] = useState(false);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setLoading(true);
    try {
      await signIn("nodemailer", { email: email.trim(), callbackUrl });
      setEmailSent(true);
    } finally {
      setLoading(false);
    }
  }

  async function handleGoogleSignIn() {
    setGoogleLoading(true);
    try {
      await signIn("google", { callbackUrl });
    } finally {
      setGoogleLoading(false);
    }
  }

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
          padding: "40px 32px",
        }}
      >
        {/* Heading */}
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "24px",
            fontWeight: 400,
            color: "#3d3529",
            margin: "0 0 8px",
            letterSpacing: "-0.01em",
          }}
        >
          Connexion
        </h1>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "13px",
            color: "#7a6e5d",
            margin: "0 0 32px",
            lineHeight: 1.5,
          }}
        >
          Accède à tes parcours TrailForge.
        </p>

        {/* Error banner */}
        {errorMessage && (
          <div
            role="alert"
            style={{
              background: "#fdf0ec",
              border: "1px solid #e8b4a0",
              padding: "12px 16px",
              marginBottom: "24px",
              fontFamily: "var(--font-body)",
              fontSize: "12px",
              color: "#8b3a2a",
              lineHeight: 1.5,
            }}
          >
            {errorMessage}
          </div>
        )}

        {emailSent ? (
          /* Confirmation state */
          <div
            style={{
              textAlign: "center",
              padding: "16px 0",
            }}
          >
            <div
              style={{
                fontSize: "32px",
                marginBottom: "12px",
                lineHeight: 1,
              }}
            >
              ✉
            </div>
            <p
              style={{
                fontFamily: "var(--font-heading)",
                fontSize: "18px",
                color: "#3d3529",
                margin: "0 0 8px",
              }}
            >
              Lien envoyé !
            </p>
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "12px",
                color: "#7a6e5d",
                margin: "0",
                lineHeight: 1.6,
              }}
            >
              Vérifie ta boîte mail et clique sur le lien pour te connecter.
            </p>
          </div>
        ) : (
          <>
            {/* Email form */}
            <form onSubmit={handleEmailSubmit} noValidate>
              <label
                htmlFor="email"
                style={{
                  display: "block",
                  fontFamily: "var(--font-body)",
                  fontSize: "11px",
                  fontWeight: 600,
                  letterSpacing: "0.1em",
                  color: "#7a6e5d",
                  marginBottom: "8px",
                  textTransform: "uppercase",
                }}
              >
                Adresse email
              </label>
              <input
                id="email"
                type="email"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder="tu@exemple.com"
                required
                autoComplete="email"
                style={{
                  display: "block",
                  width: "100%",
                  minHeight: "44px",
                  padding: "10px 12px",
                  fontFamily: "var(--font-body)",
                  fontSize: "13px",
                  color: "#3d3529",
                  background: "#f2ece3",
                  border: "1px solid #d4c9b8",
                  outline: "none",
                  boxSizing: "border-box",
                }}
              />
              <button
                type="submit"
                disabled={loading || !email.trim()}
                style={{
                  display: "block",
                  width: "100%",
                  minHeight: "44px",
                  marginTop: "12px",
                  padding: "12px",
                  fontFamily: "var(--font-body)",
                  fontSize: "13px",
                  fontWeight: 600,
                  letterSpacing: "0.05em",
                  color: "#f2ece3",
                  background: loading ? "#7a9163" : "#5a7247",
                  border: "none",
                  cursor: loading ? "not-allowed" : "pointer",
                  transition: "background 0.15s",
                }}
              >
                {loading ? "Envoi…" : "Recevoir un lien de connexion"}
              </button>
            </form>

            {/* Divider */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "12px",
                margin: "24px 0",
              }}
            >
              <div
                style={{ flex: 1, height: "1px", background: "#d4c9b8" }}
              />
              <span
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "11px",
                  color: "#a39683",
                  letterSpacing: "0.05em",
                }}
              >
                ou
              </span>
              <div
                style={{ flex: 1, height: "1px", background: "#d4c9b8" }}
              />
            </div>

            {/* Google button */}
            <button
              type="button"
              onClick={handleGoogleSignIn}
              disabled={googleLoading}
              style={{
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                width: "100%",
                minHeight: "44px",
                padding: "11px 16px",
                fontFamily: "var(--font-body)",
                fontSize: "13px",
                fontWeight: 600,
                letterSpacing: "0.03em",
                color: "#3d3529",
                background: "#f2ece3",
                border: "1px solid #d4c9b8",
                cursor: googleLoading ? "not-allowed" : "pointer",
                transition: "border-color 0.15s",
              }}
            >
              <GoogleIcon />
              {googleLoading ? "Redirection…" : "Continuer avec Google"}
            </button>
          </>
        )}
      </div>

      {/* Footer note */}
      <p
        style={{
          fontFamily: "var(--font-body)",
          fontSize: "11px",
          color: "#a39683",
          marginTop: "24px",
          textAlign: "center",
          lineHeight: 1.6,
          maxWidth: "320px",
        }}
      >
        En continuant, tu acceptes nos{" "}
        <Link
          href="/legal/terms"
          style={{ color: "#7a6e5d", textDecoration: "underline" }}
        >
          conditions d&apos;utilisation
        </Link>{" "}
        et notre{" "}
        <Link
          href="/legal/privacy"
          style={{ color: "#7a6e5d", textDecoration: "underline" }}
        >
          politique de confidentialité
        </Link>
        .
      </p>
    </main>
  );
}

// ── Page (wrapped in Suspense for useSearchParams) ─────────────────────────────

export default function SignInPage() {
  return (
    <Suspense>
      <SignInForm />
    </Suspense>
  );
}
