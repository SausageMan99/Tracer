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
import { generateRouteV3Api } from "@/lib/engine-v3/api-adapter";
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

function createGenerationId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `gen_${crypto.randomUUID()}`;
  }
  return `gen_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

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

const ROUTE_CANDIDATES_REJECTED_MESSAGES: Record<string, string> = {
  PARK_TOO_SMALL_FOR_DISTANCE: "Le parc est trop contraint pour tenir cette distance sans dépasser la promesse bitume/sécurité. Essayez une distance plus courte.",
  RESTRICTED_ACCESS_BLOCKED: "Le meilleur accès forêt traverse un secteur marqué à accès restreint dans OSM. Départ refusé pour cette beta : choisissez une autre entrée de forêt.",
  URBAN_NATURE_PROMISE_UNMET: "Le secteur est routable, mais aucune boucle urban-nature assez honnête n'a été trouvée pour cette distance. Essayez une distance plus courte ou un départ plus proche du parc/canal.",
  TRAIL_PROMISE_UNMET: "Aucune boucle stable ne respecte assez les promesses terrain/sécurité pour cette beta. Essayez une distance plus courte ou un autre départ.",
};

const DEFAULT_ROUTE_CANDIDATES_REJECTED_MSG = ROUTE_CANDIDATES_REJECTED_MESSAGES.TRAIL_PROMISE_UNMET;

// ── Handler ───────────────────────────────────────────────────────────────────

export async function POST(req: NextRequest) {
  const generationId = createGenerationId();
  // Rate limit check
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  if (rateLimiter.isLimited(ip)) {
    return NextResponse.json<GenerateRouteError>(
      { success: false, generationId, betaOutcome: "refused", error: "Trop de requêtes. Réessayez dans un instant.", errorCode: "UNKNOWN" },
      { status: 429 }
    );
  }

  let body: Partial<GenerateRouteRequest>;

  try {
    body = await req.json();
  } catch {
    return NextResponse.json<GenerateRouteError>(
      { success: false, generationId, betaOutcome: "refused", error: "Corps de requête invalide.", errorCode: "UNKNOWN" },
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
      { success: false, generationId, betaOutcome: "refused", error: "Paramètres manquants ou invalides.", errorCode: "UNKNOWN" },
      { status: 400 }
    );
  }

  const profile = PROFILES_BY_ID.get(body.profileId);
  if (!profile) {
    return NextResponse.json<GenerateRouteError>(
      { success: false, generationId, betaOutcome: "refused", error: "Profil de séance inconnu.", errorCode: "UNKNOWN" },
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
        generationId,
        betaOutcome: "refused",
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
        generationId,
        betaOutcome: "refused",
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
    routeGateElevationToleranceM: typeof body.routeGateElevationToleranceM === "number" && Number.isFinite(body.routeGateElevationToleranceM)
      ? body.routeGateElevationToleranceM
      : undefined,
    waypoints: body.waypoints,
    endAddress: body.endAddress,
    scenicMode: body.scenicMode === true ? true : undefined,
  };

  try {
    if (body.engineVersion === "v3_experimental") {
      const v3Route = await generateRouteV3Api(routeRequest);
      return NextResponse.json({
        success: true,
        generationId,
        ...v3Route,
      });
    }

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

    const betaOutcome = responseRoute != null
      && typeof responseRoute === "object"
      && ("distanceAdjustment" in responseRoute || "terrainFallback" in responseRoute)
      ? "adjusted"
      : "generated";
    const betaRoute = {
      ...(responseRoute as unknown as Record<string, unknown>),
      generationId,
      betaOutcome,
    };

    return NextResponse.json({ success: true, generationId, route: betaRoute });
  } catch (err) {
    // Typed route generation errors. Vitest module resets can produce structurally
    // identical RouteGenerationError instances from a different module copy, so
    // accept the typed shape as well as instanceof.
    if (err instanceof RouteGenerationError || isRouteGenerationErrorLike(err)) {
      return mapRouteError(err as RouteGenerationError, generationId, body.includeGenerationDiagnostics === true);
    }

    // Legacy string-based errors (from route-generator-legacy.ts)
    const message = err instanceof Error ? err.message : "";
    if (message.startsWith("NO_ROAD_NETWORK") || message.startsWith("ROUTE_CANDIDATES_REJECTED") || message.startsWith("IMPOSSIBLE_ELEVATION") || message === "GEOCODING_FAILED") {
      return mapLegacyError(message, generationId);
    }

    console.error("[generate-route] Unexpected error:", err);
    return NextResponse.json<GenerateRouteError>(
      {
        success: false,
        generationId,
        betaOutcome: "refused",
        errorCode: "UNKNOWN",
        error: "Erreur inattendue. Réessayez dans un instant.",
      },
      { status: 500 }
    );
  }
}

// ── Error mappers ─────────────────────────────────────────────────────────────

function isRouteGenerationErrorLike(value: unknown): value is RouteGenerationError {
  if (value == null || typeof value !== "object") return false;
  const maybeError = value as { code?: unknown };
  return maybeError.code === "NO_ROAD_NETWORK"
    || maybeError.code === "ROUTE_CANDIDATES_REJECTED"
    || maybeError.code === "IMPOSSIBLE_ELEVATION"
    || maybeError.code === "GEOCODING_FAILED"
    || maybeError.code === "UNKNOWN";
}

function mapRouteError(err: RouteGenerationError, generationId: string, includeGenerationDiagnostics = false): NextResponse<GenerateRouteError> {
  switch (err.code) {
    case "NO_ROAD_NETWORK": {
      const errorMsg = (err.subCode && NO_ROAD_NETWORK_MESSAGES[err.subCode]) ?? DEFAULT_NO_ROAD_NETWORK_MSG;
      const generationDiagnostics = includeGenerationDiagnostics
        ? err.generationDiagnostics
        : undefined;
      return NextResponse.json<GenerateRouteError>(
        {
          success: false,
          generationId,
          betaOutcome: "refused",
          errorCode: "NO_ROAD_NETWORK",
          subCode: err.subCode,
          ...(generationDiagnostics != null ? { generationDiagnostics } : {}),
          error: errorMsg,
        },
        { status: 422 }
      );
    }
    case "ROUTE_CANDIDATES_REJECTED": {
      const rejectedCandidatesDiagnostics = includeGenerationDiagnostics
        ? err.rejectedCandidatesDiagnostics
        : undefined;
      const stageTimings = includeGenerationDiagnostics
        ? err.stageTimings
        : undefined;
      const errorMsg = (err.subCode && ROUTE_CANDIDATES_REJECTED_MESSAGES[err.subCode]) ?? DEFAULT_ROUTE_CANDIDATES_REJECTED_MSG;
      return NextResponse.json<GenerateRouteError>(
        {
          success: false,
          generationId,
          betaOutcome: "refused",
          errorCode: "ROUTE_CANDIDATES_REJECTED",
          subCode: err.subCode,
          ...(rejectedCandidatesDiagnostics != null ? { rejectedCandidatesDiagnostics } : {}),
          ...(stageTimings != null ? { stageTimings } : {}),
          error: errorMsg,
        },
        { status: 422 }
      );
    }
    case "IMPOSSIBLE_ELEVATION":
      return NextResponse.json<GenerateRouteError>(
        {
          success: false,
          generationId,
          betaOutcome: "refused",
          errorCode: "IMPOSSIBLE_ELEVATION",
          error: `Le D+ demandé n'est pas atteignable depuis ce point. Maximum estimé : ${err.maxElevationEstimate ?? 0}m.`,
          maxElevationEstimate: err.maxElevationEstimate,
        },
        { status: 422 }
      );
    case "GEOCODING_FAILED":
      return NextResponse.json<GenerateRouteError>(
        { success: false, generationId, betaOutcome: "refused", errorCode: "GEOCODING_FAILED", error: "Adresse introuvable. Vérifiez l'orthographe et réessayez." },
        { status: 422 }
      );
    default:
      return NextResponse.json<GenerateRouteError>(
        { success: false, generationId, betaOutcome: "refused", errorCode: "UNKNOWN", error: "Erreur inattendue. Réessayez dans un instant." },
        { status: 500 }
      );
  }
}

