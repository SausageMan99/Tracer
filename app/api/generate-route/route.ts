/**
 * POST /api/generate-route
 *
 * Entry point for route generation. Validates the request body, delegates
 * to V2 engine (loop-only) or legacy engine, and maps errors to HTTP responses.
 *
 * Request body: `GenerateRouteRequest`
 * Success response (200): `GenerateRouteResponse`
 * Error responses:
 * - 400 invalid body or unknown profile
 * - 422 NO_ROAD_NETWORK / IMPOSSIBLE_ELEVATION / GEOCODING_FAILED
 * - 429 rate limited
 * - 504 generation timeout
 * - 500 unexpected error
 *
 * All errors return a `GenerateRouteError` JSON body with `success: false`,
 * a human-readable French `error` message, and a machine-readable `errorCode`.
 */
import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { generateRouteV2 } from "@/lib/engine";
import { generateRoute } from "@/lib/route-generator-legacy";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import { createRateLimiter } from "@/lib/services/rate-limiter";
import { RouteGenerationError } from "@/lib/errors";
import { withTimeout, TimeoutError } from "@/lib/utils/with-timeout";
import type { GenerateRouteError } from "@/lib/types";

// ── Request validation ──────────────────────────────────────────────────────

const GenerateRouteSchema = z.object({
  address: z.string().trim().min(1, "Adresse requise").max(500),
  profileId: z.string().min(1),
  targetDistanceKm: z.number().finite().positive(),
  targetElevationM: z.number().finite().min(0),
  scenicMode: z.boolean().optional(),
  waypoints: z.array(z.string().trim().min(1)).max(5).optional(),
  endAddress: z.string().trim().min(1).max(500).optional(),
});

// ── Rate limiting ─────────────────────────────────────────────────────────────

const rateLimiter = createRateLimiter({ limit: 20, windowMs: 60 * 1000 });

// ── French error messages by sub-code ─────────────────────────────────────────

const NO_ROAD_NETWORK_MESSAGES: Record<string, string> = {
  OVERPASS_TIMEOUT: "Serveur cartographique indisponible. Réessayez dans 30s.",
  EMPTY_GRAPH: "Aucune route trouvée. Essayez un point de départ plus urbain ou une distance plus courte.",
  SOLVER_EMPTY: "Impossible de construire un parcours en boucle. Essayez une distance différente.",
};

const DEFAULT_NO_ROAD_NETWORK_MSG =
  "Aucun réseau routier détecté à cet endroit. Essayez un autre point de départ.";

const GENERATION_TIMEOUT_MS = 45_000;

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  // Rate limit check
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimiter.isLimited(ip)) {
    return NextResponse.json<GenerateRouteError>(
      { success: false, error: "Trop de requêtes. Réessayez dans un instant.", errorCode: "UNKNOWN" },
      { status: 429 }
    );
  }

  let rawBody: unknown;

  try {
    rawBody = await req.json();
  } catch {
    return NextResponse.json<GenerateRouteError>(
      { success: false, error: "Corps de requête invalide.", errorCode: "UNKNOWN" },
      { status: 400 }
    );
  }

  const parsed = GenerateRouteSchema.safeParse(rawBody);
  if (!parsed.success) {
    return NextResponse.json<GenerateRouteError>(
      { success: false, error: "Paramètres manquants ou invalides.", errorCode: "UNKNOWN" },
      { status: 400 }
    );
  }

  const body = parsed.data;

  const profile = PROFILES_BY_ID.get(body.profileId);
  if (!profile) {
    return NextResponse.json<GenerateRouteError>(
      { success: false, error: "Profil de séance inconnu.", errorCode: "UNKNOWN" },
      { status: 400 }
    );
  }

  // Validate numeric bounds against profile ranges
  if (
    body.targetDistanceKm < profile.distanceRange.min ||
    body.targetDistanceKm > profile.distanceRange.max
  ) {
    return NextResponse.json<GenerateRouteError>(
      {
        success: false,
        error: `Distance hors limites (${profile.distanceRange.min}–${profile.distanceRange.max} km).`,
        errorCode: "UNKNOWN",
      },
      { status: 400 }
    );
  }

  if (
    body.targetElevationM < profile.elevationRange.min ||
    body.targetElevationM > profile.elevationRange.max
  ) {
    return NextResponse.json<GenerateRouteError>(
      {
        success: false,
        error: `Dénivelé hors limites (${profile.elevationRange.min}–${profile.elevationRange.max} m).`,
        errorCode: "UNKNOWN",
      },
      { status: 400 }
    );
  }

  const routeRequest = {
    address: body.address,
    profileId: body.profileId,
    targetDistanceKm: body.targetDistanceKm,
    targetElevationM: body.targetElevationM,
    waypoints: body.waypoints,
    endAddress: body.endAddress,
    scenicMode: body.scenicMode === true ? true : undefined,
  };

  try {
    let route;

    // V2 is loops-only — use legacy for waypoints/endAddress
    const hasWaypoints =
      (routeRequest.waypoints?.length ?? 0) > 0 || !!routeRequest.endAddress;

    if (hasWaypoints) {
      route = await withTimeout(generateRoute(routeRequest), GENERATION_TIMEOUT_MS);
    } else {
      try {
        route = await withTimeout(generateRouteV2(routeRequest), GENERATION_TIMEOUT_MS);
      } catch (v2Err) {
        // Don't fallback on timeout — the legacy engine would likely time out too
        if (v2Err instanceof TimeoutError) {
          throw v2Err;
        }
        console.warn(
          "[generate-route] V2 engine failed, falling back to legacy:",
          v2Err instanceof Error ? v2Err.message : v2Err
        );
        route = await withTimeout(generateRoute(routeRequest), GENERATION_TIMEOUT_MS);
      }
    }

    return NextResponse.json({ success: true, route });
  } catch (err) {
    // Timeout errors → 504
    if (err instanceof TimeoutError) {
      return NextResponse.json<GenerateRouteError>(
        {
          success: false,
          errorCode: "UNKNOWN",
          error: "La génération a pris trop de temps. Essayez une distance plus courte ou un autre point de départ.",
        },
        { status: 504 }
      );
    }

    // Typed route generation errors
    if (err instanceof RouteGenerationError) {
      return mapRouteError(err);
    }

    // Legacy string-based errors (from route-generator-legacy.ts)
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("NO_ROAD_NETWORK") || message.startsWith("IMPOSSIBLE_ELEVATION") || message === "GEOCODING_FAILED") {
      return mapLegacyError(message);
    }

    console.error("[generate-route] Unexpected error:", err);
    return NextResponse.json<GenerateRouteError>(
      {
        success: false,
        errorCode: "UNKNOWN",
        error: "Erreur inattendue. Réessayez dans un instant.",
      },
      { status: 500 }
    );
  }
}

