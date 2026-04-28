# TrailForge Production Readiness — Implementation Plan

> **For agentic workers:** REQUIRED: Use superpowers:subagent-driven-development (if subagents available) or superpowers:executing-plans to implement this plan. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Complete all missing production pieces so TrailForge can launch publicly: auth UI pages, Stripe checkout wiring, route history UI, legal pages, error pages, OG/social meta, database migration script, and env var completeness.

**Architecture:** All changes are additive — new pages and components that wire into existing backend (NextAuth, Stripe, Vercel Postgres). No engine or core logic changes. Auth pages use NextAuth's `signIn()` client helper. Stripe checkout is triggered by redirecting to `/api/payments/checkout`. Route history is a sidebar panel fetching from existing `/api/routes/history`.

**Tech Stack:** Next.js 15 (App Router), React 19, TypeScript, NextAuth v5, Stripe, Vercel Postgres

**Spec:** `docs/superpowers/specs/2026-03-20-freemium-relaunch-design.md`

**Parallelization opportunities:**
- Tasks 1 + 2 + 3 are independent (auth pages, each is its own route)
- Tasks 4 + 5 are independent (PricingSection fix + UpgradePrompt fix)
- Tasks 6 + 7 + 8 are independent (legal pages, error pages, OG meta)
- Task 9 (env vars) is independent of everything

---

## Task 1: Auth sign-in page

**Files:**
- Create: `app/auth/signin/page.tsx`

NextAuth is configured with `pages: { signIn: "/auth/signin" }` in `lib/auth.ts:70`. This page needs to exist or NextAuth redirects fail.

- [ ] **Step 1: Create the sign-in page**

