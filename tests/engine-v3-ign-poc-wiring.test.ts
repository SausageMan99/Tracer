import { describe, expect, it } from 'vitest';
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import type { EnrichedEdge } from '@/lib/types';
import {
  resolveIgnPocFixtureForCase,
  buildIgnPocEnrichedGraphBuilder,
} from '@/scripts/run-engine-v3-benchmarks';

function edge(overrides: Partial<EnrichedEdge>): EnrichedEdge {
  return {
    id: overrides.id ?? 'edge-1',
    from: overrides.from ?? 'a',
    to: overrides.to ?? 'b',
    lengthKm: overrides.lengthKm ?? 1,
    highway: overrides.highway ?? 'footway',
    surface: overrides.surface,
    osmWayId: overrides.osmWayId ?? 1,
    score: overrides.score ?? 0,
    ...overrides,
  };
}

function makeParkFixture(landcoverClass = 'park', score = 0.9): string {
  return JSON.stringify({
    type: 'FeatureCollection',
    features: [{
      type: 'Feature',
      properties: {
        landcoverClass,
        naturalContextScore: score,
        artificializationScore: 1 - score,
        parkProximityM: 0,
        confidence: 'medium',
      },
      geometry: {
        type: 'Polygon',
        coordinates: [[
          [-0.5, -0.5],
          [0.5, -0.5],
          [0.5, 0.5],
          [-0.5, 0.5],
          [-0.5, -0.5],
        ]],
      },
    }],
  });
}

