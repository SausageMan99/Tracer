import { describe, expect, it } from "vitest";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname } from "node:path";
import type { Coordinate, EnrichedEdge, EnrichedGraph, RouteCandidate, SolverPath } from "@/lib/types";
import { buildGraph } from "@/lib/engine/graph-builder";
import { deriveWeights, scoreEdges } from "@/lib/engine/edge-scorer";
import { solve } from "@/lib/engine/orienteering-solver";
import { postProcess } from "@/lib/engine/route-post-processor";
import { assessRouteQuality } from "@/lib/engine/route-quality";
import { PROFILES_BY_ID } from "@/lib/session-profiles";
import { BENCHMARK_CASES } from "@/lib/route-benchmarks";
import { computeLoopScore, geocodeAddress, PAVED_SURFACES } from "@/lib/route-generator-legacy";

const CASES = BENCHMARK_CASES.filter((benchmark) => benchmark.id.startsWith("tourville-pommiers-trail-"));
const ADDRESS = "7 Rue des Pommiers, 14210 Tourville-sur-Odon";
const PROFILE_ID = "running_trail";
const OUTPUT = "artifacts/route-benchmark-results/tourville-paved-edge-audit.json";
const SUMMARY_OUTPUT = "docs/tourville-paved-ratio-audit.md";

const QUIET_HIGHWAYS = new Set(["residential", "unclassified", "service", "living_street", "pedestrian"]);
const BUSY_HIGHWAYS = new Set(["motorway", "trunk", "primary", "secondary", "tertiary"]);
const TRAIL_HIGHWAYS = new Set(["path", "track", "footway", "bridleway", "cycleway"]);

function undirectedEdgeKey(edge: EnrichedEdge): string {
  const [a, b] = edge.from < edge.to ? [edge.from, edge.to] : [edge.to, edge.from];
  return `${a}-${b}-${edge.osmWayId}`;
}

function isPavedLike(edge: EnrichedEdge): boolean {
  if (edge.surface != null) return PAVED_SURFACES.has(edge.surface);
  return QUIET_HIGHWAYS.has(edge.highway) || BUSY_HIGHWAYS.has(edge.highway);
}

function pavedReason(edge: EnrichedEdge): string {
  if (edge.surface != null && PAVED_SURFACES.has(edge.surface)) return `surface=${edge.surface}`;
  if (edge.surface != null) return `not-paved-surface=${edge.surface}`;
  if (BUSY_HIGHWAYS.has(edge.highway)) return `missing surface; busy highway=${edge.highway}`;
  if (QUIET_HIGHWAYS.has(edge.highway)) return `missing surface; quiet road highway=${edge.highway}`;
  return "not paved-like";
}

function coordOf(graph: EnrichedGraph, nodeId: string): Coordinate | null {
  const node = graph.nodes.get(nodeId);
  return node ? { lat: node.lat, lng: node.lng } : null;
}

function pathQuality(graph: EnrichedGraph, path: SolverPath, startCoordinate: Coordinate, profile: NonNullable<ReturnType<typeof PROFILES_BY_ID.get>>, targetDistanceKm: number, targetElevationM: number) {
  const coords = path.nodeIds
    .map((nodeId) => coordOf(graph, nodeId))
    .filter((coord): coord is Coordinate => coord != null);
  const points = coords.map((coord) => ({ ...coord, elevation: 0 }));
  const candidate = {
    points,
    distanceKm: path.distanceKm,
    durationSeconds: 0,
    ascendM: 0,
    descendM: 0,
    surfaceScore: 0.5,
    loopScore: computeLoopScore(points, startCoordinate),
    geometry: { type: "LineString" as const, coordinates: coords.map((coord) => [coord.lng, coord.lat] as [number, number]) },
  };
  return assessRouteQuality({
    candidate,
    path,
    graph,
    profile,
    targetDistanceKm,
    targetElevationM,
  });
}

function matchBestPath(graph: EnrichedGraph, paths: SolverPath[], best: RouteCandidate, startCoordinate: Coordinate, profile: NonNullable<ReturnType<typeof PROFILES_BY_ID.get>>, targetDistanceKm: number, targetElevationM: number): SolverPath {
  let bestPath = paths[0];
  let bestDelta = Number.POSITIVE_INFINITY;

  for (const path of paths) {
    const quality = pathQuality(graph, path, startCoordinate, profile, targetDistanceKm, targetElevationM);
    const delta =
      Math.abs(path.distanceKm - best.distanceKm) +
      Math.abs((quality.pavedRatio ?? 0) - (best.quality?.pavedRatio ?? 0)) * 10 +
      Math.abs(quality.repeatEdgeRatio - (best.quality?.repeatEdgeRatio ?? 0)) * 10 +
      Math.abs(quality.uTurnRatio - (best.quality?.uTurnRatio ?? 0)) * 10;
    if (delta < bestDelta) {
      bestDelta = delta;
      bestPath = path;
    }
  }

  return bestPath;
}

