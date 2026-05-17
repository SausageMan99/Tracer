import { describe, expect, it } from "vitest";
import {
  routeToEdgeDiagnosticsArtifact,
  routeToEdgesGeoJson,
  routeToGeoJson,
  routeToOpportunityCaptureArtifact,
  routeToOpportunityCaptureMetrics,
  routeToTerrainOpportunityReport,
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
    expect(summary.trailRatio).toBeCloseTo(0.8 / 1.05);
    expect(summary.rawTrailRatio).toBeCloseTo(0.8 / 1.05);
    expect(summary.naturalWayRatio).toBeCloseTo(0.8 / 1.05);
    expect(summary.rawNaturalRatio).toBeCloseTo(0.8 / 1.05);
    expect(summary.pavedRatio).toBeCloseTo(0.25 / 1.05);
    expect(summary.rawPavedRatio).toBeCloseTo(0.25 / 1.05);
    expect(summary.scenicPavedRatio).toBe(0);
    expect(summary.rawFlagSemantics).toContain("raw OSM/post-processor");
    expect(summary.busyKm).toBe(0);
    expect(summary.repeatedTraversalKm).toBe(0.8);
    expect(summary.repeatedExtraKm).toBe(0.4);
    expect(summary.worstSegments.paved).toEqual([
      expect.objectContaining({
        edgeId: "edge-b",
        highway: "residential",
        surface: "asphalt",
        lengthKm: 0.25,
        reason: "paved",
      }),
    ]);
    expect(summary.worstSegments.repeated).toEqual([
      expect.objectContaining({
        edgeId: "edge-a",
        lengthKm: 0.4,
        repeatCount: 2,
        reason: "repeated",
      }),
      expect.objectContaining({
        edgeId: "edge-a-reverse",
        lengthKm: 0.4,
        repeatCount: 2,
        reason: "repeated",
      }),
    ]);
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
    const stageTimings = {
      totalMs: 123,
      stages: [{ stage: "solver.solve", durationMs: 30, ok: true }],
    };
    const diagnostics = {
      version: 1,
      strategy: "v2-local-graph",
      graph: { nodeCount: 10, edgeCount: 20, scenicWayCount: 3 },
      solver: { pathCount: 4, candidateCount: 1, bestTotalScore: 0.77, warnings: [] },
    };
    const artifact = routeToEdgeDiagnosticsArtifact(benchmark, {
      stageTimings,
      diagnostics,
      routeIntent: {
        type: "loop",
        strategy: "transition_to_woods",
        targetComponents: ["component-woods"],
        distancePolicy: { mode: "strict" },
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
        quality: {
          productionScore: 0.74,
          trailRatio: 0.25,
          naturalWayRatio: 0.68,
          pavedRatio: 0.42,
          scenicPavedRatio: 0.2,
          naturalZoneDwellKm: 2.1,
          longestNonPavedTrailStreakKm: 1.4,
          targetComponentDwellKm: 1.7,
          visitedTargetComponents: ["component-woods"],
          warnings: [],
        },
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
      distancePolicy: { mode: "strict" },
      terrainComponents: [{ id: "component-woods", entryNodeCount: 2 }],
    });
    expect(artifact?.stageTimings).toEqual(stageTimings);
    expect(artifact?.diagnostics).toEqual(diagnostics);
    expect(artifact?.candidates[0]).toMatchObject({
      candidateIndex: 0,
      isBest: true,
      distanceKm: 9.87,
      ascendM: 92,
      totalScore: 0.77,
    });
    expect(artifact?.candidates[0].summary.edgeCount).toBe(2);
    expect(artifact?.candidates[0].productSurfaceSummary).toMatchObject({
      trailRatio: 0.25,
      naturalWayRatio: 0.68,
      pavedRatio: 0.42,
      scenicPavedRatio: 0.2,
      trailKm: 2.4675,
      naturalWayKm: 6.7116,
      pavedKm: 4.1454,
      scenicPavedKm: 1.974,
    });
    expect(artifact?.candidates[0].rawFlagSummary.rawTrailRatio).toBeCloseTo(0.4 / 0.65);
    expect(artifact?.candidates[0].rawFlagSummary.rawPavedRatio).toBeCloseTo(0.25 / 0.65);
    expect(artifact?.candidates[0].edgeSummary.edgeCount).toBe(2);
    expect(artifact?.candidates[0].worstSegments).toMatchObject({
      paved: [{ edgeId: "edge-b", lengthKm: 0.25, reason: "paved" }],
      repeated: [{ edgeId: "edge-a", lengthKm: 0.4, reason: "repeated" }],
    });
    expect(artifact?.candidates[0].edges).toEqual([edgeA, edgeB]);
  });

  it("exports edge-level GeoJSON for map inspection without changing raw edge flags", () => {
    const geoJson = routeToEdgesGeoJson(benchmark, {
      candidates: [{
        distanceKm: 9.87,
        edgeDiagnostics: [edgeA, edgeB],
      }],
    });

    expect(geoJson).toEqual({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: expect.objectContaining({
            benchmarkId: benchmark.id,
            candidateIndex: 0,
            isBest: true,
            edgeIndex: 0,
            edgeId: "edge-a",
            osmWayId: 101,
            highway: "path",
            surface: "dirt",
            lengthKm: 0.4,
            paved: false,
            trail: true,
            repeated: true,
            repeatCount: 2,
          }),
          geometry: {
            type: "LineString",
            coordinates: [[-0.47, 49.12], [-0.471, 49.121]],
          },
        },
        {
          type: "Feature",
          properties: expect.objectContaining({
            candidateIndex: 0,
            edgeIndex: 1,
            edgeId: "edge-b",
            surface: "asphalt",
            paved: true,
            trail: false,
            repeated: false,
          }),
          geometry: {
            type: "LineString",
            coordinates: [[-0.471, 49.121], [-0.472, 49.122]],
          },
        },
      ],
    });
  });

  it("filters invalid edge-level GeoJSON coordinates instead of emitting broken features", () => {
    expect(routeToEdgesGeoJson(benchmark, { candidates: [] })).toBeNull();
    expect(routeToEdgesGeoJson(benchmark, { candidates: [{ edgeDiagnostics: [] }] })).toBeNull();

    const invalidEdge = {
      ...edgeA,
      edgeId: "edge-invalid",
      from: { lat: Number.NaN, lng: -0.47 },
    };

    expect(routeToEdgesGeoJson(benchmark, {
      candidates: [{ edgeDiagnostics: [invalidEdge] }],
    })).toBeNull();
  });

  it("keeps raw edge flags separate from product surface quality ratios", () => {
    const pavedTrailEdge = {
      ...edgeA,
      edgeId: "edge-paved-trail",
      edgeKey: "node-x-node-y-103",
      osmWayId: 103,
      highway: "path",
      surface: "asphalt",
      lengthKm: 1,
      flags: {
        ...edgeA.flags,
        trail: true,
        paved: true,
        natural: true,
        scenic: true,
      },
      repeatCount: 1,
      repeated: false,
    };

    const artifact = routeToEdgeDiagnosticsArtifact(benchmark, {
      candidates: [{
        distanceKm: 1,
        quality: {
          trailRatio: 0,
          naturalWayRatio: 1,
          pavedRatio: 1,
          scenicPavedRatio: 1,
        },
        edgeDiagnostics: [pavedTrailEdge],
      }],
    });

    const candidate = artifact?.candidates[0];
    expect(candidate?.productSurfaceSummary).toMatchObject({
      trailRatio: 0,
      naturalWayRatio: 1,
      pavedRatio: 1,
      scenicPavedRatio: 1,
    });
    expect(candidate?.rawFlagSummary).toMatchObject({
      rawTrailRatio: 1,
      rawNaturalRatio: 1,
      rawPavedRatio: 1,
      rawScenicPavedRatio: 1,
    });
    expect(candidate?.rawFlagSummary.rawFlagSemantics).toContain("productSurfaceSummary");
    expect(candidate?.productSurfaceSummary.trailRatio).not.toBe(candidate?.rawFlagSummary.rawTrailRatio);
  });

  it("does not create an edge artifact when the route has no candidates", () => {
    expect(routeToEdgeDiagnosticsArtifact(benchmark, { candidates: [] })).toBeNull();
    expect(routeToEdgeDiagnosticsArtifact(benchmark, {})).toBeNull();
  });

  it("exports a TerrainOpportunityReport from route intent without scoring side effects", () => {
    const report = routeToTerrainOpportunityReport(benchmark, {
      diagnostics: { graph: { nodeCount: 12, edgeCount: 24, totalEdgeKm: 6.8 } },
      routeIntent: {
        type: "transition_to_woods",
        strategy: "transition_to_woods",
        targetDistanceKm: 10,
        targetElevationM: 120,
        targetComponents: ["component-woods"],
        distancePolicy: { mode: "strict" },
        cleanReturnMode: "prefer",
        terrainComponents: [{
          id: "component-woods",
          kind: "forest",
          center: { lat: 49.13, lng: -0.48 },
          totalKm: 4.2,
          nonPavedKm: 3.1,
          pavedKm: 0.6,
          unknownSurfaceKm: 0.5,
          distanceFromStartKm: 1.1,
          confidence: "high",
          entryNodeIds: ["node-a", "node-b"],
          exitNodeIds: ["node-c"],
        }, {
          id: "component-road-scenic",
          kind: "scenic_paved",
          center: { lat: 49.12, lng: -0.47 },
          totalKm: 1.8,
          nonPavedKm: 0.1,
          pavedKm: 1.6,
          unknownSurfaceKm: 0.1,
          distanceFromStartKm: 0.2,
          confidence: "medium",
          entryNodeIds: [],
          exitNodeIds: [],
        }],
      },
    });

    expect(report).toMatchObject({
      schemaVersion: 1,
      observationOnly: true,
      scoringBehaviorChanged: false,
      caseId: benchmark.id,
      request: {
        address: benchmark.address,
        targetDistanceKm: 10,
        targetElevationM: 120,
        mode: "trail",
        profileId: "running_trail",
      },
      graph: {
        totalEdgeKm: 6.8,
        usableEdgeKm: 6,
        connectedComponentKm: 4.2,
        nodeCount: 12,
        edgeCount: 24,
        confidence: "medium",
        warnings: [],
      },
      strategy: {
        routeIntentType: "transition_to_woods",
        routeStrategy: "transition_to_woods",
        targetComponents: ["component-woods"],
        distancePolicy: { mode: "strict" },
        cleanReturnMode: "prefer",
      },
      components: [
        expect.objectContaining({
          id: "component-woods",
          kind: "forest",
          totalLengthKm: 4.2,
          pavedRatio: 0.14286,
          nonPavedRatio: 0.7381,
          surfaceConfidence: "high",
          estimatedDwellCapacityKm: 3.275,
          connectorCostKm: 1.1,
          entryNodeCount: 2,
          exitNodeCount: 1,
        }),
        expect.objectContaining({
          id: "component-road-scenic",
          kind: "scenic_paved",
          nonPavedRatio: 0.05556,
        }),
      ],
      bestAvailable: {
        maxNaturalDwellKm: 3.275,
        maxContinuousNaturalKm: 3.1,
        maxNonPavedRatioEstimate: 0.53333,
        minConnectorKmToUsefulTerrain: 1.1,
        realisticOutcome: "generated",
      },
    });
    expect(report?.bestAvailable.reason).toContain("road connectors");
  });


  it("computes P2 opportunity-capture metrics from TerrainOpportunityReport and route artifacts", () => {
    const route = {
      routeIntent: {
        type: "transition_to_woods",
        strategy: "transition_to_woods",
        targetDistanceKm: 10,
        targetComponents: ["component-woods"],
        distancePolicy: { mode: "strict" },
        terrainComponents: [{
          id: "component-woods",
          kind: "forest",
          totalKm: 4.2,
          nonPavedKm: 3.1,
          pavedKm: 0.6,
          unknownSurfaceKm: 0.5,
          distanceFromStartKm: 1.1,
          confidence: "high",
          entryNodeIds: ["node-a"],
        }, {
          id: "component-better-ignored",
          kind: "forest",
          totalKm: 6,
          nonPavedKm: 5,
          pavedKm: 0.2,
          unknownSurfaceKm: 0,
          distanceFromStartKm: 1.8,
          confidence: "high",
          entryNodeIds: ["node-z"],
        }],
      },
      candidates: [{
        distanceKm: 9.8,
        quality: {
          naturalZoneDwellKm: 2.45,
          longestNonPavedTrailStreakKm: 1.55,
          targetComponentDwellKm: 1.7,
          pavedRatio: 0.41,
          trailRatio: 0.2,
          visitedTargetComponents: ["component-woods"],
        },
        edgeDiagnostics: [edgeA, edgeB],
      }],
    };

    const metrics = routeToOpportunityCaptureMetrics(benchmark, route);

    expect(metrics).toMatchObject({
      schemaVersion: 1,
      observationOnly: true,
      scoringBehaviorChanged: false,
      caseId: benchmark.id,
      naturalDwellCaptureRatio: 0.74809,
      continuousNaturalCaptureRatio: 0.5,
      targetComponentCaptureRatio: 0.51908,
      avoidablePavementKm: 1.818,
      missedBetterComponentCount: 1,
      promiseHonestyScore: 1,
    });
    expect(metrics?.connectorEfficiencyRatio).toBeCloseTo(2.2 / 4.018, 5);
    expect(metrics?.opportunityCaptureScore).toBeGreaterThan(0.4);
    expect(metrics?.inputs).toMatchObject({
      feasibleNaturalDwellKm: 3.275,
      feasibleTargetDwellKm: 3.275,
      actualConnectorKm: 4.018,
      necessaryConnectorBudgetKm: 2.2,
      realisticOutcome: "generated",
      actualOutcome: "route_success",
    });

    const artifact = routeToOpportunityCaptureArtifact(benchmark, route);
    expect(artifact?.terrainOpportunityReport?.bestAvailable.maxNaturalDwellKm).toBe(3.275);
    expect(artifact?.opportunityCaptureMetrics).toEqual(metrics);
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
          trailRatio: 0.23,
          naturalWayRatio: 0.51,
          pavedRatio: 0.42,
          scenicPavedRatio: 0.18,
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
          trailRatio: 0.23,
          naturalWayRatio: 0.51,
          pavedRatio: 0.42,
          scenicPavedRatio: 0.18,
        }),
        geometry: {
          type: "LineString",
          coordinates: [[-0.47, 49.12], [-0.471, 49.121]],
        },
      }],
    });
  });
});