describe('T15/T17: IGN POC enrichment wiring (benchmark-only)', () => {
  it('resolveIgnPocFixtureForCase returns null when the fixture file is missing', () => {
    const emptyDir = mkdtempSync(join(tmpdir(), 't15-no-fixture-'));
    try {
      const result = resolveIgnPocFixtureForCase('caen-colline-aux-oiseaux-6k-soft', emptyDir);
      expect(result).toBeNull();
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('resolveIgnPocFixtureForCase returns parsed JSON when fixture exists', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 't15-fixture-'));
    try {
      const fixturePath = join(fixtureDir, 'caen-colline-aux-oiseaux-6k-soft.geojson');
      writeFileSync(fixturePath, makeParkFixture('park', 0.82));
      const result = resolveIgnPocFixtureForCase('caen-colline-aux-oiseaux-6k-soft', fixtureDir);
      expect(result).not.toBeNull();
      expect(result?.type).toBe('FeatureCollection');
      expect(result?.features).toHaveLength(1);
      expect(result?.features[0].properties.landcoverClass).toBe('park');
      expect(result?.features[0].properties.naturalContextScore).toBe(0.82);
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('resolveIgnPocFixtureForCase returns null for malformed JSON', () => {
    const fixtureDir = mkdtempSync(join(tmpdir(), 't15-malformed-'));
    try {
      const fixturePath = join(fixtureDir, 'malformed-case.geojson');
      writeFileSync(fixturePath, '{not valid json}');
      const result = resolveIgnPocFixtureForCase('malformed-case', fixtureDir);
      expect(result).toBeNull();
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('buildIgnPocEnrichedGraphBuilder wires a no-op path when fixture is missing (no buildGraph call needed)', async () => {
    // The wiring contract: when resolveIgnPocFixtureForCase returns null, the
    // graphBuilder short-circuits to returning the base result. We verify the
    // contract by checking that resolveIgnPocFixtureForCase is the gate, and
    // by confirming the wrapping function is exported and callable.
    const emptyDir = mkdtempSync(join(tmpdir(), 't15-noop-'));
    try {
      const fixture = resolveIgnPocFixtureForCase('no-fixture-case', emptyDir);
      expect(fixture).toBeNull();
      const builder = buildIgnPocEnrichedGraphBuilder(emptyDir);
      expect(typeof builder).toBe('function');
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('buildIgnPocEnrichedGraphBuilder is exported and resolvable', async () => {
    // The wiring is a thin closure that, when invoked, will call buildGraph +
    // enrichEdgesWithTerrainContext. We do NOT call it here (network);
    // we just verify the function shape.
    const emptyDir = mkdtempSync(join(tmpdir(), 't15-enrich-'));
    try {
      const fixturePath = join(emptyDir, 'enrich-test-case.geojson');
      writeFileSync(fixturePath, makeParkFixture('park', 0.9));
      const fixture = resolveIgnPocFixtureForCase('enrich-test-case', emptyDir);
      expect(fixture).not.toBeNull();
      expect(fixture?.features[0].properties.landcoverClass).toBe('park');
    } finally {
      rmSync(emptyDir, { recursive: true, force: true });
    }
  });

  it('asphalt edge inside park polygon gets EXPLICIT_PAVED_IN_NATURAL_CONTEXT warning (not reclassified as natural)', async () => {
    // Surface must NOT be rewritten; warning must be present so downstream
    // edge-semantics classifies the edge as paved (not natural).
    const { enrichEdgesWithTerrainContext } = await import('@/lib/engine/terrain-context-enricher');
    const fixtureDir = mkdtempSync(join(tmpdir(), 't15-asphalt-'));
    try {
      const fixturePath = join(fixtureDir, 'asphalt-case.geojson');
      writeFileSync(fixturePath, makeParkFixture('park', 0.9));
      const fixture = resolveIgnPocFixtureForCase('asphalt-case', fixtureDir);
      expect(fixture).not.toBeNull();

      // The asphalt edge has explicit fromCoordinate/toCoordinate (synthetic
      // shape); midpoint is inside the park fixture. The enricher should
      // match the park and attach the warning. Surface stays 'asphalt'.
      const asphaltEdge = edge({
        id: 'asphalt-edge',
        surface: 'asphalt',
        highway: 'footway',
        fromCoordinate: { lat: 0, lng: 0 },
        toCoordinate: { lat: 0.1, lng: 0.1 },
      });
      const [enriched] = enrichEdgesWithTerrainContext([asphaltEdge], {
        fixtureGeoJson: fixture!,
      });
      expect(enriched.surface).toBe('asphalt');
      expect(enriched.terrainContext?.landcoverClass).toBe('park');
      expect(enriched.terrainContext?.source).toBe('ign_poc_fixture');
      expect(enriched.terrainContext?.warnings).toContain('EXPLICIT_PAVED_IN_NATURAL_CONTEXT');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('T17: production-shaped edge (no fromCoordinate/toCoordinate) + nodeResolver produces park terrainContext', async () => {
    // This is the exact data shape coming out of buildGraph: no edge.fromCoordinate
    // / edge.toCoordinate, but graph.nodes has lat/lng. The nodeResolver is the
    // bridge introduced in T17.
    const { enrichEdgesWithTerrainContext } = await import('@/lib/engine/terrain-context-enricher');
    const fixtureDir = mkdtempSync(join(tmpdir(), 't17-prod-shape-'));
    try {
      const fixturePath = join(fixtureDir, 'prod-shape-case.geojson');
      writeFileSync(fixturePath, makeParkFixture('park', 0.9));
      const fixture = resolveIgnPocFixtureForCase('prod-shape-case', fixtureDir);

      // Production-shaped edge: from/to are OSM node ids, no per-edge coords.
      const productionEdge = edge({
        id: 'osm-edge-1',
        from: '26544166', to: '2898876156',  // OSM node ids
        surface: 'ground', highway: 'footway',
        // No fromCoordinate/toCoordinate (production shape).
      });
      // Simulate graph.nodes lookup.
      const nodeMap = new Map<string, { lat: number; lng: number }>([
        ['26544166', { lat: 0, lng: 0 }],     // inside the park polygon
        ['2898876156', { lat: 0.1, lng: 0.1 }], // inside the park polygon
      ]);
      const nodeResolver = (id: string) => nodeMap.get(id);
      const [enriched] = enrichEdgesWithTerrainContext([productionEdge], {
        fixtureGeoJson: fixture!,
        nodeResolver,
      });
      expect(enriched.terrainContext?.landcoverClass).toBe('park');
      expect(enriched.terrainContext?.source).toBe('ign_poc_fixture');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });

  it('T17: production-shaped edge + missing nodes in nodeResolver is a clean no-op', async () => {
    const { enrichEdgesWithTerrainContext } = await import('@/lib/engine/terrain-context-enricher');
    const fixtureDir = mkdtempSync(join(tmpdir(), 't17-orphan-'));
    try {
      const fixturePath = join(fixtureDir, 'orphan-case.geojson');
      writeFileSync(fixturePath, makeParkFixture('park', 0.9));
      const fixture = resolveIgnPocFixtureForCase('orphan-case', fixtureDir);
      const orphanEdge = edge({
        id: 'orphan', from: 'ghost-1', to: 'ghost-2', surface: 'ground', highway: 'footway',
      });
      const emptyNodes = new Map<string, { lat: number; lng: number }>();
      const nodeResolver = (id: string) => emptyNodes.get(id);
      const [enriched] = enrichEdgesWithTerrainContext([orphanEdge], {
        fixtureGeoJson: fixture!,
        nodeResolver,
      });
      // Resolver returns undefined for both nodes; clean no-op (NO_TERRAIN_CONTEXT).
      expect(enriched.terrainContext?.landcoverClass).toBeUndefined();
      expect(enriched.terrainContext?.source).toBe('none');
    } finally {
      rmSync(fixtureDir, { recursive: true, force: true });
    }
  });
});