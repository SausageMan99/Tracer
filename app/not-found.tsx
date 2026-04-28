import Link from "next/link";

export default function NotFoundPage() {
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

        {/* 404 number */}
        <div
          style={{
            fontFamily: '"Georgia", "Times New Roman", serif',
            fontSize: "6rem",
            fontWeight: "700",
            color: "#a39683",
            lineHeight: "1",
            marginBottom: "1rem",
            letterSpacing: "-0.02em",
          }}
        >
          404
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
          Page introuvable
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
          Ce sentier ne mène nulle part. Retourne à l&apos;accueil.
        </p>

        {/* CTA button */}
        <Link
          href="/"
          style={{
            display: "inline-block",
            padding: "0.65rem 1.75rem",
            backgroundColor: "#5a7247",
            color: "#f2ece3",
            borderRadius: "4px",
            fontSize: "0.85rem",
            fontFamily: '"JetBrains Mono", "Courier New", monospace',
            fontWeight: "500",
            textDecoration: "none",
            letterSpacing: "0.03em",
          }}
        >
          Retour à l&apos;accueil
        </Link>
      </div>
    </div>
  );
}
