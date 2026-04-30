"use client";

import { useWaitlistForm } from "@/hooks/useWaitlistForm";

type Source = "landing" | "post-generation";

interface WaitlistFormProps {
  readonly source: Source;
  /** Compact mode for inline usage (e.g., post-generation widget). */
  readonly compact?: boolean;
}

export default function WaitlistForm({ source, compact = false }: WaitlistFormProps) {
  const { email, status, message, setEmail, submit } = useWaitlistForm(source);

  if (status === "success") {
    return (
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: "8px",
          padding: compact ? "12px 0" : "20px 0",
        }}
      >
        <svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="var(--accent-lime)" strokeWidth="2" aria-hidden="true">
          <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
        </svg>
        <span
          style={{
            fontFamily: "var(--font-syne), sans-serif",
            fontSize: "14px",
            color: "var(--accent-lime)",
            fontWeight: 600,
          }}
        >
          {message}
        </span>
      </div>
    );
  }

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    submit();
  };

  if (compact) {
    return (
      <form onSubmit={handleSubmit} style={{ display: "flex", gap: "8px", alignItems: "stretch" }}>
        <input
          type="email"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          placeholder="ton@email.com"
          required
          style={{
            flex: 1,
            padding: "10px 14px",
            background: "var(--bg-elevated)",
            border: "1px solid var(--border)",
            borderRadius: "var(--radius-control)",
            fontFamily: "var(--font-jetbrains), monospace",
            fontSize: "13px",
            color: "var(--text-primary)",
            outline: "none",
            transition: "border-color 0.2s",
          }}
          onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-moss)"; }}
          onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}
        />
        <button
          type="submit"
          disabled={status === "submitting"}
          style={{
            padding: "10px 20px",
            background: "linear-gradient(135deg, var(--accent-lime), var(--accent-sage))",
            color: "var(--bg-deep)",
            border: "none",
            borderRadius: "var(--radius-control)",
            fontFamily: "var(--font-syne), sans-serif",
            fontSize: "11px",
            fontWeight: 700,
            letterSpacing: "0.1em",
            textTransform: "uppercase",
            cursor: status === "submitting" ? "wait" : "pointer",
            opacity: status === "submitting" ? 0.7 : 1,
            whiteSpace: "nowrap",
            transition: "opacity 0.2s",
          }}
        >
          {status === "submitting" ? "..." : "Rejoindre"}
        </button>
        {status === "error" && (
          <span style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "12px", color: "#f87171", alignSelf: "center" }}>
            {message}
          </span>
        )}
      </form>
    );
  }

  return (
    <form onSubmit={handleSubmit} style={{ display: "flex", flexDirection: "column", gap: "16px", maxWidth: "480px" }}>
      {/* Email input */}
      <input
        type="email"
        value={email}
        onChange={(e) => setEmail(e.target.value)}
        placeholder="ton@email.com"
        required
        aria-label="Adresse email"
        style={{
          padding: "16px 20px",
          background: "var(--bg-elevated)",
          border: "1px solid var(--border)",
          borderRadius: "var(--radius-control)",
          fontFamily: "var(--font-jetbrains), monospace",
          fontSize: "15px",
          color: "var(--text-primary)",
          outline: "none",
          transition: "border-color 0.3s var(--ease-out-expo)",
        }}
        onFocus={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--accent-moss)"; }}
        onBlur={(e) => { (e.currentTarget as HTMLElement).style.borderColor = "var(--border)"; }}
      />

      <div style={{ display: "flex", gap: "8px", flexWrap: "wrap" }}>
        <span
          style={{
            padding: "8px 16px",
            borderRadius: "999px",
            border: "1px solid var(--accent-lime)",
            background: "rgba(196,216,107,0.1)",
            color: "var(--accent-lime)",
            fontFamily: "var(--font-syne), sans-serif",
            fontSize: "12px",
            fontWeight: 700,
            letterSpacing: "0.05em",
          }}
        >
          Trail running uniquement
        </span>
      </div>

      {/* Submit */}
      <button
        type="submit"
        disabled={status === "submitting"}
        style={{
          padding: "18px 36px",
          background: "linear-gradient(135deg, var(--accent-lime), var(--accent-sage))",
          color: "var(--bg-deep)",
          border: "none",
          borderRadius: "var(--radius-control)",
          fontFamily: "var(--font-syne), sans-serif",
          fontSize: "13px",
          fontWeight: 700,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          cursor: status === "submitting" ? "wait" : "pointer",
          opacity: status === "submitting" ? 0.7 : 1,
          transition: "all 0.3s var(--ease-out-expo)",
        }}
      >
        {status === "submitting" ? "Inscription..." : "Rejoindre la forge"}
      </button>

      {/* Error message */}
      {status === "error" && (
        <p style={{ fontFamily: "var(--font-inter), sans-serif", fontSize: "13px", color: "#f87171" }}>
          {message}
        </p>
      )}

      {/* Privacy note */}
      <p
        style={{
          fontFamily: "var(--font-inter), sans-serif",
          fontSize: "12px",
          color: "var(--text-muted)",
          opacity: 0.7,
        }}
      >
        Pas de spam. Désinscription en un clic.
      </p>
    </form>
  );
}