```typescript
// app/auth/signin/page.tsx
"use client";

import { signIn } from "next-auth/react";
import { useState } from "react";
import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

function SignInForm() {
  const searchParams = useSearchParams();
  const callbackUrl = searchParams.get("callbackUrl") ?? "/app";
  const error = searchParams.get("error");
  const [email, setEmail] = useState("");
  const [sending, setSending] = useState(false);
  const [sent, setSent] = useState(false);

  async function handleEmailSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!email.trim()) return;
    setSending(true);
    await signIn("nodemailer", { email, callbackUrl });
    setSent(true);
    setSending(false);
  }

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-parchment, #f2ece3)",
        padding: "20px",
      }}
    >
      <div
        style={{
          maxWidth: "380px",
          width: "100%",
          display: "flex",
          flexDirection: "column",
          gap: "24px",
        }}
      >
        {/* Header */}
        <div>
          <a
            href="/"
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "18px",
              fontStyle: "italic",
              color: "var(--text-primary, #3d3529)",
              textDecoration: "none",
            }}
          >
            TrailForge
          </a>
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "clamp(24px, 4vw, 32px)",
              fontStyle: "italic",
              color: "var(--text-primary, #3d3529)",
              margin: "16px 0 8px",
            }}
          >
            Connexion
          </h1>
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "13px",
              color: "var(--text-muted, #7a6e5d)",
              margin: 0,
              lineHeight: 1.5,
            }}
          >
            Connecte-toi pour accéder aux fonctionnalités Pro.
          </p>
        </div>

        {/* Error message */}
        {error && (
          <div
            role="alert"
            style={{
              padding: "12px 16px",
              background: "rgba(239,68,68,0.08)",
              border: "1px solid rgba(239,68,68,0.25)",
              borderRadius: "2px",
              fontFamily: "var(--font-body)",
              fontSize: "12px",
              color: "#dc2626",
              lineHeight: 1.5,
            }}
          >
            {error === "OAuthAccountNotLinked"
              ? "Ce compte est déjà associé à une autre méthode de connexion."
              : "Une erreur est survenue. Réessaie."}
          </div>
        )}

        {/* Sent confirmation */}
        {sent ? (
          <div
            style={{
              padding: "20px",
              background: "var(--bg-surface, #f7f3ed)",
              border: "1px solid var(--border, #d4c9b8)",
              borderRadius: "2px",
              textAlign: "center",
            }}
          >
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "14px",
                color: "var(--accent-forest, #5a7247)",
                fontWeight: 500,
                margin: "0 0 8px",
              }}
            >
              Lien envoyé !
            </p>
            <p
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "12px",
                color: "var(--text-muted, #7a6e5d)",
                margin: 0,
                lineHeight: 1.5,
              }}
            >
              Vérifie ta boîte mail et clique sur le lien pour te connecter.
            </p>
          </div>
        ) : (
          <>
            {/* Magic link form */}
            <form
              onSubmit={handleEmailSubmit}
              style={{ display: "flex", flexDirection: "column", gap: "12px" }}
            >
              <label
                htmlFor="email"
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "11px",
                  letterSpacing: "0.15em",
                  textTransform: "uppercase",
                  color: "var(--text-muted, #7a6e5d)",
                }}
              >
                Email
              </label>
              <input
                id="email"
                type="email"
                required
                placeholder="ton@email.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "14px",
                  padding: "12px 16px",
                  border: "1px solid var(--border, #d4c9b8)",
                  borderRadius: "2px",
                  background: "var(--bg-surface, #f7f3ed)",
                  color: "var(--text-primary, #3d3529)",
                  outline: "none",
                  minHeight: "44px",
                }}
              />
              <button
                type="submit"
                disabled={sending}
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "13px",
                  fontWeight: 700,
                  letterSpacing: "0.05em",
                  color: "#f2ece3",
                  background: "var(--accent-forest, #5a7247)",
                  border: "none",
                  padding: "14px 24px",
                  minHeight: "44px",
                  cursor: sending ? "not-allowed" : "pointer",
                  opacity: sending ? 0.6 : 1,
                  borderRadius: "2px",
                }}
              >
                {sending ? "Envoi en cours..." : "Recevoir un lien de connexion"}
              </button>
            </form>

            {/* Divider */}
            <div
              style={{
                display: "flex",
                alignItems: "center",
                gap: "16px",
              }}
            >
              <div style={{ flex: 1, height: "1px", background: "var(--border, #d4c9b8)" }} />
              <span
                style={{
                  fontFamily: "var(--font-body)",
                  fontSize: "11px",
                  color: "var(--text-light, #a39683)",
                }}
              >
                ou
              </span>
              <div style={{ flex: 1, height: "1px", background: "var(--border, #d4c9b8)" }} />
            </div>

            {/* Google OAuth */}
            <button
              type="button"
              onClick={() => signIn("google", { callbackUrl })}
              style={{
                fontFamily: "var(--font-body)",
                fontSize: "13px",
                fontWeight: 500,
                color: "var(--text-primary, #3d3529)",
                background: "var(--bg-surface, #f7f3ed)",
                border: "1px solid var(--border, #d4c9b8)",
                padding: "12px 24px",
                minHeight: "44px",
                cursor: "pointer",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                gap: "10px",
                borderRadius: "2px",
              }}
            >
              <svg width="18" height="18" viewBox="0 0 24 24" aria-hidden="true">
                <path
                  fill="#4285F4"
                  d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                />
                <path
                  fill="#34A853"
                  d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                />
                <path
                  fill="#FBBC05"
                  d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                />
                <path
                  fill="#EA4335"
                  d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                />
              </svg>
              Continuer avec Google
            </button>
          </>
        )}

        {/* Back link */}
        <a
          href="/"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "12px",
            color: "var(--text-light, #a39683)",
            textAlign: "center",
            textDecoration: "none",
          }}
        >
          Retour à l&apos;accueil
        </a>
      </div>
    </div>
  );
}

export default function SignInPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100dvh", background: "var(--bg-parchment, #f2ece3)" }} />
      }
    >
      <SignInForm />
    </Suspense>
  );
}
```

- [ ] **Step 2: Verify build**

Run: `npx next build`
Expected: Build succeeds, `/auth/signin` appears in route list

- [ ] **Step 3: Commit**

```bash
git add app/auth/signin/page.tsx
git commit -m "feat: add sign-in page with magic link and Google OAuth"
```

---

## Task 2: Auth verify-request page

**Files:**
- Create: `app/auth/verify-request/page.tsx`

NextAuth redirects here after sending a magic link email (`lib/auth.ts:71`).

- [ ] **Step 1: Create the verify-request page**

