import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const HIGH_NATURAL_CONTEXT_THRESHOLD = 0.7;
const EXPLICIT_PAVED_SURFACES = new Set(['asphalt', 'concrete', 'paved', 'sett', 'paving_stones']);

function roundKm(value) {
  return Number((value ?? 0).toFixed(5));
}

function normalizeSurface(surface) {
  return (surface ?? '').trim().toLowerCase();
}

function isExplicitPaved(edge) {
  return EXPLICIT_PAVED_SURFACES.has(normalizeSurface(edge.surface));
}

function context(edge) {
  return edge.terrainContext ?? {
    source: 'none',
    naturalContextScore: 0,
    artificializationScore: 0,
    confidence: 'low',
    warnings: [],
  };
}

function confidenceRank(confidence) {
  if (confidence === 'high') return 3;
  if (confidence === 'medium') return 2;
  return 1;
}

function summarizeConfidence(edges) {
  return edges.reduce((best, edge) => (
    confidenceRank(context(edge).confidence) > confidenceRank(best) ? context(edge).confidence : best
  ), 'low');
}

function artifactEdge(edge) {
  return {
    edgeId: edge.edgeId ?? edge.id ?? null,
    osmWayId: edge.osmWayId ?? null,
    highway: edge.highway ?? null,
    surface: edge.surface ?? null,
    lengthKm: roundKm(edge.lengthKm),
    terrainContext: context(edge),
  };
}

export function buildIgnPocArtifact({ caseId, edges, generatedAt = new Date().toISOString() }) {
  const edgeList = Array.isArray(edges) ? edges : [];
  const sumKm = (predicate) => roundKm(edgeList
    .filter(predicate)
    .reduce((sum, edge) => sum + (edge.lengthKm ?? 0), 0));
  const meanArtificializationScore = edgeList.length > 0
    ? Number((edgeList.reduce((sum, edge) => sum + context(edge).artificializationScore, 0) / edgeList.length).toFixed(5))
    : 0;

  return {
    caseId,
    generatedAt,
    source: 'ign_poc_fixture',
    summary: {
      edges: edgeList.length,
      withHighNaturalContext: edgeList.filter((edge) => context(edge).naturalContextScore >= HIGH_NATURAL_CONTEXT_THRESHOLD).length,
      explicitPavedInNaturalContextKm: sumKm((edge) => isExplicitPaved(edge) && context(edge).naturalContextScore >= HIGH_NATURAL_CONTEXT_THRESHOLD),
      forestContextKm: sumKm((edge) => context(edge).landcoverClass === 'forest'),
      parkContextKm: sumKm((edge) => context(edge).landcoverClass === 'park'),
      urbanContextKm: sumKm((edge) => context(edge).landcoverClass === 'urban'),
      meanArtificializationScore,
      terrainContextConfidence: summarizeConfidence(edgeList),
    },
    edgeDiagnostics: edgeList.map(artifactEdge),
  };
}

export function writeIgnPocArtifact({ caseId, edges, artifactDir, generatedAt }) {
  mkdirSync(artifactDir, { recursive: true });
  const artifact = buildIgnPocArtifact({ caseId, edges, generatedAt });
  const path = join(artifactDir, `${caseId}.ign-edge-context.json`);
  writeFileSync(path, `${JSON.stringify(artifact, null, 2)}\n`, 'utf8');
  return path;
}