function pavedRuns(graph: EnrichedGraph, path: SolverPath) {
  const runs: Array<{
    startEdgeIndex: number;
    endEdgeIndex: number;
    lengthKm: number;
    edges: Array<Record<string, unknown>>;
  }> = [];
  let current: (typeof runs)[number] | null = null;

  path.edgeIds.forEach((edgeId, index) => {
    const edge = graph.edges.get(edgeId);
    if (!edge) return;
    const paved = isPavedLike(edge);
    if (!paved) {
      if (current) runs.push(current);
      current = null;
      return;
    }

    const entry = {
      index,
      edgeId: edge.id,
      edgeKey: undirectedEdgeKey(edge),
      osmWayId: edge.osmWayId,
      highway: edge.highway,
      surface: edge.surface ?? null,
      lengthKm: Number(edge.lengthKm.toFixed(4)),
      score: Number(edge.score.toFixed(4)),
      scenic: edge.scenic === true,
      trailLikeHighway: TRAIL_HIGHWAYS.has(edge.highway),
      reason: pavedReason(edge),
      from: coordOf(graph, edge.from),
      to: coordOf(graph, edge.to),
    };

    if (!current) {
      current = { startEdgeIndex: index, endEdgeIndex: index, lengthKm: 0, edges: [] };
    }
    current.endEdgeIndex = index;
    current.lengthKm += edge.lengthKm;
    current.edges.push(entry);
  });

  if (current) runs.push(current);
  return runs
    .map((run) => ({ ...run, lengthKm: Number(run.lengthKm.toFixed(4)) }))
    .sort((a, b) => b.lengthKm - a.lengthKm);
}

async function auditCase(benchmark: (typeof CASES)[number], startCoordinate: Coordinate) {
  const distanceKm = benchmark.targetDistanceKm;
  const targetElevationM = benchmark.targetElevationM;
  const profile = PROFILES_BY_ID.get(benchmark.profileId);
  if (!profile) throw new Error(`Unknown profile ${PROFILE_ID}`);

  const { graph, scenicWayIds } = await buildGraph(startCoordinate, { targetDistanceKm: distanceKm, sport: profile.sport });
  const weights = deriveWeights(profile, true);
  const { nodeElevation } = await scoreEdges(graph, weights, profile, scenicWayIds);

  // Use the graph node closest to the geocoded start, mirroring generateRouteV2.
  let closestNodeId = "";
  let closestDist = Number.POSITIVE_INFINITY;
  for (const [nodeId, node] of graph.nodes) {
    const dLat = node.lat - startCoordinate.lat;
    const dLng = node.lng - startCoordinate.lng;
    const d2 = dLat * dLat + dLng * dLng;
    if (d2 < closestDist) {
      closestDist = d2;
      closestNodeId = nodeId;
    }
  }
  const solverPaths = await solve(graph, closestNodeId, distanceKm, targetElevationM, nodeElevation);

  const candidates = await postProcess(solverPaths, graph, startCoordinate, profile, distanceKm, targetElevationM, nodeElevation, scenicWayIds);
  const best = candidates[0];
  const matchedPath = matchBestPath(graph, solverPaths, best, startCoordinate, profile, distanceKm, targetElevationM);
  const edges = matchedPath.edgeIds.map((edgeId) => graph.edges.get(edgeId)).filter((edge): edge is EnrichedEdge => edge != null);
  const totalKm = edges.reduce((sum, edge) => sum + edge.lengthKm, 0);
  const pavedKm = edges.filter(isPavedLike).reduce((sum, edge) => sum + edge.lengthKm, 0);
  const scenicPavedKm = edges.filter((edge) => isPavedLike(edge) && edge.scenic === true).reduce((sum, edge) => sum + edge.lengthKm, 0);
  const taggedSurfacePavedKm = edges.filter((edge) => edge.surface != null && isPavedLike(edge)).reduce((sum, edge) => sum + edge.lengthKm, 0);
  const inferredRoadPavedKm = edges.filter((edge) => edge.surface == null && isPavedLike(edge)).reduce((sum, edge) => sum + edge.lengthKm, 0);

  return {
    id: `tourville-pommiers-trail-${distanceKm}k`,
    targetDistanceKm: distanceKm,
    graph: { nodes: graph.nodes.size, edges: graph.edges.size, radiusKm: graph.radiusKm },
    best: {
      distanceKm: Number(best.distanceKm.toFixed(3)),
      ascendM: Math.round(best.ascendM),
      totalScore: Number(best.totalScore.toFixed(4)),
      productionScore: Number((best.quality?.productionScore ?? 0).toFixed(4)),
      trailRatio: Number((best.quality?.trailRatio ?? 0).toFixed(4)),
      pavedRatio: Number((best.quality?.pavedRatio ?? 0).toFixed(4)),
      repeatEdgeRatio: Number((best.quality?.repeatEdgeRatio ?? 0).toFixed(4)),
      uTurnRatio: Number((best.quality?.uTurnRatio ?? 0).toFixed(4)),
      naturalCorridorRatio: Number((best.quality?.naturalCorridorRatio ?? 0).toFixed(4)),
      longestTrailSegmentKm: Number((best.quality?.longestTrailSegmentKm ?? 0).toFixed(3)),
      warnings: best.quality?.warnings ?? [],
    },
    edgeAudit: {
      matchedPathDistanceKm: Number(matchedPath.distanceKm.toFixed(3)),
      edgeCount: edges.length,
      totalKm: Number(totalKm.toFixed(4)),
      pavedKm: Number(pavedKm.toFixed(4)),
      pavedRatio: Number((totalKm > 0 ? pavedKm / totalKm : 0).toFixed(4)),
      scenicPavedKm: Number(scenicPavedKm.toFixed(4)),
      taggedSurfacePavedKm: Number(taggedSurfacePavedKm.toFixed(4)),
      inferredRoadPavedKm: Number(inferredRoadPavedKm.toFixed(4)),
      longestPavedRuns: pavedRuns(graph, matchedPath).slice(0, 8),
    },
  };
}