```typescript
// app/auth/verify-request/page.tsx
export default function VerifyRequestPage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-parchment, #f2ece3)",
        padding: "20px",
      }}
    >
      <div
        style={{
          maxWidth: "380px",
          width: "100%",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        <a
          href="/"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "18px",
            fontStyle: "italic",
            color: "var(--text-primary, #3d3529)",
            textDecoration: "none",
          }}
        >
          TrailForge
        </a>

        <div
          style={{
            padding: "32px 24px",
            background: "var(--bg-surface, #f7f3ed)",
            border: "1px solid var(--border, #d4c9b8)",
            borderRadius: "2px",
          }}
        >
          {/* Mail icon */}
          <div
            style={{
              width: "48px",
              height: "48px",
              margin: "0 auto 16px",
              background: "var(--accent-forest, #5a7247)",
              borderRadius: "50%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg
              width="24"
              height="24"
              viewBox="0 0 24 24"
              fill="none"
              stroke="#f2ece3"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <rect x="2" y="4" width="20" height="16" rx="2" />
              <path d="m22 7-8.97 5.7a1.94 1.94 0 0 1-2.06 0L2 7" />
            </svg>
          </div>

          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "24px",
              fontStyle: "italic",
              color: "var(--text-primary, #3d3529)",
              margin: "0 0 12px",
            }}
          >
            Vérifie ta boîte mail
          </h1>
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "13px",
              color: "var(--text-muted, #7a6e5d)",
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            Un lien de connexion vient d&apos;être envoyé à ton adresse email.
            Clique dessus pour te connecter.
          </p>
        </div>

        <a
          href="/auth/signin"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "12px",
            color: "var(--text-light, #a39683)",
            textDecoration: "none",
          }}
        >
          Pas reçu ? Réessayer
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/auth/verify-request/page.tsx
git commit -m "feat: add verify-request page for magic link flow"
```

---

## Task 3: Auth error page

**Files:**
- Create: `app/auth/error/page.tsx`

NextAuth redirects here on auth errors (`lib/auth.ts:72`).

- [ ] **Step 1: Create the error page**

```typescript
// app/auth/error/page.tsx
"use client";

import { useSearchParams } from "next/navigation";
import { Suspense } from "react";

const ERROR_MESSAGES: Record<string, string> = {
  Configuration: "Erreur de configuration du serveur. Contacte le support.",
  AccessDenied: "Accès refusé. Tu n'as pas la permission de te connecter.",
  Verification: "Le lien de connexion a expiré ou a déjà été utilisé.",
  OAuthSignin: "Impossible d'initier la connexion. Réessaie.",
  OAuthCallback: "Erreur lors du retour d'authentification. Réessaie.",
  OAuthAccountNotLinked: "Ce compte est déjà associé à une autre méthode de connexion.",
  EmailSignin: "Impossible d'envoyer l'email de connexion. Vérifie ton adresse.",
  SessionRequired: "Tu dois être connecté pour accéder à cette page.",
  Default: "Une erreur est survenue lors de la connexion.",
};

function ErrorContent() {
  const searchParams = useSearchParams();
  const errorCode = searchParams.get("error") ?? "Default";
  const message = ERROR_MESSAGES[errorCode] ?? ERROR_MESSAGES.Default;

  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-parchment, #f2ece3)",
        padding: "20px",
      }}
    >
      <div
        style={{
          maxWidth: "380px",
          width: "100%",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        <a
          href="/"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "18px",
            fontStyle: "italic",
            color: "var(--text-primary, #3d3529)",
            textDecoration: "none",
          }}
        >
          TrailForge
        </a>

        <div
          style={{
            padding: "32px 24px",
            background: "var(--bg-surface, #f7f3ed)",
            border: "1px solid rgba(239,68,68,0.25)",
            borderRadius: "2px",
          }}
        >
          <h1
            style={{
              fontFamily: "var(--font-heading)",
              fontSize: "24px",
              fontStyle: "italic",
              color: "var(--text-primary, #3d3529)",
              margin: "0 0 12px",
            }}
          >
            Erreur de connexion
          </h1>
          <p
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "13px",
              color: "#dc2626",
              margin: 0,
              lineHeight: 1.6,
            }}
          >
            {message}
          </p>
        </div>

        <a
          href="/auth/signin"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "13px",
            fontWeight: 700,
            letterSpacing: "0.05em",
            color: "#f2ece3",
            background: "var(--accent-forest, #5a7247)",
            textDecoration: "none",
            padding: "14px 24px",
            display: "block",
            textAlign: "center",
            minHeight: "44px",
            lineHeight: 1,
            borderRadius: "2px",
          }}
        >
          Réessayer
        </a>

        <a
          href="/"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "12px",
            color: "var(--text-light, #a39683)",
            textDecoration: "none",
          }}
        >
          Retour à l&apos;accueil
        </a>
      </div>
    </div>
  );
}

export default function AuthErrorPage() {
  return (
    <Suspense
      fallback={
        <div style={{ minHeight: "100dvh", background: "var(--bg-parchment, #f2ece3)" }} />
      }
    >
      <ErrorContent />
    </Suspense>
  );
}
```

