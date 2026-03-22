import Stripe from "stripe";

// ── Stripe SDK instance (lazy — only initialized when key is present) ─────────

function createStripeClient(): Stripe {
  const key = process.env.STRIPE_SECRET_KEY;
  if (!key) {
    throw new Error("STRIPE_SECRET_KEY environment variable is not set");
  }
  return new Stripe(key, {
    apiVersion: "2026-02-25.clover",
    typescript: true,
  });
}

let _stripe: Stripe | null = null;

export function getStripe(): Stripe {
  if (!_stripe) {
    _stripe = createStripeClient();
  }
  return _stripe;
}

// Keep backward-compat named export for files that import { stripe }
// This getter throws at call time (not module load time) when key is absent
export const stripe: Stripe = new Proxy({} as Stripe, {
  get(_target, prop) {
    return getStripe()[prop as keyof Stripe];
  },
});

// ── Plan configuration ────────────────────────────────────────────────────────

export const PLANS = {
  monthly: {
    name: "Tracer Pro — Monthly",
    priceId: process.env.STRIPE_MONTHLY_PRICE_ID ?? "",
  },
  annual: {
    name: "Tracer Pro — Annual",
    priceId: process.env.STRIPE_ANNUAL_PRICE_ID ?? "",
  },
} as const;

export type PlanKey = keyof typeof PLANS;