function toMarkdown(report: Awaited<ReturnType<typeof auditCase>>[]) {
  const lines = [
    "# Tourville pavedRatio edge-level audit",
    "",
    `Adresse: ${ADDRESS}`,
    `Profil: ${PROFILE_ID}, scenicMode=true, D+=benchmarks Tourville (80/120/140/150 m)`,
    "",
    "Diagnostic court: pavedRatio est majoritairement porté par des voies OSM explicitement `surface=asphalt` ou `surface=concrete`, souvent `scenic=true`. Ce n'est pas un bug de formule pavedRatio: le moteur compte correctement le bitume tagué. Le problème produit est plutôt que le solver accepte des corridors boisés goudronnés et ne reste pas assez longtemps sur chemins non revêtus quand ils existent.",
    "",
  ];

  for (const item of report) {
    lines.push(`## ${item.id}`);
    lines.push(`Best: ${item.best.distanceKm} km, productionScore ${item.best.productionScore}, trailRatio ${item.best.trailRatio}, pavedRatio ${item.best.pavedRatio}, repeat ${item.best.repeatEdgeRatio}, uTurn ${item.best.uTurnRatio}`);
    lines.push(`Edge audit: ${item.edgeAudit.pavedKm}/${item.edgeAudit.totalKm} km paved (${item.edgeAudit.pavedRatio}), dont ${item.edgeAudit.taggedSurfacePavedKm} km tagués surface pavée, ${item.edgeAudit.inferredRoadPavedKm} km inférés route sans surface, ${item.edgeAudit.scenicPavedKm} km à la fois paved et scenic.`);
    lines.push("");
    lines.push("Segments paved principaux:");
    for (const run of item.edgeAudit.longestPavedRuns.slice(0, 5)) {
      const first = run.edges[0];
      const wayIds = [...new Set(run.edges.map((edge) => edge.osmWayId))].join(", ");
      const surfaces = [...new Set(run.edges.map((edge) => edge.surface ?? "unknown"))].join(", ");
      const highways = [...new Set(run.edges.map((edge) => edge.highway))].join(", ");
      lines.push(`- edges ${run.startEdgeIndex}-${run.endEdgeIndex}, ${run.lengthKm} km, ways ${wayIds}, highway ${highways}, surface ${surfaces}, firstEdge ${String(first.edgeId)}, score ${String(first.score)}, reason ${String(first.reason)}`);
    }
    lines.push("");
  }

  lines.push("Conclusion: ajuster prudemment le scoring/solver plutôt que la classification globale. Une route forestière asphaltée doit rester paved pour le ratio, même si elle est scenic. Le levier propre est de favoriser la continuité non revêtue et de pénaliser paved scenic seulement quand le profil est trail/running, pas de reclasser asphalt en trail.");
  lines.push("");
  return `${lines.join("\n")}\n`;
}

const describeAudit = process.env.TRAILFORGE_AUDIT === "1" ? describe : describe.skip;

describeAudit("Tourville pavedRatio audit", () => {
  it("writes an edge-level paved segment report for 5/8/10/12k", async () => {
    const startCoordinate = await geocodeAddress(ADDRESS);
    const report = [];
    for (const benchmark of CASES) {
      report.push(await auditCase(benchmark, startCoordinate));
    }

    await mkdir(dirname(OUTPUT), { recursive: true });
    await writeFile(OUTPUT, `${JSON.stringify({ address: ADDRESS, profileId: PROFILE_ID, scenicMode: true, cases: report }, null, 2)}\n`, "utf8");
    await writeFile(SUMMARY_OUTPUT, toMarkdown(report), "utf8");

    expect(report).toHaveLength(CASES.length);
  }, 180_000);
});