- [ ] **Step 2: Commit**

```bash
git add app/auth/error/page.tsx
git commit -m "feat: add auth error page with localized error messages"
```

---

## Task 4: Wire PricingSection Pro button to checkout

**Files:**
- Modify: `components/landing/PricingSection.tsx`

The Pro "Passer Pro" button at line 245 has no `onClick`. It must redirect to the sign-in flow, which then triggers Stripe checkout.

- [ ] **Step 1: Add click handler to PricingSection**

In `components/landing/PricingSection.tsx`, the Pro button (line 245-265) needs to link to the sign-in page with a callbackUrl pointing to checkout. Since this is a landing page (user is not logged in), the flow is: click → sign in → redirect to `/app?upgrade=pro`.

Replace the existing `<button>` at line 245-265 with:

```tsx
<a
  href="/auth/signin?callbackUrl=%2Fapp%3Fupgrade%3Dpro"
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
    textDecoration: "none",
  }}
>
  Passer Pro
</a>
```

- [ ] **Step 2: Commit**

```bash
git add components/landing/PricingSection.tsx
git commit -m "feat: wire PricingSection Pro button to auth/checkout flow"
```

---

## Task 5: Wire UpgradePrompt to Stripe checkout

**Files:**
- Modify: `components/ui/UpgradePrompt.tsx`

The "Passer Pro" button in UpgradePrompt (line 180-206) just calls `onClose`. It needs to initiate Stripe checkout via the `/api/payments/checkout` endpoint.

- [ ] **Step 1: Add checkout logic to UpgradePrompt**

Replace the entire file `components/ui/UpgradePrompt.tsx` — add a `handleCheckout` function that calls `/api/payments/checkout` and redirects to Stripe. For unauthenticated users, redirect to sign-in first.

The key change is the "Passer Pro" button's `onClick`:

```typescript
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
      // Not authenticated — redirect to sign-in, then back to app with upgrade intent
      window.location.href = "/auth/signin?callbackUrl=%2Fapp%3Fupgrade%3Dpro";
      return;
    }
    if (data.url) {
      window.location.href = data.url;
    }
  } catch {
    // Silently fail — user can retry
  } finally {
    setLoading(false);
  }
}
```

Replace the "Passer Pro" button `onClick={onClose}` with `onClick={() => handleCheckout("monthly")}` and disable it when `loading` is true.

- [ ] **Step 2: Commit**

```bash
git add components/ui/UpgradePrompt.tsx
git commit -m "feat: wire UpgradePrompt to Stripe checkout endpoint"
```

---

## Task 6: Custom error page

**Files:**
- Create: `app/error.tsx`
- Create: `app/not-found.tsx`

- [ ] **Step 1: Create error boundary page**

```typescript
// app/error.tsx
"use client";

export default function ErrorPage({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-parchment, #f2ece3)",
        padding: "20px",
      }}
    >
      <div
        style={{
          maxWidth: "380px",
          width: "100%",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        <a
          href="/"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "18px",
            fontStyle: "italic",
            color: "var(--text-primary, #3d3529)",
            textDecoration: "none",
          }}
        >
          TrailForge
        </a>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "28px",
            fontStyle: "italic",
            color: "var(--text-primary, #3d3529)",
            margin: 0,
          }}
        >
          Quelque chose s&apos;est mal passé
        </h1>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "13px",
            color: "var(--text-muted, #7a6e5d)",
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          Une erreur inattendue est survenue. Réessaie ou retourne à l&apos;accueil.
        </p>
        <div style={{ display: "flex", gap: "12px", justifyContent: "center" }}>
          <button
            onClick={reset}
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "13px",
              fontWeight: 700,
              color: "#f2ece3",
              background: "var(--accent-forest, #5a7247)",
              border: "none",
              padding: "12px 24px",
              minHeight: "44px",
              cursor: "pointer",
              borderRadius: "2px",
            }}
          >
            Réessayer
          </button>
          <a
            href="/"
            style={{
              fontFamily: "var(--font-body)",
              fontSize: "13px",
              fontWeight: 500,
              color: "var(--text-primary, #3d3529)",
              border: "1px solid var(--border, #d4c9b8)",
              padding: "12px 24px",
              minHeight: "44px",
              display: "flex",
              alignItems: "center",
              textDecoration: "none",
              borderRadius: "2px",
            }}
          >
            Accueil
          </a>
        </div>
      </div>
    </div>
  );
}
```

