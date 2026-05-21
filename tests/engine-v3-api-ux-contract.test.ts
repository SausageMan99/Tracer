import { describe, expect, it, beforeEach } from "vitest";
import { generateGPXFromV3GeoJson } from "@/lib/gpx-export";
import { buildLineSegmentCollection } from "@/lib/map-route-geojson";
import { routeV3ProductCopy, routeV3WarningCopy } from "@/lib/engine-v3/product-copy";
import { useAppStore } from "@/lib/store";
import type { GenerateRouteV3Response } from "@/lib/types";

const v3RouteGeoJson: GenerateRouteV3Response["routeGeoJson"] = {
  type: "Feature",
  geometry: {
    type: "LineString",
    coordinates: [
      [-0.6021, 49.1771],
      [-0.6044, 49.1782],
      [-0.6079, 49.1801],
    ],
  },
  properties: {
    engine: "v3-clean-room",
    strategy: "urban_nature_loop",
    betaOutcome: "adjusted",
    betaOutcomeLabel: "adjusted_urban_nature",
    productLabel: "adjusted_urban_nature",
  },
};

const v3Response: GenerateRouteV3Response = {
  success: true,
  generationId: "gen_v3_ui",
  engine: "v3-clean-room",
  betaOutcome: "adjusted",
  betaOutcomeLabel: "adjusted_urban_nature",
  productLabel: "adjusted_urban_nature",
  metrics: {
    targetDistanceKm: 6,
    distanceProducedKm: 5.8,
    strictTrailKm: 0,
    explicitNaturalKm: 0,
    explicitPavedKm: 1.2,
    roadLikeUnknownKm: 0,
    pathTrackUnknownKm: 4.6,
    candidateNaturalKm: 2.1,
    trailCandidateKm: 2.1,
    unverifiedTrailCandidateKm: 0,
    trailRatio: 0,
    naturalWayRatio: 0.36,
    pavedRatio: 0.21,
    pavedKm: 1.2,
    nonPavedKm: 4.6,
    naturalDwellKm: 2.1,
    repeatEdgeKm: 0,
    targetRepeatKm: 0,
    connectorRepeatKm: 0,
    visitedComponents: ["field_paths"],
    repeatRatio: 0,
    overlapRatio: 0,
    busyRoadRatio: 0,
    loopClosureKm: 0,
    longestTrailSegmentKm: 0,
  },
  reason: "Urban nature route uses park/canal/corridor evidence without inventing trail terrain.",
  warnings: ["urban_nature_loop may use paved park/canal/corridor paths", "Paved/asphalt evidence remains paved"],
  userWarnings: ["Nature urbaine: parcs/canaux/corridors verts, séparés du trail strict."],
  routeGeoJson: v3RouteGeoJson,
  gpxAvailable: true,
};

describe("V3 API/UX route contract", () => {
  beforeEach(() => {
    useAppStore.getState().reset();
  });

  it("stores a top-level V3 response without calling setSuccess(undefined)", () => {
    useAppStore.getState().setSuccessV3(v3Response);
    const state = useAppStore.getState();

    expect(state.status).toBe("success");
    expect(state.currentRoute).toBeNull();
    expect(state.currentRouteV3).toEqual(v3Response);
    expect(state.generationId).toBe("gen_v3_ui");
    expect(state.betaOutcome).toBe("adjusted");
  });

  it("builds renderable map segments from V3 routeGeoJson without reordering coordinates", () => {
    const collection = buildLineSegmentCollection(v3RouteGeoJson.geometry.coordinates);
    const reconstructed = collection.features.reduce<number[][]>((coords, feature, index) => {
      const line = feature.geometry as GeoJSON.LineString;
      if (index === 0) coords.push(line.coordinates[0]);
      coords.push(line.coordinates[1]);
      return coords;
    }, []);

    expect(collection.features).toHaveLength(v3RouteGeoJson.geometry.coordinates.length - 1);
    expect(reconstructed).toEqual(v3RouteGeoJson.geometry.coordinates);
  });

  it("exports V3 GPX from the same GeoJSON coordinates used by the map", () => {
    const gpx = generateGPXFromV3GeoJson(v3RouteGeoJson, {
      name: "V3 nature urbaine",
      sport: "running",
      distanceKm: 5.8,
    });

    const gpxCoordinates = Array.from(gpx.matchAll(/<trkpt lat="([^"]+)" lon="([^"]+)">/g)).map((match) => [
      Number(match[2]),
      Number(match[1]),
    ]);

    expect(gpxCoordinates).toEqual(v3RouteGeoJson.geometry.coordinates);
  });

  it("renders honest French copy for adjusted urban nature and refusals", () => {
    expect(routeV3ProductCopy("adjusted_urban_nature").title).toBe("Nature urbaine ajustée");
    expect(routeV3ProductCopy("adjusted_urban_nature").subtitle).toContain("sans maquiller le bitume");
    expect(routeV3ProductCopy("refused_topology", "topologie insuffisante")).toMatchObject({
      title: "Refus honnête V3",
      subtitle: "topologie insuffisante",
      tone: "refused",
    });
    expect(routeV3WarningCopy("Paved/asphalt evidence remains paved")).toContain("restent comptées comme pavées");
  });
});
