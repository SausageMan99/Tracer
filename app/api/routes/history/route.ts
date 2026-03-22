import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/lib/auth";
import { getUserTier, sql } from "@/lib/db";

export const dynamic = "force-dynamic";

const MAX_LIMIT = 100;
const DEFAULT_LIMIT = 20;

// ── GET /api/routes/history ───────────────────────────────────────────────────

export async function GET(request: NextRequest) {
  const session = await auth();

  if (!session?.user?.id) {
    return NextResponse.json(
      { success: false, error: "Authentification requise." },
      { status: 401 },
    );
  }

  const userId = session.user.id;

  // Tier gate — only Pro users can access route history
  const tier = await getUserTier(userId);
  if (tier !== "pro") {
    return NextResponse.json(
      { success: false, error: "L'historique des itinéraires est réservé aux abonnés Pro." },
      { status: 403 },
    );
  }

  const searchParams = request.nextUrl.searchParams;

  const limit = Math.min(
    Math.max(
      1,
      parseInt(searchParams.get("limit") ?? String(DEFAULT_LIMIT), 10) || DEFAULT_LIMIT,
    ),
    MAX_LIMIT,
  );

  const cursor = searchParams.get("cursor");

  try {
    let rows;

    if (cursor) {
      rows = (
        await sql`
          SELECT id, route_data, name, created_at
          FROM route_history
          WHERE user_id = ${userId}
            AND created_at < (
              SELECT created_at FROM route_history WHERE id = ${cursor}
            )
          ORDER BY created_at DESC
          LIMIT ${limit}
        `
      ).rows;
    } else {
      rows = (
        await sql`
          SELECT id, route_data, name, created_at
          FROM route_history
          WHERE user_id = ${userId}
          ORDER BY created_at DESC
          LIMIT ${limit}
        `
      ).rows;
    }

    const nextCursor =
      rows.length === limit ? (rows[rows.length - 1]?.id as string) : null;

    return NextResponse.json({
      success: true,
      routes: rows,
      nextCursor,
    });
  } catch (err) {
    console.error("[routes/history] DB error:", err);
    return NextResponse.json(
      { success: false, error: "Erreur lors de la récupération de l'historique." },
      { status: 500 },
    );
  }
}
