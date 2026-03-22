import { NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { stripe } from "@/lib/stripe";
import { sql } from "@/lib/db";

export const dynamic = "force-dynamic";

// ── POST /api/payments/portal ─────────────────────────────────────────────────

export async function POST() {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: "Authentification requise." },
      { status: 401 },
    );
  }

  const userId = session.user.id;
  const appUrl = process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000";

  // Look up Stripe customer ID from subscriptions table
  const result = await sql`
    SELECT stripe_customer_id FROM subscriptions
    WHERE user_id = ${userId}
    LIMIT 1
  `;

  const customerId = result.rows[0]?.stripe_customer_id as string | undefined;

  if (!customerId) {
    return NextResponse.json(
      { success: false, error: "Aucun abonnement trouvé pour ce compte." },
      { status: 404 },
    );
  }

  try {
    const portalSession = await stripe.billingPortal.sessions.create({
      customer: customerId,
      return_url: `${appUrl}/dashboard`,
    });

    return NextResponse.json({ success: true, url: portalSession.url });
  } catch (err) {
    console.error("[payments/portal] Stripe error:", err);
    return NextResponse.json(
      { success: false, error: "Impossible d'ouvrir le portail de facturation." },
      { status: 500 },
    );
  }
}
