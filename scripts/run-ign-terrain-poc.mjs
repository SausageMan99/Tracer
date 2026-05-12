#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeIgnPocArtifact } from '../lib/ign-poc-artifacts.mjs';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const EXPLICIT_PAVED_SURFACES = new Set(['asphalt', 'concrete', 'paved', 'sett', 'paving_stones']);

function isExplicitPaved(edge) {
  return EXPLICIT_PAVED_SURFACES.has((edge.surface ?? '').trim().toLowerCase());
}

function midpoint(edge) {
  const from = edge.fromCoordinate;
  const to = edge.toCoordinate;
  if (from == null || to == null) return null;
  return { lat: (from.lat + to.lat) / 2, lng: (from.lng + to.lng) / 2 };
}

function pointInRing(point, ring) {
  let inside = false;
  const x = point.lng;
  const y = point.lat;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0];
    const yi = ring[i][1];
    const xj = ring[j][0];
    const yj = ring[j][1];
    const intersects = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (intersects) inside = !inside;
  }
  return inside;
}

function pointInPolygon(point, polygon) {
  const [outer, ...holes] = polygon;
  if (outer == null || !pointInRing(point, outer)) return false;
  return !holes.some((hole) => pointInRing(point, hole));
}

function findFeature(point, fixtureGeoJson) {
  if (point == null || fixtureGeoJson == null) return null;
  return fixtureGeoJson.features?.find((feature) => pointInPolygon(point, feature.geometry?.coordinates ?? [])) ?? null;
}

function contextFromFeature(edge, feature) {
  if (feature == null) {
    return { source: 'none', naturalContextScore: 0, artificializationScore: 0, confidence: 'low', warnings: [] };
  }
  const naturalContextScore = feature.properties?.naturalContextScore ?? 0;
  const warnings = [...(feature.properties?.warnings ?? [])];
  if (isExplicitPaved(edge) && naturalContextScore >= 0.7 && !warnings.includes('EXPLICIT_PAVED_IN_NATURAL_CONTEXT')) {
    warnings.push('EXPLICIT_PAVED_IN_NATURAL_CONTEXT');
  }
  return {
    source: 'ign_poc_fixture',
    landcoverClass: feature.properties?.landcoverClass ?? 'unknown',
    naturalContextScore,
    artificializationScore: feature.properties?.artificializationScore ?? 0,
    forestProximityM: feature.properties?.forestProximityM,
    parkProximityM: feature.properties?.parkProximityM,
    waterProximityM: feature.properties?.waterProximityM,
    slopeMeanPct: feature.properties?.slopeMeanPct,
    slopeMaxPct: feature.properties?.slopeMaxPct,
    ignPathProximityM: feature.properties?.ignPathProximityM,
    confidence: feature.properties?.confidence ?? 'low',
    warnings,
  };
}

function enrichEdgesWithTerrainContext(edges, fixtureGeoJson) {
  return edges.map((edge) => ({
    ...edge,
    terrainContext: contextFromFeature(edge, findFeature(midpoint(edge), fixtureGeoJson)),
  }));
}

function parseArgs(argv) {
  const options = {
    artifactDir: 'artifacts/route-benchmark-results/ign-poc',
    searchRoot: 'artifacts/route-benchmark-results',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--case') options.caseId = argv[++i];
    else if (arg === '--fixture') options.fixture = argv[++i];
    else if (arg === '--artifact-dir') options.artifactDir = argv[++i];
    else if (arg === '--edge-artifact') options.edgeArtifact = argv[++i];
    else if (arg === '--search-root') options.searchRoot = argv[++i];
    else if (arg === '--help') options.help = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }
  return options;
}

function printHelp() {
  console.log(`Usage: npm run ign:poc -- --case <case-id> --fixture fixtures/ign-poc/<zone>.geojson [--artifact-dir <dir>] [--edge-artifact <path>]\n\nOffline artifact-only IGN terrain context POC. Reads existing benchmark edge diagnostics, enriches them from a local GeoJSON fixture, and writes <case-id>.ign-edge-context.json. No route generation or network calls.`);
}

async function findFiles(root, fileName) {
  const found = [];
  async function walk(dir) {
    const entries = await readdir(dir, { withFileTypes: true }).catch(() => []);
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) await walk(path);
      else if (entry.name === fileName) found.push(path);
    }
  }
  await walk(root);
  return found;
}

async function resolveEdgeArtifact(options) {
  if (options.edgeArtifact != null) return resolve(repoRoot, options.edgeArtifact);
  const candidates = await findFiles(resolve(repoRoot, options.searchRoot), `${options.caseId}.edges.json`);
  if (candidates.length === 0) return null;
  candidates.sort((a, b) => b.localeCompare(a));
  return candidates[0];
}

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function edgeWithCoordinates(edge) {
  return {
    ...edge,
    fromCoordinate: edge.fromCoordinate ?? edge.from ?? undefined,
    toCoordinate: edge.toCoordinate ?? edge.to ?? undefined,
  };
}

function edgesFromArtifact(artifact) {
  if (Array.isArray(artifact?.candidates?.[0]?.edges)) return artifact.candidates[0].edges.map(edgeWithCoordinates);
  if (Array.isArray(artifact?.edgeDiagnostics)) return artifact.edgeDiagnostics.map(edgeWithCoordinates);
  if (Array.isArray(artifact?.features)) {
    return artifact.features.map((feature, index) => {
      const [from, to] = feature.geometry?.coordinates ?? [];
      return {
        edgeId: feature.properties?.edgeId ?? `feature-${index}`,
        osmWayId: feature.properties?.osmWayId ?? null,
        highway: feature.properties?.highway ?? null,
        surface: feature.properties?.surface ?? null,
        lengthKm: feature.properties?.lengthKm ?? 0,
        score: feature.properties?.score ?? 0,
        fromCoordinate: from != null ? { lng: from[0], lat: from[1] } : undefined,
        toCoordinate: to != null ? { lng: to[0], lat: to[1] } : undefined,
      };
    });
  }
  return [];
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    printHelp();
    return;
  }
  if (options.caseId == null) throw new Error('--case is required');
  if (options.fixture == null) throw new Error('--fixture is required');

  const fixturePath = resolve(repoRoot, options.fixture);
  if (!existsSync(fixturePath)) throw new Error(`Fixture not found: ${fixturePath}`);
  const fixtureGeoJson = loadJson(fixturePath);
  const edgeArtifactPath = await resolveEdgeArtifact(options);
  const rawEdges = edgeArtifactPath == null ? [] : edgesFromArtifact(loadJson(edgeArtifactPath));
  const enrichedEdges = enrichEdgesWithTerrainContext(rawEdges, fixtureGeoJson);
  const outputPath = writeIgnPocArtifact({
    caseId: options.caseId,
    edges: enrichedEdges,
    artifactDir: resolve(repoRoot, options.artifactDir),
  });

  console.log(JSON.stringify({ caseId: options.caseId, edgeArtifactPath, edges: enrichedEdges.length, outputPath }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