- [ ] **Step 2: Create not-found page**

```typescript
// app/not-found.tsx
export default function NotFoundPage() {
  return (
    <div
      style={{
        minHeight: "100dvh",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        background: "var(--bg-parchment, #f2ece3)",
        padding: "20px",
      }}
    >
      <div
        style={{
          maxWidth: "380px",
          width: "100%",
          textAlign: "center",
          display: "flex",
          flexDirection: "column",
          gap: "20px",
        }}
      >
        <a
          href="/"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "18px",
            fontStyle: "italic",
            color: "var(--text-primary, #3d3529)",
            textDecoration: "none",
          }}
        >
          TrailForge
        </a>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "48px",
            fontWeight: 700,
            color: "var(--border, #d4c9b8)",
            margin: 0,
          }}
        >
          404
        </p>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "24px",
            fontStyle: "italic",
            color: "var(--text-primary, #3d3529)",
            margin: 0,
          }}
        >
          Page introuvable
        </h1>
        <p
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "13px",
            color: "var(--text-muted, #7a6e5d)",
            margin: 0,
            lineHeight: 1.6,
          }}
        >
          Ce sentier ne mène nulle part. Retourne à l&apos;accueil.
        </p>
        <a
          href="/"
          style={{
            fontFamily: "var(--font-body)",
            fontSize: "13px",
            fontWeight: 700,
            color: "#f2ece3",
            background: "var(--accent-forest, #5a7247)",
            textDecoration: "none",
            padding: "14px 24px",
            display: "block",
            textAlign: "center",
            minHeight: "44px",
            lineHeight: 1,
            borderRadius: "2px",
          }}
        >
          Retour à l&apos;accueil
        </a>
      </div>
    </div>
  );
}
```

- [ ] **Step 3: Commit**

```bash
git add app/error.tsx app/not-found.tsx
git commit -m "feat: add custom 404 and error pages"
```

---

## Task 7: Legal pages (Privacy Policy + Terms of Service)

**Files:**
- Create: `app/legal/privacy/page.tsx`
- Create: `app/legal/terms/page.tsx`

Stripe requires a privacy policy and terms of service link. These are referenced from the footer.

- [ ] **Step 1: Create privacy policy page**

