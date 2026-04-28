import { NextRequest, NextResponse } from "next/server";
import { appendFile, mkdir, readFile } from "fs/promises";
import * as path from "path";
import { createRateLimiter } from "@/lib/services/rate-limiter";

const DATA_DIR = path.join(process.cwd(), ".data");
const FEEDBACKS_FILE = path.join(DATA_DIR, "feedbacks.jsonl");

const MAX_PAGE_LIMIT = 500;
const DEFAULT_PAGE_LIMIT = 100;

// ── Rate limiting (shared utility with auto-eviction) ────────────────────────

const rateLimiter = createRateLimiter({ limit: 10, windowMs: 60 * 60 * 1000 });

// ── Idempotency ──────────────────────────────────────────────────────────────

const knownFeedbackIds = new Set<string>();
let idsLoaded = false;

async function ensureKnownIds(): Promise<void> {
  if (idsLoaded) return;
  const feedbacks = await loadFeedbacks();
  for (const f of feedbacks) {
    const id = (f as Record<string, unknown>).id;
    if (typeof id === "string") knownFeedbackIds.add(id);
  }
  idsLoaded = true;
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

// ── File helpers (append-only JSONL) ─────────────────────────────────────────

async function loadFeedbacks(): Promise<unknown[]> {
  try {
    const raw = await readFile(FEEDBACKS_FILE, "utf-8");
    return raw
      .trim()
      .split("\n")
      .filter(Boolean)
      .map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

async function appendFeedback(feedback: Record<string, unknown>): Promise<void> {
  await mkdir(DATA_DIR, { recursive: true });
  await appendFile(FEEDBACKS_FILE, JSON.stringify(feedback) + "\n", "utf-8");
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
    await ensureKnownIds();

    if (knownFeedbackIds.has(body.id as string)) {
      return NextResponse.json({ success: true, duplicate: true });
    }

    await appendFeedback({ ...body, timestamp: Date.now() });
    knownFeedbackIds.add(body.id as string);
  } catch (err) {
    console.error("[feedback] Failed to save:", err);
    return NextResponse.json(
      { success: false, error: "Erreur de sauvegarde." },
      { status: 500 },
    );
  }

  return NextResponse.json({ success: true });
}

// ── GET handler (admin export with pagination) ───────────────────────────────

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

  const page = Math.max(1, parseInt(request.nextUrl.searchParams.get("page") ?? "1", 10) || 1);
  const limit = Math.min(
    Math.max(1, parseInt(request.nextUrl.searchParams.get("limit") ?? String(DEFAULT_PAGE_LIMIT), 10) || DEFAULT_PAGE_LIMIT),
    MAX_PAGE_LIMIT,
  );

  const feedbacks = await loadFeedbacks();
  const total = feedbacks.length;
  const start = (page - 1) * limit;
  const slice = feedbacks.slice(start, start + limit);

  return NextResponse.json({ success: true, total, page, limit, feedbacks: slice });
}
