import Link from "next/link";

// ── Mail SVG icon ──────────────────────────────────────────────────────────────

function MailIcon() {
  return (
    <svg
      width="48"
      height="48"
      viewBox="0 0 48 48"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
      aria-hidden="true"
    >
      <rect
        x="4"
        y="10"
        width="40"
        height="28"
        rx="2"
        stroke="#5a7247"
        strokeWidth="2"
        fill="none"
      />
      <path
        d="M4 14l20 14 20-14"
        stroke="#5a7247"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

export default function VerifyRequestPage() {
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
        <MailIcon />

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
          Vérifie ta boîte mail
        </h1>

        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "13px",
            color: "#7a6e5d",
            margin: "0 0 32px",
            lineHeight: 1.6,
            maxWidth: "280px",
          }}
        >
          Un lien de connexion vient d&apos;être envoyé à ton adresse email.
          Clique dessus pour accéder à ton compte.
        </p>

        <Link
          href="/auth/signin"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "12px",
            color: "#5a7247",
            textDecoration: "underline",
            letterSpacing: "0.02em",
          }}
        >
          Pas reçu ? Réessayer
        </Link>
      </div>
    </main>
  );
}