```typescript
// app/legal/privacy/page.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Politique de confidentialité — TrailForge",
};

export default function PrivacyPage() {
  return (
    <div
      style={{
        background: "var(--bg-parchment, #f2ece3)",
        minHeight: "100dvh",
        padding: "60px 20px",
      }}
    >
      <article
        style={{
          maxWidth: "640px",
          margin: "0 auto",
          fontFamily: "var(--font-body)",
          fontSize: "13px",
          color: "var(--text-primary, #3d3529)",
          lineHeight: 1.8,
        }}
      >
        <a
          href="/"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "16px",
            fontStyle: "italic",
            color: "var(--text-muted, #7a6e5d)",
            textDecoration: "none",
          }}
        >
          TrailForge
        </a>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(24px, 4vw, 36px)",
            fontStyle: "italic",
            margin: "32px 0 24px",
          }}
        >
          Politique de confidentialité
        </h1>
        <p style={{ color: "var(--text-muted, #7a6e5d)", marginBottom: "32px" }}>
          Dernière mise à jour : 28 mars 2026
        </p>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "18px", fontStyle: "italic", margin: "0 0 12px" }}>
            1. Données collectées
          </h2>
          <p>TrailForge collecte les données strictement nécessaires au fonctionnement du service :</p>
          <ul style={{ paddingLeft: "20px", margin: "8px 0" }}>
            <li><strong>Compte utilisateur :</strong> adresse email (connexion par lien magique ou Google OAuth).</li>
            <li><strong>Données de parcours :</strong> coordonnées GPS des itinéraires générés (uniquement pour les abonnés Pro qui utilisent l&apos;historique).</li>
            <li><strong>Données de paiement :</strong> gérées intégralement par Stripe. TrailForge ne stocke aucun numéro de carte bancaire.</li>
            <li><strong>Données techniques :</strong> adresse IP (pour la limitation de requêtes), type de navigateur (analytics anonymisés via Vercel Analytics).</li>
          </ul>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "18px", fontStyle: "italic", margin: "0 0 12px" }}>
            2. Utilisation des données
          </h2>
          <p>Vos données sont utilisées exclusivement pour :</p>
          <ul style={{ paddingLeft: "20px", margin: "8px 0" }}>
            <li>Fournir le service de génération de parcours.</li>
            <li>Gérer votre compte et votre abonnement.</li>
            <li>Améliorer le service via des statistiques anonymisées.</li>
          </ul>
          <p>TrailForge ne vend, ne loue et ne partage jamais vos données personnelles à des tiers.</p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "18px", fontStyle: "italic", margin: "0 0 12px" }}>
            3. Cookies
          </h2>
          <p>
            TrailForge utilise uniquement des cookies techniques essentiels (session d&apos;authentification).
            Aucun cookie publicitaire ou de suivi n&apos;est utilisé.
            Vercel Analytics collecte des métriques de performance anonymisées sans cookies.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "18px", fontStyle: "italic", margin: "0 0 12px" }}>
            4. Hébergement et sécurité
          </h2>
          <p>
            Le service est hébergé sur Vercel (États-Unis / Europe).
            Les données sont chiffrées en transit (TLS) et au repos.
            Les paiements sont sécurisés par Stripe, certifié PCI DSS niveau 1.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "18px", fontStyle: "italic", margin: "0 0 12px" }}>
            5. Vos droits (RGPD)
          </h2>
          <p>
            Conformément au RGPD, vous disposez d&apos;un droit d&apos;accès, de rectification, de suppression et de portabilité de vos données.
            Pour exercer ces droits, contactez-nous à <strong>contact@trailforge.app</strong>.
          </p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "18px", fontStyle: "italic", margin: "0 0 12px" }}>
            6. Contact
          </h2>
          <p>
            Pour toute question relative à cette politique : <strong>contact@trailforge.app</strong>
          </p>
        </section>
      </article>
    </div>
  );
}
```

- [ ] **Step 2: Create terms of service page**

```typescript
// app/legal/terms/page.tsx
import type { Metadata } from "next";

export const metadata: Metadata = {
  title: "Conditions générales d'utilisation — TrailForge",
};

export default function TermsPage() {
  return (
    <div
      style={{
        background: "var(--bg-parchment, #f2ece3)",
        minHeight: "100dvh",
        padding: "60px 20px",
      }}
    >
      <article
        style={{
          maxWidth: "640px",
          margin: "0 auto",
          fontFamily: "var(--font-body)",
          fontSize: "13px",
          color: "var(--text-primary, #3d3529)",
          lineHeight: 1.8,
        }}
      >
        <a
          href="/"
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "16px",
            fontStyle: "italic",
            color: "var(--text-muted, #7a6e5d)",
            textDecoration: "none",
          }}
        >
          TrailForge
        </a>
        <h1
          style={{
            fontFamily: "var(--font-heading)",
            fontSize: "clamp(24px, 4vw, 36px)",
            fontStyle: "italic",
            margin: "32px 0 24px",
          }}
        >
          Conditions générales d&apos;utilisation
        </h1>
        <p style={{ color: "var(--text-muted, #7a6e5d)", marginBottom: "32px" }}>
          Dernière mise à jour : 28 mars 2026
        </p>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "18px", fontStyle: "italic", margin: "0 0 12px" }}>
            1. Objet
          </h2>
          <p>
            TrailForge est un service de génération d&apos;itinéraires sportifs (course à pied, cyclisme).
            Ces conditions régissent l&apos;accès et l&apos;utilisation du service accessible à l&apos;adresse trailforge.app.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "18px", fontStyle: "italic", margin: "0 0 12px" }}>
            2. Accès au service
          </h2>
          <p>
            L&apos;accès au service est gratuit dans sa version de base.
            L&apos;abonnement Pro (8,99€/mois ou 79,99€/an) donne accès aux fonctionnalités avancées décrites sur la page tarifs.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "18px", fontStyle: "italic", margin: "0 0 12px" }}>
            3. Abonnement et paiement
          </h2>
          <ul style={{ paddingLeft: "20px", margin: "8px 0" }}>
            <li>Les paiements sont gérés par Stripe.</li>
            <li>L&apos;abonnement est reconduit automatiquement sauf résiliation.</li>
            <li>Vous pouvez résilier à tout moment depuis votre espace de gestion (portail Stripe).</li>
            <li>La résiliation prend effet à la fin de la période en cours.</li>
          </ul>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "18px", fontStyle: "italic", margin: "0 0 12px" }}>
            4. Limitation de responsabilité
          </h2>
          <p>
            Les itinéraires générés par TrailForge sont des suggestions basées sur les données OpenStreetMap.
            L&apos;utilisateur reste responsable de vérifier la praticabilité et la sécurité du parcours avant de le suivre.
            TrailForge ne saurait être tenu responsable d&apos;accidents, blessures ou dommages survenus lors de l&apos;utilisation d&apos;un itinéraire généré.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "18px", fontStyle: "italic", margin: "0 0 12px" }}>
            5. Propriété intellectuelle
          </h2>
          <p>
            Le code source, le design et les algorithmes de TrailForge sont protégés par le droit d&apos;auteur.
            Les données cartographiques proviennent d&apos;OpenStreetMap et sont disponibles sous licence ODbL.
          </p>
        </section>

        <section style={{ marginBottom: "32px" }}>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "18px", fontStyle: "italic", margin: "0 0 12px" }}>
            6. Droit applicable
          </h2>
          <p>
            Les présentes conditions sont régies par le droit français.
            Tout litige sera soumis aux tribunaux compétents de Lyon, France.
          </p>
        </section>

        <section>
          <h2 style={{ fontFamily: "var(--font-heading)", fontSize: "18px", fontStyle: "italic", margin: "0 0 12px" }}>
            7. Contact
          </h2>
          <p>
            Pour toute question : <strong>contact@trailforge.app</strong>
          </p>
        </section>
      </article>
    </div>
  );
}
```

