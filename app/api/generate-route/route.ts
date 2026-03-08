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
 * - 500 unexpected error
 *
 * All errors return a `GenerateRouteError` JSON body with `success: false`,
 * a human-readable French `error` message, and a machine-readable `errorCode`.
 */
import { NextRequest, NextResponse } from "next/server";
import { generateRouteV2 } from "@/lib/engine";
import { generateRoute } from "@/lib/route-generator-legacy";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import type { GenerateRouteRequest, GenerateRouteError } from "@/lib/types";

export async function POST(req: NextRequest) {
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

  if (!PROFILES_BY_ID.has(body.profileId)) {
    return NextResponse.json<GenerateRouteError>(
      { success: false, error: "Profil de séance inconnu.", errorCode: "UNKNOWN" },
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
    scenicMode: (body as Record<string, unknown>).scenicMode === true ? true : undefined,
  };

  try {
    let route;

    // V2 is loops-only — use legacy for waypoints/endAddress
    const hasWaypoints =
      (routeRequest.waypoints?.length ?? 0) > 0 || !!routeRequest.endAddress;

    if (hasWaypoints) {
      route = await generateRoute(routeRequest);
    } else {
      try {
        route = await generateRouteV2(routeRequest);
      } catch (v2Err) {
        console.warn(
          "[generate-route] V2 engine failed, falling back to legacy:",
          v2Err instanceof Error ? v2Err.message : v2Err
        );
        route = await generateRoute(routeRequest);
      }
    }

    return NextResponse.json({ success: true, route });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";

    if (message.startsWith("NO_ROAD_NETWORK")) {
      const subCode = message.split(":")[1] ?? "";
      let errorMsg: string;
      switch (subCode) {
        case "OVERPASS_TIMEOUT":
          errorMsg = "Serveur cartographique indisponible. Réessayez dans 30s.";
          break;
        case "EMPTY_GRAPH":
          errorMsg = "Aucune route trouvée. Essayez un point de départ plus urbain ou une distance plus courte.";
          break;
        case "SOLVER_EMPTY":
          errorMsg = "Impossible de construire un parcours en boucle. Essayez une distance différente.";
          break;
        default:
          errorMsg = "Aucun réseau routier détecté à cet endroit. Essayez un autre point de départ.";
      }
      return NextResponse.json<GenerateRouteError>(
        {
          success: false,
          errorCode: "NO_ROAD_NETWORK",
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
          errorCode: "IMPOSSIBLE_ELEVATION",
          error: `Le D+ demandé n'est pas atteignable depuis ce point. Maximum estimé : ${maxElev}m.`,
          maxElevationEstimate: maxElev,
        },
        { status: 422 }
      );
    }

    if (message === "GEOCODING_FAILED") {
      return NextResponse.json<GenerateRouteError>(
        {
          success: false,
          errorCode: "GEOCODING_FAILED",
          error: "Adresse introuvable. Vérifiez l'orthographe et réessayez.",
        },
        { status: 422 }
      );
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
