import { NextRequest, NextResponse } from "next/server";
import { stripe } from "@/lib/stripe";
import { sql, setUserTier } from "@/lib/db";
import type Stripe from "stripe";

// ── Webhook signature verification ───────────────────────────────────────────

async function getRawBody(request: NextRequest): Promise<Buffer> {
  const arrayBuffer = await request.arrayBuffer();
  return Buffer.from(arrayBuffer);
}

// ── Event handlers ────────────────────────────────────────────────────────────

async function handleCheckoutCompleted(
  session: Stripe.Checkout.Session,
): Promise<void> {
  const userId = session.metadata?.userId;
  const plan = session.metadata?.plan;
  const customerId =
    typeof session.customer === "string"
      ? session.customer
      : session.customer?.id ?? null;
  const subscriptionId =
    typeof session.subscription === "string"
      ? session.subscription
      : session.subscription?.id ?? null;

  if (!userId || !plan || !customerId || !subscriptionId) {
    console.error("[webhook] Missing metadata on checkout.session.completed", {
      userId,
      plan,
      customerId,
      subscriptionId,
    });
    return;
  }

  // Upsert subscription row
  await sql`
    INSERT INTO subscriptions (user_id, stripe_customer_id, stripe_subscription_id, status, plan)
    VALUES (${userId}, ${customerId}, ${subscriptionId}, 'active', ${plan})
    ON CONFLICT (stripe_subscription_id)
    DO UPDATE SET status = 'active', plan = ${plan}
  `;

  await setUserTier(userId, "pro");

  console.info("[webhook] Activated pro for user", userId);
}

async function handleSubscriptionDeleted(
  subscription: Stripe.Subscription,
): Promise<void> {
  const subscriptionId = subscription.id;

  // Look up the user linked to this subscription
  const result = await sql`
    SELECT user_id FROM subscriptions
    WHERE stripe_subscription_id = ${subscriptionId}
  `;

  const userId = result.rows[0]?.user_id as string | undefined;

  if (!userId) {
    console.warn("[webhook] Subscription not found in DB:", subscriptionId);
    return;
  }

  await sql`
    UPDATE subscriptions
    SET status = 'cancelled'
    WHERE stripe_subscription_id = ${subscriptionId}
  `;

  await setUserTier(userId, "free");

  console.info("[webhook] Deactivated pro for user", userId);
}

// ── POST /api/payments/webhook ────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  if (!webhookSecret) {
    console.error("[webhook] STRIPE_WEBHOOK_SECRET is not set");
    return NextResponse.json(
      { error: "Webhook secret not configured." },
      { status: 500 },
    );
  }

  const signature = request.headers.get("stripe-signature");

  if (!signature) {
    return NextResponse.json(
      { error: "Missing stripe-signature header." },
      { status: 400 },
    );
  }

  let event: Stripe.Event;
  try {
    const rawBody = await getRawBody(request);
    event = stripe.webhooks.constructEvent(rawBody, signature, webhookSecret);
  } catch (err) {
    console.error("[webhook] Signature verification failed:", err);
    return NextResponse.json(
      { error: "Invalid webhook signature." },
      { status: 400 },
    );
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
        await handleCheckoutCompleted(
          event.data.object as Stripe.Checkout.Session,
        );
        break;

      case "customer.subscription.deleted":
        await handleSubscriptionDeleted(
          event.data.object as Stripe.Subscription,
        );
        break;

      default:
        // Unhandled event type — acknowledged silently
        break;
    }
  } catch (err) {
    console.error("[webhook] Error processing event", event.type, err);
    return NextResponse.json(
      { error: "Webhook handler error." },
      { status: 500 },
    );
  }

  return NextResponse.json({ received: true });
}
