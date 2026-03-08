import { NextRequest, NextResponse } from "next/server";
import { addToWaitlist, type WaitlistEntry } from "@/lib/waitlist";

// ── Rate limiting (in-memory per IP) ─────────────────────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 5;
const RATE_WINDOW_MS = 60 * 60 * 1000; // 1 hour

function isRateLimited(ip: string): boolean {
  const now = Date.now();
  const entry = rateLimitMap.get(ip);

  if (!entry || now > entry.resetAt) {
    rateLimitMap.set(ip, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return false;
  }

  if (entry.count >= RATE_LIMIT) {
    return true;
  }

  rateLimitMap.set(ip, { count: entry.count + 1, resetAt: entry.resetAt });
  return false;
}

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

  if (isRateLimited(ip)) {
    return NextResponse.json(
      { success: false, message: "Trop de requêtes. Réessaye plus tard." },
      { status: 429 },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Corps de requête invalide." },
      { status: 400 },
    );
  }

  const { email, sport, source } = body as Record<string, unknown>;

  if (!validateEmail(email)) {
    return NextResponse.json(
      { success: false, message: "Email invalide." },
      { status: 400 },
    );
  }

  if (!validateSport(sport)) {
    return NextResponse.json(
      { success: false, message: "Sport invalide." },
      { status: 400 },
    );
  }

  if (!validateSource(source)) {
    return NextResponse.json(
      { success: false, message: "Source invalide." },
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