- [ ] **Step 3: Add legal links to FooterSection**

In `components/landing/FooterSection.tsx`, add links to `/legal/privacy` and `/legal/terms` in the footer.

- [ ] **Step 4: Commit**

```bash
git add app/legal/ components/landing/FooterSection.tsx
git commit -m "feat: add privacy policy and terms of service pages"
```

---

## Task 8: OG meta, social tags, and canonical URL

**Files:**
- Modify: `app/layout.tsx`

- [ ] **Step 1: Add OG and Twitter metadata to layout**

In `app/layout.tsx`, extend the `metadata` export:

```typescript
export const metadata: Metadata = {
  title: "TrailForge — Générateur de parcours GPS",
  description:
    "Génère un parcours running ou cyclisme adapté à ta séance en 10 secondes. D+, distance, surface — zéro compromis.",
  icons: { icon: "/favicon.ico" },
  metadataBase: new URL("https://trailforge.app"),
  openGraph: {
    type: "website",
    locale: "fr_FR",
    siteName: "TrailForge",
    title: "TrailForge — Générateur de parcours GPS",
    description:
      "Génère un parcours running ou cyclisme adapté à ta séance en 10 secondes.",
    url: "https://trailforge.app",
  },
  twitter: {
    card: "summary_large_image",
    title: "TrailForge — Générateur de parcours GPS",
    description:
      "Génère un parcours running ou cyclisme adapté à ta séance en 10 secondes.",
  },
  alternates: {
    canonical: "https://trailforge.app",
  },
  robots: {
    index: true,
    follow: true,
  },
};
```

Note: OG image can be added later once a screenshot of the app is available. The meta tags above are sufficient for launch.

- [ ] **Step 2: Commit**

```bash
git add app/layout.tsx
git commit -m "feat: add OG, Twitter, and canonical meta tags"
```

---

## Task 9: Database migration script

**Files:**
- Create: `scripts/init-db.ts`

The schema exists at `lib/db/schema.sql` but needs to be applied to Vercel Postgres. This script reads the SQL and executes it.

- [ ] **Step 1: Create the migration script**