// ── Error mappers ─────────────────────────────────────────────────────────────

function mapRouteError(err: RouteGenerationError): NextResponse<GenerateRouteError> {
  switch (err.code) {
    case "NO_ROAD_NETWORK": {
      const errorMsg = (err.subCode && NO_ROAD_NETWORK_MESSAGES[err.subCode]) ?? DEFAULT_NO_ROAD_NETWORK_MSG;
      return NextResponse.json<GenerateRouteError>(
        { success: false, errorCode: "NO_ROAD_NETWORK", error: errorMsg },
        { status: 422 }
      );
    }
    case "IMPOSSIBLE_ELEVATION":
      return NextResponse.json<GenerateRouteError>(
        {
          success: false,
          errorCode: "IMPOSSIBLE_ELEVATION",
          error: `Le D+ demandé n'est pas atteignable depuis ce point. Maximum estimé : ${err.maxElevationEstimate ?? 0}m.`,
          maxElevationEstimate: err.maxElevationEstimate,
        },
        { status: 422 }
      );
    case "GEOCODING_FAILED":
      return NextResponse.json<GenerateRouteError>(
        { success: false, errorCode: "GEOCODING_FAILED", error: "Adresse introuvable. Vérifiez l'orthographe et réessayez." },
        { status: 422 }
      );
    default:
      return NextResponse.json<GenerateRouteError>(
        { success: false, errorCode: "UNKNOWN", error: "Erreur inattendue. Réessayez dans un instant." },
        { status: 500 }
      );
  }
}

/** Handle legacy string-encoded errors from route-generator-legacy.ts */
function mapLegacyError(message: string): NextResponse<GenerateRouteError> {
  if (message.startsWith("NO_ROAD_NETWORK")) {
    const subCode = message.split(":")[1] ?? "";
    const errorMsg = NO_ROAD_NETWORK_MESSAGES[subCode] ?? DEFAULT_NO_ROAD_NETWORK_MSG;
    return NextResponse.json<GenerateRouteError>(
      { success: false, errorCode: "NO_ROAD_NETWORK", error: errorMsg },
      { status: 422 }
    );
  }

  if (message.startsWith("IMPOSSIBLE_ELEVATION:")) {
    const maxElev = parseInt(message.split(":")[1] ?? "0", 10);
    return NextResponse.json<GenerateRouteError>(
      {
        success: false,
        errorCode: "IMPOSSIBLE_ELEVATION",
        error: `Le D+ demandé n'est pas atteignable depuis ce point. Maximum estimé : ${maxElev}m.`,
        maxElevationEstimate: maxElev,
      },
      { status: 422 }
    );
  }

  // GEOCODING_FAILED
  return NextResponse.json<GenerateRouteError>(
    { success: false, errorCode: "GEOCODING_FAILED", error: "Adresse introuvable. Vérifiez l'orthographe et réessayez." },
    { status: 422 }
  );
}
