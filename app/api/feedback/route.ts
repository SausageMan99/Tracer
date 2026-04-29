import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs/promises";
import * as path from "path";
import { createRateLimiter } from "@/lib/rate-limiter";
import { anonymizeIp } from "@/lib/privacy";
import { sanitizeFeedbackReasons } from "@/lib/feedback-reasons";

const DATA_DIR = path.join(process.cwd(), ".data");
const FEEDBACKS_FILE = path.join(DATA_DIR, "feedbacks.json");

// ── Rate limiting (shared utility with auto-eviction) ────────────────────────

const rateLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });

// ── Validation ───────────────────────────────────────────────────────────────

function isValidFeedback(body: Record<string, unknown>): boolean {
  if (typeof body.id !== "string" || body.id.length < 1) return false;
  if (body.rating !== "positive" && body.rating !== "negative") return false;
  if (typeof body.sessionType !== "string") return false;
  if (typeof body.sport !== "string") return false;
  if (typeof body.requestedDistanceKm !== "number") return false;
  if (typeof body.actualDistanceKm !== "number") return false;
  if (typeof body.actualElevationM !== "number") return false;
  if (typeof body.algorithmicScore !== "number") return false;
  if (body.reasons !== undefined && !Array.isArray(body.reasons)) return false;
  if (
    Array.isArray(body.reasons) &&
    sanitizeFeedbackReasons(body.reasons).length !== body.reasons.length
  ) return false;
  return true;
}

// ── File helpers (async) ─────────────────────────────────────────────────────

async function loadFeedbacksFromDisk(): Promise<unknown[]> {
  try {
    const raw = await fs.readFile(FEEDBACKS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

async function saveFeedbacksToDisk(feedbacks: unknown[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(FEEDBACKS_FILE, JSON.stringify(feedbacks, null, 2), "utf-8");
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, error: "Corps de requête invalide." },
      { status: 400 },
    );
  }

  if (!isValidFeedback(body)) {
    return NextResponse.json(
      { success: false, error: "Données de feedback invalides." },
      { status: 400 },
    );
  }

  try {
    const feedbacks = await loadFeedbacksFromDisk();
    const sanitizedFeedback = {
      ...body,
      reasons: sanitizeFeedbackReasons(body.reasons),
      timestamp: Date.now(),
      ipHash: anonymizeIp(ip),
    };
    const updated = [...feedbacks, sanitizedFeedback];
    await saveFeedbacksToDisk(updated);
  } catch (err) {
    console.error("[feedback] Failed to save:", err);
    return NextResponse.json(
      { success: false, error: "Erreur de sauvegarde." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}

// ── GET handler (admin export) ───────────────────────────────────────────────

export async function GET(request: NextRequest) {
  // Accept secret from Authorization header (preferred) or query param (legacy)
  const authHeader = request.headers.get("authorization");
  const secret = authHeader?.startsWith("Bearer ")
    ? authHeader.slice(7)
    : request.nextUrl.searchParams.get("secret");

  const adminSecret = process.env.ADMIN_SECRET;

  if (!adminSecret || secret !== adminSecret) {
    return NextResponse.json(
      { success: false, error: "Non autorisé." },
      { status: 401 },
    );
  }

  const feedbacks = await loadFeedbacksFromDisk();
  return NextResponse.json({ success: true, count: feedbacks.length, feedbacks });
}