```typescript
// scripts/init-db.ts
import { readFileSync } from "fs";
import { join } from "path";
import { sql } from "@vercel/postgres";

async function main() {
  const schemaPath = join(process.cwd(), "lib", "db", "schema.sql");
  const schema = readFileSync(schemaPath, "utf-8");

  // Split by statement (semicolons at end of line) and execute each
  const statements = schema
    .split(/;\s*$/m)
    .map((s) => s.trim())
    .filter((s) => s.length > 0 && !s.startsWith("--"));

  console.log(`Executing ${statements.length} statements...`);

  for (const statement of statements) {
    console.log(`  → ${statement.slice(0, 60)}...`);
    await sql.query(statement);
  }

  console.log("Database schema initialized successfully.");
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
```

- [ ] **Step 2: Add npm script**

In `package.json`, add under `"scripts"`:

```json
"db:init": "npx tsx scripts/init-db.ts"
```

- [ ] **Step 3: Commit**

```bash
git add scripts/init-db.ts package.json
git commit -m "feat: add database migration script"
```

---

## Task 10: Complete environment variable stubs

**Files:**
- Modify: `.env.local`
- Create: `.env.example`

- [ ] **Step 1: Add missing env var stubs to .env.local**

Append to `.env.local`:

```
STRIPE_MONTHLY_PRICE_ID=price_stub_monthly
STRIPE_ANNUAL_PRICE_ID=price_stub_annual
STRIPE_WEBHOOK_SECRET=whsec_stub_webhook
```

- [ ] **Step 2: Create .env.example**

```env
# ── Required for all environments ─────────────────────────────────────────────
NEXT_PUBLIC_MAPBOX_TOKEN=          # Mapbox GL token (get from mapbox.com)
NEXT_PUBLIC_APP_URL=http://localhost:3000

# ── Routing engine fallback (optional) ────────────────────────────────────────
GRAPHHOPPER_API_KEY=               # graphhopper.com API key
ORS_API_KEY=                       # openrouteservice.org API key

# ── Feature flags ─────────────────────────────────────────────────────────────
GROWTHBOOK_API_HOST=https://cdn.growthbook.io
GROWTHBOOK_CLIENT_KEY=
FLAGS_SECRET=

# ── Auth (NextAuth v5) ────────────────────────────────────────────────────────
AUTH_SECRET=                       # Generate: openssl rand -base64 32
EMAIL_SERVER=                      # SMTP connection string
EMAIL_FROM=noreply@trailforge.app
GOOGLE_CLIENT_ID=                  # Google OAuth client ID
GOOGLE_CLIENT_SECRET=              # Google OAuth client secret

# ── Database ──────────────────────────────────────────────────────────────────
POSTGRES_URL=                      # Vercel Postgres connection string

# ── Payments (Stripe) ────────────────────────────────────────────────────────
STRIPE_SECRET_KEY=                 # Stripe secret key (sk_test_ or sk_live_)
STRIPE_MONTHLY_PRICE_ID=          # Stripe price ID for monthly plan
STRIPE_ANNUAL_PRICE_ID=           # Stripe price ID for annual plan
STRIPE_WEBHOOK_SECRET=            # Stripe webhook signing secret (whsec_)
```

- [ ] **Step 3: Add .env.example to .gitignore check**

Verify `.env.example` is NOT in `.gitignore` (it should be committed). Verify `.env.local` IS in `.gitignore`.

- [ ] **Step 4: Commit**

```bash
git add .env.local .env.example
git commit -m "chore: add missing env var stubs and .env.example"
```

---

## Task 11: Wire FooterSection with legal links

**Files:**
- Modify: `components/landing/FooterSection.tsx`

Read the current footer and add links to `/legal/privacy` and `/legal/terms`.

- [ ] **Step 1: Read the current FooterSection**
- [ ] **Step 2: Add legal links to the footer**
- [ ] **Step 3: Commit**

```bash
git add components/landing/FooterSection.tsx
git commit -m "feat: add legal page links to landing footer"
```

---

## Task 12: Verify build and test suite

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run`
Expected: All tests pass

- [ ] **Step 2: Run production build**

Run: `npx next build`
Expected: Build succeeds with no errors. All new routes appear in the build output:
- `/auth/signin`
- `/auth/verify-request`
- `/auth/error`
- `/legal/privacy`
- `/legal/terms`
- `/not-found` (custom 404)

- [ ] **Step 3: Final commit with all remaining changes**

Stage any uncommitted changes from the existing branch work (lib reorganization, doc updates, etc.) and commit as a cleanup commit.

```bash
git add -A
git commit -m "chore: finalize production readiness — cleanup and documentation"
```
