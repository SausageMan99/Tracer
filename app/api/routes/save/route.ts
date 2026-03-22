import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserTier, sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_NAME_LENGTH = 200;

// ── Input validation ──────────────────────────────────────────────────────────

function isValidRouteData(data: unknown): boolean {
  return data !== null && typeof data === "object" && !Array.isArray(data);
}

// ── POST /api/routes/save ─────────────────────────────────────────────────────

export async function POST(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: "Authentification requise." },
      { status: 401 },
    );
  }

  const userId = session.user.id;

  // Tier gate — only Pro users can save routes
  const tier = await getUserTier(userId);
  if (tier !== "pro") {
    return NextResponse.json(
      { success: false, error: "La sauvegarde des itinéraires est réservée aux abonnés Pro." },
      { status: 403 },
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

  const { routeData, name } = body;

  if (!isValidRouteData(routeData)) {
    return NextResponse.json(
      { success: false, error: "Données d'itinéraire invalides." },
      { status: 400 },
    );
  }

  const routeName =
    typeof name === "string" && name.trim().length > 0
      ? name.trim().slice(0, MAX_NAME_LENGTH)
      : null;

  try {
    const result = await sql`
      INSERT INTO route_history (user_id, route_data, name)
      VALUES (${userId}, ${JSON.stringify(routeData)}, ${routeName})
      RETURNING id, created_at
    `;

    return NextResponse.json({
      success: true,
      id: result.rows[0].id,
      createdAt: result.rows[0].created_at,
    });
  } catch (err) {
    console.error("[routes/save] DB error:", err);
    return NextResponse.json(
      { success: false, error: "Erreur de sauvegarde." },
      { status: 500 },
    );
  }
}
