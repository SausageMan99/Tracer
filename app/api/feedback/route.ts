import { NextRequest, NextResponse } from "next/server";
import * as fs from "fs";
import * as path from "path";

const DATA_DIR = path.join(process.cwd(), ".data");
const FEEDBACKS_FILE = path.join(DATA_DIR, "feedbacks.json");

// ── Rate limiting (in-memory per IP) ─────────────────────────────────────────

const rateLimitMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 10;
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
  return true;
}

// ── File helpers ─────────────────────────────────────────────────────────────

function loadFeedbacksFromDisk(): unknown[] {
  try {
    if (!fs.existsSync(FEEDBACKS_FILE)) return [];
    const raw = fs.readFileSync(FEEDBACKS_FILE, "utf-8");
    return JSON.parse(raw);
  } catch {
    return [];
  }
}

function saveFeedbacksToDisk(feedbacks: unknown[]): void {
  fs.mkdirSync(DATA_DIR, { recursive: true });
  fs.writeFileSync(FEEDBACKS_FILE, JSON.stringify(feedbacks, null, 2), "utf-8");
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

  let body: Record<string, unknown>;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { success: false, message: "Corps de requête invalide." },
      { status: 400 },
    );
  }

  if (!isValidFeedback(body)) {
    return NextResponse.json(
      { success: false, message: "Données de feedback invalides." },
      { status: 400 },
    );
  }

  try {
    const feedbacks = loadFeedbacksFromDisk();
    feedbacks.push({
      ...body,
      timestamp: Date.now(),
      ip,
    });
    saveFeedbacksToDisk(feedbacks);
  } catch (err) {
    console.error("[feedback] Failed to save:", err);
    return NextResponse.json(
      { success: false, message: "Erreur de sauvegarde." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}

// ── GET handler (admin export with secret) ───────────────────────────────────

export async function GET(request: NextRequest) {
  const secret = request.nextUrl.searchParams.get("secret");
  const adminSecret = process.env.ADMIN_SECRET;

  if (!adminSecret || secret !== adminSecret) {
    return NextResponse.json(
      { success: false, message: "Non autorisé." },
      { status: 401 },
    );
  }

  const feedbacks = loadFeedbacksFromDisk();
  return NextResponse.json({ success: true, count: feedbacks.length, feedbacks });
}
