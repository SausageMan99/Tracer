import { NextRequest, NextResponse } from "next/server";
import { inspectTerrainIntentV3Api } from "@/lib/engine-v3/api-adapter";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import type { GenerateRouteError, GenerateRouteRequest, RouteRequest } from "@/lib/types";

function createTerrainIntentId(): string {
  if (typeof crypto !== "undefined" && typeof crypto.randomUUID === "function") {
    return `terrain_${crypto.randomUUID()}`;
  }
  return `terrain_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

export async function POST(req: NextRequest) {
  const generationId = createTerrainIntentId();
  let body: Partial<GenerateRouteRequest>;

  try {
    body = await req.json();
  } catch {
    return validationError(generationId, "Corps de requête invalide.");
  }

  if (
    !body.address?.trim() ||
    !body.profileId ||
    typeof body.targetDistanceKm !== "number" ||
    typeof body.targetElevationM !== "number"
  ) {
    return validationError(generationId, "Paramètres manquants ou invalides.");
  }

  const profile = PROFILES_BY_ID.get(body.profileId);
  if (!profile) {
    return validationError(generationId, "Profil de séance inconnu.");
  }

  if (
    !Number.isFinite(body.targetDistanceKm) ||
    body.targetDistanceKm < profile.distanceRange.min ||
    body.targetDistanceKm > profile.distanceRange.max
  ) {
    return validationError(generationId, `Distance hors limites (${profile.distanceRange.min}–${profile.distanceRange.max} km).`);
  }

  if (
    !Number.isFinite(body.targetElevationM) ||
    body.targetElevationM < profile.elevationRange.min ||
    body.targetElevationM > profile.elevationRange.max
  ) {
    return validationError(generationId, `Dénivelé hors limites (${profile.elevationRange.min}–${profile.elevationRange.max} m).`);
  }

  const routeRequest: RouteRequest = {
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
    const terrainIntent = await inspectTerrainIntentV3Api(routeRequest);
    return NextResponse.json({
      success: true,
      generationId,
      ...terrainIntent,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "";
    if (message === "GEOCODING_FAILED") {
      return NextResponse.json<GenerateRouteError>(
        { success: false, generationId, betaOutcome: "refused", errorCode: "GEOCODING_FAILED", error: "Adresse introuvable. Vérifiez l'orthographe et réessayez." },
        { status: 422 }
      );
    }

    console.error("[terrain-intent] Unexpected error:", err);
    return NextResponse.json<GenerateRouteError>(
      { success: false, generationId, betaOutcome: "refused", errorCode: "UNKNOWN", error: "Erreur inattendue. Réessayez dans un instant." },
      { status: 500 }
    );
  }
}

function validationError(generationId: string, error: string): NextResponse<GenerateRouteError> {
  return NextResponse.json<GenerateRouteError>(
    { success: false, generationId, betaOutcome: "refused", errorCode: "UNKNOWN", error },
    { status: 400 }
  );
}