/** Handle legacy string-encoded errors from route-generator-legacy.ts */
function mapLegacyError(message: string, generationId: string): NextResponse<GenerateRouteError> {
  if (message.startsWith("NO_ROAD_NETWORK")) {
    const subCode = message.split(":")[1] ?? undefined;
    const errorMsg = subCode != null ? NO_ROAD_NETWORK_MESSAGES[subCode] ?? DEFAULT_NO_ROAD_NETWORK_MSG : DEFAULT_NO_ROAD_NETWORK_MSG;
    return NextResponse.json<GenerateRouteError>(
      { success: false, generationId, betaOutcome: "refused", errorCode: "NO_ROAD_NETWORK", subCode, error: errorMsg },
      { status: 422 }
    );
  }

  if (message.startsWith("ROUTE_CANDIDATES_REJECTED")) {
    const subCode = message.split(":")[1] ?? undefined;
    const errorMsg = subCode != null ? ROUTE_CANDIDATES_REJECTED_MESSAGES[subCode] ?? DEFAULT_ROUTE_CANDIDATES_REJECTED_MSG : DEFAULT_ROUTE_CANDIDATES_REJECTED_MSG;
    return NextResponse.json<GenerateRouteError>(
      {
        success: false,
        generationId,
        betaOutcome: "refused",
        errorCode: "ROUTE_CANDIDATES_REJECTED",
        subCode,
        error: errorMsg,
      },
      { status: 422 }
    );
  }

  if (message.startsWith("IMPOSSIBLE_ELEVATION:")) {
    const maxElev = parseInt(message.split(":")[1] ?? "0", 10);
    return NextResponse.json<GenerateRouteError>(
      {
        success: false,
        generationId,
        betaOutcome: "refused",
        errorCode: "IMPOSSIBLE_ELEVATION",
        error: `Le D+ demandé n'est pas atteignable depuis ce point. Maximum estimé : ${maxElev}m.`,
        maxElevationEstimate: maxElev,
      },
      { status: 422 }
    );
  }

  // GEOCODING_FAILED
  return NextResponse.json<GenerateRouteError>(
    { success: false, generationId, betaOutcome: "refused", errorCode: "GEOCODING_FAILED", error: "Adresse introuvable. Vérifiez l'orthographe et réessayez." },
    { status: 422 }
  );
}
