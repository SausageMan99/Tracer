import { describe, expect, it } from "vitest";
import {
  routeToEdgeDiagnosticsArtifact,
  routeToGeoJson,
  summarizeEdgeDiagnostics,
} from "../lib/route-benchmark-artifacts.mjs";

const benchmark = {
  id: "tourville-pommiers-trail-10k",
  label: "Tourville-sur-Odon 10 km — Baron sans overlap",
  address: "7 Rue des Pommiers, 14210 Tourville-sur-Odon",
  profileId: "running_trail",
  targetDistanceKm: 10,
  targetElevationM: 120,
  scenicMode: true,
};

const edgeA = {
  index: 0,
  edgeId: "edge-a",
  edgeKey: "node-a-node-b-101",
  osmWayId: 101,
  fromNodeId: "node-a",
  toNodeId: "node-b",
  from: { lat: 49.12, lng: -0.47 },
  to: { lat: 49.121, lng: -0.471 },
  highway: "path",
  surface: "dirt",
  access: null,
  foot: "yes",
  bicycle: null,
  oneway: null,
  lengthKm: 0.4,
  score: 0.91,
  scoreReason: "trail surface boost",
  name: "Chemin du bois",
  ref: null,
  componentId: "component-woods",
  flags: {
    trail: true,
    paved: false,
    natural: true,
    scenic: true,
    busy: false,
    restricted: false,
    onewayViolation: false,
  },
  repeatCount: 2,
  repeated: true,
};

const edgeB = {
  index: 1,
  edgeId: "edge-b",
  edgeKey: "node-b-node-c-102",
  osmWayId: 102,
  fromNodeId: "node-b",
  toNodeId: "node-c",
  from: { lat: 49.121, lng: -0.471 },
  to: { lat: 49.122, lng: -0.472 },
  highway: "residential",
  surface: "asphalt",
  access: null,
  foot: null,
  bicycle: null,
  oneway: null,
  lengthKm: 0.25,
  score: 0.48,
  scoreReason: "paved connector",
  name: null,
  ref: null,
  componentId: null,
  flags: {
    trail: false,
    paved: true,
    natural: false,
    scenic: false,
    busy: false,
    restricted: false,
    onewayViolation: false,
  },
  repeatCount: 1,
  repeated: false,
};

const edgeARepeat = {
  ...edgeA,
  index: 2,
  edgeId: "edge-a-reverse",
  fromNodeId: "node-b",
  toNodeId: "node-a",
};

