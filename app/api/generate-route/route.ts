/**
 * POST /api/generate-route
 *
 * Entry point for route generation. Validates the request body, delegates
 * loop generation to V2 or waypoint/end-address routes to legacy, and maps errors to HTTP responses.
 *
 * Request body: `GenerateRouteRequest`
 * Success response (200): `GenerateRouteResponse`
 * Error responses:
 * - 400 invalid body or unknown profile
 * - 422 NO_ROAD_NETWORK / IMPOSSIBLE_ELEVATION / GEOCODING_FAILED
 * - 429 rate limited
 * - 500 unexpected error
 *
 * All errors return a `GenerateRouteError` JSON body with `success: false`,
 * a human-readable French `error` message, and a machine-readable `errorCode`.
 */
import { NextRequest, NextResponse } from "next/server";
import { generateRouteV2 } from "@/lib/engine";
import { generateRoute } from "@/lib/route-generator-legacy";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import { createRateLimiter } from "@/lib/rate-limiter";
import { RouteGenerationError } from "@/lib/errors";
import type { GenerateRouteRequest, GenerateRouteError, RouteCandidate } from "@/lib/types";

// ── Rate limiting ─────────────────────────────────────────────────────────────

const rateLimiter = createRateLimiter({ limit: 20, windowMs: 60 * 1000 });

type RouteCandidateWithDiagnostics = RouteCandidate & { edgeDiagnostics?: unknown };
type RouteLikeWithDiagnostics = {
  best?: RouteCandidateWithDiagnostics;
  candidates?: RouteCandidateWithDiagnostics[];
  stageTimings?: unknown;
  diagnostics?: unknown;
  [key: string]: unknown;
};

type StripDiagnosticsOptions = {
  includeEdgeDiagnostics: boolean;
  includeGenerationDiagnostics: boolean;
};

function stripDiagnostics<T>(route: T, options: StripDiagnosticsOptions): T {
  if (route == null || typeof route !== "object") return route;

  const stripCandidate = (candidate: RouteCandidateWithDiagnostics): RouteCandidate => {
    if (options.includeEdgeDiagnostics) return candidate;
    const stripped = { ...candidate };
    delete stripped.edgeDiagnostics;
    return stripped;
  };
  const current = route as RouteLikeWithDiagnostics;
  const next: RouteLikeWithDiagnostics = { ...current };

  if (!options.includeGenerationDiagnostics) {
    delete next.stageTimings;
    delete next.diagnostics;
  }
  if (current.best != null) next.best = stripCandidate(current.best);
  if (Array.isArray(current.candidates)) {
    next.candidates = current.candidates.map((candidate) => stripCandidate(candidate));
  }

  return next as T;
}

// ── French error messages by sub-code ─────────────────────────────────────────

const NO_ROAD_NETWORK_MESSAGES: Record<string, string> = {
  OVERPASS_TIMEOUT: "Serveur cartographique indisponible. Réessayez dans 30s.",
  EMPTY_GRAPH: "Aucune route trouvée. Essayez un point de départ plus urbain ou une distance plus courte.",
  SOLVER_EMPTY: "Impossible de construire un parcours en boucle. Essayez une distance différente.",
};

const DEFAULT_NO_ROAD_NETWORK_MSG =
  "Aucun réseau routier détecté à cet endroit. Essayez un autre point de départ.";

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

  let body: Partial<GenerateRouteRequest>;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json<GenerateRouteError>(
      { success: false, error: "Corps de requête invalide.", errorCode: "UNKNOWN" },
      { status: 400 }
    );
  }

  // Validate required fields
  if (
    !body.address?.trim() ||
    !body.profileId ||
    typeof body.targetDistanceKm !== "number" ||
    typeof body.targetElevationM !== "number"
  ) {
    return NextResponse.json<GenerateRouteError>(
      { success: false, error: "Paramètres manquants ou invalides.", errorCode: "UNKNOWN" },
      { status: 400 }
    );
  }

  const profile = PROFILES_BY_ID.get(body.profileId);
  if (!profile) {
    return NextResponse.json<GenerateRouteError>(
      { success: false, error: "Profil de séance inconnu.", errorCode: "UNKNOWN" },
      { status: 400 }
    );
  }

  // Validate numeric bounds against profile ranges
  if (
    !Number.isFinite(body.targetDistanceKm) ||
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
    !Number.isFinite(body.targetElevationM) ||
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

    // V2 is optimized for running loops. Waypoints/end-address and cycling long
    // distances use the controlled external-routing strategy (ORS/GraphHopper)
    // instead of forcing the local Overpass beam solver into huge graphs.
    const hasWaypoints =
      (routeRequest.waypoints?.length ?? 0) > 0 || !!routeRequest.endAddress;
    const shouldUseExternalRouting = hasWaypoints || profile.sport !== "running";

    if (shouldUseExternalRouting) {
      route = await generateRoute(routeRequest);
    } else {
      route = await generateRouteV2(routeRequest, {
        includeGenerationDiagnostics: body.includeGenerationDiagnostics === true,
      });
    }

    const responseRoute = stripDiagnostics(route, {
      includeEdgeDiagnostics: body.includeEdgeDiagnostics === true,
      includeGenerationDiagnostics: body.includeGenerationDiagnostics === true,
    });

    return NextResponse.json({ success: true, route: responseRoute });
  } catch (err) {
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
