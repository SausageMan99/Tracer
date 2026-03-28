import { NextRequest, NextResponse } from "next/server";
import { addToWaitlist, type WaitlistEntry } from "@/lib/services/waitlist";
import { createRateLimiter } from "@/lib/services/rate-limiter";

// ── Rate limiting (shared utility with auto-eviction) ────────────────────────

const rateLimiter = createRateLimiter({ limit: 5, windowMs: 60 * 60 * 1000 });

// ── Email validation ─────────────────────────────────────────────────────────

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function validateEmail(email: unknown): email is string {
  return typeof email === "string" && EMAIL_RE.test(email) && email.length <= 254;
}

function validateSport(sport: unknown): sport is WaitlistEntry["sport"] {
  return sport === undefined || sport === "running" || sport === "cycling" || sport === "both";
}

function validateSource(source: unknown): source is WaitlistEntry["source"] {
  return source === "landing" || source === "post-generation";
}

// ── POST handler ─────────────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const ip = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";

  if (rateLimiter.isLimited(ip)) {
    return NextResponse.json(
      { success: false, error: "Trop de requêtes. Réessaye plus tard." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Corps de requête invalide." },
      { status: 400 },
    );
  }

  const { email, sport, source } = body as Record<string, unknown>;

  if (!validateEmail(email)) {
    return NextResponse.json(
      { success: false, error: "Email invalide." },
      { status: 400 },
    );
  }

  if (!validateSport(sport)) {
    return NextResponse.json(
      { success: false, error: "Sport invalide." },
      { status: 400 },
    );
  }

  if (!validateSource(source)) {
    return NextResponse.json(
      { success: false, error: "Source invalide." },
      { status: 400 },
    );
  }

  const entry: WaitlistEntry = {
    email: email.toLowerCase().trim(),
    sport: sport as WaitlistEntry["sport"],
    source,
    createdAt: new Date().toISOString(),
  };

  const result = await addToWaitlist(entry);

  return NextResponse.json(result, { status: 200 });
}