describe("route benchmark edge artifacts", () => {
  it("summarizes edge diagnostics with P1-1 audit fields and repeat metrics", () => {
    const summary = summarizeEdgeDiagnostics({ edgeDiagnostics: [edgeA, edgeB, edgeARepeat] });

    expect(summary.edgeCount).toBe(3);
    expect(summary.totalKm).toBe(1.05);
    expect(summary.trailKm).toBe(0.8);
    expect(summary.pavedKm).toBe(0.25);
    expect(summary.naturalKm).toBe(0.8);
    expect(summary.scenicKm).toBe(0.8);
    expect(summary.busyKm).toBe(0);
    expect(summary.repeatedTraversalKm).toBe(0.8);
    expect(summary.repeatedExtraKm).toBe(0.4);
    expect(summary.diagnosticsAvailable).toBe(true);
    expect(summary.missingFields).toEqual([]);
    expect(summary.availableFields).toEqual(expect.arrayContaining([
      "edgeId",
      "osmWayId",
      "highway",
      "surface",
      "lengthKm",
      "score",
      "scoreReason",
      "componentId",
      "flags.trail",
      "flags.paved",
      "flags.natural",
      "flags.scenic",
      "flags.busy",
      "repeatCount",
      "repeated",
    ]));
  });

  it("marks missing edge diagnostics explicitly instead of pretending the artifact is complete", () => {
    const summary = summarizeEdgeDiagnostics({});

    expect(summary.diagnosticsAvailable).toBe(false);
    expect(summary.edgeCount).toBe(0);
    expect(summary.missingFields).toEqual(expect.arrayContaining(["edgeDiagnostics"]));
  });

  it("exports benchmark, route intent, candidate summaries, and raw edges", () => {
    const artifact = routeToEdgeDiagnosticsArtifact(benchmark, {
      routeIntent: {
        type: "loop",
        strategy: "transition_to_woods",
        targetComponents: ["component-woods"],
        minNaturalZoneDwellKm: 2.5,
        minNonPavedTrailStreakKm: 1.2,
        maxPavedRatio: 0.58,
        maxBusyRoadRatio: 0.08,
        maxRepeatEdgeRatio: 0.04,
        cleanReturnMode: "prefer",
        timeBudgetMs: 70000,
        beamBudget: 48,
        terrainComponents: [{
          id: "component-woods",
          kind: "forest",
          center: { lat: 49.13, lng: -0.48 },
          totalKm: 4.2,
          nonPavedKm: 3.1,
          pavedKm: 0.6,
          unknownSurfaceKm: 0.5,
          distanceFromStartKm: 1.1,
          entryNodeIds: ["node-a", "node-b"],
        }],
      },
      candidates: [{
        distanceKm: 9.87,
        ascendM: 92,
        totalScore: 0.77,
        quality: { productionScore: 0.74, pavedRatio: 0.42, warnings: [] },
        edgeDiagnostics: [edgeA, edgeB],
      }],
    });

    expect(artifact).not.toBeNull();
    expect(artifact?.benchmark).toMatchObject({
      id: benchmark.id,
      label: benchmark.label,
      profileId: benchmark.profileId,
      scenicMode: true,
    });
    expect(artifact?.routeIntent).toMatchObject({
      strategy: "transition_to_woods",
      targetComponents: ["component-woods"],
      terrainComponents: [{ id: "component-woods", entryNodeCount: 2 }],
    });
    expect(artifact?.candidates[0]).toMatchObject({
      candidateIndex: 0,
      isBest: true,
      distanceKm: 9.87,
      ascendM: 92,
      totalScore: 0.77,
    });
    expect(artifact?.candidates[0].summary.edgeCount).toBe(2);
    expect(artifact?.candidates[0].edgeSummary.edgeCount).toBe(2);
    expect(artifact?.candidates[0].edges).toEqual([edgeA, edgeB]);
  });

  it("does not create an edge artifact when the route has no candidates", () => {
    expect(routeToEdgeDiagnosticsArtifact(benchmark, { candidates: [] })).toBeNull();
    expect(routeToEdgeDiagnosticsArtifact(benchmark, {})).toBeNull();
  });

  it("keeps the best-route GeoJSON artifact stable", () => {
    const geoJson = routeToGeoJson(benchmark, {
      best: {
        distanceKm: 10.1,
        ascendM: 96,
        quality: {
          productionScore: 0.82,
          repeatEdgeRatio: 0.01,
          uTurnRatio: 0,
          busyRoadRatio: 0.03,
          naturalWayRatio: 0.51,
        },
        geometry: {
          type: "LineString",
          coordinates: [[-0.47, 49.12], [-0.471, 49.121]],
        },
      },
    });

    expect(geoJson).toEqual({
      type: "FeatureCollection",
      features: [{
        type: "Feature",
        properties: expect.objectContaining({
          benchmarkId: benchmark.id,
          label: benchmark.label,
          targetDistanceKm: 10,
          targetElevationM: 120,
          profileId: "running_trail",
          distanceKm: 10.1,
          ascendM: 96,
          productionScore: 0.82,
          repeatEdgeRatio: 0.01,
          uTurnRatio: 0,
          busyRoadRatio: 0.03,
          naturalWayRatio: 0.51,
        }),
        geometry: {
          type: "LineString",
          coordinates: [[-0.47, 49.12], [-0.471, 49.121]],
        },
      }],
    });
  });
});
