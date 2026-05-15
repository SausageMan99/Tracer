import { describe, expect, it } from "vitest";
import { buildRouteLineFeature, buildSegmentCollection } from "@/lib/map-route-geojson";
import type { RouteCandidate, RoutePoint } from "@/lib/types";

function candidateWithDifferentDisplayGeometry(): RouteCandidate {
  return {
    points: [
      { lat: 49.18, lng: -0.62, elevation: 10 },
      { lat: 49.19, lng: -0.61, elevation: 20 },
      { lat: 49.2, lng: -0.6, elevation: 15 },
    ],
    distanceKm: 3,
    durationSeconds: 1200,
    ascendM: 10,
    descendM: 5,
    surfaceScore: 0.8,
    loopScore: 0.9,
    totalScore: 0.85,
    geometry: {
      type: "LineString",
      coordinates: [
        [-0.62, 49.18],
        [-0.621, 49.181],
        [-0.615, 49.186],
        [-0.61, 49.19],
        [-0.605, 49.195],
        [-0.6, 49.2],
      ],
    },
  };
}

describe("buildSegmentCollection", () => {
  it("draws slope-coloured segments on the same geometry as the map base route", () => {
    const candidate = candidateWithDifferentDisplayGeometry();

    const collection = buildSegmentCollection(candidate);

    expect(collection.features).toHaveLength(candidate.geometry.coordinates.length - 1);

    const reconstructedCoordinates = collection.features.reduce<[number, number][]>((coords, feature, index) => {
      const line = feature.geometry as GeoJSON.LineString;
      if (index === 0) coords.push(line.coordinates[0] as [number, number]);
      coords.push(line.coordinates[1] as [number, number]);
      return coords;
    }, []);

    expect(reconstructedCoordinates).toEqual(candidate.geometry.coordinates);
    expect(collection.features).not.toHaveLength(candidate.points.length - 1);
    expect(collection.features[0].geometry).toEqual({
      type: "LineString",
      coordinates: [candidate.geometry.coordinates[0], candidate.geometry.coordinates[1]],
    });
    expect(collection.features.at(-1)?.geometry).toEqual({
      type: "LineString",
      coordinates: [
        candidate.geometry.coordinates.at(-2),
        candidate.geometry.coordinates.at(-1),
      ],
    });
  });
});

describe("buildRouteLineFeature", () => {
  it("builds the map route GeoJSON from the provided polyline without reordering coordinates", () => {
    const polyline: RoutePoint[] = [
      { lat: 49.1771, lng: -0.6021, elevation: 42 },
      { lat: 49.1782, lng: -0.6044, elevation: 47 },
      { lat: 49.1801, lng: -0.6079, elevation: 55 },
      { lat: 49.1826, lng: -0.6102, elevation: 61 },
    ];

    const feature = buildRouteLineFeature(polyline, {
      id: "v3-display-source",
      name: "V3 display source",
      distanceKm: 1.2,
    });

    expect(feature.geometry).toEqual({
      type: "LineString",
      coordinates: polyline.map((point) => [point.lng, point.lat]),
    });
    expect(feature.properties).toMatchObject({
      id: "v3-display-source",
      name: "V3 display source",
      distanceKm: 1.2,
      pointCount: polyline.length,
    });
  });
});
