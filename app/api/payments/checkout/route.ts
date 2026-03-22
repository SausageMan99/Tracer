import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { stripe, PLANS } from "@/lib/stripe";
import type { PlanKey } from "@/lib/stripe";

// ── Input validation ──────────────────────────────────────────────────────────

function isValidPlan(plan: unknown): plan is PlanKey {
  return plan === "monthly" || plan === "annual";
}

// ── POST /api/payments/checkout ───────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id || !session.user.email) {
    return NextResponse.json(
      { success: false, error: "Authentification requise." },
      { status: 401 },
    );
  }

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Corps de requête invalide." },
      { status: 400 },
    );
  }

  const { plan } = body;

  if (!isValidPlan(plan)) {
    return NextResponse.json(
      { success: false, error: "Plan invalide. Choisissez 'monthly' ou 'annual'." },
      { status: 400 },
    );
  }

  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  try {
    const checkoutSession = await stripe.checkout.sessions.create({
      mode: "subscription",
      payment_method_types: ["card"],
      line_items: [
        {
          price: PLANS[plan].priceId,
          quantity: 1,
        },
      ],
      customer_email: session.user.email,
      metadata: {
        userId: session.user.id,
        plan,
      },
      success_url: `${appUrl}/dashboard?checkout=success`,
      cancel_url: `${appUrl}/pricing?checkout=cancelled`,
    });

    return NextResponse.json({ success: true, url: checkoutSession.url });
  } catch (err) {
    console.error("[payments/checkout] Stripe error:", err);
    return NextResponse.json(
      { success: false, error: "Impossible de créer la session de paiement." },
      { status: 500 },
    );
  }
}
